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
import { action, internalAction, internalMutation, internalQuery, query } from "./functions";
import {
  assertAdmin,
  assertModerator,
  getOptionalActiveAuthUserId,
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
import { isPackageBlockedFromPublic, resolvePackageReleaseScanStatus } from "./lib/packageSecurity";
import { toPublicPublisher } from "./lib/public";
import { getOwnerPublisher, getPublisherMembership } from "./lib/publishers";
import {
  findOversizedPublishFile,
  getPublishFileSizeError,
  getPublishTotalSizeError,
  MAX_PUBLISH_TOTAL_BYTES,
} from "./lib/publishLimits";
import { tokenize } from "./lib/searchText";
import { hashSkillFiles } from "./lib/skills";
import { runStaticPublishScan } from "./lib/staticPublishScan";

const MAX_PACKAGE_SCAN_DOCUMENTS = 30_000;
const MAX_PUBLIC_LIST_SCAN_PAGES = 200;
const MAX_SEARCH_PAGE_SIZE = 200;
const MAX_SEARCH_SCAN_PAGES = 200;
const MAX_DIRECT_PACKAGE_SEARCH_CANDIDATES = 20;
const INITIAL_PACKAGE_VT_SCAN_DELAY_MS = 30_000;
const internalRefs = internal as unknown as {
  llmEval: {
    evaluatePackageReleaseWithLlm: unknown;
  };
  packages: {
    backfillPackageReleaseScansInternal: unknown;
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
};
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
  latestRelease: {
    version: string;
    createdAt: number;
    vtStatus: string | null;
    llmStatus: string | null;
    staticScanStatus: "clean" | "suspicious" | "malicious" | null;
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
  },
) {
  if (
    typeof args.executesCode === "boolean" &&
    Boolean(digest.executesCode) !== args.executesCode
  ) {
    return false;
  }
  if (args.capabilityTag) {
    if (digest.capabilityTag) return digest.capabilityTag === args.capabilityTag;
    return (digest.capabilityTags ?? []).includes(args.capabilityTag);
  }
  return true;
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
    latestRelease:
      latestRelease && !latestRelease.softDeletedAt
        ? {
            version: latestRelease.version,
            createdAt: latestRelease.createdAt,
            vtStatus: latestRelease.vtAnalysis?.status ?? null,
            llmStatus: latestRelease.llmAnalysis?.status ?? null,
            staticScanStatus: latestRelease.staticScan?.status ?? null,
          }
        : null,
  };
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
  if (pkg.ownerUserId === actorUserId) return;
  if (!pkg.ownerPublisherId) throw new ConvexError("Forbidden");
  const membership = await getPublisherMembership(ctx, pkg.ownerPublisherId, actorUserId);
  if (!membership || membership.role === "publisher") {
    throw new ConvexError("Forbidden");
  }
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
    executesCode: v.optional(v.boolean()),
    capabilityTag: v.optional(v.string()),
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
    executesCode: v.optional(v.boolean()),
    capabilityTag: v.optional(v.string()),
    viewerUserId: v.optional(v.id("users")),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    return await listPackagePageImpl(ctx, args);
  },
});

