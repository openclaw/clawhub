import { type inferred, type } from "arktype";
import {
  PLATFORM_SKILL_LICENSE,
  PLATFORM_SKILL_LICENSE_NAME,
  PLATFORM_SKILL_LICENSE_SUMMARY,
  PLATFORM_SKILL_LICENSE_URL,
} from "./licenseConstants.js";

export {
  PLATFORM_SKILL_LICENSE,
  PLATFORM_SKILL_LICENSE_NAME,
  PLATFORM_SKILL_LICENSE_SUMMARY,
  PLATFORM_SKILL_LICENSE_URL,
};

export const SkillPlatformLicenseSchema = type('"MIT-0"');
export type SkillPlatformLicense = (typeof SkillPlatformLicenseSchema)[inferred];
