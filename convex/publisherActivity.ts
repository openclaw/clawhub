import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery, query } from "./functions";
import { requireUser } from "./lib/access";
import { isPublicPluginDoc, isPublicSkillDoc } from "./lib/globalStats";
import { isPackageBlockedFromPublic, resolvePackageReleaseScanStatus } from "./lib/packageSecurity";
import { getPublicPublisherVisibility, MAX_FOLLOWED_PUBLISHERS } from "./lib/publishers";
import {
  getPublicSkillVersionDownloadBlock,
  getSkillFileModerationInfoFromSkill,
} from "./lib/skillFileAccess";

const DEFAULT_TIMELINE_LIMIT = 25;
const MAX_TIMELINE_LIMIT = 100;
const MAX_ACTIVITY_CANDIDATES_PER_QUERY = 2_000;
const DELETE_BATCH_SIZE = 200;

type PublicationActivityArgs =
  | {
      publisherId: Id<"publishers">;
      eventType: "skill.publish";
      skillId: Id<"skills">;
      skillVersionId: Id<"skillVersions">;
      version: string;
      eventAt: number;
    }
  | {
      publisherId: Id<"publishers">;
      eventType: "plugin.publish";
      packageId: Id<"packages">;
      packageReleaseId: Id<"packageReleases">;
      version: string;
      eventAt: number;
    };

function clampLimit(limit: number | undefined) {
  if (!Number.isFinite(limit ?? DEFAULT_TIMELINE_LIMIT)) return DEFAULT_TIMELINE_LIMIT;
  return Math.min(Math.max(Math.trunc(limit ?? DEFAULT_TIMELINE_LIMIT), 1), MAX_TIMELINE_LIMIT);
}

function activityDedupeKey(args: PublicationActivityArgs) {
  return args.eventType === "skill.publish"
    ? `skill.publish:${args.skillVersionId}`
    : `plugin.publish:${args.packageReleaseId}`;
}

function activitySortKey(eventAt: number, dedupeKey: string) {
  return `${Math.trunc(eventAt).toString().padStart(15, "0")}:${dedupeKey}`;
}

type TimelineCursor = {
  v: 2;
  beforeByPublisher: Record<string, string | null>;
};

