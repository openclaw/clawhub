import {
  listMissingOpenClawExternalCodePluginFieldPaths,
  normalizeOpenClawExternalPluginCompatibility,
} from "clawhub-schema";
import type {
  BundlePublishMetadata,
  PackageCapabilitySummary,
  PackageCompatibility,
  PackageVerificationSummary,
} from "clawhub-schema";
import { ConvexError } from "convex/values";
import semver from "semver";
import type { ActionCtx } from "../_generated/server";
import { getFrontmatterValue, parseFrontmatter, sanitizePath } from "./skills";

const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

type PublishFile = {
  path: string;
  size: number;
  storageId: string;
  sha256: string;
  contentType?: string;
};

type SourceInfo = {
  kind: "github";
  url: string;
  repo: string;
  ref: string;
  commit: string;
  path: string;
  importedAt: number;
};

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeStringList(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input.map((value) => String(value).trim()).filter(Boolean);
  }
  if (typeof input === "string") {
    return input
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeNamedList(input: unknown): string[] {
  if (!Array.isArray(input)) return normalizeStringList(input);
  return input
    .map((value) => {
      if (typeof value === "string") return value.trim();
      if (isRecord(value) && typeof value.name === "string") return value.name.trim();
      return "";
    })
    .filter(Boolean);
}

function uniq(items: Array<string | undefined | null>) {
  return [...new Set(items.map((item) => item?.trim()).filter(Boolean) as string[])];
}

export function normalizePackageName(name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new ConvexError("Package name required");
  const normalized = trimmed.toLowerCase();
  if (!PACKAGE_NAME_PATTERN.test(normalized)) {
    throw new ConvexError(
      "Package name must be lowercase and npm-safe (example: @scope/name or plugin-name)",
    );
  }
  return normalized;
}

export function normalizePublishFiles(files: PublishFile[]) {
  const normalized = files.map((file) => ({
    ...file,
    path: sanitizePath(file.path),
  }));
  if (normalized.some((file) => !file.path)) throw new ConvexError("Invalid file paths");
  return normalized.map((file) => ({ ...file, path: file.path as string }));
}

export function assertPackageVersion(
  family: "code-plugin" | "bundle-plugin" | "skill",
  version: string,
) {
  const trimmed = version.trim();
  if (!trimmed) throw new ConvexError("Version required");
  if (family === "code-plugin" && !semver.valid(trimmed)) {
    throw new ConvexError("Code plugin versions must be valid semver");
  }
  return trimmed;
}

export async function readStorageText(
  ctx: Pick<ActionCtx, "storage">,
  storageId: string,
): Promise<string> {
  const blob = await ctx.storage.get(storageId as never);
  if (!blob) throw new ConvexError("Uploaded file no longer exists");
  return await blob.text();
}

export async function readOptionalTextFile(
  ctx: Pick<ActionCtx, "storage">,
  files: PublishFile[],
  pathMatch: (path: string) => boolean,
) {
  const file = files.find((entry) => pathMatch(entry.path.toLowerCase()));
  if (!file) return null;
  return {
    file,
    text: await readStorageText(ctx, file.storageId),
  };
}

function parseJsonFile(text: string, label: string): JsonRecord {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!isRecord(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new ConvexError(`Invalid ${label}`);
  }
}

function deriveSummary(params: {
  packageName: string;
  packageJson?: JsonRecord;
  readmeText?: string | null;
}) {
  const directDescription =
    typeof params.packageJson?.description === "string"
      ? params.packageJson.description.trim()
      : "";
  if (directDescription) return directDescription;
  const readme = params.readmeText?.trim() ?? "";
  if (!readme) return params.packageName;

  const frontmatter = parseFrontmatter(readme);
  const fmDescription = getFrontmatterValue(frontmatter, "description");
  if (fmDescription?.trim()) return fmDescription.trim();

  const lines = readme
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .filter(Boolean);
  const candidate = lines.find((line) => line.length > 12 && !line.startsWith("---"));
  return candidate ?? params.packageName;
}

function buildVerification(source: SourceInfo | undefined): PackageVerificationSummary {
  if (!source) {
    return {
      tier: "structural",
      scope: "artifact-only",
      summary: "Validated package structure and extracted metadata.",
      scanStatus: "not-run",
    };
  }
  return {
    tier: "source-linked",
    scope: "artifact-only",
    summary: "Validated package structure and linked the release to source metadata.",
    sourceRepo: source.repo || source.url,
    sourceCommit: source.commit,
    sourceTag: source.ref,
    hasProvenance: false,
    scanStatus: "not-run",
  };
}

function extractCompatibility(
  packageJson: JsonRecord | undefined,
): PackageCompatibility | undefined {
  return normalizeOpenClawExternalPluginCompatibility(packageJson);
}

export function extractCodePluginArtifacts(params: {
  packageName: string;
  packageJson: JsonRecord;
  pluginManifest: JsonRecord;
  source?: SourceInfo;
}) {
  if (!params.source?.repo?.trim() || !params.source?.commit?.trim()) {
    throw new ConvexError("Code plugins must include source repo and commit metadata");
  }

  const openclaw = isRecord(params.packageJson.openclaw) ? params.packageJson.openclaw : undefined;
  const extensions = normalizeStringList(openclaw?.extensions);
  if (extensions.length === 0) {
    throw new ConvexError("package.json must declare openclaw.extensions");
  }

  const runtimeId =
    typeof params.pluginManifest.id === "string" ? params.pluginManifest.id.trim() : "";
  if (!runtimeId) throw new ConvexError("openclaw.plugin.json must declare an id");

  const compatibility = extractCompatibility(params.packageJson);
  const missingOpenClawFields = listMissingOpenClawExternalCodePluginFieldPaths(params.packageJson);
  if (missingOpenClawFields.length > 0) {
    throw new ConvexError(`package.json ${missingOpenClawFields[0]} is required`);
  }

  const channels = uniq([
    ...normalizeStringList(params.pluginManifest.channels),
    ...normalizeStringList(openclaw?.channels),
  ]);
  const providers = uniq([
    ...normalizeStringList(params.pluginManifest.providers),
    ...normalizeStringList(openclaw?.providers),
  ]);
  const hooks = uniq([
    ...normalizeNamedList(params.pluginManifest.hooks),
    ...normalizeNamedList(params.pluginManifest.typedHooks),
    ...normalizeNamedList(params.pluginManifest.customHooks),
    ...normalizeNamedList(params.pluginManifest.events),
  ]);
  const toolNames = uniq([
    ...normalizeNamedList(params.pluginManifest.tools),
    ...normalizeNamedList(openclaw?.tools),
  ]);
  const commandNames = uniq(normalizeNamedList(params.pluginManifest.commands));
  const serviceNames = uniq(normalizeNamedList(params.pluginManifest.services));
  const bundledSkills = uniq(normalizeNamedList(params.pluginManifest.bundledSkills));

  const httpRouteCount = Array.isArray(params.pluginManifest.httpRoutes)
    ? params.pluginManifest.httpRoutes.length
    : Array.isArray(params.pluginManifest.routes)
      ? params.pluginManifest.routes.length
      : 0;
  const hasConfigSchema =
    typeof params.pluginManifest.configSchema === "string" ||
    isRecord(params.pluginManifest.configSchema) ||
    isRecord(openclaw?.configSchema);
  if (!hasConfigSchema) {
    throw new ConvexError("Code plugins must declare a config schema");
  }

  const capabilities: PackageCapabilitySummary = {
    executesCode: true,
    runtimeId,
    pluginKind:
      typeof params.pluginManifest.kind === "string"
        ? params.pluginManifest.kind.trim()
        : undefined,
    channels,
    providers,
    hooks,
    bundledSkills,
    setupEntry:
      typeof params.pluginManifest.setupEntry === "string" ||
      typeof openclaw?.setupEntry === "string",
    configSchema: hasConfigSchema,
    configUiHints:
      isRecord(params.pluginManifest.configUiHints) || isRecord(openclaw?.configUiHints),
    materializesDependencies: Boolean(openclaw?.materializesDependencies),
    toolNames,
    commandNames,
    serviceNames,
    httpRouteCount,
  };

  capabilities.capabilityTags = uniq([
    "executes-code",
    capabilities.pluginKind ? `kind:${capabilities.pluginKind}` : null,
    ...channels.map((entry) => `channel:${entry}`),
    ...providers.map((entry) => `provider:${entry}`),
    ...(capabilities.setupEntry ? ["setup"] : []),
    ...(toolNames.length > 0 ? ["tools"] : []),
  ]);

  return {
    runtimeId,
    compatibility,
    capabilities,
    verification: buildVerification(params.source),
  };
}

export function extractBundlePluginArtifacts(params: {
  packageName: string;
  packageJson?: JsonRecord;
  bundleManifest?: JsonRecord;
  bundleMetadata?: BundlePublishMetadata;
  source?: SourceInfo;
}) {
  const openclaw = isRecord(params.packageJson?.openclaw) ? params.packageJson.openclaw : undefined;
  const manifest = params.bundleManifest;
  const runtimeId =
    (typeof manifest?.id === "string" && manifest.id.trim()) ||
    params.bundleMetadata?.id?.trim() ||
    params.packageName;
  const hostTargets = uniq([
    ...normalizeStringList(manifest?.hostTargets),
    ...normalizeStringList(openclaw?.hostTargets),
    ...(params.bundleMetadata?.hostTargets ?? []),
  ]);
  const bundleFormat =
    (typeof manifest?.format === "string" && manifest.format.trim()) ||
    (typeof openclaw?.bundleFormat === "string" && openclaw.bundleFormat.trim()) ||
    params.bundleMetadata?.format?.trim() ||
    "generic";
  if (hostTargets.length === 0) {
    throw new ConvexError("Bundle plugins must declare at least one host target");
  }

  const capabilities: PackageCapabilitySummary = {
    executesCode: false,
    runtimeId,
    bundleFormat,
    hostTargets,
    capabilityTags: uniq([
      "bundle-only",
      bundleFormat ? `format:${bundleFormat}` : null,
      ...hostTargets.map((entry) => `host:${entry}`),
    ]),
  };

  return {
    runtimeId,
    compatibility: extractCompatibility(params.packageJson),
    capabilities,
    verification: buildVerification(params.source),
  };
}

export function summarizePackageForSearch(params: {
  packageName: string;
  packageJson?: JsonRecord;
  readmeText?: string | null;
}) {
  return deriveSummary(params);
}

export function ensurePluginNameMatchesPackage(packageName: string, packageJson: JsonRecord) {
  const declaredName = typeof packageJson.name === "string" ? packageJson.name.trim() : "";
  if (!declaredName) throw new ConvexError("package.json must declare a name");
  const normalizedDeclared = normalizePackageName(declaredName);
  const normalizedExpected = normalizePackageName(packageName);
  if (normalizedDeclared !== normalizedExpected) {
    throw new ConvexError(
      `package.json name must match published package name (${normalizedExpected})`,
    );
  }
}

export function maybeParseJson(text: string | null | undefined) {
  if (!text) return undefined;
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  return parseJsonFile(trimmed, "JSON file");
}
