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

  it("detects explicit Test and production runtimes", () => {
    expect(
      getClawHubRuntimeEnvironment({
        CLAWHUB_ENV: "test",
        CLAWHUB_DEPLOYMENT_NAME: "academic-chihuahua-392",
      }),
    ).toBe("test");
    expect(
      getClawHubRuntimeEnvironment({
        CONVEX_DEPLOYMENT: "prod:wry-manatee-359",
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
