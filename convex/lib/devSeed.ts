const PRODUCTION_CONVEX_CLOUD_URL = "https://wry-manatee-359.convex.cloud";

type DevSeedEnv = {
  CLAWHUB_PREVIEW?: string;
  CONVEX_CLOUD_URL?: string;
  CONVEX_DEPLOYMENT?: string;
  DEV_AUTH_CONVEX_DEPLOYMENT?: string;
  DEV_AUTH_ENABLED?: string;
  CLAW_HUB_ENABLE_DEV_IMPERSONATION?: string;
};

export function assertLocalDevSeedAllowed(seedName: string): void {
  const deployment =
    process.env.CONVEX_DEPLOYMENT?.trim() || process.env.DEV_AUTH_CONVEX_DEPLOYMENT?.trim() || "";
  if (
    deployment.startsWith("dev:") ||
    deployment.startsWith("local:") ||
    deployment.startsWith("anonymous:")
  ) {
    return;
  }
  if (
    !deployment &&
    (process.env.DEV_AUTH_ENABLED === "1" || process.env.CLAW_HUB_ENABLE_DEV_IMPERSONATION === "1")
  ) {
    return;
  }
  throw new Error(`${seedName} dev seed is disabled outside local/dev deployments`);
}

export function assertPreviewSeedAllowed(seedName: string, env: DevSeedEnv = process.env): void {
  if (env.CLAWHUB_PREVIEW !== "1") {
    throw new Error(`${seedName} seed requires CLAWHUB_PREVIEW=1`);
  }
  if (env.CONVEX_CLOUD_URL?.replace(/\/+$/, "") === PRODUCTION_CONVEX_CLOUD_URL) {
    throw new Error(`${seedName} seed is disabled for the production deployment`);
  }
  if (!env.CONVEX_CLOUD_URL?.trim()) {
    throw new Error(`${seedName} seed requires CONVEX_CLOUD_URL`);
  }
}
