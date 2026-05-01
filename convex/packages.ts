import {
  PackagePublishRequestSchema,
  parseArk,
  type PackageChannel,
  type PackageFamily,
  type PackagePublishRequest,
  type PackageVerificationTier,
} from "clawhub-schema";
import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./functions";
import {
  assertAdmin,
  assertModerator,
  getOptionalActiveAuthUserId,
  requireUser,
  requireUserFromAction,
} from "./lib/access";
import { requireGitHubAccountAge } from "./lib/githubAccount";
import { normalizeGitHubRepository } from "./lib/githubActionsOidc";
import {
  assertPackageVersion,
  ensurePluginNameMatchesPackage,
  extractBundlePluginArtifacts,
  extractCodePluginArtifacts,
  maybeParseJson,
  normalizePackageName,
  normalizePublishFiles,
  readOptionalTextFile,
  summarizePackageForSearch,
} from "./lib/packageRegistry";
import {
  getPackageStorePackEnvironmentFlags,
  getPackageStorePackHostTargetKeys,
} from "./lib/packageSearchDigest";
import { isPackageBlockedFromPublic, resolvePackageReleaseScanStatus } from "./lib/packageSecurity";
import { toPublicPublisher } from "./lib/public";
import {
  assertCanManageOwnedResource,
  getOwnerPublisher,
  getPublisherMembership,
} from "./lib/publishers";
import {
  findOversizedPublishFile,
  getPublishFileSizeError,
  getPublishTotalSizeError,
  MAX_PUBLISH_TOTAL_BYTES,
} from "./lib/publishLimits";
import { tokenize } from "./lib/searchText";
import { hashSkillFiles } from "./lib/skills";
import { runStaticPublishScan } from "./lib/staticPublishScan";
import { buildStorePack, sha256Hex, toArrayBuffer } from "./lib/storepack";
import { getLatestPackageRescanTarget, insertPackageRescanRequest } from "./model/packages/rescans";
import {
  assertCanRequestRescan,
  buildRescanState,
  errorMessage,
  finalizeInProgressRescanRequestsForTarget,
} from "./model/rescans/policy";

const MAX_PUBLIC_LIST_PAGE_SIZE = 200;
const MAX_SEARCH_PAGE_SIZE = 200;
const MAX_SEARCH_SCAN_DOCUMENTS = 1_000;
const MAX_SEARCH_SCAN_PAGES = 20;
const MAX_DIRECT_PACKAGE_SEARCH_CANDIDATES = 20;
const INITIAL_PACKAGE_VT_SCAN_DELAY_MS = 30_000;
const vtEngineStatsValidator = v.object({
  malicious: v.optional(v.number()),
  suspicious: v.optional(v.number()),
  undetected: v.optional(v.number()),
  harmless: v.optional(v.number()),
});
const vtAnalysisValidator = v.object({
  status: v.string(),
  verdict: v.optional(v.string()),
  analysis: v.optional(v.string()),
  source: v.optional(v.string()),
  scanner: v.optional(v.string()),
  engineStats: v.optional(vtEngineStatsValidator),
  checkedAt: v.number(),
});
const packageScanStatusArgValidator = v.union(
  v.literal("clean"),
  v.literal("suspicious"),
  v.literal("malicious"),
  v.literal("pending"),
  v.literal("not-run"),
);
const internalRefs = internal as unknown as {
  llmEval: {
    evaluatePackageReleaseWithLlm: unknown;
  };
  packages: {
    attachStorePackArtifactInternal: unknown;
    backfillStorePackArtifactsInternal: unknown;
    backfillPackageReleaseScansInternal: unknown;
    revokeStorePackArtifactForStaffInternal: unknown;
    getStorePackBackfillBatchInternal: unknown;
    scanPackageReleaseStaticallyInternal: unknown;
    insertReleaseInternal: unknown;
    getPackageByNameInternal: unknown;
    getTrustedPublisherByPackageIdInternal: unknown;
    getByNameForViewerInternal: unknown;
    getPackageByIdInternal: unknown;
    getReleaseByIdInternal: unknown;
    getPackageReleaseScanBackfillBatchInternal: unknown;
    listVersionsForViewerInternal: unknown;
    getVersionByNameForViewerInternal: unknown;
    publishPackageForUserInternal: unknown;
    insertAuditLogInternal: unknown;
    updateReleaseStaticScanInternal: unknown;
  };
  packagePublishTokens: {
    createInternal: unknown;
    getByIdInternal: unknown;
    revokeInternal: unknown;
  };
  rescanRequests: {
    markStatusInternal: unknown;
  };
  skills: {
    getSkillBySlugInternal: unknown;
  };
  users: {
    getByIdInternal: unknown;
    getByHandleInternal: unknown;
  };
  publishers: {
    resolvePublishTargetForUserInternal: unknown;
  };
  vt: {
    scanPackageReleaseWithVirusTotal: unknown;
  };
};
type DbReaderCtx = Pick<QueryCtx | MutationCtx, "db">;
type PackagePublishActor =
  | {
      kind: "user";
      userId: Id<"users">;
    }
  | {
      kind: "github-actions";
      repository: string;
      workflow: string;
      runId: string;
      runAttempt: string;
      sha: string;
    };
type PackagePublishAuthContext =
  | {
      kind: "user";
      actorUserId: Id<"users">;
      manualOverrideReason?: string;
    }
  | {
      kind: "github-actions";
      publishToken: Doc<"packagePublishTokens">;
    };
type PackageTrustedPublisherDoc = Doc<"packageTrustedPublishers">;
type PublicPackageListItem = {
  name: string;
  displayName: string;
  family: PackageFamily;
  runtimeId: string | null;
  channel: PackageChannel;
  isOfficial: boolean;
  summary: string | null;
  ownerHandle: string | null;
  createdAt: number;
  updatedAt: number;
  latestVersion: string | null;
  capabilityTags: string[];
  executesCode: boolean;
  verificationTier: PackageVerificationTier | null;
  storepackAvailable: boolean;
  hostTargetKeys: string[];
  environmentFlags: string[];
};

type PackageBadgeKind = Doc<"packageBadges">["kind"];
type PackageDigestLike = Pick<
  Doc<"packageSearchDigest">,
  | "packageId"
  | "name"
  | "normalizedName"
  | "displayName"
  | "family"
  | "runtimeId"
  | "channel"
  | "isOfficial"
  | "ownerUserId"
  | "ownerPublisherId"
  | "summary"
  | "ownerHandle"
  | "ownerKind"
  | "createdAt"
  | "updatedAt"
  | "latestVersion"
  | "capabilityTags"
  | "executesCode"
  | "verificationTier"
  | "scanStatus"
  | "storepackAvailable"
  | "hostTargetKeys"
  | "environmentFlags"
  | "softDeletedAt"
> & {
  capabilityTag?: string;
};
type PublicPageCursorState = {
  cursor: string | null;
  offset: number;
  pageSize: number | null;
  done: boolean;
};

type StorePackIndexFilter = {
  kind: "host-target" | "environment";
  key: string;
};
const PUBLIC_PAGE_CURSOR_PREFIX = "pkgpage:";

function stringifyId(value: Id<"users"> | Id<"publishers">): string {
  return value;
}

function stringifyOptionalId(value: Id<"publishers"> | null | undefined): string | null {
  return value ? stringifyId(value) : null;
}

async function runQueryRef<T>(
  ctx: { runQuery: (ref: never, args: never) => Promise<unknown> },
  ref: unknown,
  args: unknown,
): Promise<T> {
  return (await ctx.runQuery(ref as never, args as never)) as T;
}

async function runMutationRef<T>(
  ctx: { runMutation: (ref: never, args: never) => Promise<unknown> },
  ref: unknown,
  args: unknown,
): Promise<T> {
  return (await ctx.runMutation(ref as never, args as never)) as T;
}

async function runActionRef<T>(
  ctx: { runAction: (ref: never, args: never) => Promise<unknown> },
  ref: unknown,
  args: unknown,
): Promise<T> {
  return (await ctx.runAction(ref as never, args as never)) as T;
}

async function runAfterRef(
  ctx: { scheduler: { runAfter: (delayMs: number, ref: never, args: never) => Promise<unknown> } },
  delayMs: number,
  ref: unknown,
  args: unknown,
) {
  return await ctx.scheduler.runAfter(delayMs, ref as never, args as never);
}

type PublicPackageDoc = {
  _id: Id<"packages">;
  name: string;
  displayName: string;
  family: PackageFamily;
  channel: PackageChannel;
  isOfficial: boolean;
  runtimeId?: string;
  summary?: string;
  tags: Record<string, Id<"packageReleases">>;
  latestReleaseId?: Id<"packageReleases">;
  latestVersion?: string | null;
  compatibility?: Doc<"packages">["compatibility"];
  capabilities?: Doc<"packages">["capabilities"];
  verification?: Doc<"packages">["verification"];
  scanStatus?: Doc<"packages">["scanStatus"];
  stats: Doc<"packages">["stats"];
  createdAt: number;
  updatedAt: number;
};

type DashboardPackageListItem = {
  _id: Id<"packages">;
  name: string;
  displayName: string;
  family: PackageFamily;
  channel: PackageChannel;
  isOfficial: boolean;
  runtimeId: string | null;
  sourceRepo: string | null;
  summary: string | null;
  ownerUserId: Id<"users">;
  ownerPublisherId?: Id<"publishers">;
  latestVersion: string | null;
  stats: Doc<"packages">["stats"];
  verification: Doc<"packages">["verification"];
  scanStatus: Doc<"packages">["scanStatus"];
  createdAt: number;
  updatedAt: number;
  pendingReview?: true;
  rescanState: Awaited<ReturnType<typeof buildRescanState>> | null;
  latestRelease: {
    version: string;
    createdAt: number;
    vtStatus: string | null;
    llmStatus: string | null;
    staticScanStatus: "clean" | "suspicious" | "malicious" | null;
    storepackAvailable: boolean;
    storepackSha256: string | null;
    hostTargets: Doc<"packageReleases">["hostTargetsSummary"] | null;
    environment: Doc<"packageReleases">["environmentSummary"] | null;
  } | null;
};

function requiresPrivilegedPackageAccess(
  digest: Pick<PackageDigestLike, "channel" | "scanStatus">,
) {
  return digest.channel === "private" || isPackageBlockedFromPublic(digest.scanStatus);
}

async function viewerCanAccessPackageOwner(
  ctx: DbReaderCtx,
  digest: Pick<PackageDigestLike, "ownerUserId" | "ownerPublisherId">,
  viewerUserId: Id<"users"> | undefined,
  membershipCache?: Map<string, Promise<boolean>>,
) {
  if (!viewerUserId) return false;
  if (digest.ownerUserId === viewerUserId) return true;
  if (!digest.ownerPublisherId) return false;

  const cacheKey = String(digest.ownerPublisherId);
  const cached = membershipCache?.get(cacheKey);
  if (cached) return await cached;

  const membershipPromise = getPublisherMembership(ctx, digest.ownerPublisherId, viewerUserId).then(
    Boolean,
  );
  membershipCache?.set(cacheKey, membershipPromise);
  return await membershipPromise;
}

async function canViewerReadPackage(
  ctx: DbReaderCtx,
  digest: Pick<PackageDigestLike, "channel" | "scanStatus" | "ownerUserId" | "ownerPublisherId">,
  viewerUserId: Id<"users"> | undefined,
  membershipCache?: Map<string, Promise<boolean>>,
) {
  if (!requiresPrivilegedPackageAccess(digest)) return true;
  const isPrivilegedViewer = await viewerCanAccessPackageOwner(
    ctx,
    digest,
    viewerUserId,
    membershipCache,
  );
  return (
    (digest.channel !== "private" || isPrivilegedViewer) &&
    (!isPackageBlockedFromPublic(digest.scanStatus) || isPrivilegedViewer)
  );
}

function toPublicPackage(
  pkg: Doc<"packages"> | null | undefined,
  latestRelease?: Pick<Doc<"packageReleases">, "version" | "softDeletedAt"> | null,
): PublicPackageDoc | null {
  if (!pkg || pkg.softDeletedAt) return null;
  const latestVersion =
    latestRelease === undefined
      ? (pkg.latestVersionSummary?.version ?? null)
      : latestRelease && !latestRelease.softDeletedAt
        ? latestRelease.version
        : null;
  return {
    _id: pkg._id,
    name: pkg.name,
    displayName: pkg.displayName,
    family: pkg.family,
    channel: pkg.channel,
    isOfficial: pkg.isOfficial,
    runtimeId: pkg.runtimeId,
    summary: pkg.summary,
    tags: pkg.tags,
    latestReleaseId: pkg.latestReleaseId,
    latestVersion,
    compatibility: pkg.compatibility,
    capabilities: pkg.capabilities,
    verification: pkg.verification,
    scanStatus: pkg.scanStatus,
    stats: pkg.stats,
    createdAt: pkg.createdAt,
    updatedAt: pkg.updatedAt,
  };
}

function digestMatchesFilters(
  digest: PackageDigestLike,
  args: {
    executesCode?: boolean;
    capabilityTag?: string;
    hostTarget?: string;
    environment?: string;
  },
) {
  if (
    typeof args.executesCode === "boolean" &&
    Boolean(digest.executesCode) !== args.executesCode
  ) {
    return false;
  }
  if (args.capabilityTag) {
    const matchesCapability = digest.capabilityTag
      ? digest.capabilityTag === args.capabilityTag
      : (digest.capabilityTags ?? []).includes(args.capabilityTag);
    if (!matchesCapability) return false;
  }
  if (args.hostTarget && !(digest.hostTargetKeys ?? []).includes(args.hostTarget)) return false;
  if (args.environment && !(digest.environmentFlags ?? []).includes(args.environment)) return false;
  return true;
}

function digestMatchesSearchFilters(
  digest: PackageDigestLike,
  args: {
    family?: PackageFamily;
    channel?: PackageChannel;
    isOfficial?: boolean;
    executesCode?: boolean;
    capabilityTag?: string;
    hostTarget?: string;
    environment?: string;
  },
) {
  if (args.family && digest.family !== args.family) return false;
  if (args.channel && digest.channel !== args.channel) return false;
  if (typeof args.isOfficial === "boolean" && digest.isOfficial !== args.isOfficial) {
    return false;
  }
  return digestMatchesFilters(digest, args);
}

async function upsertPackageBadge(
  ctx: MutationCtx,
  packageId: Id<"packages">,
  kind: PackageBadgeKind,
  userId: Id<"users">,
  at: number,
) {
  const existing = await ctx.db
    .query("packageBadges")
    .withIndex("by_package_kind", (q) => q.eq("packageId", packageId).eq("kind", kind))
    .unique();
  if (existing) {
    await ctx.db.patch(existing._id, { byUserId: userId, at });
    return;
  }
  await ctx.db.insert("packageBadges", { packageId, kind, byUserId: userId, at });
}

async function removePackageBadge(
  ctx: MutationCtx,
  packageId: Id<"packages">,
  kind: PackageBadgeKind,
) {
  const existing = await ctx.db
    .query("packageBadges")
    .withIndex("by_package_kind", (q) => q.eq("packageId", packageId).eq("kind", kind))
    .unique();
  if (existing) await ctx.db.delete(existing._id);
}

