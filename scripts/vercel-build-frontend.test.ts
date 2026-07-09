import { describe, expect, it } from "vitest";
import { resolveFrontendBuildEnv } from "./vercel-build-frontend";

describe("Vercel frontend build environment", () => {
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

  it("preserves the permanent backend URLs for the custom test environment", () => {
    const env = resolveFrontendBuildEnv({
      VERCEL_ENV: "preview",
      VERCEL_TARGET_ENV: "test",
      VITE_CONVEX_URL: "https://academic-chihuahua-392.convex.cloud",
      VITE_CONVEX_SITE_URL: "https://academic-chihuahua-392.convex.site",
    });

    expect(env.VITE_CONVEX_SITE_URL).toBe("https://academic-chihuahua-392.convex.site");
    expect(env.VITE_CLAWHUB_DEPLOY_ENV).toBe("test");
  });
});
