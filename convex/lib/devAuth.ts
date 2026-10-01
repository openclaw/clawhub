type DevAuthEnv = {
  CONVEX_DEPLOYMENT?: string;
  CONVEX_SITE_URL?: string;
  DEV_AUTH_CONVEX_DEPLOYMENT?: string;
  DEV_AUTH_ENABLED?: string;
  DEV_AUTH_SECRET?: string;
  DEV_AUTH_SITE_URL?: string;
};

const MIN_CLOUD_DEV_AUTH_SECRET_LENGTH = 32;

export function isLocalDevAuthEnabled(env: DevAuthEnv = process.env, suppliedSecret?: string) {
  if (env.DEV_AUTH_ENABLED !== "1") return false;
  const convexDeployment = env.CONVEX_DEPLOYMENT?.trim();
  const devAuthDeployment = env.DEV_AUTH_CONVEX_DEPLOYMENT?.trim();
  const deployment = convexDeployment || devAuthDeployment || "";

  if (isLocalConvexDeployment(deployment)) {
    return isLocalhostUrl(env.CONVEX_SITE_URL);
  }

  if (isDevConvexDeployment(deployment)) {
    return isLocalhostUrl(env.DEV_AUTH_SITE_URL) && hasValidCloudDevAuthSecret(env, suppliedSecret);
  }

  return false;
}

function isLocalConvexDeployment(deployment: string) {
  return deployment.startsWith("local:") || deployment.startsWith("anonymous:");
}

function isDevConvexDeployment(deployment: string) {
  return deployment.startsWith("dev:");
}

function hasValidCloudDevAuthSecret(env: DevAuthEnv, suppliedSecret: string | undefined) {
  const expected = env.DEV_AUTH_SECRET?.trim();
  const actual = suppliedSecret?.trim();
  return Boolean(
    expected &&
    actual &&
    expected.length >= MIN_CLOUD_DEV_AUTH_SECRET_LENGTH &&
    actual === expected,
  );
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
