import { accessSync, constants, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const DEFAULT_CONVEX_URL = "http://127.0.0.1:3210";
const DEFAULT_CONVEX_SITE_URL = "http://127.0.0.1:3211";
export const DEFAULT_LOCAL_AUTH_CONVEX_DEPLOYMENT = "anonymous:anonymous-agent";
const DEFAULT_PLAYWRIGHT_ARGS = ["--project=chromium", "e2e/local-auth"];
const DEFAULT_PLAYWRIGHT_RETRIES = "1";
const LOCAL_AUTH_TRENDING_SNAPSHOT_ID = "local-auth-canonical-trending-v1";
const DAY_MS = 24 * 60 * 60 * 1_000;
const SNAPSHOT_RETENTION_MS = 2 * DAY_MS;
const LOCAL_AUTH_BACKEND_HTTP_TIMEOUT_SECONDS = 900;

type RunnerEnv = Record<string, string | undefined>;

export type LocalAuthRunnerConfig = {
  convexDeployment: string | undefined;
  convexSiteUrl: string;
  convexUrl: string;
  playwrightArgs: string[];
};

export function buildLocalAuthBackendEnv() {
  // A 300s backend 408 makes the CLI retry into the executor's shared build_deps directory.
  // 900s exceeds its 605s build_deps cap, so a stuck install hits the executor timeout first.
  return {
    HTTP_SERVER_TIMEOUT_SECONDS: String(LOCAL_AUTH_BACKEND_HTTP_TIMEOUT_SECONDS),
    npm_config_prefer_offline: "true",
    npm_config_fetch_timeout: "60000",
    npm_config_fetch_retries: "5",
  };
}

export function resolveLocalAuthExternalNodeDependencies({
  readFile,
}: {
  readFile: (path: string) => string;
}): Array<{ name: string; version: string }> {
  let externalPackages: unknown;
  try {
    const config = JSON.parse(readFile("convex.json")) as {
      node?: { externalPackages?: unknown };
    } | null;
    externalPackages = config?.node?.externalPackages;
  } catch {
    return [];
  }
  if (
    !Array.isArray(externalPackages) ||
    !externalPackages.every(
      (name): name is string => typeof name === "string" && name !== "*" && name.length > 0,
    )
  ) {
    return [];
  }

  const dependencies: Array<{ name: string; version: string }> = [];
  for (const name of externalPackages) {
    try {
      const pkg = JSON.parse(readFile(join("node_modules", name, "package.json"))) as {
        version?: unknown;
      } | null;
      if (typeof pkg?.version === "string" && pkg.version.length > 0) {
        dependencies.push({ name, version: pkg.version });
      }
    } catch {
      // Missing installed packages are left for the normal Convex push to resolve.
    }
  }
  return dependencies;
}

export function buildLocalAuthTrendingSnapshotArgs(now: number) {
  const windowEndDay = Math.floor(now / DAY_MS);
  return {
    start: {
      snapshotId: LOCAL_AUTH_TRENDING_SNAPSHOT_ID,
      generatedAt: now,
      expiresAt: now + SNAPSHOT_RETENTION_MS,
      windowStartDay: Math.max(0, windowEndDay - 1),
      windowEndDay,
    },
    finalize: {
      snapshotId: LOCAL_AUTH_TRENDING_SNAPSHOT_ID,
      completedAt: now,
      totalItems: 0,
      sourceCounts: {
        clawhubTrending: 0,
        clawhubRising: 0,
        skillsShTrending: 0,
      },
      operations: {
        documentsRead: 0,
        documentsWritten: 2,
        functionCalls: 2,
      },
    },
  };
}

function stripPackageManagerSeparator(args: string[]) {
  return args[0] === "--" ? args.slice(1) : args;
}

function withDefaultRetries(args: string[]) {
  if (args.some((arg) => arg === "--retries" || arg.startsWith("--retries="))) {
    return args;
  }
  return [`--retries=${DEFAULT_PLAYWRIGHT_RETRIES}`, ...args];
}

export function resolveLocalAuthDeployment(
  configuredDeployment: string | undefined,
  fallbackDeployment: string | null | undefined,
) {
  return configuredDeployment ?? fallbackDeployment ?? DEFAULT_LOCAL_AUTH_CONVEX_DEPLOYMENT;
}

export function resolveLocalAuthRunnerConfig(
  env: RunnerEnv = process.env,
  argv: string[] = process.argv.slice(2),
): LocalAuthRunnerConfig {
  const playwrightArgs = stripPackageManagerSeparator(argv);
  return {
    convexDeployment: env.PLAYWRIGHT_LOCAL_AUTH_CONVEX_DEPLOYMENT,
    convexSiteUrl: env.PLAYWRIGHT_LOCAL_AUTH_CONVEX_SITE_URL ?? DEFAULT_CONVEX_SITE_URL,
    convexUrl: env.PLAYWRIGHT_LOCAL_AUTH_CONVEX_URL ?? DEFAULT_CONVEX_URL,
    playwrightArgs: withDefaultRetries(
      playwrightArgs.length > 0 ? playwrightArgs : DEFAULT_PLAYWRIGHT_ARGS,
    ),
  };
}

export function createLocalAuthTempDir() {
  const workspaceDevice = statSync(process.cwd()).dev;
  let base = tmpdir();
  if (statSync(base).dev !== workspaceDevice) {
    base = process.cwd();
    for (
      let ancestor = dirname(base);
      statSync(ancestor).dev === workspaceDevice;
      ancestor = dirname(ancestor)
    ) {
      try {
        accessSync(ancestor, constants.W_OK | constants.X_OK);
        base = ancestor;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "EACCES" && code !== "EPERM" && code !== "EROFS") throw error;
      }
      if (ancestor === dirname(ancestor)) break;
    }
  }
  // Convex renames prepared modules into local storage and binds Unix sockets under TMPDIR.
  // Use the shortest writable same-volume ancestor; mount roots need not be user-writable.
  return mkdtempSync(join(base, "clawhub-pw-"));
}