function encodeTimelineCursor(cursor: TimelineCursor) {
  return btoa(JSON.stringify(cursor)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function decodeTimelineCursor(cursor: string | null | undefined) {
  if (!cursor) return null;
  try {
    const base64 = cursor.replaceAll("-", "+").replaceAll("_", "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const parsed = JSON.parse(atob(padded)) as Partial<TimelineCursor>;
    if (
      parsed.v !== 2 ||
      !parsed.beforeByPublisher ||
      typeof parsed.beforeByPublisher !== "object" ||
      Array.isArray(parsed.beforeByPublisher)
    ) {
      throw new Error("invalid timeline cursor");
    }
    for (const value of Object.values(parsed.beforeByPublisher)) {
      if (value !== null && (typeof value !== "string" || !value)) {
        throw new Error("invalid publisher timeline frontier");
      }
    }
    return parsed as TimelineCursor;
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

  const activityId = await ctx.db.insert("publisherActivity", {
    publisherId: args.publisherId,
    eventType: args.eventType,
    ...(args.eventType === "skill.publish"
      ? { skillId: args.skillId, skillVersionId: args.skillVersionId }
      : { packageId: args.packageId, packageReleaseId: args.packageReleaseId }),
    version: args.version,
    dedupeKey,
    eventAt: args.eventAt,
    sortKey: activitySortKey(args.eventAt, dedupeKey),
  });
  return { created: true, activityId };
}

async function hydrateVisibleActivity(
  ctx: QueryCtx,
  activity: {
    _id: Id<"publisherActivity">;
    publisherId: Id<"publishers">;
    eventType: "skill.publish" | "plugin.publish";
    skillId?: Id<"skills">;
    packageId?: Id<"packages">;
    skillVersionId?: Id<"skillVersions">;
    packageReleaseId?: Id<"packageReleases">;
    version: string;
    eventAt: number;
  },
) {
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
      publisher: {
        publisherId: publisher._id,
        handle: publisher.handle,
        displayName: publisher.displayName,
        kind: publisher.kind,
        image: publisher.image ?? null,
      },
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
    publisher: {
      publisherId: publisher._id,
      handle: publisher.handle,
      displayName: publisher.displayName,
      kind: publisher.kind,
      image: publisher.image ?? null,
    },
    artifact: {
      kind: "plugin" as const,
      artifactId: pkg._id,
      displayName: pkg.displayName,
      href: `/${encodeURIComponent(publisher.handle)}/plugins/${encodeURIComponent(pluginSlug)}`,
    },
  };
}

async function listTimelineForUser(
  ctx: QueryCtx,
  args: { userId: Id<"users">; cursor?: string | null; limit?: number },
) {
  const limit = clampLimit(args.limit);
  const items: NonNullable<Awaited<ReturnType<typeof hydrateVisibleActivity>>>[] = [];
  const decodedCursor = decodeTimelineCursor(args.cursor);
  const follows = await ctx.db
    .query("publisherFollows")
    .withIndex("by_follower_and_updatedAt", (q) => q.eq("followerUserId", args.userId))
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
      MAX_TIMELINE_LIMIT,
      Math.floor(MAX_ACTIVITY_CANDIDATES_PER_QUERY / Math.max(follows.length, 1)),
    ),
  );
  const activeFollows = follows.filter((follow) => beforeByPublisher[follow.publisherId] !== null);
  const activityBatches = await Promise.all(
    activeFollows.map(async (follow) => {
      const beforeSortKey = beforeByPublisher[follow.publisherId];
      if (!beforeSortKey) return { publisherId: follow.publisherId, activities: [] };
      const activities = await ctx.db
        .query("publisherActivity")
        .withIndex("by_publisher_and_sortKey", (q) =>
          q.eq("publisherId", follow.publisherId).lt("sortKey", beforeSortKey),
        )
        .order("desc")
        .take(perPublisherLimit);
      return { publisherId: follow.publisherId, activities };
    }),
  );
  const candidates = activityBatches
    .flatMap((batch) => batch.activities)
    .sort((left, right) => right.sortKey.localeCompare(left.sortKey));
  const nextBeforeByPublisher = { ...beforeByPublisher };
  const scannedByPublisher = new Map<string, number>();
  for (const activity of candidates) {
    scannedByPublisher.set(
      activity.publisherId,
      (scannedByPublisher.get(activity.publisherId) ?? 0) + 1,
    );
    nextBeforeByPublisher[activity.publisherId] = activity.sortKey;
    const item = await hydrateVisibleActivity(ctx, activity);
    if (item) items.push(item);
    if (items.length >= limit) break;
  }

  for (const batch of activityBatches) {
    const scanned = scannedByPublisher.get(batch.publisherId) ?? 0;
    if (scanned === batch.activities.length && batch.activities.length < perPublisherLimit) {
      nextBeforeByPublisher[batch.publisherId] = null;
    }
  }
  const hasMore = Object.values(nextBeforeByPublisher).some((frontier) => frontier !== null);
  return {
    ok: true as const,
    items,
    nextCursor: hasMore
      ? encodeTimelineCursor({ v: 2, beforeByPublisher: nextBeforeByPublisher })
      : null,
  };
}

export const listMine = query({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx);
    return await listTimelineForUser(ctx, { ...args, userId });
  },
});

export const listMineInternal = internalQuery({
  args: {
    userId: v.id("users"),
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  handler: listTimelineForUser,
});

export const deletePublisherActivityInternal = internalMutation({
  args: { publisherId: v.id("publishers"), cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("publisherActivity")
      .withIndex("by_publisher_and_sortKey", (q) => q.eq("publisherId", args.publisherId))
      .paginate({ cursor: args.cursor ?? null, numItems: DELETE_BATCH_SIZE });
    for (const activity of page.page) await ctx.db.delete(activity._id);
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.publisherActivity.deletePublisherActivityInternal, {
        publisherId: args.publisherId,
        cursor: page.continueCursor,
      });
    }
    return { deleted: page.page.length, scheduled: !page.isDone };
  },
});
