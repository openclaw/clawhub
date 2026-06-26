import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery, mutation, query } from "./functions";
import { assertAdmin, getOptionalActiveAuthUserId, requireUser } from "./lib/access";
import { isPublicSkillDoc } from "./lib/globalStats";
import { isOfficialPublisher, toPublicPublisherWithOfficial } from "./lib/officialPublishers";
import { extractPackageDigestFields, upsertPackageSearchDigest } from "./lib/packageSearchDigest";
import { isPackageBlockedFromPublic } from "./lib/packageSecurity";
import { toPublicPublisher } from "./lib/public";
import {
  formatReservedPublicOwnerHandleMessage,
  isReservedOpenClawExtensionHandle,
  isReservedPublicOwnerHandle,
} from "./lib/publicRouteReservations";
import {
  buildGitHubSkillCatalogDisplay,
  type GitHubSkillCatalogDisplay,
  type GitHubSkillCatalogItem,
  type GitHubSkillCatalogSource,
} from "./lib/publisherCatalogDisplay";
import {
  canAccessPublisherOwnerScope,
  assertPublisherHandleAllowed,
  ensurePersonalPublisherForUser,
  getActiveUserByHandleOrPersonalPublisher,
  getOwnerPublisher,
  getPublisherByHandle,
  getPublisherMembership,
  getPersonalPublisherForUserOrFallback,
  getPersonalPublisherForUser,
  isPublisherActive,
  isPublisherRoleAllowed,
  isReservedOpenClawPublisherHandle,
  PUBLISHER_HANDLE_PATTERN,
  PUBLISHER_HANDLE_REQUIREMENTS_MESSAGE,
  normalizePublisherHandle,
} from "./lib/publishers";
import {
  getLatestActiveReservedHandle,
  isHandleReservedForAnotherUser,
} from "./lib/reservedHandles";
import { syncSkillSearchDigestForSkill } from "./lib/skillSearchDigest";
import { readCanonicalStat } from "./lib/skillStats";
import { adjustUserSkillStatsForSkillChange } from "./lib/userSkillStats";

const MAX_PUBLIC_PUBLISHER_LIST_LIMIT = 500;
const LEGACY_PUBLISHER_DOWNLOAD_FALLBACK_LIMIT = MAX_PUBLIC_PUBLISHER_LIST_LIMIT;
const MAX_PUBLISHER_HANDLE_PREFIX_CANDIDATES = 100;
const PUBLISHER_LIST_PREVIEW_LIMIT = 3;
const GITHUB_AUTH_ACCOUNT_RECOVERY_MATCH_LIMIT = 10;
const PERSONAL_PUBLISHER_RECOVERY_OWNER_MIGRATION_LIMIT = 100;
const PUBLISHER_IMAGE_UPLOAD_TTL_MS = 15 * 60_000;
const PUBLISHER_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
const PUBLISHER_IMAGE_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const PUBLISHER_INVITE_TTL_MS = 7 * 24 * 60 * 60_000;
const MAX_PENDING_PUBLISHER_INVITES = 100;
const publisherRoleValidator = v.union(
  v.literal("owner"),
  v.literal("admin"),
  v.literal("publisher"),
);

type PublisherListStats = {
  skills: number;
  packages: number;
  installs: number;
  downloads: number;
  stars: number;
};

type PublisherPublishedItem = {
  kind: "skill" | "plugin";
  displayName: string;
  summary?: string | null;
  slug?: string;
  categories?: string[];
  inferredCategories?: string[];
  latestVersionId?: Id<"skillVersions">;
  inferredFromVersionId?: Id<"skillVersions">;
  installs: number;
  /** Legacy response field retained while older frontend bundles are cached. */
  downloads: number;
};
type PublisherPublishedPreviewItem = PublisherPublishedItem;

type PublisherCatalogItem = {
  _id: Id<"skills"> | Id<"packages">;
  kind: "skill" | "plugin";
  slug?: string;
  displayName: string;
  summary: string | null;
  topics?: string[];
  categories?: string[];
  inferredCategories?: string[];
  latestVersionId?: Id<"skillVersions">;
  inferredFromVersionId?: Id<"skillVersions">;
  /**
   * Legacy skill icon field or public plugin manifest HTTPS icon URL retained
   * while older frontend bundles are cached.
   */
  icon: string | null;
  href: string;
  installs: number;
  /** Legacy response field retained while older frontend bundles are cached. */
  downloads: number;
  stars: number;
  isOfficial: boolean;
  updatedAt: number;
  sourceBacked?: boolean;
  sourceId?: Id<"githubSkillSources"> | null;
  sourceRepo?: string | null;
  sourcePath?: string | null;
  sourceVerifiedCommit?: string | null;
};

type PublisherCatalogSort = "downloads" | "recent";
type PublisherCatalogSortArg = PublisherCatalogSort | "installs";

type PublisherListItem = NonNullable<ReturnType<typeof toPublicPublisher>> & {
  stats: PublisherListStats;
  publishedItems: PublisherPublishedItem[];
  starredCount?: number;
  affiliations?: Array<{
    publisher: NonNullable<ReturnType<typeof toPublicPublisher>>;
    role: Doc<"publisherMembers">["role"];
  }>;
};

type PublisherListSummary = {
  publisher: Doc<"publishers">;
  item: PublisherListItem;
  visibility?: PublicPublisherVisibility;
};

function isPublicPublishedSkill(skill: Doc<"skills">) {
  return isPublicSkillDoc(skill);
}

type PublicPublisherKindFilter = "user" | "org";
type PublisherListCounts = {
  all: number;
  individuals: number;
  organizations: number;
};

function validateHandle(
  rawHandle: string,
  options?: { allowReservedOpenClawPublisherHandle?: boolean },
) {
  const handle = normalizePublisherHandle(rawHandle);
  if (!handle) throw new ConvexError("Handle is required");
  if (!PUBLISHER_HANDLE_PATTERN.test(handle)) {
    throw new ConvexError(PUBLISHER_HANDLE_REQUIREMENTS_MESSAGE);
  }
  if (!options?.allowReservedOpenClawPublisherHandle) {
    assertPublisherHandleAllowed(handle);
  }
  if (isReservedPublicOwnerHandle(handle)) {
    throw new ConvexError(formatReservedPublicOwnerHandleMessage(handle));
  }
  return handle;
}

function publisherHandlesMatch(left: string | undefined | null, right: string | undefined | null) {
  const normalizedLeft = normalizePublisherHandle(left);
  const normalizedRight = normalizePublisherHandle(right);
  return Boolean(normalizedLeft && normalizedLeft === normalizedRight);
}

function assertOrgPublisherMembershipManagement(publisher: Doc<"publishers">) {
  if (publisher.kind !== "org") {
    throw new ConvexError("Personal publishers do not support member management");
  }
}

async function requireOrgMembershipManager(
  ctx: Pick<MutationCtx, "db"> | Pick<QueryCtx, "db">,
  publisherId: Id<"publishers">,
  actorUserId: Id<"users">,
) {
  const publisher = await ctx.db.get(publisherId);
  if (!publisher || publisher.deletedAt || publisher.deactivatedAt) {
    throw new ConvexError("Publisher not found");
  }
  assertOrgPublisherMembershipManagement(publisher);
  const membership = await getPublisherMembership(ctx, publisher._id, actorUserId);
  if (!membership || !isPublisherRoleAllowed(membership.role, ["admin"])) {
    throw new ConvexError("Forbidden");
  }
  return { publisher, membership };
}

async function hydratePublisherInvite(ctx: Pick<QueryCtx, "db">, invite: Doc<"publisherInvites">) {
  const [publisher, inviter, targetUser] = await Promise.all([
    ctx.db.get(invite.publisherId),
    ctx.db.get(invite.inviterUserId),
    invite.targetUserId ? ctx.db.get(invite.targetUserId) : Promise.resolve(null),
  ]);
  if (!publisher || publisher.deletedAt || publisher.deactivatedAt) return null;
  return {
    _id: invite._id,
    publisher: {
      _id: publisher._id,
      handle: publisher.handle,
      displayName: publisher.displayName,
      image: publisher.image ?? null,
    },
    targetHandle: invite.targetHandle,
    targetUser: targetUser
      ? {
          _id: targetUser._id,
          handle: targetUser.handle ?? null,
          displayName: targetUser.displayName ?? targetUser.name ?? null,
          image: targetUser.image ?? null,
        }
      : null,
    role: invite.role,
    status: invite.status,
    createdAt: invite.createdAt,
    expiresAt: invite.expiresAt,
    inviter: inviter
      ? {
          _id: inviter._id,
          handle: inviter.handle ?? null,
          displayName: inviter.displayName ?? inviter.name ?? null,
          image: inviter.image ?? null,
        }
      : null,
  };
}

async function publisherInviteMatchesUser(
  ctx: Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">,
  invite: Doc<"publisherInvites">,
  user: Doc<"users">,
) {
  if (invite.targetUserId === user._id) return true;
  if (publisherHandlesMatch(user.handle, invite.targetHandle)) return true;
  const personalPublisher = await getPersonalPublisherForUser(ctx, user._id);
  return publisherHandlesMatch(personalPublisher?.handle, invite.targetHandle);
}

async function getUserByHandle(ctx: Pick<MutationCtx, "db">, handle: string) {
  return await ctx.db
    .query("users")
    .withIndex("handle", (q) => q.eq("handle", handle))
    .unique();
}

function appendHandleSuffix(base: string, suffix: number) {
  const suffixText = suffix <= 1 ? "" : `-${suffix}`;
  const maxBaseLength = Math.max(2, 40 - suffixText.length);
  const trimmedBase = base.slice(0, maxBaseLength);
  return `${trimmedBase}${suffixText}`;
}

