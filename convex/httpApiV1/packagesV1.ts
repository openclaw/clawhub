import {
  PackageArtifactBackfillRequestSchema,
  ApiV1PackageOfficialMigrationListResponseSchema,
  ApiV1PackageOfficialMigrationResponseSchema,
  ApiV1PackageModerationStatusResponseSchema,
  PackageAppealResolveRequestSchema,
  PackageAppealRequestSchema,
  PackageOfficialMigrationUpsertRequestSchema,
  PackageReportRequestSchema,
  PackageReportTriageRequestSchema,
  PackageReleaseModerationRequestSchema,
  PackagePublishRequestSchema,
  PackageTrustedPublisherUpsertRequestSchema,
  PublishTokenMintRequestSchema,
  parseArk,
  type PackageAppealListStatus,
  type PackageModerationQueueStatus,
  type PackageOfficialMigrationListPhase,
  type PackageReportListStatus,
} from "clawhub-schema";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { getOptionalActiveAuthUserIdFromAction } from "../lib/access";
import { getOptionalApiTokenUserId } from "../lib/apiTokenAuth";
import { parseClawPack, sha256Base64, sha256Hex } from "../lib/clawpack";
import {
  fetchGitHubRepositoryIdentity,
  verifyGitHubActionsTrustedPublishJwt,
} from "../lib/githubActionsOidc";
import { corsHeaders, mergeHeaders } from "../lib/httpHeaders";
import { applyRateLimit } from "../lib/httpRateLimit";
import { getPackageDownloadSecurityBlock } from "../lib/packageSecurity";
import {
  getClawPackSizeError,
  getPublishFileSizeError,
  MAX_CLAWPACK_BYTES,
  MAX_PUBLISH_FILE_BYTES,
} from "../lib/publishLimits";
import { isMacJunkPath, isTextFile } from "../lib/skills";
import { buildDeterministicPackageZip } from "../lib/skillZip";
import { generateToken, hashToken } from "../lib/tokens";
import {
  MAX_RAW_FILE_BYTES,
  getPathSegments,
  json,
  resolveTagsBatch,
  requireApiTokenUserOrResponse,
  requirePackagePublishAuthOrResponse,
  safeTextFileResponse,
  softDeleteErrorToResponse,
  text,
  toOptionalNumber,
} from "./shared";
const apiRefs = api as unknown as {
  packages: {
    listPublicPage: unknown;
    searchPublic: unknown;
  };
  skills: {
    listPackageCatalogPage: unknown;
    searchPackageCatalogPublic: unknown;
    getBySlug: unknown;
    listVersionsPage: unknown;
    getVersionBySkillAndVersion: unknown;
  };
};
const internalRefs = internal as unknown as {
  packages: {
    getByNameForViewerInternal: unknown;
    listPageForViewerInternal: unknown;
    searchForViewerInternal: unknown;
    listVersionsForViewerInternal: unknown;
    getPackageByNameInternal: unknown;
    getTrustedPublisherByPackageIdInternal: unknown;
    getVersionByNameForViewerInternal: unknown;
    publishPackageForUserInternal: unknown;
    publishPackageForTrustedPublisherInternal: unknown;
    setTrustedPublisherForUserInternal: unknown;
    deleteTrustedPublisherForUserInternal: unknown;
    getReleasesByIdsInternal: unknown;
    getReleaseByPackageAndVersionInternal: unknown;
    getReleaseByIdInternal: unknown;
    insertAuditLogInternal: unknown;
    recordPackageDownloadInternal: unknown;
    requestRescanForApiTokenInternal: unknown;
    softDeletePackageInternal: unknown;
    moderatePackageReleaseForUserInternal: unknown;
    reportPackageForUserInternal: unknown;
    listPackageReportsInternal: unknown;
    triagePackageReportForUserInternal: unknown;
    getPackageModerationStatusForUserInternal: unknown;
    submitPackageAppealForUserInternal: unknown;
    listPackageAppealsInternal: unknown;
    resolvePackageAppealForUserInternal: unknown;
    listOfficialPluginMigrationsInternal: unknown;
    upsertOfficialPluginMigrationForUserInternal: unknown;
    backfillPackageArtifactKindsInternal: unknown;
    listPackageModerationQueueInternal: unknown;
  };
  packagePublishTokens: {
    createInternal: unknown;
  };
  skills: {
    getSkillBySlugInternal: unknown;
    getVersionByIdInternal: unknown;
    getVersionBySkillAndVersionInternal: unknown;
  };
};

async function runQueryRef<T>(ctx: ActionCtx, ref: unknown, args: unknown): Promise<T> {
  return (await ctx.runQuery(ref as never, args as never)) as T;
}

async function runActionRef<T>(ctx: ActionCtx, ref: unknown, args: unknown): Promise<T> {
  return (await ctx.runAction(ref as never, args as never)) as T;
}

async function runMutationRef<T>(ctx: ActionCtx, ref: unknown, args: unknown): Promise<T> {
  return (await ctx.runMutation(ref as never, args as never)) as T;
}

async function getOptionalViewerUserIdForRequest(ctx: ActionCtx, request: Request) {
  const apiTokenUserId = await getOptionalApiTokenUserId(ctx, request);
  if (apiTokenUserId) return apiTokenUserId;
  try {
    const userId = (await getOptionalActiveAuthUserIdFromAction(ctx)) ?? null;
    if (!userId) return null;
    return userId;
  } catch {
    // Public package reads should degrade to anonymous when cookie-backed auth is stale.
    return null;
  }
}

function normalizeCapabilityTagSegment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getEnabledQueryFlag(params: URLSearchParams, name: string) {
  const value = params.get(name)?.trim().toLowerCase();
  return value === "true" || value === "1";
}

function getCapabilityTagFromQueryParams(params: URLSearchParams) {
  const explicit = params.get("capabilityTag")?.trim();
  if (explicit) return explicit;

  const target = params.get("target")?.trim() || params.get("hostTarget")?.trim();
  if (target) return `host:${normalizeCapabilityTagSegment(target)}`;

  const os = params.get("os")?.trim();
  if (os) return `host-os:${normalizeCapabilityTagSegment(os)}`;

  const arch = params.get("arch")?.trim();
  if (arch) return `host-arch:${normalizeCapabilityTagSegment(arch)}`;

  const libc = params.get("libc")?.trim();
  if (libc) return `host-libc:${normalizeCapabilityTagSegment(libc)}`;

  const externalService = params.get("externalService")?.trim();
  if (externalService) return `external-service:${normalizeCapabilityTagSegment(externalService)}`;

  const binary = params.get("binary")?.trim();
  if (binary) return `binary:${normalizeCapabilityTagSegment(binary)}`;

  const osPermission = params.get("osPermission")?.trim();
  if (osPermission) return `os-permission:${normalizeCapabilityTagSegment(osPermission)}`;

  const artifactKind = params.get("artifactKind")?.trim();
  if (artifactKind === "legacy-zip" || artifactKind === "npm-pack") {
    return `artifact:${artifactKind}`;
  }
  if (getEnabledQueryFlag(params, "npmMirror")) return "npm-mirror:available";
  if (getEnabledQueryFlag(params, "requiresBrowser")) return "requires:browser";
  if (getEnabledQueryFlag(params, "requiresDesktop")) return "requires:desktop";
  if (getEnabledQueryFlag(params, "requiresNativeDeps")) return "requires:native-deps";
  if (getEnabledQueryFlag(params, "nativeDeps")) return "requires:native-deps";
  if (getEnabledQueryFlag(params, "requiresExternalService")) {
    return "requires:external-service";
  }
  if (getEnabledQueryFlag(params, "requiresBinary")) return "requires:binary";
  if (getEnabledQueryFlag(params, "requiresOsPermission")) return "requires:os-permission";
  if (getEnabledQueryFlag(params, "environmentDeclared")) return "environment:declared";
  return undefined;
}

function parsePackageModerationQueueStatus(
  value: string | null,
): PackageModerationQueueStatus | null {
  if (!value) return "open";
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "open" ||
    normalized === "blocked" ||
    normalized === "manual" ||
    normalized === "all"
  ) {
    return normalized;
  }
  return null;
}

function parsePackageReportListStatus(value: string | null): PackageReportListStatus | null {
  if (!value) return "open";
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "open" ||
    normalized === "triaged" ||
    normalized === "dismissed" ||
    normalized === "all"
  ) {
    return normalized;
  }
  return null;
}

function parsePackageAppealListStatus(value: string | null): PackageAppealListStatus | null {
  if (!value) return "open";
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "open" ||
    normalized === "accepted" ||
    normalized === "rejected" ||
    normalized === "all"
  ) {
    return normalized;
  }
  return null;
}

function parsePackageOfficialMigrationPhase(
  value: string | null,
): PackageOfficialMigrationListPhase | null {
  if (!value) return "all";
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "planned" ||
    normalized === "published" ||
    normalized === "clawpack-ready" ||
    normalized === "legacy-zip-only" ||
    normalized === "metadata-ready" ||
    normalized === "blocked" ||
    normalized === "ready-for-openclaw" ||
    normalized === "all"
  ) {
    return normalized;
  }
  return null;
}

type PackageListQueryArgs = {
  family?: "skill" | "code-plugin" | "bundle-plugin";
  channel?: "official" | "community" | "private";
  isOfficial?: boolean;
  highlightedOnly?: boolean;
  executesCode?: boolean;
  capabilityTag?: string;
  viewerUserId?: Id<"users">;
  paginationOpts: { cursor: string | null; numItems: number };
};

type SkillPackageDocLike = {
  _id: Id<"skills">;
  slug: string;
  displayName: string;
  summary?: string | null;
  latestVersionId?: Id<"skillVersions">;
  tags: Record<string, Id<"skillVersions">>;
  stats?: unknown;
  createdAt: number;
  updatedAt: number;
  badges?: { official?: unknown };
};

type SkillVersionLike = {
  _id: Id<"skillVersions">;
  skillId: Id<"skills">;
  version: string;
  createdAt: number;
  changelog: string;
  files: Array<{
    path: string;
    size: number;
    sha256: string;
    storageId?: Id<"_storage">;
    contentType?: string;
  }>;
  softDeletedAt?: number;
};

type ReleaseLike = {
  _id: Id<"packageReleases">;
  version: string;
  createdAt: number;
  changelog: string;
  distTags?: string[];
  files: Array<{
    path: string;
    size: number;
    sha256: string;
    storageId: Id<"_storage">;
    contentType?: string;
  }>;
  compatibility?: Doc<"packageReleases">["compatibility"];
  capabilities?: Doc<"packageReleases">["capabilities"];
  verification?: Doc<"packageReleases">["verification"];
  extractedPackageJson?: Doc<"packageReleases">["extractedPackageJson"];
  sha256hash?: string;
  vtAnalysis?: Doc<"packageReleases">["vtAnalysis"];
  llmAnalysis?: Doc<"packageReleases">["llmAnalysis"];
  staticScan?: Doc<"packageReleases">["staticScan"];
  integritySha256?: string;
  artifactKind?: Doc<"packageReleases">["artifactKind"];
  clawpackStorageId?: Doc<"packageReleases">["clawpackStorageId"];
  clawpackSha256?: string;
  clawpackSize?: number;
  clawpackFormat?: "tgz";
  npmIntegrity?: string;
  npmShasum?: string;
  npmTarballName?: string;
  npmUnpackedSize?: number;
  npmFileCount?: number;
  softDeletedAt?: number;
};

type PackageTrustedPublisherLike = {
  _id: Id<"packageTrustedPublishers">;
  packageId: Id<"packages">;
  provider: "github-actions";
  repository: string;
  repositoryId: string;
  repositoryOwner: string;
  repositoryOwnerId: string;
  workflowFilename: string;
  environment?: string;
  createdAt: number;
  updatedAt: number;
};

function toVisibleRelease(release: ReleaseLike | null) {
  if (!release || ("softDeletedAt" in release && release.softDeletedAt !== undefined)) return null;
  return release;
}

