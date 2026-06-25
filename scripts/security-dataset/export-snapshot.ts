import { execFile, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { artifactInputsFromConvexExportZip } from "./convexExport";
import { parseConvexJsonMatching } from "./convexOutput";
import { reserveExportInputs } from "./exportLimit";
import {
  buildHuggingFaceSecuritySignalRows,
  type HuggingFaceSecuritySignalRow,
} from "./huggingFaceExport";
import { buildSecurityDatasetManifest } from "./manifest";
import {
  normalizeArtifactExport,
  type ArtifactExportInput,
  type DatasetSplit,
  type NormalizedDatasetRows,
  type SourceKind,
} from "./normalize";
import {
  assertCreatedTimeWindow,
  clampCreatedBounds,
  emptyCreatedTimeWindow,
  parseCreatedTimestamp,
  type CreatedTimeWindow,
} from "./timeWindow";

const execFileAsync = promisify(execFile);

type ConvexPage = {
  page: ArtifactExportInput[];
  isDone: boolean;
  continueCursor: string;
  exportMode: "public";
};

type ConvexBounds = {
  sourceKind: SourceKind;
  minCreatedAt: number | null;
  maxCreatedAt: number | null;
};

type DatasetLineage = {
  exportMode: "public";
  generatedAt: number;
  redactionPolicyVersion: string;
  sourceTables: string[];
  sourceBounds: ConvexBounds[];
};

type CompressedConvexPage = {
  encoding: "gzip-base64-json";
  payload: string;
};

type Options = {
  deployment: string | null;
  convexUrl: string | null;
  workerToken: string | null;
  prod: boolean;
  push: boolean;
  dryRun: boolean;
  mode: "public";
  limit: number | null;
  pageSize: number;
  minPageSize: number;
  batchPages: number;
  concurrency: number;
  shards: number;
  outDir: string;
  sourceKind: SourceKind | "all";
  timeWindow: CreatedTimeWindow;
  convexExportZip: string | null;
  sourceSnapshotId: string | null;
  huggingFaceDataset: boolean;
  huggingFaceRepo: string;
  huggingFaceRevision: string;
  writeShardMatrix: string | null;
};

type ExportShard = {
  sourceKind: SourceKind;
  createdAtGte?: number;
  createdAtLt?: number;
  label: string;
};

type SnapshotState = {
  sourceArtifacts: number;
  rowCounts: {
    artifacts: number;
    scanResults: number;
    staticFindings: number;
    clawScanFindings: number;
    labels: number;
    splits: number;
    huggingFaceRows: number;
  };
  huggingFaceRowCountsBySplit: Record<DatasetSplit, number>;
  scannerVersions: Set<string>;
  modelNames: Set<string>;
};

type SnapshotWriters = {
  artifacts: WriteStream;
  scanResults: WriteStream;
  staticFindings: WriteStream;
  clawScanFindings: WriteStream;
  labels: WriteStream;
  splits: WriteStream;
  huggingFaceSplits?: Record<DatasetSplit, WriteStream>;
};

const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_BATCH_PAGES = 5;
const DEFAULT_CONCURRENCY = 6;
const DEFAULT_SHARDS = 12;
const DEFAULT_MAX_CONVEX_ATTEMPTS = 6;
const DEFAULT_OUT_DIR = ".data/security-dataset/snapshots";
const CONVEX_RUN_MAX_BUFFER_BYTES = 128 * 1024 * 1024;
const SOURCE_KINDS: SourceKind[] = ["skill", "package"];
const HF_SPLITS: DatasetSplit[] = ["train", "validation", "test", "eval_holdout"];

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.writeShardMatrix) {
    await writeShardMatrix(options);
    return;
  }

  const snapshotId = buildSnapshotId(options);
  const snapshotDir = resolve(options.outDir, snapshotId);
  const writers = options.dryRun ? null : await openSnapshotWriters(snapshotDir, options);
  let writersClosed = false;
  const state = createSnapshotState();

  try {
    const shardCount = options.convexExportZip
      ? await exportConvexExportZip({ options, state, writers })
      : await exportRemoteShards({ options, state, writers });

    if (options.dryRun) {
      const manifest = buildManifest({
        options,
        snapshotId,
        state,
        shardCount,
        outputSizes: {},
      });
      console.log(JSON.stringify({ snapshotId, dryRun: true, manifest }, null, 2));
      return;
    }

    if (!writers) throw new Error("Snapshot writers were not opened.");
    await closeSnapshotWriters(writers);
    writersClosed = true;
    const outputSizes = await collectOutputSizes(snapshotDir);
    const manifest = buildManifest({ options, snapshotId, state, shardCount, outputSizes });
    await writeFile(join(snapshotDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

    console.log(JSON.stringify({ snapshotId, snapshotDir, manifest }, null, 2));
  } catch (error) {
    if (writers && !writersClosed) await closeSnapshotWriters(writers).catch(() => {});
    throw error;
  }
}

async function writeShardMatrix(options: Options) {
  const shards = await buildExportShards(options);
  const matrix = {
    include: shards.map((shard, index) => ({
      index,
      sourceKind: shard.sourceKind,
      createdAtGte: shard.createdAtGte,
      createdAtLt: shard.createdAtLt,
      label: shard.label,
    })),
  };
  await writeFile(options.writeShardMatrix!, `${JSON.stringify(matrix, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        shardCount: shards.length,
        matrixPath: options.writeShardMatrix,
        sourceKinds: Array.from(new Set(shards.map((shard) => shard.sourceKind))).sort(),
      },
      null,
      2,
    ),
  );
}

async function exportRemoteShards(input: {
  options: Options;
  state: SnapshotState;
  writers: SnapshotWriters | null;
}) {
  const { options, state, writers } = input;
  const shards = await buildExportShards(options);
  await exportShards({ options, shards, state, writers });
  return shards.length;
}

async function exportConvexExportZip(input: {
  options: Options;
  state: SnapshotState;
  writers: SnapshotWriters | null;
}) {
  const { options, state, writers } = input;
  if (!options.convexExportZip) throw new Error("Missing Convex export ZIP path.");
  const inputs = await artifactInputsFromConvexExportZip(options.convexExportZip);
  const reserved = reserveExportInputs(
    filterExportInputs(inputs, options.sourceKind, options.timeWindow),
    state,
    options.limit,
  );
  await processArtifactInputs({ inputs: reserved, state, writers });
  console.error(
    `[snapshot] convex-export +${reserved.length} artifacts (${state.sourceArtifacts} total)`,
  );
  return 0;
}

function filterExportInputs(
  inputs: ArtifactExportInput[],
  sourceKind: SourceKind | "all",
  timeWindow: CreatedTimeWindow,
) {
  return inputs.filter((input) => {
    if (sourceKind !== "all" && input.sourceKind !== sourceKind) return false;
    if (timeWindow.createdAtGte !== null && input.createdAt < timeWindow.createdAtGte) return false;
    if (timeWindow.createdAtLt !== null && input.createdAt >= timeWindow.createdAtLt) return false;
    return true;
  });
}

async function buildExportShards(options: Options) {
  const sourceKinds = options.sourceKind === "all" ? SOURCE_KINDS : [options.sourceKind];
  const shards: ExportShard[] = [];

  for (const sourceKind of sourceKinds) {
    const bounds = await runConvexBounds(options, sourceKind);
    shards.push(...boundsToShards(clampCreatedBounds(bounds, options.timeWindow), options.shards));
  }

  return shards;
}

async function exportShards(input: {
  options: Options;
  shards: ExportShard[];
  state: SnapshotState;
  writers: SnapshotWriters | null;
}) {
  const { options, shards, state, writers } = input;
  await runWithConcurrency(shards, options.concurrency, async (shard) => {
    await exportShard({ options, shard, state, writers });
  });
}

async function exportShard(input: {
  options: Options;
  shard: ExportShard;
  state: SnapshotState;
  writers: SnapshotWriters | null;
}) {
  const { options, shard, state, writers } = input;
  let cursor: string | null = null;
  let pageSize = options.pageSize;
  let batchPages = options.batchPages;
  while (!isLimitReached(options, state)) {
    const result = await runConvexPage(options, shard, cursor, pageSize, batchPages);
    pageSize = result.pageSize;
    batchPages = result.batchPages;
    const page = result.page;
    const inputs = reserveExportInputs(page.page, state, options.limit);
    if (inputs.length > 0) {
      await processArtifactInputs({ inputs, state, writers });
      console.error(
        `[snapshot] ${shard.label} +${inputs.length} artifacts (${state.sourceArtifacts} total)`,
      );
    }
    if (page.isDone || inputs.length < page.page.length) return;
    cursor = page.continueCursor;
  }
}

async function runConvexPage(
  options: Options,
  shard: ExportShard,
  cursor: string | null,
  numItems: number,
  batchPages: number,
): Promise<{ page: ConvexPage; pageSize: number; batchPages: number }> {
  const functionName = "securityDatasetNode:listArtifactExportBatchCompressedInternal";
  const workerFunctionName = "securityDatasetNode:listArtifactExportBatchCompressed";
  let pageSize = numItems;
  let pageCount = batchPages;

  while (true) {
    const args = {
      sourceKind: shard.sourceKind,
      mode: options.mode,
      createdAtGte: shard.createdAtGte,
      createdAtLt: shard.createdAtLt,
      paginationOpts: { cursor, numItems: pageSize },
      pageCount,
    };

    let lastError: unknown = null;
    for (let attempt = 1; attempt <= DEFAULT_MAX_CONVEX_ATTEMPTS; attempt += 1) {
      try {
        const compressed = options.workerToken
          ? await runWorkerAction<CompressedConvexPage>(
              options,
              workerFunctionName,
              { ...args, token: options.workerToken },
              isCompressedConvexPage,
            )
          : await runConvexJsonOnce<CompressedConvexPage>(
              options,
              functionName,
              args,
              isCompressedConvexPage,
            );
        return {
          page: decodeCompressedConvexPage(compressed),
          pageSize,
          batchPages: pageCount,
        };
      } catch (error) {
        lastError = error;
        if (
          isLikelyOversizedConvexBatch(error) &&
          canReduceConvexBatch(options, pageSize, pageCount)
        )
          break;
        if (attempt === DEFAULT_MAX_CONVEX_ATTEMPTS) break;
        console.error(
          `[snapshot] retrying ${functionName} page-size=${pageSize} batch-pages=${pageCount} after attempt ${attempt}: ${errorMessage(error)}`,
        );
        await delay(attempt * 500);
      }
    }

    if (isLikelyOversizedConvexBatch(lastError) && pageCount > 1) {
      const nextPageCount = Math.max(1, Math.floor(pageCount / 2));
      console.error(
        `[snapshot] ${shard.label} reducing batch-pages ${pageCount}->${nextPageCount}: ${errorMessage(lastError)}`,
      );
      pageCount = nextPageCount;
      continue;
    }

    if (isLikelyOversizedConvexBatch(lastError) && pageSize > options.minPageSize) {
      const nextPageSize = Math.max(options.minPageSize, Math.floor(pageSize / 2));
      console.error(
        `[snapshot] ${shard.label} reducing page-size ${pageSize}->${nextPageSize}: ${errorMessage(lastError)}`,
      );
      pageSize = nextPageSize;
      pageCount = 1;
      continue;
    }

    writeCommandErrorOutput(lastError);
    throw lastError;
  }
}

async function runConvexBounds(options: Options, sourceKind: SourceKind): Promise<ConvexBounds> {
  if (options.workerToken) {
    const lineage = await runWorkerAction<DatasetLineage>(
      options,
      "securityDatasetNode:getDatasetLineage",
      { token: options.workerToken, mode: options.mode },
      isDatasetLineage,
    );
    const bounds = lineage.sourceBounds.find((candidate) => candidate.sourceKind === sourceKind);
    if (!bounds) {
      return { sourceKind, minCreatedAt: null, maxCreatedAt: null };
    }
    return bounds;
  }
  return runConvexJson<ConvexBounds>(
    options,
    "securityDataset:getArtifactExportBoundsInternal",
    { sourceKind },
    isConvexBounds,
  );
}

async function runWorkerAction<T>(
  options: Options,
  functionName: string,
  args: unknown,
  validate: (value: unknown) => value is T,
): Promise<T> {
  if (!options.convexUrl) {
    throw new Error("--convex-url or CONVEX_URL is required when using --worker-token.");
  }
  const client = new ConvexHttpClient(options.convexUrl);
  const result = await client.action(resolveWorkerAction(functionName), args as never);
  if (validate(result)) return result;
  throw new Error(`Invalid ${functionName} response.`);
}

function resolveWorkerAction(functionName: string) {
  if (functionName === "securityDatasetNode:listArtifactExportBatchCompressed") {
    return api.securityDatasetNode.listArtifactExportBatchCompressed;
  }
  if (functionName === "securityDatasetNode:getDatasetLineage") {
    return api.securityDatasetNode.getDatasetLineage;
  }
  throw new Error(`Unsupported worker action: ${functionName}`);
}

async function runConvexJson<T>(
  options: Options,
  functionName: string,
  args: unknown,
  validate: (value: unknown) => value is T,
): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= DEFAULT_MAX_CONVEX_ATTEMPTS; attempt += 1) {
    try {
      return await runConvexJsonOnce(options, functionName, args, validate);
    } catch (error) {
      lastError = error;
      if (attempt === DEFAULT_MAX_CONVEX_ATTEMPTS) break;
      console.error(
        `[snapshot] retrying ${functionName} after attempt ${attempt}: ${errorMessage(error)}`,
      );
      await delay(attempt * 500);
    }
  }

  writeCommandErrorOutput(lastError);
  throw lastError;
}

async function runConvexJsonOnce<T>(
  options: Options,
  functionName: string,
  args: unknown,
  validate: (value: unknown) => value is T,
): Promise<T> {
  const commandArgs = buildConvexRunArgs(options, functionName, args);
  const result = await execFileAsync("bunx", commandArgs, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: convexRunEnv(),
    maxBuffer: CONVEX_RUN_MAX_BUFFER_BYTES,
  });
  try {
    return parseConvexJsonMatching(result.stdout, validate);
  } catch (parseError) {
    await writeDebugConvexOutput(functionName, result.stdout);
    throw parseError;
  }
}

function convexRunEnv() {
  const { FORCE_COLOR: _forceColor, ...env } = process.env;
  return { ...env, NO_COLOR: "1" };
}

async function writeDebugConvexOutput(functionName: string, stdout: string) {
  const debugDir = process.env.SECURITY_DATASET_DEBUG_CONVEX_OUTPUT_DIR;
  if (!debugDir) return;
  await mkdir(debugDir, { recursive: true });
  const safeFunctionName = functionName.replace(/[^a-zA-Z0-9_-]/g, "-");
  const path = join(debugDir, `${Date.now()}-${process.pid}-${safeFunctionName}.stdout`);
  await writeFile(path, stdout);
  console.error(`[snapshot] wrote debug Convex stdout to ${path}`);
}

function buildManifest(input: {
  options: Options;
  snapshotId: string;
  state: SnapshotState;
  shardCount: number;
  outputSizes: Record<string, number>;
}) {
  const { options, snapshotId, state, shardCount, outputSizes } = input;
  const repoGitSha = gitSha();
  return buildSecurityDatasetManifest({
    snapshotId,
    sourceSnapshotId: options.sourceSnapshotId ?? snapshotId,
    createdAt: new Date().toISOString(),
    repoGitSha,
    convexDeployment:
      options.deployment ??
      inferDeploymentFromConvexUrl(options.convexUrl) ??
      (options.prod ? "prod" : "configured-dev"),
    exportMode: options.mode,
    pageSize: options.pageSize,
    concurrency: options.concurrency,
    shards: options.shards,
    shardCount,
    rowCounts: {
      sourceArtifacts: state.sourceArtifacts,
      artifacts: state.rowCounts.artifacts,
      scanResults: state.rowCounts.scanResults,
      staticFindings: state.rowCounts.staticFindings,
      clawScanFindings: state.rowCounts.clawScanFindings,
      labels: state.rowCounts.labels,
      splits: state.rowCounts.splits,
      huggingFaceRows: state.rowCounts.huggingFaceRows,
    },
    outputSizes,
    scannerVersions: Array.from(state.scannerVersions).sort(),
    modelNames: Array.from(state.modelNames).sort(),
    redactionPolicyVersion: "public-signals-v2-bundle-files",
    sourceTables: ["skillVersions", "packageReleases"],
    timeWindow: options.timeWindow,
    huggingFaceDataset: options.huggingFaceDataset
      ? {
          repo: options.huggingFaceRepo,
          revision: options.huggingFaceRevision,
          commit: null,
          configNames: ["default"],
          splitNames: HF_SPLITS,
          rowCountsBySplit: state.huggingFaceRowCountsBySplit,
        }
      : undefined,
  });
}

function inferDeploymentFromConvexUrl(convexUrl: string | null) {
  if (!convexUrl) return null;
  try {
    return new URL(convexUrl).hostname.split(".")[0] || null;
  } catch {
    return null;
  }
}

function buildSnapshotId(options: Options) {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  const deployment =
    options.deployment?.replace(/[^a-zA-Z0-9]+/g, "-") ??
    inferDeploymentFromConvexUrl(options.convexUrl)?.replace(/[^a-zA-Z0-9]+/g, "-") ??
    (options.prod ? "prod" : "dev");
  return `clawhub-${deployment}-${timestamp}-${gitSha().slice(0, 8)}`;
}

function createSnapshotState(): SnapshotState {
  return {
    sourceArtifacts: 0,
    rowCounts: {
      artifacts: 0,
      scanResults: 0,
      staticFindings: 0,
      clawScanFindings: 0,
      labels: 0,
      splits: 0,
      huggingFaceRows: 0,
    },
    huggingFaceRowCountsBySplit: {
      train: 0,
      validation: 0,
      test: 0,
      eval_holdout: 0,
    },
    scannerVersions: new Set(),
    modelNames: new Set(),
  };
}

async function processArtifactInputs(input: {
  inputs: ArtifactExportInput[];
  state: SnapshotState;
  writers: SnapshotWriters | null;
}) {
  const { inputs, state, writers } = input;
  const rows = normalizeArtifactExport(inputs);
  const hfRows = buildHuggingFaceSecuritySignalRows(rows);
  state.rowCounts.artifacts += rows.artifacts.length;
  state.rowCounts.scanResults += rows.scanResults.length;
  state.rowCounts.staticFindings += rows.staticFindings.length;
  state.rowCounts.clawScanFindings += rows.clawScanFindings.length;
  state.rowCounts.labels += rows.labels.length;
  state.rowCounts.splits += rows.splits.length;
  state.rowCounts.huggingFaceRows += hfRows.length;
  for (const row of hfRows) {
    state.huggingFaceRowCountsBySplit[row.split] += 1;
  }
  for (const row of rows.scanResults) {
    if (row.scanner_version) state.scannerVersions.add(row.scanner_version);
    if (row.model) state.modelNames.add(row.model);
  }

  if (!writers) return;
  await writeNormalizedRows(writers, rows);
  if (writers.huggingFaceSplits) {
    await writeHuggingFaceRows(writers.huggingFaceSplits, hfRows);
  }
}

async function openSnapshotWriters(
  snapshotDir: string,
  options: Options,
): Promise<SnapshotWriters> {
  await mkdir(snapshotDir, { recursive: true });
  const writers: SnapshotWriters = {
    artifacts: createWriteStream(join(snapshotDir, "artifacts.jsonl"), { encoding: "utf8" }),
    scanResults: createWriteStream(join(snapshotDir, "scan_results.jsonl"), { encoding: "utf8" }),
    staticFindings: createWriteStream(join(snapshotDir, "static_findings.jsonl"), {
      encoding: "utf8",
    }),
    clawScanFindings: createWriteStream(join(snapshotDir, "clawscan_findings.jsonl"), {
      encoding: "utf8",
    }),
    labels: createWriteStream(join(snapshotDir, "labels.jsonl"), { encoding: "utf8" }),
    splits: createWriteStream(join(snapshotDir, "splits.jsonl"), { encoding: "utf8" }),
  };
  if (options.huggingFaceDataset) {
    const dataDir = join(snapshotDir, "hf-dataset", "data");
    await mkdir(dataDir, { recursive: true });
    writers.huggingFaceSplits = {
      train: createWriteStream(join(dataDir, "train.jsonl"), { encoding: "utf8" }),
      validation: createWriteStream(join(dataDir, "validation.jsonl"), { encoding: "utf8" }),
      test: createWriteStream(join(dataDir, "test.jsonl"), { encoding: "utf8" }),
      eval_holdout: createWriteStream(join(dataDir, "eval_holdout.jsonl"), { encoding: "utf8" }),
    };
  }
  return writers;
}

async function closeSnapshotWriters(writers: SnapshotWriters) {
  const streams = [
    writers.artifacts,
    writers.scanResults,
    writers.staticFindings,
    writers.clawScanFindings,
    writers.labels,
    writers.splits,
    ...Object.values(writers.huggingFaceSplits ?? {}),
  ];
  await Promise.all(streams.map((stream) => endStream(stream)));
}

async function endStream(stream: WriteStream) {
  stream.end();
  await once(stream, "finish");
}

async function writeNormalizedRows(writers: SnapshotWriters, rows: NormalizedDatasetRows) {
  await writeJsonlRows(writers.artifacts, rows.artifacts);
  await writeJsonlRows(writers.scanResults, rows.scanResults);
  await writeJsonlRows(writers.staticFindings, rows.staticFindings);
  await writeJsonlRows(writers.clawScanFindings, rows.clawScanFindings);
  await writeJsonlRows(writers.labels, rows.labels);
  await writeJsonlRows(writers.splits, rows.splits);
}

async function writeJsonlRows(stream: WriteStream, rows: unknown[]) {
  if (rows.length === 0) return;
  const chunk = `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
  if (!stream.write(chunk)) await once(stream, "drain");
}

async function writeHuggingFaceRows(
  streams: Record<DatasetSplit, WriteStream>,
  rows: HuggingFaceSecuritySignalRow[],
) {
  for (const split of HF_SPLITS) {
    await writeJsonlRows(
      streams[split],
      rows.filter((row) => row.split === split),
    );
  }
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
      const relativePath = path.slice(root.length + 1);
      sizes[relativePath] = (await stat(path)).size;
    }
  }
}

