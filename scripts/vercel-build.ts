#!/usr/bin/env bun

import { spawnSync } from "node:child_process";

type BuildEnv = {
  CONVEX_DEPLOY_KEY?: string;
  VERCEL_ENV?: string;
  VERCEL_GIT_COMMIT_REF?: string;
  VERCEL_TARGET_ENV?: string;
};

type BuildStep = {
  command: string;
  args: string[];
};

type Sleep = (delayMs: number) => Promise<void>;

type MainOptions = {
  env?: BuildEnv;
  sleep?: Sleep;
  spawn?: typeof spawnSync;
};

const defaultSleep: Sleep = (delayMs) =>
  new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });

export function resolveVercelBuildPlan(env: BuildEnv, previewNameOverride?: string): BuildStep[] {
  const targetEnvironment = env.VERCEL_TARGET_ENV?.trim() || env.VERCEL_ENV?.trim();

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
  sleep = defaultSleep,
  spawn = spawnSync,
}: MainOptions = {}): Promise<number> {
  const initialPlan = resolveVercelBuildPlan(env);
  const targetEnvironment = env.VERCEL_TARGET_ENV?.trim() || env.VERCEL_ENV?.trim();

  if (targetEnvironment !== "preview") {
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
