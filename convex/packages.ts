import { getAuthUserId } from "@convex-dev/auth/server";
import {
  PackagePublishRequestSchema,
  parseArk,
  type PackageChannel,
  type PackageFamily,
  type PackagePublishRequest,
} from "clawhub-schema";
import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";
import { action, internalAction, internalMutation, internalQuery, query } from "./functions";
import { assertModerator, requireUserFromAction } from "./lib/access";
import { requireGitHubAccountAge } from "./lib/githubAccount";
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
import { toPublicUser } from "./lib/public";
import { hashSkillFiles } from "./lib/skills";

const MAX_PACKAGE_BYTES = 50 * 1024 * 1024;
const MAX_PACKAGE_SCAN_DOCUMENTS = 30_000;
const MAX_PUBLIC_LIST_SCAN_PAGES = 200;
const MAX_SEARCH_PAGE_SIZE = 200;
const MAX_SEARCH_SCAN_PAGES = 200;
const internalRefs = internal as unknown as {
  packages: {
    insertReleaseInternal: unknown;
    getByNameForViewerInternal: unknown;
    listVersionsForViewerInternal: unknown;
    getVersionByNameForViewerInternal: unknown;
    publishPackageForUserInternal: unknown;
  };
  skills: {
    getSkillBySlugInternal: unknown;
  };
};
type DbReaderCtx = Pick<QueryCtx | MutationCtx, "db">;
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
  verificationTier: Doc<"packageSearchDigest">["verificationTier"] | null;
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
  | "summary"
  | "ownerHandle"
  | "createdAt"
  | "updatedAt"
  | "latestVersion"
  | "capabilityTags"
  | "executesCode"
  | "verificationTier"
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
  createdAt: number;
  updatedAt: number;
};

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

function packageSearchScore(digest: PackageDigestLike, queryText: string) {
  const needle = queryText.toLowerCase();
  const normalized = digest.normalizedName.toLowerCase();
  const display = digest.displayName.toLowerCase();
  const summary = (digest.summary ?? "").toLowerCase();
  let score = 0;
  if (normalized === needle) score += 200;
  else if (normalized.startsWith(needle)) score += 120;
  else if (normalized.includes(needle)) score += 80;

  if (display === needle) score += 150;
  else if (display.startsWith(needle)) score += 70;
  else if (display.includes(needle)) score += 40;

  if (summary.includes(needle)) score += 20;
  if ((digest.capabilityTags ?? []).some((entry) => entry.toLowerCase().includes(needle))) {
    score += 12;
  }
  if (digest.isOfficial) score += 5;
  return score;
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
  if (pkg.channel === "private" && pkg.ownerUserId !== viewerUserId) return null;
  return pkg;
}