function boundsToShards(bounds: ConvexBounds, shardCount: number): ExportShard[] {
  if (bounds.minCreatedAt === null || bounds.maxCreatedAt === null) return [];
  const start = bounds.minCreatedAt;
  const end = bounds.maxCreatedAt + 1;
  const span = Math.max(1, end - start);
  const width = Math.ceil(span / shardCount);
  const shards: ExportShard[] = [];
  for (let shardIndex = 0; shardIndex < shardCount; shardIndex += 1) {
    const createdAtGte = start + shardIndex * width;
    const createdAtLt = Math.min(end, createdAtGte + width);
    if (createdAtGte >= end) break;
    shards.push({
      sourceKind: bounds.sourceKind,
      createdAtGte,
      createdAtLt,
      label: `${bounds.sourceKind}:${shardIndex + 1}/${shardCount}`,
    });
  }
  return shards;
}

function buildConvexRunArgs(options: Options, functionName: string, args: unknown) {
  const commandArgs = ["convex", "run"];
  if (options.prod) commandArgs.push("--prod");
  if (options.deployment) commandArgs.push("--deployment", options.deployment);
  if (options.push) commandArgs.push("--push", "--typecheck=disable");
  commandArgs.push(functionName, JSON.stringify(args));
  return commandArgs;
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (true) {
        const index = next;
        next += 1;
        if (index >= items.length) return;
        await worker(items[index]!);
      }
    }),
  );
}