function clampInt(value: number, min: number, max: number) {
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function emptyPublisherListStats(): PublisherListStats {
  return { skills: 0, packages: 0, installs: 0, downloads: 0, stars: 0 };
}

function hasPublisherStats(publisher: Doc<"publishers">) {
  return (
    typeof publisher.publishedSkills === "number" &&
    typeof publisher.publishedPackages === "number" &&
    typeof publisher.totalInstalls === "number" &&
    typeof publisher.totalDownloads === "number" &&
    typeof publisher.totalStars === "number"
  );
}

type PublicPublisherVisibility = {
  publisher: Doc<"publishers">;
  linkedUser: Doc<"users"> | null;
};

async function getPublicPublisherVisibility(
  ctx: Pick<QueryCtx, "db">,
  publisher: Doc<"publishers"> | null | undefined,
): Promise<PublicPublisherVisibility | null> {
  if (!publisher || publisher.deletedAt || publisher.deactivatedAt) return null;
  if (publisher.kind !== "user") {
    return { publisher, linkedUser: null };
  }
  if (!publisher.linkedUserId) {
    const legacyOwner = await getLegacyPersonalPublisherOwner(ctx, publisher._id);
    return legacyOwner ? { publisher, linkedUser: legacyOwner } : null;
  }

  const linkedUser = await ctx.db.get(publisher.linkedUserId);
  if (!linkedUser || linkedUser.deletedAt || linkedUser.deactivatedAt) return null;
  return { publisher, linkedUser };
}

async function getLegacyPersonalPublisherOwner(
  ctx: Pick<QueryCtx, "db">,
  publisherId: Id<"publishers">,
) {
  const memberships = await ctx.db
    .query("publisherMembers")
    .withIndex("by_publisher", (q) => q.eq("publisherId", publisherId))
    .collect();
  for (const membership of memberships) {
    if (membership.role !== "owner") continue;
    const user = await ctx.db.get(membership.userId);
    if (user && !user.deletedAt && !user.deactivatedAt) return user;
  }
  return null;
}

function getPublisherDenormalizedStats(publisher: Doc<"publishers">): PublisherListStats {
  return {
    skills: publisher.publishedSkills ?? 0,
    packages: publisher.publishedPackages ?? 0,
    installs: publisher.totalInstalls ?? 0,
    downloads: publisher.totalDownloads ?? 0,
    stars: publisher.totalStars ?? 0,
  };
}

type PublisherPublishedRows = {
  skills: Doc<"skills">[];
  packages: Doc<"packages">[];
};

async function getPublisherPublishedRows(
  ctx: Pick<QueryCtx, "db">,
  publisherId: Id<"publishers">,
): Promise<PublisherPublishedRows> {
  const [skills, packages] = await Promise.all([
    ctx.db
      .query("skills")
      .withIndex("by_owner_publisher_active_updated", (q) =>
        q.eq("ownerPublisherId", publisherId).eq("softDeletedAt", undefined),
      )
      .collect(),
    ctx.db
      .query("packages")
      .withIndex("by_owner_publisher_active_updated", (q) =>
        q.eq("ownerPublisherId", publisherId).eq("softDeletedAt", undefined),
      )
      .collect(),
  ]);
  return { skills: skills.filter(isPublicPublishedSkill), packages };
}

async function getPublisherPublishedPreviewRows(
  ctx: Pick<QueryCtx, "db">,
  publisherId: Id<"publishers">,
): Promise<PublisherPublishedRows> {
  const [skills, packages] = await Promise.all([
    ctx.db
      .query("skills")
      .withIndex("by_owner_publisher_active_downloads", (q) =>
        q.eq("ownerPublisherId", publisherId).eq("softDeletedAt", undefined),
      )
      .order("desc")
      .take(PUBLISHER_LIST_PREVIEW_LIMIT),
    ctx.db
      .query("packages")
      .withIndex("by_owner_publisher_active_downloads", (q) =>
        q.eq("ownerPublisherId", publisherId).eq("softDeletedAt", undefined),
      )
      .order("desc")
      .take(PUBLISHER_LIST_PREVIEW_LIMIT),
  ]);
  return { skills: skills.filter(isPublicPublishedSkill), packages };
}

function getIndexedPublisherStatsFromRows(rows: PublisherPublishedRows): PublisherListStats {
  const stats = emptyPublisherListStats();

  for (const skill of rows.skills) {
    stats.skills += 1;
    stats.installs += readCanonicalStat(skill, "installsAllTime");
    stats.downloads += readCanonicalStat(skill, "downloads");
    stats.stars += readCanonicalStat(skill, "stars");
  }

  for (const pkg of rows.packages) {
    stats.packages += 1;
    stats.installs += pkg.stats.installs;
    stats.downloads += pkg.stats.downloads;
    stats.stars += pkg.stats.stars;
  }

  return stats;
}

function getPublisherPublishedItems(
  rows: PublisherPublishedRows,
  limit = PUBLISHER_LIST_PREVIEW_LIMIT,
): PublisherPublishedItem[] {
  const items: PublisherPublishedPreviewItem[] = [
    ...rows.skills.map((skill) => ({
      kind: "skill" as const,
      displayName: skill.displayName,
      summary: skill.summary,
      slug: skill.slug,
      categories: skill.categories,
      inferredCategories: skill.inferredCategories,
      latestVersionId: skill.latestVersionId,
      inferredFromVersionId: skill.inferredFromVersionId,
      downloads: readCanonicalStat(skill, "downloads"),
      installs: readCanonicalStat(skill, "installsAllTime"),
    })),
    ...rows.packages.map((pkg) => ({
      kind: pkg.family === "skill" ? ("skill" as const) : ("plugin" as const),
      displayName: pkg.displayName,
      categories: pkg.categories,
      downloads: pkg.stats.downloads,
      installs: pkg.stats.installs,
    })),
  ];
  return items
    .sort((a, b) => b.downloads - a.downloads || a.displayName.localeCompare(b.displayName))
    .slice(0, limit)
    .map((item) => ({
      kind: item.kind,
      displayName: item.displayName,
      summary: item.summary,
      slug: item.slug,
      categories: item.categories,
      inferredCategories: item.inferredCategories,
      latestVersionId: item.latestVersionId,
      inferredFromVersionId: item.inferredFromVersionId,
      installs: item.installs,
      downloads: item.downloads,
    }));
}

function buildPluginDetailHref(name: string) {
  const trimmed = name.trim();
  if (!trimmed.startsWith("@")) return `/plugins/${encodeURIComponent(trimmed)}`;
  const slashIndex = trimmed.indexOf("/");
  if (slashIndex <= 1 || slashIndex === trimmed.length - 1) {
    return `/plugins/${encodeURIComponent(trimmed)}`;
  }
  const scope = trimmed.slice(1, slashIndex);
  const packageName = trimmed.slice(slashIndex + 1);
  if (packageName.includes("/")) return `/plugins/${encodeURIComponent(trimmed)}`;
  return `/plugins/@${encodeURIComponent(scope)}/${encodeURIComponent(packageName)}`;
}

function comparePublisherCatalogItems(sort: PublisherCatalogSort) {
  return (a: PublisherCatalogItem, b: PublisherCatalogItem) => {
    if (sort === "recent") {
      return (
        b.updatedAt - a.updatedAt ||
        b.downloads - a.downloads ||
        b.stars - a.stars ||
        a.displayName.localeCompare(b.displayName)
      );
    }

    return (
      b.downloads - a.downloads ||
      b.stars - a.stars ||
      b.updatedAt - a.updatedAt ||
      a.displayName.localeCompare(b.displayName)
    );
  };
}

function normalizePublisherCatalogSort(sort?: PublisherCatalogSortArg): PublisherCatalogSort {
  return sort === "recent" ? "recent" : "downloads";
}

function getPublisherCatalogItems(
  publisher: Doc<"publishers">,
  rows: PublisherPublishedRows,
  publisherOfficial: boolean,
  sort: PublisherCatalogSort = "downloads",
): PublisherCatalogItem[] {
  return [
    ...rows.skills.map((skill) => ({
      _id: skill._id,
      kind: "skill" as const,
      slug: skill.slug,
      displayName: skill.displayName,
      summary: skill.summary ?? null,
      topics: skill.topics,
      categories: skill.categories,
      inferredCategories: skill.inferredCategories,
      latestVersionId: skill.latestVersionId,
      inferredFromVersionId: skill.inferredFromVersionId,
      icon: skill.icon ?? null,
      href: `/${encodeURIComponent(publisher.handle)}/${encodeURIComponent(skill.slug)}`,
      installs: readCanonicalStat(skill, "installsAllTime"),
      downloads: readCanonicalStat(skill, "downloads"),
      stars: readCanonicalStat(skill, "stars"),
      isOfficial: publisherOfficial || Boolean(skill.badges?.official),
      updatedAt: skill.updatedAt,
      sourceBacked: skill.installKind === "github",
      sourceId: skill.githubSourceId ?? null,
      sourceRepo: null,
      sourcePath: skill.githubPath ?? null,
    })),
    ...rows.packages.map((pkg) => ({
      _id: pkg._id,
      kind: "plugin" as const,
      displayName: pkg.displayName,
      summary: pkg.summary ?? null,
      topics: pkg.topics,
      icon:
        pkg.channel === "private" || isPackageBlockedFromPublic(pkg.scanStatus)
          ? null
          : (pkg.icon ?? null),
      href: buildPluginDetailHref(pkg.name),
      installs: pkg.stats.installs,
      downloads: pkg.stats.downloads,
      stars: pkg.stats.stars,
      isOfficial: publisherOfficial || pkg.isOfficial,
      updatedAt: pkg.updatedAt,
    })),
  ].sort(comparePublisherCatalogItems(sort));
}

function toGitHubSkillCatalogSource(source: Doc<"githubSkillSources">): GitHubSkillCatalogSource {
  return {
    _id: source._id,
    repo: source.repo,
    displayManifestStatus: source.displayManifestStatus,
    displayManifest: source.displayManifest,
  };
}

function toGitHubSkillCatalogItem(
  item: PublisherCatalogItem,
  sourceById: Map<string, Doc<"githubSkillSources">>,
): GitHubSkillCatalogItem {
  const sourceId = item.sourceId ? String(item.sourceId) : null;
  return {
    _id: String(item._id),
    kind: item.kind,
    slug: item.slug ?? null,
    displayName: item.displayName,
    summary: item.summary,
    categories: item.categories,
    inferredCategories: item.inferredCategories,
    latestVersionId: item.latestVersionId ? String(item.latestVersionId) : undefined,
    inferredFromVersionId: item.inferredFromVersionId
      ? String(item.inferredFromVersionId)
      : undefined,
    icon: item.icon,
    href: item.href,
    installs: item.installs,
    downloads: item.downloads,
    stars: item.stars,
    isOfficial: item.isOfficial,
    updatedAt: item.updatedAt,
    sourceBacked: item.sourceBacked ?? false,
    sourceId,
    sourceRepo: sourceId ? (sourceById.get(sourceId)?.repo ?? null) : null,
    sourcePath: item.sourcePath ?? null,
    sourceVerifiedCommit: item.sourceVerifiedCommit ?? null,
  };
}

async function toPublisherListItem(
  ctx: Pick<QueryCtx, "db">,
  publisher: Doc<"publishers">,
  options: {
    forceComputedStats?: boolean;
    includePublishedItems?: boolean;
    includeAllPublishedItems?: boolean;
    includeAffiliations?: boolean;
    includeStarredCount?: boolean;
    visibility?: PublicPublisherVisibility;
  } = {},
): Promise<PublisherListItem | null> {
  const visible = options.visibility ?? (await getPublicPublisherVisibility(ctx, publisher));
  if (!visible) return null;
  const publicPublisher = await toPublicPublisherWithOfficial(ctx, publisher);
  if (!publicPublisher) return null;
  const linkedUser = visible.linkedUser;
  let publishedRows: PublisherPublishedRows | null = null;
  const getRows = async () => {
    publishedRows ??= await getPublisherPublishedRows(ctx, publisher._id);
    return publishedRows;
  };
  const getPreviewRows = async () =>
    publishedRows ?? (await getPublisherPublishedPreviewRows(ctx, publisher._id));
  const stats =
    !options.forceComputedStats && hasPublisherStats(publisher)
      ? getPublisherDenormalizedStats(publisher)
      : getIndexedPublisherStatsFromRows(await getRows());
  const publishedItems = options.includePublishedItems
    ? getPublisherPublishedItems(
        await (options.includeAllPublishedItems ? getRows() : getPreviewRows()),
        options.includeAllPublishedItems ? Number.POSITIVE_INFINITY : PUBLISHER_LIST_PREVIEW_LIMIT,
      )
    : [];
  const visibleUserId = publisher.kind === "user" ? linkedUser?._id : null;
  const affiliations =
    options.includeAffiliations && visibleUserId
      ? await getUserPublisherAffiliations(ctx, visibleUserId, publisher._id)
      : undefined;
  const starredCount =
    options.includeStarredCount && visibleUserId
      ? await getUserStarredCount(ctx, visibleUserId)
      : undefined;
  return {
    ...publicPublisher,
    displayName: resolvePublisherDisplayName(publisher, linkedUser),
    image: publicPublisher.image ?? linkedUser?.image,
    bio: publicPublisher.bio ?? linkedUser?.bio,
    stats,
    publishedItems,
    ...(starredCount !== undefined ? { starredCount } : {}),
    ...(affiliations ? { affiliations } : {}),
  };
}

function toPublisherListSummary(publisher: Doc<"publishers">): PublisherListSummary | null {
  const publicPublisher = toPublicPublisher(publisher);
  if (!publicPublisher) return null;
  return {
    publisher,
    item: {
      ...publicPublisher,
      stats: getPublisherDenormalizedStats(publisher),
      publishedItems: [],
    },
  };
}

async function toVisiblePublisherListSummary(
  ctx: Pick<QueryCtx, "db">,
  publisher: Doc<"publishers">,
): Promise<PublisherListSummary | null> {
  const visibility = await getPublicPublisherVisibility(ctx, publisher);
  if (!visibility) return null;
  if (!hasPublisherStats(visibility.publisher)) {
    const item = await toPublisherListItem(ctx, visibility.publisher, {
      forceComputedStats: true,
      visibility,
    });
    return item ? { publisher: visibility.publisher, item, visibility } : null;
  }
  const summary = toPublisherListSummary(visibility.publisher);
  if (!summary) return null;
  return {
    ...summary,
    item: {
      ...summary.item,
      displayName: resolvePublisherDisplayName(visibility.publisher, visibility.linkedUser),
    },
    visibility,
  };
}

function hasPublisherListContent(summary: PublisherListSummary) {
  return summary.item.stats.skills + summary.item.stats.packages > 0;
}

function mergePublisherRows(
  rankedRows: Doc<"publishers">[],
  legacyRows: Doc<"publishers">[],
): Doc<"publishers">[] {
  const rowsById = new Map<Id<"publishers">, Doc<"publishers">>();
  for (const row of rankedRows) rowsById.set(row._id, row);
  for (const row of legacyRows) rowsById.set(row._id, row);
  return [...rowsById.values()];
}

async function getActivePublisherRowsByDownloads(
  ctx: Pick<QueryCtx, "db">,
  kindFilter?: PublicPublisherKindFilter,
): Promise<Doc<"publishers">[]> {
  const rankedRows = kindFilter
    ? await ctx.db
        .query("publishers")
        .withIndex("by_active_kind_total_downloads", (q) =>
          q.eq("deletedAt", undefined).eq("deactivatedAt", undefined).eq("kind", kindFilter),
        )
        .order("desc")
        .take(MAX_PUBLIC_PUBLISHER_LIST_LIMIT)
    : await ctx.db
        .query("publishers")
        .withIndex("by_active_total_downloads", (q) =>
          q.eq("deletedAt", undefined).eq("deactivatedAt", undefined),
        )
        .order("desc")
        .take(MAX_PUBLIC_PUBLISHER_LIST_LIMIT);

  const legacyRows = kindFilter
    ? await ctx.db
        .query("publishers")
        .withIndex("by_active_kind_total_installs", (q) =>
          q.eq("deletedAt", undefined).eq("deactivatedAt", undefined).eq("kind", kindFilter),
        )
        .order("desc")
        .take(LEGACY_PUBLISHER_DOWNLOAD_FALLBACK_LIMIT)
    : await ctx.db
        .query("publishers")
        .withIndex("by_active_total_installs", (q) =>
          q.eq("deletedAt", undefined).eq("deactivatedAt", undefined),
        )
        .order("desc")
        .take(LEGACY_PUBLISHER_DOWNLOAD_FALLBACK_LIMIT);

  return mergePublisherRows(rankedRows, legacyRows);
}

function shouldIncludePublisherListSummary(
  summary: PublisherListSummary,
  options?: { includeEmptyPublishers?: boolean },
) {
  return options?.includeEmptyPublishers || hasPublisherListContent(summary);
}

async function getVisiblePublisherListSummaries(
  ctx: Pick<QueryCtx, "db">,
  publishers: Doc<"publishers">[],
  options?: { includeEmptyPublishers?: boolean },
) {
  const summaries = await Promise.all(
    publishers.map((publisher) => toVisiblePublisherListSummary(ctx, publisher)),
  );
  return summaries
    .filter((summary): summary is PublisherListSummary => Boolean(summary))
    .filter((summary) => shouldIncludePublisherListSummary(summary, options));
}

async function hydratePublisherListSummaries(
  ctx: Pick<QueryCtx, "db">,
  summaries: PublisherListSummary[],
  options?: { includeEmptyPublishers?: boolean },
) {
  const items = await Promise.all(
    summaries.map((summary) =>
      toPublisherListItem(ctx, summary.publisher, {
        includePublishedItems: true,
        visibility: summary.visibility,
      }),
    ),
  );
  return items
    .filter((item): item is PublisherListItem => Boolean(item))
    .filter(
      (item) => options?.includeEmptyPublishers || item.stats.skills + item.stats.packages > 0,
    );
}

async function getUserStarredCount(ctx: Pick<QueryCtx, "db">, userId: Id<"users">) {
  return (
    await ctx.db
      .query("stars")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect()
  ).length;
}

async function getUserPublisherAffiliations(
  ctx: Pick<QueryCtx, "db">,
  userId: Id<"users">,
  currentPublisherId: Id<"publishers">,
) {
  const memberships = await ctx.db
    .query("publisherMembers")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  const items = await Promise.all(
    memberships.map(async (membership) => {
      if (membership.publisherId === currentPublisherId) return null;
      const publisher = await ctx.db.get(membership.publisherId);
      if (
        !publisher ||
        publisher.kind !== "org" ||
        publisher.deletedAt ||
        publisher.deactivatedAt
      ) {
        return null;
      }
      const publicPublisher = await toPublicPublisherWithOfficial(ctx, publisher);
      if (!publicPublisher) return null;
      return {
        publisher: publicPublisher,
        role: membership.role,
      };
    }),
  );
  return items.filter(
    (
      item,
    ): item is {
      publisher: NonNullable<ReturnType<typeof toPublicPublisher>>;
      role: Doc<"publisherMembers">["role"];
    } => Boolean(item),
  );
}

async function toPublicPublisherWithLinkedImage(
  ctx: Pick<QueryCtx, "db">,
  publisher: Doc<"publishers"> | null,
) {
  const item = publisher ? await toPublisherListItem(ctx, publisher) : null;
  if (!item) return null;
  const { stats: _stats, ...publicPublisher } = item;
  return publicPublisher;
}

function comparePublisherListItems(a: PublisherListItem, b: PublisherListItem) {
  const aPublishedCount = a.stats.skills + a.stats.packages;
  const bPublishedCount = b.stats.skills + b.stats.packages;

  return (
    b.stats.downloads - a.stats.downloads ||
    b.stats.stars - a.stats.stars ||
    bPublishedCount - aPublishedCount ||
    a.displayName.localeCompare(b.displayName)
  );
}

function matchesPublisherQuery(publisher: PublisherListItem, queryText: string) {
  if (!queryText) return true;
  const haystack =
    `${publisher.displayName} ${publisher.handle} ${publisher.bio ?? ""}`.toLowerCase();
  return haystack.includes(queryText);
}

function resolvePublisherDisplayName(
  publisher: Pick<Doc<"publishers">, "kind" | "displayName">,
  linkedUser: Pick<Doc<"users">, "displayName" | "name"> | null | undefined,
) {
  if (publisher.kind !== "user") return publisher.displayName;
  return linkedUser?.displayName?.trim() || linkedUser?.name?.trim() || publisher.displayName;
}

function publisherHandlePrefixUpperBound(value: string) {
  return `${value}\uffff`;
}

async function queryActivePublishersByHandlePrefix(
  ctx: Pick<QueryCtx, "db">,
  kind: PublicPublisherKindFilter,
  handlePrefix: string,
) {
  return await ctx.db
    .query("publishers")
    .withIndex("by_active_kind_handle", (q) =>
      q
        .eq("deletedAt", undefined)
        .eq("deactivatedAt", undefined)
        .eq("kind", kind)
        .gte("handle", handlePrefix)
        .lt("handle", publisherHandlePrefixUpperBound(handlePrefix)),
    )
    .take(MAX_PUBLISHER_HANDLE_PREFIX_CANDIDATES);
}

async function collectActivePublisherRowsForListPage(
  ctx: Pick<QueryCtx, "db">,
  args: {
    kindFilter?: PublicPublisherKindFilter;
    queryText?: string;
    browseRows?: Doc<"publishers">[];
  },
) {
  const browseRows =
    args.browseRows ?? (await getActivePublisherRowsByDownloads(ctx, args.kindFilter));
  const normalizedQuery = args.queryText ? normalizePublisherHandle(args.queryText) : undefined;
  if (!normalizedQuery) return browseRows;

  const kinds: PublicPublisherKindFilter[] = args.kindFilter ? [args.kindFilter] : ["user", "org"];
  const [exactMatch, ...prefixMatches] = await Promise.all([
    getPublisherByHandle(ctx, normalizedQuery),
    ...kinds.map((kind) => queryActivePublishersByHandlePrefix(ctx, kind, normalizedQuery)),
  ]);
  const merged = new Map<Id<"publishers">, Doc<"publishers">>();
  for (const publisher of browseRows) {
    merged.set(publisher._id, publisher);
  }
  if (exactMatch && isPublisherActive(exactMatch)) {
    merged.set(exactMatch._id, exactMatch);
  }
  for (const rows of prefixMatches) {
    for (const publisher of rows) {
      merged.set(publisher._id, publisher);
    }
  }
  return [...merged.values()];
}

function getPublisherListCounts(items: PublisherListItem[]): PublisherListCounts {
  const individualCount = items.filter((publisher) => publisher.kind === "user").length;
  const organizationCount = items.filter((publisher) => publisher.kind === "org").length;
  return {
    all: individualCount + organizationCount,
    individuals: individualCount,
    organizations: organizationCount,
  };
}

function getPublisherListSummaryCounts(summaries: PublisherListSummary[]): PublisherListCounts {
  return getPublisherListCounts(summaries.map((summary) => summary.item));
}

async function resolveAvailableUserHandle(
  ctx: Pick<MutationCtx, "db">,
  baseHandle: string,
  excludeUserId?: Id<"users">,
) {
  for (let suffix = 1; suffix <= 50; suffix += 1) {
    const candidate = appendHandleSuffix(baseHandle, suffix);
    if (!PUBLISHER_HANDLE_PATTERN.test(candidate)) continue;
    const existingUser = await getUserByHandle(ctx, candidate);
    if (existingUser && existingUser._id !== excludeUserId) continue;
    const existingPublisher = await getPublisherByHandle(ctx, candidate);
    if (
      existingPublisher &&
      !(existingPublisher.kind === "user" && existingPublisher.linkedUserId === excludeUserId)
    ) {
      continue;
    }
    return candidate;
  }
  throw new ConvexError(`Unable to find an available fallback handle for "@${baseHandle}"`);
}

function deriveLegacyOrgFallbackHandle(orgHandle: string, explicitFallbackHandle?: string) {
  return (
    explicitFallbackHandle ??
    (isReservedOpenClawPublisherHandle(orgHandle) ? "user" : `${orgHandle}-user`)
  );
}

async function migrateLegacyPublisherHandleToOrgWithActor(
  ctx: Pick<MutationCtx, "db">,
  args: {
    actorUserId: Id<"users">;
    handle: string;
    fallbackUserHandle?: string;
    displayName?: string;
  },
) {
  const actor = await ctx.db.get(args.actorUserId);
  if (!actor || actor.deletedAt || actor.deactivatedAt) throw new ConvexError("Unauthorized");
  assertAdmin(actor);

  const orgHandle = validateHandle(args.handle, { allowReservedOpenClawPublisherHandle: true });
  const fallbackBase = validateHandle(
    deriveLegacyOrgFallbackHandle(orgHandle, args.fallbackUserHandle),
  );
  const now = Date.now();

  const handlePublisher = await getPublisherByHandle(ctx, orgHandle);
  const legacyUser =
    (handlePublisher?.linkedUserId ? await ctx.db.get(handlePublisher.linkedUserId) : null) ??
    (await getUserByHandle(ctx, orgHandle));
  if (!legacyUser || legacyUser.deletedAt || legacyUser.deactivatedAt) {
    throw new ConvexError(`Legacy user "@${orgHandle}" not found`);
  }

  const personalPublisher = legacyUser.personalPublisherId
    ? await ctx.db.get(legacyUser.personalPublisherId)
    : await getPersonalPublisherForUser(ctx, legacyUser._id);
  const convertiblePublisher =
    handlePublisher?.kind === "user" && handlePublisher.linkedUserId === legacyUser._id
      ? handlePublisher
      : personalPublisher?.kind === "user" &&
          personalPublisher.linkedUserId === legacyUser._id &&
          personalPublisher.handle === orgHandle
        ? personalPublisher
        : null;

  const fallbackHandle = await resolveAvailableUserHandle(ctx, fallbackBase, legacyUser._id);
  let nextLegacyUser: Doc<"users"> = legacyUser;
  const needsDetachedPersonalPublisher = Boolean(
    convertiblePublisher && legacyUser.personalPublisherId === convertiblePublisher._id,
  );
  if (legacyUser.handle === orgHandle || needsDetachedPersonalPublisher) {
    const userPatch: Partial<Doc<"users">> = {
      updatedAt: now,
    };
    if (legacyUser.handle === orgHandle) {
      userPatch.handle = fallbackHandle;
    }
    if (needsDetachedPersonalPublisher) {
      userPatch.personalPublisherId = undefined;
    }
    await ctx.db.patch(legacyUser._id, userPatch);
    nextLegacyUser = {
      ...legacyUser,
      ...userPatch,
    };
  }

  let orgPublisherId: Id<"publishers">;
  let convertedExistingPublisher = false;
  if (handlePublisher?.kind === "org") {
    orgPublisherId = handlePublisher._id;
    if (args.displayName?.trim() && handlePublisher.displayName !== args.displayName.trim()) {
      await ctx.db.patch(handlePublisher._id, {
        displayName: args.displayName.trim(),
        updatedAt: now,
      });
    }
  } else if (convertiblePublisher) {
    orgPublisherId = convertiblePublisher._id;
    convertedExistingPublisher = true;
    await ctx.db.patch(convertiblePublisher._id, {
      kind: "org",
      handle: orgHandle,
      displayName: args.displayName?.trim() || convertiblePublisher.displayName,
      linkedUserId: undefined,
      trustedPublisher: convertiblePublisher.trustedPublisher ?? legacyUser.trustedPublisher,
      updatedAt: now,
    });
  } else {
    orgPublisherId = await ctx.db.insert("publishers", {
      kind: "org",
      handle: orgHandle,
      displayName: args.displayName?.trim() || legacyUser.displayName?.trim() || orgHandle,
      bio: undefined,
      image: undefined,
      linkedUserId: undefined,
      trustedPublisher: legacyUser.trustedPublisher,
      createdAt: now,
      updatedAt: now,
    });
  }

  const membership = await getPublisherMembership(ctx, orgPublisherId, legacyUser._id);
  if (membership) {
    if (membership.role !== "owner") {
      await ctx.db.patch(membership._id, { role: "owner", updatedAt: now });
    }
  } else {
    await ctx.db.insert("publisherMembers", {
      publisherId: orgPublisherId,
      userId: legacyUser._id,
      role: "owner",
      createdAt: now,
      updatedAt: now,
    });
  }

  const ensuredPersonalPublisher = await ensurePersonalPublisherForUser(ctx, nextLegacyUser, {
    actorUserId: args.actorUserId,
    source: "publisher.legacy_handle.migrate",
  });

  const packages = await ctx.db
    .query("packages")
    .withIndex("by_owner", (q) => q.eq("ownerUserId", legacyUser._id))
    .collect();
  let packagesMigrated = 0;
  for (const pkg of packages) {
    if (pkg.ownerPublisherId === orgPublisherId) continue;
    await ctx.db.patch(pkg._id, {
      ownerPublisherId: orgPublisherId,
      updatedAt: now,
    });
    packagesMigrated += 1;
  }

  await ctx.db.insert("auditLogs", {
    actorUserId: args.actorUserId,
    action: "publisher.legacy_handle.migrate",
    targetType: "publisher",
    targetId: orgPublisherId,
    metadata: {
      handle: orgHandle,
      legacyUserId: legacyUser._id,
      fallbackUserHandle: nextLegacyUser.handle ?? fallbackHandle,
      convertedExistingPublisher,
      packagesMigrated,
      personalPublisherId: ensuredPersonalPublisher?._id ?? null,
    },
    createdAt: now,
  });

  return {
    ok: true as const,
    handle: orgHandle,
    orgPublisherId,
    legacyUserId: legacyUser._id,
    fallbackUserHandle: nextLegacyUser.handle ?? fallbackHandle,
    personalPublisherId: ensuredPersonalPublisher?._id ?? null,
    convertedExistingPublisher,
    packagesMigrated,
  };
}

async function ensureOrgPublisherHandleWithActor(
  ctx: Pick<MutationCtx, "db">,
  args: {
    actorUserId: Id<"users">;
    handle: string;
    fallbackUserHandle?: string;
    displayName?: string;
    trusted?: boolean;
    memberHandle?: string;
    memberRole?: "owner" | "admin" | "publisher";
  },
) {
  const actor = await ctx.db.get(args.actorUserId);
  if (!actor || actor.deletedAt || actor.deactivatedAt) throw new ConvexError("Unauthorized");
  assertAdmin(actor);

  const handle = validateHandle(args.handle, { allowReservedOpenClawPublisherHandle: true });
  const now = Date.now();
  const existingPublisher = await getPublisherByHandle(ctx, handle);
  const existingUser = await getUserByHandle(ctx, handle);
  const ensureMember = async (publisherId: Id<"publishers">) =>
    await ensureOrgPublisherMemberWithActor(ctx, {
      actorUserId: args.actorUserId,
      publisherId,
      memberHandle: args.memberHandle,
      memberRole: args.memberRole,
      now,
    });

  if (existingPublisher?.kind === "org") {
    if (existingPublisher.deletedAt || existingPublisher.deactivatedAt) {
      throw new ConvexError(`Publisher "@${handle}" was deleted and cannot be updated`);
    }
    await ctx.db.patch(existingPublisher._id, {
      displayName: args.displayName?.trim() || existingPublisher.displayName,
      trustedPublisher: args.trusted ?? existingPublisher.trustedPublisher,
      updatedAt: now,
    });
    const member = await ensureMember(existingPublisher._id);
    return {
      ok: true as const,
      publisherId: existingPublisher._id,
      handle,
      created: false,
      migrated: false,
      trusted: args.trusted ?? existingPublisher.trustedPublisher ?? false,
      ...(member ? { member } : {}),
    };
  }

  if (existingPublisher || existingUser) {
    const result = await migrateLegacyPublisherHandleToOrgWithActor(ctx, {
      actorUserId: args.actorUserId,
      handle,
      fallbackUserHandle: args.fallbackUserHandle,
      displayName: args.displayName,
    });
    if (typeof args.trusted === "boolean") {
      await ctx.db.patch(result.orgPublisherId, {
        trustedPublisher: args.trusted,
        updatedAt: now,
      });
    }
    const member = await ensureMember(result.orgPublisherId);
    return {
      ok: true as const,
      publisherId: result.orgPublisherId,
      handle,
      created: false,
      migrated: true,
      trusted: args.trusted ?? existingPublisher?.trustedPublisher ?? false,
      ...(member ? { member } : {}),
    };
  }

  if (!normalizePublisherHandle(args.memberHandle)) {
    throw new ConvexError("memberHandle required when creating org publisher");
  }
  if (!existingPublisher && !existingUser && isReservedOpenClawExtensionHandle(handle)) {
    throw new ConvexError(formatReservedPublicOwnerHandleMessage(handle));
  }

  const publisherId = await ctx.db.insert("publishers", {
    kind: "org",
    handle,
    displayName: args.displayName?.trim() || handle,
    bio: undefined,
    image: undefined,
    linkedUserId: undefined,
    trustedPublisher: args.trusted || undefined,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.insert("auditLogs", {
    actorUserId: args.actorUserId,
    action: "publisher.org.ensure",
    targetType: "publisher",
    targetId: publisherId,
    metadata: {
      handle,
      trusted: args.trusted === true,
    },
    createdAt: now,
  });
  const member = await ensureMember(publisherId);
  return {
    ok: true as const,
    publisherId,
    handle,
    created: true,
    migrated: false,
    trusted: args.trusted ?? false,
    ...(member ? { member } : {}),
  };
}

async function ensureOrgPublisherMemberWithActor(
  ctx: Pick<MutationCtx, "db">,
  args: {
    actorUserId: Id<"users">;
    publisherId: Id<"publishers">;
    memberHandle?: string;
    memberRole?: "owner" | "admin" | "publisher";
    now: number;
  },
) {
  const memberHandle = normalizePublisherHandle(args.memberHandle);
  if (!memberHandle) return null;
  const requestedRole = args.memberRole ?? "owner";
  const targetUser = await getActiveUserByHandleOrPersonalPublisher(ctx, memberHandle);
  if (!targetUser) throw new ConvexError(`User "@${memberHandle}" not found`);
  await ensurePersonalPublisherForUser(ctx, targetUser, {
    actorUserId: args.actorUserId,
    source: "publisher.org.ensure.member",
  });
  const existing = await getPublisherMembership(ctx, args.publisherId, targetUser._id);
  const role =
    existing?.role === "owner" && requestedRole !== "owner" ? existing.role : requestedRole;
  if (existing) {
    if (existing.role !== role) {
      await ctx.db.patch(existing._id, { role, updatedAt: args.now });
    }
  } else {
    await ctx.db.insert("publisherMembers", {
      publisherId: args.publisherId,
      userId: targetUser._id,
      role,
      createdAt: args.now,
      updatedAt: args.now,
    });
  }
  await ctx.db.insert("auditLogs", {
    actorUserId: args.actorUserId,
    action: "publisher.member.upsert",
    targetType: "publisher",
    targetId: args.publisherId,
    metadata: {
      memberUserId: targetUser._id,
      memberHandle: targetUser.handle ?? memberHandle,
      role,
      source: "publisher.org.ensure",
    },
    createdAt: args.now,
  });
  return {
    userId: targetUser._id,
    handle: targetUser.handle ?? memberHandle,
    role,
  };
}

function normalizeGitHubProviderAccountId(providerAccountId: string) {
  const normalized = providerAccountId.trim();
  if (!/^\d+$/.test(normalized)) {
    throw new ConvexError("GitHub provider account id must be numeric");
  }
  return normalized;
}

async function getUniqueUserForGitHubProviderAccountId(
  ctx: Pick<MutationCtx, "db">,
  providerAccountId: string,
) {
  const accounts = await ctx.db
    .query("authAccounts")
    .withIndex("providerAndAccountId", (q) =>
      q.eq("provider", "github").eq("providerAccountId", providerAccountId),
    )
    .take(GITHUB_AUTH_ACCOUNT_RECOVERY_MATCH_LIMIT + 1);
  if (accounts.length === 0) {
    throw new ConvexError(`No GitHub auth account found for provider id ${providerAccountId}`);
  }
  if (accounts.length > GITHUB_AUTH_ACCOUNT_RECOVERY_MATCH_LIMIT) {
    throw new ConvexError(
      `Too many GitHub auth accounts match provider id ${providerAccountId}; manual reconciliation required`,
    );
  }

  const userId = accounts[0]?.userId;
  if (!userId || accounts.some((account) => account.userId !== userId)) {
    throw new ConvexError(
      `GitHub provider id ${providerAccountId} maps to multiple ClawHub users; manual reconciliation required`,
    );
  }

  return {
    userId,
    accountCount: accounts.length,
  };
}

async function getPublisherResourceCounts(
  ctx: Pick<MutationCtx, "db">,
  publisherId: Id<"publishers">,
) {
  const [skills, packages, githubSources] = await Promise.all([
    ctx.db
      .query("skills")
      .withIndex("by_owner_publisher", (q) => q.eq("ownerPublisherId", publisherId))
      .take(1),
    ctx.db
      .query("packages")
      .withIndex("by_owner_publisher", (q) => q.eq("ownerPublisherId", publisherId))
      .take(1),
    ctx.db
      .query("githubSkillSources")
      .withIndex("by_owner_publisher", (q) => q.eq("ownerPublisherId", publisherId))
      .take(1),
  ]);
  return {
    skills: skills.length,
    packages: packages.length,
    githubSources: githubSources.length,
    total: skills.length + packages.length + githubSources.length,
  };
}

async function getRecoveryPersonalPublisherForUser(
  ctx: Pick<MutationCtx, "db">,
  user: Doc<"users">,
) {
  if (user.personalPublisherId) {
    const publisher = await ctx.db.get(user.personalPublisherId);
    if (publisher) return publisher;
  }
  return await getPersonalPublisherForUser(ctx, user._id);
}

function getUnexpectedRecoveryOwnerRows(
  table: "skills" | "skillSlugAliases" | "packages" | "packageInspectorWarnings",
  rows: Array<{ _id: string; ownerUserId: Id<"users"> }>,
  previousUserId: Id<"users">,
  nextUserId: Id<"users">,
) {
  return rows
    .filter((row) => row.ownerUserId !== previousUserId && row.ownerUserId !== nextUserId)
    .map((row) => ({ table, id: row._id, ownerUserId: row.ownerUserId }));
}

async function getPersonalPublisherRecoveryOwnerMigrationPlan(
  ctx: MutationCtx,
  publisherId: Id<"publishers">,
  publisherHandle: string,
  previousUserId: Id<"users">,
  nextUserId: Id<"users">,
) {
  const limit = PERSONAL_PUBLISHER_RECOVERY_OWNER_MIGRATION_LIMIT;
  const takeLimit = limit + 1;
  const [skills, skillSlugAliases, packages, packageInspectorWarnings, githubSources] =
    await Promise.all([
      ctx.db
        .query("skills")
        .withIndex("by_owner_publisher", (q) => q.eq("ownerPublisherId", publisherId))
        .take(takeLimit),
      ctx.db
        .query("skillSlugAliases")
        .withIndex("by_owner_publisher", (q) => q.eq("ownerPublisherId", publisherId))
        .take(takeLimit),
      ctx.db
        .query("packages")
        .withIndex("by_owner_publisher", (q) => q.eq("ownerPublisherId", publisherId))
        .take(takeLimit),
      ctx.db
        .query("packageInspectorWarnings")
        .withIndex("by_owner_publisher_created", (q) => q.eq("ownerPublisherId", publisherId))
        .take(takeLimit),
      ctx.db
        .query("githubSkillSources")
        .withIndex("by_owner_publisher", (q) => q.eq("ownerPublisherId", publisherId))
        .take(takeLimit),
    ]);
  const activeHandleReservation = await getLatestActiveReservedHandle(ctx, publisherHandle);
  const overflowTables = [
    skills.length > limit ? "skills" : null,
    skillSlugAliases.length > limit ? "skillSlugAliases" : null,
    packages.length > limit ? "packages" : null,
    packageInspectorWarnings.length > limit ? "packageInspectorWarnings" : null,
    githubSources.length > limit ? "githubSkillSources" : null,
  ].filter((table): table is string => table !== null);
  if (overflowTables.length > 0) {
    throw new ConvexError(
      `Publisher has more than ${limit} rows in ${overflowTables.join(", ")}; use a resumable owner migration before recovery`,
    );
  }

  const unexpectedOwnerRows = [
    ...getUnexpectedRecoveryOwnerRows("skills", skills, previousUserId, nextUserId),
    ...getUnexpectedRecoveryOwnerRows(
      "skillSlugAliases",
      skillSlugAliases,
      previousUserId,
      nextUserId,
    ),
    ...getUnexpectedRecoveryOwnerRows("packages", packages, previousUserId, nextUserId),
    ...getUnexpectedRecoveryOwnerRows(
      "packageInspectorWarnings",
      packageInspectorWarnings,
      previousUserId,
      nextUserId,
    ),
  ];
  if (unexpectedOwnerRows.length > 0) {
    const first = unexpectedOwnerRows[0];
    throw new ConvexError(
      `Publisher resource ${first.table}:${first.id} belongs to another user; manual reconciliation required`,
    );
  }
  if (
    activeHandleReservation &&
    activeHandleReservation.rightfulOwnerUserId !== previousUserId &&
    activeHandleReservation.rightfulOwnerUserId !== nextUserId
  ) {
    throw new ConvexError(
      `Handle reservation ${activeHandleReservation._id} belongs to another user; manual reconciliation required`,
    );
  }

  return {
    limitPerTable: limit,
    skills: skills.filter((row) => row.ownerUserId === previousUserId),
    skillSlugAliases: skillSlugAliases.filter((row) => row.ownerUserId === previousUserId),
    packages: packages.filter((row) => row.ownerUserId === previousUserId),
    packageInspectorWarnings: packageInspectorWarnings.filter(
      (row) => row.ownerUserId === previousUserId,
    ),
    githubSources,
    activeHandleReservation:
      activeHandleReservation?.rightfulOwnerUserId === previousUserId
        ? activeHandleReservation
        : null,
  };
}

async function applyPersonalPublisherRecoveryOwnerMigration(
  ctx: Pick<MutationCtx, "db">,
  plan: Awaited<ReturnType<typeof getPersonalPublisherRecoveryOwnerMigrationPlan>>,
  nextUserId: Id<"users">,
  now: number,
) {
  for (const skill of plan.skills) {
    const previousSkill = { ...skill };
    const nextSkill = { ...skill, ownerUserId: nextUserId, updatedAt: now };
    await ctx.db.patch(skill._id, { ownerUserId: nextUserId, updatedAt: now });
    await adjustUserSkillStatsForSkillChange(ctx, previousSkill, nextSkill);
    await syncSkillSearchDigestForSkill(ctx, nextSkill);
  }
  for (const alias of plan.skillSlugAliases) {
    await ctx.db.patch(alias._id, { ownerUserId: nextUserId, updatedAt: now });
  }
  for (const pkg of plan.packages) {
    const nextPackage = { ...pkg, ownerUserId: nextUserId, updatedAt: now };
    await ctx.db.patch(pkg._id, { ownerUserId: nextUserId, updatedAt: now });
    const owner = await getOwnerPublisher(ctx, {
      ownerPublisherId: nextPackage.ownerPublisherId,
      ownerUserId: nextPackage.ownerUserId,
    });
    await upsertPackageSearchDigest(ctx, {
      ...extractPackageDigestFields(nextPackage),
      ownerHandle: owner?.handle ?? "",
      ownerKind: owner?.kind,
    });
  }
  for (const warning of plan.packageInspectorWarnings) {
    await ctx.db.patch(warning._id, { ownerUserId: nextUserId });
  }
  if (plan.activeHandleReservation) {
    await ctx.db.patch(plan.activeHandleReservation._id, {
      rightfulOwnerUserId: nextUserId,
      updatedAt: now,
    });
  }
}

export const recoverPersonalPublisherInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    publisherHandle: v.string(),
    previousGitHubProviderAccountId: v.string(),
    nextGitHubProviderAccountId: v.string(),
    nextUserHandle: v.optional(v.string()),
    retiredUserHandle: v.optional(v.string()),
    reason: v.string(),
    confirmIdentityVerified: v.boolean(),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    if (!actor || actor.deletedAt || actor.deactivatedAt) throw new ConvexError("Unauthorized");
    assertAdmin(actor);

    const publisherHandle = validateHandle(args.publisherHandle);
    const previousGitHubProviderAccountId = normalizeGitHubProviderAccountId(
      args.previousGitHubProviderAccountId,
    );
    const nextGitHubProviderAccountId = normalizeGitHubProviderAccountId(
      args.nextGitHubProviderAccountId,
    );
    if (previousGitHubProviderAccountId === nextGitHubProviderAccountId) {
      throw new ConvexError("Previous and next GitHub provider ids must differ");
    }

    const reason = args.reason.trim();
    if (!reason) throw new ConvexError("Reason required");
    if (reason.length > 500) throw new ConvexError("Reason too long (max 500 chars)");

    const dryRun = args.dryRun !== false;
    if (!dryRun && !args.confirmIdentityVerified) {
      throw new ConvexError("Identity verification confirmation required before applying recovery");
    }

    const publisher = await getPublisherByHandle(ctx, publisherHandle);
    if (!publisher || publisher.deletedAt || publisher.deactivatedAt) {
      throw new ConvexError(`Publisher "@${publisherHandle}" not found`);
    }
    if (publisher.kind !== "user") {
      throw new ConvexError("Only personal publishers can be recovered through this operation");
    }

    const previousLookup = await getUniqueUserForGitHubProviderAccountId(
      ctx,
      previousGitHubProviderAccountId,
    );
    const nextLookup = await getUniqueUserForGitHubProviderAccountId(
      ctx,
      nextGitHubProviderAccountId,
    );
    if (previousLookup.userId === nextLookup.userId) {
      throw new ConvexError("Previous and next GitHub provider ids resolve to the same user");
    }

    const previousUser = await ctx.db.get(previousLookup.userId);
    const nextUser = await ctx.db.get(nextLookup.userId);
    if (!previousUser || previousUser.deletedAt || previousUser.deactivatedAt) {
      throw new ConvexError("Previous user must exist and be active before publisher recovery");
    }
    if (!nextUser || nextUser.deletedAt || nextUser.deactivatedAt) {
      throw new ConvexError("Next user must exist and be active before publisher recovery");
    }

    const expectedNextHandle = normalizePublisherHandle(args.nextUserHandle);
    if (expectedNextHandle && !publisherHandlesMatch(nextUser.handle, expectedNextHandle)) {
      throw new ConvexError(`Next GitHub provider id does not belong to @${expectedNextHandle}`);
    }

    const publisherOwnedByPrevious = publisher.linkedUserId
      ? publisher.linkedUserId === previousUser._id
      : previousUser.personalPublisherId === publisher._id;
    if (!publisherOwnedByPrevious) {
      throw new ConvexError(
        `Publisher "@${publisherHandle}" is not currently linked to the previous GitHub principal`,
      );
    }

    const userAtRecoveredHandle = await getUserByHandle(ctx, publisher.handle);
    if (
      userAtRecoveredHandle &&
      userAtRecoveredHandle._id !== previousUser._id &&
      userAtRecoveredHandle._id !== nextUser._id
    ) {
      throw new ConvexError(`User handle "@${publisher.handle}" is claimed by another user`);
    }

    const nextPersonalPublisher = await getRecoveryPersonalPublisherForUser(ctx, nextUser);
    const retiredPersonalPublisher =
      nextPersonalPublisher &&
      nextPersonalPublisher._id !== publisher._id &&
      isPublisherActive(nextPersonalPublisher)
        ? nextPersonalPublisher
        : null;
    const retiredPersonalPublisherCounts = retiredPersonalPublisher
      ? await getPublisherResourceCounts(ctx, retiredPersonalPublisher._id)
      : null;
    if (retiredPersonalPublisherCounts && retiredPersonalPublisherCounts.total > 0) {
      throw new ConvexError(
        `Destination user has resources under @${retiredPersonalPublisher?.handle}; transfer or remove them before recovery`,
      );
    }
    const resourceOwnerMigrationPlan = await getPersonalPublisherRecoveryOwnerMigrationPlan(
      ctx,
      publisher._id,
      publisher.handle,
      previousUser._id,
      nextUser._id,
    );
    const resourceOwnerMigration = {
      limitPerTable: resourceOwnerMigrationPlan.limitPerTable,
      skills: resourceOwnerMigrationPlan.skills.length,
      skillSlugAliases: resourceOwnerMigrationPlan.skillSlugAliases.length,
      packages: resourceOwnerMigrationPlan.packages.length,
      packageInspectorWarnings: resourceOwnerMigrationPlan.packageInspectorWarnings.length,
      githubSourcesChecked: resourceOwnerMigrationPlan.githubSources.length,
      handleReservations: resourceOwnerMigrationPlan.activeHandleReservation ? 1 : 0,
    };

    const retiredHandleBase =
      normalizePublisherHandle(args.retiredUserHandle) ?? `${publisher.handle}-recovered`;
    const previousUserHasRecoveredHandle = publisherHandlesMatch(
      previousUser.handle,
      publisher.handle,
    );
    const previousUserRetiredHandle = previousUserHasRecoveredHandle
      ? await resolveAvailableUserHandle(ctx, retiredHandleBase, previousUser._id)
      : undefined;
    const nextPreviousUserHandle = previousUserHasRecoveredHandle
      ? previousUserRetiredHandle
      : (previousUser.handle ?? null);
    const previousUserNeedsPatch =
      previousUser.personalPublisherId === publisher._id || previousUserHasRecoveredHandle;
    const nextUserPreviousHandle = nextUser.handle ?? null;

    if (!dryRun) {
      const now = Date.now();
      if (retiredPersonalPublisher) {
        await ctx.db.patch(retiredPersonalPublisher._id, {
          linkedUserId: undefined,
          deactivatedAt: retiredPersonalPublisher.deactivatedAt ?? now,
          updatedAt: now,
        });
      }

      if (previousUserNeedsPatch) {
        await ctx.db.patch(previousUser._id, {
          ...(previousUserRetiredHandle ? { handle: previousUserRetiredHandle } : {}),
          ...(previousUser.personalPublisherId === publisher._id
            ? { personalPublisherId: undefined }
            : {}),
          updatedAt: now,
        });
      }

      await ctx.db.patch(nextUser._id, {
        handle: publisher.handle,
        personalPublisherId: publisher._id,
        updatedAt: now,
      });
      await ctx.db.patch(publisher._id, {
        linkedUserId: nextUser._id,
        updatedAt: now,
      });
      await applyPersonalPublisherRecoveryOwnerMigration(
        ctx,
        resourceOwnerMigrationPlan,
        nextUser._id,
        now,
      );

      const members = await ctx.db
        .query("publisherMembers")
        .withIndex("by_publisher", (q) => q.eq("publisherId", publisher._id))
        .take(101);
      if (members.length > 100) {
        throw new ConvexError(
          "Too many personal publisher members; manual reconciliation required",
        );
      }

      let ensuredNextOwner = false;
      for (const member of members) {
        if (member.userId === nextUser._id) {
          ensuredNextOwner = true;
          if (member.role !== "owner") {
            await ctx.db.patch(member._id, { role: "owner", updatedAt: now });
          }
        } else {
          await ctx.db.delete(member._id);
        }
      }
      if (!ensuredNextOwner) {
        await ctx.db.insert("publisherMembers", {
          publisherId: publisher._id,
          userId: nextUser._id,
          role: "owner",
          createdAt: now,
          updatedAt: now,
        });
      }

      await ctx.db.insert("auditLogs", {
        actorUserId: actor._id,
        action: "publisher.personal.recover",
        targetType: "publisher",
        targetId: publisher._id,
        metadata: {
          handle: publisher.handle,
          previousUserId: previousUser._id,
          nextUserId: nextUser._id,
          previousGitHubProviderAccountId,
          nextGitHubProviderAccountId,
          reason,
          identityVerified: args.confirmIdentityVerified,
          previousUserPreviousHandle: previousUser.handle ?? null,
          previousUserNextHandle: nextPreviousUserHandle,
          nextUserPreviousHandle,
          nextUserNextHandle: publisher.handle,
          resourceOwnerMigration,
          retiredPersonalPublisher: retiredPersonalPublisher
            ? {
                publisherId: retiredPersonalPublisher._id,
                handle: retiredPersonalPublisher.handle,
              }
            : null,
        },
        createdAt: now,
      });
    }

    return {
      ok: true as const,
      dryRun,
      recovered: !dryRun,
      publisherId: publisher._id,
      handle: publisher.handle,
      previousUser: {
        userId: previousUser._id,
        handle: previousUser.handle ?? null,
        nextHandle: nextPreviousUserHandle,
        githubProviderAccountId: previousGitHubProviderAccountId,
        authAccountCount: previousLookup.accountCount,
      },
      nextUser: {
        userId: nextUser._id,
        handle: nextUser.handle ?? null,
        nextHandle: publisher.handle,
        githubProviderAccountId: nextGitHubProviderAccountId,
        authAccountCount: nextLookup.accountCount,
      },
      retiredPersonalPublisher: retiredPersonalPublisher
        ? {
            publisherId: retiredPersonalPublisher._id,
            handle: retiredPersonalPublisher.handle,
            skills: retiredPersonalPublisherCounts?.skills ?? 0,
            packages: retiredPersonalPublisherCounts?.packages ?? 0,
            githubSources: retiredPersonalPublisherCounts?.githubSources ?? 0,
          }
        : null,
      resourceOwnerMigration,
      identityVerified: args.confirmIdentityVerified,
      reason,
    };
  },
});

