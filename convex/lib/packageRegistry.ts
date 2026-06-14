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

function normalizeOpenClawStringList(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((value) => {
    if (typeof value !== "string") return [];
    const normalized = value.trim();
    return normalized ? [normalized] : [];
  });
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

function normalizeTagSegment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function uniq(items: Array<string | undefined | null>) {
  return [...new Set(items.map((item) => item?.trim()).filter(Boolean) as string[])];
}

const DERIVED_OPENCLAW_ONBOARDING_CAPABILITY_TAGS = [
  "capability:model-provider",
  "capability:speech-provider",
  "capability:web-search-provider",
  "capability:image-generation-provider",
  "capability:music-generation-provider",
  "setup:text-inference",
  "setup:image-generation",
  "setup:music-generation",
] as const;
const DERIVED_OPENCLAW_ONBOARDING_CAPABILITY_TAG_SET = new Set<string>(
  DERIVED_OPENCLAW_ONBOARDING_CAPABILITY_TAGS,
);

function hasDeclarativeSetupProviderAuthChoice(
  pluginManifest: Record<string, unknown>,
  hasSetupSource: boolean,
  explicitProviderMethods: ReadonlySet<string>,
) {
  const setup = isRecord(pluginManifest.setup) ? pluginManifest.setup : undefined;
  if (!setup || (hasSetupSource && setup.requiresRuntime !== false)) return false;
  if (!Array.isArray(setup.providers)) return false;
  return setup.providers.some((provider) => {
    if (!isRecord(provider) || typeof provider.id !== "string") return false;
    const providerId = provider.id.trim();
    if (!providerId) return false;
    return normalizeOpenClawStringList(provider.authMethods).some(
      (method) => !explicitProviderMethods.has(`${providerId}::${method}`),
    );
  });
}

function hasDeclaredOpenClawSetupEntry(
  pluginManifest: Record<string, unknown> | undefined,
  packageJson: Record<string, unknown> | undefined,
) {
  const openclaw = isRecord(packageJson?.openclaw) ? packageJson.openclaw : undefined;
  return [pluginManifest?.setupEntry, openclaw?.setupEntry].some(
    (entry) => typeof entry === "string" && Boolean(entry.trim()),
  );
}

export function hasOpenClawSetupSource(packageJson: Record<string, unknown> | undefined) {
  const openclaw = isRecord(packageJson?.openclaw) ? packageJson.openclaw : undefined;
  return typeof openclaw?.setupEntry === "string" && Boolean(openclaw.setupEntry.trim());
}

export function deriveOpenClawOnboardingCapabilityTags(
  pluginManifest: Record<string, unknown>,
  options?: { hasSetupSource?: boolean },
): string[] {
  const contracts = isRecord(pluginManifest.contracts) ? pluginManifest.contracts : undefined;
  const setupScopes = new Set<string>();
  const explicitProviderMethods = new Set<string>();
  if (Array.isArray(pluginManifest.providerAuthChoices)) {
    for (const choice of pluginManifest.providerAuthChoices) {
      if (!isRecord(choice)) continue;
      const provider = typeof choice.provider === "string" ? choice.provider.trim() : "";
      const method = typeof choice.method === "string" ? choice.method.trim() : "";
      const choiceId = typeof choice.choiceId === "string" ? choice.choiceId.trim() : "";
      if (!provider || !method || !choiceId) continue;
      explicitProviderMethods.add(`${provider}::${method}`);
      const normalizedScopes = normalizeOpenClawStringList(choice.onboardingScopes).filter(
        (scope) =>
          scope === "text-inference" ||
          scope === "image-generation" ||
          scope === "music-generation",
      );
      const scopes = normalizedScopes.length > 0 ? normalizedScopes : ["text-inference"];
      for (const scope of scopes) setupScopes.add(scope);
    }
  }
  if (
    hasDeclarativeSetupProviderAuthChoice(
      pluginManifest,
      Boolean(options?.hasSetupSource),
      explicitProviderMethods,
    )
  ) {
    setupScopes.add("text-inference");
  }

  const tags = new Set<string>();
  if (normalizeOpenClawStringList(pluginManifest.providers).length > 0) {
    tags.add("capability:model-provider");
  }
  if (normalizeOpenClawStringList(contracts?.speechProviders).length > 0) {
    tags.add("capability:speech-provider");
  }
  if (normalizeOpenClawStringList(contracts?.webSearchProviders).length > 0) {
    tags.add("capability:web-search-provider");
  }
  if (normalizeOpenClawStringList(contracts?.imageGenerationProviders).length > 0) {
    tags.add("capability:image-generation-provider");
  }
  if (normalizeOpenClawStringList(contracts?.musicGenerationProviders).length > 0) {
    tags.add("capability:music-generation-provider");
  }
  if (setupScopes.has("text-inference")) tags.add("setup:text-inference");
  if (setupScopes.has("image-generation")) tags.add("setup:image-generation");
  if (setupScopes.has("music-generation")) tags.add("setup:music-generation");

  return DERIVED_OPENCLAW_ONBOARDING_CAPABILITY_TAGS.filter((tag) => tags.has(tag));
}

export function replaceDerivedOpenClawOnboardingCapabilityTags(
  capabilityTags: Array<string | undefined | null> | undefined,
  derivedCapabilityTags: string[],
): string[] {
  const preserved = uniq(capabilityTags ?? []).filter(
    (tag) => !DERIVED_OPENCLAW_ONBOARDING_CAPABILITY_TAG_SET.has(tag),
  );
  const derived = new Set(
    derivedCapabilityTags.filter((tag) => DERIVED_OPENCLAW_ONBOARDING_CAPABILITY_TAG_SET.has(tag)),
  );
  return [
    ...preserved,
    ...DERIVED_OPENCLAW_ONBOARDING_CAPABILITY_TAGS.filter((tag) => derived.has(tag)),
  ];
}

function isRequiredEnvironmentFlag(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "required";
  }
  if (!isRecord(value)) return false;
  return value.required === true || value.enabled === true;
}

