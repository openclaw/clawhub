export const STAGING_CONVEX_URL = "https://cheery-civet-733.convex.cloud";
export const STAGING_CONVEX_SITE_URL = "https://cheery-civet-733.convex.site";
const STAGING_SITE_URLS = new Set([
  "https://stg.clawhub.ai",
  "https://stg.clawhub.openclaw.org",
  "https://clawhub-git-staging-openclaw-foundation.vercel.app",
]);

export type StagingBuildEnv = {
  CLAWHUB_ENV?: string;
  CLAWHUB_STAGING_EDGE_SECRET?: string;
  CONVEX_DEPLOY_KEY?: string;
  SITE_URL?: string;
  VERCEL_ENV?: string;
  VERCEL_GIT_COMMIT_REF?: string;
  VERCEL_GIT_COMMIT_SHA?: string;
  VERCEL_TARGET_ENV?: string;
  VITE_CONVEX_SITE_URL?: string;
  VITE_CONVEX_URL?: string;
  VITE_SITE_URL?: string;
};

export function isStagingBuildRequested(env: StagingBuildEnv) {
  return (
    env.CLAWHUB_ENV?.trim() === "staging" ||
    env.VERCEL_TARGET_ENV?.trim() === "staging" ||
    env.VERCEL_GIT_COMMIT_REF?.trim() === "staging"
  );
}

export function assertStagingBuildEnv(env: StagingBuildEnv) {
  if (env.CLAWHUB_ENV?.trim() !== "staging" || env.VERCEL_ENV?.trim() !== "preview") {
    throw new Error("Staging Vercel builds require CLAWHUB_ENV=staging and VERCEL_ENV=preview");
  }
  const targetEnvironment = env.VERCEL_TARGET_ENV?.trim();
  if (targetEnvironment && targetEnvironment !== "preview" && targetEnvironment !== "staging") {
    throw new Error("Staging Vercel builds require a preview or staging target environment");
  }
  if (env.CONVEX_DEPLOY_KEY?.trim()) {
    throw new Error("Staging Vercel builds must not receive CONVEX_DEPLOY_KEY");
  }
  const edgeSecret = env.CLAWHUB_STAGING_EDGE_SECRET?.trim();
  if (!edgeSecret || edgeSecret.length < 32 || edgeSecret.length > 256) {
    throw new Error("Staging Vercel builds require CLAWHUB_STAGING_EDGE_SECRET");
  }
  if (env.VERCEL_GIT_COMMIT_REF?.trim() !== "staging") {
    throw new Error("Staging Vercel builds require VERCEL_GIT_COMMIT_REF=staging");
  }
  const expectedSha = env.VERCEL_GIT_COMMIT_SHA?.trim();
  if (!expectedSha || !/^[0-9a-f]{40}$/.test(expectedSha)) {
    throw new Error("Staging Vercel builds require a full VERCEL_GIT_COMMIT_SHA");
  }
  if (
    env.VITE_CONVEX_URL?.trim() !== STAGING_CONVEX_URL ||
    env.VITE_CONVEX_SITE_URL?.trim() !== STAGING_CONVEX_SITE_URL
  ) {
    throw new Error("Staging Vercel builds require the paired cheery-civet-733 Convex URLs");
  }
  const siteUrl = env.SITE_URL?.trim();
  if (!siteUrl || !STAGING_SITE_URLS.has(siteUrl) || env.VITE_SITE_URL?.trim() !== siteUrl) {
    throw new Error(
      "Staging Vercel builds require matching SITE_URL and VITE_SITE_URL on an approved staging host",
    );
  }
  return expectedSha;
}