async function createOrgPublisherForUser(
  ctx: MutationCtx,
  args: {
    actorUserId: Id<"users">;
    handle: string;
    displayName?: string;
    bio?: string;
  },
) {
  const actor = await ctx.db.get(args.actorUserId);
  if (!actor || actor.deletedAt || actor.deactivatedAt) throw new ConvexError("Unauthorized");

  const handle = validateHandle(args.handle);
  const existingPublisher = await getPublisherByHandle(ctx, handle);
  if (existingPublisher) {
    if (existingPublisher.kind === "user") {
      throw new ConvexError(`Handle "@${handle}" is already used by a user or personal publisher`);
    }
    throw new ConvexError(`Publisher "@${handle}" already exists`);
  }
  const existingUser = await getUserByHandle(ctx, handle);
  if (existingUser) {
    throw new ConvexError(`Handle "@${handle}" is already used by a user or personal publisher`);
  }
  if (await isHandleReservedForAnotherUser(ctx, handle, args.actorUserId)) {
    throw new ConvexError(`Handle "@${handle}" is reserved for another user`);
  }
  if (isReservedOpenClawExtensionHandle(handle)) {
    throw new ConvexError(formatReservedPublicOwnerHandleMessage(handle));
  }

  const now = Date.now();
  const publisherId = await ctx.db.insert("publishers", {
    kind: "org",
    handle,
    displayName: args.displayName?.trim() || handle,
    bio: args.bio?.trim() || undefined,
    image: undefined,
    linkedUserId: undefined,
    trustedPublisher: undefined,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.insert("publisherMembers", {
    publisherId,
    userId: args.actorUserId,
    role: "owner",
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.insert("auditLogs", {
    actorUserId: args.actorUserId,
    action: "publisher.org.create",
    targetType: "publisher",
    targetId: publisherId,
    metadata: { handle },
    createdAt: now,
  });

  return {
    ok: true as const,
    publisherId,
    handle,
    created: true as const,
    trusted: false as const,
  };
}

async function inspectPublisherHardDeleteRows(ctx: MutationCtx, publisherId: Id<"publishers">) {
  const sources = await ctx.db
    .query("githubSkillSources")
    .withIndex("by_owner_publisher", (q) => q.eq("ownerPublisherId", publisherId))
    .collect();
  let sourceContents = 0;
  for (const source of sources) {
    const contents = await ctx.db
      .query("githubSkillContents")
      .withIndex("by_github_source", (q) => q.eq("githubSourceId", source._id))
      .collect();
    sourceContents += contents.length;
  }

  const members = await ctx.db
    .query("publisherMembers")
    .withIndex("by_publisher", (q) => q.eq("publisherId", publisherId))
    .collect();

  const official = await ctx.db
    .query("officialPublishers")
    .withIndex("by_publisher", (q) => q.eq("publisherId", publisherId))
    .unique();

  return { sources, sourceContents, members, official };
}

async function hardDeletePublisherRows(ctx: MutationCtx, publisherId: Id<"publishers">) {
  const preview = await inspectPublisherHardDeleteRows(ctx, publisherId);

  for (const source of preview.sources) {
    const contents = await ctx.db
      .query("githubSkillContents")
      .withIndex("by_github_source", (q) => q.eq("githubSourceId", source._id))
      .collect();
    for (const content of contents) await ctx.db.delete(content._id);
    await ctx.scheduler.runAfter(0, internal.githubSkillSources.cleanupDeletedSourceScansInternal, {
      sourceId: source._id,
    });
    await ctx.db.delete(source._id);
  }

  for (const member of preview.members) await ctx.db.delete(member._id);

  if (preview.official) await ctx.db.delete(preview.official._id);

  await ctx.db.delete(publisherId);

  return {
    sources: preview.sources.length,
    sourceContents: preview.sourceContents,
    members: preview.members.length,
    official: Boolean(preview.official),
  };
}

async function deleteOrgPublisherForOwner(
  ctx: MutationCtx,
  args: {
    actorUserId: Id<"users">;
    publisherId: Id<"publishers">;
    deletedAt: number;
    source: "settings" | "account.delete";
  },
) {
  const actor = await ctx.db.get(args.actorUserId);
  if (!actor || actor.deletedAt || actor.deactivatedAt) throw new ConvexError("Unauthorized");

  const publisher = await ctx.db.get(args.publisherId);
  if (!publisher || publisher.kind !== "org" || publisher.deletedAt || publisher.deactivatedAt) {
    throw new ConvexError("Publisher not found");
  }

  const membership = await getPublisherMembership(ctx, publisher._id, args.actorUserId);
  if (!membership || membership.role !== "owner") {
    throw new ConvexError("Only org owners can delete an organization");
  }

  await ctx.db.patch(publisher._id, {
    deletedAt: args.deletedAt,
    deactivatedAt: args.deletedAt,
    updatedAt: args.deletedAt,
  });

  const skillsResult = (await ctx.runMutation(
    internal.skills.applyPublisherDeletionToOwnedSkillsBatchInternal,
    {
      ownerPublisherId: publisher._id,
      actorUserId: args.actorUserId,
      deletedAt: args.deletedAt,
      cursor: undefined,
    },
  )) as { hiddenCount?: number; scheduled?: boolean };
  const packagesResult = (await ctx.runMutation(
    internal.packages.applyPublisherDeletionToOwnedPackagesBatchInternal,
    {
      ownerPublisherId: publisher._id,
      actorUserId: args.actorUserId,
      deletedAt: args.deletedAt,
      cursor: undefined,
    },
  )) as { deletedCount?: number; revokedTokenCount?: number; scheduled?: boolean };

  await ctx.db.insert("auditLogs", {
    actorUserId: args.actorUserId,
    action: "publisher.org.delete",
    targetType: "publisher",
    targetId: publisher._id,
    metadata: {
      handle: publisher.handle,
      source: args.source,
      hiddenSkills: skillsResult.hiddenCount ?? 0,
      deletedPackages: packagesResult.deletedCount ?? 0,
      revokedPackageTokens: packagesResult.revokedTokenCount ?? 0,
      scheduled: Boolean(skillsResult.scheduled) || Boolean(packagesResult.scheduled) || undefined,
    },
    createdAt: args.deletedAt,
  });
  const deletedPublisherRows = await hardDeletePublisherRows(ctx, publisher._id);

  return {
    ok: true as const,
    publisherId: publisher._id,
    handle: publisher.handle,
    hiddenSkills: skillsResult.hiddenCount ?? 0,
    deletedPackages: packagesResult.deletedCount ?? 0,
    revokedPackageTokens: packagesResult.revokedTokenCount ?? 0,
    scheduled: Boolean(skillsResult.scheduled) || Boolean(packagesResult.scheduled),
    deletedPublisherRows,
  };
}

export const getByIdInternal = internalQuery({
  args: { publisherId: v.id("publishers") },
  handler: async (ctx, args) => await ctx.db.get(args.publisherId),
});

export const getByHandleInternal = internalQuery({
  args: { handle: v.string() },
  handler: async (ctx, args) => await getPublisherByHandle(ctx, args.handle),
});

export const getMemberRoleInternal = internalQuery({
  args: {
    publisherId: v.id("publishers"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) =>
    (await getPublisherMembership(ctx, args.publisherId, args.userId))?.role ?? null,
});

export const canAccessOwnerScopeInternal = internalQuery({
  args: {
    publisherId: v.id("publishers"),
    userId: v.id("users"),
    allowedPublisherRoles: v.optional(v.array(publisherRoleValidator)),
    legacyOwnerUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const publisher = await ctx.db.get(args.publisherId);
    return await canAccessPublisherOwnerScope(ctx, {
      publisher,
      userId: args.userId,
      allowedPublisherRoles: args.allowedPublisherRoles,
      legacyOwnerUserId: args.legacyOwnerUserId,
    });
  },
});

export const ensurePersonalPublisherInternal = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user || user.deletedAt || user.deactivatedAt) return null;
    return await ensurePersonalPublisherForUser(ctx, user, {
      actorUserId: user._id,
      source: "publisher.ensure_personal_internal",
    });
  },
});

export const resolvePublishTargetForUserInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    ownerHandle: v.optional(v.string()),
    minimumRole: v.optional(
      v.union(v.literal("owner"), v.literal("admin"), v.literal("publisher")),
    ),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    if (!actor || actor.deletedAt || actor.deactivatedAt) throw new ConvexError("Unauthorized");
    const minimumRole = args.minimumRole ?? "publisher";
    const requestedHandle = normalizePublisherHandle(args.ownerHandle);
    const personal = await ensurePersonalPublisherForUser(ctx, actor, {
      actorUserId: actor._id,
      source: "publisher.resolve_target",
    });
    if (!personal) throw new ConvexError("Personal publisher not found");
    if (!requestedHandle) {
      return {
        publisherId: personal._id,
        handle: personal.handle,
        kind: personal.kind,
        linkedUserId: personal.linkedUserId,
      };
    }

    if (personal && requestedHandle === personal.handle) {
      return {
        publisherId: personal._id,
        handle: personal.handle,
        kind: personal.kind,
        linkedUserId: personal.linkedUserId,
      };
    }

    const publisher = await getPublisherByHandle(ctx, requestedHandle);
    if (!publisher || publisher.deletedAt || publisher.deactivatedAt) {
      throw new ConvexError(
        `Publisher "@${requestedHandle}" not found. Create the "@${requestedHandle}" organization on ClawHub or choose a different owner.`,
      );
    }
    if (publisher.kind === "user") {
      if (publisher.linkedUserId !== actor._id) {
        throw new ConvexError(
          `You do not have publish access for "@${requestedHandle}". Ask an owner or admin of "@${requestedHandle}" to add you.`,
        );
      }
      return {
        publisherId: publisher._id,
        handle: publisher.handle,
        kind: publisher.kind,
        linkedUserId: publisher.linkedUserId,
      };
    }
    const membership = await getPublisherMembership(ctx, publisher._id, actor._id);
    if (!membership || !isPublisherRoleAllowed(membership.role, [minimumRole])) {
      throw new ConvexError(
        `You do not have publish access for "@${requestedHandle}". Ask an owner or admin of "@${requestedHandle}" to add you.`,
      );
    }
    return {
      publisherId: publisher._id,
      handle: publisher.handle,
      kind: publisher.kind,
      linkedUserId: publisher.linkedUserId,
    };
  },
});

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getOptionalActiveAuthUserId(ctx);
    if (!userId) return [];
    const user = await ctx.db.get(userId);
    if (!user || user.deletedAt || user.deactivatedAt) return [];
    const memberships = await ctx.db
      .query("publisherMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const publishers = await Promise.all(
      memberships.map(async (membership) => {
        const publisher = await ctx.db.get(membership.publisherId);
        if (publisher?.kind === "user") {
          const isLinkedPersonal = publisher.linkedUserId === userId;
          const isLegacyPersonal =
            !publisher.linkedUserId && user.personalPublisherId === publisher._id;
          if (!isLinkedPersonal && !isLegacyPersonal) return null;
        }
        const publicPublisher = publisher
          ? await toPublisherListItem(ctx, publisher, {
              includePublishedItems: true,
              includeAllPublishedItems: true,
            })
          : null;
        if (!publicPublisher) return null;
        return {
          publisher: {
            ...publicPublisher,
            imageStorageId: publisher?.imageStorageId,
          },
          role: publisher?.kind === "user" ? "owner" : membership.role,
        };
      }),
    );
    const visiblePublishers = publishers.filter(
      (item): item is NonNullable<(typeof publishers)[number]> => Boolean(item),
    );
    const personalPublisherDoc = await getPersonalPublisherForUserOrFallback(ctx, user);
    const personalPublisher = personalPublisherDoc
      ? await toPublisherListItem(ctx, personalPublisherDoc, {
          includePublishedItems: true,
          includeAllPublishedItems: true,
        })
      : null;
    if (
      personalPublisher &&
      !visiblePublishers.some((entry) => entry.publisher._id === personalPublisher._id)
    ) {
      visiblePublishers.unshift({
        publisher: {
          ...personalPublisher,
          imageStorageId: personalPublisherDoc?.imageStorageId,
        },
        role: "owner",
      });
    }
    return visiblePublishers;
  },
});

