export const PLATFORM_SKILL_LICENSE = "MIT-0" as const;
export const PLATFORM_SKILL_LICENSE_NAME = "MIT No Attribution" as const;
export const PLATFORM_SKILL_LICENSE_SUMMARY =
  "Free to use, modify, and redistribute. No attribution required." as const;
export const PLATFORM_SKILL_LICENSE_URL = "https://spdx.org/licenses/MIT-0.html" as const;
export const MIT_SKILL_LICENSE = "MIT" as const;
export const MIT_SKILL_LICENSE_NAME = "MIT License" as const;
export const MIT_SKILL_LICENSE_SUMMARY =
  "Free to use, modify, and redistribute. Attribution required." as const;
export const MIT_SKILL_LICENSE_URL = "https://spdx.org/licenses/MIT.html" as const;
export const SUPPORTED_SKILL_LICENSES = [PLATFORM_SKILL_LICENSE, MIT_SKILL_LICENSE] as const;

export type SupportedSkillLicense = (typeof SUPPORTED_SKILL_LICENSES)[number];

export function normalizeSupportedSkillLicense(value: unknown): SupportedSkillLicense | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  if (normalized === PLATFORM_SKILL_LICENSE) return PLATFORM_SKILL_LICENSE;
  if (normalized === MIT_SKILL_LICENSE) return MIT_SKILL_LICENSE;
  return null;
}

export function getSkillLicenseSummary(license: SupportedSkillLicense) {
  return license === MIT_SKILL_LICENSE ? MIT_SKILL_LICENSE_SUMMARY : PLATFORM_SKILL_LICENSE_SUMMARY;
}
