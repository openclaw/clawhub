#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isCodexWorkerExecutionAllowed, localCodexWorkerOptInReason } from "./codex-worker-guard";

type DevWorkerId = "security-scan" | "skill-card";

type WorkerDefinition = {
  id: DevWorkerId;
  label: string;
  script: string;
  requiredEnv: string[];
  requiredAnyEnv?: string[];
  requiresCodexCli: boolean;
  productionWorkflow: string;
};

export type DevWorkerOptions = {
  batchLimit: number;
  envFile: string | null;
  intervalMs: number;
  leaseMinutes: number;
  maxJobs: number;
  maxRuntimeMinutes: number;
  nvidiaToolDir: string | null;
  once: boolean;
  skip: string[];
  workers: string[];
};

export const WORKERS: WorkerDefinition[] = [
  {
    id: "security-scan",
    label: "Security scan",
    script: "scripts/security/run-codex-scan-worker.ts",
    // Shared Convex worker credential used by security and Skill Card workers.
    requiredEnv: ["CONVEX_URL", "SECURITY_SCAN_WORKER_TOKEN"],
    requiresCodexCli: true,
    productionWorkflow: ".github/workflows/security-scan-codex.yml",
  },
  {
    id: "skill-card",
    label: "Skill Card",
    script: "scripts/skill-cards/run-skill-card-worker.ts",
    // Shared Convex worker credential used by security and Skill Card workers.
    requiredEnv: ["CONVEX_URL", "SECURITY_SCAN_WORKER_TOKEN"],
    requiresCodexCli: true,
    productionWorkflow: ".github/workflows/skill-card-worker.yml",
  },
];

const DEFAULT_INTERVAL_MS = 5_000;
const DEFAULT_BATCH_LIMIT = 1;
const DEFAULT_MAX_JOBS = 1;
const DEFAULT_MAX_RUNTIME_MINUTES = 20;
const DEFAULT_LEASE_MINUTES = 30;
const DEFAULT_NVIDIA_TOOL_DIR = ".artifacts/nvidia-trustworthy-ai";
const NVIDIA_AUTOMATION_DIR = "AI Transparency Card Automation";

