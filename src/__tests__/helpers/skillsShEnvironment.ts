import { vi } from "vitest";

export function useEnvironment(env: Record<string, string>) {
  for (const name of [
    "CLAWHUB_DEPLOYMENT_NAME",
    "CLAWHUB_DISABLE_CRONS",
    "CLAWHUB_ENV",
    "CLAWHUB_PREVIEW",
    "CLAWHUB_SKILLS_SH_ROLLOUT_MODE",
    "CONVEX_CLOUD_URL",
    "CONVEX_DEPLOYMENT",
    "CONVEX_SITE_URL",
    "DEV_AUTH_CONVEX_DEPLOYMENT",
    "VERCEL_ENV",
    "VERCEL_TARGET_ENV",
    "VITE_CLAWHUB_DEPLOY_ENV",
    "VITE_CONVEX_URL",
  ]) {
    vi.stubEnv(name, "");
  }
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
}