function toPublicPackageListItem(digest: PackageDigestLike): PublicPackageListItem {
  return {
    name: digest.name,
    displayName: digest.displayName,
    family: digest.family,
    runtimeId: digest.runtimeId ?? null,
    channel: digest.channel,
    isOfficial: digest.isOfficial,
    summary: digest.summary ?? null,
    ownerHandle: digest.ownerHandle || null,
    createdAt: digest.createdAt,
    updatedAt: digest.updatedAt,
    latestVersion: digest.latestVersion ?? null,
    capabilityTags: digest.capabilityTags ?? [],
    executesCode: digest.executesCode ?? false,
    verificationTier: digest.verificationTier ?? null,
    storepackAvailable: digest.storepackAvailable ?? false,
    hostTargetKeys: digest.hostTargetKeys ?? [],
    environmentFlags: digest.environmentFlags ?? [],
  };
}

async function toDashboardPackageListItem(
  ctx: DbReaderCtx,
  pkg: Doc<"packages">,
): Promise<DashboardPackageListItem | null> {
  if (pkg.softDeletedAt) return null;
  const latestRelease = pkg.latestReleaseId ? await ctx.db.get(pkg.latestReleaseId) : null;
  return {
    _id: pkg._id,
    name: pkg.name,
    displayName: pkg.displayName,
    family: pkg.family,
    channel: pkg.channel,
    isOfficial: pkg.isOfficial,
    runtimeId: pkg.runtimeId ?? null,
    sourceRepo: pkg.sourceRepo ?? null,
    summary: pkg.summary ?? null,
    ownerUserId: pkg.ownerUserId,
    ownerPublisherId: pkg.ownerPublisherId,
    latestVersion: pkg.latestVersionSummary?.version ?? null,
    stats: pkg.stats,
    verification: pkg.verification,
    scanStatus: pkg.scanStatus,
    createdAt: pkg.createdAt,
    updatedAt: pkg.updatedAt,
    pendingReview: pkg.scanStatus === "pending" ? true : undefined,
    rescanState:
      latestRelease && !latestRelease.softDeletedAt
        ? await buildRescanState(ctx, {
            kind: "plugin",
            artifactId: latestRelease._id,
          })
        : null,
    latestRelease:
      latestRelease && !latestRelease.softDeletedAt
        ? {
            version: latestRelease.version,
            createdAt: latestRelease.createdAt,
            vtStatus: latestRelease.vtAnalysis?.status ?? null,
            llmStatus: latestRelease.llmAnalysis?.status ?? null,
            staticScanStatus: latestRelease.staticScan?.status ?? null,
            storepackAvailable: Boolean(
              latestRelease.storepackStorageId && !latestRelease.storepackRevokedAt,
            ),
            storepackSha256: latestRelease.storepackSha256 ?? null,
            hostTargets: latestRelease.hostTargetsSummary ?? null,
            environment: latestRelease.environmentSummary ?? null,
          }
        : null,
  };
}

async function replaceStorePackSearchIndexRows(
  ctx: MutationCtx,
  pkg: Doc<"packages">,
  release: Doc<"packageReleases">,
) {
  const existing = await ctx.db
    .query("packageStorePackSearchIndex")
    .withIndex("by_release", (q) => q.eq("releaseId", release._id))
    .collect();
  for (const row of existing) {
    await ctx.db.delete(row._id);
  }
  if (
    pkg.softDeletedAt ||
    release.softDeletedAt ||
    release.storepackRevokedAt ||
    !release.storepackStorageId
  ) {
    return;
  }

  const now = Date.now();
  const rows = [
    ...getPackageStorePackHostTargetKeys(release).map((key) => ({
      kind: "host-target" as const,
      key,
    })),
    ...getPackageStorePackEnvironmentFlags(release).map((key) => ({
      kind: "environment" as const,
      key,
    })),
  ];
  for (const row of rows) {
    await ctx.db.insert("packageStorePackSearchIndex", {
      packageId: pkg._id,
      releaseId: release._id,
      kind: row.kind,
      key: row.key,
      updatedAt: pkg.updatedAt,
      createdAt: now,
    });
  }
}

async function listDashboardPackagesForOwnerPublisher(
  ctx: QueryCtx,
  ownerPublisherId: Id<"publishers">,
  viewerUserId: Id<"users">,
  limit: number,
) {
  const takeLimit = Math.min(limit * 5, 500);
  const ownerPublisher = await ctx.db.get(ownerPublisherId);
  const membership =
    (await ctx.db
      .query("publisherMembers")
      .withIndex("by_publisher_user", (q) =>
        q.eq("publisherId", ownerPublisherId).eq("userId", viewerUserId),
      )
      .unique()) ?? null;
  const isOwnDashboard = Boolean(
    membership || (ownerPublisher?.kind === "user" && ownerPublisher.linkedUserId === viewerUserId),
  );
  if (!isOwnDashboard) return [];

  const scopedEntries = await ctx.db
    .query("packages")
    .withIndex("by_owner_publisher", (q) => q.eq("ownerPublisherId", ownerPublisherId))
    .order("desc")
    .take(takeLimit);
  const legacyEntries =
    ownerPublisher?.kind === "user" && ownerPublisher.linkedUserId
      ? await ctx.db
          .query("packages")
          .withIndex("by_owner", (q) => q.eq("ownerUserId", ownerPublisher.linkedUserId!))
          .order("desc")
          .take(takeLimit)
      : [];

  const combined = [...scopedEntries, ...legacyEntries].filter(
    (pkg, index, all) =>
      !pkg.softDeletedAt &&
      (!pkg.ownerPublisherId || pkg.ownerPublisherId === ownerPublisherId) &&
      all.findIndex((candidate) => candidate._id === pkg._id) === index,
  );
  const limited = combined.slice(0, limit);
  return (
    await Promise.all(limited.map(async (pkg) => await toDashboardPackageListItem(ctx, pkg)))
  ).filter((pkg): pkg is DashboardPackageListItem => Boolean(pkg));
}

async function listDashboardPackagesForOwnerUser(
  ctx: QueryCtx,
  ownerUserId: Id<"users">,
  viewerUserId: Id<"users">,
  limit: number,
) {
  if (ownerUserId !== viewerUserId) return [];
  const takeLimit = Math.min(limit * 5, 500);
  const entries = await ctx.db
    .query("packages")
    .withIndex("by_owner", (q) => q.eq("ownerUserId", ownerUserId))
    .order("desc")
    .take(takeLimit);
  const filtered = entries.filter((pkg) => !pkg.softDeletedAt).slice(0, limit);
  return (
    await Promise.all(filtered.map(async (pkg) => await toDashboardPackageListItem(ctx, pkg)))
  ).filter((pkg): pkg is DashboardPackageListItem => Boolean(pkg));
}

function encodePublicPageCursor(state: PublicPageCursorState) {
  if (state.done && state.offset === 0) return "";
  return `${PUBLIC_PAGE_CURSOR_PREFIX}${JSON.stringify(state)}`;
}

function decodePublicPageCursor(raw: string | null | undefined): PublicPageCursorState {
  if (!raw) return { cursor: null, offset: 0, pageSize: null, done: false };
  if (!raw.startsWith(PUBLIC_PAGE_CURSOR_PREFIX)) {
    return { cursor: raw, offset: 0, pageSize: null, done: false };
  }
  try {
    const parsed = JSON.parse(
      raw.slice(PUBLIC_PAGE_CURSOR_PREFIX.length),
    ) as Partial<PublicPageCursorState>;
    return {
      cursor: typeof parsed.cursor === "string" ? parsed.cursor : null,
      offset: typeof parsed.offset === "number" && parsed.offset > 0 ? parsed.offset : 0,
      pageSize: typeof parsed.pageSize === "number" && parsed.pageSize > 0 ? parsed.pageSize : null,
      done: parsed.done === true,
    };
  } catch {
    return { cursor: null, offset: 0, pageSize: null, done: false };
  }
}

async function getOptionalViewerUserId(ctx: QueryCtx | MutationCtx) {
  return await getOptionalActiveAuthUserId(ctx);
}

function packageSearchScore(digest: PackageDigestLike, queryText: string) {
  const needle = queryText.toLowerCase();
  const normalized = digest.normalizedName.toLowerCase();
  const display = digest.displayName.toLowerCase();
  const runtimeId = digest.runtimeId?.toLowerCase() ?? "";
  const summary = (digest.summary ?? "").toLowerCase();
  let score = 0;
  if (normalized === needle) score += 200;
  else if (normalized.startsWith(needle)) score += 120;
  else if (normalized.includes(needle)) score += 80;

  if (display === needle) score += 150;
  else if (display.startsWith(needle)) score += 70;
  else if (display.includes(needle)) score += 40;

  if (runtimeId === needle) score += 180;
  else if (runtimeId.startsWith(needle)) score += 90;
  else if (runtimeId.includes(needle)) score += 45;

  if (summary.includes(needle)) score += 20;
  if ((digest.capabilityTags ?? []).some((entry) => entry.toLowerCase().includes(needle))) {
    score += 12;
  }
  if (digest.isOfficial) score += 5;
  return score;
}

function prefixUpperBound(value: string) {
  return `${value}\uffff`;
}

function maybeNormalizePackageQuery(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return normalizePackageName(trimmed);
  } catch {
    return null;
  }
}

async function resolveDirectPackageSearchDigests(
  ctx: DbReaderCtx,
  queryText: string,
): Promise<PackageDigestLike[]> {
  const normalizedQuery = maybeNormalizePackageQuery(queryText);
  const queryTokens = tokenize(queryText).filter((token) => token.length > 1);
  const runtimePrefix = queryTokens.length === 1 ? queryTokens[0] : queryText;
  const [nameDigests, runtimeDigests] = await Promise.all([
    normalizedQuery
      ? ctx.db
          .query("packageSearchDigest")
          .withIndex("by_active_normalized_name", (q) =>
            q
              .eq("softDeletedAt", undefined)
              .gte("normalizedName", normalizedQuery)
              .lt("normalizedName", prefixUpperBound(normalizedQuery)),
          )
          .take(MAX_DIRECT_PACKAGE_SEARCH_CANDIDATES)
      : Promise.resolve([]),
    runtimePrefix
      ? ctx.db
          .query("packageSearchDigest")
          .withIndex("by_active_runtime_id", (q) =>
            q
              .eq("softDeletedAt", undefined)
              .gte("runtimeId", runtimePrefix)
              .lt("runtimeId", prefixUpperBound(runtimePrefix)),
          )
          .take(MAX_DIRECT_PACKAGE_SEARCH_CANDIDATES)
      : Promise.resolve([]),
  ]);
  return [...nameDigests, ...runtimeDigests].filter(
    (digest, index, all) =>
      all.findIndex((candidate) => candidate?.packageId === digest?.packageId) === index,
  ) as PackageDigestLike[];
}

function buildPackageDigestQuery(
  ctx: DbReaderCtx,
  args: {
    family?: PackageFamily;
    channel?: PackageChannel;
    isOfficial?: boolean;
    executesCode?: boolean;
  },
) {
  const family = args.family;
  const channel = args.channel;
  const isOfficial = args.isOfficial;
  const executesCode = args.executesCode;

  if (family && channel && typeof executesCode === "boolean") {
    return ctx.db
      .query("packageSearchDigest")
      .withIndex("by_active_family_channel_executes_updated", (q) =>
        q
          .eq("softDeletedAt", undefined)
          .eq("family", family)
          .eq("channel", channel)
          .eq("executesCode", executesCode),
      );
  }
  if (family && typeof isOfficial === "boolean" && typeof executesCode === "boolean") {
    return ctx.db
      .query("packageSearchDigest")
      .withIndex("by_active_family_official_executes_updated", (q) =>
        q
          .eq("softDeletedAt", undefined)
          .eq("family", family)
          .eq("isOfficial", isOfficial)
          .eq("executesCode", executesCode),
      );
  }
  if (channel && typeof isOfficial === "boolean" && typeof executesCode === "boolean") {
    return ctx.db
      .query("packageSearchDigest")
      .withIndex("by_active_channel_official_executes_updated", (q) =>
        q
          .eq("softDeletedAt", undefined)
          .eq("channel", channel)
          .eq("isOfficial", isOfficial)
          .eq("executesCode", executesCode),
      );
  }
  if (family && typeof executesCode === "boolean") {
    return ctx.db
      .query("packageSearchDigest")
      .withIndex("by_active_family_executes_updated", (q) =>
        q.eq("softDeletedAt", undefined).eq("family", family).eq("executesCode", executesCode),
      );
  }
  if (channel && typeof executesCode === "boolean") {
    return ctx.db
      .query("packageSearchDigest")
      .withIndex("by_active_channel_executes_updated", (q) =>
        q.eq("softDeletedAt", undefined).eq("channel", channel).eq("executesCode", executesCode),
      );
  }
  if (typeof isOfficial === "boolean" && typeof executesCode === "boolean") {
    return ctx.db
      .query("packageSearchDigest")
      .withIndex("by_active_official_executes_updated", (q) =>
        q
          .eq("softDeletedAt", undefined)
          .eq("isOfficial", isOfficial)
          .eq("executesCode", executesCode),
      );
  }
  if (typeof executesCode === "boolean") {
    return ctx.db
      .query("packageSearchDigest")
      .withIndex("by_active_executes_updated", (q) =>
        q.eq("softDeletedAt", undefined).eq("executesCode", executesCode),
      );
  }

  if (family && channel) {
    return ctx.db
      .query("packageSearchDigest")
      .withIndex("by_active_family_channel_updated", (q) =>
        q.eq("softDeletedAt", undefined).eq("family", family).eq("channel", channel),
      );
  }
  if (family && typeof isOfficial === "boolean") {
    return ctx.db
      .query("packageSearchDigest")
      .withIndex("by_active_family_official_updated", (q) =>
        q.eq("softDeletedAt", undefined).eq("family", family).eq("isOfficial", isOfficial),
      );
  }
  if (family) {
    return ctx.db
      .query("packageSearchDigest")
      .withIndex("by_active_family_updated", (q) =>
        q.eq("softDeletedAt", undefined).eq("family", family),
      );
  }
  if (channel && typeof isOfficial === "boolean") {
    return ctx.db
      .query("packageSearchDigest")
      .withIndex("by_active_channel_official_updated", (q) =>
        q.eq("softDeletedAt", undefined).eq("channel", channel).eq("isOfficial", isOfficial),
      );
  }
  if (channel) {
    return ctx.db
      .query("packageSearchDigest")
      .withIndex("by_active_channel_updated", (q) =>
        q.eq("softDeletedAt", undefined).eq("channel", channel),
      );
  }
  if (typeof isOfficial === "boolean") {
    return ctx.db
      .query("packageSearchDigest")
      .withIndex("by_active_official_updated", (q) =>
        q.eq("softDeletedAt", undefined).eq("isOfficial", isOfficial),
      );
  }
  return ctx.db
    .query("packageSearchDigest")
    .withIndex("by_active_updated", (q) => q.eq("softDeletedAt", undefined));
}

