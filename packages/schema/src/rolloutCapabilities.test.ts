import { describe, expect, it } from "vitest";
import {
  getClawHubRolloutCapabilities,
  getClawHubRuntimeEnvironment,
  parseRolloutMode,
} from "./rolloutCapabilities.js";

describe("rollout capabilities", () => {
  it("defaults missing and invalid modes to off", () => {
    expect(parseRolloutMode(undefined)).toBe("off");
    expect(parseRolloutMode("")).toBe("off");
    expect(parseRolloutMode("enabled")).toBe("off");
  });

  it("detects explicit Test, staging, and production runtimes", () => {
    expect(
      getClawHubRuntimeEnvironment({
        CLAWHUB_ENV: "test",
        CLAWHUB_DEPLOYMENT_NAME: "academic-chihuahua-392",
      }),
    ).toBe("test");
    expect(
      getClawHubRuntimeEnvironment({
        CLAWHUB_ENV: "staging",
        CONVEX_DEPLOYMENT: "prod:cheery-civet-733",
      }),
    ).toBe("staging");
    expect(
      getClawHubRuntimeEnvironment({
        CONVEX_DEPLOYMENT: "prod:wry-manatee-359",
      }),
    ).toBe("production");
  });

  it("never classifies the dedicated staging deployment as production", () => {
    for (const marker of [undefined, "staging", "production", "test"]) {
      expect(
        getClawHubRuntimeEnvironment({
          CLAWHUB_ENV: marker,
          CONVEX_DEPLOYMENT: "prod:cheery-civet-733",
        }),
      ).toBe("staging");
    }
    expect(
      getClawHubRuntimeEnvironment({
        CLAWHUB_ENV: "staging",
        CLAWHUB_DEPLOYMENT_NAME: "cheery-civet-733",
      }),
    ).toBe("staging");
    expect(
      getClawHubRuntimeEnvironment({
        CLAWHUB_ENV: "staging",
        CONVEX_DEPLOYMENT: "prod:wry-manatee-359",
        VERCEL_TARGET_ENV: "staging",
      }),
    ).toBe("production");
  });

  it("allows test mode only in local and Test runtimes", () => {
    expect(
      getClawHubRolloutCapabilities({
        CLAWHUB_ENV: "test",
        CLAWHUB_SKILLS_SH_ROLLOUT_MODE: "test",
        CLAWHUB_GITHUB_SKILL_SYNC_ROLLOUT_MODE: "off",
      }),
    ).toMatchObject({
      environment: "test",
      skillsSh: { mode: "test", runtimeEnabled: true },
      githubSkillSync: { mode: "off", runtimeEnabled: false },
    });
    expect(
      getClawHubRolloutCapabilities({
        CONVEX_DEPLOYMENT: "local:clawhub",
        CLAWHUB_GITHUB_SKILL_SYNC_ROLLOUT_MODE: "test",
      }).githubSkillSync,
    ).toMatchObject({ mode: "test", runtimeEnabled: true });
  });

  it("fails closed when test mode is configured in production", () => {
    expect(
      getClawHubRolloutCapabilities({
        CONVEX_DEPLOYMENT: "prod:wry-manatee-359",
        CLAWHUB_SKILLS_SH_ROLLOUT_MODE: "test",
        CLAWHUB_GITHUB_SKILL_SYNC_ROLLOUT_MODE: "test",
      }),
    ).toMatchObject({
      environment: "production",
      skillsSh: {
        mode: "test",
        runtimeEnabled: false,
        reason: "environment-mismatch",
      },
      githubSkillSync: {
        mode: "test",
        runtimeEnabled: false,
        reason: "environment-mismatch",
      },
    });
  });

  it("lets Preview evidence override inherited Test markers", () => {
    expect(
      getClawHubRolloutCapabilities({
        CLAWHUB_ENV: "test",
        CLAWHUB_PREVIEW: "1",
        CLAWHUB_SKILLS_SH_ROLLOUT_MODE: "test",
        CLAWHUB_GITHUB_SKILL_SYNC_ROLLOUT_MODE: "test",
      }),
    ).toMatchObject({
      environment: "preview",
      skillsSh: { mode: "test", runtimeEnabled: false },
      githubSkillSync: { mode: "test", runtimeEnabled: false },
    });
    expect(
      getClawHubRolloutCapabilities({
        CLAWHUB_ENV: "test",
        VERCEL_ENV: "preview",
        CLAWHUB_SKILLS_SH_ROLLOUT_MODE: "test",
      }).skillsSh,
    ).toMatchObject({ mode: "test", runtimeEnabled: false });
  });

  it("recognizes the permanent Test target inside a Vercel preview deployment", () => {
    expect(
      getClawHubRolloutCapabilities({
        CLAWHUB_ENV: "test",
        VERCEL_ENV: "preview",
        VERCEL_TARGET_ENV: "test",
        CLAWHUB_SKILLS_SH_ROLLOUT_MODE: "test",
      }),
    ).toMatchObject({
      environment: "test",
      skillsSh: { mode: "test", runtimeEnabled: true },
    });
  });

  it.each(["preview", "staging"])(
    "recognizes permanent Staging with Vercel target %s",
    (targetEnvironment) => {
      expect(
        getClawHubRolloutCapabilities({
          CLAWHUB_ENV: "staging",
          VERCEL_ENV: "preview",
          VERCEL_TARGET_ENV: targetEnvironment,
          VITE_CLAWHUB_DEPLOY_ENV: "staging",
          VITE_CONVEX_URL: "https://cheery-civet-733.convex.cloud",
          CLAWHUB_SKILLS_SH_ROLLOUT_MODE: "production",
          CLAWHUB_GITHUB_SKILL_SYNC_ROLLOUT_MODE: "test",
        }),
      ).toMatchObject({
        environment: "staging",
        skillsSh: {
          mode: "production",
          runtimeEnabled: false,
          reason: "environment-mismatch",
        },
        githubSkillSync: { mode: "test", runtimeEnabled: false, reason: "environment-mismatch" },
      });
    },
  );

  it("treats an ordinary preview with a stale Staging marker as preview", () => {
    expect(
      getClawHubRuntimeEnvironment({
        CLAWHUB_ENV: "staging",
        CLAWHUB_PREVIEW: "1",
        VERCEL_ENV: "preview",
      }),
    ).toBe("preview");
  });

  it("lets a production deployment override a conflicting Test marker", () => {
    expect(
      getClawHubRolloutCapabilities({
        CLAWHUB_DEPLOYMENT_NAME: "academic-chihuahua-392",
        CLAWHUB_ENV: "test",
        CONVEX_DEPLOYMENT: "prod:wry-manatee-359",
        CLAWHUB_SKILLS_SH_ROLLOUT_MODE: "test",
        CLAWHUB_GITHUB_SKILL_SYNC_ROLLOUT_MODE: "test",
      }),
    ).toMatchObject({
      environment: "production",
      skillsSh: {
        mode: "test",
        runtimeEnabled: false,
        reason: "environment-mismatch",
      },
      githubSkillSync: {
        mode: "test",
        runtimeEnabled: false,
        reason: "environment-mismatch",
      },
    });
  });

  it("allows production mode only in production", () => {
    expect(
      getClawHubRolloutCapabilities({
        CONVEX_DEPLOYMENT: "prod:wry-manatee-359",
        CLAWHUB_SKILLS_SH_ROLLOUT_MODE: "production",
      }).skillsSh,
    ).toMatchObject({ mode: "production", runtimeEnabled: true });
    expect(
      getClawHubRolloutCapabilities({
        CLAWHUB_ENV: "test",
        CLAWHUB_SKILLS_SH_ROLLOUT_MODE: "production",
      }).skillsSh,
    ).toMatchObject({
      mode: "production",
      runtimeEnabled: false,
      reason: "environment-mismatch",
    });
  });
});
