import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { createReadStream, createWriteStream, type WriteStream } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { buildSecurityDatasetManifest } from "./manifest";

type DatasetSplit = "train" | "validation" | "test" | "eval_holdout";

type Options = {
  shardsDir: string;
  outDir: string;
  snapshotId: string | null;
  sourceSnapshotId: string | null;
  huggingFaceRepo: string;
  huggingFaceRevision: string;
};

type ShardManifest = {
  snapshot_id: string;
  source_snapshot_id: string;
  created_at: string;
  repo_git_sha: string;
  convex_deployment: string;
  export_mode: "public";
  page_size: number;
  concurrency: number;
  shards: number;
  shard_count: number;
  row_counts: {
    source_artifacts: number;
    artifacts: number;
    scan_results: number;
    static_findings: number;
    clawscan_findings: number;
    labels: number;
    splits: number;
    huggingface_rows: number;
  };
  scanner_versions: string[];
  model_names: string[];
  redaction_policy_version: string;
  source_tables: string[];
  created_time_window: {
    created_at_gte: number | null;
    created_at_lt: number | null;
  };
  huggingface_dataset: {
    rowCountsBySplit?: Record<DatasetSplit, number>;
    row_counts_by_split?: Record<DatasetSplit, number>;
  } | null;
};

const JSONL_FILES = [
  "artifacts.jsonl",
  "scan_results.jsonl",
  "static_findings.jsonl",
  "clawscan_findings.jsonl",
  "labels.jsonl",
  "splits.jsonl",
] as const;
const HF_SPLITS: DatasetSplit[] = ["train", "validation", "test", "eval_holdout"];

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const shardManifests = await findShardManifests(resolve(options.shardsDir));
  if (shardManifests.length === 0) {
    throw new Error(`No shard manifests found under ${options.shardsDir}`);
  }

  const snapshotId = options.snapshotId ?? buildSnapshotId();
  const snapshotDir = resolve(options.outDir, snapshotId);
  await mkdir(join(snapshotDir, "hf-dataset", "data"), { recursive: true });

  const manifests: Array<{ path: string; dir: string; manifest: ShardManifest }> = [];
  for (const manifestPath of shardManifests.sort()) {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as ShardManifest;
    manifests.push({ path: manifestPath, dir: dirname(manifestPath), manifest });
  }

  await concatenateSnapshotFiles(manifests, snapshotDir);
  const outputSizes = await collectOutputSizes(snapshotDir);
  const manifest = buildMergedManifest({ options, manifests, snapshotId, outputSizes });
  await writeFile(join(snapshotDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(JSON.stringify({ snapshotId, snapshotDir, manifest }, null, 2));
}

async function concatenateSnapshotFiles(
  manifests: Array<{ dir: string; manifest: ShardManifest }>,
  snapshotDir: string,
) {
  for (const file of JSONL_FILES) {
    const writer = createWriteStream(join(snapshotDir, file), { encoding: "utf8" });
    await concatenateFiles(
      writer,
      manifests.map(({ dir }) => join(dir, file)),
    );
  }

  for (const split of HF_SPLITS) {
    const writer = createWriteStream(join(snapshotDir, "hf-dataset", "data", `${split}.jsonl`), {
      encoding: "utf8",
    });
    await concatenateFiles(
      writer,
      manifests.map(({ dir }) => join(dir, "hf-dataset", "data", `${split}.jsonl`)),
    );
  }
}

async function concatenateFiles(writer: WriteStream, paths: string[]) {
  try {
    for (const path of paths) {
      if (!(await isFile(path))) continue;
      const reader = createReadStream(path, { encoding: "utf8" });
      for await (const chunk of reader) {
        if (!writer.write(chunk)) await once(writer, "drain");
      }
    }
  } finally {
    writer.end();
    await once(writer, "finish");
  }
}

function buildMergedManifest(input: {
  options: Options;
  manifests: Array<{ manifest: ShardManifest }>;
  snapshotId: string;
  outputSizes: Record<string, number>;
}) {
  const { options, manifests, snapshotId, outputSizes } = input;
  const first = manifests[0]!.manifest;
  const rowCounts = sumRowCounts(manifests.map(({ manifest }) => manifest));
  const rowCountsBySplit = sumHuggingFaceSplitCounts(manifests.map(({ manifest }) => manifest));
  return buildSecurityDatasetManifest({
    snapshotId,
    sourceSnapshotId: options.sourceSnapshotId ?? snapshotId,
    createdAt: new Date().toISOString(),
    repoGitSha: gitSha(),
    convexDeployment: first.convex_deployment,
    exportMode: "public",
    pageSize: first.page_size,
    concurrency: 1,
    shards: manifests.length,
    shardCount: manifests.reduce((sum, { manifest }) => sum + manifest.shard_count, 0),
    rowCounts: {
      sourceArtifacts: rowCounts.source_artifacts,
      artifacts: rowCounts.artifacts,
      scanResults: rowCounts.scan_results,
      staticFindings: rowCounts.static_findings,
      clawScanFindings: rowCounts.clawscan_findings,
      labels: rowCounts.labels,
      splits: rowCounts.splits,
      huggingFaceRows: rowCounts.huggingface_rows,
    },
    outputSizes,
    scannerVersions: uniqueSorted(manifests.flatMap(({ manifest }) => manifest.scanner_versions)),
    modelNames: uniqueSorted(manifests.flatMap(({ manifest }) => manifest.model_names)),
    redactionPolicyVersion: first.redaction_policy_version,
    sourceTables: first.source_tables,
    timeWindow: mergeTimeWindows(manifests.map(({ manifest }) => manifest)),
    huggingFaceDataset: {
      repo: options.huggingFaceRepo,
      revision: options.huggingFaceRevision,
      commit: null,
      configNames: ["default"],
      splitNames: HF_SPLITS,
      rowCountsBySplit,
    },
  });
}

function sumRowCounts(manifests: ShardManifest[]) {
  return manifests.reduce(
    (sum, manifest) => ({
      source_artifacts: sum.source_artifacts + manifest.row_counts.source_artifacts,
      artifacts: sum.artifacts + manifest.row_counts.artifacts,
      scan_results: sum.scan_results + manifest.row_counts.scan_results,
      static_findings: sum.static_findings + manifest.row_counts.static_findings,
      clawscan_findings: sum.clawscan_findings + manifest.row_counts.clawscan_findings,
      labels: sum.labels + manifest.row_counts.labels,
      splits: sum.splits + manifest.row_counts.splits,
      huggingface_rows: sum.huggingface_rows + manifest.row_counts.huggingface_rows,
    }),
    {
      source_artifacts: 0,
      artifacts: 0,
      scan_results: 0,
      static_findings: 0,
      clawscan_findings: 0,
      labels: 0,
      splits: 0,
      huggingface_rows: 0,
    },
  );
}

function sumHuggingFaceSplitCounts(manifests: ShardManifest[]): Record<DatasetSplit, number> {
  const counts = { train: 0, validation: 0, test: 0, eval_holdout: 0 };
  for (const manifest of manifests) {
    const shardCounts =
      manifest.huggingface_dataset?.rowCountsBySplit ??
      manifest.huggingface_dataset?.row_counts_by_split ??
      counts;
    for (const split of HF_SPLITS) {
      counts[split] += shardCounts[split] ?? 0;
    }
  }
  return counts;
}

function mergeTimeWindows(manifests: ShardManifest[]) {
  const starts = manifests
    .map((manifest) => manifest.created_time_window.created_at_gte)
    .filter((value): value is number => typeof value === "number");
  const ends = manifests
    .map((manifest) => manifest.created_time_window.created_at_lt)
    .filter((value): value is number => typeof value === "number");
  return {
    createdAtGte: starts.length === 0 ? null : Math.min(...starts),
    createdAtLt: ends.length === 0 ? null : Math.max(...ends),
  };
}

async function findShardManifests(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const manifests: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      manifests.push(...(await findShardManifests(path)));
    } else if (entry.isFile() && entry.name === "manifest.json") {
      manifests.push(path);
    }
  }
  return manifests;
}

