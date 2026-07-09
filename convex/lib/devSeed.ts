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
