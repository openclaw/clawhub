#!/usr/bin/env bun

import { spawnSync } from "node:child_process";

type BuildEnv = {
  CONVEX_DEPLOY_KEY?: string;
  VERCEL_ENV?: string;
  VERCEL_GIT_COMMIT_REF?: string;
};

type BuildStep = {
  command: string;
  args: string[];
};

export function resolveVercelBuildPlan(env: BuildEnv): BuildStep[] {
  if (env.VERCEL_ENV !== "preview") {
    if (env.VERCEL_ENV === "production" && env.CONVEX_DEPLOY_KEY?.trim()) {
      throw new Error("Production Vercel builds must not receive CONVEX_DEPLOY_KEY");
    }
    return [{ command: "bun", args: ["scripts/vercel-build-frontend.ts"] }];
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

function main() {
  for (const step of resolveVercelBuildPlan(process.env)) {
    const result = spawnSync(step.command, step.args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
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
