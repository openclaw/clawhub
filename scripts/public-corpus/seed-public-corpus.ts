#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { assertPreviewSeedTargetAllowed } from "../seed";
import { buildDummyOwnerPool, ownerForCorpusKey, type DummyCorpusOwner } from "./dummyOwners";
import {
  DEFAULT_PUBLIC_CORPUS_FIXTURE,
  parseCorpusJsonl,
  validateCorpusRows,
  type PublicCorpusRow,
} from "./validate";

type Options = {
  fixture: string;
  reset: boolean;
  limit: number | null;
  batchBytes: number;
  concurrency: number;
  previewName: string | null;
};

export type SeedCorpusRow = PublicCorpusRow & {
  dummyOwner: DummyCorpusOwner;
};

// Keep the encoded Convex CLI argument below Linux's per-argument exec limit.
export const DEFAULT_BATCH_BYTES = 120_000;
export const DEFAULT_SEED_CONCURRENCY = 24;
export const MAX_CONVEX_RUN_ARG_BYTES = 130_000;
const MAX_SEED_BATCH_ATTEMPTS = 4;
const BASE_SEED_BATCH_RETRY_DELAY_MS = 500;

export type SeedBatchRunResult = {
  status: number;
  output: string;
};

export type SeedBatchRunOnce = (args: unknown) => SeedBatchRunResult | Promise<SeedBatchRunResult>;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.previewName) {
    assertPreviewSeedTargetAllowed();
  }
  const text = await readFile(options.fixture, "utf8");
  const rows = parseCorpusJsonl(text).slice(0, options.limit ?? undefined);
  const validation = validateCorpusRows(rows);
  if (!validation.ok) {
    console.error(
      JSON.stringify({ ok: false, findings: validation.findings.slice(0, 100) }, null, 2),
    );
    process.exit(1);
  }

  const owners = buildDummyOwnerPool();
  const seedRows = rows.map((row) =>
    buildSeedCorpusRow(row, ownerForCorpusKey(corpusKey(row), owners)),
  );
  const batches = chunkRowsByOwner(seedRows, options.batchBytes);
  await runSeedCorpusBatches(batches, {
    concurrency: options.concurrency,
    reset: options.reset,
    resetOwnerHandles: owners.map((owner) => owner.handle),
    runOnce: (batchArgs) => runConvexSeedBatchOnce(batchArgs, options.previewName),
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        fixture: options.fixture,
        seededRows: seedRows.length,
        batches: batches.length,
        reset: options.reset,
      },
      null,
      2,
    ),
  );
}

