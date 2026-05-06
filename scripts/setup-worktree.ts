#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { basename, resolve } from "node:path";

type Options = {
  from: string | null;
  force: boolean;
  quiet: boolean;
};

type Source = {
  path: string;
  env: Record<string, string>;
  convexConfig: { deploymentName?: string; ports?: { cloud?: number } } | null;
};

const LOCAL_CONVEX_CONFIG = ".convex/local/default/config.json";

function parseArgs(argv: string[]): Options {
  const options: Options = {
    from: process.env.CLAWHUB_WORKTREE_SOURCE ?? null,
    force: false,
    quiet: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--from") {
      options.from = argv[index + 1] ?? options.from;
      index += 1;
    } else if (arg.startsWith("--from=")) {
      options.from = arg.slice("--from=".length);
    } else if (arg === "--force") {
      options.force = true;
    } else if (arg === "--quiet") {
      options.quiet = true;
    }
  }

  return options;
}

function parseEnv(text: string) {
  const env: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[match[1]] = value.replace(/\s+#.*$/, "");
  }
  return env;
}

function listGitWorktrees() {
  const result = spawnSync("git", ["worktree", "list", "--porcelain"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (result.status !== 0 || typeof result.stdout !== "string") return [];
  return result.stdout
    .split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => resolve(line.slice("worktree ".length).trim()))
    .filter(Boolean);
}

function readSource(path: string): Source | null {
  const envPath = resolve(path, ".env.local");
  if (!existsSync(envPath)) return null;

  const configPath = resolve(path, LOCAL_CONVEX_CONFIG);
  const convexConfig = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf8")) : null;

  return {
    path,
    env: parseEnv(readFileSync(envPath, "utf8")),
    convexConfig,
  };
}

function validateSource(source: Source) {
  const deployment = source.env.CONVEX_DEPLOYMENT;
  if (!deployment) return "missing CONVEX_DEPLOYMENT";

  if (deployment.startsWith("local:")) {
    if (!source.convexConfig) return `missing ${LOCAL_CONVEX_CONFIG}`;
    const expected = deployment.slice("local:".length);
    if (source.convexConfig.deploymentName !== expected) {
      return `CONVEX_DEPLOYMENT=${deployment} does not match ${LOCAL_CONVEX_CONFIG} deploymentName=${source.convexConfig.deploymentName}`;
    }

    const convexUrl = source.env.VITE_CONVEX_URL;
    const configPort = source.convexConfig.ports?.cloud;
    if (convexUrl && configPort) {
      try {
        const urlPort = Number(new URL(convexUrl).port);
        if (urlPort && urlPort !== configPort) {
          return `VITE_CONVEX_URL port ${urlPort} does not match ${LOCAL_CONVEX_CONFIG} cloud port ${configPort}`;
        }
      } catch {
        return "VITE_CONVEX_URL is not a valid URL";
      }
    }
  }

  return null;
}

export function findSource(options: Options, cwd = process.cwd()) {
  const currentPath = resolve(cwd);
  if (!options.from) {
    const current = readSource(currentPath);
    if (current && !validateSource(current)) return current;
  }

  const candidates = options.from
    ? [resolve(options.from)]
    : listGitWorktrees().filter((worktree) => worktree !== currentPath);

  const rejected: string[] = [];
  for (const candidate of candidates) {
    const source = readSource(candidate);
    if (!source) continue;
    const invalid = validateSource(source);
    if (!invalid) return source;
    rejected.push(`${candidate}: ${invalid}`);
  }

  const suffix = rejected.length ? `\nRejected sources:\n- ${rejected.join("\n- ")}` : "";
  throw new Error(
    `Could not find a usable worktree source with .env.local and matching Convex local config.${suffix}`,
  );
}

function replaceableLocal(path: string) {
  if (!existsSync(path)) return true;
  return lstatSync(path).isSymbolicLink();
}

function linkFromSource(name: string, sourcePath: string, force: boolean) {
  const target = resolve(process.cwd(), name);
  if (resolve(sourcePath) === target) return false;
  if (existsSync(target)) {
    if (!force && !replaceableLocal(target)) {
      throw new Error(
        `${name} already exists as a regular local path. Move it aside or rerun setup with --force.`,
      );
    }
    rmSync(target, { force: true, recursive: true });
  }
  symlinkSync(sourcePath, target, basename(sourcePath) === ".convex" ? "dir" : "file");
  return true;
}

function copyOnWriteDirectory(name: string, sourceRoot: string, quiet: boolean) {
  const target = resolve(process.cwd(), name);
  if (existsSync(target)) return;

  const source = resolve(sourceRoot, name);
  if (!existsSync(source)) return;

  const cpArgs = process.platform === "darwin" ? ["-cR", source, target] : ["-a", source, target];
  const result = spawnSync("cp", cpArgs, { stdio: quiet ? "ignore" : "inherit" });
  if (result.status !== 0) {
    if (!quiet) console.log(`Copy-on-write clone failed for ${name}; running bun install instead.`);
    spawnSync("bun", ["install"], { stdio: "inherit" });
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const source = findSource(options);

  linkFromSource(".env.local", resolve(source.path, ".env.local"), options.force);
  linkFromSource(".convex", resolve(source.path, ".convex"), options.force);
  copyOnWriteDirectory("node_modules", source.path, options.quiet);

  if (!existsSync("node_modules/.bin/vite")) {
    if (!options.quiet) console.log("Installing dependencies for this worktree...");
    const result = spawnSync("bun", ["install"], { stdio: "inherit" });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }

  if (!options.quiet) {
    console.log(`Worktree setup complete using ${source.path}`);
  }
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
