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
const COMPILED_RUNTIME_EXTENSIONS = [".js", ".mjs", ".cjs"] as const;

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getTrimmedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getTrimmedStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
        .map((entry) => entry.trim())
    : [];
}

function normalizePackagePath(value: string): string {
  return value.trim().replaceAll("\\", "/").replace(/^\.\//, "");
}

function isTypeScriptRuntimeEntry(value: string): boolean {
  return /\.(?:c|m)?ts$/u.test(value);
}

function compiledRuntimeCandidates(entry: string): string[] {
  const normalized = normalizePackagePath(entry);
  const withoutExtension = normalized.replace(/\.[^.]+$/u, "");
  const distBase = normalized.startsWith("src/")
    ? `dist/${normalized.slice("src/".length).replace(/\.[^.]+$/u, "")}`
    : `dist/${withoutExtension}`;
  return [
    ...COMPILED_RUNTIME_EXTENSIONS.map((ext) => `${distBase}${ext}`),
    ...COMPILED_RUNTIME_EXTENSIONS.map((ext) => `${withoutExtension}${ext}`),
  ];
}

function readOpenClawBlock(packageJson: unknown) {
  const root = isRecord(packageJson) ? packageJson : undefined;
  const openclaw = isRecord(root?.openclaw) ? root.openclaw : undefined;
  const compat = isRecord(openclaw?.compat) ? openclaw.compat : undefined;
  const build = isRecord(openclaw?.build) ? openclaw.build : undefined;
  const install = isRecord(openclaw?.install) ? openclaw.install : undefined;
  return { root, openclaw, compat, build, install };
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

export function validateOpenClawExternalCodePluginPackageContents(
  packageJson: unknown,
  filePaths: Iterable<string>,
): OpenClawExternalCodePluginValidation {
  const validation = validateOpenClawExternalCodePluginPackageJson(packageJson);
  const { root, openclaw } = readOpenClawBlock(packageJson);
  const name = getTrimmedString(root?.name) ?? "package";
  const packageFiles = new Set(Array.from(filePaths, normalizePackagePath));
  const sourceEntries = getTrimmedStringArray(openclaw?.extensions);
  const runtimeEntries = getTrimmedStringArray(openclaw?.runtimeExtensions);

  if (runtimeEntries.length > 0 && runtimeEntries.length !== sourceEntries.length) {
    validation.issues.push({
      fieldPath: "openclaw.runtimeExtensions",
      message: `${name} openclaw.runtimeExtensions length (${runtimeEntries.length}) must match openclaw.extensions length (${sourceEntries.length}).`,
    });
  }

  for (const runtimeEntry of runtimeEntries) {
    const normalized = normalizePackagePath(runtimeEntry);
    if (!packageFiles.has(normalized)) {
      validation.issues.push({
        fieldPath: "openclaw.runtimeExtensions",
        message: `${name} runtime extension entry not found: ./${normalized}`,
      });
    }
  }

  if (runtimeEntries.length === 0) {
    for (const sourceEntry of sourceEntries) {
      if (!isTypeScriptRuntimeEntry(sourceEntry)) continue;
      const candidates = compiledRuntimeCandidates(sourceEntry);
      if (candidates.some((candidate) => packageFiles.has(candidate))) continue;
      validation.issues.push({
        fieldPath: "openclaw.extensions",
        message: `${name} requires compiled runtime output for TypeScript entry ${sourceEntry}: expected ${candidates.map((candidate) => `./${candidate}`).join(", ")}`,
      });
    }
  }

  return validation;
}
