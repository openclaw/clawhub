import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery, query } from "./functions";
import { requireUser } from "./lib/access";
import { sha256Hex } from "./lib/clawpack";
import { isPublicPluginDoc, isPublicSkillDoc } from "./lib/globalStats";
import { isPackageBlockedFromPublic, resolvePackageReleaseScanStatus } from "./lib/packageSecurity";
import { getPublicPublisherVisibility, MAX_FOLLOWED_PUBLISHERS } from "./lib/publishers";
import {
  getPublicSkillVersionDownloadBlock,
  getSkillFileModerationInfoFromSkill,
} from "./lib/skillFileAccess";

const DEFAULT_GROUP_LIMIT = 25;
const MAX_GROUP_LIMIT = 100;
const DEFAULT_GROUP_ITEM_LIMIT = 25;
const MAX_GROUP_ITEM_LIMIT = 100;
const MAX_ACTIVITY_CANDIDATES_PER_QUERY = 2_000;
const MAX_GROUP_PREVIEW_SCAN = 100;
const GROUP_PREVIEW_LIMIT = 3;
const MAX_GROUP_ITEM_SCAN_PAGES = 4;
const MAX_PUBLICATION_BATCH_ID_LENGTH = 1_000;
const DELETE_BATCH_SIZE = 200;

type PublicationActivityArgs =
  | {
      publisherId: Id<"publishers">;
      eventType: "skill.publish";
      skillId: Id<"skills">;
      skillVersionId: Id<"skillVersions">;
      version: string;
      eventAt: number;
      publicationBatchId?: string;
    }
  | {
      publisherId: Id<"publishers">;
      eventType: "plugin.publish";
      packageId: Id<"packages">;
      packageReleaseId: Id<"packageReleases">;
      version: string;
      eventAt: number;
      publicationBatchId?: string;
    };

function clampLimit(value: number | undefined, defaultValue: number, maxValue: number) {
  if (!Number.isFinite(value ?? defaultValue)) return defaultValue;
  return Math.min(Math.max(Math.trunc(value ?? defaultValue), 1), maxValue);
}

function activityDedupeKey(args: PublicationActivityArgs) {
  return args.eventType === "skill.publish"
    ? `skill.publish:${args.skillVersionId}`
    : `plugin.publish:${args.packageReleaseId}`;
}

function activitySortKey(eventAt: number, suffix: string) {
  return `${Math.trunc(eventAt).toString().padStart(15, "0")}:${suffix}`;
}

async function activityBatchKey(args: PublicationActivityArgs, dedupeKey: string) {
  const supplied = args.publicationBatchId?.trim();
  if (supplied && supplied.length > MAX_PUBLICATION_BATCH_ID_LENGTH) {
    throw new ConvexError("Publisher activity batch id is too long");
  }
  const source = supplied || dedupeKey;
  return await sha256Hex(new TextEncoder().encode(`${args.publisherId}:${source}`));
}

type ActivityCursor = {
  v: 3;
  beforeByPublisher: Record<string, string | null>;
};