async function collectOutputSizes(root: string) {
  const sizes: Record<string, number> = {};
  await collectOutputSizesInto(root, root, sizes);
  return sizes;
}

async function collectOutputSizesInto(root: string, dir: string, sizes: Record<string, number>) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectOutputSizesInto(root, path, sizes);
    } else if (entry.isFile()) {
      sizes[path.slice(root.length + 1)] = (await stat(path)).size;
    }
  }
}

async function isFile(path: string) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values)).sort();
}

function buildSnapshotId() {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  return `clawhub-merged-${timestamp}-${gitSha().slice(0, 8)}`;
}

function gitSha() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
  if (result.status !== 0) return "unknown";
  return result.stdout.trim();
}

function parseArgs(args: string[]): Options {
  const options: Options = {
    shardsDir: "",
    outDir: ".data/security-dataset/merged",
    snapshotId: null,
    sourceSnapshotId: null,
    huggingFaceRepo: process.env.HF_DATASET_REPO ?? "OpenClaw/clawhub-security-signals",
    huggingFaceRevision: process.env.HF_REVISION ?? "main",
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--shards-dir") {
      options.shardsDir = readValue(args, ++index, arg);
    } else if (arg === "--out-dir") {
      options.outDir = readValue(args, ++index, arg);
    } else if (arg === "--snapshot-id") {
      options.snapshotId = readValue(args, ++index, arg);
    } else if (arg === "--source-snapshot-id") {
      options.sourceSnapshotId = readValue(args, ++index, arg);
    } else if (arg === "--hf-repo") {
      options.huggingFaceRepo = readValue(args, ++index, arg);
    } else if (arg === "--hf-revision") {
      options.huggingFaceRevision = readValue(args, ++index, arg);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.shardsDir) throw new Error("--shards-dir is required.");
  return options;
}

function readValue(args: string[], index: number, flag: string) {
  const value = args[index];
  if (!value) throw new Error(`Missing value for ${flag}`);
  return value;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
