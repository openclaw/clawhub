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
/**
 * Validates package metadata plus the declared OpenClaw entrypoints against the
 * uploaded file list. Entry checks follow OpenClaw's installed-package rules so a
 * release ClawHub accepts is one OpenClaw can load.
 */
export declare function validateOpenClawExternalCodePluginPackageContents(packageJson: unknown, filePaths: Iterable<string>): OpenClawExternalCodePluginValidation;
