#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
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
};

type SeedCorpusRow = PublicCorpusRow & {
  dummyOwner: DummyCorpusOwner;
};

const DEFAULT_BATCH_BYTES = 96_000;
const MAX_SEED_BATCH_ATTEMPTS = 4;
const BASE_SEED_BATCH_RETRY_DELAY_MS = 500;

export type SeedBatchRunResult = {
  status: number;
  output: string;
};

export type SeedBatchRunOnce = (args: unknown) => SeedBatchRunResult;

async function main() {
  const options = parseArgs(process.argv.slice(2));
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
  const seedRows = rows.map((row) => ({
    ...row,
    dummyOwner: ownerForCorpusKey(corpusKey(row), owners),
  }));
  const batches = chunkRowsByOwner(seedRows, options.batchBytes);

  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index]!;
    const args = {
      reset: options.reset && index === 0,
      resetOwnerHandles: options.reset ? owners.map((owner) => owner.handle) : [],
      rows: batch,
    };
    const status = await runConvexSeedBatchWithRetry(args);
    if (status !== 0) process.exit(status);
    console.log(
      `Seeded public corpus batch ${index + 1}/${batches.length} (${batch.length} rows).`,
    );
  }

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
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function chunkRowsByOwner(rows: SeedCorpusRow[], maxBytes: number) {
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
    const rowBytes = JSON.stringify(row).length + 2;
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

export function runConvexSeedBatchOnce(args: unknown): SeedBatchRunResult {
  const result = spawnSync(
    "bunx",
    ["convex", "run", "--no-push", "devSeed:seedPublicCorpusBatch", JSON.stringify(args)],
    {
      cwd: process.cwd(),
      encoding: "utf8",
    },
  );
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}${
    result.error ? `${result.error.message}\n` : ""
  }`;
  writeCommandOutput(output);
  return { status: result.status ?? 1, output };
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
    const result = runOnce(args);
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
