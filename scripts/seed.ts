#!/usr/bin/env bun

import { spawnSync } from "node:child_process";

type SeedOptions = {
  previewName: string | null;
};

type SeedStep = {
  command: string;
  args: string[];
};

const CONVEX_FUNCTIONS_READY_TIMEOUT_MS = 120_000;
const REACHABILITY_POLL_MS = 500;

export function parseSeedArgs(args: string[]): SeedOptions {
  const options: SeedOptions = { previewName: null };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--preview-name") {
      options.previewName = readValue(args, ++index, arg);
    } else if (arg.startsWith("--preview-name=")) {
      options.previewName = arg.slice("--preview-name=".length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

export function buildSeedSteps(options: SeedOptions): SeedStep[] {
  const convexTargetArgs = options.previewName
    ? ["--preview-name", options.previewName]
    : ["--no-push"];
  const corpusTargetArgs = options.previewName ? ["--preview-name", options.previewName] : [];

  return [
    {
      command: "bunx",
      args: ["convex", "run", ...convexTargetArgs, "devSeed:seedLocalFixtures"],
    },
    {
      command: "bun",
      args: ["scripts/public-corpus/seed-public-corpus.ts", ...corpusTargetArgs],
    },
    {
      command: "bun",
      args: ["scripts/public-corpus/seed-catalog-presentation.ts", ...corpusTargetArgs],
    },
    {
      command: "bunx",
      args: ["convex", "run", ...convexTargetArgs, "statsMaintenance:updateGlobalStatsAction"],
    },
  ];
}

export function isConvexFunctionUnavailableOutput(output: string) {
  return (
    output.includes("Could not find function for") &&
    output.includes("Did you forget to run `npx convex dev`")
  );
}

export function assertSeedTargetAllowed(
  options: SeedOptions,
  env: NodeJS.ProcessEnv = process.env,
) {
  if (options.previewName) {
    assertPreviewSeedTargetAllowed(env);
    return;
  }

  const deployment = env.CONVEX_DEPLOYMENT?.trim();
  if (
    deployment === "anonymous-agent" ||
    deployment?.startsWith("anonymous:") ||
    deployment?.startsWith("local:")
  ) {
    return;
  }
  throw new Error("Shared seed without --deployment requires a local Convex deployment");
}

export function assertPreviewSeedTargetAllowed(env: NodeJS.ProcessEnv = process.env) {
  if (!env.CONVEX_DEPLOY_KEY?.trim().startsWith("preview:")) {
    throw new Error("Shared preview seed requires a Convex Preview deploy key");
  }
}

async function runStep(step: SeedStep) {
  if (step.command !== "bunx" || step.args[0] !== "convex" || step.args[1] !== "run") {
    return (
      spawnSync(step.command, step.args, {
        cwd: process.cwd(),
        env: process.env,
        stdio: "inherit",
      }).status ?? 1
    );
  }

  const startedAt = Date.now();
  while (true) {
    const result = spawnSync(step.command, step.args, {
      cwd: process.cwd(),
      encoding: "utf8",
      env: process.env,
    });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (result.status === 0) {
      if (output) process.stdout.write(output);
      return 0;
    }
    if (
      !isConvexFunctionUnavailableOutput(output) ||
      Date.now() - startedAt >= CONVEX_FUNCTIONS_READY_TIMEOUT_MS
    ) {
      if (output) process.stdout.write(output);
      return result.status ?? 1;
    }
    console.log("Convex functions are not queryable yet; retrying...");
    await sleep(REACHABILITY_POLL_MS);
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function readValue(args: string[], index: number, flag: string) {
  const value = args[index]?.trim();
  if (!value) throw new Error(`Missing value for ${flag}`);
  return value;
}

async function main() {
  const options = parseSeedArgs(process.argv.slice(2));
  assertSeedTargetAllowed(options);
  for (const step of buildSeedSteps(options)) {
    const status = await runStep(step);
    if (status !== 0) process.exit(status);
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
