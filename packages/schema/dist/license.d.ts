/** SPDX identifier: printable ASCII — letters, digits, dots, hyphens, plus signs. */
export declare const SPDX_TOKEN_RE: RegExp;
export declare const MAX_SPDX_LENGTH = 64;
export declare const MAX_LICENSE_URI_LENGTH = 2048;
export type SkillLicense = {
    spdx: string;
    transferable?: boolean;
    commercialUse?: boolean;
    commercialAttribution?: boolean;
    derivativesAllowed?: boolean;
    derivativesAttribution?: boolean;
    derivativesApproval?: boolean;
    derivativesReciprocal?: boolean;
    uri?: string;
};
export declare const KNOWN_SPDX_IDENTIFIERS: Set<string>;
export declare function isKnownSpdx(spdx: string): boolean;
export type LicensePreset = {
    transferable: boolean;
    commercialUse: boolean;
    commercialAttribution: boolean;
    derivativesAllowed: boolean;
    derivativesAttribution: boolean;
    derivativesApproval: boolean;
    derivativesReciprocal: boolean;
    summary: string;
};
export declare const LICENSE_PRESETS: Record<string, LicensePreset>;
