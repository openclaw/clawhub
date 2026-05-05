#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const DEFAULT_MODEL = "qwen3-embedding:4b";
const DEFAULT_BASE_URL = "http://localhost:11434";

const args = new Set(process.argv.slice(2));
const model = process.env.OLLAMA_EMBEDDING_MODEL?.trim() || DEFAULT_MODEL;
const baseUrl =
  process.env.OLLAMA_EMBEDDING_BASE_URL?.trim() ||
  process.env.OLLAMA_HOST?.trim() ||
  DEFAULT_BASE_URL;
const normalizedBaseUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(baseUrl) ? baseUrl : `http://${baseUrl}`;

function printHelp() {
  console.log(`Usage: bun run setup:local-embeddings [--no-convex-env]

Prepares local-development embeddings for ClawHub.

Environment overrides:
  OLLAMA_EMBEDDING_MODEL       default: ${DEFAULT_MODEL}
  OLLAMA_EMBEDDING_BASE_URL    default: ${DEFAULT_BASE_URL}

Options:
  --no-convex-env              Pull/check Ollama only; do not run convex env set
  --help                       Show this help
`);
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    stdio: options.stdio ?? "inherit",
    encoding: "utf8",
  });
  if (result.error?.code === "ENOENT") {
    throw new Error(`${command} was not found on PATH`);
  }
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${commandArgs.join(" ")} failed with exit code ${result.status}`);
  }
  return result;
}

function hasCommand(command) {
  const result = spawnSync(command, ["--version"], { stdio: "ignore" });
  return !result.error && result.status === 0;
}

async function checkOllamaServer() {
  const url = new URL("/api/version", normalizedBaseUrl);
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
    if (response.ok) return true;
  } catch {
    // Handled below with a setup-oriented warning.
  }
  console.warn(
    `Could not reach Ollama at ${normalizedBaseUrl}. Start the Ollama app or run "ollama serve" before seeding/publishing skills.`,
  );
  return false;
}

async function main() {
  if (args.has("--help") || args.has("-h")) {
    printHelp();
    return;
  }

  if (!hasCommand("ollama")) {
    throw new Error("Install Ollama first: https://ollama.com/download");
  }

  await checkOllamaServer();

  console.log(`Pulling Ollama embedding model: ${model}`);
  run("ollama", ["pull", model]);

  if (!args.has("--no-convex-env")) {
    console.log("Setting Convex local embedding environment variables...");
    run("bunx", ["convex", "env", "set", "EMBEDDING_PROVIDER", "ollama"]);
    run("bunx", ["convex", "env", "set", "OLLAMA_EMBEDDING_MODEL", model]);
    run("bunx", ["convex", "env", "set", "OLLAMA_EMBEDDING_BASE_URL", normalizedBaseUrl]);
  }

  console.log(`
Local embeddings are configured.

Next steps:
  1. Keep Ollama running.
  2. Reset/reseed sample skills so they get real vectors:
     bunx convex run --no-push devSeed:seedNixSkills '{"reset": true}'
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
