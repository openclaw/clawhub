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
        readonly commit: "e8d152874264228400ffc0f8f2f36080a32b4055";
        readonly path: "src/templates/schema.ts";
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
