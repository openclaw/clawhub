#!/usr/bin/env bun
import { execFileSync } from "node:child_process";

type Options = {
  batchSize: number;
  pauseMs: number;
  maxBatches: number | null;
  dryRun: boolean;
  prod: boolean;
  deploymentName: string | null;
  previewName: string | null;
  envFile: string | null;
};

type BatchResult = {
  ok: true;
  scanned: number;
  normalizedUsers: number;
  syncedPublishers: number;
  skippedUsers: number;
  cursor: string | null;
  isDone: boolean;
  dryRun: boolean;
};

function printUsage() {
  console.log(`Usage:
  bun scripts/backfill-user-handles.ts --prod [--batch-size 100] [--pause-ms 250] [--max-batches 20] [--dry-run]
  bun scripts/backfill-user-handles.ts --deployment-name <name> [--batch-size 100]

Options:
  --batch-size <n>        Users per batch. Default: 100
  --pause-ms <n>          Delay between batches in ms. Default: 250
  --max-batches <n>       Stop after n batches even if more remain
  --dry-run               Report what would change without writing
  --prod                  Run against prod
  --deployment-name <n>   Run against a named deployment
  --preview-name <n>      Run against a preview deployment
  --env-file <path>       Custom env file for Convex CLI
  --help                  Show this help
`);
}

function requireValue(args: string[], index: number, flag: string) {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function parsePositiveInt(value: string, flag: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function parseNonNegativeInt(value: string, flag: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative integer`);
  }
  return parsed;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    batchSize: 100,
    pauseMs: 250,
    maxBatches: null,
    dryRun: false,
    prod: false,
    deploymentName: null,
    previewName: null,
    envFile: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--batch-size":
        options.batchSize = parsePositiveInt(requireValue(argv, index, arg), arg);
        index += 1;
        break;
      case "--pause-ms":
        options.pauseMs = parseNonNegativeInt(requireValue(argv, index, arg), arg);
        index += 1;
        break;
      case "--max-batches":
        options.maxBatches = parsePositiveInt(requireValue(argv, index, arg), arg);
        index += 1;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--prod":
        options.prod = true;
        break;
      case "--deployment-name":
        options.deploymentName = requireValue(argv, index, arg);
        index += 1;
        break;
      case "--preview-name":
        options.previewName = requireValue(argv, index, arg);
        index += 1;
        break;
      case "--env-file":
        options.envFile = requireValue(argv, index, arg);
        index += 1;
        break;
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  const deploymentFlags = [
    options.prod,
    Boolean(options.deploymentName),
    Boolean(options.previewName),
  ].filter(Boolean).length;
  if (deploymentFlags !== 1) {
    throw new Error(
      "Choose exactly one deployment target: --prod, --deployment-name, or --preview-name",
    );
  }

  return options;
}

function buildConvexArgs(options: Options, cursor: string | null) {
  const payload = {
    batchSize: options.batchSize,
    ...(cursor ? { cursor } : {}),
    ...(options.dryRun ? { dryRun: true } : {}),
  };

  const args = [
    "convex",
    "run",
    "users:backfillCanonicalHandlesInternal",
    JSON.stringify(payload),
    "--codegen",
    "disable",
    "--typecheck",
    "disable",
  ];

  if (options.prod) {
    args.push("--prod");
  } else if (options.deploymentName) {
    args.push("--deployment-name", options.deploymentName);
  } else if (options.previewName) {
    args.push("--preview-name", options.previewName);
  }

  if (options.envFile) {
    args.push("--env-file", options.envFile);
  }

  return args;
}

function runBatch(options: Options, cursor: string | null): BatchResult {
  try {
    const output = execFileSync("bunx", buildConvexArgs(options, cursor), {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    }).trim();

    return JSON.parse(output) as BatchResult;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to run users:backfillCanonicalHandlesInternal. Deploy/push the new Convex function first.\n${message}`,
    );
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  let cursor: string | null = null;
  let batches = 0;
  let totalScanned = 0;
  let totalNormalized = 0;
  let totalPublisherSyncs = 0;
  let totalSkipped = 0;

  console.log(
    `[backfill-user-handles] starting${options.dryRun ? " (dry-run)" : ""} with batchSize=${options.batchSize}`,
  );

  while (true) {
    if (options.maxBatches !== null && batches >= options.maxBatches) {
      console.log(
        `[backfill-user-handles] reached max batches (${options.maxBatches}), stopping early`,
      );
      break;
    }

    const result = runBatch(options, cursor);
    batches += 1;
    totalScanned += result.scanned;
    totalNormalized += result.normalizedUsers;
    totalPublisherSyncs += result.syncedPublishers;
    totalSkipped += result.skippedUsers;
    cursor = result.cursor;

    console.log(
      `[backfill-user-handles] batch=${batches} scanned=${result.scanned} normalized=${result.normalizedUsers} publishers=${result.syncedPublishers} skipped=${result.skippedUsers} done=${result.isDone}`,
    );

    if (result.isDone || result.cursor === null) {
      break;
    }

    if (options.pauseMs > 0) {
      await sleep(options.pauseMs);
    }
  }

  console.log(
    `[backfill-user-handles] complete batches=${batches} scanned=${totalScanned} normalized=${totalNormalized} publishers=${totalPublisherSyncs} skipped=${totalSkipped} remainingCursor=${cursor ?? "none"}`,
  );
}

try {
  await main();
} catch (error) {
  console.error(
    `[backfill-user-handles] ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
