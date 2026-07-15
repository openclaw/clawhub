import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery, mutation, query } from "./functions";
import { requireUser } from "./lib/access";
import { isPublisherActive } from "./lib/publishers";

const notificationPreferenceValidator = v.union(v.literal("all"), v.literal("none"));
const DEFAULT_NOTIFICATION_PREFERENCE = "all" as const;
const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 100;
const LIST_SCAN_BATCH_SIZE = 100;
const MAX_LIST_SCAN_PAGES = 4;

type NotificationPreference = "all" | "none";

function clampListLimit(limit: number | undefined) {
  if (!Number.isFinite(limit ?? DEFAULT_LIST_LIMIT)) return DEFAULT_LIST_LIMIT;
  return Math.min(Math.max(Math.trunc(limit ?? DEFAULT_LIST_LIMIT), 1), MAX_LIST_LIMIT);
}

async function requireActivePublisher(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  publisherId: Id<"publishers">,
) {
  const publisher = await ctx.db.get(publisherId);
  if (!publisher || !isPublisherActive(publisher)) throw new Error("Publisher not found");
  return publisher;
}

async function getExistingFollow(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  followerUserId: Id<"users">,
  publisherId: Id<"publishers">,
) {
  return await ctx.db
    .query("publisherFollows")
    .withIndex("by_follower_publisher", (q) =>
      q.eq("followerUserId", followerUserId).eq("publisherId", publisherId),
    )
    .unique();
}

function toFollowResult(
  follow: Pick<
    Doc<"publisherFollows">,
    "_id" | "followerUserId" | "publisherId" | "notifications" | "createdAt" | "updatedAt"
  >,
) {
  return {
    followId: follow._id,
    followerUserId: follow.followerUserId,
    publisherId: follow.publisherId,
    following: true,
    notifications: follow.notifications,
    createdAt: follow.createdAt,
    updatedAt: follow.updatedAt,
  };
}