export const getByName = query({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const viewerUserId = (await getAuthUserId(ctx)) ?? undefined;
    const pkg = await getReadablePackageByName(ctx, args.name, viewerUserId);
    if (!pkg) return null;
    const latestRelease = pkg.latestReleaseId ? await ctx.db.get(pkg.latestReleaseId) : null;
    const publicPackage = toPublicPackage(pkg, latestRelease);
    if (!publicPackage) return null;
    const owner = toPublicUser(await ctx.db.get(pkg.ownerUserId));
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
    const owner = toPublicUser(await ctx.db.get(pkg.ownerUserId));
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
    const viewerUserId = (await getAuthUserId(ctx)) ?? undefined;
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
    const viewerUserId = (await getAuthUserId(ctx)) ?? undefined;
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
  const canViewPackage = (digest: PackageDigestLike) =>
    digest.channel !== "private" || digest.ownerUserId === viewerUserId;
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
      if (!canViewPackage(digest)) continue;
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
  const canViewPackage = (digest: PackageDigestLike) =>
    digest.channel !== "private" || digest.ownerUserId === viewerUserId;
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
      if (!canViewPackage(digest)) continue;
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

async function publishPackageImpl(
  ctx: Parameters<typeof requireGitHubAccountAge>[0] & Pick<ActionCtx, "storage">,
  userId: Id<"users">,
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
  await requireGitHubAccountAge(ctx, userId);

  const family = payload.family;
  const name = normalizePackageName(payload.name);
  const version = assertPackageVersion(family, payload.version);
  const displayName = payload.displayName?.trim() || name;
  const files = normalizePublishFiles(payload.files as never);
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_PACKAGE_BYTES) {
    throw new ConvexError("Package exceeds 50MB limit");
  }

  const existingSkill = await runQueryRef(ctx, internalRefs.skills.getSkillBySlugInternal, {
    slug: name,
  });
  if (existingSkill) {
    throw new ConvexError(`Package name collides with existing skill slug "${name}"`);
  }
  if (family === "code-plugin" && (!payload.source?.repo || !payload.source?.commit)) {
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
          source: payload.source,
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
          source: payload.source,
        })
      : null;

  const summary = summarizePackageForSearch({
    packageName: name,
    packageJson,
    readmeText: readmeEntry?.text ?? null,
  });
  const integritySha256 = await hashSkillFiles(
    files.map((file) => ({ path: file.path, sha256: file.sha256 })),
  );

  return await runMutationRef(ctx, internalRefs.packages.insertReleaseInternal, {
    userId,
    name,
    displayName,
    family,
    version,
    changelog: payload.changelog.trim(),
    tags: payload.tags?.map((tag: string) => tag.trim()).filter(Boolean) ?? ["latest"],
    summary,
    sourceRepo: payload.source?.repo || payload.source?.url,
    runtimeId: codeArtifacts?.runtimeId ?? bundleArtifacts?.runtimeId,
    channel: payload.channel,
    compatibility: codeArtifacts?.compatibility ?? bundleArtifacts?.compatibility,
    capabilities: codeArtifacts?.capabilities ?? bundleArtifacts?.capabilities,
    verification: codeArtifacts?.verification ?? bundleArtifacts?.verification,
    files,
    integritySha256,
    extractedPackageJson: packageJson,
    extractedPluginManifest:
      family === "code-plugin" ? maybeParseJson(pluginManifestEntry?.text) : undefined,
    normalizedBundleManifest:
      family === "bundle-plugin" ? maybeParseJson(bundleManifestEntry?.text) : undefined,
    source: payload.source,
  });
}

export const publishPackage = action({
  args: { payload: v.any() },
  handler: async (ctx, args) => {
    const { userId } = await requireUserFromAction(ctx);
    return await publishPackageImpl(ctx, userId, args.payload);
  },
});

export const publishPackageForUserInternal = internalAction({
  args: {
    userId: v.id("users"),
    payload: v.any(),
  },
  handler: async (ctx, args) => {
    return await publishPackageImpl(ctx, args.userId, args.payload);
  },
});

export const publishRelease = action({
  args: { payload: v.any() },
  handler: async (ctx, args) => {
    const { userId } = await requireUserFromAction(ctx);
    return await publishPackageImpl(ctx, userId, args.payload);
  },
});

export const insertReleaseInternal = internalMutation({
  args: {
    userId: v.id("users"),
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
    const owner = await ctx.db.get(args.userId);
    if (!owner) throw new ConvexError("Unauthorized");
    if (args.channel === "official" && !owner.trustedPublisher) {
      throw new ConvexError("Only trusted publishers may publish to the official channel");
    }
    const existing = await getPackageByNormalizedName(ctx, normalizedName);
    const nextChannel =
      args.channel ??
      (existing?.channel === "private"
        ? "private"
        : owner.trustedPublisher
          ? "official"
          : "community");
    const nextIsOfficial = nextChannel === "official";
    if (existing && existing.ownerUserId !== args.userId) {
      throw new ConvexError("Package already exists and belongs to another user");
    }
    if (existing && existing.family !== args.family) {
      throw new ConvexError(
        `Package "${args.name}" already exists as a ${existing.family}; family changes are not allowed`,
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
        `Package "${args.name}" already exists with plugin id "${existing.runtimeId}"; runtime id changes are not allowed`,
      );
    }
    if (args.family === "code-plugin" && args.runtimeId) {
      const runtimeCollision = await ctx.db
        .query("packages")
        .withIndex("by_runtime_id", (q) => q.eq("runtimeId", args.runtimeId))
        .unique();
      if (runtimeCollision && runtimeCollision._id !== existing?._id) {
        throw new ConvexError(
          `Plugin id "${args.runtimeId}" is already claimed by another package`,
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
        ownerUserId: args.userId,
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
      if (releaseExists) throw new ConvexError(`Version ${args.version} already exists`);
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
      source: args.source,
      createdBy: args.userId,
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
