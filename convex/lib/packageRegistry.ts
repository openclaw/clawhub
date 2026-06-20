import {
  listMissingOpenClawExternalCodePluginFieldPaths,
  normalizeOpenClawExternalPluginCompatibility,
} from "clawhub-schema";
import type {
  BundlePublishMetadata,
  PackageCompatibility,
  PackageVerificationSummary,
} from "clawhub-schema";
import { ConvexError } from "convex/values";
import semver from "semver";
import type { ActionCtx } from "../_generated/server";
import {
  formatReservedUnscopedPackageNameMessage,
  isReservedUnscopedPackageName,
} from "./publicRouteReservations";
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

type PluginManifestSummaryFile = {
  path: string;
  size: number;
  sha256: string;
  text?: string;
};

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
  if (!Array.isArray(input)) return [];
  return input
    .map((value) =>
      typeof value === "string"
        ? value.trim()
        : isRecord(value)
          ? optionalString(value.name)
          : undefined,
    )
    .filter(Boolean) as string[];
}

function uniq(items: Array<string | undefined | null>) {
  return [...new Set(items.map((item) => item?.trim()).filter(Boolean) as string[])];
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function pathDerivedName(path: string) {
  const segment = path.split("/").filter(Boolean).at(-1) ?? path;
  return segment.trim() || path;
}

function normalizeSkillRootPath(value: unknown) {
  const raw =
    typeof value === "string"
      ? value
      : isRecord(value)
        ? (optionalString(value.path) ??
          optionalString(value.root) ??
          optionalString(value.rootPath))
        : undefined;
  if (!raw) return null;
  return sanitizePath(raw.replace(/\/+$/, ""));
}

function normalizeSkillRootPaths(input: unknown) {
  const values = Array.isArray(input) ? input : input ? [input] : [];
  return uniq(values.map(normalizeSkillRootPath));
}

function findSkillMarkdownFile(files: PluginManifestSummaryFile[], rootPath: string) {
  const expected = `${rootPath}/SKILL.md`;
  const expectedLower = expected.toLowerCase();
  return (
    files.find((file) => file.path === expected) ??
    files.find((file) => file.path.toLowerCase() === expectedLower) ??
    null
  );
}

function extractCompatibilityFromManifest(
  manifest: JsonRecord,
  fallback?: PackageCompatibility,
): PackageCompatibility | undefined {
  const normalized = normalizeOpenClawExternalPluginCompatibility({ openclaw: manifest.openclaw });
  const compatibility = {
    pluginApiRange: normalized?.pluginApiRange ?? fallback?.pluginApiRange,
    builtWithOpenClawVersion:
      normalized?.builtWithOpenClawVersion ?? fallback?.builtWithOpenClawVersion,
    pluginSdkVersion: normalized?.pluginSdkVersion ?? fallback?.pluginSdkVersion,
    minGatewayVersion: normalized?.minGatewayVersion ?? fallback?.minGatewayVersion,
  };
  const entries = Object.entries(compatibility).filter(
    (entry): entry is [keyof PackageCompatibility, string] =>
      typeof entry[1] === "string" && entry[1].trim().length > 0,
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function extractManifestIdentity(manifest: JsonRecord) {
  const identity = {
    name: optionalString(manifest.name),
    description: optionalString(manifest.description),
    version: optionalString(manifest.version),
    family: optionalString(manifest.family),
  };
  const entries = Object.entries(identity).filter(
    (entry): entry is [keyof typeof identity, string] => Boolean(entry[1]),
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function isSensitiveConfigProperty(name: string, property: JsonRecord) {
  if (property.sensitive === true || property.secret === true || property["x-sensitive"] === true) {
    return true;
  }
  const loweredName = name.toLowerCase();
  if (/(secret|token|api[_-]?key|password|credential)/.test(loweredName)) return true;
  const format = optionalString(property.format)?.toLowerCase();
  return format === "password" || format === "secret";
}

function extractConfigFields(manifest: JsonRecord) {
  const openclaw = isRecord(manifest.openclaw) ? manifest.openclaw : undefined;
  const schema = isRecord(manifest.configSchema)
    ? manifest.configSchema
    : isRecord(openclaw?.configSchema)
      ? openclaw.configSchema
      : undefined;
  if (!schema) return [];
  const required = new Set(normalizeStringList(schema.required));
  const properties = isRecord(schema.properties) ? schema.properties : {};
  return Object.entries(properties)
    .filter((entry): entry is [string, JsonRecord] => isRecord(entry[1]))
    .map(([name, property]) => ({
      name,
      ...(optionalString(property.description)
        ? { description: optionalString(property.description) }
        : {}),
      required: required.has(name),
      sensitive: isSensitiveConfigProperty(name, property),
    }));
}

function extractMcpServerNames(manifest: JsonRecord) {
  const raw = manifest.mcpServers ?? manifest.mcp;
  if (Array.isArray(raw)) return uniq(normalizeNamedList(raw));
  if (isRecord(raw))
    return Object.keys(raw)
      .map((name) => name.trim())
      .filter(Boolean)
      .sort();
  return [];
}

function parseSkillMarkdownMetadata(text: string | undefined) {
  if (!text) return {};
  const frontmatter = parseFrontmatter(text);
  return {
    name: optionalString(getFrontmatterValue(frontmatter, "name")),
    description: optionalString(getFrontmatterValue(frontmatter, "description")),
  };
}

export function derivePluginManifestSummary(params: {
  pluginManifest: JsonRecord;
  skillManifest?: JsonRecord;
  files: PluginManifestSummaryFile[];
  compatibility?: PackageCompatibility;
}) {
  const compatibility = extractCompatibilityFromManifest(
    params.pluginManifest,
    params.compatibility,
  );
  const manifestIdentity = extractManifestIdentity(params.pluginManifest);
  const skillManifest = params.skillManifest ?? params.pluginManifest;
  const skillRoots = uniq([
    ...normalizeSkillRootPaths(skillManifest.skills),
    ...normalizeSkillRootPaths(skillManifest.bundledSkills),
  ]);
  const bundledSkills = skillRoots
    .map((rootPath) => {
      const file = findSkillMarkdownFile(params.files, rootPath);
      if (!file) return null;
      const metadata = parseSkillMarkdownMetadata(file.text);
      return {
        name: metadata.name ?? pathDerivedName(rootPath),
        ...(metadata.description ? { description: metadata.description } : {}),
        rootPath,
        skillMdPath: file.path,
        sha256: file.sha256,
        size: file.size,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  return {
    schemaVersion: 1 as const,
    ...(compatibility ? { compatibility } : {}),
    ...(manifestIdentity ? { manifestIdentity } : {}),
    configFields: extractConfigFields(params.pluginManifest),
    mcpServers: extractMcpServerNames(params.pluginManifest).map((name) => ({ name })),
    bundledSkills,
  };
}

export function normalizePackageName(name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new ConvexError("Package name required");
  const normalized = tryNormalizePackageName(trimmed);
  if (!normalized) {
    throw new ConvexError(
      "Package name must be lowercase and npm-safe (example: @scope/name or plugin-name)",
    );
  }
  if (!normalized.startsWith("@") && isReservedUnscopedPackageName(normalized)) {
    throw new ConvexError(formatReservedUnscopedPackageNameMessage(normalized));
  }
  return normalized;
}

export function tryNormalizePackageName(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const normalized = trimmed.toLowerCase();
  if (!PACKAGE_NAME_PATTERN.test(normalized)) return null;
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
  // `source.path` is the package directory inside the source repo (e.g.
  // "examples/openclaw-plugin"). When the package lives at the repo root the
  // CLI sends "." (or empty), and there's nothing useful to serialize. Only
  // promote real subpaths into `verification.sourcePath` so consumers can
  // build a `raw.githubusercontent.com/<repo>/<sha>/<path>/` base URL for
  // resolving relative README asset references.
  const rawPath = typeof source.path === "string" ? source.path.trim() : "";
  const sourcePath =
    rawPath && rawPath !== "." ? rawPath.replace(/^\/+/, "").replace(/\/+$/, "") : undefined;
  return {
    tier: "source-linked",
    scope: "artifact-only",
    summary: "Validated package structure and linked the release to source metadata.",
    sourceRepo: source.repo || source.url,
    sourceCommit: source.commit,
    sourceTag: source.ref,
    sourcePath: sourcePath || undefined,
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

  const hasConfigSchema =
    typeof params.pluginManifest.configSchema === "string" ||
    isRecord(params.pluginManifest.configSchema) ||
    isRecord(openclaw?.configSchema);
  if (!hasConfigSchema) {
    throw new ConvexError("Code plugins must declare a config schema");
  }

  return {
    runtimeId,
    compatibility,
    verification: buildVerification(params.source),
  };
}

export function extractBundlePluginArtifacts(params: {
  packageName: string;
  packageJson?: JsonRecord;
  pluginManifest: JsonRecord;
  bundleManifest?: JsonRecord;
  bundleMetadata?: BundlePublishMetadata;
  source?: SourceInfo;
}) {
  const runtimeId =
    (typeof params.pluginManifest.id === "string" && params.pluginManifest.id.trim()) ||
    params.bundleMetadata?.id?.trim() ||
    params.packageName;

  return {
    runtimeId,
    compatibility: extractCompatibility(params.packageJson),
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

export function normalizePluginManifestIcon(manifest: unknown): string | undefined {
  if (!isRecord(manifest) || typeof manifest.icon !== "string") return undefined;
  const icon = manifest.icon.trim();
  if (!icon) return undefined;
  try {
    const url = new URL(icon);
    return url.protocol === "https:" ? icon : undefined;
  } catch {
    return undefined;
  }
}

export function toConvexSafeJsonValue(
  value: unknown,
  options: { maxDepth?: number } = {},
  depth = 0,
): unknown {
  const maxDepth = options.maxDepth ?? Number.POSITIVE_INFINITY;
  if (depth >= maxDepth) return "[truncated]";
  if (Array.isArray(value)) {
    return value.map((item) => toConvexSafeJsonValue(item, options, depth + 1));
  }
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key.startsWith("$")
        ? `dollar_${key.slice(1)}`
        : key.startsWith("_")
          ? `underscore_${key.slice(1)}`
          : key,
      toConvexSafeJsonValue(nested, options, depth + 1),
    ]),
  );
}
