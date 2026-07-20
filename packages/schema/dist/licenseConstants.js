export const PLATFORM_SKILL_LICENSE = "MIT-0";
export const PLATFORM_SKILL_LICENSE_NAME = "MIT No Attribution";
export const PLATFORM_SKILL_LICENSE_SUMMARY = "Free to use, modify, and redistribute. No attribution required.";
export const PLATFORM_SKILL_LICENSE_URL = "https://spdx.org/licenses/MIT-0.html";
export const MIT_SKILL_LICENSE = "MIT";
export const MIT_SKILL_LICENSE_NAME = "MIT License";
export const MIT_SKILL_LICENSE_SUMMARY = "Free to use, modify, and redistribute. Attribution required.";
export const MIT_SKILL_LICENSE_URL = "https://spdx.org/licenses/MIT.html";
export const SUPPORTED_SKILL_LICENSES = [PLATFORM_SKILL_LICENSE, MIT_SKILL_LICENSE];
export function normalizeSupportedSkillLicense(value) {
    if (typeof value !== "string")
        return null;
    const normalized = value.trim().toUpperCase();
    if (normalized === PLATFORM_SKILL_LICENSE)
        return PLATFORM_SKILL_LICENSE;
    if (normalized === MIT_SKILL_LICENSE)
        return MIT_SKILL_LICENSE;
    return null;
}
export function getSkillLicenseSummary(license) {
    return license === MIT_SKILL_LICENSE ? MIT_SKILL_LICENSE_SUMMARY : PLATFORM_SKILL_LICENSE_SUMMARY;
}
//# sourceMappingURL=licenseConstants.js.map