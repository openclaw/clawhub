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
  retryable?: true;
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

export function resolveVercelBuildPlan(env: BuildEnv): BuildStep[] {
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

  const previewName = env.VERCEL_GIT_COMMIT_REF?.trim();
  if (!previewName) {
    throw new Error("Preview builds require VERCEL_GIT_COMMIT_REF");
  }

  return [
    {
      command: "bunx",
      retryable: true,
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

export async function main({
  env = process.env,
  sleep = defaultSleep,
  spawn = spawnSync,
}: MainOptions = {}): Promise<number> {
  for (const step of resolveVercelBuildPlan(env)) {
    const maxAttempts = step.retryable ? 3 : 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const result = spawn(step.command, step.args, {
        cwd: process.cwd(),
        env: process.env,
        stdio: "inherit",
      });
      if (!result.error && result.status === 0) break;

      if (attempt < maxAttempts) {
        const delayMs = attempt * 20_000;
        console.error(
          `[vercel-build] convex preview deploy failed (attempt ${attempt}/${maxAttempts}); retrying in ${delayMs / 1_000}s...`,
        );
        await sleep(delayMs);
        continue;
      }

      if (result.error) throw result.error;
      return result.status ?? 1;
    }
  }

  return 0;
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
