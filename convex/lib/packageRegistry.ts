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
