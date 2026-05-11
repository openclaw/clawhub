type DevAuthEnv = {
  CONVEX_DEPLOYMENT?: string;
  DEV_AUTH_ENABLED?: string;
};

export function isLocalDevAuthEnabled(env: DevAuthEnv = process.env) {
  if (env.DEV_AUTH_ENABLED !== "1") return false;
  const deployment = env.CONVEX_DEPLOYMENT ?? "";
  return deployment.startsWith("local:") || deployment.startsWith("anonymous:");
}
