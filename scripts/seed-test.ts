#!/usr/bin/env bun
import { spawnSync } from "node:child_process";

export const CLAWHUB_TEST_DEPLOYMENT = "academic-chihuahua-392";

export function parseSeedTestArgs(args: string[]) {
  let deployment = CLAWHUB_TEST_DEPLOYMENT;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--deployment") {
      deployment = args[++index] ?? "";
    } else if (arg.startsWith("--deployment=")) {
      deployment = arg.slice("--deployment=".length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!deployment) throw new Error("--deployment requires a value");
  return { deployment };
}

export function assertSeedTestTarget(deployment: string) {
  if (deployment !== CLAWHUB_TEST_DEPLOYMENT) {
    throw new Error(`seed:test may only target ${CLAWHUB_TEST_DEPLOYMENT}; received ${deployment}`);
  }
}

export function buildSeedTestCommands(deployment: string) {
  assertSeedTestTarget(deployment);
  const target = ["convex", "run", "--deployment", deployment, "--no-push"];
  return [
    {
      command: "bunx",
      args: [...target, "devSeed:seedTestFixtures"],
    },
    {
      command: "bunx",
      args: [...target, "statsMaintenance:updateGlobalStatsAction"],
    },
  ];
}

async function main() {
  const options = parseSeedTestArgs(process.argv.slice(2));
  for (const step of buildSeedTestCommands(options.deployment)) {
    const result = spawnSync(step.command, step.args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