function buildPackageCapabilityDigestQuery(
  ctx: DbReaderCtx,
  args: {
    capabilityTag: string;
    family?: PackageFamily;
    channel?: PackageChannel;
    isOfficial?: boolean;
    executesCode?: boolean;
  },
) {
  const family = args.family;
  const channel = args.channel;
  const isOfficial = args.isOfficial;
  const executesCode = args.executesCode;

  if (family && channel && typeof executesCode === "boolean") {
    return ctx.db
      .query("packageCapabilitySearchDigest")
      .withIndex("by_active_family_channel_tag_executes_updated", (q) =>
        q
          .eq("softDeletedAt", undefined)
          .eq("family", family)
          .eq("channel", channel)
          .eq("capabilityTag", args.capabilityTag)
          .eq("executesCode", executesCode),
      );
  }
  if (family && typeof isOfficial === "boolean" && typeof executesCode === "boolean") {
    return ctx.db
      .query("packageCapabilitySearchDigest")
      .withIndex("by_active_family_official_tag_executes_updated", (q) =>
        q
          .eq("softDeletedAt", undefined)
          .eq("family", family)
          .eq("isOfficial", isOfficial)
          .eq("capabilityTag", args.capabilityTag)
          .eq("executesCode", executesCode),
      );
  }
  if (channel && typeof isOfficial === "boolean" && typeof executesCode === "boolean") {
    return ctx.db
      .query("packageCapabilitySearchDigest")
      .withIndex("by_active_channel_official_tag_executes_updated", (q) =>
        q
          .eq("softDeletedAt", undefined)
          .eq("channel", channel)
          .eq("isOfficial", isOfficial)
          .eq("capabilityTag", args.capabilityTag)
          .eq("executesCode", executesCode),
      );
  }
  if (family && channel) {
    return ctx.db
      .query("packageCapabilitySearchDigest")
      .withIndex("by_active_family_channel_tag_updated", (q) =>
        q
          .eq("softDeletedAt", undefined)
          .eq("family", family)
          .eq("channel", channel)
          .eq("capabilityTag", args.capabilityTag),
      );
  }
  if (family && typeof isOfficial === "boolean") {
    return ctx.db
      .query("packageCapabilitySearchDigest")
      .withIndex("by_active_family_official_tag_updated", (q) =>
        q
          .eq("softDeletedAt", undefined)
          .eq("family", family)
          .eq("isOfficial", isOfficial)
          .eq("capabilityTag", args.capabilityTag),
      );
  }
  if (channel && typeof isOfficial === "boolean") {
    return ctx.db
      .query("packageCapabilitySearchDigest")
      .withIndex("by_active_channel_official_tag_updated", (q) =>
        q
          .eq("softDeletedAt", undefined)
          .eq("channel", channel)
          .eq("isOfficial", isOfficial)
          .eq("capabilityTag", args.capabilityTag),
      );
  }
  if (family && typeof executesCode === "boolean") {
    return ctx.db
      .query("packageCapabilitySearchDigest")
      .withIndex("by_active_family_tag_executes_updated", (q) =>
        q
          .eq("softDeletedAt", undefined)
          .eq("family", family)
          .eq("capabilityTag", args.capabilityTag)
          .eq("executesCode", executesCode),
      );
  }
  if (channel && typeof executesCode === "boolean") {
    return ctx.db
      .query("packageCapabilitySearchDigest")
      .withIndex("by_active_channel_tag_executes_updated", (q) =>
        q
          .eq("softDeletedAt", undefined)
          .eq("channel", channel)
          .eq("capabilityTag", args.capabilityTag)
          .eq("executesCode", executesCode),
      );
  }
  if (typeof isOfficial === "boolean" && typeof executesCode === "boolean") {
    return ctx.db
      .query("packageCapabilitySearchDigest")
      .withIndex("by_active_official_tag_executes_updated", (q) =>
        q
          .eq("softDeletedAt", undefined)
          .eq("isOfficial", isOfficial)
          .eq("capabilityTag", args.capabilityTag)
          .eq("executesCode", executesCode),
      );
  }
  if (family) {
    return ctx.db
      .query("packageCapabilitySearchDigest")
      .withIndex("by_active_family_tag_updated", (q) =>
        q
          .eq("softDeletedAt", undefined)
          .eq("family", family)
          .eq("capabilityTag", args.capabilityTag),
      );
  }
  if (channel) {
    return ctx.db
      .query("packageCapabilitySearchDigest")
      .withIndex("by_active_channel_tag_updated", (q) =>
        q
          .eq("softDeletedAt", undefined)
          .eq("channel", channel)
          .eq("capabilityTag", args.capabilityTag),
      );
  }
  if (typeof isOfficial === "boolean") {
    return ctx.db
      .query("packageCapabilitySearchDigest")
      .withIndex("by_active_official_tag_updated", (q) =>
        q
          .eq("softDeletedAt", undefined)
          .eq("isOfficial", isOfficial)
          .eq("capabilityTag", args.capabilityTag),
      );
  }
  if (typeof executesCode === "boolean") {
    return ctx.db
      .query("packageCapabilitySearchDigest")
      .withIndex("by_active_tag_executes_updated", (q) =>
        q
          .eq("softDeletedAt", undefined)
          .eq("capabilityTag", args.capabilityTag)
          .eq("executesCode", executesCode),
      );
  }
  return ctx.db
    .query("packageCapabilitySearchDigest")
    .withIndex("by_active_tag_updated", (q) =>
      q.eq("softDeletedAt", undefined).eq("capabilityTag", args.capabilityTag),
    );
}

async function fetchHighlightedPackageDigests(
  ctx: DbReaderCtx,
  args: {
    family?: PackageFamily;
    channel?: PackageChannel;
    isOfficial?: boolean;
    executesCode?: boolean;
    capabilityTag?: string;
    hostTarget?: string;
    environment?: string;
    viewerUserId?: Id<"users">;
  },
) {
  const viewerUserId = args.viewerUserId;
  const membershipCache = new Map<string, Promise<boolean>>();
  const badges = await ctx.db
    .query("packageBadges")
    .withIndex("by_kind_at", (q) => q.eq("kind", "highlighted"))
    .order("desc")
    .take(MAX_PUBLIC_LIST_PAGE_SIZE);
  const digests: PackageDigestLike[] = [];
  for (const badge of badges) {
    const digest = await ctx.db
      .query("packageSearchDigest")
      .withIndex("by_package", (q) => q.eq("packageId", badge.packageId))
      .unique();
    if (!digest || digest.softDeletedAt) continue;
    if (!(await canViewerReadPackage(ctx, digest, viewerUserId, membershipCache))) continue;
    if (!digestMatchesSearchFilters(digest, args)) continue;
    digests.push(digest);
  }
  return digests;
}

async function fetchHighlightedPackagePage(
  ctx: DbReaderCtx,
  args: {
    family?: PackageFamily;
    channel?: PackageChannel;
    isOfficial?: boolean;
    executesCode?: boolean;
    capabilityTag?: string;
    hostTarget?: string;
    environment?: string;
    viewerUserId?: Id<"users">;
    numItems: number;
  },
) {
  const digests = await fetchHighlightedPackageDigests(ctx, args);
  return digests
    .sort(
      (a, b) =>
        Number(b.isOfficial) - Number(a.isOfficial) ||
        b.updatedAt - a.updatedAt ||
        a.name.localeCompare(b.name),
    )
    .slice(0, args.numItems)
    .map(toPublicPackageListItem);
}

async function getPackageByNormalizedName(ctx: DbReaderCtx, normalizedName: string) {
  return (await ctx.db
    .query("packages")
    .withIndex("by_name", (q) => q.eq("normalizedName", normalizedName))
    .unique()) as Doc<"packages"> | null;
}

async function getReadablePackageByName(
  ctx: DbReaderCtx,
  name: string,
  viewerUserId?: Id<"users">,
) {
  const normalizedName = normalizePackageName(name);
  const pkg = await getPackageByNormalizedName(ctx, normalizedName);
  if (!pkg || pkg.softDeletedAt) return null;
  if (!(await canViewerReadPackage(ctx, pkg, viewerUserId))) return null;
  return pkg;
}

async function getPackageTrustedPublisherByPackageId(ctx: DbReaderCtx, packageId: Id<"packages">) {
  return await ctx.db
    .query("packageTrustedPublishers")
    .withIndex("by_package", (q) => q.eq("packageId", packageId))
    .unique();
}

function normalizeWorkflowFilenameOrThrow(value: string) {
  const trimmed = value.trim();
  if (!trimmed) throw new ConvexError("Workflow filename is required");
  if (trimmed.includes("/") || trimmed.includes("\\")) {
    throw new ConvexError("Workflow filename must not include a path");
  }
  return trimmed;
}

function normalizeManualOverrideReason(reason: string | undefined) {
  const normalized = reason?.trim();
  return normalized || undefined;
}

async function requireTrustedPublisherEditor(
  ctx: Pick<MutationCtx, "db">,
  pkg: Doc<"packages">,
  actorUserId: Id<"users">,
) {
  await assertCanManageOwnedResource(ctx, {
    actor: { _id: actorUserId },
    ownerUserId: pkg.ownerUserId,
    ownerPublisherId: pkg.ownerPublisherId,
    allowPlatformAdmin: false,
  });
}

export const getByName = query({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const viewerUserId = await getOptionalViewerUserId(ctx);
    const pkg = await getReadablePackageByName(ctx, args.name, viewerUserId);
    if (!pkg) return null;
    const latestRelease = pkg.latestReleaseId ? await ctx.db.get(pkg.latestReleaseId) : null;
    const publicPackage = toPublicPackage(pkg, latestRelease);
    if (!publicPackage) return null;
    const owner = toPublicPublisher(
      await getOwnerPublisher(ctx, {
        ownerPublisherId: pkg.ownerPublisherId,
        ownerUserId: pkg.ownerUserId,
      }),
    );
    return {
      package: publicPackage,
      latestRelease: latestRelease && !latestRelease.softDeletedAt ? latestRelease : null,
      owner,
    };
  },
});

export const getByNameForStaff = query({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    assertModerator(user);

    const pkg = await getPackageByNormalizedName(ctx, normalizePackageName(args.name));
    if (!pkg || pkg.softDeletedAt || pkg.family === "skill") return null;

    const highlighted = await ctx.db
      .query("packageBadges")
      .withIndex("by_package_kind", (q) => q.eq("packageId", pkg._id).eq("kind", "highlighted"))
      .unique();
    const latestRelease = pkg.latestReleaseId ? await ctx.db.get(pkg.latestReleaseId) : null;
    const owner = toPublicPublisher(
      await getOwnerPublisher(ctx, {
        ownerPublisherId: pkg.ownerPublisherId,
        ownerUserId: pkg.ownerUserId,
      }),
    );

    return {
      package: pkg,
      latestRelease: latestRelease && !latestRelease.softDeletedAt ? latestRelease : null,
      owner,
      highlighted: highlighted
        ? {
            byUserId: highlighted.byUserId,
            at: highlighted.at,
          }
        : null,
    };
  },
});

export const getByNameForViewerInternal = internalQuery({
  args: {
    name: v.string(),
    viewerUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const pkg = await getReadablePackageByName(ctx, args.name, args.viewerUserId);
    if (!pkg) return null;
    const latestRelease = pkg.latestReleaseId ? await ctx.db.get(pkg.latestReleaseId) : null;
    const publicPackage = toPublicPackage(pkg, latestRelease);
    if (!publicPackage) return null;
    const owner = toPublicPublisher(
      await getOwnerPublisher(ctx, {
        ownerPublisherId: pkg.ownerPublisherId,
        ownerUserId: pkg.ownerUserId,
      }),
    );
    return {
      package: publicPackage,
      latestRelease: latestRelease && !latestRelease.softDeletedAt ? latestRelease : null,
      owner,
    };
  },
});

export const listVersions = query({
  args: {
    name: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const viewerUserId = await getOptionalViewerUserId(ctx);
    const pkg = await getReadablePackageByName(ctx, args.name, viewerUserId);
    if (!pkg) return { page: [], isDone: true, continueCursor: "" };
    return await ctx.db
      .query("packageReleases")
      .withIndex("by_package_active_created", (q) =>
        q.eq("packageId", pkg._id).eq("softDeletedAt", undefined),
      )
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

export const listVersionsForViewerInternal = internalQuery({
  args: {
    name: v.string(),
    viewerUserId: v.optional(v.id("users")),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const pkg = await getReadablePackageByName(ctx, args.name, args.viewerUserId);
    if (!pkg) return { page: [], isDone: true, continueCursor: "" };
    return await ctx.db
      .query("packageReleases")
      .withIndex("by_package_active_created", (q) =>
        q.eq("packageId", pkg._id).eq("softDeletedAt", undefined),
      )
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

export const getVersionByName = query({
  args: {
    name: v.string(),
    version: v.string(),
  },
  handler: async (ctx, args) => {
    const viewerUserId = await getOptionalViewerUserId(ctx);
    const pkg = await getReadablePackageByName(ctx, args.name, viewerUserId);
    if (!pkg) return null;
    const publicPackage = toPublicPackage(pkg);
    if (!publicPackage) return null;
    const release = await ctx.db
      .query("packageReleases")
      .withIndex("by_package_version", (q) =>
        q.eq("packageId", pkg._id).eq("version", args.version),
      )
      .unique();
    if (!release || release.softDeletedAt) return null;
    return {
      package: publicPackage,
      version: release,
    };
  },
});

export const getVersionByNameForViewerInternal = internalQuery({
  args: {
    name: v.string(),
    version: v.string(),
    viewerUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const pkg = await getReadablePackageByName(ctx, args.name, args.viewerUserId);
    if (!pkg) return null;
    const publicPackage = toPublicPackage(pkg);
    if (!publicPackage) return null;
    const release = await ctx.db
      .query("packageReleases")
      .withIndex("by_package_version", (q) =>
        q.eq("packageId", pkg._id).eq("version", args.version),
      )
      .unique();
    if (!release || release.softDeletedAt) return null;
    return {
      package: publicPackage,
      version: release,
    };
  },
});

async function buildStorePackMigrationRows(ctx: DbReaderCtx, releases: Doc<"packageReleases">[]) {
  const rows = [];
  for (const release of releases) {
    const pkg = await ctx.db.get(release.packageId);
    if (!pkg || pkg.softDeletedAt || pkg.family === "skill") continue;
    rows.push({
      releaseId: release._id,
      packageId: pkg._id,
      name: pkg.name,
      displayName: pkg.displayName,
      family: pkg.family,
      channel: pkg.channel,
      version: release.version,
      createdAt: release.createdAt,
      fileCount: release.files.length,
      storepackAvailable: Boolean(release.storepackStorageId && !release.storepackRevokedAt),
      storepackBuiltAt: release.storepackBuiltAt ?? null,
      storepackSha256: release.storepackSha256 ?? null,
      storepackRevokedAt: release.storepackRevokedAt ?? null,
    });
  }
  return rows;
}

export const getStorePackMigrationStatus = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    assertModerator(user);
    return await getStorePackMigrationStatusForLimit(ctx, args.limit);
  },
});

export const getStorePackMigrationStatusInternal = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    return await getStorePackMigrationStatusForLimit(ctx, args.limit);
  },
});

export const getStorePackArtifactByShaForViewerInternal = internalQuery({
  args: {
    sha256: v.string(),
    viewerUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const sha256 = args.sha256.trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(sha256)) return null;
    const artifacts = await ctx.db
      .query("packageReleaseArtifacts")
      .withIndex("by_sha256", (q) => q.eq("sha256", sha256))
      .take(20);
    let sawRevoked = false;
    const membershipCache = new Map<string, Promise<boolean>>();
    for (const artifact of artifacts) {
      if (artifact.kind !== "storepack") continue;
      if (artifact.status === "revoked") {
        sawRevoked = true;
        continue;
      }
      if (artifact.status !== "active") continue;
      const [pkg, release] = await Promise.all([
        ctx.db.get(artifact.packageId),
        ctx.db.get(artifact.releaseId),
      ]);
      if (!pkg || pkg.softDeletedAt || !release || release.softDeletedAt) continue;
      if (release.packageId !== pkg._id || release.storepackSha256 !== sha256) continue;
      if (release.storepackRevokedAt) {
        sawRevoked = true;
        continue;
      }
      const canRead = await canViewerReadPackage(
        ctx,
        {
          channel: pkg.channel,
          scanStatus: pkg.scanStatus,
          ownerUserId: pkg.ownerUserId,
          ownerPublisherId: pkg.ownerPublisherId,
        },
        args.viewerUserId,
        membershipCache,
      );
      if (!canRead) continue;
      return {
        status: "ok" as const,
        artifact: {
          storageId: artifact.storageId,
          sha256: artifact.sha256,
          size: artifact.size,
          format: artifact.format,
        },
        package: {
          _id: pkg._id,
          name: pkg.name,
        },
        release: {
          _id: release._id,
          version: release.version,
          storepackSpecVersion: release.storepackSpecVersion,
        },
      };
    }
    return sawRevoked ? { status: "revoked" as const } : null;
  },
});