export const getMyProfileHandle = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getOptionalActiveAuthUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    if (!user || user.deletedAt || user.deactivatedAt) return null;

    const getVisiblePersonalPublisher = async (
      publisher: Doc<"publishers"> | null,
    ): Promise<Doc<"publishers"> | null> => {
      const isPersonalPublisher =
        publisher?.kind === "user" &&
        (publisher.linkedUserId === userId ||
          (!publisher.linkedUserId && user.personalPublisherId === publisher._id));
      if (!isPersonalPublisher) return null;

      const visible = await getPublicPublisherVisibility(ctx, publisher);
      return visible?.linkedUser?._id === userId ? publisher : null;
    };

    let publisher = await getVisiblePersonalPublisher(
      user.personalPublisherId ? await ctx.db.get(user.personalPublisherId) : null,
    );
    if (!publisher) {
      publisher = await getVisiblePersonalPublisher(await getPersonalPublisherForUser(ctx, userId));
    }
    return publisher?.handle ?? null;
  },
});

export const getByHandle = query({
  args: { handle: v.string() },
  handler: async (ctx, args) =>
    await toPublicPublisherWithLinkedImage(ctx, await getPublisherByHandle(ctx, args.handle)),
});

export const getProfileByHandle = query({
  args: { handle: v.string() },
  handler: async (ctx, args) => {
    const publisher = await getPublisherByHandle(ctx, args.handle);
    if (!publisher || publisher.deletedAt || publisher.deactivatedAt) return null;
    return await toPublisherListItem(ctx, publisher, {
      forceComputedStats: true,
      includeAffiliations: true,
      includePublishedItems: true,
      includeStarredCount: true,
    });
  },
});

