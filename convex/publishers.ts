import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery, mutation, query } from "./functions";
import { assertAdmin, getOptionalActiveAuthUserId, requireUser } from "./lib/access";
import { toPublicPublisher } from "./lib/public";
import {
  formatReservedPublicOwnerHandleMessage,
  isReservedPublicOwnerHandle,
} from "./lib/publicRouteReservations";
import {
  ensurePersonalPublisherForUser,
  getActiveUserByHandleOrPersonalPublisher,
  getPublisherByHandle,
  getPublisherMembership,
  getPersonalPublisherForUserOrFallback,
  getPersonalPublisherForUser,
  isPublisherRoleAllowed,
  normalizePublisherHandle,
} from "./lib/publishers";
import { readCanonicalStat } from "./lib/skillStats";

const PUBLISHER_HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const MAX_PUBLIC_PUBLISHER_LIST_LIMIT = 500;
const PUBLISHER_LIST_PREVIEW_LIMIT = 3;

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
  downloads: number;
};

type PublisherCatalogItem = {
  _id: Id<"skills"> | Id<"packages">;
  kind: "skill" | "plugin";
  displayName: string;
  summary: string | null;
  // Mirrors `skills.icon` for `kind: "skill"` items so the publisher
  // profile catalog (`/p/<handle>`) can render the same custom glyph that
  // `SkillCard` and `SkillListItem` show on `/skills` and `/search`.
  // Always `null` for plugins in Phase 1.
  icon: string | null;
  href: string;
  downloads: number;
  stars: number;
  updatedAt: number;
};

type PublisherCatalogSort = "downloads" | "recent";

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
};

type PublicPublisherKindFilter = "user" | "org";
type PublisherListCounts = {
  all: number;
  individuals: number;
  organizations: number;
};

