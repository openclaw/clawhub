#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAWHUB_ROOT = resolve(HERE, "..");
const OPENCLAW_REPO_PATH = process.env.OPENCLAW_REPO_PATH
  ? resolve(process.env.OPENCLAW_REPO_PATH)
  : resolve(CLAWHUB_ROOT, "..", "openclaw");
const PREVIEW_ROOT = resolve(CLAWHUB_ROOT, ".cache", "openclaw-docs-preview");

function run(command: string, args: string[], options: { cwd?: string } = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? CLAWHUB_ROOT,
    env: process.env,
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function capture(command: string, args: string[], cwd: string) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
  return result.stdout.trim();
}

function assertOpenClawRepo(path: string) {
  const syncScript = resolve(path, "scripts", "docs-sync-publish.mjs");
  if (!existsSync(syncScript)) {
    console.error(
      [
        `OpenClaw docs sync script was not found at ${syncScript}.`,
        "",
        "Set OPENCLAW_REPO_PATH to your OpenClaw checkout, for example:",
        "  OPENCLAW_REPO_PATH=/path/to/openclaw bun run docs:run",
      ].join("\n"),
    );
    process.exit(1);
  }
  return syncScript;
}

const syncScript = assertOpenClawRepo(OPENCLAW_REPO_PATH);
mkdirSync(PREVIEW_ROOT, { recursive: true });

const openClawSha = capture("git", ["rev-parse", "HEAD"], OPENCLAW_REPO_PATH);
const clawHubSha = capture("git", ["rev-parse", "HEAD"], CLAWHUB_ROOT);

console.log(`Syncing ClawHub docs into OpenClaw docs preview`);
console.log(`  OpenClaw: ${OPENCLAW_REPO_PATH}`);
console.log(`  ClawHub:  ${CLAWHUB_ROOT}`);
console.log(`  Preview:  ${PREVIEW_ROOT}`);

run("node", [
  syncScript,
  "--target",
  PREVIEW_ROOT,
  "--source-repo",
  "openclaw/openclaw",
  "--source-sha",
  openClawSha,
  "--clawhub-repo",
  CLAWHUB_ROOT,
  "--clawhub-source-repo",
  "openclaw/clawhub",
  "--clawhub-source-sha",
  clawHubSha,
]);

console.log("");
console.log("Starting Mintlify docs preview. Open the printed local URL, then go to /clawhub.");
run("mint", ["dev"], { cwd: resolve(PREVIEW_ROOT, "docs") });