function isLimitReached(options: Options, state: SnapshotState) {
  return options.limit !== null && state.sourceArtifacts >= options.limit;
}

function isConvexPage(value: unknown): value is ConvexPage {
  return (
    isRecord(value) &&
    Array.isArray(value.page) &&
    typeof value.isDone === "boolean" &&
    typeof value.continueCursor === "string" &&
    value.exportMode === "public"
  );
}

function isConvexBounds(value: unknown): value is ConvexBounds {
  return (
    isRecord(value) &&
    (value.sourceKind === "skill" || value.sourceKind === "package") &&
    (typeof value.minCreatedAt === "number" || value.minCreatedAt === null) &&
    (typeof value.maxCreatedAt === "number" || value.maxCreatedAt === null)
  );
}

function isCompressedConvexPage(value: unknown): value is CompressedConvexPage {
  return (
    isRecord(value) && value.encoding === "gzip-base64-json" && typeof value.payload === "string"
  );
}

function isDatasetLineage(value: unknown): value is DatasetLineage {
  return (
    isRecord(value) &&
    value.exportMode === "public" &&
    typeof value.generatedAt === "number" &&
    typeof value.redactionPolicyVersion === "string" &&
    Array.isArray(value.sourceTables) &&
    Array.isArray(value.sourceBounds) &&
    value.sourceBounds.every(isConvexBounds)
  );
}