function toPublicTrustedPublisher(trustedPublisher: PackageTrustedPublisherLike | null) {
  if (!trustedPublisher) return null;
  return {
    provider: trustedPublisher.provider,
    repository: trustedPublisher.repository,
    repositoryId: trustedPublisher.repositoryId,
    repositoryOwner: trustedPublisher.repositoryOwner,
    repositoryOwnerId: trustedPublisher.repositoryOwnerId,
    workflowFilename: trustedPublisher.workflowFilename,
    ...(trustedPublisher.environment ? { environment: trustedPublisher.environment } : {}),
  };
}

function getReleaseSecurityBlock(release: ReleaseLike) {
  return getPackageDownloadSecurityBlock(release);
}

function toReleaseArtifact(release: ReleaseLike) {
  if (release.artifactKind === "npm-pack") {
    return {
      kind: "npm-pack" as const,
      sha256: release.clawpackSha256,
      size: release.clawpackSize,
      format: release.clawpackFormat ?? "tgz",
      npmIntegrity: release.npmIntegrity,
      npmShasum: release.npmShasum,
      npmTarballName: release.npmTarballName,
      npmUnpackedSize: release.npmUnpackedSize,
      npmFileCount: release.npmFileCount,
    };
  }
  return {
    kind: "legacy-zip" as const,
    sha256: release.integritySha256 ?? release.sha256hash,
    format: "zip",
  };
}

function encodePackagePath(name: string) {
  return name
    .split("/")
    .map((segment) =>
      segment.startsWith("@")
        ? `@${encodeURIComponent(segment.slice(1))}`
        : encodeURIComponent(segment),
    )
    .join("/");
}

const DEFAULT_PUBLIC_SITE_URL = "https://clawhub.ai";

function normalizeOrigin(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
}

function firstForwardedValue(value: string | null) {
  return value?.split(",")[0]?.trim() || null;
}

function isProductionDeployment() {
  const deployment = process.env.CONVEX_DEPLOYMENT?.trim() ?? "";
  return deployment.startsWith("prod:") || deployment.includes("production");
}

function isTrustedForwardedHost(value: string) {
  try {
    const hostname = new URL(`https://${value}`).hostname.toLowerCase();
    return (
      hostname === "clawhub.ai" ||
      hostname === "www.clawhub.ai" ||
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "0.0.0.0"
    );
  } catch {
    return false;
  }
}

function publicApiOrigin(request: Request) {
  const configured = normalizeOrigin(process.env.SITE_URL ?? process.env.VITE_SITE_URL);
  if (configured) return configured;

  const forwardedHost = firstForwardedValue(request.headers.get("x-forwarded-host"));
  if (
    forwardedHost &&
    !forwardedHost.endsWith(".convex.site") &&
    isTrustedForwardedHost(forwardedHost)
  ) {
    const forwardedProto =
      firstForwardedValue(request.headers.get("x-forwarded-proto")) ??
      firstForwardedValue(request.headers.get("x-forwarded-protocol")) ??
      "https";
    const proto = forwardedProto === "http" ? "http" : "https";
    return `${proto}://${forwardedHost}`;
  }

  const requestUrl = new URL(request.url);
  if (isProductionDeployment() && requestUrl.hostname.endsWith(".convex.site")) {
    return DEFAULT_PUBLIC_SITE_URL;
  }
  return requestUrl.origin;
}

function absoluteApiUrl(request: Request, path: string) {
  return new URL(path, publicApiOrigin(request)).toString();
}

function releaseArtifactUrls(request: Request, packageName: string, release: ReleaseLike) {
  const packagePath = encodePackagePath(packageName);
  const version = encodeURIComponent(release.version);
  const legacyDownloadUrl = absoluteApiUrl(
    request,
    `/api/v1/packages/${packagePath}/download?version=${version}`,
  );
  if (release.artifactKind !== "npm-pack") {
    return {
      downloadUrl: legacyDownloadUrl,
      legacyDownloadUrl,
    };
  }
  const tarball = encodeURIComponent(
    release.npmTarballName ??
      `${packageName.replace(/^@/, "").replace("/", "-")}-${release.version}.tgz`,
  );
  const tarballUrl = absoluteApiUrl(request, `/api/npm/${packagePath}/-/${tarball}`);
  return {
    downloadUrl: tarballUrl,
    tarballUrl,
    legacyDownloadUrl,
  };
}

async function streamClawPackRelease(
  ctx: ActionCtx,
  rateHeaders: HeadersInit,
  pkg: PublicPackageDocLike,
  release: ReleaseLike,
) {
  const securityBlock = getReleaseSecurityBlock(release);
  if (securityBlock) return text(securityBlock.message, securityBlock.status, rateHeaders);
  if (release.artifactKind !== "npm-pack" || !release.clawpackStorageId) {
    return text("ClawPack artifact not found", 404, rateHeaders);
  }
  const blob = await ctx.storage.get(release.clawpackStorageId);
  if (!blob) return text("ClawPack artifact not found", 404, rateHeaders);
  try {
    await runMutationRef(ctx, internalRefs.packages.recordPackageDownloadInternal, {
      packageId: pkg._id,
    });
  } catch {
    // Best-effort metric path; never fail package downloads.
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/octet-stream",
    "Content-Disposition": `attachment; filename="${release.npmTarballName ?? `${pkg.name.replaceAll("/", "-")}-${release.version}.tgz`}"`,
    "X-ClawHub-Artifact-Type": "npm-pack-tarball",
  };
  if (release.clawpackSha256) {
    headers.ETag = `"sha256:${release.clawpackSha256}"`;
    headers["X-ClawHub-Artifact-Sha256"] = release.clawpackSha256;
  }
  if (release.npmIntegrity) headers["X-ClawHub-Npm-Integrity"] = release.npmIntegrity;
  if (release.npmShasum) headers["X-ClawHub-Npm-Shasum"] = release.npmShasum;
  return new Response(blob, {
    status: 200,
    headers: mergeHeaders(rateHeaders, headers, corsHeaders()),
  });
}