export const listStarredPage = query({
  args: {
    handle: v.string(),
    sort: v.optional(v.union(v.literal("installs"), v.literal("recent"), v.literal("downloads"))),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const publisher = await getPublisherByHandle(ctx, args.handle);
    const visible = await getPublicPublisherVisibility(ctx, publisher);
    if (!visible?.linkedUser || visible.publisher.kind !== "user") {
      return { page: [], continueCursor: "", isDone: true };
    }

    const linkedUserId = visible.linkedUser._id;
    const numItems = clampInt(args.paginationOpts.numItems, 1, 24);
    const offset = args.paginationOpts.cursor ? Number(args.paginationOpts.cursor) : 0;
    const safeOffset = Number.isFinite(offset) && offset > 0 ? Math.trunc(offset) : 0;
    const starRows = await ctx.db
      .query("stars")
      .withIndex("by_user", (q) => q.eq("userId", linkedUserId))
      .order("desc")
      .collect();

    const items = (
      await Promise.all(
        starRows.map(async (star): Promise<PublisherCatalogItem | null> => {
          const skill = await ctx.db.get(star.skillId);
          if (!skill || skill.softDeletedAt) return null;
          const ownerPublisher = skill.ownerPublisherId
            ? await ctx.db.get(skill.ownerPublisherId)
            : null;
          const ownerHandle =
            ownerPublisher && !ownerPublisher.deletedAt && !ownerPublisher.deactivatedAt
              ? ownerPublisher.handle
              : String(skill.ownerUserId);
          const official = await isOfficialPublisher(ctx, ownerPublisher);
          return {
            _id: skill._id,
            kind: "skill" as const,
            displayName: skill.displayName,
            summary: skill.summary ?? null,
            categories: skill.categories,
            inferredCategories: skill.inferredCategories,
            latestVersionId: skill.latestVersionId,
            inferredFromVersionId: skill.inferredFromVersionId,
            icon: skill.icon ?? null,
            href: `/${encodeURIComponent(ownerHandle)}/${encodeURIComponent(skill.slug)}`,
            installs: readCanonicalStat(skill, "installsAllTime"),
            downloads: readCanonicalStat(skill, "downloads"),
            stars: readCanonicalStat(skill, "stars"),
            isOfficial: official || Boolean(skill.badges?.official),
            updatedAt: skill.updatedAt,
          };
        }),
      )
    )
      .filter((item): item is PublisherCatalogItem => Boolean(item))
      .sort(comparePublisherCatalogItems(normalizePublisherCatalogSort(args.sort)));
    const nextOffset = safeOffset + numItems;
    const page = items.slice(safeOffset, nextOffset);

    return {
      page,
      continueCursor: nextOffset < items.length ? String(nextOffset) : "",
      isDone: nextOffset >= items.length,
    };
  },
});