async function getStorePackMigrationStatusForLimit(
  ctx: DbReaderCtx,
  requestedLimit: number | undefined,
) {
  const limit = Math.max(1, Math.min(requestedLimit ?? 25, 100));
  const missingCandidates = await ctx.db
    .query("packageReleases")
    .withIndex("by_storepack_built_at", (q) => q.eq("storepackBuiltAt", undefined))
    .take(limit * 4);
  const missingRows = await buildStorePackMigrationRows(
    ctx,
    missingCandidates.filter((release) => !release.softDeletedAt).slice(0, limit),
  );
  const recentArtifactRows = await ctx.db
    .query("packageReleaseArtifacts")
    .withIndex("by_status", (q) => q.eq("status", "active"))
    .order("desc")
    .take(limit * 4);
  const storepackArtifactRows = recentArtifactRows
    .filter((artifact) => artifact.kind === "storepack")
    .slice(0, limit);

  return {
    missingSample: missingRows,
    missingSampleSize: missingRows.length,
    generatedStorePackSampleSize: storepackArtifactRows.length,
    generatedStorePackBytes: storepackArtifactRows.reduce(
      (sum, artifact) => sum + artifact.size,
      0,
    ),
    sampleLimit: limit,
  };
}

export const list = query({
  args: {
    ownerUserId: v.optional(v.id("users")),
    ownerPublisherId: v.optional(v.id("publishers")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const viewerUserId = await getOptionalActiveAuthUserId(ctx);
    if (!viewerUserId) return [];
    const limit = Math.max(1, Math.min(args.limit ?? 50, 100));
    if (args.ownerPublisherId) {
      return await listDashboardPackagesForOwnerPublisher(
        ctx,
        args.ownerPublisherId,
        viewerUserId,
        limit,
      );
    }
    if (args.ownerUserId) {
      return await listDashboardPackagesForOwnerUser(ctx, args.ownerUserId, viewerUserId, limit);
    }
    return await listDashboardPackagesForOwnerUser(ctx, viewerUserId, viewerUserId, limit);
  },
});

export const listPublicPage = query({
  args: {
    family: v.optional(
      v.union(v.literal("skill"), v.literal("code-plugin"), v.literal("bundle-plugin")),
    ),
    channel: v.optional(
      v.union(v.literal("official"), v.literal("community"), v.literal("private")),
    ),
    isOfficial: v.optional(v.boolean()),
    highlightedOnly: v.optional(v.boolean()),
    executesCode: v.optional(v.boolean()),
    capabilityTag: v.optional(v.string()),
    hostTarget: v.optional(v.string()),
    environment: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    return await listPackagePageImpl(ctx, args);
  },
});

export const listPageForViewerInternal = internalQuery({
  args: {
    family: v.optional(
      v.union(v.literal("skill"), v.literal("code-plugin"), v.literal("bundle-plugin")),
    ),
    channel: v.optional(
      v.union(v.literal("official"), v.literal("community"), v.literal("private")),
    ),
    isOfficial: v.optional(v.boolean()),
    highlightedOnly: v.optional(v.boolean()),
    executesCode: v.optional(v.boolean()),
    capabilityTag: v.optional(v.string()),
    hostTarget: v.optional(v.string()),
    environment: v.optional(v.string()),
    viewerUserId: v.optional(v.id("users")),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    return await listPackagePageImpl(ctx, args);
  },
});

function getStorePackIndexFilter(args: { hostTarget?: string; environment?: string }) {
  if (args.hostTarget) {
    return { kind: "host-target" as const, key: args.hostTarget };
  }
  if (args.environment) {
    return { kind: "environment" as const, key: args.environment };
  }
  return null;
}

async function listPackagePageImpl(
  ctx: DbReaderCtx,
  args: {
    family?: PackageFamily;
    channel?: PackageChannel;
    isOfficial?: boolean;
    highlightedOnly?: boolean;
    executesCode?: boolean;
    capabilityTag?: string;
    hostTarget?: string;
    environment?: string;
    viewerUserId?: Id<"users">;
    paginationOpts: { cursor: string | null; numItems: number };
  },
) {
  if (args.channel === "private" && !args.viewerUserId) {
    return { page: [], isDone: true, continueCursor: "" };
  }
  const viewerUserId = args.viewerUserId;
  const membershipCache = new Map<string, Promise<boolean>>();
  const canViewPackage = async (digest: PackageDigestLike) =>
    await canViewerReadPackage(ctx, digest, viewerUserId, membershipCache);
  const targetCount = args.paginationOpts.numItems;

  if (args.highlightedOnly) {
    const page = await fetchHighlightedPackagePage(ctx, {
      ...args,
      numItems: targetCount,
    });
    return { page, isDone: true, continueCursor: "" };
  }

  const storePackIndexFilter = getStorePackIndexFilter(args);
  if (storePackIndexFilter) {
    return await listPackagePageByStorePackIndex(ctx, args, storePackIndexFilter, canViewPackage);
  }

  const collected: PublicPackageListItem[] = [];
  const decodedCursor = decodePublicPageCursor(args.paginationOpts.cursor);
  if (decodedCursor.done && decodedCursor.offset === 0) {
    return { page: collected, isDone: true, continueCursor: "" };
  }
  const pageCursor = decodedCursor.cursor;
  const offset = decodedCursor.offset;
  const effectivePageSize = Math.min(
    MAX_PUBLIC_LIST_PAGE_SIZE,
    Math.max(
      targetCount,
      decodedCursor.pageSize ?? 0,
      offset > 0 ? offset + targetCount : targetCount,
    ),
  );
  const family = args.family;
  const channel = args.channel;
  const isOfficial = args.isOfficial;

  const builder = args.capabilityTag
    ? buildPackageCapabilityDigestQuery(ctx, {
        capabilityTag: args.capabilityTag,
        family,
        channel,
        isOfficial,
        executesCode: args.executesCode,
      })
    : buildPackageDigestQuery(ctx, {
        family,
        channel,
        isOfficial,
        executesCode: args.executesCode,
      });
  const page: {
    page: PackageDigestLike[];
    isDone: boolean;
    continueCursor: string;
  } = await builder.order("desc").paginate({ cursor: pageCursor, numItems: effectivePageSize });
  for (let index = offset; index < page.page.length; index += 1) {
    const digest = page.page[index] as PackageDigestLike;
    if (!(await canViewPackage(digest))) continue;
    if (channel && digest.channel !== channel) continue;
    if (typeof isOfficial === "boolean" && digest.isOfficial !== isOfficial) {
      continue;
    }
    if (!digestMatchesFilters(digest, args)) continue;
    collected.push(toPublicPackageListItem(digest));
    if (collected.length >= targetCount) {
      const nextOffset = index + 1;
      const nextState =
        nextOffset < page.page.length
          ? {
              cursor: pageCursor,
              offset: nextOffset,
              pageSize: effectivePageSize,
              done: page.isDone,
            }
          : {
              cursor: page.continueCursor,
              offset: 0,
              pageSize: effectivePageSize,
              done: page.isDone,
            };
      return {
        page: collected,
        isDone: nextState.done && nextState.offset === 0,
        continueCursor: encodePublicPageCursor(nextState),
      };
    }
  }

  return {
    page: collected,
    isDone: page.isDone,
    continueCursor: encodePublicPageCursor({
      cursor: page.continueCursor,
      offset: 0,
      pageSize: effectivePageSize,
      done: page.isDone,
    }),
  };
}

async function listPackagePageByStorePackIndex(
  ctx: DbReaderCtx,
  args: {
    family?: PackageFamily;
    channel?: PackageChannel;
    isOfficial?: boolean;
    executesCode?: boolean;
    capabilityTag?: string;
    hostTarget?: string;
    environment?: string;
    paginationOpts: { cursor: string | null; numItems: number };
  },
  filter: StorePackIndexFilter,
  canViewPackage: (digest: PackageDigestLike) => Promise<boolean>,
) {
  const targetCount = args.paginationOpts.numItems;
  const collected: PublicPackageListItem[] = [];
  const decodedCursor = decodePublicPageCursor(args.paginationOpts.cursor);
  if (decodedCursor.done && decodedCursor.offset === 0) {
    return { page: collected, isDone: true, continueCursor: "" };
  }
  const pageCursor = decodedCursor.cursor;
  const offset = decodedCursor.offset;
  const effectivePageSize = Math.min(
    MAX_PUBLIC_LIST_PAGE_SIZE,
    Math.max(
      targetCount,
      decodedCursor.pageSize ?? 0,
      offset > 0 ? offset + targetCount : targetCount,
    ),
  );
  const page = await ctx.db
    .query("packageStorePackSearchIndex")
    .withIndex("by_kind_key_updated", (q) => q.eq("kind", filter.kind).eq("key", filter.key))
    .order("desc")
    .paginate({ cursor: pageCursor, numItems: effectivePageSize });

  for (let index = offset; index < page.page.length; index += 1) {
    const row = page.page[index];
    const digest = await ctx.db
      .query("packageSearchDigest")
      .withIndex("by_package", (q) => q.eq("packageId", row.packageId))
      .unique();
    if (!digest || digest.softDeletedAt) continue;
    if (!(await canViewPackage(digest))) continue;
    if (args.family && digest.family !== args.family) continue;
    if (args.channel && digest.channel !== args.channel) continue;
    if (typeof args.isOfficial === "boolean" && digest.isOfficial !== args.isOfficial) continue;
    if (!digestMatchesFilters(digest, args)) continue;
    collected.push(toPublicPackageListItem(digest));
    if (collected.length >= targetCount) {
      const nextOffset = index + 1;
      const nextState =
        nextOffset < page.page.length
          ? {
              cursor: pageCursor,
              offset: nextOffset,
              pageSize: effectivePageSize,
              done: page.isDone,
            }
          : {
              cursor: page.continueCursor,
              offset: 0,
              pageSize: effectivePageSize,
              done: page.isDone,
            };
      return {
        page: collected,
        isDone: nextState.done && nextState.offset === 0,
        continueCursor: encodePublicPageCursor(nextState),
      };
    }
  }

  return {
    page: collected,
    isDone: page.isDone,
    continueCursor: encodePublicPageCursor({
      cursor: page.continueCursor,
      offset: 0,
      pageSize: effectivePageSize,
      done: page.isDone,
    }),
  };
}

export const searchPublic = query({
  args: {
    query: v.string(),
    limit: v.optional(v.number()),
    family: v.optional(
      v.union(v.literal("skill"), v.literal("code-plugin"), v.literal("bundle-plugin")),
    ),
    channel: v.optional(
      v.union(v.literal("official"), v.literal("community"), v.literal("private")),
    ),
    isOfficial: v.optional(v.boolean()),
    highlightedOnly: v.optional(v.boolean()),
    executesCode: v.optional(v.boolean()),
    capabilityTag: v.optional(v.string()),
    hostTarget: v.optional(v.string()),
    environment: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await searchPackagesImpl(ctx, args);
  },
});

export const searchForViewerInternal = internalQuery({
  args: {
    query: v.string(),
    limit: v.optional(v.number()),
    family: v.optional(
      v.union(v.literal("skill"), v.literal("code-plugin"), v.literal("bundle-plugin")),
    ),
    channel: v.optional(
      v.union(v.literal("official"), v.literal("community"), v.literal("private")),
    ),
    isOfficial: v.optional(v.boolean()),
    highlightedOnly: v.optional(v.boolean()),
    executesCode: v.optional(v.boolean()),
    capabilityTag: v.optional(v.string()),
    hostTarget: v.optional(v.string()),
    environment: v.optional(v.string()),
    viewerUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    return await searchPackagesImpl(ctx, args);
  },
});

async function searchPackagesImpl(
  ctx: DbReaderCtx,
  args: {
    query: string;
    limit?: number;
    family?: PackageFamily;
    channel?: PackageChannel;
    isOfficial?: boolean;
    highlightedOnly?: boolean;
    executesCode?: boolean;
    capabilityTag?: string;
    hostTarget?: string;
    environment?: string;
    viewerUserId?: Id<"users">;
  },
) {
  const queryText = args.query.trim().toLowerCase();
  if (!queryText) return [];
  if (args.channel === "private" && !args.viewerUserId) return [];
  const targetCount = Math.max(1, Math.min(args.limit ?? 20, 100));
  const viewerUserId = args.viewerUserId;
  const membershipCache = new Map<string, Promise<boolean>>();
  const canViewPackage = async (digest: PackageDigestLike) =>
    await canViewerReadPackage(ctx, digest, viewerUserId, membershipCache);
  if (args.highlightedOnly) {
    const digests = await fetchHighlightedPackageDigests(ctx, args);
    return digests
      .map((digest) => ({ score: packageSearchScore(digest, queryText), package: digest }))
      .filter((entry) => entry.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          Number(b.package.isOfficial) - Number(a.package.isOfficial) ||
          b.package.updatedAt - a.package.updatedAt,
      )
      .slice(0, targetCount)
      .map((entry) => ({ score: entry.score, package: toPublicPackageListItem(entry.package) }));
  }

  const builder = args.capabilityTag
    ? buildPackageCapabilityDigestQuery(ctx, {
        capabilityTag: args.capabilityTag,
        family: args.family,
        channel: args.channel,
        isOfficial: args.isOfficial,
        executesCode: args.executesCode,
      })
    : buildPackageDigestQuery(ctx, {
        family: args.family,
        channel: args.channel,
        isOfficial: args.isOfficial,
        executesCode: args.executesCode,
      });
  const matches: Array<{ score: number; package: PublicPackageListItem }> = [];
  const seen = new Set<string>();
  const directDigests = args.capabilityTag
    ? []
    : await resolveDirectPackageSearchDigests(ctx, queryText);
  for (const digest of directDigests) {
    if (!(await canViewPackage(digest))) continue;
    if (!digestMatchesSearchFilters(digest, args)) continue;
    const score = packageSearchScore(digest, queryText);
    if (score <= 0 || seen.has(digest.packageId)) continue;
    seen.add(digest.packageId);
    matches.push({
      score,
      package: toPublicPackageListItem(digest),
    });
  }

  if (matches.length < targetCount) {
    const pageSize = Math.min(MAX_SEARCH_PAGE_SIZE, Math.max(targetCount * 5, 50));
    let cursor: string | null = null;
    let done = false;
    let loops = 0;
    let remainingScanBudget = MAX_SEARCH_SCAN_DOCUMENTS;

    while (
      matches.length < targetCount &&
      !done &&
      loops < MAX_SEARCH_SCAN_PAGES &&
      remainingScanBudget > 0
    ) {
      loops += 1;
      const effectivePageSize = Math.min(pageSize, remainingScanBudget);
      if (effectivePageSize <= 0) break;
      remainingScanBudget -= effectivePageSize;
      const page: {
        page: PackageDigestLike[];
        isDone: boolean;
        continueCursor: string;
      } = await builder.order("desc").paginate({ cursor, numItems: effectivePageSize });
      for (const digest of page.page) {
        if (!(await canViewPackage(digest))) continue;
        if (!digestMatchesSearchFilters(digest, args)) continue;
        const score = packageSearchScore(digest, queryText);
        if (score <= 0 || seen.has(digest.packageId)) continue;
        seen.add(digest.packageId);
        matches.push({
          score,
          package: toPublicPackageListItem(digest),
        });
        if (matches.length >= targetCount) break;
      }
      done = page.isDone;
      cursor = page.continueCursor;
    }
  }

  return matches
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(b.package.isOfficial) - Number(a.package.isOfficial) ||
        b.package.updatedAt - a.package.updatedAt,
    )
    .slice(0, targetCount);
}