function numberFrom(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getArg(args: string[], name: string) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function hasArg(args: string[], name: string) {
  return args.includes(name);
}

function csv(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function parseArgs(args: string[]): DevWorkerOptions {
  return {
    batchLimit: numberFrom(getArg(args, "--batch-limit"), DEFAULT_BATCH_LIMIT),
    envFile: getArg(args, "--env-file") ?? process.env.CLAWHUB_ENV_FILE ?? null,
    intervalMs: numberFrom(getArg(args, "--interval-ms"), DEFAULT_INTERVAL_MS),
    leaseMinutes: numberFrom(getArg(args, "--lease-minutes"), DEFAULT_LEASE_MINUTES),
    maxJobs: numberFrom(getArg(args, "--max-jobs"), DEFAULT_MAX_JOBS),
    maxRuntimeMinutes: numberFrom(
      getArg(args, "--max-runtime-minutes"),
      DEFAULT_MAX_RUNTIME_MINUTES,
    ),
    nvidiaToolDir: getArg(args, "--nvidia-tool-dir") ?? null,
    once: hasArg(args, "--once"),
    skip: csv(getArg(args, "--skip")),
    workers: csv(getArg(args, "--workers")),
  };
}

function stripInlineComment(value: string) {
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const previous = value[index - 1];
    if ((char === '"' || char === "'") && previous !== "\\") {
      quote = quote === char ? null : (quote ?? char);
      continue;
    }
    if (char === "#" && quote === null && (index === 0 || /\s/.test(previous ?? ""))) {
      return value.slice(0, index).trimEnd();
    }
  }
  return value;
}

function parseEnv(text: string) {
  const parsed: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    let value = stripInlineComment(rawValue.trim());
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
}

function resolveEnvFile(cwd: string, explicit: string | null) {
  if (explicit) return resolve(cwd, explicit);
  const local = resolve(cwd, ".env.local");
  return existsSync(local) ? local : null;
}

export async function loadDevWorkerEnv(options: {
  cwd: string;
  env: NodeJS.ProcessEnv;
  envFile?: string | null;
}) {
  const envFile = resolveEnvFile(options.cwd, options.envFile ?? null);
  const loaded: string[] = [];
  if (!envFile) {
    if (!options.env.CONVEX_URL && options.env.VITE_CONVEX_URL) {
      options.env.CONVEX_URL = options.env.VITE_CONVEX_URL;
      loaded.push("CONVEX_URL");
    }
    return { envFile: null, loaded };
  }

  const parsed = parseEnv(await readFile(envFile, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (options.env[key] !== undefined) continue;
    options.env[key] = value;
    loaded.push(key);
  }
  if (!options.env.CONVEX_URL && options.env.VITE_CONVEX_URL) {
    options.env.CONVEX_URL = options.env.VITE_CONVEX_URL;
    loaded.push("CONVEX_URL");
  }
  return { envFile, loaded };
}

export function resolveEnabledWorkers(options: { workers: string[]; skip: string[] }) {
  const known = new Map(WORKERS.map((worker) => [worker.id, worker]));
  const requested =
    options.workers.length > 0 ? options.workers : WORKERS.map((worker) => worker.id);
  for (const id of [...requested, ...options.skip]) {
    if (!known.has(id as DevWorkerId)) throw new Error(`Unknown worker: ${id}`);
  }
  const skipped = new Set(options.skip);
  return requested
    .map((id) => known.get(id as DevWorkerId)!)
    .filter((worker) => !skipped.has(worker.id));
}

function resolveNvidiaToolDir(
  options: Pick<DevWorkerOptions, "nvidiaToolDir">,
  context: { cwd: string; env: NodeJS.ProcessEnv },
) {
  return resolve(
    context.cwd,
    options.nvidiaToolDir ?? context.env.NVIDIA_TRUSTWORTHY_AI_DIR ?? DEFAULT_NVIDIA_TOOL_DIR,
  );
}

function hasNvidiaSkillCardTooling(
  options: Pick<DevWorkerOptions, "nvidiaToolDir">,
  context: { cwd: string; env: NodeJS.ProcessEnv },
) {
  const toolDir = resolveNvidiaToolDir(options, context);
  return existsSync(join(toolDir, NVIDIA_AUTOMATION_DIR, "scripts", "render_card.py"));
}

export function resolveRunnableWorkers(
  workers: WorkerDefinition[],
  options: Pick<DevWorkerOptions, "nvidiaToolDir">,
  context: { cwd: string; env: NodeJS.ProcessEnv },
) {
  const runnable: WorkerDefinition[] = [];
  const skipped: Array<{ workerId: DevWorkerId; reason: string }> = [];
  for (const worker of workers) {
    if (worker.requiresCodexCli && !isCodexWorkerExecutionAllowed(context.env)) {
      skipped.push({
        workerId: worker.id,
        reason: localCodexWorkerOptInReason(),
      });
      continue;
    }
    if (worker.id !== "skill-card" || hasNvidiaSkillCardTooling(options, context)) {
      runnable.push(worker);
      continue;
    }
    skipped.push({
      workerId: worker.id,
      reason: `NVIDIA Skill Card automation checkout not found at ${resolveNvidiaToolDir(
        options,
        context,
      )}`,
    });
  }
  return { workers: runnable, skipped };
}

export function validateWorkerEnv(worker: WorkerDefinition, env: NodeJS.ProcessEnv) {
  const missing = worker.requiredEnv.filter((key) => !env[key]?.trim());
  if (worker.requiredAnyEnv && !worker.requiredAnyEnv.some((key) => Boolean(env[key]?.trim()))) {
    missing.push(worker.requiredAnyEnv.join(" or "));
  }
  return missing;
}

export function buildWorkerRun(
  worker: WorkerDefinition,
  options: Pick<
    DevWorkerOptions,
    "batchLimit" | "leaseMinutes" | "maxJobs" | "maxRuntimeMinutes" | "nvidiaToolDir"
  >,
) {
  const args = [
    worker.script,
    "--batch-limit",
    String(options.batchLimit),
    "--max-jobs",
    String(options.maxJobs),
    "--max-runtime-minutes",
    String(options.maxRuntimeMinutes),
    "--lease-minutes",
    String(options.leaseMinutes),
  ];
  if (worker.id === "skill-card" && options.nvidiaToolDir) {
    args.push("--nvidia-tool-dir", options.nvidiaToolDir);
  }
  return { command: "bun", args };
}

function sleep(ms: number) {
  return new Promise((done) => setTimeout(done, ms));
}

function timestamp() {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

async function runWorker(worker: WorkerDefinition, options: DevWorkerOptions) {
  const run = buildWorkerRun(worker, options);
  console.log(`[${timestamp()}] ${worker.id}: ${run.command} ${run.args.join(" ")}`);
  return await new Promise<number>((resolvePromise) => {
    const child = spawn(run.command, run.args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });
    child.once("error", (error) => {
      console.error(`[${timestamp()}] ${worker.id}: failed to start: ${error.message}`);
      resolvePromise(1);
    });
    child.once("exit", (code, signal) => {
      if (typeof code === "number") resolvePromise(code);
      else resolvePromise(signal === "SIGINT" ? 130 : 1);
    });
  });
}

function printUsageError(message: string): never {
  console.error(message);
  console.error("");
  console.error("Usage: bun run dev:workers -- [options]");
  console.error("  --once                         Run one polling pass and exit");
  console.error("  --workers security-scan,skill-card");
  console.error("  --skip skill-card");
  console.error("  --interval-ms 15000");
  console.error("  --env-file .env.local");
  console.error("  --batch-limit 1 --max-jobs 1 --max-runtime-minutes 20");
  process.exit(1);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  let workers: WorkerDefinition[];
  try {
    workers = resolveEnabledWorkers(options);
  } catch (error) {
    printUsageError(error instanceof Error ? error.message : String(error));
  }
  const { envFile } = await loadDevWorkerEnv({
    cwd: process.cwd(),
    env: process.env,
    envFile: options.envFile,
  });
  if (envFile) {
    console.log(`Loaded environment from ${basename(envFile)}.`);
  } else {
    console.log("No .env.local found; using shell environment only.");
  }

  const runnable = resolveRunnableWorkers(workers, options, {
    cwd: process.cwd(),
    env: process.env,
  });
  workers = runnable.workers;
  for (const skipped of runnable.skipped) {
    console.log(`Skipping ${skipped.workerId}: ${skipped.reason}.`);
  }
  if (workers.length === 0) {
    console.log("No runnable local background workers.");
    return;
  }

  const missingByWorker = workers
    .map((worker) => ({ worker, missing: validateWorkerEnv(worker, process.env) }))
    .filter((entry) => entry.missing.length > 0);
  if (missingByWorker.length > 0) {
    for (const { worker, missing } of missingByWorker) {
      console.error(`${worker.id} is missing: ${missing.join(", ")}`);
      console.error(`Production workflow: ${worker.productionWorkflow}`);
    }
    console.error("");
    console.error(
      "Set the missing values in your shell or .env.local. For local Convex, the token must match the Convex env value.",
    );
    process.exit(1);
  }

  console.log(
    `Starting local background workers: ${workers.map((worker) => worker.id).join(", ")}`,
  );
  console.log(`Polling every ${options.intervalMs}ms${options.once ? " (once)" : ""}.`);

  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      stopping = true;
    });
  }

  while (true) {
    for (const worker of workers) {
      if (stopping) break;
      const status = await runWorker(worker, options);
      if (status !== 0) {
        console.error(`[${timestamp()}] ${worker.id}: exited with status ${status}`);
      }
    }
    if (options.once || stopping) break;
    await sleep(options.intervalMs);
  }

  console.log("Stopped local background workers.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
