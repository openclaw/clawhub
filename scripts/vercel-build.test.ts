import { describe, expect, it } from "vitest";
import { resolveVercelBuildPlan } from "./vercel-build";

describe("Vercel build plan", () => {
  it("recreates and seeds the branch Convex deployment for previews", () => {
    expect(
      resolveVercelBuildPlan({
        VERCEL_ENV: "preview",
        VERCEL_GIT_COMMIT_REF: "pe/claw-413-pr-previews",
        CONVEX_DEPLOY_KEY: "preview:openclaw:clawhub|secret",
      }),
    ).toEqual([
      {
        command: "bunx",
        args: [
          "convex",
          "deploy",
          "--preview-create",
          "pe/claw-413-pr-previews",
          "--cmd",
          "bun scripts/vercel-build-frontend.ts",
          "--cmd-url-env-var-name",
          "VITE_CONVEX_URL",
        ],
      },
      {
        command: "bun",
        args: ["run", "seed", "--", "--preview-name", "pe/claw-413-pr-previews"],
      },
    ]);
  });

  it("fails closed when a preview deploy key is missing or has the wrong type", () => {
    expect(() =>
      resolveVercelBuildPlan({
        VERCEL_ENV: "preview",
        VERCEL_GIT_COMMIT_REF: "feature/demo",
      }),
    ).toThrow("Preview builds require a Convex Preview deploy key");

    expect(() =>
      resolveVercelBuildPlan({
        VERCEL_ENV: "preview",
        VERCEL_GIT_COMMIT_REF: "feature/demo",
        CONVEX_DEPLOY_KEY: "prod:wry-manatee-359|secret",
      }),
    ).toThrow("Preview builds require a Convex Preview deploy key");
  });

  it("runs the ordinary frontend build for production and rejects deploy credentials", () => {
    expect(resolveVercelBuildPlan({ VERCEL_ENV: "production" })).toEqual([
      {
        command: "bun",
        args: ["scripts/vercel-build-frontend.ts"],
      },
    ]);

    expect(() =>
      resolveVercelBuildPlan({
        VERCEL_ENV: "production",
        CONVEX_DEPLOY_KEY: "prod:wry-manatee-359|secret",
      }),
    ).toThrow("Production Vercel builds must not receive CONVEX_DEPLOY_KEY");
  });
});