export const getPackageByNameInternal = internalQuery({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    return await getPackageByNormalizedName(ctx, normalizePackageName(args.name));
  },
});

export const recordPackageDownloadInternal = internalMutation({
  args: { packageId: v.id("packages") },
  handler: async (ctx, args) => {
    const pkg = await ctx.db.get(args.packageId);
    if (!pkg) return;
    await ctx.db.patch(pkg._id, {
      stats: {
        downloads: (pkg.stats?.downloads ?? 0) + 1,
        installs: pkg.stats?.installs ?? 0,
        stars: pkg.stats?.stars ?? 0,
        versions: pkg.stats?.versions ?? 0,
      },
    });
  },
});

export const getTrustedPublisherByPackageIdInternal = internalQuery({
  args: { packageId: v.id("packages") },
  handler: async (ctx, args) => {
    return await getPackageTrustedPublisherByPackageId(ctx, args.packageId);
  },
});

export const setTrustedPublisherForUserInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    packageName: v.string(),
    repository: v.string(),
    repositoryId: v.string(),
    repositoryOwner: v.string(),
    repositoryOwnerId: v.string(),
    workflowFilename: v.string(),
    environment: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const pkg = await getPackageByNormalizedName(ctx, normalizePackageName(args.packageName));
    if (!pkg) throw new ConvexError("Package not found");
    if (pkg.family === "skill") {
      throw new ConvexError(
        "Trusted publishers are only supported for code-plugin and bundle-plugin packages",
      );
    }
    await requireTrustedPublisherEditor(ctx, pkg, args.actorUserId);

    const workflowFilename = normalizeWorkflowFilenameOrThrow(args.workflowFilename);
    const environment = args.environment?.trim() || undefined;

    const existing = await getPackageTrustedPublisherByPackageId(ctx, pkg._id);
    const now = Date.now();
    const patch = {
      provider: "github-actions" as const,
      repository: args.repository,
      repositoryId: args.repositoryId,
      repositoryOwner: args.repositoryOwner,
      repositoryOwnerId: args.repositoryOwnerId,
      workflowFilename,
      environment,
      updatedByUserId: args.actorUserId,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert("packageTrustedPublishers", {
        packageId: pkg._id,
        createdByUserId: args.actorUserId,
        createdAt: now,
        ...patch,
      });
    }

    await ctx.db.insert("auditLogs", {
      actorUserId: args.actorUserId,
      action: "package.trusted_publisher.set",
      targetType: "package",
      targetId: pkg._id,
      metadata: {
        provider: "github-actions",
        repository: args.repository,
        repositoryId: args.repositoryId,
        repositoryOwner: args.repositoryOwner,
        repositoryOwnerId: args.repositoryOwnerId,
        workflowFilename,
        ...(environment ? { environment } : {}),
      },
      createdAt: now,
    });

    return await getPackageTrustedPublisherByPackageId(ctx, pkg._id);
  },
});

export const deleteTrustedPublisherForUserInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    packageName: v.string(),
  },
  handler: async (ctx, args) => {
    const pkg = await getPackageByNormalizedName(ctx, normalizePackageName(args.packageName));
    if (!pkg) throw new ConvexError("Package not found");
    await requireTrustedPublisherEditor(ctx, pkg, args.actorUserId);

    const existing = await getPackageTrustedPublisherByPackageId(ctx, pkg._id);
    if (!existing) return { deleted: false as const };
    await ctx.db.delete(existing._id);

    await ctx.db.insert("auditLogs", {
      actorUserId: args.actorUserId,
      action: "package.trusted_publisher.delete",
      targetType: "package",
      targetId: pkg._id,
      metadata: {
        provider: existing.provider,
        repository: existing.repository,
        repositoryId: existing.repositoryId,
        repositoryOwner: existing.repositoryOwner,
        repositoryOwnerId: existing.repositoryOwnerId,
        workflowFilename: existing.workflowFilename,
        environment: existing.environment,
      },
      createdAt: Date.now(),
    });
    return { deleted: true as const };
  },
});

export const insertAuditLogInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    action: v.string(),
    targetType: v.string(),
    targetId: v.string(),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("auditLogs", {
      actorUserId: args.actorUserId,
      action: args.action,
      targetType: args.targetType,
      targetId: args.targetId,
      metadata: args.metadata,
      createdAt: Date.now(),
    });
  },
});

export const softDeletePackageInternal = internalMutation({
  args: {
    userId: v.id("users"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user || user.deletedAt || user.deactivatedAt) throw new Error("User not found");

    const normalizedName = normalizePackageName(args.name);
    if (!normalizedName) throw new Error("Package name required");

    const pkg = await getPackageByNormalizedName(ctx, normalizedName);
    if (!pkg) throw new Error("Package not found");

    if (pkg.ownerUserId !== args.userId) {
      assertModerator(user);
    }

    if (pkg.softDeletedAt) {
      return {
        ok: true as const,
        packageId: pkg._id,
        releaseCount: 0,
        alreadyDeleted: true as const,
      };
    }

    const now = Date.now();
    const releases = await ctx.db
      .query("packageReleases")
      .withIndex("by_package", (q) => q.eq("packageId", pkg._id))
      .collect();
    let releaseCount = 0;
    for (const release of releases) {
      if (release.softDeletedAt) continue;
      await ctx.db.patch(release._id, { softDeletedAt: now });
      releaseCount += 1;
    }

    await ctx.db.patch(pkg._id, {
      softDeletedAt: now,
      updatedAt: now,
    });

    return {
      ok: true as const,
      packageId: pkg._id,
      releaseCount,
      alreadyDeleted: false as const,
    };
  },
});

export const getReleaseByIdInternal = internalQuery({
  args: { releaseId: v.id("packageReleases") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.releaseId);
  },
});

export const getPackageByIdInternal = internalQuery({
  args: { packageId: v.id("packages") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.packageId);
  },
});

export const getReleaseByPackageAndVersionInternal = internalQuery({
  args: {
    packageId: v.id("packages"),
    version: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("packageReleases")
      .withIndex("by_package_version", (q) =>
        q.eq("packageId", args.packageId).eq("version", args.version),
      )
      .unique();
  },
});

export const getReleasesByIdsInternal = internalQuery({
  args: { releaseIds: v.array(v.id("packageReleases")) },
  handler: async (ctx, args) => {
    return (
      await Promise.all(
        args.releaseIds.map(async (releaseId) => {
          const release = await ctx.db.get(releaseId);
          return release && !release.softDeletedAt ? release : null;
        }),
      )
    ).filter(Boolean);
  },
});

export const getPackageReleaseScanBackfillBatchInternal = internalQuery({
  args: {
    cursor: v.optional(v.number()),
    batchSize: v.optional(v.number()),
    prioritizeRecent: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const batchSize = Math.max(1, Math.min(args.batchSize ?? 50, 200));
    const cursor = args.cursor ?? 0;
    const prioritizeRecent = args.prioritizeRecent ?? true;

    const [recentReleases, backlogReleases] = await Promise.all([
      prioritizeRecent
        ? ctx.db
            .query("packageReleases")
            .order("desc")
            .take(batchSize * 2)
        : Promise.resolve([]),
      ctx.db
        .query("packageReleases")
        .withIndex("by_creation_time", (q) => q.gt("_creationTime", cursor))
        .order("asc")
        .take(batchSize * 3),
    ]);

    const releases = [
      ...recentReleases,
      ...backlogReleases.filter(
        (release, index, all) =>
          recentReleases.findIndex((candidate) => candidate._id === release._id) === -1 &&
          all.findIndex((candidate) => candidate._id === release._id) === index,
      ),
    ];

    const results: Array<{
      releaseId: Id<"packageReleases">;
      packageId: Id<"packages">;
      needsVt: boolean;
      needsLlm: boolean;
      needsStatic: boolean;
    }> = [];
    let nextCursor = cursor;

    for (const release of releases) {
      nextCursor = release._creationTime;
      if (results.length >= batchSize) break;
      if (release.softDeletedAt) continue;

      const pkg = await ctx.db.get(release.packageId);
      if (!pkg || pkg.softDeletedAt || pkg.family === "skill") continue;

      const needsVt = !release.sha256hash || !release.vtAnalysis;
      const needsLlm = !release.llmAnalysis || release.llmAnalysis.status === "error";
      const needsStatic = !release.staticScan;
      if (!needsVt && !needsLlm && !needsStatic) continue;

      results.push({
        releaseId: release._id,
        packageId: release.packageId,
        needsVt,
        needsLlm,
        needsStatic,
      });
    }

    return {
      releases: results,
      nextCursor,
      done: backlogReleases.length < batchSize * 3,
    };
  },
});

function buildGitHubActionsPublishActor(
  publishToken: Doc<"packagePublishTokens">,
): Extract<PackagePublishActor, { kind: "github-actions" }> {
  return {
    kind: "github-actions",
    repository: publishToken.repository,
    workflow: publishToken.workflowFilename,
    runId: publishToken.runId,
    runAttempt: publishToken.runAttempt,
    sha: publishToken.sha,
  };
}

function resolveTrustedPublishSource(
  payload: PackagePublishRequest,
  publishToken: Doc<"packagePublishTokens">,
): PackagePublishRequest["source"] {
  const source = payload.source;
  if (source && source.kind !== "github") {
    throw new ConvexError("Trusted publishes only support GitHub source metadata");
  }
  const requestedRepo =
    typeof source?.repo === "string" && source.repo.trim()
      ? (normalizeGitHubRepository(source.repo) ?? source.repo.trim())
      : undefined;
  if (requestedRepo && requestedRepo !== publishToken.repository) {
    throw new ConvexError("Trusted publish source repo must match the verified GitHub repository");
  }
  if (source?.commit && source.commit !== publishToken.sha) {
    throw new ConvexError("Trusted publish source commit must match the verified GitHub SHA");
  }
  if (source?.ref && source.ref !== publishToken.ref) {
    throw new ConvexError("Trusted publish source ref must match the verified GitHub ref");
  }
  const path = source?.path?.trim() || ".";
  return {
    kind: "github",
    url: `https://github.com/${publishToken.repository}`,
    repo: publishToken.repository,
    ref: publishToken.ref,
    commit: publishToken.sha,
    path,
    importedAt: source?.importedAt ?? Date.now(),
  };
}

function doesTrustedPublisherMatchPublishToken(
  trustedPublisher: PackageTrustedPublisherDoc | null,
  publishToken: Doc<"packagePublishTokens">,
) {
  return Boolean(
    trustedPublisher &&
    trustedPublisher.packageId === publishToken.packageId &&
    trustedPublisher.provider === publishToken.provider &&
    trustedPublisher.repository === publishToken.repository &&
    trustedPublisher.repositoryId === publishToken.repositoryId &&
    trustedPublisher.repositoryOwner === publishToken.repositoryOwner &&
    trustedPublisher.repositoryOwnerId === publishToken.repositoryOwnerId &&
    trustedPublisher.workflowFilename === publishToken.workflowFilename &&
    trustedPublisher.environment === publishToken.environment,
  );
}