function normalizeEnvironmentNames(input: unknown): string[] {
  return normalizeNamedList(input).map(normalizeTagSegment).filter(Boolean).slice(0, 20);
}

function extractEnvironmentCapabilityTags(environment: JsonRecord | undefined) {
  if (!environment) return [];

  const nativeDeps = normalizeEnvironmentNames(environment.nativeDependencies);
  const externalServices = normalizeEnvironmentNames(environment.externalServices);
  const binaries = normalizeEnvironmentNames(environment.binaries);
  const osPermissions = normalizeEnvironmentNames(environment.osPermissions);
  const tags: Array<string | null> = ["environment:declared"];

  if (
    isRequiredEnvironmentFlag(environment.browser) ||
    isRequiredEnvironmentFlag(environment.requiresBrowser)
  ) {
    tags.push("requires:browser");
  }
  if (
    isRequiredEnvironmentFlag(environment.desktop) ||
    isRequiredEnvironmentFlag(environment.requiresDesktop)
  ) {
    tags.push("requires:desktop");
  }
  if (
    isRequiredEnvironmentFlag(environment.audio) ||
    isRequiredEnvironmentFlag(environment.microphone)
  ) {
    tags.push("requires:audio");
  }
  if (isRequiredEnvironmentFlag(environment.nativeDependencies) || nativeDeps.length > 0) {
    tags.push("requires:native-deps", ...nativeDeps.map((entry) => `native-dep:${entry}`));
  }
  if (isRequiredEnvironmentFlag(environment.externalServices) || externalServices.length > 0) {
    tags.push(
      "requires:external-service",
      ...externalServices.map((entry) => `external-service:${entry}`),
    );
  }
  if (isRequiredEnvironmentFlag(environment.binaries) || binaries.length > 0) {
    tags.push("requires:binary", ...binaries.map((entry) => `binary:${entry}`));
  }
  if (isRequiredEnvironmentFlag(environment.osPermissions) || osPermissions.length > 0) {
    tags.push("requires:os-permission", ...osPermissions.map((entry) => `os-permission:${entry}`));
  }
  if (
    isRequiredEnvironmentFlag(environment.remoteHost) ||
    isRequiredEnvironmentFlag(environment.remoteExecutionHost)
  ) {
    tags.push("remote-host");
  }

  return uniq(tags);
}

