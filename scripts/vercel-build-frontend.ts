#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { resolveConvexSiteUrl } from "../src/lib/convexDeploymentUrl";

export function resolveFrontendBuildEnv(env: NodeJS.ProcessEnv) {
  const targetEnvironment = env.VERCEL_TARGET_ENV?.trim() || env.VERCEL_ENV?.trim();
  const convexSiteUrl = resolveConvexSiteUrl({
    CONVEX_URL: env.CONVEX_URL,
    VITE_CONVEX_SITE_URL: targetEnvironment === "preview" ? undefined : env.VITE_CONVEX_SITE_URL,
    VITE_CONVEX_URL: env.VITE_CONVEX_URL,
  });
  return {
    ...env,
    VITE_CONVEX_SITE_URL: convexSiteUrl,
    VITE_CLAWHUB_DEPLOY_ENV: targetEnvironment ?? "development",
  };
}

function main() {
  const result = spawnSync("bun", ["run", "build"], {
    cwd: process.cwd(),
    env: resolveFrontendBuildEnv(process.env),
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