async function publishPackageImpl(
  ctx: Parameters<typeof requireGitHubAccountAge>[0] & Pick<ActionCtx, "storage" | "scheduler">,
  auth: PackagePublishAuthContext,
  rawPayload: unknown,
) {
  const payload = parseArk(
    PackagePublishRequestSchema,
    rawPayload,
    "Package publish payload",
  ) as PackagePublishRequest;
  if (payload.family === "skill") {
    throw new ConvexError("Skill packages must use the skills publish flow");
  }
  const family = payload.family;
  const name = normalizePackageName(payload.name);
  const version = assertPackageVersion(family, payload.version);
  const existingPackage = await runQueryRef<Doc<"packages"> | null>(
    ctx,
    internalRefs.packages.getPackageByNameInternal,
    { name },
  );
  const existingTrustedPublisher = existingPackage
    ? await runQueryRef<PackageTrustedPublisherDoc | null>(
        ctx,
        internalRefs.packages.getTrustedPublisherByPackageIdInternal,
        { packageId: existingPackage._id },
      )
    : null;

  let actorUserId: Id<"users">;
  let ownerUserId: Id<"users">;
  let ownerPublisherId: Id<"publishers"> | undefined;
  let publishActor: PackagePublishActor;
  let effectiveSource = payload.source;
  const manualOverrideReason = normalizeManualOverrideReason(payload.manualOverrideReason);

  if (auth.kind === "github-actions") {
    if (!existingPackage) {
      throw new ConvexError("First publish must be manual by a logged-in package owner");
    }
    if (auth.publishToken.packageId !== existingPackage._id) {
      throw new ConvexError("Trusted publish token does not match the target package");
    }
    if (auth.publishToken.version !== version) {
      throw new ConvexError("Trusted publish token does not match the target version");
    }
    if (payload.ownerHandle?.trim()) {
      throw new ConvexError("Trusted publishes must not override the package owner");
    }
    if (payload.channel && payload.channel !== existingPackage.channel) {
      throw new ConvexError("Trusted publishes must not change the package channel");
    }
    actorUserId = existingPackage.ownerUserId;
    ownerUserId = existingPackage.ownerUserId;
    ownerPublisherId = existingPackage.ownerPublisherId;
    publishActor = buildGitHubActionsPublishActor(auth.publishToken);
    effectiveSource = resolveTrustedPublishSource(payload, auth.publishToken);
  } else {
    actorUserId = auth.actorUserId;
    await requireGitHubAccountAge(ctx, actorUserId);
    const ownerTarget = await runMutationRef<{
      publisherId: Id<"publishers">;
      linkedUserId?: Id<"users">;
    } | null>(ctx, internalRefs.publishers.resolvePublishTargetForUserInternal, {
      actorUserId,
      ownerHandle: payload.ownerHandle,
      minimumRole: "publisher",
    });
    ownerUserId = ownerTarget?.linkedUserId ?? actorUserId;
    ownerPublisherId = ownerTarget?.publisherId;
    if (existingTrustedPublisher && !manualOverrideReason) {
      throw new ConvexError(
        "Manual publishes for packages with trusted publisher config require manualOverrideReason",
      );
    }
    publishActor = { kind: "user", userId: actorUserId };
  }

  const displayName = payload.displayName?.trim() || name;
  const files = normalizePublishFiles(payload.files as never);
  const oversizedFile = findOversizedPublishFile(files);
  if (oversizedFile) {
    throw new ConvexError(getPublishFileSizeError(oversizedFile.path));
  }
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_PUBLISH_TOTAL_BYTES) {
    throw new ConvexError(getPublishTotalSizeError("package"));
  }

  const existingSkill = await runQueryRef(ctx, internalRefs.skills.getSkillBySlugInternal, {
    slug: name,
  });
  if (existingSkill) {
    throw new ConvexError(`Package name collides with existing skill slug "${name}"`);
  }
  if (family === "code-plugin" && (!effectiveSource?.repo || !effectiveSource?.commit)) {
    throw new ConvexError("Code plugins require source repo and commit metadata");
  }

  const packageJsonEntry = await readOptionalTextFile(
    ctx,
    files,
    (path) => path === "package.json",
  );
  const pluginManifestEntry = await readOptionalTextFile(
    ctx,
    files,
    (path) => path === "openclaw.plugin.json",
  );
  const bundleManifestEntry = await readOptionalTextFile(
    ctx,
    files,
    (path) => path === "openclaw.bundle.json",
  );
  const readmeEntry = await readOptionalTextFile(
    ctx,
    files,
    (path) => path === "readme.md" || path === "readme.mdx",
  );

  const packageJson = maybeParseJson(packageJsonEntry?.text);
  if (packageJson) ensurePluginNameMatchesPackage(name, packageJson);

  const bundleArtifacts =
    family === "bundle-plugin"
      ? extractBundlePluginArtifacts({
          packageName: name,
          packageJson,
          bundleManifest: maybeParseJson(bundleManifestEntry?.text),
          bundleMetadata: payload.bundle,
          source: effectiveSource,
        })
      : null;

  const codeArtifacts =
    family === "code-plugin"
      ? extractCodePluginArtifacts({
          packageName: name,
          packageJson:
            packageJson ??
            (() => {
              throw new ConvexError("package.json is required for code plugins");
            })(),
          pluginManifest:
            maybeParseJson(pluginManifestEntry?.text) ??
            (() => {
              throw new ConvexError("openclaw.plugin.json is required for code plugins");
            })(),
          source: effectiveSource,
        })
      : null;

  const summary = summarizePackageForSearch({
    packageName: name,
    packageJson,
    readmeText: readmeEntry?.text ?? null,
  });
  const staticScan = await runStaticPublishScan(ctx, {
    slug: name,
    displayName,
    summary,
    metadata: {
      packageJson,
      pluginManifest: maybeParseJson(pluginManifestEntry?.text),
      bundleManifest: maybeParseJson(bundleManifestEntry?.text),
      source: effectiveSource,
    },
    files,
  });
  const verificationSource = codeArtifacts?.verification ?? bundleArtifacts?.verification;
  const initialScanStatus = staticScan.status === "malicious" ? "malicious" : "pending";
  const verification = verificationSource
    ? {
        ...verificationSource,
        scanStatus: initialScanStatus,
      }
    : undefined;
  const integritySha256 = await hashSkillFiles(
    files.map((file) => ({ path: file.path, sha256: file.sha256 })),
  );

  const publishResult = await runMutationRef<{
    ok: true;
    packageId: Id<"packages">;
    releaseId: Id<"packageReleases">;
  }>(ctx, internalRefs.packages.insertReleaseInternal, {
    actorUserId,
    ownerUserId,
    ownerPublisherId,
    publishActor,
    name,
    displayName,
    family,
    version,
    changelog: payload.changelog.trim(),
    tags: payload.tags?.map((tag: string) => tag.trim()).filter(Boolean) ?? ["latest"],
    summary,
    sourceRepo: effectiveSource?.repo || effectiveSource?.url,
    runtimeId: codeArtifacts?.runtimeId ?? bundleArtifacts?.runtimeId,
    channel: payload.channel,
    compatibility: codeArtifacts?.compatibility ?? bundleArtifacts?.compatibility,
    capabilities: codeArtifacts?.capabilities ?? bundleArtifacts?.capabilities,
    verification,
    staticScan,
    files,
    integritySha256,
    allowExistingRelease:
      auth.kind === "github-actions" ||
      (auth.kind === "user" && manualOverrideReason?.startsWith("GitHub Actions ")),
    extractedPackageJson: packageJson,
    extractedPluginManifest:
      family === "code-plugin" ? maybeParseJson(pluginManifestEntry?.text) : undefined,
    normalizedBundleManifest:
      family === "bundle-plugin" ? maybeParseJson(bundleManifestEntry?.text) : undefined,
    source: effectiveSource,
  });

  const storepack = await buildAndStorePackageReleaseStorePack(ctx, {
    packageId: publishResult.packageId,
    releaseId: publishResult.releaseId,
    name,
    owner: payload.ownerHandle ?? null,
    version,
    family,
    channel: payload.channel ?? existingPackage?.channel ?? "community",
    source: effectiveSource,
    compatibility: codeArtifacts?.compatibility ?? bundleArtifacts?.compatibility,
    capabilities: codeArtifacts?.capabilities ?? bundleArtifacts?.capabilities,
    verification,
    files,
  });
  await runMutationRef(ctx, internalRefs.packages.attachStorePackArtifactInternal, {
    packageId: publishResult.packageId,
    releaseId: publishResult.releaseId,
    storageId: storepack.storageId,
    sha256: storepack.sha256,
    size: storepack.size,
    fileCount: storepack.fileCount,
    manifestSha256: storepack.manifestSha256,
    hostTargets: storepack.hostTargets,
    environment: storepack.environment,
    builtAt: storepack.builtAt,
  });

  if (auth.kind === "github-actions") {
    await runMutationRef(ctx, internalRefs.packagePublishTokens.revokeInternal, {
      tokenId: auth.publishToken._id,
    });
  }
  if (auth.kind === "user" && existingTrustedPublisher && manualOverrideReason) {
    await runMutationRef(ctx, internalRefs.packages.insertAuditLogInternal, {
      actorUserId,
      action: "package.publish.manual_override",
      targetType: "package",
      targetId: String(publishResult.packageId),
      metadata: {
        version,
        reason: manualOverrideReason,
        trustedPublisher: {
          provider: existingTrustedPublisher.provider,
          repository: existingTrustedPublisher.repository,
          workflowFilename: existingTrustedPublisher.workflowFilename,
          environment: existingTrustedPublisher.environment,
        },
      },
    });
  }
  if (auth.kind === "github-actions") {
    await runMutationRef(ctx, internalRefs.packages.insertAuditLogInternal, {
      actorUserId,
      action: "package.publish.github_actions",
      targetType: "package",
      targetId: String(publishResult.packageId),
      metadata: {
        version,
        repository: auth.publishToken.repository,
        workflowFilename: auth.publishToken.workflowFilename,
        environment: auth.publishToken.environment,
        runId: auth.publishToken.runId,
        runAttempt: auth.publishToken.runAttempt,
        sha: auth.publishToken.sha,
      },
    });
  }

  await runAfterRef(
    ctx,
    INITIAL_PACKAGE_VT_SCAN_DELAY_MS,
    internalRefs.vt.scanPackageReleaseWithVirusTotal,
    {
      releaseId: publishResult.releaseId,
    },
  );
  await runAfterRef(ctx, 0, internalRefs.llmEval.evaluatePackageReleaseWithLlm, {
    releaseId: publishResult.releaseId,
  });

  return publishResult;
}

async function buildAndStorePackageReleaseStorePack(
  ctx: Pick<ActionCtx, "storage">,
  input: {
    packageId: Id<"packages">;
    releaseId: Id<"packageReleases">;
    name: string;
    owner: string | null;
    version: string;
    family: "skill" | "code-plugin" | "bundle-plugin";
    channel: "official" | "community" | "private";
    source?: unknown;
    compatibility?: unknown;
    capabilities?: unknown;
    verification?: unknown;
    files: Array<{
      path: string;
      size: number;
      storageId: string;
      sha256: string;
      contentType?: string;
    }>;
  },
) {
  const files = [];
  for (const file of input.files) {
    const blob = await ctx.storage.get(file.storageId as Id<"_storage">);
    if (!blob) throw new ConvexError(`Missing stored package file: ${file.path}`);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const actualSha256 = await sha256Hex(bytes);
    if (actualSha256 !== file.sha256) {
      throw new ConvexError(`Stored package file hash mismatch: ${file.path}`);
    }
    files.push({
      path: file.path,
      size: file.size,
      sha256: file.sha256,
      bytes,
      ...(file.contentType ? { contentType: file.contentType } : {}),
    });
  }
  const builtAt = Date.now();
  const storepack = await buildStorePack({
    packageId: input.packageId,
    releaseId: input.releaseId,
    name: input.name,
    owner: input.owner,
    slug: input.name,
    version: input.version,
    family: input.family,
    channel: input.channel,
    publishedAt: builtAt,
    source: input.source,
    compatibility: input.compatibility,
    capabilities: input.capabilities,
    verification: input.verification,
    files,
  });
  const storageId = await ctx.storage.store(
    new Blob([toArrayBuffer(storepack.bytes)], { type: "application/zip" }),
  );
  return { ...storepack, storageId, builtAt };
}

export const publishPackage = action({
  args: { payload: v.any() },
  handler: async (ctx, args) => {
    const { userId } = await requireUserFromAction(ctx);
    return await publishPackageImpl(ctx, { kind: "user", actorUserId: userId }, args.payload);
  },
});

export const publishPackageForUserInternal = internalAction({
  args: {
    actorUserId: v.id("users"),
    payload: v.any(),
  },
  handler: async (ctx, args) => {
    return await publishPackageImpl(
      ctx,
      { kind: "user", actorUserId: args.actorUserId },
      args.payload,
    );
  },
});

export const publishPackageForTrustedPublisherInternal = internalAction({
  args: {
    publishTokenId: v.id("packagePublishTokens"),
    payload: v.any(),
  },
  handler: async (ctx, args) => {
    const publishToken = await runQueryRef<Doc<"packagePublishTokens"> | null>(
      ctx,
      internalRefs.packagePublishTokens.getByIdInternal,
      { tokenId: args.publishTokenId },
    );
    if (!publishToken || publishToken.revokedAt || publishToken.expiresAt <= Date.now()) {
      throw new ConvexError("Trusted publish token is missing or expired");
    }
    const trustedPublisher = await runQueryRef<PackageTrustedPublisherDoc | null>(
      ctx,
      internalRefs.packages.getTrustedPublisherByPackageIdInternal,
      { packageId: publishToken.packageId },
    );
    if (!doesTrustedPublisherMatchPublishToken(trustedPublisher, publishToken)) {
      throw new ConvexError(
        "Trusted publish token no longer matches the current package trusted publisher",
      );
    }
    return await publishPackageImpl(ctx, { kind: "github-actions", publishToken }, args.payload);
  },
});

export const publishRelease = action({
  args: { payload: v.any() },
  handler: async (ctx, args) => {
    const { userId } = await requireUserFromAction(ctx);
    return await publishPackageImpl(ctx, { kind: "user", actorUserId: userId }, args.payload);
  },
});

export const getStorePackBackfillBatchInternal = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(args.limit, 50));
    const candidates = await ctx.db
      .query("packageReleases")
      .withIndex("by_storepack_built_at", (q) => q.eq("storepackBuiltAt", undefined))
      .take(limit * 4);
    const batch = [];
    for (const release of candidates) {
      if (batch.length >= limit) break;
      if (release.softDeletedAt) continue;
      const pkg = await ctx.db.get(release.packageId);
      if (!pkg || pkg.softDeletedAt || pkg.family === "skill") continue;
      batch.push({
        package: {
          _id: pkg._id,
          name: pkg.name,
          ownerPublisherId: pkg.ownerPublisherId,
          ownerUserId: pkg.ownerUserId,
          channel: pkg.channel,
          family: pkg.family,
        },
        release,
      });
    }
    return batch;
  },
});

export const backfillStorePackArtifactsInternal = internalAction({
  args: {
    actorUserId: v.optional(v.id("users")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(args.limit ?? 10, 50));
    const batch = await runQueryRef<
      Array<{
        package: {
          _id: Id<"packages">;
          name: string;
          ownerPublisherId?: Id<"publishers">;
          ownerUserId: Id<"users">;
          channel: "official" | "community" | "private";
          family: "skill" | "code-plugin" | "bundle-plugin";
        };
        release: Doc<"packageReleases">;
      }>
    >(ctx, internalRefs.packages.getStorePackBackfillBatchInternal, { limit });
    const results = [];
    for (const entry of batch) {
      try {
        const storepack = await buildAndStorePackageReleaseStorePack(ctx, {
          packageId: entry.package._id,
          releaseId: entry.release._id,
          name: entry.package.name,
          owner: null,
          version: entry.release.version,
          family: entry.package.family,
          channel: entry.package.channel,
          source: entry.release.source,
          compatibility: entry.release.compatibility,
          capabilities: entry.release.capabilities,
          verification: entry.release.verification,
          files: entry.release.files,
        });
        await runMutationRef(ctx, internalRefs.packages.attachStorePackArtifactInternal, {
          packageId: entry.package._id,
          releaseId: entry.release._id,
          storageId: storepack.storageId,
          sha256: storepack.sha256,
          size: storepack.size,
          fileCount: storepack.fileCount,
          manifestSha256: storepack.manifestSha256,
          hostTargets: storepack.hostTargets,
          environment: storepack.environment,
          builtAt: storepack.builtAt,
        });
        results.push({
          ok: true as const,
          packageId: entry.package._id,
          releaseId: entry.release._id,
          name: entry.package.name,
          version: entry.release.version,
          sha256: storepack.sha256,
        });
      } catch (error) {
        results.push({
          ok: false as const,
          packageId: entry.package._id,
          releaseId: entry.release._id,
          name: entry.package.name,
          version: entry.release.version,
          error: errorMessage(error),
        });
      }
    }
    if (args.actorUserId) {
      await runMutationRef(ctx, internalRefs.packages.insertAuditLogInternal, {
        actorUserId: args.actorUserId,
        action: "package.storepack.backfill",
        targetType: "package",
        targetId: "storepack",
        metadata: {
          requestedLimit: limit,
          processed: results.length,
          succeeded: results.filter((result) => result.ok).length,
          failed: results.filter((result) => !result.ok).length,
        },
      });
    }
    return {
      processed: results.length,
      succeeded: results.filter((result) => result.ok).length,
      failed: results.filter((result) => !result.ok).length,
      results,
    };
  },
});

export const backfillStorePackArtifacts = action({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { user, userId } = await requireUserFromAction(ctx);
    assertAdmin(user);
    return await runActionRef(ctx, internalRefs.packages.backfillStorePackArtifactsInternal, {
      actorUserId: userId,
      limit: args.limit,
    });
  },
});

