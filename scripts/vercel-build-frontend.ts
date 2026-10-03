#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { parseRolloutMode } from "clawhub-schema";
import { resolveConvexSiteUrl } from "../src/lib/convexDeploymentUrl";
import { writeDeploymentMetadata } from "./lib/frontendBuildMetadata";
import { assertStagingBuildEnv, isStagingBuildRequested } from "./staging-build-env";

export function resolveFrontendBuildEnv(env: NodeJS.ProcessEnv) {
  const stagingBuild = isStagingBuildRequested(env);
  const stagingBuildSha = stagingBuild ? assertStagingBuildEnv(env) : undefined;
  const targetEnvironment = stagingBuild
    ? "staging"
    : env.VERCEL_TARGET_ENV?.trim() || env.VERCEL_ENV?.trim();
  if (targetEnvironment === "production") {
    const activeMode = [
      env.CLAWHUB_SKILLS_SH_ROLLOUT_MODE,
      env.CLAWHUB_GITHUB_SKILL_SYNC_ROLLOUT_MODE,
    ].find((value) => parseRolloutMode(value) !== "off");
    if (activeMode) {
      throw new Error(
        "Production skills rollout requires a separately authorized explicit rollout activation",
      );
    }
  }
  const convexSiteUrl = resolveConvexSiteUrl({
    CONVEX_URL: env.CONVEX_URL,
    VITE_CONVEX_SITE_URL: targetEnvironment === "preview" ? undefined : env.VITE_CONVEX_SITE_URL,
    VITE_CONVEX_URL: env.VITE_CONVEX_URL,
  });
  const buildEnv: NodeJS.ProcessEnv = {
    ...env,
    VITE_CONVEX_SITE_URL: convexSiteUrl,
    VITE_CLAWHUB_DEPLOY_ENV: targetEnvironment ?? "development",
    ...(stagingBuild
      ? { VITE_APP_BUILD_SHA: stagingBuildSha, VITE_SITE_URL: env.VITE_SITE_URL }
      : {}),
  };
  delete buildEnv.VITE_GA4_RELEASE;
  return buildEnv;
}

function main() {
  const result = spawnSync("bun", ["run", "build"], {
    cwd: process.cwd(),
    env: resolveFrontendBuildEnv(process.env),
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  writeDeploymentMetadata(process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.VITE_APP_BUILD_SHA);
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
