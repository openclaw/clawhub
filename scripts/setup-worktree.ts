#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { basename, resolve } from "node:path";

type Options = {
  from: string | null;
  force: boolean;
  preferFallback?: boolean;
  quiet: boolean;
};

type Source = {
  path: string;
  env: Record<string, string>;
  convexConfig: {
    adminKey?: string;
    deploymentName?: string;
    ports?: { cloud?: number; site?: number };
  } | null;
};

type SetupResult = {
  convexLinked: boolean;
  envLinked: boolean;
  mode: "local" | "fallback";
  sourcePath: string;
};

const LOCAL_CONVEX_CONFIG = ".convex/local/default/config.json";
const REQUIRED_ENV_MATCH_KEYS = [
  "CONVEX_DEPLOYMENT",
  "VITE_CONVEX_URL",
  "VITE_CONVEX_SITE_URL",
  "CONVEX_SITE_URL",
] as const;

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
    } else if (arg === "--prefer-fallback") {
      options.preferFallback = true;
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

function listGitWorktrees(cwd: string) {
  const result = spawnSync("git", ["worktree", "list", "--porcelain"], {
    cwd,
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

  return {
    path,
    env: parseEnv(readFileSync(envPath, "utf8")),
    convexConfig: readConvexConfig(resolve(path, ".convex")),
  };
}

function readConvexConfig(convexPath: string) {
  const configPath = resolve(convexPath, "local/default/config.json");
  return existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf8")) : null;
}

function isLocalHost(hostname: string) {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "[::1]"
  );
}

function validateLocalSiteUrl(name: string, value: string | undefined, expectedPort: number) {
  if (!value) {
    return `${name} is required for local Convex HTTP routes; set it to http://127.0.0.1:${expectedPort}`;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return `${name} is not a valid URL`;
  }

  if (!isLocalHost(url.hostname)) return null;

  const port = Number(url.port);
  if (!port) return `${name} must include local site proxy port ${expectedPort}`;
  if (port !== expectedPort) {
    return `${name} port ${port} does not match ${LOCAL_CONVEX_CONFIG} site port ${expectedPort}`;
  }

  return null;
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
    if (!convexUrl) return "VITE_CONVEX_URL is required for local Convex";
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

    const sitePort = source.convexConfig.ports?.site ?? (configPort ? configPort + 1 : null);
    if (sitePort) {
      const invalidViteSiteUrl = validateLocalSiteUrl(
        "VITE_CONVEX_SITE_URL",
        source.env.VITE_CONVEX_SITE_URL,
        sitePort,
      );
      if (invalidViteSiteUrl) return invalidViteSiteUrl;

      const invalidServerSiteUrl = validateLocalSiteUrl(
        "CONVEX_SITE_URL",
        source.env.CONVEX_SITE_URL,
        sitePort,
      );
      if (invalidServerSiteUrl) return invalidServerSiteUrl;
    }
  }

  return null;
}

export function findSource(options: Options, cwd = process.cwd()) {
  const currentPath = resolve(cwd);
  if (!options.from && !options.preferFallback) {
    const current = readSource(currentPath);
    if (current && !validateSource(current)) return current;
  }

  const candidates = options.from
    ? [resolve(options.from)]
    : listGitWorktrees(cwd).filter((worktree) => worktree !== currentPath);

  const rejected: string[] = [];
  for (const candidate of candidates) {
    const source = readSource(candidate);
    if (!source) continue;
    const invalid = validateSource(source);
    if (!invalid) return source;
    rejected.push(`${candidate}: ${invalid}`);
  }

  if (!options.from && options.preferFallback) {
    const current = readSource(currentPath);
    if (current && !validateSource(current)) return current;
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

function existingEnvMatchesSource(target: string, source: Source) {
  if (!existsSync(target)) return false;
  const targetEnv = parseEnv(readFileSync(target, "utf8"));
  for (const key of REQUIRED_ENV_MATCH_KEYS) {
    if (targetEnv[key] !== source.env[key]) return false;
  }
  return (
    validateSource({
      path: resolve(target, ".."),
      env: targetEnv,
      convexConfig: source.convexConfig,
    }) === null
  );
}

function existingConvexMatchesSource(target: string, source: Source) {
  if (!existsSync(target)) return false;
  const targetConfig = readConvexConfig(target);
  if (!source.convexConfig) return targetConfig === null;
  if (!targetConfig) return false;
  return (
    targetConfig.deploymentName === source.convexConfig.deploymentName &&
    targetConfig.adminKey === source.convexConfig.adminKey &&
    targetConfig.ports?.cloud === source.convexConfig.ports?.cloud &&
    targetConfig.ports?.site === source.convexConfig.ports?.site
  );
}

function linkFromSource(
  name: string,
  source: Source,
  sourcePath: string,
  force: boolean,
  cwd: string,
) {
  const target = resolve(cwd, name);
  if (resolve(sourcePath) === target) return false;
  if (existsSync(target)) {
    if (!force && !lstatSync(target).isSymbolicLink()) {
      if (name === ".env.local" && existingEnvMatchesSource(target, source)) return false;
      if (name === ".convex" && existingConvexMatchesSource(target, source)) return false;
    }
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

export function setupWorktree({ cwd, options }: { cwd: string; options: Options }): SetupResult {
  const current = readSource(cwd);
  const source = findSource(options, cwd);
  const mode = current && source.path === current.path ? "local" : "fallback";

  const envLinked = linkFromSource(
    ".env.local",
    source,
    resolve(source.path, ".env.local"),
    options.force,
    cwd,
  );
  const convexLinked = linkFromSource(
    ".convex",
    source,
    resolve(source.path, ".convex"),
    options.force,
    cwd,
  );

  return {
    convexLinked,
    envLinked,
    mode,
    sourcePath: source.path,
  };
}

export function describeSetupResult(result: SetupResult) {
  if (result.mode === "local") {
    return "validated copied local .env.local and .convex";
  }

  const envState = result.envLinked ? "linked" : "existing";
  const convexState = result.convexLinked ? "linked" : "existing";
  return `fallback source ${result.sourcePath} (env: ${envState}, convex: ${convexState})`;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = setupWorktree({ cwd: process.cwd(), options });

  if (!options.quiet) {
    console.log(`Worktree env setup complete: ${describeSetupResult(result)}`);
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