export const insertReleaseInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    ownerUserId: v.id("users"),
    ownerPublisherId: v.optional(v.id("publishers")),
    publishActor: v.optional(
      v.union(
        v.object({
          kind: v.literal("user"),
          userId: v.id("users"),
        }),
        v.object({
          kind: v.literal("github-actions"),
          repository: v.string(),
          workflow: v.string(),
          runId: v.string(),
          runAttempt: v.string(),
          sha: v.string(),
        }),
      ),
    ),
    name: v.string(),
    displayName: v.string(),
    family: v.union(v.literal("skill"), v.literal("code-plugin"), v.literal("bundle-plugin")),
    version: v.string(),
    changelog: v.string(),
    tags: v.array(v.string()),
    summary: v.string(),
    sourceRepo: v.optional(v.string()),
    runtimeId: v.optional(v.string()),
    channel: v.optional(
      v.union(v.literal("official"), v.literal("community"), v.literal("private")),
    ),
    compatibility: v.optional(v.any()),
    capabilities: v.optional(v.any()),
    verification: v.optional(v.any()),
    staticScan: v.optional(v.any()),
    allowExistingRelease: v.optional(v.boolean()),
    files: v.array(
      v.object({
        path: v.string(),
        size: v.number(),
        storageId: v.id("_storage"),
        sha256: v.string(),
        contentType: v.optional(v.string()),
      }),
    ),
    integritySha256: v.string(),
    extractedPackageJson: v.optional(v.any()),
    extractedPluginManifest: v.optional(v.any()),
    normalizedBundleManifest: v.optional(v.any()),
    source: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const normalizedName = normalizePackageName(args.name);
    const actor = await ctx.db.get(args.actorUserId);
    if (!actor) throw new ConvexError("Unauthorized");
    const owner = await ctx.db.get(args.ownerUserId);
    if (!owner) throw new ConvexError("Unauthorized");
    const ownerPublisher = args.ownerPublisherId ? await ctx.db.get(args.ownerPublisherId) : null;
    if (args.ownerUserId !== args.actorUserId) {
      assertAdmin(actor);
    }
    const publisherTrusted = ownerPublisher?.trustedPublisher ?? owner.trustedPublisher;
    if (args.channel === "official" && !publisherTrusted) {
      throw new ConvexError("Only trusted publishers may publish to the official channel");
    }
    const existing = await getPackageByNormalizedName(ctx, normalizedName);
    const nextChannel =
      args.channel ??
      (existing?.channel === "private" ? "private" : publisherTrusted ? "official" : "community");
    const nextIsOfficial = nextChannel === "official";
    const nextOwnerPublisherId = stringifyOptionalId(args.ownerPublisherId ?? null);
    const nextOwnerUserId = stringifyId(args.ownerUserId);
    const nextNameLabel = typeof args.name === "string" ? args.name : "<unknown>";
    const nextRuntimeIdLabel = typeof args.runtimeId === "string" ? args.runtimeId : "<unknown>";
    const nextVersionLabel = typeof args.version === "string" ? args.version : "<unknown>";
    if (existing) {
      const existingIsLegacyPersonalPackage =
        !existing.ownerPublisherId &&
        Boolean(
          args.ownerPublisherId &&
          ownerPublisher?.kind === "user" &&
          ownerPublisher.linkedUserId === existing.ownerUserId,
        );
      const existingOwnerKey = existing.ownerPublisherId
        ? `publisher:${existing.ownerPublisherId}`
        : existingIsLegacyPersonalPackage
          ? `publisher:${nextOwnerPublisherId}`
          : `user:${existing.ownerUserId}`;
      const nextOwnerKey = nextOwnerPublisherId
        ? `publisher:${nextOwnerPublisherId}`
        : `user:${nextOwnerUserId}`;
      if (existingOwnerKey !== nextOwnerKey) {
        throw new ConvexError("Package already exists and belongs to another publisher");
      }
    }
    if (existing && existing.family !== args.family) {
      throw new ConvexError(
        `Package "${nextNameLabel}" already exists as a ${existing.family}; family changes are not allowed`,
      );
    }
    if (
      existing &&
      existing.family === "code-plugin" &&
      existing.runtimeId &&
      args.runtimeId &&
      existing.runtimeId !== args.runtimeId
    ) {
      throw new ConvexError(
        `Package "${nextNameLabel}" already exists with plugin id "${existing.runtimeId}"; runtime id changes are not allowed`,
      );
    }
    if (args.family === "code-plugin" && args.runtimeId) {
      const runtimeCollision = await ctx.db
        .query("packages")
        .withIndex("by_runtime_id", (q) => q.eq("runtimeId", args.runtimeId))
        .unique();
      if (runtimeCollision && runtimeCollision._id !== existing?._id) {
        throw new ConvexError(
          `Plugin id "${nextRuntimeIdLabel}" is already claimed by another package`,
        );
      }
    }

    const pkgId =
      existing?._id ??
      (await ctx.db.insert("packages", {
        name: args.name,
        normalizedName,
        displayName: args.displayName,
        summary: args.summary,
        ownerUserId: args.ownerUserId,
        ownerPublisherId: args.ownerPublisherId,
        family: args.family,
        channel: nextChannel,
        isOfficial: nextIsOfficial,
        runtimeId: args.runtimeId,
        sourceRepo: args.sourceRepo,
        tags: {},
        capabilityTags: args.capabilities?.capabilityTags,
        executesCode: args.capabilities?.executesCode,
        compatibility: args.compatibility,
        capabilities: args.capabilities,
        verification: args.verification,
        scanStatus: args.verification?.scanStatus,
        stats: { downloads: 0, installs: 0, stars: 0, versions: 0 },
        createdAt: now,
        updatedAt: now,
      }));

    if (existing) {
      const releaseExists = await ctx.db
        .query("packageReleases")
        .withIndex("by_package_version", (q) =>
          q.eq("packageId", existing._id).eq("version", args.version),
        )
        .unique();
      if (releaseExists) {
        if (
          args.allowExistingRelease &&
          !releaseExists.softDeletedAt &&
          releaseExists.integritySha256 === args.integritySha256
        ) {
          return {
            ok: true as const,
            packageId: existing._id,
            releaseId: releaseExists._id,
          };
        }
        throw new ConvexError(`Version ${nextVersionLabel} already exists`);
      }
    }
    const priorReleases = existing
      ? await ctx.db
          .query("packageReleases")
          .withIndex("by_package", (q) => q.eq("packageId", existing._id))
          .collect()
      : [];

    const shouldPromoteLatest = args.tags.includes("latest") || !existing?.latestReleaseId;
    const effectiveTags = shouldPromoteLatest
      ? Array.from(new Set([...args.tags, "latest"]))
      : args.tags;

    const releaseId = await ctx.db.insert("packageReleases", {
      packageId: pkgId,
      version: args.version,
      changelog: args.changelog,
      summary: args.summary,
      distTags: effectiveTags,
      files: args.files,
      integritySha256: args.integritySha256,
      extractedPackageJson: args.extractedPackageJson,
      extractedPluginManifest: args.extractedPluginManifest,
      normalizedBundleManifest: args.normalizedBundleManifest,
      compatibility: args.compatibility,
      capabilities: args.capabilities,
      verification: args.verification,
      staticScan: args.staticScan,
      source: args.source,
      createdBy: args.actorUserId,
      publishActor: args.publishActor,
      createdAt: now,
    });

    const pkg = existing ?? (await ctx.db.get(pkgId));
    if (!pkg) throw new ConvexError("Package insert failed");

    const nextTags = { ...pkg.tags };
    for (const tag of effectiveTags) nextTags[tag] = releaseId;
    for (const priorRelease of priorReleases) {
      const nextDistTags = (priorRelease.distTags ?? []).filter(
        (tag) => !effectiveTags.includes(tag),
      );
      if (nextDistTags.length === (priorRelease.distTags ?? []).length) continue;
      await ctx.db.patch(priorRelease._id, { distTags: nextDistTags });
    }

    await ctx.db.patch(pkgId, {
      displayName: args.displayName,
      ownerUserId: args.ownerUserId,
      ownerPublisherId: args.ownerPublisherId ?? pkg.ownerPublisherId,
      summary: shouldPromoteLatest ? args.summary : pkg.summary,
      sourceRepo: args.sourceRepo,
      runtimeId: shouldPromoteLatest ? args.runtimeId : pkg.runtimeId,
      channel: nextChannel,
      isOfficial: nextIsOfficial,
      latestReleaseId: shouldPromoteLatest ? releaseId : pkg.latestReleaseId,
      latestVersionSummary: shouldPromoteLatest
        ? {
            version: args.version,
            createdAt: now,
            changelog: args.changelog,
            compatibility: args.compatibility,
            capabilities: args.capabilities,
            verification: args.verification,
          }
        : pkg.latestVersionSummary,
      tags: nextTags,
      capabilityTags: shouldPromoteLatest
        ? (args.capabilities?.capabilityTags ?? pkg.capabilityTags)
        : pkg.capabilityTags,
      executesCode: shouldPromoteLatest
        ? typeof args.capabilities?.executesCode === "boolean"
          ? args.capabilities.executesCode
          : pkg.executesCode
        : pkg.executesCode,
      compatibility: shouldPromoteLatest ? args.compatibility : pkg.compatibility,
      capabilities: shouldPromoteLatest ? args.capabilities : pkg.capabilities,
      verification: shouldPromoteLatest ? args.verification : pkg.verification,
      scanStatus: shouldPromoteLatest ? args.verification?.scanStatus : pkg.scanStatus,
      stats: { ...pkg.stats, versions: (pkg.stats?.versions ?? 0) + 1 },
      updatedAt: now,
    });

    return {
      ok: true as const,
      packageId: pkgId,
      releaseId,
    };
  },
});

export const attachStorePackArtifactInternal = internalMutation({
  args: {
    packageId: v.id("packages"),
    releaseId: v.id("packageReleases"),
    storageId: v.id("_storage"),
    sha256: v.string(),
    size: v.number(),
    fileCount: v.number(),
    manifestSha256: v.string(),
    hostTargets: v.array(v.any()),
    environment: v.any(),
    builtAt: v.number(),
  },
  handler: async (ctx, args) => {
    const release = await ctx.db.get(args.releaseId);
    if (!release || release.packageId !== args.packageId || release.softDeletedAt) {
      throw new ConvexError("Package release not found");
    }
    const pkg = await ctx.db.get(args.packageId);
    if (!pkg || pkg.softDeletedAt) {
      throw new ConvexError("Plugin package not found");
    }
    const now = Date.now();
    const existing = await ctx.db
      .query("packageReleaseArtifacts")
      .withIndex("by_release", (q) => q.eq("releaseId", args.releaseId))
      .collect();
    for (const artifact of existing) {
      if (artifact.kind === "storepack" && artifact.status === "active") {
        await ctx.db.patch(artifact._id, { status: "superseded" });
      }
    }
    await ctx.db.insert("packageReleaseArtifacts", {
      packageId: args.packageId,
      releaseId: args.releaseId,
      kind: "storepack",
      storageId: args.storageId,
      sha256: args.sha256,
      size: args.size,
      format: "zip",
      status: "active",
      createdAt: now,
    });
    const releasePatch = {
      storepackStorageId: args.storageId,
      storepackSha256: args.sha256,
      storepackSize: args.size,
      storepackSpecVersion: 1,
      storepackFormat: "zip",
      storepackFileCount: args.fileCount,
      storepackManifestSha256: args.manifestSha256,
      storepackBuiltAt: args.builtAt,
      storepackBuildVersion: "clawhub-storepack-v1",
      storepackRevokedAt: undefined,
      storepackRevokedByUserId: undefined,
      storepackRevocationReason: undefined,
      hostTargetsSummary: args.hostTargets,
      environmentSummary: args.environment,
    } satisfies Partial<Doc<"packageReleases">>;
    await ctx.db.patch(args.releaseId, releasePatch);
    await replaceStorePackSearchIndexRows(ctx, pkg, {
      ...release,
      ...releasePatch,
    } as Doc<"packageReleases">);
  },
});

async function revokeStorePackArtifactForRelease(
  ctx: MutationCtx,
  input: {
    releaseId: Id<"packageReleases">;
    actorUserId: Id<"users">;
    reason?: string;
  },
) {
  const [actor, release] = await Promise.all([
    ctx.db.get(input.actorUserId),
    ctx.db.get(input.releaseId),
  ]);
  if (!actor) throw new ConvexError("Actor not found");
  assertModerator(actor);
  if (!release || release.softDeletedAt) throw new ConvexError("Package release not found");
  const pkg = await ctx.db.get(release.packageId);
  if (!pkg || pkg.softDeletedAt || pkg.family === "skill") {
    throw new ConvexError("Plugin package not found");
  }
  if (!release.storepackStorageId || !release.storepackSha256) {
    throw new ConvexError("StorePack artifact not found");
  }

  const now = Date.now();
  const reason = input.reason?.trim() || undefined;
  const artifacts = await ctx.db
    .query("packageReleaseArtifacts")
    .withIndex("by_release", (q) => q.eq("releaseId", release._id))
    .collect();
  let revokedArtifactCount = 0;
  for (const artifact of artifacts) {
    if (
      artifact.kind !== "storepack" ||
      artifact.status !== "active" ||
      artifact.sha256 !== release.storepackSha256
    ) {
      continue;
    }
    await ctx.db.patch(artifact._id, {
      status: "revoked",
      revokedAt: now,
      revokedByUserId: actor._id,
      ...(reason ? { revocationReason: reason } : {}),
    });
    revokedArtifactCount += 1;
  }

  await ctx.db.patch(release._id, {
    storepackRevokedAt: release.storepackRevokedAt ?? now,
    storepackRevokedByUserId: release.storepackRevokedByUserId ?? actor._id,
    ...(reason ? { storepackRevocationReason: reason } : {}),
  });
  await replaceStorePackSearchIndexRows(ctx, pkg, {
    ...release,
    storepackRevokedAt: release.storepackRevokedAt ?? now,
    storepackRevokedByUserId: release.storepackRevokedByUserId ?? actor._id,
    ...(reason ? { storepackRevocationReason: reason } : {}),
  } as Doc<"packageReleases">);
  await ctx.db.insert("auditLogs", {
    actorUserId: actor._id,
    action: "package.storepack.revoked",
    targetType: "packageRelease",
    targetId: release._id,
    metadata: {
      packageId: pkg._id,
      packageName: pkg.name,
      version: release.version,
      sha256: release.storepackSha256,
      alreadyRevoked: Boolean(release.storepackRevokedAt),
      revokedArtifactCount,
      ...(reason ? { reason } : {}),
    },
    createdAt: now,
  });

  return {
    ok: true as const,
    packageId: pkg._id,
    releaseId: release._id,
    version: release.version,
    sha256: release.storepackSha256,
    alreadyRevoked: Boolean(release.storepackRevokedAt),
    revokedArtifactCount,
  };
}

export const revokeStorePackArtifact = mutation({
  args: {
    releaseId: v.id("packageReleases"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    return await revokeStorePackArtifactForRelease(ctx, {
      releaseId: args.releaseId,
      actorUserId: user._id,
      reason: args.reason,
    });
  },
});

export const revokeStorePackArtifactForStaffInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    name: v.string(),
    version: v.string(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const normalizedName = normalizePackageName(args.name);
    if (!normalizedName) throw new ConvexError("Package name required");
    const pkg = await getPackageByNormalizedName(ctx, normalizedName);
    if (!pkg || pkg.softDeletedAt || pkg.family === "skill") {
      throw new ConvexError("Plugin package not found");
    }
    const release = await ctx.db
      .query("packageReleases")
      .withIndex("by_package_version", (q) =>
        q.eq("packageId", pkg._id).eq("version", args.version),
      )
      .unique();
    if (!release || release.softDeletedAt) throw new ConvexError("Package release not found");
    return await revokeStorePackArtifactForRelease(ctx, {
      releaseId: release._id,
      actorUserId: args.actorUserId,
      reason: args.reason,
    });
  },
});

function isReleaseActive(release: Doc<"packageReleases"> | null | undefined) {
  return Boolean(release && !release.softDeletedAt);
}

async function syncLatestPackageVerification(ctx: MutationCtx, release: Doc<"packageReleases">) {
  const pkg = await ctx.db.get(release.packageId);
  if (!pkg || pkg.latestReleaseId !== release._id) return;
  const scanStatus = resolvePackageReleaseScanStatus(release);

  const nextVerification = pkg.verification
    ? {
        ...pkg.verification,
        scanStatus,
      }
    : pkg.latestVersionSummary?.verification
      ? {
          ...pkg.latestVersionSummary.verification,
          scanStatus,
        }
      : undefined;

  await ctx.db.patch(pkg._id, {
    verification: nextVerification,
    scanStatus,
    latestVersionSummary: pkg.latestVersionSummary
      ? {
          ...pkg.latestVersionSummary,
          verification: nextVerification,
        }
      : pkg.latestVersionSummary,
  });
}