function encodeActivityCursor(cursor: ActivityCursor) {
  return btoa(JSON.stringify(cursor)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function decodeActivityCursor(cursor: string | null | undefined) {
  if (!cursor) return null;
  try {
    const base64 = cursor.replaceAll("-", "+").replaceAll("_", "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const parsed = JSON.parse(atob(padded)) as Partial<ActivityCursor>;
    if (
      parsed.v !== 3 ||
      !parsed.beforeByPublisher ||
      typeof parsed.beforeByPublisher !== "object" ||
      Array.isArray(parsed.beforeByPublisher)
    ) {
      throw new Error("invalid activity cursor");
    }
    for (const value of Object.values(parsed.beforeByPublisher)) {
      if (value !== null && (typeof value !== "string" || !value)) {
        throw new Error("invalid publisher activity frontier");
      }
    }
    return parsed as ActivityCursor;
  } catch {
    throw new ConvexError("Invalid publisher activity cursor");
  }
}

export async function recordPublisherPublicationActivity(
  ctx: MutationCtx,
  args: PublicationActivityArgs,
) {
  const visibility = await getPublicPublisherVisibility(ctx, await ctx.db.get(args.publisherId));
  if (!visibility) return { created: false, reason: "publisher_unavailable" as const };

  const dedupeKey = activityDedupeKey(args);
  const existing = await ctx.db
    .query("publisherActivity")
    .withIndex("by_dedupeKey", (q) => q.eq("dedupeKey", dedupeKey))
    .unique();
  if (existing) return { created: false, reason: "duplicate" as const };

  const batchKey = await activityBatchKey(args, dedupeKey);
  const existingGroup = await ctx.db
    .query("publisherActivityGroups")
    .withIndex("by_publisher_and_batchKey", (q) =>
      q.eq("publisherId", args.publisherId).eq("batchKey", batchKey),
    )
    .unique();
  const eventSortKey = activitySortKey(args.eventAt, dedupeKey);
  const activityId = await ctx.db.insert("publisherActivity", {
    publisherId: args.publisherId,
    batchKey,
    eventType: args.eventType,
    ...(args.eventType === "skill.publish"
      ? { skillId: args.skillId, skillVersionId: args.skillVersionId }
      : { packageId: args.packageId, packageReleaseId: args.packageReleaseId }),
    version: args.version,
    dedupeKey,
    eventAt: args.eventAt,
    sortKey: eventSortKey,
  });

  let groupId: Id<"publisherActivityGroups">;
  if (existingGroup) {
    const eventAt = Math.max(existingGroup.eventAt, args.eventAt);
    await ctx.db.patch(existingGroup._id, {
      eventAt,
      sortKey: activitySortKey(eventAt, batchKey),
      itemCount: existingGroup.itemCount + 1,
      updatedAt: args.eventAt,
    });
    groupId = existingGroup._id;
  } else {
    groupId = await ctx.db.insert("publisherActivityGroups", {
      publisherId: args.publisherId,
      batchKey,
      eventAt: args.eventAt,
      sortKey: activitySortKey(args.eventAt, batchKey),
      itemCount: 1,
      createdAt: args.eventAt,
      updatedAt: args.eventAt,
    });
  }
  return { created: true, activityId, groupId };
}

async function hydrateVisibleActivity(ctx: QueryCtx, activity: Doc<"publisherActivity">) {
  const visibility = await getPublicPublisherVisibility(
    ctx,
    await ctx.db.get(activity.publisherId),
  );
  if (!visibility) return null;
  const publisher = visibility.publisher;

  if (activity.eventType === "skill.publish") {
    if (!activity.skillId || !activity.skillVersionId) return null;
    const [skill, version] = await Promise.all([
      ctx.db.get(activity.skillId),
      ctx.db.get(activity.skillVersionId),
    ]);
    if (
      !isPublicSkillDoc(skill) ||
      skill.ownerPublisherId !== publisher._id ||
      !version ||
      version.skillId !== skill._id ||
      version.softDeletedAt ||
      version.ownerDeletedAt ||
      getPublicSkillVersionDownloadBlock(
        getSkillFileModerationInfoFromSkill(skill),
        version,
        skill.moderationSourceVersionId,
      )
    ) {
      return null;
    }
    return {
      activityId: activity._id,
      eventType: activity.eventType,
      eventAt: activity.eventAt,
      version: activity.version,
      artifact: {
        kind: "skill" as const,
        artifactId: skill._id,
        displayName: skill.displayName,
        href: `/${encodeURIComponent(publisher.handle)}/skills/${encodeURIComponent(skill.slug)}`,
      },
    };
  }

  if (!activity.packageId || !activity.packageReleaseId) return null;
  const [pkg, release] = await Promise.all([
    ctx.db.get(activity.packageId),
    ctx.db.get(activity.packageReleaseId),
  ]);
  if (
    !isPublicPluginDoc(pkg) ||
    pkg.ownerPublisherId !== publisher._id ||
    !release ||
    release.packageId !== pkg._id ||
    release.softDeletedAt ||
    release.ownerDeletedAt ||
    isPackageBlockedFromPublic(resolvePackageReleaseScanStatus(release))
  ) {
    return null;
  }
  const pluginSlug = pkg.normalizedName.startsWith("@")
    ? (pkg.normalizedName.split("/")[1] ?? pkg.normalizedName)
    : pkg.normalizedName;
  return {
    activityId: activity._id,
    eventType: activity.eventType,
    eventAt: activity.eventAt,
    version: activity.version,
    artifact: {
      kind: "plugin" as const,
      artifactId: pkg._id,
      displayName: pkg.displayName,
      href: `/${encodeURIComponent(publisher.handle)}/plugins/${encodeURIComponent(pluginSlug)}`,
    },
  };
}

async function hydrateVisibleGroup(ctx: QueryCtx, group: Doc<"publisherActivityGroups">) {
  const visibility = await getPublicPublisherVisibility(ctx, await ctx.db.get(group.publisherId));
  if (!visibility) return null;
  const publisher = visibility.publisher;
  const candidates = await ctx.db
    .query("publisherActivity")
    .withIndex("by_publisher_and_batchKey_and_sortKey", (q) =>
      q.eq("publisherId", group.publisherId).eq("batchKey", group.batchKey),
    )
    .order("desc")
    .take(MAX_GROUP_PREVIEW_SCAN);
  const previewItems = [];
  for (const candidate of candidates) {
    const item = await hydrateVisibleActivity(ctx, candidate);
    if (item) previewItems.push(item);
    if (previewItems.length >= GROUP_PREVIEW_LIMIT) break;
  }
  if (previewItems.length === 0) return null;

  return {
    groupId: group._id,
    eventAt: group.eventAt,
    recordedItemCount: group.itemCount,
    previewItems,
    hasMoreItems: group.itemCount > previewItems.length,
    reason: "following" as const,
    publisher: {
      publisherId: publisher._id,
      handle: publisher.handle,
      displayName: publisher.displayName,
      kind: publisher.kind,
      image: publisher.image ?? null,
    },
  };
}

async function listGroupsForUser(
  ctx: QueryCtx,
  args: { userId: Id<"users">; cursor?: string | null; limit?: number },
) {
  const limit = clampLimit(args.limit, DEFAULT_GROUP_LIMIT, MAX_GROUP_LIMIT);
  const groups: NonNullable<Awaited<ReturnType<typeof hydrateVisibleGroup>>>[] = [];
  const decodedCursor = decodeActivityCursor(args.cursor);
  const follows = await ctx.db
    .query("publisherFollows")
    .withIndex("by_follower", (q) => q.eq("followerUserId", args.userId))
    .order("desc")
    .take(MAX_FOLLOWED_PUBLISHERS + 1);
  if (follows.length > MAX_FOLLOWED_PUBLISHERS) {
    throw new ConvexError(`Publisher activity supports up to ${MAX_FOLLOWED_PUBLISHERS} follows`);
  }

  const initialFrontier = activitySortKey(Date.now() + 1, "~");
  const beforeByPublisher = Object.fromEntries(
    follows.map((follow) => [
      follow.publisherId,
      decodedCursor && Object.hasOwn(decodedCursor.beforeByPublisher, follow.publisherId)
        ? decodedCursor.beforeByPublisher[follow.publisherId]
        : initialFrontier,
    ]),
  ) as Record<string, string | null>;
  const perPublisherLimit = Math.max(
    1,
    Math.min(
      limit * 2,
      MAX_GROUP_LIMIT,
      Math.floor(MAX_ACTIVITY_CANDIDATES_PER_QUERY / Math.max(follows.length, 1)),
    ),
  );
  const activeFollows = follows.filter((follow) => beforeByPublisher[follow.publisherId] !== null);
  const groupBatches = await Promise.all(
    activeFollows.map(async (follow) => {
      const beforeSortKey = beforeByPublisher[follow.publisherId];
      if (!beforeSortKey) return { publisherId: follow.publisherId, groups: [] };
      const publisherGroups = await ctx.db
        .query("publisherActivityGroups")
        .withIndex("by_publisher_and_sortKey", (q) =>
          q.eq("publisherId", follow.publisherId).lt("sortKey", beforeSortKey),
        )
        .order("desc")
        .take(perPublisherLimit);
      return { publisherId: follow.publisherId, groups: publisherGroups };
    }),
  );
  const candidates = groupBatches
    .flatMap((batch) => batch.groups)
    .sort((left, right) => right.sortKey.localeCompare(left.sortKey));
  const nextBeforeByPublisher = { ...beforeByPublisher };
  const scannedByPublisher = new Map<string, number>();
  for (const candidate of candidates) {
    scannedByPublisher.set(
      candidate.publisherId,
      (scannedByPublisher.get(candidate.publisherId) ?? 0) + 1,
    );
    nextBeforeByPublisher[candidate.publisherId] = candidate.sortKey;
    const group = await hydrateVisibleGroup(ctx, candidate);
    if (group) groups.push(group);
    if (groups.length >= limit) break;
  }

  for (const batch of groupBatches) {
    const scanned = scannedByPublisher.get(batch.publisherId) ?? 0;
    if (scanned === batch.groups.length && batch.groups.length < perPublisherLimit) {
      nextBeforeByPublisher[batch.publisherId] = null;
    }
  }
  const hasMore = Object.values(nextBeforeByPublisher).some((frontier) => frontier !== null);
  return {
    ok: true as const,
    groups,
    nextCursor: hasMore
      ? encodeActivityCursor({ v: 3, beforeByPublisher: nextBeforeByPublisher })
      : null,
  };
}

async function listGroupItemsForUser(
  ctx: QueryCtx,
  args: {
    userId: Id<"users">;
    groupId: Id<"publisherActivityGroups">;
    cursor?: string | null;
    limit?: number;
  },
) {
  const group = await ctx.db.get(args.groupId);
  if (!group) throw new ConvexError("Publisher activity group not found");
  const follow = await ctx.db
    .query("publisherFollows")
    .withIndex("by_follower_publisher", (q) =>
      q.eq("followerUserId", args.userId).eq("publisherId", group.publisherId),
    )
    .unique();
  if (!follow) throw new ConvexError("Publisher activity group not found");

  const limit = clampLimit(args.limit, DEFAULT_GROUP_ITEM_LIMIT, MAX_GROUP_ITEM_LIMIT);
  const items = [];
  let cursor = args.cursor ?? null;
  let isDone = false;
  let scannedPages = 0;
  while (items.length < limit && !isDone && scannedPages < MAX_GROUP_ITEM_SCAN_PAGES) {
    const page = await ctx.db
      .query("publisherActivity")
      .withIndex("by_publisher_and_batchKey_and_sortKey", (q) =>
        q.eq("publisherId", group.publisherId).eq("batchKey", group.batchKey),
      )
      .order("desc")
      .paginate({ cursor, numItems: Math.min(limit - items.length, MAX_GROUP_ITEM_LIMIT) });
    for (const activity of page.page) {
      const item = await hydrateVisibleActivity(ctx, activity);
      if (item) items.push(item);
      if (items.length >= limit) break;
    }
    cursor = page.continueCursor;
    isDone = page.isDone;
    scannedPages += 1;
  }
  return { ok: true as const, items, continueCursor: isDone ? "" : cursor, isDone };
}

export const listMine = query({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx);
    return await listGroupsForUser(ctx, { ...args, userId });
  },
});

export const listGroupItems = query({
  args: {
    groupId: v.id("publisherActivityGroups"),
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx);
    return await listGroupItemsForUser(ctx, { ...args, userId });
  },
});

