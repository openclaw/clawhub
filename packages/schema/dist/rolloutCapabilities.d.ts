export declare const CLAWHUB_SKILLS_SH_ROLLOUT_MODE = "CLAWHUB_SKILLS_SH_ROLLOUT_MODE";
export declare const CLAWHUB_GITHUB_SKILL_SYNC_ROLLOUT_MODE = "CLAWHUB_GITHUB_SKILL_SYNC_ROLLOUT_MODE";
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
export declare function parseRolloutMode(value: string | undefined): ClawHubRolloutMode;
export declare function getClawHubRuntimeEnvironment(env: ClawHubRolloutEnvironment): ClawHubRuntimeEnvironment;
export declare function getClawHubRolloutCapabilities(env: ClawHubRolloutEnvironment): {
    environment: ClawHubRuntimeEnvironment;
    skillsSh: ClawHubRolloutCapability;
    githubSkillSync: ClawHubRolloutCapability;
};
