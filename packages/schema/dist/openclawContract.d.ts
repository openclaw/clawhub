import type { PackageCompatibility } from "./packages.js";
export type OpenClawExternalPluginValidationIssue = {
    fieldPath: string;
    message: string;
};
export type OpenClawExternalCodePluginValidation = {
    compatibility?: PackageCompatibility;
    issues: OpenClawExternalPluginValidationIssue[];
};
export declare const OPENCLAW_EXTERNAL_CODE_PLUGIN_REQUIRED_FIELD_PATHS: readonly ["openclaw.compat.pluginApi", "openclaw.build.openclawVersion"];
export declare function normalizeOpenClawExternalPluginCompatibility(packageJson: unknown): PackageCompatibility | undefined;
export declare function listMissingOpenClawExternalCodePluginFieldPaths(packageJson: unknown): string[];
export declare function validateOpenClawExternalCodePluginPackageJson(packageJson: unknown): OpenClawExternalCodePluginValidation;
