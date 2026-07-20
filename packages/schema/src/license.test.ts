/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import { parseArk } from "./ark";
import {
  getSkillLicenseSummary,
  MIT_SKILL_LICENSE_SUMMARY,
  normalizeSupportedSkillLicense,
  PLATFORM_SKILL_LICENSE,
  SkillPlatformLicenseSchema,
} from "./license";

describe("clawhub-schema license", () => {
  it("accepts MIT and MIT-0 skill licenses", () => {
    expect(parseArk(SkillPlatformLicenseSchema, "MIT-0", "License")).toBe("MIT-0");
    expect(parseArk(SkillPlatformLicenseSchema, "MIT", "License")).toBe("MIT");
  });

  it("normalizes supported SPDX license identifiers", () => {
    expect(normalizeSupportedSkillLicense("mit")).toBe("MIT");
    expect(normalizeSupportedSkillLicense("MIT-0")).toBe(PLATFORM_SKILL_LICENSE);
    expect(normalizeSupportedSkillLicense("Apache-2.0")).toBeNull();
  });

  it("returns the matching summary for standard MIT", () => {
    expect(getSkillLicenseSummary("MIT")).toBe(MIT_SKILL_LICENSE_SUMMARY);
  });
});
