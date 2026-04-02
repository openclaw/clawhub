import type { PackageCompatibility } from "./packages.js";

type JsonObject = Record<string, unknown>;

export type OpenClawExternalPluginValidationIssue = {
  fieldPath: string;
  message: string;
};

export type OpenClawExternalCodePluginValidation = {
  compatibility?: PackageCompatibility;
  issues: OpenClawExternalPluginValidationIssue[];
};

export const OPENCLAW_EXTERNAL_CODE_PLUGIN_REQUIRED_FIELD_PATHS = [
  "openclaw.compat.pluginApi",
  "openclaw.build.openclawVersion",
] as const;

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getTrimmedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readOpenClawBlock(packageJson: unknown) {
  const root = isRecord(packageJson) ? packageJson : undefined;
  const openclaw = isRecord(root?.openclaw) ? root.openclaw : undefined;
  const compat = isRecord(openclaw?.compat) ? openclaw.compat : undefined;
  const build = isRecord(openclaw?.build) ? openclaw.build : undefined;
  const install = isRecord(openclaw?.install) ? openclaw.install : undefined;
  return { root, compat, build, install };
}

export function normalizeOpenClawExternalPluginCompatibility(
  packageJson: unknown,
): PackageCompatibility | undefined {
  const { root, compat, build, install } = readOpenClawBlock(packageJson);
  const version = getTrimmedString(root?.version);
  const minHostVersion = getTrimmedString(install?.minHostVersion);
  const compatibility: PackageCompatibility = {};

  const pluginApi = getTrimmedString(compat?.pluginApi);
  if (pluginApi) {
    compatibility.pluginApiRange = pluginApi;
  }

  const minGatewayVersion = getTrimmedString(compat?.minGatewayVersion) ?? minHostVersion;
  if (minGatewayVersion) {
    compatibility.minGatewayVersion = minGatewayVersion;
  }

  const builtWithOpenClawVersion = getTrimmedString(build?.openclawVersion) ?? version;
  if (builtWithOpenClawVersion) {
    compatibility.builtWithOpenClawVersion = builtWithOpenClawVersion;
  }

  const pluginSdkVersion = getTrimmedString(build?.pluginSdkVersion);
  if (pluginSdkVersion) {
    compatibility.pluginSdkVersion = pluginSdkVersion;
  }

  return Object.keys(compatibility).length > 0 ? compatibility : undefined;
}

export function listMissingOpenClawExternalCodePluginFieldPaths(packageJson: unknown): string[] {
  const { compat, build } = readOpenClawBlock(packageJson);
  const missing: string[] = [];
  if (!getTrimmedString(compat?.pluginApi)) {
    missing.push("openclaw.compat.pluginApi");
  }
  if (!getTrimmedString(build?.openclawVersion)) {
    missing.push("openclaw.build.openclawVersion");
  }
  return missing;
}

export function validateOpenClawExternalCodePluginPackageJson(
  packageJson: unknown,
): OpenClawExternalCodePluginValidation {
  const issues = listMissingOpenClawExternalCodePluginFieldPaths(packageJson).map((fieldPath) => ({
    fieldPath,
    message: `${fieldPath} is required for external code plugins published to ClawHub.`,
  }));
  return {
    compatibility: normalizeOpenClawExternalPluginCompatibility(packageJson),
    issues,
  };
}
