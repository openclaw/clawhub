import { type inferred, type } from "arktype";
import {
  PLATFORM_SKILL_LICENSE,
  PLATFORM_SKILL_LICENSE_NAME,
  PLATFORM_SKILL_LICENSE_SUMMARY,
  PLATFORM_SKILL_LICENSE_URL,
  MIT_SKILL_LICENSE,
  MIT_SKILL_LICENSE_NAME,
  MIT_SKILL_LICENSE_SUMMARY,
  MIT_SKILL_LICENSE_URL,
  SUPPORTED_SKILL_LICENSES,
  getSkillLicenseSummary,
  normalizeSupportedSkillLicense,
} from "./licenseConstants.js";

export {
  PLATFORM_SKILL_LICENSE,
  PLATFORM_SKILL_LICENSE_NAME,
  PLATFORM_SKILL_LICENSE_SUMMARY,
  PLATFORM_SKILL_LICENSE_URL,
  MIT_SKILL_LICENSE,
  MIT_SKILL_LICENSE_NAME,
  MIT_SKILL_LICENSE_SUMMARY,
  MIT_SKILL_LICENSE_URL,
  SUPPORTED_SKILL_LICENSES,
  getSkillLicenseSummary,
  normalizeSupportedSkillLicense,
};

export const SkillPlatformLicenseSchema = type('"MIT-0"|"MIT"');
export type SkillPlatformLicense = (typeof SkillPlatformLicenseSchema)[inferred];
