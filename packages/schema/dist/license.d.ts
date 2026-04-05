import { type inferred } from "arktype";
import { PLATFORM_SKILL_LICENSE, PLATFORM_SKILL_LICENSE_NAME, PLATFORM_SKILL_LICENSE_SUMMARY, PLATFORM_SKILL_LICENSE_URL } from "./licenseConstants.js";
export { PLATFORM_SKILL_LICENSE, PLATFORM_SKILL_LICENSE_NAME, PLATFORM_SKILL_LICENSE_SUMMARY, PLATFORM_SKILL_LICENSE_URL, };
export declare const SkillPlatformLicenseSchema: import("arktype/internal/variants/string.ts").StringType<"MIT-0", {}>;
export type SkillPlatformLicense = (typeof SkillPlatformLicenseSchema)[inferred];