function validateHandle(rawHandle: string) {
  const handle = normalizePublisherHandle(rawHandle);
  if (!handle) throw new ConvexError("Handle is required");
  if (!PUBLISHER_HANDLE_PATTERN.test(handle)) {
    throw new ConvexError("Handle must be lowercase, url-safe, and 2-40 characters");
  }
  if (isReservedPublicOwnerHandle(handle)) {
    throw new ConvexError(formatReservedPublicOwnerHandleMessage(handle));
  }
  return handle;
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
  return { skills, packages };
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
  return { skills, packages };
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

function getPublisherPublishedItems(rows: PublisherPublishedRows): PublisherPublishedItem[] {
  return [
    ...rows.skills.map((skill) => ({
      kind: "skill" as const,
      displayName: skill.displayName,
      downloads: readCanonicalStat(skill, "downloads"),
    })),
    ...rows.packages.map((pkg) => ({
      kind: pkg.family === "skill" ? ("skill" as const) : ("plugin" as const),
      displayName: pkg.displayName,
      downloads: pkg.stats.downloads,
    })),
  ]
    .sort((a, b) => b.downloads - a.downloads || a.displayName.localeCompare(b.displayName))
    .slice(0, 3);
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

function getPublisherCatalogItems(
  publisher: Doc<"publishers">,
  rows: PublisherPublishedRows,
  sort: PublisherCatalogSort = "downloads",
): PublisherCatalogItem[] {
  return [
    ...rows.skills.map((skill) => ({
      _id: skill._id,
      kind: "skill" as const,
      displayName: skill.displayName,
      summary: skill.summary ?? null,
      icon: skill.icon ?? null,
      href: `/${encodeURIComponent(publisher.handle)}/${encodeURIComponent(skill.slug)}`,
      downloads: readCanonicalStat(skill, "downloads"),
      stars: readCanonicalStat(skill, "stars"),
      updatedAt: skill.updatedAt,
    })),
    ...rows.packages.map((pkg) => ({
      _id: pkg._id,
      kind: "plugin" as const,
      displayName: pkg.displayName,
      summary: pkg.summary ?? null,
      icon: null,
      href: buildPluginDetailHref(pkg.name),
      downloads: pkg.stats.downloads,
      stars: pkg.stats.stars,
      updatedAt: pkg.updatedAt,
    })),
  ].sort(comparePublisherCatalogItems(sort));
}

async function toPublisherListItem(
  ctx: Pick<QueryCtx, "db">,
  publisher: Doc<"publishers">,
  options: {
    forceComputedStats?: boolean;
    includePublishedItems?: boolean;
    includeAffiliations?: boolean;
    includeStarredCount?: boolean;
  } = {},
): Promise<PublisherListItem | null> {
  const publicPublisher = toPublicPublisher(publisher);
  if (!publicPublisher) return null;
  const linkedUser =
    publisher.kind === "user" && publisher.linkedUserId
      ? await ctx.db.get(publisher.linkedUserId)
      : null;
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
    ? getPublisherPublishedItems(await getPreviewRows())
    : [];
  const affiliations =
    options.includeAffiliations && publisher.kind === "user" && publisher.linkedUserId
      ? await getUserPublisherAffiliations(ctx, publisher.linkedUserId, publisher._id)
      : undefined;
  const starredCount =
    options.includeStarredCount && publisher.kind === "user" && publisher.linkedUserId
      ? await getUserStarredCount(ctx, publisher.linkedUserId)
      : undefined;
  return {
    ...publicPublisher,
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

function hasPublisherListContent(summary: PublisherListSummary) {
  if (!hasPublisherStats(summary.publisher)) return true;
  return summary.item.stats.skills + summary.item.stats.packages > 0;
}

async function hydratePublisherListSummaries(
  ctx: Pick<QueryCtx, "db">,
  summaries: PublisherListSummary[],
) {
  const items = await Promise.all(
    summaries.map((summary) =>
      toPublisherListItem(ctx, summary.publisher, { includePublishedItems: true }),
    ),
  );
  return items
    .filter((item): item is PublisherListItem => Boolean(item))
    .filter((item) => item.stats.skills + item.stats.packages > 0);
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
      const publicPublisher = toPublicPublisher(publisher);
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

  const orgHandle = validateHandle(args.handle);
  const fallbackBase = validateHandle(args.fallbackUserHandle ?? `${orgHandle}-user`);
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
  },
) {
  const actor = await ctx.db.get(args.actorUserId);
  if (!actor || actor.deletedAt || actor.deactivatedAt) throw new ConvexError("Unauthorized");
  assertAdmin(actor);

  const handle = validateHandle(args.handle);
  const now = Date.now();
  const existingPublisher = await getPublisherByHandle(ctx, handle);
  const existingUser = await getUserByHandle(ctx, handle);

  if (existingPublisher?.kind === "org") {
    await ctx.db.patch(existingPublisher._id, {
      displayName: args.displayName?.trim() || existingPublisher.displayName,
      trustedPublisher: args.trusted ?? existingPublisher.trustedPublisher,
      updatedAt: now,
    });
    const membership = await getPublisherMembership(ctx, existingPublisher._id, args.actorUserId);
    if (!membership) {
      await ctx.db.insert("publisherMembers", {
        publisherId: existingPublisher._id,
        userId: args.actorUserId,
        role: "owner",
        createdAt: now,
        updatedAt: now,
      });
    }
    return {
      ok: true as const,
      publisherId: existingPublisher._id,
      handle,
      created: false,
      migrated: false,
      trusted: args.trusted ?? existingPublisher.trustedPublisher ?? false,
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
    return {
      ok: true as const,
      publisherId: result.orgPublisherId,
      handle,
      created: false,
      migrated: true,
      trusted: args.trusted ?? existingPublisher?.trustedPublisher ?? false,
    };
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
  await ctx.db.insert("publisherMembers", {
    publisherId,
    userId: args.actorUserId,
    role: "owner",
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
  return {
    ok: true as const,
    publisherId,
    handle,
    created: true,
    migrated: false,
    trusted: args.trusted ?? false,
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
        const publicPublisher = toPublicPublisher(publisher);
        if (!publicPublisher) return null;
        return {
          publisher: publicPublisher,
          role: membership.role,
        };
      }),
    );
    const visiblePublishers = publishers.filter(
      (
        item,
      ): item is {
        publisher: NonNullable<ReturnType<typeof toPublicPublisher>>;
        role: Doc<"publisherMembers">["role"];
      } => Boolean(item),
    );
    const personalPublisher = toPublicPublisher(
      await getPersonalPublisherForUserOrFallback(ctx, user),
    );
    if (
      personalPublisher &&
      !visiblePublishers.some((entry) => entry.publisher._id === personalPublisher._id)
    ) {
      visiblePublishers.unshift({
        publisher: personalPublisher,
        role: "owner",
      });
    }
    return visiblePublishers;
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
    sort: v.optional(v.union(v.literal("downloads"), v.literal("recent"))),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const publisher = await getPublisherByHandle(ctx, args.handle);
    if (
      !publisher ||
      publisher.kind !== "user" ||
      !publisher.linkedUserId ||
      publisher.deletedAt ||
      publisher.deactivatedAt
    ) {
      return { page: [], continueCursor: "", isDone: true };
    }

    const linkedUserId = publisher.linkedUserId;
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
          return {
            _id: skill._id,
            kind: "skill" as const,
            displayName: skill.displayName,
            summary: skill.summary ?? null,
            icon: skill.icon ?? null,
            href: `/${encodeURIComponent(ownerHandle)}/${encodeURIComponent(skill.slug)}`,
            downloads: readCanonicalStat(skill, "downloads"),
            stars: readCanonicalStat(skill, "stars"),
            updatedAt: skill.updatedAt,
          };
        }),
      )
    )
      .filter((item): item is PublisherCatalogItem => Boolean(item))
      .sort(comparePublisherCatalogItems(args.sort ?? "downloads"));
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
    sort: v.optional(v.union(v.literal("downloads"), v.literal("recent"))),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const publisher = await getPublisherByHandle(ctx, args.handle);
    if (!publisher || publisher.deletedAt || publisher.deactivatedAt) {
      return { page: [], continueCursor: "", isDone: true };
    }

    const numItems = clampInt(args.paginationOpts.numItems, 1, 24);
    const offset = args.paginationOpts.cursor ? Number(args.paginationOpts.cursor) : 0;
    const safeOffset = Number.isFinite(offset) && offset > 0 ? Math.trunc(offset) : 0;
    const items = getPublisherCatalogItems(
      publisher,
      await getPublisherPublishedRows(ctx, publisher._id),
      args.sort ?? "downloads",
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
    query: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const kindFilter = args.kind as PublicPublisherKindFilter | undefined;
    const numItems = clampInt(args.paginationOpts.numItems, 1, 50);
    const queryText = args.query?.trim();
    const offset = args.paginationOpts.cursor ? Number(args.paginationOpts.cursor) : 0;
    const safeOffset = Number.isFinite(offset) && offset > 0 ? Math.trunc(offset) : 0;
    const activeRows = kindFilter
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
    const publisherSummaries = activeRows
      .map(toPublisherListSummary)
      .filter((summary): summary is PublisherListSummary => Boolean(summary))
      .filter(hasPublisherListContent);
    const itemSummaries = publisherSummaries
      .filter(
        (summary) =>
          (!kindFilter || summary.item.kind === kindFilter) &&
          matchesPublisherQuery(summary.item, queryText?.toLowerCase() ?? ""),
      )
      .sort((a, b) => comparePublisherListItems(a.item, b.item));
    const globalPublisherSummaries = kindFilter
      ? (
          await ctx.db
            .query("publishers")
            .withIndex("by_active_total_downloads", (q) =>
              q.eq("deletedAt", undefined).eq("deactivatedAt", undefined),
            )
            .order("desc")
            .take(MAX_PUBLIC_PUBLISHER_LIST_LIMIT)
        )
          .map(toPublisherListSummary)
          .filter((summary): summary is PublisherListSummary => Boolean(summary))
          .filter(hasPublisherListContent)
      : publisherSummaries;
    const globalCounts = getPublisherListSummaryCounts(globalPublisherSummaries);
    const counts = queryText ? getPublisherListSummaryCounts(itemSummaries) : globalCounts;
    const nextOffset = safeOffset + numItems;
    const page = await hydratePublisherListSummaries(
      ctx,
      itemSummaries.slice(safeOffset, nextOffset),
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
    if (!publisher || publisher.deletedAt || publisher.deactivatedAt) return null;
    const memberships = await ctx.db
      .query("publisherMembers")
      .withIndex("by_publisher", (q) => q.eq("publisherId", publisher._id))
      .collect();
    const items = await Promise.all(
      memberships.map(async (membership) => {
        const user = await ctx.db.get(membership.userId);
        if (!user || user.deletedAt || user.deactivatedAt) return null;
        return {
          role: membership.role,
          user: {
            _id: user._id,
            handle: user.handle ?? null,
            displayName: user.displayName ?? user.name ?? null,
            image: user.image ?? null,
          },
        };
      }),
    );
    return {
      publisher: toPublicPublisher(publisher),
      members: items.filter(Boolean),
    };
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

    const handle = validateHandle(args.handle);
    const existingPublisher = await getPublisherByHandle(ctx, handle);
    if (existingPublisher) throw new ConvexError(`Publisher "@${handle}" already exists`);

    const existingUser = await ctx.db
      .query("users")
      .withIndex("handle", (q) => q.eq("handle", handle))
      .unique();
    if (existingUser && existingUser._id !== userId) {
      throw new ConvexError(`Handle "@${handle}" is already claimed`);
    }

    const now = Date.now();
    const displayName = args.displayName.trim() || handle;
    const bio = args.bio?.trim() || undefined;
    const publisherId = await ctx.db.insert("publishers", {
      kind: "org",
      handle,
      displayName,
      bio,
      image: undefined,
      linkedUserId: undefined,
      trustedPublisher: false,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("publisherMembers", {
      publisherId,
      userId,
      role: "owner",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("auditLogs", {
      actorUserId: userId,
      action: "publisher.create",
      targetType: "publisher",
      targetId: publisherId,
      metadata: { kind: "org", handle },
      createdAt: now,
    });
    return {
      publisher: toPublicPublisher(await ctx.db.get(publisherId)),
      role: "owner" as const,
    };
  },
});

export const updateProfile = mutation({
  args: {
    publisherId: v.id("publishers"),
    displayName: v.string(),
    bio: v.optional(v.string()),
    image: v.optional(v.string()),
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
    if (image) {
      let parsed: URL;
      try {
        parsed = new URL(image);
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
      image,
      updatedAt: now,
    });
    await ctx.db.insert("auditLogs", {
      actorUserId: userId,
      action: "publisher.profile.update",
      targetType: "publisher",
      targetId: publisher._id,
      metadata: {
        displayName,
        bio,
        image,
      },
      createdAt: now,
    });

    return {
      ok: true as const,
      publisher: toPublicPublisher(await ctx.db.get(publisher._id)),
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
  },
  handler: async (ctx, args) => await ensureOrgPublisherHandleWithActor(ctx, args),
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
    if (args.role === "owner" && membership.role !== "owner") {
      throw new ConvexError("Only org owners can promote members to owner");
    }
    const handle = normalizePublisherHandle(args.userHandle);
    if (!handle) throw new ConvexError("User handle is required");
    const targetUser = await getActiveUserByHandleOrPersonalPublisher(ctx, handle);
    if (!targetUser) {
      throw new ConvexError(`User "@${handle}" not found`);
    }
    await ensurePersonalPublisherForUser(ctx, targetUser, {
      actorUserId: userId,
      source: "publisher.member.upsert",
    });
    const existing = await getPublisherMembership(ctx, publisher._id, targetUser._id);
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { role: args.role, updatedAt: now });
    } else {
      await ctx.db.insert("publisherMembers", {
        publisherId: publisher._id,
        userId: targetUser._id,
        role: args.role,
        createdAt: now,
        updatedAt: now,
      });
    }
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
    const { userId } = await requireUser(ctx);
    const publisher = await ctx.db.get(args.publisherId);
    if (!publisher || publisher.deletedAt || publisher.deactivatedAt) {
      throw new ConvexError("Publisher not found");
    }
    const actorMembership = await getPublisherMembership(ctx, publisher._id, userId);
    if (!actorMembership || !isPublisherRoleAllowed(actorMembership.role, ["admin"])) {
      throw new ConvexError("Forbidden");
    }
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
