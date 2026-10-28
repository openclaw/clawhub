import { type TemplateManifest, type TemplateManifestSummary } from "./templates.js";
export type TemplatePackageTextFile = {
    path: string;
    text?: string;
};
export type TemplatePackageValidationIssue = {
    code: string;
    path: string;
    message: string;
};
export type ValidatedTemplatePackage = {
    manifestPath: string;
    manifest: TemplateManifest;
    summary: TemplateManifestSummary;
    hasTemplateMarkdownBody: boolean;
};
export type OpenClawProfilePolicy = "current" | "publication-compatible";
export declare const OPENCLAW_TEMPLATE_PROFILE_POLICY_V1: {
    readonly contractVersion: 1;
    readonly source: {
        readonly repository: "openclaw/openclaw";
        readonly commit: "f8c0e1b8325b1fc36e039cf357a2c4602f76d5aa";
        readonly path: "src/claws/schema.ts";
    };
    readonly profiles: readonly ["minimal", "coding", "messaging", "full"];
};
export declare function isSafeTemplatePackagePath(value: string): boolean;
export declare function findTemplatePackagePathHierarchyCollision(paths: readonly string[]): {
    ancestor: string;
    descendant: string;
} | null;
export declare function validateTemplatePackageContents(input: {
    packageName: string;
    version: string;
    packageJson: unknown;
    files: readonly TemplatePackageTextFile[];
    openClawProfilePolicy?: OpenClawProfilePolicy;
}): {
    ok: true;
    value: ValidatedTemplatePackage;
} | {
    ok: false;
    issues: TemplatePackageValidationIssue[];
};