function extractHostTargetCapabilityTags(hostTargets: string[]) {
  const tags: string[] = [];
  for (const target of hostTargets) {
    const normalized = normalizeTagSegment(target);
    if (!normalized) continue;
    tags.push(`host:${normalized}`);
    const [os, arch, libc] = normalized.split("-");
    if (os === "darwin" || os === "linux" || os === "win32") {
      tags.push(`host-os:${os}`);
      if (arch) tags.push(`host-arch:${arch}`);
      if (libc) tags.push(`host-libc:${libc}`);
    }
  }
  return uniq(tags);
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

  const channels = uniq([
    ...normalizeStringList(params.pluginManifest.channels),
    ...normalizeStringList(openclaw?.channels),
  ]);
  const providers = uniq([
    ...normalizeOpenClawStringList(params.pluginManifest.providers),
    ...normalizeOpenClawStringList(openclaw?.providers),
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
  const hostTargets = uniq(normalizeStringList(openclaw?.hostTargets));
  const environment = isRecord(openclaw?.environment) ? openclaw.environment : undefined;
  const environmentTags = extractEnvironmentCapabilityTags(environment);
  const hasSetupSource = hasOpenClawSetupSource(params.packageJson);
  const hasSetupEntry = hasDeclaredOpenClawSetupEntry(params.pluginManifest, params.packageJson);

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
    setupEntry: hasSetupEntry,
    configSchema: hasConfigSchema,
    configUiHints:
      isRecord(params.pluginManifest.configUiHints) || isRecord(openclaw?.configUiHints),
    materializesDependencies: Boolean(openclaw?.materializesDependencies),
    toolNames,
    commandNames,
    serviceNames,
    httpRouteCount,
    hostTargets,
  };

  capabilities.capabilityTags = replaceDerivedOpenClawOnboardingCapabilityTags(
    [
      "executes-code",
      capabilities.pluginKind ? `kind:${capabilities.pluginKind}` : null,
      ...channels.map((entry) => `channel:${entry}`),
      ...providers.map((entry) => `provider:${entry}`),
      ...(capabilities.setupEntry ? ["setup"] : []),
      ...extractHostTargetCapabilityTags(hostTargets),
      ...environmentTags,
      ...(toolNames.length > 0 ? ["tools"] : []),
    ],
    deriveOpenClawOnboardingCapabilityTags(params.pluginManifest, { hasSetupSource }),
  );

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
  pluginManifest: JsonRecord;
  bundleManifest?: JsonRecord;
  bundleMetadata?: BundlePublishMetadata;
  source?: SourceInfo;
}) {
  const openclaw = isRecord(params.packageJson?.openclaw) ? params.packageJson.openclaw : undefined;
  const environment = isRecord(openclaw?.environment) ? openclaw.environment : undefined;
  const hasSetupSource = hasOpenClawSetupSource(params.packageJson);
  const manifest = params.bundleManifest;
  const runtimeId =
    (typeof params.pluginManifest.id === "string" && params.pluginManifest.id.trim()) ||
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

  const capabilities: PackageCapabilitySummary = {
    executesCode: false,
    runtimeId,
    bundleFormat,
    hostTargets,
    capabilityTags: replaceDerivedOpenClawOnboardingCapabilityTags(
      [
        "bundle-only",
        bundleFormat ? `format:${bundleFormat}` : null,
        ...extractHostTargetCapabilityTags(hostTargets),
        ...extractEnvironmentCapabilityTags(environment),
      ],
      deriveOpenClawOnboardingCapabilityTags(params.pluginManifest, { hasSetupSource }),
    ),
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