function parseArgs(args: string[]): Options {
  const options: Options = {
    fixture: DEFAULT_PUBLIC_CORPUS_FIXTURE,
    reset: false,
    limit: null,
    batchBytes: DEFAULT_BATCH_BYTES,
    concurrency: DEFAULT_SEED_CONCURRENCY,
    previewName: null,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--reset") {
      options.reset = true;
    } else if (arg === "--fixture") {
      options.fixture = readValue(args, ++index, arg);
    } else if (arg === "--limit") {
      options.limit = readPositiveInt(readValue(args, ++index, arg), arg);
    } else if (arg === "--batch-bytes") {
      options.batchBytes = readPositiveInt(readValue(args, ++index, arg), arg);
    } else if (arg === "--concurrency") {
      options.concurrency = readPositiveInt(readValue(args, ++index, arg), arg);
    } else if (arg === "--preview-name") {
      options.previewName = readValue(args, ++index, arg);
    } else if (arg.startsWith("--preview-name=")) {
      options.previewName = arg.slice("--preview-name=".length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

export function chunkRowsByOwner(rows: SeedCorpusRow[], maxBytes: number) {
  const byOwner = new Map<string, SeedCorpusRow[]>();
  for (const row of rows) {
    const ownerRows = byOwner.get(row.dummyOwner.handle) ?? [];
    ownerRows.push(row);
    byOwner.set(row.dummyOwner.handle, ownerRows);
  }

  return Array.from(byOwner.keys())
    .sort((left, right) => left.localeCompare(right))
    .flatMap((handle) => chunkRows(byOwner.get(handle) ?? [], maxBytes));
}

function chunkRows(rows: SeedCorpusRow[], maxBytes: number) {
  const batches: SeedCorpusRow[][] = [];
  let current: SeedCorpusRow[] = [];
  let currentBytes = 0;

  for (const row of rows) {
    const rowBytes = Buffer.byteLength(JSON.stringify(row)) + 2;
    if (current.length > 0 && currentBytes + rowBytes > maxBytes) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(row);
    currentBytes += rowBytes;
  }

  if (current.length > 0) batches.push(current);
  return batches;
}

function corpusKey(row: PublicCorpusRow) {
  return row.kind === "skill" ? `skill:${row.slug}` : `plugin:${row.name}`;
}

export function buildSeedCorpusRow(
  row: PublicCorpusRow,
  dummyOwner: DummyCorpusOwner,
): SeedCorpusRow {
  const {
    capabilityTags: _capabilityTags,
    executesCode: _executesCode,
    ...currentRow
  } = row as PublicCorpusRow & {
    capabilityTags?: unknown;
    executesCode?: unknown;
  };
  return {
    ...currentRow,
    dummyOwner,
  } as SeedCorpusRow;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function retryDelayMs(attempt: number) {
  return BASE_SEED_BATCH_RETRY_DELAY_MS * 2 ** (attempt - 1);
}

function writeCommandOutput(output: string) {
  if (output) process.stdout.write(output);
}

export function isRetryableConvexSeedBatchOutput(output: string) {
  return output.includes("Data read or written in this mutation changed while it was being run");
}

export async function runConvexSeedBatchOnce(
  args: unknown,
  previewName: string | null = null,
): Promise<SeedBatchRunResult> {
  const targetArgs = previewName ? ["--preview-name", previewName] : ["--no-push"];
  const serializedArgs = serializeConvexSeedArgs(args);
  const child = spawn(
    "bunx",
    ["convex", "run", ...targetArgs, "devSeed:seedPublicCorpusBatch", serializedArgs],
    {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    output += chunk;
  });

  return await new Promise<SeedBatchRunResult>((resolve) => {
    let settled = false;
    const finish = (status: number, errorOutput = "") => {
      if (settled) return;
      settled = true;
      output += errorOutput;
      writeCommandOutput(output);
      resolve({ status, output });
    };
    child.on("error", (error) => finish(1, `${error.message}\n`));
    child.on("close", (status) => finish(status ?? 1));
  });
}

export function serializeConvexSeedArgs(args: unknown) {
  const serialized = JSON.stringify(args);
  const bytes = Buffer.byteLength(serialized);
  if (bytes > MAX_CONVEX_RUN_ARG_BYTES) {
    throw new Error(
      `Public corpus batch argument is ${bytes} bytes; maximum is ${MAX_CONVEX_RUN_ARG_BYTES}`,
    );
  }
  return serialized;
}

export async function runConvexSeedBatchWithRetry(
  args: unknown,
  options: {
    runOnce?: SeedBatchRunOnce;
    sleep?: (ms: number) => Promise<void>;
    maxAttempts?: number;
    retryDelayMs?: (attempt: number) => number;
    log?: (message: string) => void;
  } = {},
) {
  const runOnce = options.runOnce ?? runConvexSeedBatchOnce;
  const sleepFn = options.sleep ?? sleep;
  const maxAttempts = Math.max(1, options.maxAttempts ?? MAX_SEED_BATCH_ATTEMPTS);
  const delayMs = options.retryDelayMs ?? retryDelayMs;
  const log = options.log ?? console.warn;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await runOnce(args);
    if (result.status === 0) return 0;
    if (!isRetryableConvexSeedBatchOutput(result.output) || attempt >= maxAttempts) {
      return result.status;
    }

    log(
      `Convex seed batch hit a retryable write conflict; retrying (${attempt + 1}/${maxAttempts}).`,
    );
    await sleepFn(delayMs(attempt));
  }

  return 1;
}

export async function runSeedCorpusBatches(
  batches: SeedCorpusRow[][],
  options: {
    concurrency: number;
    reset?: boolean;
    resetOwnerHandles?: string[];
    runOnce: SeedBatchRunOnce;
    log?: (message: string) => void;
  },
) {
  const entries = batches.map((rows, index) => ({
    index,
    ownerHandle: rows[0]?.dummyOwner.handle ?? "",
    rows,
  }));
  const totalBatches = entries.length;
  const log = options.log ?? console.log;

  const runEntry = async (entry: (typeof entries)[number], reset = false) => {
    const status = await runConvexSeedBatchWithRetry(
      {
        reset,
        resetOwnerHandles: reset ? (options.resetOwnerHandles ?? []) : [],
        rows: entry.rows,
      },
      { runOnce: options.runOnce },
    );
    if (status !== 0) {
      throw new Error(`Public corpus batch ${entry.index + 1}/${totalBatches} failed`);
    }
    log(
      `Seeded public corpus batch ${entry.index + 1}/${totalBatches} (${entry.rows.length} rows).`,
    );
  };

  const firstEntry = options.reset ? entries.shift() : undefined;
  if (firstEntry) await runEntry(firstEntry, true);

  const ownerQueues = new Map<string, typeof entries>();
  for (const entry of entries) {
    const queue = ownerQueues.get(entry.ownerHandle) ?? [];
    queue.push(entry);
    ownerQueues.set(entry.ownerHandle, queue);
  }

  const queues = Array.from(ownerQueues.values());
  let nextQueue = 0;
  let firstError: unknown;
  const workerCount = Math.min(options.concurrency, queues.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (!firstError) {
      const queue = queues[nextQueue++];
      if (!queue) return;
      try {
        for (const entry of queue) {
          if (firstError) return;
          await runEntry(entry);
        }
      } catch (error) {
        firstError ??= error;
        return;
      }
    }
  });
  await Promise.all(workers);
  if (firstError) throw firstError;
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

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
