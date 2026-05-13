type DevAuthEnv = {
  CONVEX_DEPLOYMENT?: string;
  CONVEX_SITE_URL?: string;
  DEV_AUTH_CONVEX_DEPLOYMENT?: string;
  DEV_AUTH_ENABLED?: string;
};

export function isLocalDevAuthEnabled(env: DevAuthEnv = process.env) {
  if (env.DEV_AUTH_ENABLED !== "1") return false;
  const deployment = env.CONVEX_DEPLOYMENT?.trim() || env.DEV_AUTH_CONVEX_DEPLOYMENT?.trim() || "";
  return isLocalConvexDeployment(deployment) && isLocalhostUrl(env.CONVEX_SITE_URL);
}

function isLocalConvexDeployment(deployment: string) {
  return deployment.startsWith("local:") || deployment.startsWith("anonymous:");
}

function isLocalhostUrl(value: string | undefined) {
  if (!value) return false;
  try {
    const { hostname } = new URL(value);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
}
