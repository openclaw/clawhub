/* @vitest-environment node */
import { describe, expect, it } from "vitest";
import { getSkillsShFixtureEnvironmentPolicy } from "./skillsShCatalogEnvironment";

describe("skills.sh fixture environment policy", () => {
  it("allows only local development or the exact cron-disabled Test deployment", () => {
    expect(
      getSkillsShFixtureEnvironmentPolicy({
        CONVEX_CLOUD_URL: "http://127.0.0.1:3210",
      }),
    ).toEqual({ allowed: true, environment: "local" });

    expect(
      getSkillsShFixtureEnvironmentPolicy({
        CLAWHUB_DEPLOYMENT_NAME: "academic-chihuahua-392",
        CLAWHUB_DISABLE_CRONS: "1",
        CLAWHUB_ENV: "test",
        CONVEX_CLOUD_URL: "https://academic-chihuahua-392.convex.cloud",
      }),
    ).toEqual({ allowed: true, environment: "test" });
  });

  it("rejects previews, production, and incomplete Test markers", () => {
    expect(
      getSkillsShFixtureEnvironmentPolicy({
        CLAWHUB_PREVIEW: "1",
        CONVEX_DEPLOYMENT: "anonymous:clawhub",
      }),
    ).toMatchObject({ allowed: false, environment: "preview" });

    expect(
      getSkillsShFixtureEnvironmentPolicy({
        CLAWHUB_DEPLOYMENT_NAME: "academic-chihuahua-392",
        CLAWHUB_ENV: "test",
      }),
    ).toMatchObject({ allowed: false, environment: "test" });

    expect(
      getSkillsShFixtureEnvironmentPolicy({
        CLAWHUB_DEPLOYMENT_NAME: "wry-manatee-359",
        CLAWHUB_DISABLE_CRONS: "1",
        CLAWHUB_ENV: "test",
        CONVEX_CLOUD_URL: "https://academic-chihuahua-392.convex.cloud",
      }),
    ).toMatchObject({ allowed: false, environment: "test" });

    expect(
      getSkillsShFixtureEnvironmentPolicy({
        CONVEX_DEPLOYMENT: "prod:wry-manatee-359",
      }),
    ).toMatchObject({ allowed: false, environment: "production" });

    expect(
      getSkillsShFixtureEnvironmentPolicy({
        CLAWHUB_DEPLOYMENT_NAME: "wry-manatee-359",
        CONVEX_CLOUD_URL: "http://127.0.0.1:3210",
      }),
    ).toMatchObject({ allowed: false, environment: "production" });

    expect(
      getSkillsShFixtureEnvironmentPolicy({
        CLAWHUB_DEPLOYMENT_NAME: "academic-chihuahua-392",
        CLAWHUB_DISABLE_CRONS: "1",
        CLAWHUB_ENV: "test",
        CONVEX_DEPLOYMENT: "prod:wry-manatee-359",
        CONVEX_CLOUD_URL: "https://academic-chihuahua-392.convex.cloud",
      }),
    ).toMatchObject({ allowed: false, environment: "production" });

    expect(
      getSkillsShFixtureEnvironmentPolicy({
        CLAWHUB_DEPLOYMENT_NAME: "academic-chihuahua-392",
        CLAWHUB_DISABLE_CRONS: "1",
        CLAWHUB_ENV: "test",
        CONVEX_CLOUD_URL: "https://preview-project.convex.cloud",
      }),
    ).toMatchObject({ allowed: false, environment: "test" });

    expect(
      getSkillsShFixtureEnvironmentPolicy({
        CLAWHUB_DEPLOYMENT_NAME: "academic-chihuahua-392",
        CLAWHUB_DISABLE_CRONS: "1",
        CLAWHUB_ENV: "test",
        CLAWHUB_PREVIEW: "1",
        CONVEX_CLOUD_URL: "https://academic-chihuahua-392.convex.cloud",
      }),
    ).toMatchObject({ allowed: false, environment: "preview" });
  });

  it("does not treat CLI-only local deployment markers as runtime proof", () => {
    expect(
      getSkillsShFixtureEnvironmentPolicy({
        CONVEX_DEPLOYMENT: "local:clawhub",
      }),
    ).toMatchObject({ allowed: false, environment: "unknown" });
  });

  it("rejects conflicting populated Convex runtime URLs", () => {
    expect(
      getSkillsShFixtureEnvironmentPolicy({
        CLAWHUB_DEPLOYMENT_NAME: "academic-chihuahua-392",
        CLAWHUB_DISABLE_CRONS: "1",
        CLAWHUB_ENV: "test",
        CONVEX_CLOUD_URL: "https://academic-chihuahua-392.convex.cloud",
        CONVEX_SITE_URL: "https://preview-project.convex.site",
      }),
    ).toMatchObject({ allowed: false, environment: "test" });

    expect(
      getSkillsShFixtureEnvironmentPolicy({
        CONVEX_CLOUD_URL: "http://127.0.0.1:3210",
        CONVEX_SITE_URL: "https://academic-chihuahua-392.convex.site",
      }),
    ).toMatchObject({ allowed: false, environment: "unknown" });
  });
});