async function resolvePackageTags(
  ctx: ActionCtx,
  tags: Record<string, Id<"packageReleases">>,
): Promise<Record<string, string>> {
  const releaseIds = Object.values(tags);
  if (releaseIds.length === 0) return {};
  const releases = await runQueryRef<ReleaseLike[]>(
    ctx,
    internalRefs.packages.getReleasesByIdsInternal,
    {
      releaseIds,
    },
  );
  const byId = new Map(releases.map((release) => [release._id, release.version]));
  return Object.fromEntries(
    Object.entries(tags)
      .map(([tag, releaseId]) => [tag, byId.get(releaseId)])
      .filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
}

type CatalogListItem = {
  name: string;
  displayName: string;
  family: "skill" | "code-plugin" | "bundle-plugin";
  runtimeId?: string | null;
  channel: "official" | "community" | "private";
  isOfficial: boolean;
  summary?: string | null;
  ownerHandle?: string | null;
  createdAt: number;
  updatedAt: number;
  latestVersion?: string | null;
  capabilityTags?: string[];
  executesCode?: boolean;
  verificationTier?: string | null;
};

type CatalogSearchEntry = { score: number; package: CatalogListItem };

type CatalogSourceCursorState = {
  cursor: string | null;
  offset: number;
  pageSize: number | null;
  done: boolean;
};

type UnifiedCatalogCursorState = {
  packages: CatalogSourceCursorState;
  skills: CatalogSourceCursorState;
};

type PluginCatalogCursorState = {
  codePlugins: CatalogSourceCursorState;
  bundlePlugins: CatalogSourceCursorState;
};

type CatalogPageResult = {
  page: CatalogListItem[];
  isDone: boolean;
  continueCursor: string;
};

type CatalogSourceState = {
  state: CatalogSourceCursorState;
  page: CatalogPageResult | null;
  pageCursor: string | null;
  index: number;
};

const UNIFIED_CATALOG_CURSOR_PREFIX = "pkgcatalog:";
const PLUGIN_CATALOG_CURSOR_PREFIX = "pkgplugins:";

function defaultCatalogSourceCursorState(): CatalogSourceCursorState {
  return { cursor: null, offset: 0, pageSize: null, done: false };
}

function encodeUnifiedCatalogCursor(state: UnifiedCatalogCursorState) {
  return `${UNIFIED_CATALOG_CURSOR_PREFIX}${JSON.stringify(state)}`;
}

function decodeUnifiedCatalogCursor(raw: string | null | undefined): UnifiedCatalogCursorState {
  if (!raw?.startsWith(UNIFIED_CATALOG_CURSOR_PREFIX)) {
    return {
      packages: { ...defaultCatalogSourceCursorState(), cursor: raw ?? null },
      skills: defaultCatalogSourceCursorState(),
    };
  }
  try {
    const parsed = JSON.parse(
      raw.slice(UNIFIED_CATALOG_CURSOR_PREFIX.length),
    ) as Partial<UnifiedCatalogCursorState>;
    const normalize = (
      input: Partial<CatalogSourceCursorState> | undefined,
    ): CatalogSourceCursorState => ({
      cursor: typeof input?.cursor === "string" ? input.cursor : null,
      offset: typeof input?.offset === "number" && input.offset > 0 ? input.offset : 0,
      pageSize: typeof input?.pageSize === "number" && input.pageSize > 0 ? input.pageSize : null,
      done: input?.done === true,
    });
    return {
      packages: normalize(parsed.packages),
      skills: normalize(parsed.skills),
    };
  } catch {
    return {
      packages: defaultCatalogSourceCursorState(),
      skills: defaultCatalogSourceCursorState(),
    };
  }
}

function encodePluginCatalogCursor(state: PluginCatalogCursorState) {
  return `${PLUGIN_CATALOG_CURSOR_PREFIX}${JSON.stringify(state)}`;
}

function decodePluginCatalogCursor(raw: string | null | undefined): PluginCatalogCursorState {
  const normalize = (
    input: Partial<CatalogSourceCursorState> | undefined,
  ): CatalogSourceCursorState => ({
    cursor: typeof input?.cursor === "string" ? input.cursor : null,
    offset: typeof input?.offset === "number" && input.offset > 0 ? input.offset : 0,
    pageSize: typeof input?.pageSize === "number" && input.pageSize > 0 ? input.pageSize : null,
    done: input?.done === true,
  });

  if (!raw?.startsWith(PLUGIN_CATALOG_CURSOR_PREFIX)) {
    return {
      codePlugins: { ...defaultCatalogSourceCursorState(), cursor: raw ?? null },
      bundlePlugins: defaultCatalogSourceCursorState(),
    };
  }
  try {
    const parsed = JSON.parse(
      raw.slice(PLUGIN_CATALOG_CURSOR_PREFIX.length),
    ) as Partial<PluginCatalogCursorState>;
    return {
      codePlugins: normalize(parsed.codePlugins),
      bundlePlugins: normalize(parsed.bundlePlugins),
    };
  } catch {
    return {
      codePlugins: defaultCatalogSourceCursorState(),
      bundlePlugins: defaultCatalogSourceCursorState(),
    };
  }
}

function initCatalogSource(state: CatalogSourceCursorState): CatalogSourceState {
  return {
    state: { ...state },
    page: null,
    pageCursor: state.cursor,
    index: state.offset,
  };
}

function finalizeCatalogSource(source: CatalogSourceState): CatalogSourceCursorState {
  if (!source.page) return source.state;
  if (source.index < source.page.page.length) {
    return {
      cursor: source.pageCursor,
      offset: source.index,
      pageSize: source.state.pageSize,
      done: false,
    };
  }
  return {
    cursor: source.page.continueCursor,
    offset: 0,
    pageSize: source.state.pageSize,
    done: source.page.isDone,
  };
}

async function ensureCatalogSourcePage(
  source: CatalogSourceState,
  pageSize: number,
  fetchPage: (cursor: string | null, pageSize: number) => Promise<CatalogPageResult>,
) {
  while (true) {
    if (!source.page) {
      if (source.state.done && source.state.offset === 0) return null;
      const effectivePageSize = source.state.pageSize ?? pageSize;
      source.pageCursor = source.state.cursor;
      source.page = await fetchPage(source.pageCursor, effectivePageSize);
      source.state.pageSize = effectivePageSize;
      source.index = source.state.offset;
    }

    if (source.index < source.page.page.length) {
      return source.page.page[source.index];
    }

    if (source.page.isDone) return null;

    source.state.cursor = source.page.continueCursor;
    source.state.offset = 0;
    source.state.done = source.page.isDone;
    source.page = null;
    source.pageCursor = source.state.cursor;
    source.index = 0;
  }
}

function compareCatalogItems(a: CatalogListItem, b: CatalogListItem) {
  if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
  if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
  if (a.family !== b.family) return a.family.localeCompare(b.family);
  return a.name.localeCompare(b.name);
}

const HTTP_PACKAGE_SEARCH_PAGE_SIZE = 50;
const HTTP_PACKAGE_SEARCH_SCAN_PAGES = 20;

function catalogSearchScore(item: CatalogListItem, queryText: string) {
  const needle = queryText.toLowerCase();
  const name = item.name.toLowerCase();
  const display = item.displayName.toLowerCase();
  const runtimeId = item.runtimeId?.toLowerCase() ?? "";
  const summary = (item.summary ?? "").toLowerCase();
  let score = 0;

  if (name === needle) score += 200;
  else if (name.startsWith(needle)) score += 120;
  else if (name.includes(needle)) score += 80;

  if (display === needle) score += 150;
  else if (display.startsWith(needle)) score += 70;
  else if (display.includes(needle)) score += 40;

  if (runtimeId === needle) score += 180;
  else if (runtimeId.startsWith(needle)) score += 90;
  else if (runtimeId.includes(needle)) score += 45;

  if (summary.includes(needle)) score += 20;
  if ((item.capabilityTags ?? []).some((entry) => entry.toLowerCase().includes(needle))) {
    score += 12;
  }
  if (item.isOfficial) score += 5;
  return score;
}

function compareCatalogSearchEntries(a: CatalogSearchEntry, b: CatalogSearchEntry) {
  return (
    b.score - a.score ||
    Number(b.package.isOfficial) - Number(a.package.isOfficial) ||
    compareCatalogItems(a.package, b.package)
  );
}

async function searchPackageCatalogByListing(
  ctx: ActionCtx,
  args: {
    query: string;
    limit: number;
    family?: "skill" | "code-plugin" | "bundle-plugin";
    channel?: "official" | "community" | "private";
    isOfficial?: boolean;
    highlightedOnly?: boolean;
    executesCode?: boolean;
    capabilityTag?: string;
    viewerUserId?: Id<"users">;
  },
): Promise<CatalogSearchEntry[]> {
  const queryText = args.query.trim().toLowerCase();
  if (!queryText) return [];

  const matches: CatalogSearchEntry[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  let done = false;
  let loops = 0;

  while (!done && loops < HTTP_PACKAGE_SEARCH_SCAN_PAGES) {
    loops += 1;
    const result: {
      page: CatalogListItem[];
      isDone: boolean;
      continueCursor: string | null;
    } = await runQueryRef(ctx, internalRefs.packages.listPageForViewerInternal, {
      family: args.family,
      channel: args.channel,
      isOfficial: args.isOfficial,
      highlightedOnly: args.highlightedOnly,
      executesCode: args.executesCode,
      capabilityTag: args.capabilityTag,
      viewerUserId: args.viewerUserId,
      paginationOpts: { cursor, numItems: HTTP_PACKAGE_SEARCH_PAGE_SIZE },
    });

    for (const item of result.page) {
      const key = `${item.family}:${item.name}`;
      if (seen.has(key)) continue;
      const score = catalogSearchScore(item, queryText);
      if (score <= 0) continue;
      seen.add(key);
      matches.push({ score, package: item });
    }

    done = result.isDone;
    cursor = result.continueCursor;
    if (!cursor && !done) break;
  }

  return matches.sort(compareCatalogSearchEntries).slice(0, args.limit);
}

async function resolveSkillTags(
  ctx: ActionCtx,
  tags: Record<string, Id<"skillVersions">>,
): Promise<Record<string, string>> {
  const [resolved] = await resolveTagsBatch(ctx, [tags]);
  return resolved ?? {};
}

function isSkillOfficial(skill: SkillPackageDocLike) {
  return Boolean(skill.badges?.official);
}

function toSkillPackageDetail(
  skill: SkillPackageDocLike,
  latestVersion: SkillVersionLike | null,
  owner: { handle?: string; displayName?: string; image?: string } | null,
  resolvedTags: Record<string, string>,
) {
  return {
    package: {
      name: skill.slug,
      displayName: skill.displayName,
      family: "skill" as const,
      runtimeId: null,
      channel: isSkillOfficial(skill) ? ("official" as const) : ("community" as const),
      isOfficial: isSkillOfficial(skill),
      summary: skill.summary ?? null,
      ownerHandle: owner?.handle ?? null,
      createdAt: skill.createdAt,
      updatedAt: skill.updatedAt,
      latestVersion: latestVersion?.version ?? null,
      tags: resolvedTags,
      compatibility: null,
      capabilities: null,
      verification: null,
    },
    owner: owner
      ? {
          handle: owner.handle ?? null,
          displayName: owner.displayName ?? null,
          image: owner.image ?? null,
        }
      : null,
  };
}

function skillVersionTags(tags: Record<string, string>, version: string) {
  return Object.entries(tags)
    .filter(([, taggedVersion]) => taggedVersion === version)
    .map(([tag]) => tag);
}

function parsePackagePublishBody(body: unknown) {
  const parsed = parseArk(PackagePublishRequestSchema, body, "Package publish payload") as {
    name: string;
    displayName?: string;
    ownerHandle?: string;
    family: "skill" | "code-plugin" | "bundle-plugin";
    version: string;
    changelog: string;
    manualOverrideReason?: string;
    channel?: "official" | "community" | "private";
    tags?: string[];
    source?: Record<string, unknown>;
    bundle?: Record<string, unknown>;
    files: Array<{
      path: string;
      size: number;
      storageId: string;
      sha256: string;
      contentType?: string;
    }>;
    artifact?: {
      kind: "npm-pack";
      storageId: string;
      sha256: string;
      size: number;
      format: "tgz";
      npmIntegrity: string;
      npmShasum: string;
      npmTarballName: string;
      npmUnpackedSize: number;
      npmFileCount: number;
    };
  };
  if (parsed.files.length === 0) throw new Error("files required");
  return {
    name: parsed.name,
    displayName: parsed.displayName ?? undefined,
    ownerHandle: parsed.ownerHandle?.trim().replace(/^@+/, "") || undefined,
    family: parsed.family,
    version: parsed.version,
    changelog: parsed.changelog,
    manualOverrideReason: parsed.manualOverrideReason?.trim() || undefined,
    channel: parsed.channel ?? undefined,
    tags: parsed.tags?.filter(Boolean) ?? undefined,
    source: parsed.source ?? undefined,
    bundle: parsed.bundle ?? undefined,
    files: parsed.files.map((file) => ({
      ...file,
      storageId: file.storageId as Id<"_storage">,
    })),
    artifact: parsed.artifact
      ? {
          ...parsed.artifact,
          storageId: parsed.artifact.storageId as Id<"_storage">,
        }
      : undefined,
  };
}

function inferStoredPackageContentType(path: string) {
  const lower = path.toLowerCase();
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".md") || lower.endsWith(".mdx") || lower.endsWith(".txt")) {
    return "text/plain; charset=utf-8";
  }
  if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) {
    return "text/javascript; charset=utf-8";
  }
  if (lower.endsWith(".ts") || lower.endsWith(".tsx")) return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