function decodeCompressedConvexPage(value: CompressedConvexPage) {
  const json = gunzipSync(Buffer.from(value.payload, "base64")).toString("utf8");
  const parsed: unknown = JSON.parse(json);
  if (isConvexPage(parsed)) return parsed;
  throw new Error("Invalid compressed Convex page response.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function delay(ms: number) {
  return new Promise<void>((done) => setTimeout(done, ms));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isLikelyTruncatedConvexOutput(error: unknown) {
  return /Convex JSON output \(524288 bytes\)/.test(errorMessage(error));
}

function isLikelyConvexOperationTimeout(error: unknown) {
  return /(?:The operation timed out|operation timeout|deadline exceeded)/i.test(
    errorMessage(error),
  );
}

function isLikelyOversizedConvexBatch(error: unknown) {
  return isLikelyTruncatedConvexOutput(error) || isLikelyConvexOperationTimeout(error);
}

function canReduceConvexBatch(options: Options, pageSize: number, pageCount: number) {
  return pageCount > 1 || pageSize > options.minPageSize;
}

function writeCommandErrorOutput(error: unknown) {
  if (!isRecord(error)) return;
  if (typeof error.stderr === "string" && error.stderr.length > 0) {
    process.stderr.write(error.stderr);
  } else if (typeof error.stdout === "string" && error.stdout.length > 0) {
    process.stderr.write(error.stdout);
  }
}

function gitSha() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
  if (result.status !== 0) return "unknown";
  return result.stdout.trim();
}

function parseArgs(args: string[]): Options {
  const options: Options = {
    deployment: null,
    convexUrl: null,
    workerToken: null,
    prod: false,
    push: false,
    dryRun: false,
    mode: "public",
    limit: null,
    pageSize: DEFAULT_PAGE_SIZE,
    minPageSize: 1,
    batchPages: DEFAULT_BATCH_PAGES,
    concurrency: DEFAULT_CONCURRENCY,
    shards: DEFAULT_SHARDS,
    outDir: DEFAULT_OUT_DIR,
    sourceKind: "all",
    timeWindow: emptyCreatedTimeWindow(),
    convexExportZip: null,
    sourceSnapshotId: null,
    huggingFaceDataset: false,
    huggingFaceRepo: process.env.HF_DATASET_REPO ?? "OpenClaw/clawhub-security-signals",
    huggingFaceRevision: process.env.HF_REVISION ?? "main",
    writeShardMatrix: null,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--prod") {
      options.prod = true;
    } else if (arg === "--push") {
      options.push = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--deployment") {
      options.deployment = readValue(args, ++index, arg);
    } else if (arg === "--convex-url") {
      options.convexUrl = readValue(args, ++index, arg);
    } else if (arg === "--worker-token") {
      options.workerToken = readValue(args, ++index, arg);
    } else if (arg === "--limit") {
      options.limit = readPositiveInt(readValue(args, ++index, arg), arg);
    } else if (arg === "--page-size") {
      options.pageSize = readPositiveInt(readValue(args, ++index, arg), arg);
    } else if (arg === "--min-page-size") {
      options.minPageSize = readPositiveInt(readValue(args, ++index, arg), arg);
    } else if (arg === "--batch-pages") {
      options.batchPages = readPositiveInt(readValue(args, ++index, arg), arg);
    } else if (arg === "--concurrency") {
      options.concurrency = readPositiveInt(readValue(args, ++index, arg), arg);
    } else if (arg === "--shards") {
      options.shards = readPositiveInt(readValue(args, ++index, arg), arg);
    } else if (arg === "--out-dir") {
      options.outDir = readValue(args, ++index, arg);
    } else if (arg === "--source-kind") {
      options.sourceKind = readSourceKind(readValue(args, ++index, arg));
    } else if (arg === "--created-after") {
      options.timeWindow.createdAtGte = parseCreatedTimestamp(readValue(args, ++index, arg), arg);
    } else if (arg === "--created-before") {
      options.timeWindow.createdAtLt = parseCreatedTimestamp(readValue(args, ++index, arg), arg);
    } else if (arg === "--convex-export-zip" || arg === "--from-convex-export") {
      options.convexExportZip = readValue(args, ++index, arg);
    } else if (arg === "--source-snapshot-id") {
      options.sourceSnapshotId = readValue(args, ++index, arg);
    } else if (arg === "--hf-dataset") {
      options.huggingFaceDataset = true;
    } else if (arg === "--hf-repo") {
      options.huggingFaceRepo = readValue(args, ++index, arg);
    } else if (arg === "--hf-revision") {
      options.huggingFaceRevision = readValue(args, ++index, arg);
    } else if (arg === "--write-shard-matrix") {
      options.writeShardMatrix = readValue(args, ++index, arg);
    } else if (arg === "--mode") {
      const mode = readValue(args, ++index, arg);
      if (mode !== "public") throw new Error(`Unsupported mode: ${mode}`);
      options.mode = mode;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (options.prod && options.deployment) {
    throw new Error("Use either --prod or --deployment, not both.");
  }
  if (options.workerToken && (options.prod || options.deployment || options.push)) {
    throw new Error("Use --worker-token with --convex-url instead of --prod/--deployment/--push.");
  }
  if (options.minPageSize > options.pageSize) {
    throw new Error("--min-page-size must be less than or equal to --page-size.");
  }
  assertCreatedTimeWindow(options.timeWindow);
  return options;
}

function readValue(args: string[], index: number, flag: string) {
  const value = args[index];
  if (!value) throw new Error(`Missing value for ${flag}`);
  return value;
}

function readPositiveInt(value: string, flag: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0)
    throw new Error(`Expected positive integer for ${flag}`);
  return parsed;
}

function readSourceKind(value: string): SourceKind | "all" {
  if (value === "all" || value === "skill" || value === "package") return value;
  throw new Error(`Unsupported source kind: ${value}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
