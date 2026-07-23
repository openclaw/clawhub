import { type ClawManifest, type ClawManifestSummary } from "./claws.js";
export type ClawPackageTextFile = {
    path: string;
    text?: string;
};
export type ClawPackageValidationIssue = {
    code: string;
    path: string;
    message: string;
};
export type ValidatedClawPackage = {
    manifestPath: string;
    manifest: ClawManifest;
    summary: ClawManifestSummary;
};
export declare function isSafeClawPackagePath(value: string): boolean;
export declare function validateClawPackageContents(input: {
    packageName: string;
    version: string;
    packageJson: unknown;
    files: readonly ClawPackageTextFile[];
}): {
    ok: true;
    value: ValidatedClawPackage;
} | {
    ok: false;
    issues: ClawPackageValidationIssue[];
};