export const updateReleaseScanResultsInternal = internalMutation({
  args: {
    releaseId: v.id("packageReleases"),
    sha256hash: v.optional(v.string()),
    vtAnalysis: v.optional(vtAnalysisValidator),
  },
  handler: async (ctx, args) => {
    const release = await ctx.db.get(args.releaseId);
    if (!release || release.softDeletedAt) return;
    const activeRelease = release;

    const patch: Partial<Doc<"packageReleases">> = {};
    if (args.sha256hash !== undefined) patch.sha256hash = args.sha256hash;
    if (args.vtAnalysis !== undefined) {
      const nextScanStatus = resolvePackageReleaseScanStatus({
        ...activeRelease,
        vtAnalysis: args.vtAnalysis,
      });
      patch.vtAnalysis = args.vtAnalysis;
      patch.verification = activeRelease.verification
        ? {
            ...activeRelease.verification,
            scanStatus: nextScanStatus,
          }
        : activeRelease.verification;
    }
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(args.releaseId, patch);
    }
    if (args.vtAnalysis !== undefined) {
      const updatedRelease = {
        ...activeRelease,
        ...patch,
      } as Doc<"packageReleases">;
      await syncLatestPackageVerification(ctx, updatedRelease);
      await finalizeInProgressRescanRequestsForTarget(
        ctx,
        { kind: "plugin", artifactId: args.releaseId },
        updatedRelease,
      );
    }
  },
});

export const updateReleaseLlmAnalysisInternal = internalMutation({
  args: {
    releaseId: v.id("packageReleases"),
    llmAnalysis: v.object({
      status: v.string(),
      verdict: v.optional(v.string()),
      confidence: v.optional(v.string()),
      summary: v.optional(v.string()),
      dimensions: v.optional(
        v.array(
          v.object({
            name: v.string(),
            label: v.string(),
            rating: v.string(),
            detail: v.string(),
          }),
        ),
      ),
      guidance: v.optional(v.string()),
      findings: v.optional(v.string()),
      model: v.optional(v.string()),
      checkedAt: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    const release = await ctx.db.get(args.releaseId);
    if (!isReleaseActive(release)) return;
    const updatedRelease = { ...release, llmAnalysis: args.llmAnalysis };
    await ctx.db.patch(args.releaseId, { llmAnalysis: args.llmAnalysis });
    await finalizeInProgressRescanRequestsForTarget(
      ctx,
      { kind: "plugin", artifactId: args.releaseId },
      updatedRelease,
    );
  },
});

export const updateReleaseStaticScanInternal = internalMutation({
  args: {
    releaseId: v.id("packageReleases"),
    staticScan: v.object({
      status: v.union(v.literal("clean"), v.literal("suspicious"), v.literal("malicious")),
      reasonCodes: v.array(v.string()),
      findings: v.array(
        v.object({
          code: v.string(),
          severity: v.union(v.literal("info"), v.literal("warn"), v.literal("critical")),
          file: v.string(),
          line: v.number(),
          message: v.string(),
          evidence: v.string(),
        }),
      ),
      summary: v.string(),
      engineVersion: v.string(),
      checkedAt: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    const release = await ctx.db.get(args.releaseId);
    if (!release || release.softDeletedAt) return;
    const activeRelease = release;

    const patch: Partial<Doc<"packageReleases">> = {
      staticScan: args.staticScan,
    };
    if (activeRelease.verification) {
      const nextScanStatus = resolvePackageReleaseScanStatus({
        ...activeRelease,
        staticScan: args.staticScan,
      });
      patch.verification = activeRelease.verification
        ? {
            ...activeRelease.verification,
            scanStatus: nextScanStatus,
          }
        : activeRelease.verification;
    }

    await ctx.db.patch(args.releaseId, patch);

    const updatedRelease = {
      ...activeRelease,
      ...patch,
    } as Doc<"packageReleases">;
    await syncLatestPackageVerification(ctx, updatedRelease);
    await finalizeInProgressRescanRequestsForTarget(
      ctx,
      { kind: "plugin", artifactId: args.releaseId },
      updatedRelease,
    );
  },
});

export const scanPackageReleaseStaticallyInternal = internalAction({
  args: {
    releaseId: v.id("packageReleases"),
  },
  handler: async (ctx, args) => {
    const release = await runQueryRef<Doc<"packageReleases"> | null>(
      ctx,
      internalRefs.packages.getReleaseByIdInternal,
      { releaseId: args.releaseId },
    );
    if (!release || release.softDeletedAt) {
      return { ok: true as const, skipped: "missing_release" as const };
    }
    const activeRelease = release;

    const pkg = await runQueryRef<Doc<"packages"> | null>(
      ctx,
      internalRefs.packages.getPackageByIdInternal,
      { packageId: activeRelease.packageId },
    );
    if (!pkg || pkg.softDeletedAt || pkg.family === "skill") {
      return { ok: true as const, skipped: "missing_package" as const };
    }

    const staticScan = await runStaticPublishScan(ctx, {
      slug: pkg.name,
      displayName: pkg.displayName,
      summary: pkg.summary,
      metadata: {
        packageJson: activeRelease.extractedPackageJson,
        pluginManifest: activeRelease.extractedPluginManifest,
        bundleManifest: activeRelease.normalizedBundleManifest,
        source: activeRelease.source,
      },
      files: activeRelease.files,
    });

    await runMutationRef(ctx, internalRefs.packages.updateReleaseStaticScanInternal, {
      releaseId: args.releaseId,
      staticScan,
    });

    return {
      ok: true as const,
      status: staticScan.status,
    };
  },
});

export const backfillPackageReleaseScansInternal = internalAction({
  args: {
    cursor: v.optional(v.number()),
    batchSize: v.optional(v.number()),
    scheduled: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = Math.max(1, Math.min(args.batchSize ?? 50, 200));
    const batch = (await runQueryRef(
      ctx,
      internalRefs.packages.getPackageReleaseScanBackfillBatchInternal,
      {
        cursor: args.cursor,
        batchSize,
        prioritizeRecent: args.cursor === undefined,
      },
    )) as {
      releases: Array<{
        releaseId: Id<"packageReleases">;
        needsVt: boolean;
        needsLlm: boolean;
        needsStatic: boolean;
      }>;
      nextCursor: number;
      done: boolean;
    };

    let scheduled = args.scheduled ?? 0;
    const vtEnabled = Boolean(process.env.VT_API_KEY);
    for (const release of batch.releases) {
      if (release.needsVt && vtEnabled) {
        await runAfterRef(ctx, 0, internalRefs.vt.scanPackageReleaseWithVirusTotal, {
          releaseId: release.releaseId,
        });
      }
      if (release.needsLlm) {
        await runAfterRef(ctx, 0, internalRefs.llmEval.evaluatePackageReleaseWithLlm, {
          releaseId: release.releaseId,
        });
      }
      if (release.needsStatic) {
        await runAfterRef(ctx, 0, internalRefs.packages.scanPackageReleaseStaticallyInternal, {
          releaseId: release.releaseId,
        });
      }
      scheduled += 1;
    }

    if (!batch.done) {
      await runAfterRef(ctx, 0, internalRefs.packages.backfillPackageReleaseScansInternal, {
        cursor: batch.nextCursor,
        batchSize,
        scheduled,
      });
    }

    return {
      scheduled,
      nextCursor: batch.nextCursor,
      done: batch.done,
    };
  },
});

export const backfillPackageReleaseScans = action({
  args: {
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await runActionRef(ctx, internalRefs.packages.backfillPackageReleaseScansInternal, {
      batchSize: args.batchSize,
    });
  },
});

async function markPackageRescanRequest(
  ctx: { runMutation: (ref: never, args: never) => Promise<unknown> },
  requestId: Id<"rescanRequests">,
  status: "completed" | "failed",
  error?: string,
) {
  await ctx.runMutation(
    internalRefs.rescanRequests.markStatusInternal as never,
    {
      requestId,
      status,
      error,
    } as never,
  );
}

export const getRescanState = query({
  args: {
    packageId: v.id("packages"),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    const target = await getLatestPackageRescanTarget(ctx, args.packageId);
    await assertCanManageOwnedResource(ctx, {
      actor: user,
      ownerUserId: target.pkg.ownerUserId,
      ownerPublisherId: target.pkg.ownerPublisherId,
      allowPlatformAdmin: true,
    });
    return {
      targetKind: "plugin" as const,
      targetVersion: target.release.version,
      packageReleaseId: target.release._id,
      ...(await buildRescanState(ctx, {
        kind: "plugin",
        artifactId: target.release._id,
      })),
    };
  },
});

export const getOwnerRescanStateByName = query({
  args: {
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const viewerUserId = await getOptionalViewerUserId(ctx);
    if (!viewerUserId) return null;

    const pkg = await getPackageByNormalizedName(ctx, normalizePackageName(args.name));
    if (!pkg || pkg.softDeletedAt || pkg.family === "skill" || !pkg.latestReleaseId) return null;

    const release = await ctx.db.get(pkg.latestReleaseId);
    if (!release || release.softDeletedAt) return null;

    const actor = await ctx.db.get(viewerUserId);
    if (!actor || actor.deletedAt || actor.deactivatedAt) return null;
    if (actor.role !== "admin") {
      const canAccess = await viewerCanAccessPackageOwner(ctx, pkg, viewerUserId);
      if (!canAccess) return null;
    }

    return {
      targetKind: "plugin" as const,
      targetVersion: release.version,
      packageReleaseId: release._id,
      ...(await buildRescanState(ctx, {
        kind: "plugin",
        artifactId: release._id,
      })),
    };
  },
});

export const requestRescan = mutation({
  args: {
    packageId: v.id("packages"),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    const target = await getLatestPackageRescanTarget(ctx, args.packageId);
    await assertCanManageOwnedResource(ctx, {
      actor: user,
      ownerUserId: target.pkg.ownerUserId,
      ownerPublisherId: target.pkg.ownerPublisherId,
      allowPlatformAdmin: true,
    });
    await assertCanRequestRescan(ctx, {
      kind: "plugin",
      artifactId: target.release._id,
    });

    const requestId = await insertPackageRescanRequest(ctx, user, target);
    await ctx.scheduler.runAfter(0, internal.packages.dispatchPackageRescanInternal, {
      requestId,
      releaseId: target.release._id,
    });

    return {
      requestId,
      ...(await buildRescanState(ctx, {
        kind: "plugin",
        artifactId: target.release._id,
      })),
    };
  },
});

export const setModerationVerdict = mutation({
  args: {
    packageId: v.id("packages"),
    verdict: packageScanStatusArgValidator,
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    assertModerator(user);
    const pkg = await ctx.db.get(args.packageId);
    if (!pkg || pkg.softDeletedAt || pkg.family === "skill") {
      throw new ConvexError("Plugin not found");
    }
    const now = Date.now();
    const note = args.note?.trim() || undefined;
    const nextVerification = pkg.verification
      ? {
          ...pkg.verification,
          scanStatus: args.verdict,
          summary:
            note ?? pkg.verification.summary ?? `Moderator marked this plugin ${args.verdict}.`,
        }
      : undefined;
    await ctx.db.patch(pkg._id, {
      scanStatus: args.verdict,
      ...(nextVerification ? { verification: nextVerification } : {}),
      updatedAt: now,
    });
    if (pkg.latestReleaseId) {
      const latestRelease = await ctx.db.get(pkg.latestReleaseId);
      if (latestRelease && !latestRelease.softDeletedAt) {
        const releaseVerification = latestRelease.verification
          ? {
              ...latestRelease.verification,
              scanStatus: args.verdict,
              summary:
                note ??
                latestRelease.verification.summary ??
                `Moderator marked this release ${args.verdict}.`,
            }
          : undefined;
        if (releaseVerification) {
          await ctx.db.patch(latestRelease._id, { verification: releaseVerification });
        }
      }
    }
    await ctx.db.insert("auditLogs", {
      actorUserId: user._id,
      action: "package.moderation.verdict",
      targetType: "package",
      targetId: pkg._id,
      metadata: {
        verdict: args.verdict,
        previousVerdict: pkg.scanStatus,
        ...(note ? { note } : {}),
      },
      createdAt: now,
    });
    return { ok: true as const, verdict: args.verdict };
  },
});

export const setBatch = mutation({
  args: { packageId: v.id("packages"), batch: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);
    assertModerator(user);
    const pkg = await ctx.db.get(args.packageId);
    if (!pkg || pkg.softDeletedAt || pkg.family === "skill") {
      throw new ConvexError("Plugin not found");
    }
    const nextBatch = args.batch?.trim() || undefined;
    const nextHighlighted = nextBatch === "highlighted";
    const now = Date.now();

    if (nextHighlighted) {
      await upsertPackageBadge(ctx, pkg._id, "highlighted", user._id, now);
    } else {
      await removePackageBadge(ctx, pkg._id, "highlighted");
    }

    await ctx.db.insert("auditLogs", {
      actorUserId: user._id,
      action: "package.badge.highlighted",
      targetType: "package",
      targetId: pkg._id,
      metadata: { highlighted: nextHighlighted },
      createdAt: now,
    });
  },
});

export const requestRescanForApiTokenInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    if (!actor || actor.deletedAt || actor.deactivatedAt) throw new ConvexError("Unauthorized");

    const pkg = await getPackageByNormalizedName(ctx, normalizePackageName(args.name));
    if (!pkg || pkg.softDeletedAt || pkg.family === "skill") {
      throw new ConvexError("Plugin not found");
    }

    const target = await getLatestPackageRescanTarget(ctx, pkg._id);
    await assertCanManageOwnedResource(ctx, {
      actor,
      ownerUserId: target.pkg.ownerUserId,
      ownerPublisherId: target.pkg.ownerPublisherId,
      allowPlatformAdmin: true,
    });
    await assertCanRequestRescan(ctx, {
      kind: "plugin",
      artifactId: target.release._id,
    });

    const requestId = await insertPackageRescanRequest(ctx, actor, target);
    await ctx.scheduler.runAfter(0, internal.packages.dispatchPackageRescanInternal, {
      requestId,
      releaseId: target.release._id,
    });

    const state = await buildRescanState(ctx, {
      kind: "plugin",
      artifactId: target.release._id,
    });
    return {
      ok: true,
      targetKind: "package" as const,
      name: target.pkg.normalizedName,
      version: target.release.version,
      status: state.inProgressRequest?.status ?? state.latestRequest?.status ?? "in_progress",
      remainingRequests: state.remainingRequests,
      maxRequests: state.maxRequests,
      pendingRequestId: requestId,
    };
  },
});

export const dispatchPackageRescanInternal = internalAction({
  args: {
    requestId: v.id("rescanRequests"),
    releaseId: v.id("packageReleases"),
  },
  handler: async (ctx, args) => {
    try {
      await runActionRef(ctx, internalRefs.packages.scanPackageReleaseStaticallyInternal, {
        releaseId: args.releaseId,
      });
      await runActionRef(ctx, internalRefs.vt.scanPackageReleaseWithVirusTotal, {
        releaseId: args.releaseId,
      });
      await runActionRef(ctx, internalRefs.llmEval.evaluatePackageReleaseWithLlm, {
        releaseId: args.releaseId,
      });
    } catch (error) {
      await markPackageRescanRequest(ctx, args.requestId, "failed", errorMessage(error));
      throw error;
    }
  },
});
