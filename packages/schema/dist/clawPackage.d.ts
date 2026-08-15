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
    hasClawMarkdownBody: boolean;
};
export type OpenClawProfilePolicy = "current" | "publication-compatible";
export declare const OPENCLAW_CLAW_PROFILE_POLICY_V1: {
    readonly contractVersion: 1;
    readonly source: {
        readonly repository: "openclaw/openclaw";
        readonly commit: "f8c0e1b8325b1fc36e039cf357a2c4602f76d5aa";
        readonly path: "src/claws/schema.ts";
    };
    readonly profiles: readonly ["minimal", "coding", "messaging", "full"];
};
export declare function isSafeClawPackagePath(value: string): boolean;
export declare function findClawPackagePathHierarchyCollision(paths: readonly string[]): {
    ancestor: string;
    descendant: string;
} | null;
export declare function validateClawPackageContents(input: {
    packageName: string;
    version: string;
    packageJson: unknown;
    files: readonly ClawPackageTextFile[];
    openClawProfilePolicy?: OpenClawProfilePolicy;
}): {
    ok: true;
    value: ValidatedClawPackage;
} | {
    ok: false;
    issues: ClawPackageValidationIssue[];
};
