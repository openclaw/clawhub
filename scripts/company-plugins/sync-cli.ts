#!/usr/bin/env bun
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { requireAuthToken } from "../../packages/clawhub/src/cli/authToken";
import { curatedManifestSchema } from "./contract";
import { applyBatch, prepareBatch } from "./import";
import { reconcileBatch, readSyncState } from "./reconcile";
import { fetchSnapshot } from "./sources";

const { values } = parseArgs({
  options: {
    manifest: { type: "string" },
    registry: { type: "string" },
    output: { type: "string" },
    apply: { type: "boolean" },
    scheduled: { type: "boolean" },
    "approved-digest": { type: "string" },
    help: { type: "boolean" },
  },
  strict: true,
});
if (values.help) {
  console.log(
    "bun run plugins:sync --manifest <curated.json> --registry <ClawHub URL> --output <report.json> [--apply --approved-digest <reviewed SHA-256>] [--scheduled]\nDefaults to a reviewable plan. Apply uses normal ClawHub authentication and prepublication scans.",
  );
} else {
  if (!values.manifest || !values.registry || !values.output)
    throw new Error("--manifest, --registry and --output are required");
  const registry = new URL(values.registry);
  if (
    registry.protocol !== "https:" &&
    !(
      registry.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(registry.hostname)
    )
  )
    throw new Error("Use HTTPS or a loopback ClawHub fixture");
  if (
    registry.username ||
    registry.password ||
    registry.search ||
    registry.hash ||
    registry.pathname !== "/"
  )
    throw new Error("Use a bare ClawHub origin without credentials");
  const manifest = curatedManifestSchema.parse(JSON.parse(await readFile(values.manifest, "utf8")));
  const targets = new Map<string, string>();
  for (const source of [...manifest.registries, ...manifest.sources]) {
    if (targets.has(source.repo) && targets.get(source.repo) !== source.ref)
      throw new Error(`Conflicting refs for ${source.repo}`);
    targets.set(source.repo, source.ref);
  }
  const snapshots = [];
  const sourceErrors: Array<{ repo: string; error: string }> = [];
  for (const [repo, ref] of targets) {
    try {
      snapshots.push(await fetchSnapshot(repo, ref));
    } catch (error) {
      sourceErrors.push({ repo, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const catalog: Array<{ name: string }> = [];
  let cursor: string | undefined;
  const seen = new Set<string>();
  do {
    const url = new URL("/api/v1/plugins", registry);
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`Catalog request failed: ${response.status}`);
    const data = await response.json();
    if (
      !Array.isArray(data.items) ||
      !data.items.every(
        (p: unknown) => p && typeof p === "object" && "name" in p && typeof p.name === "string",
      )
    )
      throw new Error("Invalid ClawHub catalog response");
    catalog.push(...data.items);
    cursor = data.nextCursor ?? undefined;
    if (cursor) {
      if (typeof cursor !== "string" || seen.has(cursor) || seen.size >= 1000)
        throw new Error("Invalid or excessive catalog pagination");
      seen.add(cursor);
    }
  } while (cursor);
  const token = await requireAuthToken();
  const batch = await reconcileBatch(
    await prepareBatch({ manifest, snapshots, catalog }),
    (name, hash, version) => readSyncState(registry.origin, token, name, hash, version),
    Boolean(values.scheduled),
  );
  const output = resolve(values.output);
  await mkdir(dirname(output), { recursive: true });
  const report = {
    registry: registry.origin,
    digest: batch.digest,
    plan: batch.plan,
    inventory: batch.inventory,
    changes: batch.changes,
    sourceErrors,
  };
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  if (values.apply) {
    if (sourceErrors.length || batch.changes.some((change) => change.status === "failed"))
      throw new Error(
        "Incomplete synchronization state; review the report and retry before applying",
      );
    if (!values.scheduled && !values["approved-digest"])
      throw new Error("--apply requires --approved-digest from the reviewed plan");
    const results = await applyBatch(
      batch,
      {
        workdir: process.cwd(),
        dir: "plugins",
        site: registry.origin,
        registry: registry.origin,
        registrySource: "cli",
      },
      values.scheduled ? batch.digest : values["approved-digest"]!,
    );
    await writeFile(output, JSON.stringify({ ...report, results }, null, 2) + "\n");
  }
  if (sourceErrors.length || batch.changes.some((change) => change.status === "failed"))
    process.exitCode = 1;
  console.log(
    JSON.stringify({
      output,
      digest: batch.digest,
      packages: batch.plan.packages.length,
      applied: Boolean(values.apply),
    }),
  );
}
