import { type inferred, type } from "arktype";

export const PLATFORM_SKILL_LICENSE = "MIT-0" as const;
export const PLATFORM_SKILL_LICENSE_NAME = "MIT No Attribution" as const;
export const PLATFORM_SKILL_LICENSE_SUMMARY =
  "Free to use, modify, and redistribute. No attribution required." as const;
export const PLATFORM_SKILL_LICENSE_URL = "https://spdx.org/licenses/MIT-0.html" as const;

export const SkillPlatformLicenseSchema = type('"MIT-0"');
export type SkillPlatformLicense = (typeof SkillPlatformLicenseSchema)[inferred];