export const listPublishedPage = query({
  args: {
    handle: v.string(),
    kind: v.optional(v.union(v.literal("skill"), v.literal("plugin"))),
    sort: v.optional(v.union(v.literal("installs"), v.literal("recent"), v.literal("downloads"))),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const publisher = await getPublisherByHandle(ctx, args.handle);
    const visible = await getPublicPublisherVisibility(ctx, publisher);
    if (!visible) {
      return { page: [], continueCursor: "", isDone: true };
    }
    const visiblePublisher = visible.publisher;

    const numItems = clampInt(args.paginationOpts.numItems, 1, 24);
    const offset = args.paginationOpts.cursor ? Number(args.paginationOpts.cursor) : 0;
    const safeOffset = Number.isFinite(offset) && offset > 0 ? Math.trunc(offset) : 0;
    const items = getPublisherCatalogItems(
      visiblePublisher,
      await getPublisherPublishedRows(ctx, visiblePublisher._id),
      await isOfficialPublisher(ctx, visiblePublisher),
      normalizePublisherCatalogSort(args.sort),
    ).filter((item) => !args.kind || item.kind === args.kind);
    const nextOffset = safeOffset + numItems;
    const page = items.slice(safeOffset, nextOffset);

    return {
      page,
      continueCursor: nextOffset < items.length ? String(nextOffset) : "",
      isDone: nextOffset >= items.length,
    };
  },
});

export const getPublishedDisplayManifest = query({
  args: {
    handle: v.string(),
    kind: v.optional(v.union(v.literal("skill"), v.literal("plugin"))),
    sort: v.optional(v.union(v.literal("installs"), v.literal("recent"), v.literal("downloads"))),
  },
  handler: async (ctx, args): Promise<GitHubSkillCatalogDisplay | null> => {
    if (args.kind === "plugin") return null;

    const publisher = await getPublisherByHandle(ctx, args.handle);
    const visible = await getPublicPublisherVisibility(ctx, publisher);
    if (!visible) return null;
    const visiblePublisher = visible.publisher;

    const sources = await ctx.db
      .query("githubSkillSources")
      .withIndex("by_owner_publisher", (q) => q.eq("ownerPublisherId", visiblePublisher._id))
      .collect();
    if (sources.length === 0) return null;

    const rows = await getPublisherPublishedRows(ctx, visiblePublisher._id);
    if (!args.kind && rows.packages.length > 0) return null;

    const sourceById = new Map(sources.map((source) => [String(source._id), source]));
    const items = getPublisherCatalogItems(
      visiblePublisher,
      rows,
      await isOfficialPublisher(ctx, visiblePublisher),
      normalizePublisherCatalogSort(args.sort),
    )
      .filter((item) => !args.kind || item.kind === args.kind)
      .map((item) => toGitHubSkillCatalogItem(item, sourceById));

    return buildGitHubSkillCatalogDisplay({
      sources: sources.map(toGitHubSkillCatalogSource),
      items,
    });
  },
});

export const listPublic = query({
  args: {
    limit: v.optional(v.number()),
    kind: v.optional(v.union(v.literal("user"), v.literal("org"))),
  },
  handler: async (ctx, args) => {
    const limit = clampInt(
      args.limit ?? MAX_PUBLIC_PUBLISHER_LIST_LIMIT,
      1,
      MAX_PUBLIC_PUBLISHER_LIST_LIMIT,
    );
    const kindFilter = args.kind as PublicPublisherKindFilter | undefined;
    const activeRows = await ctx.db
      .query("publishers")
      .withIndex("by_active_total_downloads", (q) =>
        q.eq("deletedAt", undefined).eq("deactivatedAt", undefined),
      )
      .order("desc")
      .collect();
    const publisherItems = (
      await Promise.all(
        activeRows.map((publisher) =>
          toPublisherListItem(ctx, publisher, { includePublishedItems: true }),
        ),
      )
    )
      .filter((item): item is PublisherListItem => Boolean(item))
      .filter((item) => item.stats.skills + item.stats.packages > 0);
    const activePublishers = publisherItems.filter((publisher) => {
      if (!kindFilter) return true;
      return publisher.kind === kindFilter;
    });
    const items = activePublishers.sort(comparePublisherListItems).slice(0, limit);

    return {
      items,
      total: activePublishers.length,
      counts: {
        all: publisherItems.length,
        individuals: publisherItems.filter((publisher) => publisher.kind === "user").length,
        organizations: publisherItems.filter((publisher) => publisher.kind === "org").length,
      },
      limit,
    };
  },
});

export const listPublicPage = query({
  args: {
    kind: v.optional(v.union(v.literal("user"), v.literal("org"))),
    official: v.optional(v.boolean()),
    query: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const kindFilter = args.kind as PublicPublisherKindFilter | undefined;
    const numItems = clampInt(args.paginationOpts.numItems, 1, 50);
    const queryText = args.query?.trim();
    const offset = args.paginationOpts.cursor ? Number(args.paginationOpts.cursor) : 0;
    const safeOffset = Number.isFinite(offset) && offset > 0 ? Math.trunc(offset) : 0;
    const officialRows = args.official
      ? (
          await Promise.all(
            (
              await ctx.db
                .query("officialPublishers")
                .withIndex("by_created")
                .order("desc")
                .take(MAX_PUBLIC_PUBLISHER_LIST_LIMIT)
            ).map((row) => ctx.db.get(row.publisherId)),
          )
        ).filter((publisher): publisher is Doc<"publishers"> =>
          Boolean(publisher && !publisher.deletedAt && !publisher.deactivatedAt),
        )
      : undefined;
    const browseRows = officialRows
      ? officialRows.filter((publisher) => !kindFilter || publisher.kind === kindFilter)
      : await getActivePublisherRowsByDownloads(ctx, kindFilter);
    const activeRows = queryText
      ? await collectActivePublisherRowsForListPage(ctx, {
          kindFilter,
          queryText,
          browseRows,
        })
      : browseRows;
    const includeEmptyPublishers = Boolean(queryText);
    const publisherSummaries = await getVisiblePublisherListSummaries(ctx, activeRows, {
      includeEmptyPublishers,
    });
    const itemSummaries = publisherSummaries
      .filter(
        (summary) =>
          (!kindFilter || summary.item.kind === kindFilter) &&
          matchesPublisherQuery(summary.item, queryText?.toLowerCase() ?? ""),
      )
      .sort((a, b) => comparePublisherListItems(a.item, b.item));
    const globalPublisherSummaries = kindFilter
      ? officialRows
        ? await getVisiblePublisherListSummaries(ctx, officialRows)
        : await getVisiblePublisherListSummaries(ctx, await getActivePublisherRowsByDownloads(ctx))
      : publisherSummaries;
    const globalCounts = getPublisherListSummaryCounts(globalPublisherSummaries);
    const counts = queryText ? getPublisherListSummaryCounts(itemSummaries) : globalCounts;
    const nextOffset = safeOffset + numItems;
    const page = await hydratePublisherListSummaries(
      ctx,
      itemSummaries.slice(safeOffset, nextOffset),
      { includeEmptyPublishers },
    );

    return {
      page,
      counts,
      globalCounts,
      continueCursor: nextOffset < itemSummaries.length ? String(nextOffset) : "",
      isDone: nextOffset >= itemSummaries.length,
    };
  },
});

export const listMembers = query({
  args: { publisherHandle: v.string() },
  handler: async (ctx, args) => {
    const publisher = await getPublisherByHandle(ctx, args.publisherHandle);
    const visible = await getPublicPublisherVisibility(ctx, publisher);
    if (!visible) return null;
    const memberships = await ctx.db
      .query("publisherMembers")
      .withIndex("by_publisher", (q) => q.eq("publisherId", visible.publisher._id))
      .collect();
    const items = await Promise.all(
      memberships.map(async (membership) => {
        const user = await ctx.db.get(membership.userId);
        if (!user || user.deletedAt || user.deactivatedAt) return null;
        const memberPublisher = await getPersonalPublisherForUser(ctx, user._id);
        return {
          role: membership.role,
          user: {
            _id: user._id,
            handle: user.handle ?? null,
            displayName: user.displayName ?? user.name ?? null,
            image: user.image ?? null,
            official: await isOfficialPublisher(ctx, memberPublisher),
          },
        };
      }),
    );
    return {
      publisher: await toPublicPublisherWithOfficial(ctx, visible.publisher),
      members: items.filter(Boolean),
    };
  },
});

export const listInvitesForPublisher = query({
  args: { publisherId: v.id("publishers") },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx);
    await requireOrgMembershipManager(ctx, args.publisherId, userId);
    const now = Date.now();
    const invites = await ctx.db
      .query("publisherInvites")
      .withIndex("by_publisher_status_expires", (q) =>
        q.eq("publisherId", args.publisherId).eq("status", "pending").gte("expiresAt", now),
      )
      .take(MAX_PENDING_PUBLISHER_INVITES);
    const hydrated = await Promise.all(
      invites.map((invite) => hydratePublisherInvite(ctx, invite)),
    );
    return hydrated.filter((invite) => invite !== null);
  },
});

export const listMyInvites = query({
  args: {},
  handler: async (ctx) => {
    const { user, userId } = await requireUser(ctx);
    const now = Date.now();
    const inviteById = new Map<Id<"publisherInvites">, Doc<"publisherInvites">>();
    const targetHandles = new Set<string>();
    const userHandle = normalizePublisherHandle(user.handle);
    if (userHandle) targetHandles.add(userHandle);
    const personalPublisher = await getPersonalPublisherForUser(ctx, userId);
    const personalHandle = normalizePublisherHandle(personalPublisher?.handle);
    if (personalHandle) targetHandles.add(personalHandle);

    for (const targetHandle of targetHandles) {
      const invites = await ctx.db
        .query("publisherInvites")
        .withIndex("by_target_handle_status_expires", (q) =>
          q.eq("targetHandle", targetHandle).eq("status", "pending").gte("expiresAt", now),
        )
        .take(MAX_PENDING_PUBLISHER_INVITES);
      for (const invite of invites) inviteById.set(invite._id, invite);
    }

    const directInvites = await ctx.db
      .query("publisherInvites")
      .withIndex("by_target_user_status_expires", (q) =>
        q.eq("targetUserId", userId).eq("status", "pending").gte("expiresAt", now),
      )
      .take(MAX_PENDING_PUBLISHER_INVITES);
    for (const invite of directInvites) inviteById.set(invite._id, invite);

    const hydrated = await Promise.all(
      [...inviteById.values()].map((invite) => hydratePublisherInvite(ctx, invite)),
    );
    return hydrated
      .filter((invite) => invite !== null)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, MAX_PENDING_PUBLISHER_INVITES);
  },
});

export const createOrg = mutation({
  args: {
    handle: v.string(),
    displayName: v.string(),
    bio: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user, userId } = await requireUser(ctx);
    await ensurePersonalPublisherForUser(ctx, user, {
      actorUserId: userId,
      source: "publisher.create_org",
    });
    const result = await createOrgPublisherForUser(ctx, {
      actorUserId: userId,
      handle: args.handle,
      displayName: args.displayName,
      bio: args.bio,
    });
    return {
      publisher: await toPublicPublisherWithOfficial(ctx, await ctx.db.get(result.publisherId)),
      role: "owner" as const,
    };
  },
});

export const deleteOrg = mutation({
  args: {
    publisherId: v.id("publishers"),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx);
    return await deleteOrgPublisherForOwner(ctx, {
      actorUserId: userId,
      publisherId: args.publisherId,
      deletedAt: Date.now(),
      source: "settings",
    });
  },
});

export const createImageUpload = mutation({
  args: {
    publisherId: v.id("publishers"),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx);
    const publisher = await ctx.db.get(args.publisherId);
    if (!publisher || publisher.deletedAt || publisher.deactivatedAt) {
      throw new ConvexError("Publisher not found");
    }
    if (publisher.kind !== "org") {
      throw new ConvexError("Only org publishers can have a logo");
    }

    const membership = await getPublisherMembership(ctx, publisher._id, userId);
    if (!membership || !isPublisherRoleAllowed(membership.role, ["admin"])) {
      throw new ConvexError("Forbidden");
    }

    const now = Date.now();
    const uploadTicket = await ctx.db.insert("publisherImageUploadTickets", {
      publisherId: publisher._id,
      userId,
      createdAt: now,
      expiresAt: now + PUBLISHER_IMAGE_UPLOAD_TTL_MS,
    });
    return {
      uploadUrl: await ctx.storage.generateUploadUrl(),
      uploadTicket,
    };
  },
});

export const hardDeletePublisherRowsInternal = internalMutation({
  args: { publisherId: v.id("publishers") },
  handler: async (ctx, args) => {
    return await hardDeletePublisherRows(ctx, args.publisherId);
  },
});

