#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DESKTOP_COMMANDS = new Set(["artifacts", "desktop", "screenshot", "webvnc"]);
const DESKTOP_FLAGS = new Set(["--browser", "--desktop", "--screenshot", "--webvnc"]);

export function normalizeCrabboxArgs(rawArgs = []) {
  const args = [...rawArgs];
  if (args[0] === "--") {
    args.shift();
  }
  if (args[0] === "actions" && args[1] === "hydrate" && args[2] === "--") {
    args.splice(2, 1);
  }
  return args;
}

export function selectCrabboxBinary({ exists = existsSync, repoRoot }) {
  const repoLocal = resolve(repoRoot, "../crabbox/bin/crabbox");
  return exists(repoLocal) ? repoLocal : "crabbox";
}

function commandAdvertised(help, command) {
  return new RegExp(`(?:^|\\n|\\s)${command}(?:\\s|$)`, "u").test(help);
}

export function inspectCrabboxCapabilities({ runHelp = "", topLevelHelp = "", versionText = "" }) {
  const providers = ["aws", "hetzner", "blacksmith-testbox"].filter((provider) =>
    runHelp.includes(provider),
  );
  return {
    commands: {
      artifacts: commandAdvertised(topLevelHelp, "artifacts"),
      desktop: commandAdvertised(topLevelHelp, "desktop"),
      screenshot: commandAdvertised(topLevelHelp, "screenshot"),
      webvnc: commandAdvertised(topLevelHelp, "webvnc"),
    },
    providers,
    runHelp,
    topLevelHelp,
    versionText: versionText.trim(),
  };
}

export function requiresDesktopSupport(args = []) {
  return args.some((arg) => DESKTOP_COMMANDS.has(arg) || DESKTOP_FLAGS.has(arg));
}

export function assertRequiredCrabboxCapabilities(capabilities, { requireDesktop }) {
  if (!capabilities.providers.includes("blacksmith-testbox")) {
    throw new Error(
      "selected Crabbox binary does not advertise provider blacksmith-testbox; refusing stale Crabbox binary",
    );
  }
  if (!requireDesktop) {
    return;
  }
  const missing = Object.entries(capabilities.commands)
    .filter(([, present]) => !present)
    .map(([command]) => command);
  if (missing.length > 0) {
    throw new Error(
      `selected Crabbox binary is missing desktop/artifacts support (${missing.join(", ")}); update the sibling Crabbox checkout or PATH binary`,
    );
  }
}

function checkedOutput(command, commandArgs, { cwd }) {
  const result = spawnSync(command, commandArgs, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: result.status ?? 1,
    text: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim(),
  };
}

export function runCrabboxWrapper({
  argv = process.argv.slice(2),
  cwd = dirname(fileURLToPath(import.meta.url)),
  spawnImpl = spawn,
} = {}) {
  const repoRoot = resolve(cwd, "..");
  const args = normalizeCrabboxArgs(argv);
  const binary = selectCrabboxBinary({ repoRoot });
  const displayBinary = binary === "crabbox" ? "crabbox" : relative(repoRoot, binary);
  const version = checkedOutput(binary, ["--version"], { cwd: repoRoot });
  const runHelp = checkedOutput(binary, ["run", "--help"], { cwd: repoRoot });
  const topLevelHelp = checkedOutput(binary, ["--help"], { cwd: repoRoot });

  console.error(
    `[crabbox] bin=${displayBinary} version=${version.text || "unknown"} providers=${
      inspectCrabboxCapabilities({
        runHelp: runHelp.text,
        topLevelHelp: topLevelHelp.text,
        versionText: version.text,
      }).providers.join(",") || "unknown"
    }`,
  );

  if (version.status !== 0 || runHelp.status !== 0 || topLevelHelp.status !== 0) {
    console.error("[crabbox] selected binary failed basic --version/--help sanity checks");
    return 2;
  }

  try {
    assertRequiredCrabboxCapabilities(
      inspectCrabboxCapabilities({
        runHelp: runHelp.text,
        topLevelHelp: topLevelHelp.text,
        versionText: version.text,
      }),
      { requireDesktop: requiresDesktopSupport(args) },
    );
  } catch (error) {
    console.error(`[crabbox] ${error.message}`);
    return 2;
  }

  const child = spawnImpl(binary, args, {
    cwd: repoRoot,
    stdio: "inherit",
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });

  child.on("error", (error) => {
    console.error(`[crabbox] failed to execute ${displayBinary}: ${error.message}`);
    process.exit(2);
  });
  return undefined;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const exitCode = runCrabboxWrapper();
  if (typeof exitCode === "number") {
    process.exitCode = exitCode;
  }
}
