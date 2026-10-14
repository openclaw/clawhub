import { describe, expect, it } from "vitest";
import { resolveFrontendBuildEnv } from "./vercel-build-frontend";

describe("Vercel frontend build environment", () => {
  it("removes only the retired analytics release value without mutating its input", () => {
    const input = {
      VERCEL_ENV: "production",
      VERCEL_GIT_COMMIT_SHA: "a".repeat(40),
      VITE_CONVEX_URL: "https://wry-manatee-359.convex.cloud",
      VITE_GA4_RELEASE: "stale-analytics-only",
      VITE_APP_BUILD_SHA: "application-drift-identity",
      VERCEL_OIDC_TOKEN: "fixture-token",
    };
    const result = resolveFrontendBuildEnv(input);
    expect(result).not.toHaveProperty("VITE_GA4_RELEASE");
    expect(result.VITE_APP_BUILD_SHA).toBe(input.VITE_APP_BUILD_SHA);
    expect(result.VERCEL_GIT_COMMIT_SHA).toBe(input.VERCEL_GIT_COMMIT_SHA);
    expect(result.VERCEL_OIDC_TOKEN).toBe(input.VERCEL_OIDC_TOKEN);
    expect(input.VITE_GA4_RELEASE).toBe("stale-analytics-only");
  });
  it("derives the preview site URL from the Convex CLI injected cloud URL", () => {
    const env = resolveFrontendBuildEnv({
      VERCEL_ENV: "preview",
      VITE_CONVEX_URL: "https://paired-preview-123.convex.cloud",
      VITE_CONVEX_SITE_URL: "https://wry-manatee-359.convex.site",
    });

    expect(env.VITE_CONVEX_SITE_URL).toBe("https://paired-preview-123.convex.site");
    expect(env.VITE_CLAWHUB_DEPLOY_ENV).toBe("preview");
  });

  it("preserves an explicit production site URL", () => {
    const env = resolveFrontendBuildEnv({
      VERCEL_ENV: "production",
      VITE_CONVEX_URL: "https://wry-manatee-359.convex.cloud",
      VITE_CONVEX_SITE_URL: "https://api.clawhub.example",
    });

    expect(env.VITE_CONVEX_SITE_URL).toBe("https://api.clawhub.example");
    expect(env.VITE_CLAWHUB_DEPLOY_ENV).toBe("production");
  });

  it.each(["test", "production"])(
    "rejects %s rollout modes in an ordinary production build",
    (mode) => {
      expect(() =>
        resolveFrontendBuildEnv({
          VERCEL_ENV: "production",
          VITE_CONVEX_URL: "https://wry-manatee-359.convex.cloud",
          CLAWHUB_SKILLS_SH_ROLLOUT_MODE: mode,
        }),
      ).toThrow(/explicit rollout activation/i);
    },
  );

  it("treats malformed production rollout modes as off", () => {
    expect(
      resolveFrontendBuildEnv({
        VERCEL_ENV: "production",
        VITE_CONVEX_URL: "https://wry-manatee-359.convex.cloud",
        CLAWHUB_SKILLS_SH_ROLLOUT_MODE: "enabled",
      }).VITE_CLAWHUB_DEPLOY_ENV,
    ).toBe("production");
  });

  it("preserves the permanent backend URLs for the custom test environment", () => {
    const env = resolveFrontendBuildEnv({
      VERCEL_ENV: "preview",
      VERCEL_TARGET_ENV: "test",
      CLAWHUB_GITHUB_SKILL_SYNC_ROLLOUT_MODE: "test",
      CLAWHUB_SKILLS_SH_ROLLOUT_MODE: "test",
      VITE_CONVEX_URL: "https://academic-chihuahua-392.convex.cloud",
      VITE_CONVEX_SITE_URL: "https://academic-chihuahua-392.convex.site",
    });

    expect(env.VITE_CONVEX_SITE_URL).toBe("https://academic-chihuahua-392.convex.site");
    expect(env.VITE_CLAWHUB_DEPLOY_ENV).toBe("test");
  });

  it.each(["preview", "staging"])(
    "preserves the permanent staging backend with Vercel target %s",
    (targetEnvironment) => {
      const env = resolveFrontendBuildEnv({
        CLAWHUB_ENV: "staging",
        CLAWHUB_STAGING_EDGE_SECRET: "s".repeat(48),
        SITE_URL: "https://stg.clawhub.ai",
        VERCEL_ENV: "preview",
        VERCEL_TARGET_ENV: targetEnvironment,
        VERCEL_GIT_COMMIT_REF: "staging",
        VERCEL_GIT_COMMIT_SHA: "a".repeat(40),
        VITE_CONVEX_URL: "https://cheery-civet-733.convex.cloud",
        VITE_CONVEX_SITE_URL: "https://cheery-civet-733.convex.site",
        VITE_SITE_URL: "https://stg.clawhub.ai",
        VITE_APP_BUILD_SHA: "old-build",
      });

      expect(env.VITE_CONVEX_SITE_URL).toBe("https://cheery-civet-733.convex.site");
      expect(env.VITE_CLAWHUB_DEPLOY_ENV).toBe("staging");
      expect(env.VITE_APP_BUILD_SHA).toBe("a".repeat(40));
      expect(env.VITE_SITE_URL).toBe("https://stg.clawhub.ai");
    },
  );

  it("rejects staging frontend builds without a Git commit SHA", () => {
    expect(() =>
      resolveFrontendBuildEnv({
        CLAWHUB_ENV: "staging",
        CLAWHUB_STAGING_EDGE_SECRET: "s".repeat(48),
        SITE_URL: "https://stg.clawhub.ai",
        VERCEL_ENV: "preview",
        VERCEL_TARGET_ENV: "preview",
        VERCEL_GIT_COMMIT_REF: "staging",
        VITE_CONVEX_URL: "https://cheery-civet-733.convex.cloud",
        VITE_CONVEX_SITE_URL: "https://cheery-civet-733.convex.site",
        VITE_SITE_URL: "https://stg.clawhub.ai",
      }),
    ).toThrow("Staging Vercel builds require a full VERCEL_GIT_COMMIT_SHA");
  });

  it("rejects a production canonical URL when invoked directly", () => {
    expect(() =>
      resolveFrontendBuildEnv({
        CLAWHUB_ENV: "staging",
        CLAWHUB_STAGING_EDGE_SECRET: "s".repeat(48),
        SITE_URL: "https://stg.clawhub.ai",
        VERCEL_ENV: "preview",
        VERCEL_GIT_COMMIT_REF: "staging",
        VERCEL_GIT_COMMIT_SHA: "a".repeat(40),
        VITE_CONVEX_URL: "https://cheery-civet-733.convex.cloud",
        VITE_CONVEX_SITE_URL: "https://cheery-civet-733.convex.site",
        VITE_SITE_URL: "https://clawhub.ai",
      }),
    ).toThrow("Staging Vercel builds require matching SITE_URL and VITE_SITE_URL");
  });
});