export const listMineInternal = internalQuery({
  args: {
    userId: v.id("users"),
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  handler: listGroupsForUser,
});

export const listGroupItemsInternal = internalQuery({
  args: {
    userId: v.id("users"),
    groupId: v.id("publisherActivityGroups"),
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  handler: listGroupItemsForUser,
});

export const deletePublisherActivityInternal = internalMutation({
  args: {
    publisherId: v.id("publishers"),
    phase: v.optional(v.union(v.literal("events"), v.literal("groups"))),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ deleted: number; scheduled: boolean }> => {
    const phase = args.phase ?? "events";
    const table = phase === "events" ? "publisherActivity" : "publisherActivityGroups";
    const page = await ctx.db
      .query(table)
      .withIndex("by_publisher_and_sortKey", (q) => q.eq("publisherId", args.publisherId))
      .paginate({ cursor: args.cursor ?? null, numItems: DELETE_BATCH_SIZE });
    for (const row of page.page) await ctx.db.delete(row._id);
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.publisherActivity.deletePublisherActivityInternal, {
        publisherId: args.publisherId,
        phase,
        cursor: page.continueCursor,
      });
      return { deleted: page.page.length, scheduled: true };
    }
    if (phase === "events") {
      await ctx.scheduler.runAfter(0, internal.publisherActivity.deletePublisherActivityInternal, {
        publisherId: args.publisherId,
        phase: "groups",
      });
      return { deleted: page.page.length, scheduled: true };
    }
    return { deleted: page.page.length, scheduled: false };
  },
});
