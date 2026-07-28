export const CLAWHUB_SKILLS_SH_ROLLOUT_MODE = "CLAWHUB_SKILLS_SH_ROLLOUT_MODE";
export const CLAWHUB_GITHUB_SKILL_SYNC_ROLLOUT_MODE = "CLAWHUB_GITHUB_SKILL_SYNC_ROLLOUT_MODE";

export type ClawHubRolloutMode = "off" | "test" | "production";
export type ClawHubRuntimeEnvironment = "local" | "test" | "preview" | "production" | "unknown";

export type ClawHubRolloutEnvironment = {
  CLAWHUB_DEPLOYMENT_NAME?: string;
  CLAWHUB_ENV?: string;
  CLAWHUB_GITHUB_SKILL_SYNC_ROLLOUT_MODE?: string;
  CLAWHUB_PREVIEW?: string;
  CLAWHUB_SKILLS_SH_ROLLOUT_MODE?: string;
  CONVEX_CLOUD_URL?: string;
  CONVEX_DEPLOYMENT?: string;
  CONVEX_SITE_URL?: string;
  DEV_AUTH_CONVEX_DEPLOYMENT?: string;
  VERCEL_ENV?: string;
  VERCEL_TARGET_ENV?: string;
  VITE_CLAWHUB_DEPLOY_ENV?: string;
  VITE_CONVEX_URL?: string;
};

export type ClawHubRolloutCapability = {
  mode: ClawHubRolloutMode;
  runtimeEnabled: boolean;
  reason: "enabled" | "mode-off" | "environment-mismatch";
};

const TEST_DEPLOYMENT = "academic-chihuahua-392";

function normalized(value: string | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function runtimeMarker(env: ClawHubRolloutEnvironment) {
  return (
    normalized(env.CLAWHUB_ENV) ||
    normalized(env.VITE_CLAWHUB_DEPLOY_ENV) ||
    normalized(env.VERCEL_TARGET_ENV) ||
    normalized(env.VERCEL_ENV)
  );
}

function deploymentName(env: ClawHubRolloutEnvironment) {
  const configured = normalized(env.CLAWHUB_DEPLOYMENT_NAME);
  if (configured) return configured;
  const deployment = normalized(env.CONVEX_DEPLOYMENT || env.DEV_AUTH_CONVEX_DEPLOYMENT);
  const separator = deployment.indexOf(":");
  return separator >= 0 ? deployment.slice(separator + 1) : deployment;
}

function isLocalUrl(value: string | undefined) {
  if (!value) return false;
  try {
    const hostname = new URL(value).hostname;
    return ["localhost", "127.0.0.1", "0.0.0.0", "[::1]"].includes(hostname);
  } catch {
    return false;
  }
}

export function parseRolloutMode(value: string | undefined): ClawHubRolloutMode {
  const mode = normalized(value);
  if (mode === "test" || mode === "production") return mode;
  return "off";
}

export function getClawHubRuntimeEnvironment(
  env: ClawHubRolloutEnvironment,
): ClawHubRuntimeEnvironment {
  const deployment = normalized(env.CONVEX_DEPLOYMENT || env.DEV_AUTH_CONVEX_DEPLOYMENT);
  const name = deploymentName(env);
  const vercelEnvironment = normalized(env.VERCEL_ENV);
  const vercelTargetEnvironment = normalized(env.VERCEL_TARGET_ENV);
  const permanentTestTarget =
    vercelTargetEnvironment === "test" &&
    (name === TEST_DEPLOYMENT ||
      normalized(env.CLAWHUB_ENV) === "test" ||
      normalized(env.VITE_CLAWHUB_DEPLOY_ENV) === "test");
  if (deployment.startsWith("prod:")) return "production";
  if (
    env.CLAWHUB_PREVIEW === "1" ||
    vercelTargetEnvironment === "preview" ||
    (vercelEnvironment === "preview" && !permanentTestTarget)
  ) {
    return "preview";
  }
  if (name === TEST_DEPLOYMENT) return "test";
  if (normalized(env.CLAWHUB_DEPLOYMENT_NAME)) {
    return "production";
  }
  if (vercelTargetEnvironment === "production" || vercelEnvironment === "production") {
    return "production";
  }

  const marker = runtimeMarker(env);
  if (marker === "test") return "test";
  if (marker === "production") return "production";
  if (marker === "preview") return "preview";
  if (marker === "local" || marker === "development") return "local";

  if (deployment.startsWith("local:") || deployment.startsWith("dev:")) return "local";

  const urls = [env.CONVEX_CLOUD_URL, env.CONVEX_SITE_URL, env.VITE_CONVEX_URL].filter(
    (value): value is string => Boolean(value?.trim()),
  );
  if (urls.some((value) => value.includes(TEST_DEPLOYMENT))) return "test";
  if (urls.length > 0 && urls.every(isLocalUrl)) return "local";
  return "unknown";
}

function resolveCapability(
  mode: ClawHubRolloutMode,
  environment: ClawHubRuntimeEnvironment,
): ClawHubRolloutCapability {
  if (mode === "off") {
    return { mode, runtimeEnabled: false, reason: "mode-off" };
  }
  const runtimeEnabled =
    (mode === "test" && (environment === "test" || environment === "local")) ||
    (mode === "production" && environment === "production");
  return {
    mode,
    runtimeEnabled,
    reason: runtimeEnabled ? "enabled" : "environment-mismatch",
  };
}

export function getClawHubRolloutCapabilities(env: ClawHubRolloutEnvironment) {
  const environment = getClawHubRuntimeEnvironment(env);
  return {
    environment,
    skillsSh: resolveCapability(parseRolloutMode(env.CLAWHUB_SKILLS_SH_ROLLOUT_MODE), environment),
    githubSkillSync: resolveCapability(
      parseRolloutMode(env.CLAWHUB_GITHUB_SKILL_SYNC_ROLLOUT_MODE),
      environment,
    ),
  };
}