async function listPackagePageImpl(
  ctx: DbReaderCtx,
  args: {
    family?: PackageFamily;
    channel?: PackageChannel;
    isOfficial?: boolean;
    executesCode?: boolean;
    capabilityTag?: string;
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
  const collected: PublicPackageListItem[] = [];
  const decodedCursor = decodePublicPageCursor(args.paginationOpts.cursor);
  let cursor = decodedCursor.cursor;
  let offset = decodedCursor.offset;
  let pageSize = decodedCursor.pageSize;
  let done = decodedCursor.done;
  let loops = 0;
  let remainingScanBudget = MAX_PACKAGE_SCAN_DOCUMENTS;
  const family = args.family;
  const channel = args.channel;
  const isOfficial = args.isOfficial;

  while (
    (offset > 0 || !done) &&
    collected.length < targetCount &&
    loops < MAX_PUBLIC_LIST_SCAN_PAGES &&
    remainingScanBudget > 0
  ) {
    loops += 1;
    const effectivePageSize = Math.min(
      remainingScanBudget,
      offset > 0 && pageSize
        ? Math.max(pageSize, offset + 1)
        : Math.max(targetCount * 3, targetCount),
    );
    if (effectivePageSize <= 0) break;
    remainingScanBudget -= effectivePageSize;
    const pageCursor = cursor;
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
        if (nextOffset < page.page.length) {
          cursor = pageCursor;
          offset = nextOffset;
          pageSize = effectivePageSize;
          done = page.isDone;
        } else {
          cursor = page.continueCursor;
          offset = 0;
          pageSize = effectivePageSize;
          done = page.isDone;
        }
        return {
          page: collected,
          isDone: done && offset === 0,
          continueCursor: encodePublicPageCursor({ cursor, offset, pageSize, done }),
        };
      }
    }
    done = page.isDone;
    cursor = page.continueCursor;
    offset = 0;
    pageSize = effectivePageSize;
  }

  return {
    page: collected,
    isDone: done,
    continueCursor: encodePublicPageCursor({ cursor, offset, pageSize, done }),
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
    executesCode: v.optional(v.boolean()),
    capabilityTag: v.optional(v.string()),
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
    executesCode: v.optional(v.boolean()),
    capabilityTag: v.optional(v.string()),
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
    executesCode?: boolean;
    capabilityTag?: string;
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
    if (args.channel && digest.channel !== args.channel) continue;
    if (typeof args.isOfficial === "boolean" && digest.isOfficial !== args.isOfficial) {
      continue;
    }
    if (!digestMatchesFilters(digest, args)) continue;
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
    let remainingScanBudget = MAX_PACKAGE_SCAN_DOCUMENTS;

    while (!done && loops < MAX_SEARCH_SCAN_PAGES && remainingScanBudget > 0) {
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
        if (args.channel && digest.channel !== args.channel) continue;
        if (typeof args.isOfficial === "boolean" && digest.isOfficial !== args.isOfficial) {
          continue;
        }
        if (!digestMatchesFilters(digest, args)) continue;
        const score = packageSearchScore(digest, queryText);
        if (score <= 0 || seen.has(digest.packageId)) continue;
        seen.add(digest.packageId);
        matches.push({
          score,
          package: toPublicPackageListItem(digest),
        });
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
    extractedPackageJson: packageJson,
    extractedPluginManifest:
      family === "code-plugin" ? maybeParseJson(pluginManifestEntry?.text) : undefined,
    normalizedBundleManifest:
      family === "bundle-plugin" ? maybeParseJson(bundleManifestEntry?.text) : undefined,
    source: effectiveSource,
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
    const nextName = args.name;
    const nextRuntimeId = args.runtimeId ?? null;
    const nextVersion = args.version;
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
        `Package "${nextName}" already exists as a ${existing.family}; family changes are not allowed`,
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
        `Package "${nextName}" already exists with plugin id "${existing.runtimeId}"; runtime id changes are not allowed`,
      );
    }
    if (args.family === "code-plugin" && args.runtimeId) {
      const runtimeCollision = await ctx.db
        .query("packages")
        .withIndex("by_runtime_id", (q) => q.eq("runtimeId", args.runtimeId))
        .unique();
      if (runtimeCollision && runtimeCollision._id !== existing?._id) {
        throw new ConvexError(`Plugin id "${nextRuntimeId}" is already claimed by another package`);
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
      if (releaseExists) throw new ConvexError(`Version ${nextVersion} already exists`);
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
    vtAnalysis: v.optional(
      v.object({
        status: v.string(),
        verdict: v.optional(v.string()),
        analysis: v.optional(v.string()),
        source: v.optional(v.string()),
        checkedAt: v.number(),
      }),
    ),
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
      await syncLatestPackageVerification(ctx, {
        ...activeRelease,
        ...patch,
      } as Doc<"packageReleases">);
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
    await ctx.db.patch(args.releaseId, { llmAnalysis: args.llmAnalysis });
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

    await syncLatestPackageVerification(ctx, {
      ...activeRelease,
      ...patch,
    } as Doc<"packageReleases">);
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