function bytesToArrayBuffer(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function storeClawPackMetadataFile(
  ctx: ActionCtx,
  entries: Array<{ path: string; bytes: Uint8Array }>,
  path: string,
) {
  const entry = entries.find((candidate) => candidate.path.toLowerCase() === path.toLowerCase());
  if (!entry) throw new Error(`ClawPack must contain package/${path}`);
  if (entry.bytes.byteLength > MAX_PUBLISH_FILE_BYTES) {
    throw new Error(getPublishFileSizeError(entry.path));
  }
  const contentType = inferStoredPackageContentType(entry.path);
  const storageId = await ctx.storage.store(
    new Blob([bytesToArrayBuffer(entry.bytes)], { type: contentType }),
  );
  return {
    path: entry.path,
    size: entry.bytes.byteLength,
    storageId,
    sha256: await sha256Hex(entry.bytes),
    contentType,
  };
}

async function parseMultipartPackagePublish(ctx: ActionCtx, request: Request) {
  const form = await request.formData();
  const payloadRaw = form.get("payload");
  if (!payloadRaw || typeof payloadRaw !== "string") throw new Error("Missing payload");
  const payload = JSON.parse(payloadRaw) as Record<string, unknown>;
  const files: Array<{
    path: string;
    size: number;
    storageId: Id<"_storage">;
    sha256: string;
    contentType?: string;
  }> = [];
  let artifact:
    | {
        kind: "npm-pack";
        storageId: Id<"_storage">;
        sha256: string;
        size: number;
        format: "tgz";
        npmIntegrity: string;
        npmShasum: string;
        npmTarballName: string;
        npmUnpackedSize: number;
        npmFileCount: number;
      }
    | undefined;

  const clawpackEntry = form.get("clawpack") ?? form.get("artifact");
  if (clawpackEntry && typeof clawpackEntry !== "string") {
    if (form.getAll("files").some((entry) => typeof entry !== "string")) {
      throw new Error("Upload either a ClawPack tarball or individual files, not both");
    }
    if (clawpackEntry.size > MAX_CLAWPACK_BYTES) {
      throw new Error(getClawPackSizeError(clawpackEntry.name));
    }
    const artifactBytes = new Uint8Array(await clawpackEntry.arrayBuffer());
    const parsed = await parseClawPack(artifactBytes);
    const artifactBlob = new Blob([artifactBytes], { type: "application/octet-stream" });
    const artifactStorageId = await ctx.storage.store(artifactBlob);
    artifact = {
      kind: "npm-pack",
      storageId: artifactStorageId,
      sha256: parsed.artifactSha256,
      size: artifactBytes.byteLength,
      format: "tgz",
      npmIntegrity: parsed.npmIntegrity,
      npmShasum: parsed.npmShasum,
      npmTarballName: parsed.npmTarballName,
      npmUnpackedSize: parsed.unpackedSize,
      npmFileCount: parsed.fileCount,
    };
    files.push(await storeClawPackMetadataFile(ctx, parsed.entries, "package.json"));
    files.push(await storeClawPackMetadataFile(ctx, parsed.entries, "openclaw.plugin.json"));
    return parsePackagePublishBody({ ...payload, files, artifact });
  }

  for (const entry of form.getAll("files")) {
    if (typeof entry === "string") continue;
    if (isMacJunkPath(entry.name)) continue;
    if (entry.size > MAX_PUBLISH_FILE_BYTES) {
      throw new Error(getPublishFileSizeError(entry.name));
    }
    const buffer = new Uint8Array(await entry.arrayBuffer());
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    const sha256 = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    const storageId = await ctx.storage.store(entry);
    files.push({
      path: entry.name,
      size: entry.size,
      storageId,
      sha256,
      contentType: entry.type || undefined,
    });
  }
  return parsePackagePublishBody({ ...payload, files });
}

async function listPackages(
  ctx: ActionCtx,
  request: Request,
  family?: PackageListQueryArgs["family"],
  options?: { includeSkills?: boolean; pluginFamilies?: Array<"code-plugin" | "bundle-plugin"> },
) {
  const rate = await applyRateLimit(ctx, request, "read");
  if (!rate.ok) return rate.response;

  const url = new URL(request.url);
  const viewerUserId = await getOptionalViewerUserIdForRequest(ctx, request);
  const limit = Math.max(1, Math.min(toOptionalNumber(url.searchParams.get("limit")) ?? 25, 100));
  const cursor = url.searchParams.get("cursor");
  const familyRaw = url.searchParams.get("family");
  const channelRaw = url.searchParams.get("channel")?.trim();
  const capabilityTag = getCapabilityTagFromQueryParams(url.searchParams);
  const isOfficialRaw = url.searchParams.get("isOfficial");
  const highlightedOnly =
    url.searchParams.get("featured") === "true" ||
    url.searchParams.get("featured") === "1" ||
    url.searchParams.get("highlightedOnly") === "true" ||
    url.searchParams.get("highlightedOnly") === "1";
  const executesCodeRaw = url.searchParams.get("executesCode");
  const effectiveFamily =
    family ??
    (familyRaw === "skill" || familyRaw === "code-plugin" || familyRaw === "bundle-plugin"
      ? familyRaw
      : undefined);
  const includeSkills = options?.includeSkills ?? effectiveFamily === undefined;
  const channel =
    channelRaw === "official" || channelRaw === "community" || channelRaw === "private"
      ? channelRaw
      : undefined;
  const isOfficial =
    isOfficialRaw === "true" ? true : isOfficialRaw === "false" ? false : undefined;
  const executesCode =
    executesCodeRaw === "true" ? true : executesCodeRaw === "false" ? false : undefined;

  if (effectiveFamily === "skill") {
    const result = await runQueryRef<{
      page: CatalogListItem[];
      isDone: boolean;
      continueCursor: string | null;
    }>(ctx, apiRefs.skills.listPackageCatalogPage, {
      channel,
      isOfficial,
      highlightedOnly: highlightedOnly || undefined,
      executesCode,
      capabilityTag,
      paginationOpts: { cursor, numItems: limit },
    });
    return json(
      { items: result.page, nextCursor: result.isDone ? null : result.continueCursor },
      200,
      rate.headers,
    );
  }

  if (!effectiveFamily && includeSkills) {
    const packageSource = initCatalogSource(decodeUnifiedCatalogCursor(cursor).packages);
    const skillSource = initCatalogSource(decodeUnifiedCatalogCursor(cursor).skills);
    const pageSize = limit;
    const items: CatalogListItem[] = [];

    while (items.length < limit) {
      const [packageCandidate, skillCandidate] = await Promise.all([
        ensureCatalogSourcePage(packageSource, pageSize, async (pageCursor, numItems) => {
          const result = await runQueryRef<{
            page: CatalogListItem[];
            isDone: boolean;
            continueCursor: string | null;
          }>(ctx, internalRefs.packages.listPageForViewerInternal, {
            channel,
            isOfficial,
            highlightedOnly: highlightedOnly || undefined,
            executesCode,
            capabilityTag,
            viewerUserId: viewerUserId ?? undefined,
            paginationOpts: { cursor: pageCursor, numItems },
          });
          return {
            page: result.page,
            isDone: result.isDone,
            continueCursor: result.continueCursor ?? "",
          };
        }),
        ensureCatalogSourcePage(skillSource, pageSize, async (pageCursor, numItems) => {
          const result = await runQueryRef<{
            page: CatalogListItem[];
            isDone: boolean;
            continueCursor: string | null;
          }>(ctx, apiRefs.skills.listPackageCatalogPage, {
            channel,
            isOfficial,
            highlightedOnly: highlightedOnly || undefined,
            executesCode,
            capabilityTag,
            paginationOpts: { cursor: pageCursor, numItems },
          });
          return {
            page: result.page,
            isDone: result.isDone,
            continueCursor: result.continueCursor ?? "",
          };
        }),
      ]);

      if (!packageCandidate && !skillCandidate) break;
      if (
        !skillCandidate ||
        (packageCandidate && compareCatalogItems(packageCandidate, skillCandidate) <= 0)
      ) {
        items.push(packageCandidate!);
        packageSource.index += 1;
      } else {
        items.push(skillCandidate);
        skillSource.index += 1;
      }
    }

    const nextState = {
      packages: finalizeCatalogSource(packageSource),
      skills: finalizeCatalogSource(skillSource),
    };
    const isDoneAll =
      nextState.packages.done &&
      nextState.packages.offset === 0 &&
      nextState.skills.done &&
      nextState.skills.offset === 0;
    return json(
      {
        items,
        nextCursor: isDoneAll ? null : encodeUnifiedCatalogCursor(nextState),
      },
      200,
      rate.headers,
    );
  }

  if (!effectiveFamily && options?.pluginFamilies?.length) {
    const decodedCursor = decodePluginCatalogCursor(cursor);
    const codePluginSource = initCatalogSource(decodedCursor.codePlugins);
    const bundlePluginSource = initCatalogSource(decodedCursor.bundlePlugins);
    const pageSize = limit;
    const items: CatalogListItem[] = [];
    const fetchPluginPage = async (
      pluginFamily: "code-plugin" | "bundle-plugin",
      pageCursor: string | null,
      numItems: number,
    ) => {
      const result = await runQueryRef<{
        page: CatalogListItem[];
        isDone: boolean;
        continueCursor: string | null;
      }>(ctx, internalRefs.packages.listPageForViewerInternal, {
        family: pluginFamily,
        channel,
        isOfficial,
        highlightedOnly: highlightedOnly || undefined,
        executesCode,
        capabilityTag,
        viewerUserId: viewerUserId ?? undefined,
        paginationOpts: { cursor: pageCursor, numItems },
      });
      return {
        page: result.page,
        isDone: result.isDone,
        continueCursor: result.continueCursor ?? "",
      };
    };

    while (items.length < limit) {
      const [codePluginCandidate, bundlePluginCandidate] = await Promise.all([
        options.pluginFamilies.includes("code-plugin")
          ? ensureCatalogSourcePage(codePluginSource, pageSize, (pageCursor, numItems) =>
              fetchPluginPage("code-plugin", pageCursor, numItems),
            )
          : Promise.resolve(null),
        options.pluginFamilies.includes("bundle-plugin")
          ? ensureCatalogSourcePage(bundlePluginSource, pageSize, (pageCursor, numItems) =>
              fetchPluginPage("bundle-plugin", pageCursor, numItems),
            )
          : Promise.resolve(null),
      ]);

      if (!codePluginCandidate && !bundlePluginCandidate) break;
      if (
        !bundlePluginCandidate ||
        (codePluginCandidate &&
          compareCatalogItems(codePluginCandidate, bundlePluginCandidate) <= 0)
      ) {
        items.push(codePluginCandidate!);
        codePluginSource.index += 1;
      } else {
        items.push(bundlePluginCandidate);
        bundlePluginSource.index += 1;
      }
    }

    const nextState = {
      codePlugins: finalizeCatalogSource(codePluginSource),
      bundlePlugins: finalizeCatalogSource(bundlePluginSource),
    };
    const isDoneAll =
      nextState.codePlugins.done &&
      nextState.codePlugins.offset === 0 &&
      nextState.bundlePlugins.done &&
      nextState.bundlePlugins.offset === 0;
    return json(
      {
        items,
        nextCursor: isDoneAll ? null : encodePluginCatalogCursor(nextState),
      },
      200,
      rate.headers,
    );
  }

  const result = await runQueryRef<{
    page: unknown[];
    isDone: boolean;
    continueCursor: string | null;
  }>(ctx, internalRefs.packages.listPageForViewerInternal, {
    family: effectiveFamily,
    channel,
    isOfficial,
    highlightedOnly: highlightedOnly || undefined,
    executesCode,
    capabilityTag,
    viewerUserId: viewerUserId ?? undefined,
    paginationOpts: { cursor, numItems: limit },
  } satisfies PackageListQueryArgs);
  return json(
    { items: result.page, nextCursor: result.isDone ? null : result.continueCursor },
    200,
    rate.headers,
  );
}

export async function listPackagesV1Handler(ctx: ActionCtx, request: Request) {
  return await listPackages(ctx, request, undefined, { includeSkills: true });
}

export async function listPluginsV1Handler(ctx: ActionCtx, request: Request) {
  return await listPackages(ctx, request, undefined, {
    includeSkills: false,
    pluginFamilies: ["code-plugin", "bundle-plugin"],
  });
}

export async function listCodePluginsV1Handler(ctx: ActionCtx, request: Request) {
  return await listPackages(ctx, request, "code-plugin");
}

export async function listBundlePluginsV1Handler(ctx: ActionCtx, request: Request) {
  return await listPackages(ctx, request, "bundle-plugin");
}

export async function publishPackageV1Handler(ctx: ActionCtx, request: Request) {
  const rate = await applyRateLimit(ctx, request, "write");
  if (!rate.ok) return rate.response;

  const auth = await requirePackagePublishAuthOrResponse(ctx, request, rate.headers);
  if (!auth.ok) return auth.response;

  try {
    const contentType = request.headers.get("content-type") ?? "";
    const payload = contentType.includes("multipart/form-data")
      ? await parseMultipartPackagePublish(ctx, request)
      : parsePackagePublishBody(await request.json());
    const result =
      auth.auth.kind === "user"
        ? await runActionRef(ctx, internalRefs.packages.publishPackageForUserInternal, {
            actorUserId: auth.auth.userId,
            payload,
          })
        : await runActionRef(ctx, internalRefs.packages.publishPackageForTrustedPublisherInternal, {
            publishTokenId: auth.auth.publishToken._id,
            payload,
          });
    return json(result, 200, rate.headers);
  } catch (error) {
    return text(error instanceof Error ? error.message : "Publish failed", 400, rate.headers);
  }
}

async function getPackageAndTrustedPublisherByName(ctx: ActionCtx, packageName: string) {
  const pkg = await runQueryRef<Doc<"packages"> | null>(
    ctx,
    internalRefs.packages.getPackageByNameInternal,
    {
      name: packageName,
    },
  );
  if (!pkg || pkg.softDeletedAt) return { pkg: null, trustedPublisher: null };
  const trustedPublisher = await runQueryRef<PackageTrustedPublisherLike | null>(
    ctx,
    internalRefs.packages.getTrustedPublisherByPackageIdInternal,
    { packageId: pkg._id },
  );
  return { pkg, trustedPublisher };
}

export async function mintPublishTokenV1Handler(ctx: ActionCtx, request: Request) {
  const rate = await applyRateLimit(ctx, request, "write");
  if (!rate.ok) return rate.response;

  const parsedBody = await request.json().catch(() => null);
  if (!parsedBody) return text("Invalid JSON", 400, rate.headers);

  try {
    const payload = parseArk(
      PublishTokenMintRequestSchema,
      parsedBody,
      "Publish token mint payload",
    ) as {
      packageName: string;
      version: string;
      githubOidcToken: string;
    };
    const { pkg, trustedPublisher } = await getPackageAndTrustedPublisherByName(
      ctx,
      payload.packageName,
    );
    if (!pkg) return text("Package not found", 404, rate.headers);
    if (!trustedPublisher) {
      return text("Trusted publisher config is not set for this package", 403, rate.headers);
    }

    try {
      const verified = await verifyGitHubActionsTrustedPublishJwt(payload.githubOidcToken, {
        repository: trustedPublisher.repository,
        repositoryId: trustedPublisher.repositoryId,
        repositoryOwner: trustedPublisher.repositoryOwner,
        repositoryOwnerId: trustedPublisher.repositoryOwnerId,
        workflowFilename: trustedPublisher.workflowFilename,
        ...(trustedPublisher.environment ? { environment: trustedPublisher.environment } : {}),
      });
      const { token, prefix } = generateToken();
      const tokenHash = await hashToken(token);
      const expiresAt = Date.now() + 15 * 60_000;

      await ctx.runMutation(
        internalRefs.packagePublishTokens.createInternal as never,
        {
          packageId: pkg._id,
          version: payload.version,
          prefix,
          tokenHash,
          provider: "github-actions",
          repository: verified.repository,
          repositoryId: verified.repositoryId,
          repositoryOwner: verified.repositoryOwner,
          repositoryOwnerId: verified.repositoryOwnerId,
          workflowFilename: verified.workflowFilename,
          ...(trustedPublisher.environment ? { environment: trustedPublisher.environment } : {}),
          runId: verified.runId,
          runAttempt: verified.runAttempt,
          sha: verified.sha,
          ref: verified.ref,
          ...(verified.refType ? { refType: verified.refType } : {}),
          ...(verified.actor ? { actor: verified.actor } : {}),
          ...(verified.actorId ? { actorId: verified.actorId } : {}),
          expiresAt,
        } as never,
      );
      await ctx.runMutation(
        internalRefs.packages.insertAuditLogInternal as never,
        {
          actorUserId: pkg.ownerUserId,
          action: "package.publish_token.mint",
          targetType: "package",
          targetId: String(pkg._id),
          metadata: {
            version: payload.version,
            repository: verified.repository,
            workflowFilename: verified.workflowFilename,
            ...(verified.environment ? { environment: verified.environment } : {}),
            runId: verified.runId,
            runAttempt: verified.runAttempt,
            sha: verified.sha,
            ref: verified.ref,
            decision: "allowed",
          },
        } as never,
      );
      return json({ token, expiresAt }, 200, rate.headers);
    } catch (error) {
      await ctx.runMutation(
        internalRefs.packages.insertAuditLogInternal as never,
        {
          actorUserId: pkg.ownerUserId,
          action: "package.publish_token.mint_rejected",
          targetType: "package",
          targetId: String(pkg._id),
          metadata: {
            version: payload.version,
            repository: trustedPublisher.repository,
            workflowFilename: trustedPublisher.workflowFilename,
            ...(trustedPublisher.environment ? { environment: trustedPublisher.environment } : {}),
            decision: "rejected",
            reason: error instanceof Error ? error.message : "Token verification failed",
          },
        } as never,
      );
      throw error;
    }
  } catch (error) {
    return text(error instanceof Error ? error.message : "Token mint failed", 400, rate.headers);
  }
}

export async function packagesPostRouterV1Handler(ctx: ActionCtx, request: Request) {
  const segments = getPathSegments(request, "/api/v1/packages/");
  if (segments[0] === "backfill" && segments[1] === "artifacts" && segments.length === 2) {
    const rate = await applyRateLimit(ctx, request, "write");
    if (!rate.ok) return rate.response;
    const auth = await requireApiTokenUserOrResponse(ctx, request, rate.headers);
    if (!auth.ok) return auth.response;

    try {
      const body = parseArk(
        PackageArtifactBackfillRequestSchema,
        await request.json().catch(() => ({})),
        "Package artifact backfill payload",
      ) as {
        cursor?: string | null;
        batchSize?: number;
        dryRun?: boolean;
      };
      const result = await runMutationRef(
        ctx,
        internalRefs.packages.backfillPackageArtifactKindsInternal,
        {
          actorUserId: auth.userId,
          ...(body.cursor !== undefined ? { cursor: body.cursor } : {}),
          ...(typeof body.batchSize === "number" ? { batchSize: body.batchSize } : {}),
          ...(typeof body.dryRun === "boolean" ? { dryRun: body.dryRun } : {}),
        },
      );
      return json(result, 200, rate.headers);
    } catch (error) {
      return text(
        error instanceof Error ? error.message : "Package artifact backfill failed",
        400,
        rate.headers,
      );
    }
  }

  if (segments[0] === "migrations" && segments.length === 1) {
    const rate = await applyRateLimit(ctx, request, "write");
    if (!rate.ok) return rate.response;
    const auth = await requireApiTokenUserOrResponse(ctx, request, rate.headers);
    if (!auth.ok) return auth.response;

    try {
      const body = parseArk(
        PackageOfficialMigrationUpsertRequestSchema,
        await request.json(),
        "Package official migration payload",
      );
      const result = await runMutationRef(
        ctx,
        internalRefs.packages.upsertOfficialPluginMigrationForUserInternal,
        {
          actorUserId: auth.userId,
          ...body,
        },
      );
      const parsed = parseArk(
        ApiV1PackageOfficialMigrationResponseSchema,
        result,
        "Package official migration response",
      );
      return json(parsed, 200, rate.headers);
    } catch (error) {
      return text(
        error instanceof Error ? error.message : "Package official migration update failed",
        400,
        rate.headers,
      );
    }
  }

  if (
    segments[0] === "reports" &&
    segments[1] &&
    segments[2] === "triage" &&
    segments.length === 3
  ) {
    const rate = await applyRateLimit(ctx, request, "write");
    if (!rate.ok) return rate.response;
    const auth = await requireApiTokenUserOrResponse(ctx, request, rate.headers);
    if (!auth.ok) return auth.response;

    try {
      const body = parseArk(
        PackageReportTriageRequestSchema,
        await request.json(),
        "Package report triage payload",
      ) as {
        status: "open" | "triaged" | "dismissed";
        note?: string;
      };
      const result = await runMutationRef(
        ctx,
        internalRefs.packages.triagePackageReportForUserInternal,
        {
          actorUserId: auth.userId,
          reportId: segments[1] as Id<"packageReports">,
          status: body.status,
          ...(body.note ? { note: body.note } : {}),
        },
      );
      return json(result, 200, rate.headers);
    } catch (error) {
      return text(
        error instanceof Error ? error.message : "Package report triage failed",
        400,
        rate.headers,
      );
    }
  }

  if (
    segments[0] === "appeals" &&
    segments[1] &&
    segments[2] === "resolve" &&
    segments.length === 3
  ) {
    const rate = await applyRateLimit(ctx, request, "write");
    if (!rate.ok) return rate.response;
    const auth = await requireApiTokenUserOrResponse(ctx, request, rate.headers);
    if (!auth.ok) return auth.response;

    try {
      const body = parseArk(
        PackageAppealResolveRequestSchema,
        await request.json(),
        "Package appeal resolve payload",
      ) as {
        status: "open" | "accepted" | "rejected";
        note?: string;
      };
      const result = await runMutationRef(
        ctx,
        internalRefs.packages.resolvePackageAppealForUserInternal,
        {
          actorUserId: auth.userId,
          appealId: segments[1] as Id<"packageAppeals">,
          status: body.status,
          ...(body.note ? { note: body.note } : {}),
        },
      );
      return json(result, 200, rate.headers);
    } catch (error) {
      return text(
        error instanceof Error ? error.message : "Package appeal resolve failed",
        400,
        rate.headers,
      );
    }
  }

  const packageRoute = parsePackagePathSegments(segments);
  if (!packageRoute) return text("Not found", 404);
  const packageName = packageRoute.packageName;
  const packageSegments = packageRoute.rest;

  if (
    packageSegments[0] === "versions" &&
    packageSegments[1] &&
    packageSegments[2] === "moderation" &&
    packageSegments.length === 3
  ) {
    const rate = await applyRateLimit(ctx, request, "write");
    if (!rate.ok) return rate.response;
    const auth = await requireApiTokenUserOrResponse(ctx, request, rate.headers);
    if (!auth.ok) return auth.response;

    try {
      const body = parseArk(
        PackageReleaseModerationRequestSchema,
        await request.json(),
        "Package release moderation payload",
      ) as {
        state: "approved" | "quarantined" | "revoked";
        reason: string;
      };
      const result = await runMutationRef(
        ctx,
        internalRefs.packages.moderatePackageReleaseForUserInternal,
        {
          actorUserId: auth.userId,
          name: packageName,
          version: packageSegments[1],
          state: body.state,
          reason: body.reason,
        },
      );
      return json(result, 200, rate.headers);
    } catch (error) {
      return text(
        error instanceof Error ? error.message : "Package release moderation failed",
        400,
        rate.headers,
      );
    }
  }

  if (packageSegments[0] === "report" && packageSegments.length === 1) {
    const rate = await applyRateLimit(ctx, request, "write");
    if (!rate.ok) return rate.response;
    const auth = await requireApiTokenUserOrResponse(ctx, request, rate.headers);
    if (!auth.ok) return auth.response;

    try {
      const body = parseArk(
        PackageReportRequestSchema,
        await request.json(),
        "Package report payload",
      ) as {
        reason: string;
        version?: string;
      };
      const result = await runMutationRef(ctx, internalRefs.packages.reportPackageForUserInternal, {
        actorUserId: auth.userId,
        name: packageName,
        reason: body.reason,
        ...(body.version ? { version: body.version } : {}),
      });
      return json(result, 200, rate.headers);
    } catch (error) {
      return text(
        error instanceof Error ? error.message : "Package report failed",
        400,
        rate.headers,
      );
    }
  }

  if (packageSegments[0] === "appeal" && packageSegments.length === 1) {
    const rate = await applyRateLimit(ctx, request, "write");
    if (!rate.ok) return rate.response;
    const auth = await requireApiTokenUserOrResponse(ctx, request, rate.headers);
    if (!auth.ok) return auth.response;

    try {
      const body = parseArk(
        PackageAppealRequestSchema,
        await request.json(),
        "Package appeal payload",
      ) as {
        version: string;
        message: string;
      };
      const result = await runMutationRef(
        ctx,
        internalRefs.packages.submitPackageAppealForUserInternal,
        {
          actorUserId: auth.userId,
          name: packageName,
          version: body.version,
          message: body.message,
        },
      );
      return json(result, 200, rate.headers);
    } catch (error) {
      return text(
        error instanceof Error ? error.message : "Package appeal failed",
        400,
        rate.headers,
      );
    }
  }

  if (packageSegments[0] === "rescan" && packageSegments.length === 1) {
    const rate = await applyRateLimit(ctx, request, "write");
    if (!rate.ok) return rate.response;
    const auth = await requireApiTokenUserOrResponse(ctx, request, rate.headers);
    if (!auth.ok) return auth.response;

    try {
      const result = await runMutationRef(
        ctx,
        internalRefs.packages.requestRescanForApiTokenInternal,
        {
          actorUserId: auth.userId,
          name: packageName,
        },
      );
      return json(result, 200, rate.headers);
    } catch (error) {
      return text(
        error instanceof Error ? error.message : "Rescan request failed",
        400,
        rate.headers,
      );
    }
  }

  if (packageSegments[0] !== "trusted-publisher" || packageSegments.length !== 1) {
    return text("Not found", 404);
  }
  const rate = await applyRateLimit(ctx, request, "write");
  if (!rate.ok) return rate.response;
  const auth = await requireApiTokenUserOrResponse(ctx, request, rate.headers);
  if (!auth.ok) return auth.response;

  try {
    const body = parseArk(
      PackageTrustedPublisherUpsertRequestSchema,
      await request.json(),
      "Trusted publisher payload",
    ) as {
      repository: string;
      workflowFilename: string;
      environment?: string;
    };
    const repositoryIdentity = await fetchGitHubRepositoryIdentity(body.repository);
    const trustedPublisher = await runMutationRef<PackageTrustedPublisherLike | null>(
      ctx,
      internalRefs.packages.setTrustedPublisherForUserInternal,
      {
        actorUserId: auth.userId,
        packageName,
        repository: repositoryIdentity.repository,
        repositoryId: repositoryIdentity.repositoryId,
        repositoryOwner: repositoryIdentity.repositoryOwner,
        repositoryOwnerId: repositoryIdentity.repositoryOwnerId,
        workflowFilename: body.workflowFilename,
        ...(body.environment ? { environment: body.environment } : {}),
      },
    );
    return json(
      { trustedPublisher: toPublicTrustedPublisher(trustedPublisher) },
      200,
      rate.headers,
    );
  } catch (error) {
    return text(
      error instanceof Error ? error.message : "Trusted publisher update failed",
      400,
      rate.headers,
    );
  }
}

export async function packagesDeleteRouterV1Handler(ctx: ActionCtx, request: Request) {
  const segments = getPathSegments(request, "/api/v1/packages/");
  const packageRoute = parsePackagePathSegments(segments);
  if (!packageRoute) return text("Not found", 404);
  const packageName = packageRoute.packageName;
  const packageSegments = packageRoute.rest;
  const rate = await applyRateLimit(ctx, request, "write");
  if (!rate.ok) return rate.response;
  const auth = await requireApiTokenUserOrResponse(ctx, request, rate.headers);
  if (!auth.ok) return auth.response;

  if (packageSegments.length === 0) {
    try {
      await runMutationRef(ctx, internalRefs.packages.softDeletePackageInternal, {
        userId: auth.userId,
        name: packageName,
      });
      return json({ ok: true }, 200, rate.headers);
    } catch (error) {
      return softDeleteErrorToResponse("package", error, rate.headers);
    }
  }

  if (packageSegments[0] !== "trusted-publisher" || packageSegments.length !== 1) {
    return text("Not found", 404, rate.headers);
  }

  try {
    await runMutationRef(ctx, internalRefs.packages.deleteTrustedPublisherForUserInternal, {
      actorUserId: auth.userId,
      packageName,
    });
    return json({ ok: true }, 200, rate.headers);
  } catch (error) {
    return text(
      error instanceof Error ? error.message : "Trusted publisher delete failed",
      400,
      rate.headers,
    );
  }
}

async function getReleaseForRequest(
  ctx: ActionCtx,
  pkg: Pick<PublicPackageDocLike, "_id" | "tags" | "latestReleaseId">,
  request: Request,
): Promise<ReleaseLike | null> {
  const url = new URL(request.url);
  const versionParam = url.searchParams.get("version")?.trim();
  const tagParam = url.searchParams.get("tag")?.trim();

  if (versionParam) {
    return toVisibleRelease(
      await runQueryRef<ReleaseLike | null>(
        ctx,
        internalRefs.packages.getReleaseByPackageAndVersionInternal,
        {
          packageId: pkg._id,
          version: versionParam,
        },
      ),
    );
  }
  if (tagParam) {
    const releaseId = pkg.tags[tagParam];
    if (!releaseId) return null;
    return toVisibleRelease(
      await runQueryRef<ReleaseLike | null>(ctx, internalRefs.packages.getReleaseByIdInternal, {
        releaseId,
      }),
    );
  }
  if (!pkg.latestReleaseId) return null;
  return toVisibleRelease(
    await runQueryRef<ReleaseLike | null>(ctx, internalRefs.packages.getReleaseByIdInternal, {
      releaseId: pkg.latestReleaseId,
    }),
  );
}

function isReadmeVariantPath(path: string) {
  const normalized = path.trim().toLowerCase();
  return (
    normalized === "readme.md" || normalized === "readme.mdx" || normalized === "readme.markdown"
  );
}

function resolveSkillFilePath(version: SkillVersionLike, requestedPath: string) {
  const normalized = requestedPath.trim();
  const lower = normalized.toLowerCase();
  if (isReadmeVariantPath(normalized)) {
    return (
      version.files.find((file) => {
        const fileLower = file.path.toLowerCase();
        return fileLower === "skill.md" || fileLower === "skills.md";
      }) ?? null
    );
  }
  return (
    version.files.find((file) => file.path === normalized) ??
    version.files.find((file) => file.path.toLowerCase() === lower) ??
    null
  );
}

function resolvePackageFilePath(release: ReleaseLike, requestedPath: string) {
  const normalized = requestedPath.trim();
  const lower = normalized.toLowerCase();
  if (isReadmeVariantPath(normalized)) {
    return (
      release.files.find((file) => isReadmeVariantPath(file.path)) ??
      release.files.find((file) => file.path.toLowerCase() === lower) ??
      null
    );
  }
  return (
    release.files.find((file) => file.path === normalized) ??
    release.files.find((file) => file.path.toLowerCase() === lower) ??
    null
  );
}

async function getSkillDetailForRequest(ctx: ActionCtx, slug: string) {
  return (await runQueryRef(ctx, apiRefs.skills.getBySlug, { slug })) as {
    skill: SkillPackageDocLike | null;
    latestVersion: SkillVersionLike | null;
    owner: { handle?: string; displayName?: string; image?: string } | null;
  } | null;
}

async function getSkillVersionForRequest(
  ctx: ActionCtx,
  skill: Pick<SkillPackageDocLike, "_id" | "latestVersionId" | "tags">,
  request: Request,
) {
  const url = new URL(request.url);
  const versionParam = url.searchParams.get("version")?.trim();
  const tagParam = url.searchParams.get("tag")?.trim();

  if (versionParam) {
    return (await runQueryRef(ctx, internalRefs.skills.getVersionBySkillAndVersionInternal, {
      skillId: skill._id,
      version: versionParam,
    })) as SkillVersionLike | null;
  }
  if (tagParam) {
    const versionId = skill.tags[tagParam];
    if (!versionId) return null;
    return (await runQueryRef(ctx, internalRefs.skills.getVersionByIdInternal, {
      versionId,
    })) as SkillVersionLike | null;
  }
  const latestVersionId = skill.latestVersionId ?? skill.tags.latest;
  if (!latestVersionId) return null;
  return (await runQueryRef(ctx, internalRefs.skills.getVersionByIdInternal, {
    versionId: latestVersionId,
  })) as SkillVersionLike | null;
}

async function searchPackages(
  ctx: ActionCtx,
  request: Request,
  options?: { includeSkills?: boolean; pluginFamilies?: Array<"code-plugin" | "bundle-plugin"> },
) {
  const rate = await applyRateLimit(ctx, request, "read");
  if (!rate.ok) return rate.response;

  const url = new URL(request.url);
  const viewerUserId = await getOptionalViewerUserIdForRequest(ctx, request);
  const queryText = url.searchParams.get("q")?.trim() ?? "";
  const limit = Math.max(1, Math.min(toOptionalNumber(url.searchParams.get("limit")) ?? 20, 100));
  const familyRaw = url.searchParams.get("family");
  const channelRaw = url.searchParams.get("channel");
  const isOfficialRaw = url.searchParams.get("isOfficial");
  const highlightedOnly =
    url.searchParams.get("featured") === "true" ||
    url.searchParams.get("featured") === "1" ||
    url.searchParams.get("highlightedOnly") === "true" ||
    url.searchParams.get("highlightedOnly") === "1";
  const executesCodeRaw = url.searchParams.get("executesCode");
  const capabilityTag = getCapabilityTagFromQueryParams(url.searchParams);
  const family =
    familyRaw === "skill" || familyRaw === "code-plugin" || familyRaw === "bundle-plugin"
      ? familyRaw
      : undefined;
  const includeSkills = options?.includeSkills ?? family === undefined;
  const channel =
    channelRaw === "official" || channelRaw === "community" || channelRaw === "private"
      ? channelRaw
      : undefined;
  const isOfficial =
    isOfficialRaw === "true" ? true : isOfficialRaw === "false" ? false : undefined;
  const executesCode =
    executesCodeRaw === "true" ? true : executesCodeRaw === "false" ? false : undefined;

  let results: CatalogSearchEntry[];
  if (family === "skill") {
    results = await runQueryRef<CatalogSearchEntry[]>(
      ctx,
      apiRefs.skills.searchPackageCatalogPublic,
      {
        query: queryText,
        limit,
        channel,
        isOfficial,
        highlightedOnly: highlightedOnly || undefined,
        executesCode,
        capabilityTag,
      },
    );
  } else if (family || !includeSkills) {
    if (!family && options?.pluginFamilies?.length) {
      const pluginResults = await Promise.all(
        options.pluginFamilies.map((pluginFamily) =>
          searchPackageCatalogByListing(ctx, {
            query: queryText,
            limit,
            family: pluginFamily,
            channel,
            isOfficial,
            highlightedOnly: highlightedOnly || undefined,
            executesCode,
            capabilityTag,
            viewerUserId: viewerUserId ?? undefined,
          }),
        ),
      );
      const seen = new Set<string>();
      results = pluginResults
        .flat()
        .filter((entry) => {
          const key = `${entry.package.family}:${entry.package.name}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .sort(compareCatalogSearchEntries)
        .slice(0, limit);
    } else {
      results = await searchPackageCatalogByListing(ctx, {
        query: queryText,
        limit,
        family,
        channel,
        isOfficial,
        highlightedOnly: highlightedOnly || undefined,
        executesCode,
        capabilityTag,
        viewerUserId: viewerUserId ?? undefined,
      });
    }
  } else {
    const [packageResults, skillResults] = await Promise.all([
      searchPackageCatalogByListing(ctx, {
        query: queryText,
        limit,
        channel,
        isOfficial,
        highlightedOnly: highlightedOnly || undefined,
        executesCode,
        capabilityTag,
        viewerUserId: viewerUserId ?? undefined,
      }),
      runQueryRef<CatalogSearchEntry[]>(ctx, apiRefs.skills.searchPackageCatalogPublic, {
        query: queryText,
        limit,
        channel,
        isOfficial,
        highlightedOnly: highlightedOnly || undefined,
        executesCode,
        capabilityTag,
      }),
    ]);
    const seen = new Set<string>();
    results = [...packageResults, ...skillResults]
      .filter((entry) => {
        const key = `${entry.package.family}:${entry.package.name}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort(compareCatalogSearchEntries)
      .slice(0, limit);
  }
  return json({ results }, 200, rate.headers);
}

export async function packagesGetRouterV1Handler(ctx: ActionCtx, request: Request) {
  const segments = getPathSegments(request, "/api/v1/packages/");
  if (segments.length === 0) return text("Not found", 404);
  if (segments[0] === "search" && new URL(request.url).searchParams.has("q")) {
    return await searchPackages(ctx, request, { includeSkills: true });
  }

  if (segments[0] === "moderation" && segments[1] === "queue" && segments.length === 2) {
    const rate = await applyRateLimit(ctx, request, "read");
    if (!rate.ok) return rate.response;
    const auth = await requireApiTokenUserOrResponse(ctx, request, rate.headers);
    if (!auth.ok) return auth.response;

    const url = new URL(request.url);
    const status = parsePackageModerationQueueStatus(url.searchParams.get("status"));
    if (!status) return text("Invalid moderation queue status", 400, rate.headers);
    const limit = Math.max(1, Math.min(toOptionalNumber(url.searchParams.get("limit")) ?? 25, 100));
    const cursor = url.searchParams.get("cursor");
    const result = await runQueryRef(
      ctx,
      internalRefs.packages.listPackageModerationQueueInternal,
      {
        actorUserId: auth.userId,
        cursor: cursor ?? null,
        limit,
        status,
      },
    );
    return json(result, 200, rate.headers);
  }

  if (segments[0] === "reports" && segments.length === 1) {
    const rate = await applyRateLimit(ctx, request, "read");
    if (!rate.ok) return rate.response;
    const auth = await requireApiTokenUserOrResponse(ctx, request, rate.headers);
    if (!auth.ok) return auth.response;

    const url = new URL(request.url);
    const status = parsePackageReportListStatus(url.searchParams.get("status"));
    if (!status) return text("Invalid package report status", 400, rate.headers);
    const limit = Math.max(1, Math.min(toOptionalNumber(url.searchParams.get("limit")) ?? 25, 100));
    const cursor = url.searchParams.get("cursor");
    const result = await runQueryRef(ctx, internalRefs.packages.listPackageReportsInternal, {
      actorUserId: auth.userId,
      cursor: cursor ?? null,
      limit,
      status,
    });
    return json(result, 200, rate.headers);
  }

  if (segments[0] === "appeals" && segments.length === 1) {
    const rate = await applyRateLimit(ctx, request, "read");
    if (!rate.ok) return rate.response;
    const auth = await requireApiTokenUserOrResponse(ctx, request, rate.headers);
    if (!auth.ok) return auth.response;

    const url = new URL(request.url);
    const status = parsePackageAppealListStatus(url.searchParams.get("status"));
    if (!status) return text("Invalid package appeal status", 400, rate.headers);
    const limit = Math.max(1, Math.min(toOptionalNumber(url.searchParams.get("limit")) ?? 25, 100));
    const cursor = url.searchParams.get("cursor");
    const result = await runQueryRef(ctx, internalRefs.packages.listPackageAppealsInternal, {
      actorUserId: auth.userId,
      cursor: cursor ?? null,
      limit,
      status,
    });
    return json(result, 200, rate.headers);
  }

  if (segments[0] === "migrations" && segments.length === 1) {
    const rate = await applyRateLimit(ctx, request, "read");
    if (!rate.ok) return rate.response;
    const auth = await requireApiTokenUserOrResponse(ctx, request, rate.headers);
    if (!auth.ok) return auth.response;

    const url = new URL(request.url);
    const phase = parsePackageOfficialMigrationPhase(url.searchParams.get("phase"));
    if (!phase) return text("Invalid official migration phase", 400, rate.headers);
    const limit = Math.max(1, Math.min(toOptionalNumber(url.searchParams.get("limit")) ?? 25, 100));
    const cursor = url.searchParams.get("cursor");
    const result = await runQueryRef(
      ctx,
      internalRefs.packages.listOfficialPluginMigrationsInternal,
      {
        actorUserId: auth.userId,
        cursor: cursor ?? null,
        limit,
        phase,
      },
    );
    const parsed = parseArk(
      ApiV1PackageOfficialMigrationListResponseSchema,
      result,
      "Package official migration list response",
    );
    return json(parsed, 200, rate.headers);
  }

  const packageRoute = parsePackagePathSegments(segments);
  if (!packageRoute) return text("Not found", 404);
  const packageName = packageRoute.packageName;
  const packageSegments = packageRoute.rest;

  if (packageSegments[0] === "moderation" && packageSegments.length === 1) {
    const rate = await applyRateLimit(ctx, request, "read");
    if (!rate.ok) return rate.response;
    const auth = await requireApiTokenUserOrResponse(ctx, request, rate.headers);
    if (!auth.ok) return auth.response;

    try {
      const result = await runQueryRef(
        ctx,
        internalRefs.packages.getPackageModerationStatusForUserInternal,
        {
          actorUserId: auth.userId,
          name: packageName,
        },
      );
      const parsed = parseArk(
        ApiV1PackageModerationStatusResponseSchema,
        result,
        "Package moderation status response",
      );
      return json(parsed, 200, rate.headers);
    } catch (error) {
      return text(
        error instanceof Error ? error.message : "Package moderation status failed",
        400,
        rate.headers,
      );
    }
  }

  const rateKind =
    packageSegments[0] === "download" ||
    packageSegments[2] === "artifact" ||
    packageSegments[3] === "download"
      ? "download"
      : "read";
  const rate = await applyRateLimit(ctx, request, rateKind);
  if (!rate.ok) return rate.response;

  const viewerUserId = await getOptionalViewerUserIdForRequest(ctx, request);
  const detail = (await runQueryRef(ctx, internalRefs.packages.getByNameForViewerInternal, {
    name: packageName,
    viewerUserId: viewerUserId ?? undefined,
  })) as {
    package: PublicPackageDocLike | null;
    latestRelease: ReleaseLike | null;
    owner: { _id: Id<"users">; handle?: string; displayName?: string; image?: string } | null;
  } | null;
  const skillDetail = detail?.package ? null : await getSkillDetailForRequest(ctx, packageName);
  if (!detail?.package && !skillDetail?.skill) return text("Package not found", 404, rate.headers);
  const packageDetail = detail?.package ? detail : null;
  const publicPackage = packageDetail?.package ?? null;
  const packageOwner = packageDetail?.owner ?? null;

  if (packageSegments.length === 0) {
    if (skillDetail?.skill) {
      return json(
        toSkillPackageDetail(
          skillDetail.skill,
          skillDetail.latestVersion,
          skillDetail.owner,
          await resolveSkillTags(ctx, skillDetail.skill.tags),
        ),
        200,
        rate.headers,
      );
    }
    return json(
      {
        package: {
          ...publicPackage!,
          tags: await resolvePackageTags(ctx, publicPackage!.tags),
        },
        owner: packageOwner
          ? {
              handle: packageOwner.handle ?? null,
              displayName: packageOwner.displayName ?? null,
              image: packageOwner.image ?? null,
            }
          : null,
      },
      200,
      rate.headers,
    );
  }

  if (packageSegments[0] === "trusted-publisher" && packageSegments.length === 1) {
    if (!publicPackage) return text("Not found", 404, rate.headers);
    const trustedPublisher = await runQueryRef<PackageTrustedPublisherLike | null>(
      ctx,
      internalRefs.packages.getTrustedPublisherByPackageIdInternal,
      { packageId: publicPackage._id },
    );
    return json(
      { trustedPublisher: toPublicTrustedPublisher(trustedPublisher) },
      200,
      rate.headers,
    );
  }

  if (packageSegments[0] === "readiness" && packageSegments.length === 1) {
    if (!publicPackage) return text("Not found", 404, rate.headers);
    return json(buildPackageReadiness(publicPackage), 200, rate.headers);
  }

  if (packageSegments[0] === "versions" && packageSegments.length === 1) {
    const limit = Math.max(
      1,
      Math.min(toOptionalNumber(new URL(request.url).searchParams.get("limit")) ?? 25, 100),
    );
    const cursor = new URL(request.url).searchParams.get("cursor");
    if (skillDetail?.skill) {
      const result = (await runQueryRef(ctx, apiRefs.skills.listVersionsPage, {
        skillId: skillDetail.skill._id,
        cursor: cursor ?? undefined,
        limit,
      })) as {
        items: Array<{ version: string; createdAt: number; changelog: string }>;
        nextCursor: string | null;
      };
      const tags = await resolveSkillTags(ctx, skillDetail.skill.tags);
      return json(
        {
          items: result.items.map((version) => ({
            version: version.version,
            createdAt: version.createdAt,
            changelog: version.changelog,
            distTags: skillVersionTags(tags, version.version),
          })),
          nextCursor: result.nextCursor,
        },
        200,
        rate.headers,
      );
    }
    const result = await runQueryRef<{
      page: ReleaseLike[];
      isDone: boolean;
      continueCursor: string | null;
    }>(ctx, internalRefs.packages.listVersionsForViewerInternal, {
      name: packageName,
      viewerUserId: viewerUserId ?? undefined,
      paginationOpts: { cursor, numItems: limit },
    });
    return json(
      {
        items: result.page.map((release: ReleaseLike) => ({
          version: release.version,
          createdAt: release.createdAt,
          changelog: release.changelog,
          distTags: release.distTags ?? [],
        })),
        nextCursor: result.isDone ? null : result.continueCursor,
      },
      200,
      rate.headers,
    );
  }

  if (
    packageSegments[0] === "versions" &&
    packageSegments[1] &&
    packageSegments[2] === "artifact"
  ) {
    if (skillDetail?.skill) return text("Artifact not found", 404, rate.headers);
    const result = (await runQueryRef(
      ctx,
      internalRefs.packages.getVersionByNameForViewerInternal,
      {
        name: packageName,
        version: packageSegments[1],
        viewerUserId: viewerUserId ?? undefined,
      },
    )) as { package: PublicPackageDocLike; version: ReleaseLike } | null;
    const release = result?.version ?? null;
    if (!release) return text("Version not found", 404, rate.headers);
    if (packageSegments[3] === "download") {
      if (release.artifactKind === "npm-pack") {
        return await streamClawPackRelease(ctx, rate.headers, publicPackage!, release);
      }
      const url = new URL(
        `/api/v1/packages/${encodePackagePath(publicPackage!.name)}/download`,
        request.url,
      );
      url.searchParams.set("version", release.version);
      return new Response(null, {
        status: 307,
        headers: mergeHeaders(rate.headers, { Location: url.toString() }, corsHeaders()),
      });
    }
    return json(
      {
        package: {
          name: publicPackage!.name,
          displayName: publicPackage!.displayName,
          family: publicPackage!.family,
        },
        version: release.version,
        artifact: {
          ...toReleaseArtifact(release),
          ...releaseArtifactUrls(request, publicPackage!.name, release),
        },
      },
      200,
      rate.headers,
    );
  }

  if (packageSegments[0] === "versions" && packageSegments[1]) {
    if (skillDetail?.skill) {
      const version = (await runQueryRef(
        ctx,
        internalRefs.skills.getVersionBySkillAndVersionInternal,
        {
          skillId: skillDetail.skill._id,
          version: packageSegments[1],
        },
      )) as SkillVersionLike | null;
      if (!version || version.softDeletedAt) return text("Version not found", 404, rate.headers);
      const tags = await resolveSkillTags(ctx, skillDetail.skill.tags);
      return json(
        {
          package: {
            name: skillDetail.skill.slug,
            displayName: skillDetail.skill.displayName,
            family: "skill",
          },
          version: {
            version: version.version,
            createdAt: version.createdAt,
            changelog: version.changelog,
            distTags: skillVersionTags(tags, version.version),
            files: version.files.map((file) => ({
              path: file.path,
              size: file.size,
              sha256: file.sha256,
              contentType: file.contentType,
            })),
            compatibility: null,
            capabilities: null,
            verification: null,
            artifact: null,
          },
        },
        200,
        rate.headers,
      );
    }
    const result = (await runQueryRef(
      ctx,
      internalRefs.packages.getVersionByNameForViewerInternal,
      {
        name: packageName,
        version: packageSegments[1],
        viewerUserId: viewerUserId ?? undefined,
      },
    )) as { package: PublicPackageDocLike; version: ReleaseLike } | null;
    if (!result) return text("Version not found", 404, rate.headers);
    return json(
      {
        package: {
          name: result.package.name,
          displayName: result.package.displayName,
          family: result.package.family,
        },
        version: {
          version: result.version.version,
          createdAt: result.version.createdAt,
          changelog: result.version.changelog,
          distTags: result.version.distTags ?? [],
          files: result.version.files.map((file) => ({
            path: file.path,
            size: file.size,
            sha256: file.sha256,
            contentType: file.contentType,
          })),
          compatibility: result.version.compatibility ?? null,
          capabilities: result.version.capabilities ?? null,
          verification: result.version.verification ?? null,
          artifact: toReleaseArtifact(result.version),
          sha256hash: result.version.sha256hash ?? null,
          vtAnalysis: result.version.vtAnalysis ?? null,
          llmAnalysis: result.version.llmAnalysis ?? null,
          staticScan: result.version.staticScan ?? null,
        },
      },
      200,
      rate.headers,
    );
  }

  if (packageSegments[0] === "file") {
    const path = new URL(request.url).searchParams.get("path")?.trim();
    if (!path) return text("Missing path", 400, rate.headers);
    if (skillDetail?.skill) {
      const version = await getSkillVersionForRequest(ctx, skillDetail.skill, request);
      if (!version || version.softDeletedAt) return text("Version not found", 404, rate.headers);
      const file = resolveSkillFilePath(version, path);
      if (!file) return text("File not found", 404, rate.headers);
      if (!("storageId" in file) || !file.storageId)
        return text("File not found", 404, rate.headers);
      if (!isTextFile(file.path, file.contentType)) {
        return text("Binary files are not served inline", 415, rate.headers);
      }
      if (file.size > MAX_RAW_FILE_BYTES) return text("File too large", 413, rate.headers);
      const blob = await ctx.storage.get(file.storageId);
      if (!blob) return text("File not found", 404, rate.headers);
      return safeTextFileResponse({
        textContent: await blob.text(),
        path: file.path,
        contentType: file.contentType,
        sha256: file.sha256,
        size: file.size,
        headers: rate.headers,
      });
    }
    const release = await getReleaseForRequest(ctx, publicPackage!, request);
    if (!release) return text("Version not found", 404, rate.headers);
    const securityBlock = getReleaseSecurityBlock(release);
    if (securityBlock) return text(securityBlock.message, securityBlock.status, rate.headers);
    const file = resolvePackageFilePath(release, path);
    if (!file) return text("File not found", 404, rate.headers);
    if (!isTextFile(file.path, file.contentType)) {
      return text("Binary files are not served inline", 415, rate.headers);
    }
    if (file.size > MAX_RAW_FILE_BYTES) return text("File too large", 413, rate.headers);
    const blob = await ctx.storage.get(file.storageId);
    if (!blob) return text("File not found", 404, rate.headers);
    const textContent = await blob.text();
    return safeTextFileResponse({
      textContent,
      path: file.path,
      contentType: file.contentType,
      sha256: file.sha256,
      size: file.size,
      headers: rate.headers,
    });
  }

  if (packageSegments[0] === "download") {
    if (skillDetail?.skill) {
      const url = new URL("/api/v1/download", request.url);
      url.searchParams.set("slug", skillDetail.skill.slug);
      const requestUrl = new URL(request.url);
      const version = requestUrl.searchParams.get("version")?.trim();
      const tag = requestUrl.searchParams.get("tag")?.trim();
      if (version) url.searchParams.set("version", version);
      if (tag) url.searchParams.set("tag", tag);
      return new Response(null, {
        status: 307,
        headers: mergeHeaders(rate.headers, { Location: url.toString() }, corsHeaders()),
      });
    }
    const release = await getReleaseForRequest(ctx, publicPackage!, request);
    if (!release) return text("Version not found", 404, rate.headers);
    const securityBlock = getReleaseSecurityBlock(release);
    if (securityBlock) return text(securityBlock.message, securityBlock.status, rate.headers);
    const entries: Array<{ path: string; bytes: Uint8Array }> = [];
    for (const file of release.files) {
      const blob = await ctx.storage.get(file.storageId);
      if (!blob) return text(`Missing stored file: ${file.path}`, 500, rate.headers);
      entries.push({
        path: file.path,
        bytes: new Uint8Array(await blob.arrayBuffer()),
      });
    }
    const zip = buildDeterministicPackageZip(entries);
    const [zipSha256, zipSha256Base64] = await Promise.all([sha256Hex(zip), sha256Base64(zip)]);
    try {
      await runMutationRef(ctx, internalRefs.packages.recordPackageDownloadInternal, {
        packageId: publicPackage!._id,
      });
    } catch {
      // Best-effort metric path; never fail package downloads.
    }
    return new Response(new Blob([zip], { type: "application/zip" }), {
      status: 200,
      headers: mergeHeaders(
        rate.headers,
        {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${publicPackage!.name.replaceAll("/", "-")}-${release.version}.zip"`,
          ETag: `"sha256:${zipSha256}"`,
          Digest: `sha-256=${zipSha256Base64}`,
          "X-ClawHub-Artifact-Type": "legacy-plugin-zip",
          "X-ClawHub-Artifact-Sha256": zipSha256,
        },
        corsHeaders(),
      ),
    });
  }

  return text("Not found", 404, rate.headers);
}

function parseNpmMirrorPath(request: Request) {
  const segments = getPathSegments(request, "/api/npm/");
  if (segments.length === 0) return null;
  return parsePackagePathSegments(segments);
}

function parsePackagePathSegments(segments: string[]) {
  if (segments.length === 0) return null;
  if (segments[0]?.startsWith("@")) {
    if (segments[0].includes("/")) {
      const [scope, name] = segments[0].split("/");
      if (!scope || !name) return null;
      return {
        packageName: `${scope}/${name}`,
        rest: segments.slice(1),
      };
    }
    if (segments.length < 2) return null;
    return {
      packageName: `${segments[0]}/${segments[1]}`,
      rest: segments.slice(2),
    };
  }
  return {
    packageName: segments[0]!,
    rest: segments.slice(1),
  };
}

type NpmPackReleasePage = {
  page: ReleaseLike[];
  isDone: boolean;
  continueCursor: string | null;
};

async function listNpmPackReleases(
  ctx: ActionCtx,
  packageName: string,
  viewerUserId: Id<"users"> | null,
) {
  const releases: ReleaseLike[] = [];
  let cursor: string | null = null;
  let done = false;
  let pages = 0;
  while (!done && pages < 20) {
    pages += 1;
    const result: NpmPackReleasePage = await runQueryRef(
      ctx,
      internalRefs.packages.listVersionsForViewerInternal,
      {
        name: packageName,
        viewerUserId: viewerUserId ?? undefined,
        paginationOpts: { cursor, numItems: 100 },
      },
    );
    releases.push(
      ...result.page.filter(
        (release: ReleaseLike) =>
          release.artifactKind === "npm-pack" &&
          Boolean(release.clawpackStorageId) &&
          Boolean(release.npmIntegrity) &&
          Boolean(release.npmShasum),
      ),
    );
    done = result.isDone;
    cursor = result.continueCursor;
    if (!cursor && !done) break;
  }
  return releases;
}

function packageJsonDependencies(packageJson: unknown) {
  if (!packageJson || typeof packageJson !== "object" || Array.isArray(packageJson)) return {};
  const dependencies = (packageJson as { dependencies?: unknown }).dependencies;
  if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) return {};
  return Object.fromEntries(
    Object.entries(dependencies as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

export async function npmMirrorGetHandler(ctx: ActionCtx, request: Request) {
  const path = parseNpmMirrorPath(request);
  if (!path) return text("Not found", 404);
  const isTarballRequest = path.rest[0] === "-" && Boolean(path.rest[1]);
  const rate = await applyRateLimit(ctx, request, isTarballRequest ? "download" : "read");
  if (!rate.ok) return rate.response;

  const viewerUserId = await getOptionalViewerUserIdForRequest(ctx, request);
  const detail = (await runQueryRef(ctx, internalRefs.packages.getByNameForViewerInternal, {
    name: path.packageName,
    viewerUserId: viewerUserId ?? undefined,
  })) as {
    package: PublicPackageDocLike | null;
    latestRelease: ReleaseLike | null;
    owner: { _id: Id<"users">; handle?: string; displayName?: string; image?: string } | null;
  } | null;
  if (!detail?.package) return text("Package not found", 404, rate.headers);

  const releases = await listNpmPackReleases(ctx, path.packageName, viewerUserId);
  if (isTarballRequest) {
    const tarballName = path.rest[1]!;
    const release = releases.find((candidate) => candidate.npmTarballName === tarballName);
    if (!release) return text("ClawPack artifact not found", 404, rate.headers);
    return await streamClawPackRelease(ctx, rate.headers, detail.package, release);
  }
  if (path.rest.length > 0) return text("Not found", 404, rate.headers);

  const versions = Object.fromEntries(
    releases.map((release) => {
      const artifact = toReleaseArtifact(release);
      const urls = releaseArtifactUrls(request, detail.package!.name, release);
      return [
        release.version,
        {
          name: detail.package!.name,
          version: release.version,
          description: detail.package!.summary ?? undefined,
          dependencies: packageJsonDependencies(release.extractedPackageJson),
          dist: {
            tarball: urls.tarballUrl,
            integrity: artifact.npmIntegrity,
            shasum: artifact.npmShasum,
          },
        },
      ];
    }),
  );
  const latestNpmRelease =
    releases.find((release) => release.distTags?.includes("latest")) ?? releases[0] ?? null;
  return json(
    {
      name: detail.package.name,
      "dist-tags": latestNpmRelease ? { latest: latestNpmRelease.version } : {},
      versions,
    },
    200,
    rate.headers,
  );
}

export async function pluginsGetRouterV1Handler(ctx: ActionCtx, request: Request) {
  const segments = getPathSegments(request, "/api/v1/plugins/");
  if (segments.length === 0) return text("Not found", 404);
  if (segments[0] === "search" && new URL(request.url).searchParams.has("q")) {
    return await searchPackages(ctx, request, {
      includeSkills: false,
      pluginFamilies: ["code-plugin", "bundle-plugin"],
    });
  }
  return text("Not found", 404);
}

type PublicPackageDocLike = {
  _id: Id<"packages">;
  name: string;
  displayName: string;
  family: "skill" | "code-plugin" | "bundle-plugin";
  tags: Record<string, Id<"packageReleases">>;
  latestReleaseId?: Id<"packageReleases">;
  channel: "official" | "community" | "private";
  isOfficial: boolean;
  runtimeId?: string;
  summary?: string;
  latestVersion?: string | null;
  compatibility?: Doc<"packages">["compatibility"];
  capabilities?: Doc<"packages">["capabilities"];
  verification?: Doc<"packages">["verification"];
  artifact?: {
    kind: "legacy-zip" | "npm-pack";
    sha256?: string;
    size?: number;
    format?: string;
    npmIntegrity?: string;
    npmShasum?: string;
    npmTarballName?: string;
    npmUnpackedSize?: number;
    npmFileCount?: number;
  };
  stats?: { downloads: number; installs: number; stars: number; versions: number };
  createdAt: number;
  updatedAt: number;
};

type PackageReadinessCheck = {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail";
  message: string;
};

function buildPackageReadiness(pkg: PublicPackageDocLike) {
  const checks: PackageReadinessCheck[] = [];
  const add = (check: PackageReadinessCheck) => checks.push(check);
  const hostTargets = pkg.capabilities?.hostTargets ?? [];
  const capabilityTags = pkg.capabilities?.capabilityTags ?? [];
  const hasEnvironmentMetadata = capabilityTags.includes("environment:declared");
  const scanStatus = pkg.verification?.scanStatus ?? "not-run";

  add({
    id: "official",
    label: "Official package",
    status: pkg.isOfficial ? "pass" : "fail",
    message: pkg.isOfficial ? "Package is official." : "Package is not in the official channel.",
  });
  add({
    id: "latest-version",
    label: "Latest version",
    status: pkg.latestVersion ? "pass" : "fail",
    message: pkg.latestVersion ? `Latest version is ${pkg.latestVersion}.` : "No latest version.",
  });
  add({
    id: "clawpack",
    label: "ClawPack artifact",
    status: pkg.artifact?.kind === "npm-pack" ? "pass" : "fail",
    message:
      pkg.artifact?.kind === "npm-pack"
        ? "Latest version has an npm-pack ClawPack artifact."
        : "Latest version is legacy ZIP-only.",
  });
  add({
    id: "artifact-digest",
    label: "Artifact digest",
    status: pkg.artifact?.sha256 ? "pass" : "fail",
    message: pkg.artifact?.sha256 ? "Artifact has a SHA-256 digest." : "Artifact digest missing.",
  });
  add({
    id: "source",
    label: "Source provenance",
    status: pkg.verification?.sourceRepo && pkg.verification?.sourceCommit ? "pass" : "fail",
    message:
      pkg.verification?.sourceRepo && pkg.verification?.sourceCommit
        ? `Source is ${pkg.verification.sourceRepo}@${pkg.verification.sourceCommit}.`
        : "Source repo and commit are required.",
  });
  add({
    id: "compatibility",
    label: "OpenClaw compatibility",
    status:
      pkg.compatibility?.pluginApiRange && pkg.compatibility?.builtWithOpenClawVersion
        ? "pass"
        : "fail",
    message:
      pkg.compatibility?.pluginApiRange && pkg.compatibility?.builtWithOpenClawVersion
        ? `pluginApi=${pkg.compatibility.pluginApiRange}, builtWith=${pkg.compatibility.builtWithOpenClawVersion}.`
        : "pluginApi range and build OpenClaw version are required.",
  });
  add({
    id: "host-targets",
    label: "Host targets",
    status: hostTargets.length > 0 ? "pass" : "warn",
    message:
      hostTargets.length > 0
        ? `Targets: ${hostTargets.join(", ")}.`
        : "Host targets are optional and not declared.",
  });
  add({
    id: "environment",
    label: "Environment metadata",
    status: hasEnvironmentMetadata ? "pass" : "warn",
    message: hasEnvironmentMetadata
      ? "Runtime environment requirements are declared."
      : "Runtime environment metadata is optional and not declared.",
  });
  add({
    id: "scan",
    label: "Security scan",
    status:
      scanStatus === "clean"
        ? "pass"
        : scanStatus === "pending" || scanStatus === "not-run"
          ? "warn"
          : "fail",
    message: `Scan status is ${scanStatus}.`,
  });

  const blockers = checks.filter((check) => check.status === "fail").map((check) => check.id);
  return {
    package: {
      name: pkg.name,
      displayName: pkg.displayName,
      family: pkg.family,
      isOfficial: pkg.isOfficial,
      latestVersion: pkg.latestVersion ?? null,
    },
    ready: blockers.length === 0,
    checks,
    blockers,
  };
}
