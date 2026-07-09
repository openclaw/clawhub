#!/usr/bin/env bun

import { spawnSync } from "node:child_process";

type BuildEnv = {
  CONVEX_DEPLOY_KEY?: string;
  VERCEL_ENV?: string;
  VERCEL_GIT_COMMIT_REF?: string;
};

type BuildPlan = {
  command: string;
  args: string[];
};

export function resolveVercelBuildPlan(env: BuildEnv): BuildPlan {
  if (env.VERCEL_ENV !== "preview") {
    if (env.VERCEL_ENV === "production" && env.CONVEX_DEPLOY_KEY?.trim()) {
      throw new Error("Production Vercel builds must not receive CONVEX_DEPLOY_KEY");
    }
    return {
      command: "bun",
      args: ["scripts/vercel-build-frontend.ts"],
    };
  }

  const deployKey = env.CONVEX_DEPLOY_KEY?.trim();
  if (!deployKey?.startsWith("preview:")) {
    throw new Error("Preview builds require a Convex Preview deploy key");
  }

  const previewName = env.VERCEL_GIT_COMMIT_REF?.trim();
  if (!previewName) {
    throw new Error("Preview builds require VERCEL_GIT_COMMIT_REF");
  }

  return {
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
      "--preview-run",
      "previewSeed:seed",
    ],
  };
}

function main() {
  const plan = resolveVercelBuildPlan(process.env);
  const result = spawnSync(plan.command, plan.args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
