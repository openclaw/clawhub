#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import {
  assertStagingBuildEnv,
  isStagingBuildRequested,
  STAGING_CONVEX_URL,
  type StagingBuildEnv,
} from "./staging-build-env";

const STAGING_BACKEND_POLL_MS = 5_000;
const STAGING_BACKEND_WAIT_MS = 120_000;
const STAGING_QUERY_TIMEOUT_MS = 10_000;

type BuildEnv = StagingBuildEnv;

type BuildStep = {
  command: string;
  args: string[];
};

type Sleep = (delayMs: number) => Promise<void>;
type ReadStagingBackendBuildSha = (convexUrl: string) => Promise<string | null>;

type MainOptions = {
  env?: BuildEnv;
  now?: () => number;
  readStagingBackendBuildSha?: ReadStagingBackendBuildSha;
  sleep?: Sleep;
  spawn?: typeof spawnSync;
};

const defaultSleep: Sleep = (delayMs) =>
  new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });

const readStagingBackendBuildSha: ReadStagingBackendBuildSha = async (convexUrl) => {
  const client = new ConvexHttpClient(convexUrl, {
    logger: false,
    fetch: (input, init) =>
      fetch(input, { ...init, signal: AbortSignal.timeout(STAGING_QUERY_TIMEOUT_MS) }),
  });
  const deploymentInfo = await client.query(api.appMeta.getDeploymentInfo, {});
  return deploymentInfo.appBuildSha;
};

async function waitForStagingBackend(
  env: BuildEnv,
  readBuildSha: ReadStagingBackendBuildSha,
  sleep: Sleep,
  now: () => number,
) {
  const expectedSha = assertStagingBuildEnv(env);

  const deadline = now() + STAGING_BACKEND_WAIT_MS;
  let lastObserved = "unavailable";
  let loggedWait = false;
  for (;;) {
    try {
      const observedSha = await readBuildSha(STAGING_CONVEX_URL);
      if (observedSha === expectedSha) return;
      lastObserved = observedSha ?? "unset";
    } catch {
      // The query may not exist until the first Staging backend deploy completes.
      lastObserved = "query unavailable";
    }

    const remainingMs = deadline - now();
    if (remainingMs <= 0) {
      throw new Error(
        `Staging Convex APP_BUILD_SHA did not reach ${expectedSha} within 2 minutes (last observed: ${lastObserved})`,
      );
    }
    if (!loggedWait) {
      console.error("[vercel-build] waiting for the matching Staging Convex backend SHA...");
      loggedWait = true;
    }
    await sleep(Math.min(STAGING_BACKEND_POLL_MS, remainingMs));
  }
}

export function resolveVercelBuildPlan(env: BuildEnv, previewNameOverride?: string): BuildStep[] {
  const targetEnvironment = env.VERCEL_TARGET_ENV?.trim() || env.VERCEL_ENV?.trim();

  if (isStagingBuildRequested(env)) {
    assertStagingBuildEnv(env);
    return [{ command: "bun", args: ["scripts/vercel-build-frontend.ts"] }];
  }

  if (targetEnvironment === "production" || targetEnvironment === "test") {
    if (env.CONVEX_DEPLOY_KEY?.trim()) {
      const environmentLabel = targetEnvironment === "production" ? "Production" : "Test";
      throw new Error(`${environmentLabel} Vercel builds must not receive CONVEX_DEPLOY_KEY`);
    }
    return [{ command: "bun", args: ["scripts/vercel-build-frontend.ts"] }];
  }

  if (targetEnvironment !== "preview") {
    throw new Error(`Unsupported Vercel target environment: ${targetEnvironment ?? "missing"}`);
  }

  const deployKey = env.CONVEX_DEPLOY_KEY?.trim();
  if (!deployKey?.startsWith("preview:")) {
    throw new Error("Preview builds require a Convex Preview deploy key");
  }

  const branchName = env.VERCEL_GIT_COMMIT_REF?.trim();
  if (!branchName) {
    throw new Error("Preview builds require VERCEL_GIT_COMMIT_REF");
  }
  const previewName = previewNameOverride?.trim() || branchName;

  return [
    {
      command: "bunx",
      args: [
        "convex",
        "deploy",
        "--preview-create",
        previewName,
        "--cmd",
        "bun scripts/vercel-build-frontend.ts",
        "--cmd-url-env-var-name",
        "VITE_CONVEX_URL",
      ],
    },
    // --preview-create guarantees an empty backend, so the shared seed stays
    // idempotent and avoids a destructive full-corpus reset transaction.
    {
      command: "bun",
      args: ["run", "seed", "--", "--preview-name", previewName],
    },
  ];
}

function runBuildPlan(steps: BuildStep[], spawn: typeof spawnSync) {
  for (const step of steps) {
    const result = spawn(step.command, step.args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });
    if (result.error || result.status !== 0) return result;
  }

  return null;
}

export async function main({
  env = process.env,
  now = Date.now,
  readStagingBackendBuildSha: readBuildSha = readStagingBackendBuildSha,
  sleep = defaultSleep,
  spawn = spawnSync,
}: MainOptions = {}): Promise<number> {
  const initialPlan = resolveVercelBuildPlan(env);
  const targetEnvironment = env.VERCEL_TARGET_ENV?.trim() || env.VERCEL_ENV?.trim();
  const stagingBuild = isStagingBuildRequested(env);

  if (stagingBuild) {
    await waitForStagingBackend(env, readBuildSha, sleep, now);
  }

  if (stagingBuild || targetEnvironment !== "preview") {
    const failure = runBuildPlan(initialPlan, spawn);
    if (!failure) return 0;
    if (failure.error) throw failure.error;
    return failure.status ?? 1;
  }

  const branchName = env.VERCEL_GIT_COMMIT_REF?.trim();
  if (!branchName) throw new Error("Preview builds require VERCEL_GIT_COMMIT_REF");

  // Namespace preview names per builder: a second deploy-key consumer running
  // --preview-create on the raw branch name replaces (deletes) our deployment
  // mid-push, which surfaced as get_config_hashes/wait_for_schema 404s.
  const baseName = `${branchName}-vercel`;

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const previewName = attempt === 1 ? baseName : `${baseName}-retry-${attempt}`;
    const plan = resolveVercelBuildPlan(env, previewName);
    const failure = runBuildPlan(plan, spawn);
    if (!failure) return 0;

    if (attempt === maxAttempts) {
      if (failure.error) throw failure.error;
      return failure.status ?? 1;
    }

    const delayMs = attempt * 20_000;
    const nextPreviewName = `${baseName}-retry-${attempt + 1}`;
    console.error(
      `[vercel-build] convex preview pipeline failed (attempt ${attempt}/${maxAttempts}); retrying in ${delayMs / 1_000}s with preview name ${nextPreviewName}...`,
    );
    await sleep(delayMs);
  }

  return 1;
}

if (import.meta.main) {
  try {
    const exitCode = await main();
    if (exitCode !== 0) process.exit(exitCode);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