export const updateProfile = mutation({
  args: {
    publisherId: v.id("publishers"),
    displayName: v.string(),
    bio: v.optional(v.string()),
    image: v.optional(v.string()),
    imageStorageId: v.optional(v.id("_storage")),
    imageUploadTicket: v.optional(v.id("publisherImageUploadTickets")),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx);
    const publisher = await ctx.db.get(args.publisherId);
    if (!publisher || publisher.deletedAt || publisher.deactivatedAt) {
      throw new ConvexError("Publisher not found");
    }
    if (publisher.kind !== "org") {
      throw new ConvexError("Only org publishers can be updated here");
    }

    const membership = await getPublisherMembership(ctx, publisher._id, userId);
    if (!membership || !isPublisherRoleAllowed(membership.role, ["admin"])) {
      throw new ConvexError("Forbidden");
    }

    const displayName = args.displayName.trim() || publisher.handle;
    const bio = args.bio?.trim() || undefined;
    const image = args.image?.trim() || undefined;
    const hasImageUpload = Boolean(args.imageUploadTicket);
    if (hasImageUpload && !args.imageStorageId) {
      throw new ConvexError("Image upload is incomplete");
    }
    if (!hasImageUpload && args.image !== undefined && image !== publisher.image) {
      throw new ConvexError("Logo changes require an uploaded image");
    }
    let imageStorageId = args.imageStorageId;
    if (
      !hasImageUpload &&
      !imageStorageId &&
      image &&
      image === publisher.image &&
      publisher.imageStorageId
    ) {
      imageStorageId = publisher.imageStorageId;
    }
    let imageUrl = image;
    if (hasImageUpload) {
      const ticket = await ctx.db.get(args.imageUploadTicket!);
      if (
        !ticket ||
        ticket.publisherId !== publisher._id ||
        ticket.userId !== userId ||
        ticket.usedAt ||
        ticket.expiresAt <= Date.now()
      ) {
        throw new ConvexError("Image upload is missing or expired");
      }
      const metadata = await ctx.db.system.get("_storage", args.imageStorageId!);
      if (
        !metadata ||
        metadata._creationTime < ticket.createdAt ||
        metadata.size > PUBLISHER_IMAGE_MAX_BYTES ||
        !metadata.contentType ||
        !PUBLISHER_IMAGE_CONTENT_TYPES.has(metadata.contentType)
      ) {
        throw new ConvexError("Logo must be a PNG, JPEG, or WebP image smaller than 2 MB");
      }
      const uploadedImageUrl = await ctx.storage.getUrl(args.imageStorageId!);
      if (!uploadedImageUrl) throw new ConvexError("Uploaded logo is no longer available");
      imageUrl = uploadedImageUrl;
      await ctx.db.patch(ticket._id, {
        usedAt: Date.now(),
        storageId: args.imageStorageId,
      });
    } else if (imageStorageId && imageStorageId !== publisher.imageStorageId) {
      throw new ConvexError("Image storage does not belong to this publisher");
    } else if (imageStorageId) {
      imageUrl = publisher.image;
    }
    if (imageUrl) {
      let parsed: URL;
      try {
        parsed = new URL(imageUrl);
      } catch {
        throw new ConvexError("Image must be a valid URL");
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new ConvexError("Image must use http or https");
      }
    }

    const now = Date.now();
    await ctx.db.patch(publisher._id, {
      displayName,
      bio,
      image: imageUrl,
      imageStorageId,
      updatedAt: now,
    });
    if (
      publisher.imageStorageId &&
      publisher.imageStorageId !== imageStorageId &&
      publisher.imageStorageId !== args.imageStorageId
    ) {
      await ctx.storage.delete(publisher.imageStorageId);
    }
    await ctx.db.insert("auditLogs", {
      actorUserId: userId,
      action: "publisher.profile.update",
      targetType: "publisher",
      targetId: publisher._id,
      metadata: {
        displayName,
        bio,
        image: imageUrl,
        imageStorageId,
      },
      createdAt: now,
    });

    return {
      ok: true as const,
      publisher: await toPublicPublisherWithOfficial(ctx, await ctx.db.get(publisher._id)),
    };
  },
});

export const migrateLegacyPublisherHandleToOrg = mutation({
  args: {
    handle: v.string(),
    fallbackUserHandle: v.optional(v.string()),
    displayName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx);
    return await migrateLegacyPublisherHandleToOrgWithActor(ctx, {
      actorUserId: userId,
      ...args,
    });
  },
});

export const ensureOrgPublisherHandleInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    handle: v.string(),
    fallbackUserHandle: v.optional(v.string()),
    displayName: v.optional(v.string()),
    trusted: v.optional(v.boolean()),
    memberHandle: v.optional(v.string()),
    memberRole: v.optional(v.union(v.literal("owner"), v.literal("admin"), v.literal("publisher"))),
  },
  handler: async (ctx, args) => await ensureOrgPublisherHandleWithActor(ctx, args),
});

export const removeOrgPublisherMemberInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    handle: v.string(),
    memberHandle: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    if (!actor || actor.deletedAt || actor.deactivatedAt) throw new ConvexError("Unauthorized");
    assertAdmin(actor);

    const handle = normalizePublisherHandle(args.handle);
    if (!handle || !PUBLISHER_HANDLE_PATTERN.test(handle)) {
      throw new ConvexError(PUBLISHER_HANDLE_REQUIREMENTS_MESSAGE);
    }
    const memberHandle = normalizePublisherHandle(args.memberHandle);
    if (!memberHandle) throw new ConvexError("memberHandle is required");

    const publisher = await getPublisherByHandle(ctx, handle);
    if (!publisher || publisher.kind !== "org" || publisher.deletedAt || publisher.deactivatedAt) {
      throw new ConvexError("Publisher not found");
    }

    const targetUser = await getActiveUserByHandleOrPersonalPublisher(ctx, memberHandle);
    if (!targetUser) throw new ConvexError(`User "@${memberHandle}" not found`);

    const targetMembership = await getPublisherMembership(ctx, publisher._id, targetUser._id);
    const member = {
      userId: targetUser._id,
      handle: targetUser.handle ?? memberHandle,
      role: targetMembership?.role ?? ("publisher" as const),
    };
    if (!targetMembership) {
      return {
        ok: true as const,
        publisherId: publisher._id,
        handle,
        removed: false,
        member,
      };
    }

    if (targetMembership.role === "owner") {
      const members = await ctx.db
        .query("publisherMembers")
        .withIndex("by_publisher", (q) => q.eq("publisherId", publisher._id))
        .collect();
      const remainingOwners = members.filter(
        (publisherMember) =>
          publisherMember.role === "owner" && publisherMember.userId !== targetUser._id,
      );
      if (remainingOwners.length === 0) {
        throw new ConvexError("Publisher must have at least one owner");
      }
    }

    await ctx.db.delete(targetMembership._id);
    await ctx.db.insert("auditLogs", {
      actorUserId: args.actorUserId,
      action: "publisher.member.remove",
      targetType: "publisher",
      targetId: publisher._id,
      metadata: {
        memberUserId: targetUser._id,
        memberHandle: targetUser.handle ?? memberHandle,
        role: targetMembership.role,
        source: "publisher.org.mod",
      },
      createdAt: Date.now(),
    });

    return {
      ok: true as const,
      publisherId: publisher._id,
      handle,
      removed: true,
      member,
    };
  },
});

export const deleteEmptyOrgPublisherInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    handle: v.string(),
    reason: v.string(),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    if (!actor || actor.deletedAt || actor.deactivatedAt) throw new ConvexError("Unauthorized");
    assertAdmin(actor);

    const handle = normalizePublisherHandle(args.handle);
    if (!handle || !PUBLISHER_HANDLE_PATTERN.test(handle)) {
      throw new ConvexError(PUBLISHER_HANDLE_REQUIREMENTS_MESSAGE);
    }
    const reason = args.reason.trim();
    if (!reason) throw new ConvexError("Reason is required");
    if (reason.length > 500) throw new ConvexError("Reason too long (max 500 chars)");

    const publisher = await getPublisherByHandle(ctx, handle);
    if (!publisher || publisher.kind !== "org" || publisher.deletedAt || publisher.deactivatedAt) {
      throw new ConvexError("Publisher not found");
    }

    const [activeSkills, activePackages, members] = await Promise.all([
      ctx.db
        .query("skills")
        .withIndex("by_owner_publisher_active_updated", (q) =>
          q.eq("ownerPublisherId", publisher._id).eq("softDeletedAt", undefined),
        )
        .take(1),
      ctx.db
        .query("packages")
        .withIndex("by_owner_publisher_active_updated", (q) =>
          q.eq("ownerPublisherId", publisher._id).eq("softDeletedAt", undefined),
        )
        .take(1),
      ctx.db
        .query("publisherMembers")
        .withIndex("by_publisher", (q) => q.eq("publisherId", publisher._id))
        .collect(),
    ]);

    if (activeSkills.length > 0 || activePackages.length > 0) {
      throw new ConvexError(
        `Publisher has active skills or packages and cannot be deleted with this empty-org command`,
      );
    }

    const dryRun = args.dryRun !== false;
    if (dryRun) {
      return {
        ok: true as const,
        publisherId: publisher._id,
        handle,
        dryRun: true,
        deleted: false,
        activeSkills: activeSkills.length,
        activePackages: activePackages.length,
        memberCount: members.length,
      };
    }

    const now = Date.now();
    await ctx.db.insert("auditLogs", {
      actorUserId: args.actorUserId,
      action: "publisher.org.delete_empty",
      targetType: "publisher",
      targetId: publisher._id,
      metadata: {
        handle,
        reason,
        memberCount: members.length,
        source: "publisher.org.mod",
      },
      createdAt: now,
    });
    await ctx.db.patch(publisher._id, {
      deletedAt: now,
      deactivatedAt: now,
      updatedAt: now,
    });

    return {
      ok: true as const,
      publisherId: publisher._id,
      handle,
      dryRun: false,
      deleted: true,
      activeSkills: 0,
      activePackages: 0,
      memberCount: members.length,
    };
  },
});

export const reclaimDeletedOrgHandleInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    handle: v.string(),
    reason: v.string(),
    dryRun: v.optional(v.boolean()),
    confirmationToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    if (!actor || actor.deletedAt || actor.deactivatedAt) throw new ConvexError("Unauthorized");
    assertAdmin(actor);

    const handle = normalizePublisherHandle(args.handle);
    if (!handle || !PUBLISHER_HANDLE_PATTERN.test(handle)) {
      throw new ConvexError(PUBLISHER_HANDLE_REQUIREMENTS_MESSAGE);
    }
    const reason = args.reason.trim();
    if (!reason) throw new ConvexError("Reason is required");
    if (reason.length > 500) throw new ConvexError("Reason too long (max 500 chars)");

    const publisher = await getPublisherByHandle(ctx, handle);
    if (!publisher) throw new ConvexError("Publisher not found");
    if (publisher.kind !== "org") throw new ConvexError("Publisher is not an org");
    if (!publisher.deletedAt && !publisher.deactivatedAt) {
      throw new ConvexError("Publisher is active; use org delete before reclaiming the handle");
    }

    const [activeSkills, activePackages, preview] = await Promise.all([
      ctx.db
        .query("skills")
        .withIndex("by_owner_publisher_active_updated", (q) =>
          q.eq("ownerPublisherId", publisher._id).eq("softDeletedAt", undefined),
        )
        .take(1),
      ctx.db
        .query("packages")
        .withIndex("by_owner_publisher_active_updated", (q) =>
          q.eq("ownerPublisherId", publisher._id).eq("softDeletedAt", undefined),
        )
        .take(1),
      inspectPublisherHardDeleteRows(ctx, publisher._id),
    ]);

    if (activeSkills.length > 0 || activePackages.length > 0) {
      throw new ConvexError(
        `Publisher has active skills or packages and cannot be reclaimed with this command`,
      );
    }

    const confirmationToken = `reclaim-deleted-org:${handle}`;
    const dryRun = args.dryRun !== false;
    const baseResult = {
      ok: true as const,
      publisherId: publisher._id,
      handle,
      activeSkills: activeSkills.length,
      activePackages: activePackages.length,
      memberCount: preview.members.length,
      githubSources: preview.sources.length,
      githubSourceContents: preview.sourceContents,
      officialPublisher: Boolean(preview.official),
      confirmationToken,
    };
    if (dryRun) {
      return {
        ...baseResult,
        dryRun: true,
        hardDeleted: false,
      };
    }

    if (args.confirmationToken !== confirmationToken) {
      throw new ConvexError(`Confirmation token must be "${confirmationToken}"`);
    }

    const now = Date.now();
    await ctx.db.insert("auditLogs", {
      actorUserId: args.actorUserId,
      action: "publisher.org.reclaim_deleted_handle",
      targetType: "publisher",
      targetId: publisher._id,
      metadata: {
        handle,
        reason,
        deletedAt: publisher.deletedAt,
        deactivatedAt: publisher.deactivatedAt,
        memberCount: preview.members.length,
        githubSources: preview.sources.length,
        githubSourceContents: preview.sourceContents,
        officialPublisher: Boolean(preview.official),
        source: "publisher.org.admin_reclaim",
      },
      createdAt: now,
    });
    const deletedRows = await hardDeletePublisherRows(ctx, publisher._id);

    return {
      ...baseResult,
      dryRun: false,
      hardDeleted: true,
      memberCount: deletedRows.members,
      githubSources: deletedRows.sources,
      githubSourceContents: deletedRows.sourceContents,
      officialPublisher: deletedRows.official,
    };
  },
});

export const listOfficialPublishersInternal = internalQuery({
  args: {
    actorUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    if (!actor || actor.deletedAt || actor.deactivatedAt) throw new ConvexError("Unauthorized");
    assertAdmin(actor);

    const rows = await ctx.db
      .query("officialPublishers")
      .withIndex("by_created", (q) => q)
      .order("asc")
      .collect();
    const items = await Promise.all(
      rows.map(async (row) => {
        const [publisher, createdBy] = await Promise.all([
          ctx.db.get(row.publisherId),
          row.createdByUserId ? ctx.db.get(row.createdByUserId) : Promise.resolve(null),
        ]);
        return {
          officialPublisherId: row._id,
          publisherId: row.publisherId,
          handle: publisher?.handle ?? null,
          displayName: publisher?.displayName ?? null,
          kind: publisher?.kind ?? null,
          active: Boolean(publisher && !publisher.deletedAt && !publisher.deactivatedAt),
          reason: row.reason ?? null,
          createdByUserId: row.createdByUserId ?? null,
          createdByHandle: createdBy?.handle ?? null,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        };
      }),
    );
    return { ok: true as const, items };
  },
});

