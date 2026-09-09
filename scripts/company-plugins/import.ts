import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { validateFilePath } from "../../convex/lib/skillZip";
import { cmdPublishPackage } from "../../packages/clawhub/src/cli/commands/packages";
import type { GlobalOpts } from "../../packages/clawhub/src/cli/types";
import { sourceKey, type CuratedSource } from "./contract";
import { inventoryPlugins, type InventoryInput } from "./inventory";
import { preparePlugin } from "./prepare";

export async function prepareBatch(input: InventoryInput) {
  const inventory = await inventoryPlugins(input);
  const prepared = [];
  for (const candidate of inventory.candidates.filter((c) => c.status === "selected")) {
    const source = input.manifest.sources.find(
      (s) => sourceKey(s.repo, s.path) === sourceKey(candidate.repo, candidate.path),
    )!;
    const snapshot = input.snapshots.find((s) => s.repo === source.repo)!;
    prepared.push({ source, ...(await preparePlugin({ source, snapshot })) });
  }
  return { inventory, ...buildImportPlan(prepared), prepared };
}

type PreparedPlugin = Awaited<ReturnType<typeof preparePlugin>> & { source: CuratedSource };
function buildImportPlan(prepared: PreparedPlugin[]) {
  for (const item of prepared)
    for (const path of Object.keys(item.files)) {
      if (!validateFilePath(path) || path.includes("\0"))
        throw new Error(`Unsafe artifact path: ${path}`);
    }
  const packages = prepared.map(({ files, ...p }) => ({
    ...p,
    files: Object.entries(files)
      .map(([path, bytes]) => ({
        path,
        size: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      }))
      .sort((a, b) => a.path.localeCompare(b.path)),
  }));
  const plan = { version: 1, packages };
  const digest = createHash("sha256").update(JSON.stringify(plan)).digest("hex");
  return { plan, digest };
}

export async function applyBatch(
  batch: Awaited<ReturnType<typeof prepareBatch>>,
  opts: GlobalOpts,
  approvedDigest: string,
) {
  const prepared = structuredClone(batch.prepared);
  if (approvedDigest !== buildImportPlan(prepared).digest)
    throw new Error(
      "Import plan differs from the reviewed artifact digest; review the new plan before applying",
    );
  const results = [];
  for (const item of prepared) {
    const folder = await mkdtemp(join(tmpdir(), "clawhub-company-plugin-"));
    try {
      for (const [path, bytes] of Object.entries(item.files)) {
        const target = join(folder, path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, bytes);
      }
      const result = await cmdPublishPackage(opts, folder, {
        name: item.name,
        displayName: item.displayName,
        owner: item.source.publisher,
        version: item.version,
        family: "bundle-plugin",
        bundleFormat: item.source.format,
        categories: item.categories.join(","),
        sourceRepo: item.source.repo,
        sourcePath: item.source.path,
        sourceRef: item.source.ref,
        sourceCommit: item.provenance.commit,
        changelog: `Imported ${item.source.repo} at ${item.provenance.commit}. Source SHA-256: ${item.sourceContentHash}.`,
        requirePrepublicationChecks: true,
        expectedInventoryDigest: item.artifactHash,
        json: true,
      });
      if (!result?.attemptId || !["pending", "published"].includes(result.publicationStatus ?? ""))
        throw new Error("Publisher did not confirm the required security-gated attempt");
      results.push({
        name: item.name,
        version: item.version,
        sourceContentHash: item.sourceContentHash,
        artifactHash: item.artifactHash,
        ...result,
      });
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  }
  return results;
}
