#!/usr/bin/env bun
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { curatedManifestSchema } from "./contract";
import { inventoryPlugins } from "./inventory";
import { fetchSnapshot } from "./sources";

const { values } = parseArgs({
  options: {
    manifest: { type: "string" },
    output: { type: "string" },
    catalog: { type: "string" },
    help: { type: "boolean" },
  },
  strict: true,
});
if (values.help) {
  console.log(
    "bun run plugins:inventory --manifest <curated.json> --catalog <catalog.json> --output <report.json>\nRead-only inventory. Never publishes packages or contacts authors.",
  );
} else {
  if (!values.manifest || !values.output || !values.catalog)
    throw new Error("--manifest, --catalog and --output are required (use --help)");
  const manifest = curatedManifestSchema.parse(JSON.parse(await readFile(values.manifest, "utf8")));
  const catalog = JSON.parse(await readFile(values.catalog, "utf8"));
  if (!Array.isArray(catalog) || !catalog.every((item) => item && typeof item.name === "string"))
    throw new Error("Catalog must be an array of current ClawHub packages with names");
  const targets = new Map<string, string>();
  for (const source of [...manifest.registries, ...manifest.sources]) {
    if (targets.has(source.repo) && targets.get(source.repo) !== source.ref)
      throw new Error(
        `Conflicting refs for ${source.repo}; curate one snapshot per repository per run`,
      );
    targets.set(source.repo, source.ref);
  }
  const snapshots = [];
  for (const [repo, ref] of targets) {
    console.error(`Inventorying ${repo}@${ref}`);
    snapshots.push(await fetchSnapshot(repo, ref));
  }
  const report = await inventoryPlugins({ manifest, snapshots, catalog });
  await mkdir(dirname(resolve(values.output)), { recursive: true });
  await writeFile(values.output, JSON.stringify(report, null, 2) + "\n");
  console.log(
    JSON.stringify({
      report: resolve(values.output),
      candidates: report.candidates.length,
      selected: report.candidates.filter((c) => c.status === "selected").length,
      permissionNeeded: report.permissionNeeded.length,
    }),
  );
}
