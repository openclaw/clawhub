#!/usr/bin/env bun
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

type Options = {
  port: string;
  envFile: string | null;
  seed: boolean;
  seedOnly: boolean;
};

const DEFAULT_ENV_SOURCES = [".env.local"];
const CONVEX_START_TIMEOUT_MS = 120_000;
const CONVEX_FUNCTIONS_READY_TIMEOUT_MS = 120_000;
const REACHABILITY_POLL_MS = 500;
const managedChildren = new Set<ChildProcess>();

function parseArgs(argv: string[]): Options {
  const options: Options = {
    port: "3000",
    envFile: process.env.CLAWHUB_ENV_FILE ?? null,
    seed: false,
    seedOnly: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--seed") {
      options.seed = true;
    } else if (arg === "--seed-only") {
      options.seed = true;
      options.seedOnly = true;
    } else if (arg === "--port") {
      options.port = argv[index + 1] ?? options.port;
      index += 1;
    } else if (arg.startsWith("--port=")) {
      options.port = arg.slice("--port=".length);
    } else if (arg === "--env-file") {
      options.envFile = argv[index + 1] ?? options.envFile;
      index += 1;
    } else if (arg.startsWith("--env-file=")) {
      options.envFile = arg.slice("--env-file=".length);
    }
  }

  return options;
}

export function parseGitWorktreeList(text: string) {
  return text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length).trim())
    .filter(Boolean);
}

function listGitWorktrees() {
  const result = spawnSync("git", ["worktree", "list", "--porcelain"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (result.status !== 0 || typeof result.stdout !== "string") return [];
  return parseGitWorktreeList(result.stdout);
}

export function buildEnvFileCandidates(options: {
  explicit: string | null;
  cwd: string;
  worktrees?: string[];
}) {
  if (options.explicit) return [options.explicit];
  const primaryWorktree = options.worktrees?.[0];
  return [
    ...DEFAULT_ENV_SOURCES,
    ...(primaryWorktree && resolve(primaryWorktree) !== resolve(options.cwd)
      ? [`${primaryWorktree}/.env.local`]
      : []),
  ];
}

function findEnvFile(explicit: string | null) {
  const candidates = buildEnvFileCandidates({
    explicit,
    cwd: process.cwd(),
    worktrees: explicit ? [] : listGitWorktrees(),
  });
  return candidates
    .map((candidate) => resolve(candidate))
    .find((candidate) => existsSync(candidate));
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

export function parseEnv(text: string) {
  const env: Record<string, string> = {};
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
    env[key] = value;
  }
  return env;
}

async function loadEnv(envFile: string) {
  const parsed = parseEnv(await readFile(envFile, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    process.env[key] = value;
  }
  return parsed;
}

async function isReachable(url: string) {
  try {
    const response = await fetch(url, { method: "GET" });
    return response.status < 500;
  } catch {
    return false;
  }
}

function runSync(command: string, args: string[], extraEnv: Record<string, string | undefined>) {
  return (
    spawnSync(command, args, {
      cwd: process.cwd(),
      env: { ...process.env, ...extraEnv },
      stdio: "inherit",
    }).status ?? 1
  );
}

function runSyncBuffered(
  command: string,
  args: string[],
  extraEnv: Record<string, string | undefined>,
) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, ...extraEnv },
  });

  return {
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    status: result.status ?? 1,
  };
}

function writeBufferedOutput(output: string) {
  if (output) process.stdout.write(output);
}

export function isConvexFunctionUnavailableOutput(output: string) {
  return (
    output.includes("Could not find function for") &&
    output.includes("Did you forget to run `npx convex dev`")
  );
}

async function runConvexFunctionWhenReady(args: string[]) {
  const startedAt = Date.now();

  while (true) {
    const result = runSyncBuffered("bunx", args, {});
    if (result.status === 0) {
      writeBufferedOutput(result.output);
      return 0;
    }

    if (
      !isConvexFunctionUnavailableOutput(result.output) ||
      Date.now() - startedAt >= CONVEX_FUNCTIONS_READY_TIMEOUT_MS
    ) {
      writeBufferedOutput(result.output);
      return result.status;
    }

    console.log("Convex functions are not queryable yet; retrying...");
    await sleep(REACHABILITY_POLL_MS);
  }
}

function spawnManaged(command: string, args: string[]) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  managedChildren.add(child);
  child.once("exit", () => managedChildren.delete(child));
  return child;
}

function stopManagedChildren() {
  for (const child of managedChildren) {
    if (!child.killed) child.kill("SIGTERM");
  }
}

function waitForExit(child: ChildProcess) {
  return new Promise<number>((resolve) => {
    child.once("exit", (code, signal) => {
      if (typeof code === "number") {
        resolve(code);
      } else {
        resolve(signal === "SIGINT" ? 130 : 1);
      }
    });
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntilReachable(url: string, timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isReachable(url)) return true;
    await sleep(REACHABILITY_POLL_MS);
  }
  return false;
}

async function ensureConvex(convexUrl: string) {
  if (await isReachable(convexUrl)) return;

  console.log(`Convex is not reachable at ${convexUrl}.`);
  console.log("Starting local Convex with: bunx convex dev --typecheck=disable");
  const convex = spawnManaged("bunx", ["convex", "dev", "--typecheck=disable"]);

  if (!(await waitUntilReachable(convexUrl, CONVEX_START_TIMEOUT_MS))) {
    stopManagedChildren();
    console.error(`Convex did not become reachable at ${convexUrl}.`);
    console.error("If Convex is prompting for setup, finish that setup and rerun this command.");
    process.exit(await waitForExit(convex));
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    stopManagedChildren();
    process.exit(signal === "SIGINT" ? 130 : 143);
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const envFile = findEnvFile(options.envFile);
  if (!envFile) {
    console.error(
      "Could not find .env.local in this checkout or the primary git worktree. Pass --env-file <path> or set CLAWHUB_ENV_FILE to a shared local env file.",
    );
    process.exit(1);
  }

  await loadEnv(envFile);

  const convexUrl = process.env.VITE_CONVEX_URL;
  if (!convexUrl) {
    console.error(`${basename(envFile)} is missing VITE_CONVEX_URL.`);
    process.exit(1);
  }

  if (!existsSync("node_modules/.bin/vite")) {
    console.log("Installing dependencies for this worktree...");
    const installStatus = runSync("bun", ["install"], {});
    if (installStatus !== 0) process.exit(installStatus);
  }

  await ensureConvex(convexUrl);

  if (options.seed) {
    console.log("Seeding sample skills...");
    const seedStatus = await runConvexFunctionWhenReady([
      "convex",
      "run",
      "--no-push",
      "devSeed:seedNixSkills",
    ]);
    if (seedStatus !== 0) process.exit(seedStatus);

    const statsStatus = await runConvexFunctionWhenReady([
      "convex",
      "run",
      "--no-push",
      "statsMaintenance:updateGlobalStatsAction",
    ]);
    if (statsStatus !== 0) process.exit(statsStatus);
  }

  if (options.seedOnly) {
    stopManagedChildren();
    return;
  }

  console.log(`Starting ClawHub from ${process.cwd()}`);
  console.log(`Using env file: ${envFile}`);
  const vite = spawnManaged("bun", ["--bun", "vite", "dev", "--port", options.port]);
  process.exit(await waitForExit(vite));
}

if (import.meta.main) {
  await main();
}
