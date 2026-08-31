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

type RunnerEnv = Record<string, string | undefined>;

export type LocalAuthRunnerConfig = {
  convexDeployment: string | undefined;
  convexSiteUrl: string;
  convexUrl: string;
  playwrightArgs: string[];
};

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
