#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { CLAWHUB_TEST_DEPLOYMENT } from "../seed-test";
import { validateSanitizedSnapshot } from "./validate-sanitized-snapshot";

export function parseImportTestSnapshotArgs(args: string[]) {
  let snapshot = "";
  let deployment = CLAWHUB_TEST_DEPLOYMENT;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--snapshot") snapshot = args[++index] ?? "";
    else if (arg.startsWith("--snapshot=")) snapshot = arg.slice("--snapshot=".length);
    else if (arg === "--deployment") deployment = args[++index] ?? "";
    else if (arg.startsWith("--deployment=")) deployment = arg.slice("--deployment=".length);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!snapshot) throw new Error("--snapshot is required");
  if (deployment !== CLAWHUB_TEST_DEPLOYMENT) {
    throw new Error(
      `Test snapshot imports may only target ${CLAWHUB_TEST_DEPLOYMENT}; received ${deployment}`,
    );
  }
  return { snapshot: resolve(snapshot), deployment };
}

export function buildImportTestSnapshotCommand(snapshot: string, deployment: string) {
  if (deployment !== CLAWHUB_TEST_DEPLOYMENT) {
    throw new Error(
      `Test snapshot imports may only target ${CLAWHUB_TEST_DEPLOYMENT}; received ${deployment}`,
    );
  }
  return {
    command: "bunx",
    args: ["convex", "import", "--deployment", deployment, "--replace-all", "-y", snapshot],
  };
}

async function main() {
  const options = parseImportTestSnapshotArgs(process.argv.slice(2));
  const validation = await validateSanitizedSnapshot(options.snapshot);
  console.log(JSON.stringify({ validated: true, ...validation }, null, 2));
  const step = buildImportTestSnapshotCommand(options.snapshot, options.deployment);
  const result = spawnSync(step.command, step.args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  process.exit(result.status ?? 1);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