async function followPublisherForUser(
  ctx: MutationCtx,
  args: {
    followerUserId: Id<"users">;
    publisherId: Id<"publishers">;
    notifications?: NotificationPreference;
  },
) {
  const publisher = await requireActivePublisher(ctx, args.publisherId);
  const existing = await getExistingFollow(ctx, args.followerUserId, args.publisherId);
  const notifications =
    args.notifications ?? existing?.notifications ?? DEFAULT_NOTIFICATION_PREFERENCE;
  const now = Date.now();

  if (existing) {
    if (existing.notifications !== notifications) {
      await ctx.db.patch(existing._id, { notifications, updatedAt: now });
      return toFollowResult({ ...existing, notifications, updatedAt: now });
    }
    return toFollowResult(existing);
  }

  const followId = await ctx.db.insert("publisherFollows", {
    followerUserId: args.followerUserId,
    publisherId: args.publisherId,
    notifications,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.insert("auditLogs", {
    actorUserId: args.followerUserId,
    action: "publisher.follow.create",
    targetType: "publisher",
    targetId: publisher._id,
    metadata: {
      handle: publisher.handle,
      notifications,
    },
    createdAt: now,
  });

  return toFollowResult({
    _id: followId,
    followerUserId: args.followerUserId,
    publisherId: args.publisherId,
    notifications,
    createdAt: now,
    updatedAt: now,
  });
}

async function unfollowPublisherForUser(
  ctx: MutationCtx,
  args: { followerUserId: Id<"users">; publisherId: Id<"publishers"> },
) {
  const existing = await getExistingFollow(ctx, args.followerUserId, args.publisherId);
  if (!existing) {
    return {
      ok: true as const,
      following: false,
      unfollowed: false,
      alreadyUnfollowed: true,
      publisherId: args.publisherId,
    };
  }

  const now = Date.now();
  const publisher = await ctx.db.get(args.publisherId);
  await ctx.db.delete(existing._id);
  await ctx.db.insert("auditLogs", {
    actorUserId: args.followerUserId,
    action: "publisher.follow.delete",
    targetType: "publisher",
    targetId: args.publisherId,
    metadata: {
      handle: publisher?.handle ?? null,
      publisherActive: isPublisherActive(publisher),
      notifications: existing.notifications,
    },
    createdAt: now,
  });

  return {
    ok: true as const,
    following: false,
    unfollowed: true,
    alreadyUnfollowed: false,
    publisherId: args.publisherId,
  };
}

async function listPublisherFollowsForUser(
  ctx: QueryCtx,
  args: { followerUserId: Id<"users">; cursor?: string | null; limit?: number; query?: string },
) {
  const limit = clampListLimit(args.limit);
  const normalizedQuery = args.query?.trim().toLowerCase();
  const items = [];
  let cursor = args.cursor ?? null;
  let isDone = false;
  let scannedPages = 0;

  while (items.length < limit && !isDone && scannedPages < MAX_LIST_SCAN_PAGES) {
    const remaining = Math.min(limit - items.length, LIST_SCAN_BATCH_SIZE);
    const page = await ctx.db
      .query("publisherFollows")
      .withIndex("by_follower", (q) => q.eq("followerUserId", args.followerUserId))
      .order("desc")
      .paginate({ cursor, numItems: remaining });

    for (const follow of page.page) {
      const publisher = await ctx.db.get(follow.publisherId);
      if (!publisher || !isPublisherActive(publisher)) continue;
      if (
        normalizedQuery &&
        !publisher.displayName.toLowerCase().includes(normalizedQuery) &&
        !publisher.handle.toLowerCase().includes(normalizedQuery)
      ) {
        continue;
      }
      items.push({
        ...toFollowResult(follow),
        publisher: {
          _id: publisher._id,
          handle: publisher.handle,
          displayName: publisher.displayName,
          kind: publisher.kind,
          image: publisher.image ?? null,
        },
      });
      if (items.length >= limit) break;
    }

    cursor = page.continueCursor;
    isDone = page.isDone;
    scannedPages += 1;
  }

  return { ok: true as const, items, continueCursor: isDone ? "" : cursor, isDone };
}

export const isFollowingPublisher = query({
  args: { publisherId: v.id("publishers") },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx);
    const publisher = await ctx.db.get(args.publisherId);
    if (!isPublisherActive(publisher)) return false;
    const existing = await getExistingFollow(ctx, userId, args.publisherId);
    return Boolean(existing);
  },
});

export const followPublisher = mutation({
  args: {
    publisherId: v.id("publishers"),
    notifications: v.optional(notificationPreferenceValidator),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx);
    return await followPublisherForUser(ctx, {
      followerUserId: userId,
      publisherId: args.publisherId,
      notifications: args.notifications,
    });
  },
});

export const unfollowPublisher = mutation({
  args: { publisherId: v.id("publishers") },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx);
    return await unfollowPublisherForUser(ctx, {
      followerUserId: userId,
      publisherId: args.publisherId,
    });
  },
});

export const listFollowedPublishers = query({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
    query: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx);
    return await listPublisherFollowsForUser(ctx, {
      followerUserId: userId,
      cursor: args.cursor,
      limit: args.limit,
      query: args.query,
    });
  },
});

export const followPublisherInternal = internalMutation({
  args: {
    followerUserId: v.id("users"),
    publisherId: v.id("publishers"),
    notifications: v.optional(notificationPreferenceValidator),
  },
  handler: async (ctx, args) => await followPublisherForUser(ctx, args),
});

export const unfollowPublisherInternal = internalMutation({
  args: { followerUserId: v.id("users"), publisherId: v.id("publishers") },
  handler: async (ctx, args) => await unfollowPublisherForUser(ctx, args),
});

export const listFollowedPublishersInternal = internalQuery({
  args: {
    followerUserId: v.id("users"),
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
    query: v.optional(v.string()),
  },
  handler: async (ctx, args) => await listPublisherFollowsForUser(ctx, args),
});