export const addOfficialPublisherInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    handle: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    if (!actor || actor.deletedAt || actor.deactivatedAt) throw new ConvexError("Unauthorized");
    assertAdmin(actor);

    const handle = normalizePublisherHandle(args.handle);
    if (!handle) throw new ConvexError("Publisher handle is required");
    const reason = args.reason.trim();
    if (!reason) throw new ConvexError("Reason is required");
    if (reason.length > 500) throw new ConvexError("Reason too long (max 500 chars)");

    const publisher = await getPublisherByHandle(ctx, handle);
    if (!publisher || publisher.deletedAt || publisher.deactivatedAt) {
      throw new ConvexError(`Publisher "@${handle}" not found`);
    }

    const existing = await ctx.db
      .query("officialPublishers")
      .withIndex("by_publisher", (q) => q.eq("publisherId", publisher._id))
      .unique();
    if (existing) {
      return {
        ok: true as const,
        added: false,
        publisherId: publisher._id,
        handle: publisher.handle,
        officialPublisherId: existing._id,
      };
    }

    const now = Date.now();
    const officialPublisherId = await ctx.db.insert("officialPublishers", {
      publisherId: publisher._id,
      reason,
      createdByUserId: args.actorUserId,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("auditLogs", {
      actorUserId: args.actorUserId,
      action: "publisher.official.add",
      targetType: "publisher",
      targetId: publisher._id,
      metadata: {
        handle: publisher.handle,
        reason,
      },
      createdAt: now,
    });

    return {
      ok: true as const,
      added: true,
      publisherId: publisher._id,
      handle: publisher.handle,
      officialPublisherId,
    };
  },
});

export const removeOfficialPublisherInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    handle: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    if (!actor || actor.deletedAt || actor.deactivatedAt) throw new ConvexError("Unauthorized");
    assertAdmin(actor);

    const handle = normalizePublisherHandle(args.handle);
    if (!handle) throw new ConvexError("Publisher handle is required");
    const reason = args.reason.trim();
    if (!reason) throw new ConvexError("Reason is required");
    if (reason.length > 500) throw new ConvexError("Reason too long (max 500 chars)");

    const publisher = await getPublisherByHandle(ctx, handle);
    if (!publisher || publisher.deletedAt || publisher.deactivatedAt) {
      throw new ConvexError(`Publisher "@${handle}" not found`);
    }

    const existing = await ctx.db
      .query("officialPublishers")
      .withIndex("by_publisher", (q) => q.eq("publisherId", publisher._id))
      .unique();
    if (!existing) {
      return {
        ok: true as const,
        removed: false,
        publisherId: publisher._id,
        handle: publisher.handle,
      };
    }

    const now = Date.now();
    await ctx.db.delete(existing._id);
    await ctx.db.insert("auditLogs", {
      actorUserId: args.actorUserId,
      action: "publisher.official.remove",
      targetType: "publisher",
      targetId: publisher._id,
      metadata: {
        handle: publisher.handle,
        reason,
        officialPublisherId: existing._id,
      },
      createdAt: now,
    });

    return {
      ok: true as const,
      removed: true,
      publisherId: publisher._id,
      handle: publisher.handle,
      officialPublisherId: existing._id,
    };
  },
});

export const createOrgPublisherForUserInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    handle: v.string(),
    displayName: v.optional(v.string()),
  },
  handler: async (ctx, args) => await createOrgPublisherForUser(ctx, args),
});

async function hasOtherActiveOwner(
  ctx: MutationCtx,
  members: Array<Doc<"publisherMembers">>,
  actorUserId: Id<"users">,
) {
  for (const member of members) {
    if (member.role !== "owner" || member.userId === actorUserId) continue;
    const user = await ctx.db.get(member.userId);
    if (user && !user.deletedAt && !user.deactivatedAt) return true;
  }
  return false;
}

export const deleteSoleOwnerOrgsForAccountDeletionInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    deletedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const memberships = await ctx.db
      .query("publisherMembers")
      .withIndex("by_user", (q) => q.eq("userId", args.actorUserId))
      .collect();

    let deletedOrgs = 0;
    let hiddenSkills = 0;
    let deletedPackages = 0;
    for (const membership of memberships) {
      if (membership.role !== "owner") continue;
      const publisher = await ctx.db.get(membership.publisherId);
      if (
        !publisher ||
        publisher.kind !== "org" ||
        publisher.deletedAt ||
        publisher.deactivatedAt
      ) {
        continue;
      }
      const members = await ctx.db
        .query("publisherMembers")
        .withIndex("by_publisher", (q) => q.eq("publisherId", publisher._id))
        .collect();
      if (await hasOtherActiveOwner(ctx, members, args.actorUserId)) continue;

      const result = await deleteOrgPublisherForOwner(ctx, {
        actorUserId: args.actorUserId,
        publisherId: publisher._id,
        deletedAt: args.deletedAt,
        source: "account.delete",
      });
      deletedOrgs += 1;
      hiddenSkills += result.hiddenSkills;
      deletedPackages += result.deletedPackages;
    }

    return { ok: true as const, deletedOrgs, hiddenSkills, deletedPackages };
  },
});

export const createMemberInvite = mutation({
  args: {
    publisherId: v.id("publishers"),
    userHandle: v.string(),
    role: publisherRoleValidator,
  },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx);
    const { publisher, membership } = await requireOrgMembershipManager(
      ctx,
      args.publisherId,
      userId,
    );
    if (args.role === "owner" && membership.role !== "owner") {
      throw new ConvexError("Only org owners can invite new owners");
    }
    const targetHandle = normalizePublisherHandle(args.userHandle);
    if (!targetHandle) throw new ConvexError("User handle is required");
    const now = Date.now();
    const targetUser = await getActiveUserByHandleOrPersonalPublisher(ctx, targetHandle);
    if (targetUser) {
      const existing = await getPublisherMembership(ctx, publisher._id, targetUser._id);
      if (existing) throw new ConvexError(`@${targetHandle} is already a member`);
    }

    const activePending = await ctx.db
      .query("publisherInvites")
      .withIndex("by_publisher_target_status", (q) =>
        q.eq("publisherId", publisher._id).eq("targetHandle", targetHandle).eq("status", "pending"),
      )
      .take(1);
    if (activePending.some((invite) => invite.expiresAt > now)) {
      throw new ConvexError(`@${targetHandle} already has a pending invitation`);
    }

    const inviteId = await ctx.db.insert("publisherInvites", {
      publisherId: publisher._id,
      inviterUserId: userId,
      targetHandle,
      targetUserId: targetUser?._id,
      role: args.role,
      status: "pending",
      createdAt: now,
      updatedAt: now,
      expiresAt: now + PUBLISHER_INVITE_TTL_MS,
    });
    await ctx.db.insert("auditLogs", {
      actorUserId: userId,
      action: "publisher.member.invite.create",
      targetType: "publisher",
      targetId: publisher._id,
      metadata: {
        inviteId,
        targetHandle,
        targetUserId: targetUser?._id,
        role: args.role,
      },
      createdAt: now,
    });
    return { ok: true as const, inviteId };
  },
});

export const revokeMemberInvite = mutation({
  args: { inviteId: v.id("publisherInvites") },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx);
    const invite = await ctx.db.get(args.inviteId);
    if (!invite || invite.status !== "pending") return { ok: true as const };
    const { publisher } = await requireOrgMembershipManager(ctx, invite.publisherId, userId);
    const now = Date.now();
    await ctx.db.patch(invite._id, {
      status: "revoked",
      revokedAt: now,
      revokedByUserId: userId,
      updatedAt: now,
    });
    await ctx.db.insert("auditLogs", {
      actorUserId: userId,
      action: "publisher.member.invite.revoke",
      targetType: "publisher",
      targetId: publisher._id,
      metadata: {
        inviteId: invite._id,
        targetHandle: invite.targetHandle,
        targetUserId: invite.targetUserId,
        role: invite.role,
      },
      createdAt: now,
    });
    return { ok: true as const };
  },
});

export const declineMemberInvite = mutation({
  args: { inviteId: v.id("publisherInvites") },
  handler: async (ctx, args) => {
    const { user, userId } = await requireUser(ctx);
    const invite = await ctx.db.get(args.inviteId);
    if (!invite || invite.status !== "pending") return { ok: true as const };
    if (!(await publisherInviteMatchesUser(ctx, invite, user))) throw new ConvexError("Forbidden");
    const now = Date.now();
    await ctx.db.patch(invite._id, {
      status: "declined",
      declinedAt: now,
      declinedByUserId: userId,
      targetUserId: invite.targetUserId ?? userId,
      updatedAt: now,
    });
    await ctx.db.insert("auditLogs", {
      actorUserId: userId,
      action: "publisher.member.invite.decline",
      targetType: "publisher",
      targetId: invite.publisherId,
      metadata: {
        inviteId: invite._id,
        targetHandle: invite.targetHandle,
        role: invite.role,
      },
      createdAt: now,
    });
    return { ok: true as const };
  },
});

export const acceptMemberInvite = mutation({
  args: { inviteId: v.id("publisherInvites") },
  handler: async (ctx, args) => {
    const { user, userId } = await requireUser(ctx);
    const invite = await ctx.db.get(args.inviteId);
    if (!invite || invite.status !== "pending") {
      throw new ConvexError("Invitation not found");
    }
    const now = Date.now();
    if (invite.expiresAt <= now) throw new ConvexError("Invitation has expired");
    if (!(await publisherInviteMatchesUser(ctx, invite, user))) throw new ConvexError("Forbidden");
    const publisher = await ctx.db.get(invite.publisherId);
    if (!publisher || publisher.deletedAt || publisher.deactivatedAt) {
      throw new ConvexError("Publisher not found");
    }
    assertOrgPublisherMembershipManagement(publisher);
    const existing = await getPublisherMembership(ctx, publisher._id, userId);
    if (existing) {
      await ctx.db.patch(existing._id, { role: invite.role, updatedAt: now });
    } else {
      await ctx.db.insert("publisherMembers", {
        publisherId: publisher._id,
        userId,
        role: invite.role,
        createdAt: now,
        updatedAt: now,
      });
    }
    await ctx.db.patch(invite._id, {
      status: "accepted",
      acceptedAt: now,
      acceptedByUserId: userId,
      targetUserId: invite.targetUserId ?? userId,
      updatedAt: now,
    });
    await ctx.db.insert("auditLogs", {
      actorUserId: userId,
      action: "publisher.member.invite.accept",
      targetType: "publisher",
      targetId: publisher._id,
      metadata: {
        inviteId: invite._id,
        memberUserId: userId,
        targetHandle: invite.targetHandle,
        role: invite.role,
      },
      createdAt: now,
    });
    return { ok: true as const };
  },
});

export const addMember = mutation({
  args: {
    publisherId: v.id("publishers"),
    userHandle: v.string(),
    role: v.union(v.literal("owner"), v.literal("admin"), v.literal("publisher")),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx);
    const publisher = await ctx.db.get(args.publisherId);
    if (!publisher || publisher.deletedAt || publisher.deactivatedAt) {
      throw new ConvexError("Publisher not found");
    }
    const membership = await getPublisherMembership(ctx, publisher._id, userId);
    if (!membership || !isPublisherRoleAllowed(membership.role, ["admin"])) {
      throw new ConvexError("Forbidden");
    }
    assertOrgPublisherMembershipManagement(publisher);
    if (args.role === "owner" && membership.role !== "owner") {
      throw new ConvexError("Only org owners can promote members to owner");
    }
    const handle = normalizePublisherHandle(args.userHandle);
    if (!handle) throw new ConvexError("User handle is required");
    const targetUser = await getActiveUserByHandleOrPersonalPublisher(ctx, handle);
    if (!targetUser) {
      throw new ConvexError(`User "@${handle}" not found`);
    }
    const existing = await getPublisherMembership(ctx, publisher._id, targetUser._id);
    if (!existing) {
      throw new ConvexError(
        "New organization members must accept an invitation before they can be added",
      );
    }
    const now = Date.now();
    await ctx.db.patch(existing._id, { role: args.role, updatedAt: now });
    await ctx.db.insert("auditLogs", {
      actorUserId: userId,
      action: "publisher.member.upsert",
      targetType: "publisher",
      targetId: publisher._id,
      metadata: {
        memberUserId: targetUser._id,
        memberHandle: targetUser.handle ?? handle,
        role: args.role,
      },
      createdAt: now,
    });
    return { ok: true };
  },
});

export const removeMember = mutation({
  args: {
    publisherId: v.id("publishers"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const { user, userId } = await requireUser(ctx);
    const publisher = await ctx.db.get(args.publisherId);
    if (!publisher || publisher.deletedAt || publisher.deactivatedAt) {
      throw new ConvexError("Publisher not found");
    }
    if (publisher.kind === "user") {
      const actorMembership = await getPublisherMembership(ctx, publisher._id, userId);
      const isPersonalOwner =
        publisher.linkedUserId === userId ||
        (!publisher.linkedUserId &&
          (user.personalPublisherId === publisher._id || actorMembership?.role === "owner"));
      if (!isPersonalOwner) throw new ConvexError("Forbidden");
      const targetMembership = await getPublisherMembership(ctx, publisher._id, args.userId);
      if (!targetMembership) return { ok: true };
      if (args.userId === (publisher.linkedUserId ?? userId)) {
        throw new ConvexError("Personal publisher owner membership cannot be removed");
      }
      await ctx.db.delete(targetMembership._id);
      await ctx.db.insert("auditLogs", {
        actorUserId: userId,
        action: "publisher.member.remove",
        targetType: "publisher",
        targetId: publisher._id,
        metadata: { memberUserId: args.userId },
        createdAt: Date.now(),
      });
      return { ok: true };
    }
    const actorMembership = await getPublisherMembership(ctx, publisher._id, userId);
    if (!actorMembership || !isPublisherRoleAllowed(actorMembership.role, ["admin"])) {
      throw new ConvexError("Forbidden");
    }
    assertOrgPublisherMembershipManagement(publisher);
    const targetMembership = await getPublisherMembership(ctx, publisher._id, args.userId);
    if (!targetMembership) return { ok: true };
    if (targetMembership.role === "owner" && actorMembership.role !== "owner") {
      throw new ConvexError("Only org owners can remove other owners");
    }
    if (targetMembership.role === "owner") {
      const members = await ctx.db
        .query("publisherMembers")
        .withIndex("by_publisher", (q) => q.eq("publisherId", publisher._id))
        .collect();
      const remainingOwners = members.filter(
        (member) => member.role === "owner" && member.userId !== args.userId,
      );
      if (remainingOwners.length === 0) {
        throw new ConvexError("Publisher must have at least one owner");
      }
    }
    await ctx.db.delete(targetMembership._id);
    await ctx.db.insert("auditLogs", {
      actorUserId: userId,
      action: "publisher.member.remove",
      targetType: "publisher",
      targetId: publisher._id,
      metadata: { memberUserId: args.userId },
      createdAt: Date.now(),
    });
    return { ok: true };
  },
});

export const setTrustedPublisherInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    publisherId: v.id("publishers"),
    trustedPublisher: v.boolean(),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorUserId);
    if (!actor || actor.deletedAt || actor.deactivatedAt) throw new ConvexError("Unauthorized");
    assertAdmin(actor);
    const publisher = await ctx.db.get(args.publisherId);
    const now = Date.now();
    await ctx.db.patch(args.publisherId, {
      trustedPublisher: args.trustedPublisher,
      updatedAt: now,
    });
    await ctx.db.insert("auditLogs", {
      actorUserId: args.actorUserId,
      action: args.trustedPublisher ? "publisher.trusted.set" : "publisher.trusted.unset",
      targetType: "publisher",
      targetId: args.publisherId,
      metadata: {
        handle: publisher?.handle ?? null,
        previousTrustedPublisher: publisher?.trustedPublisher ?? null,
        trustedPublisher: args.trustedPublisher,
      },
      createdAt: now,
    });
  },
});

export const migrateLegacyPublisherHandleToOrgInternal = internalMutation({
  args: {
    actorUserId: v.id("users"),
    handle: v.string(),
    fallbackUserHandle: v.optional(v.string()),
    displayName: v.optional(v.string()),
  },
  handler: async (ctx, args) => await migrateLegacyPublisherHandleToOrgWithActor(ctx, args),
});
