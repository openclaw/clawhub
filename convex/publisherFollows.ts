import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery, mutation, query } from "./functions";
import { requireUser } from "./lib/access";
import {
  getPersonalPublisherForUser,
  getPublicPublisherVisibility,
  isPublisherActive,
} from "./lib/publishers";

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 100;
const LIST_SCAN_BATCH_SIZE = 100;
const MAX_LIST_SCAN_PAGES = 4;
const DELETE_BATCH_SIZE = 200;
export const MAX_FOLLOWED_PUBLISHERS = 100;

function clampListLimit(limit: number | undefined) {
  if (!Number.isFinite(limit ?? DEFAULT_LIST_LIMIT)) return DEFAULT_LIST_LIMIT;
  return Math.min(Math.max(Math.trunc(limit ?? DEFAULT_LIST_LIMIT), 1), MAX_LIST_LIMIT);
}

async function requireActivePublisher(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  publisherId: Id<"publishers">,
) {
  const publisher = await ctx.db.get(publisherId);
  const visibility = await getPublicPublisherVisibility(ctx, publisher);
  if (!visibility) throw new Error("Publisher not found");
  return visibility;
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
    "_id" | "followerUserId" | "publisherId" | "createdAt" | "updatedAt"
  >,
) {
  return {
    followId: follow._id,
    publisherId: follow.publisherId,
    following: true,
    createdAt: follow.createdAt,
    updatedAt: follow.updatedAt,
  };
}

async function followPublisherForUser(
  ctx: MutationCtx,
  args: {
    followerUserId: Id<"users">;
    publisherId: Id<"publishers">;
  },
) {
  const visibility = await requireActivePublisher(ctx, args.publisherId);
  if (visibility.linkedUser?._id === args.followerUserId) {
    throw new Error("You cannot follow your own publisher");
  }
  const existing = await getExistingFollow(ctx, args.followerUserId, args.publisherId);
  const now = Date.now();

  if (existing) return toFollowResult(existing);

  const followed = await ctx.db
    .query("publisherFollows")
    .withIndex("by_follower_and_updatedAt", (q) => q.eq("followerUserId", args.followerUserId))
    .order("desc")
    .take(MAX_FOLLOWED_PUBLISHERS);
  if (followed.length >= MAX_FOLLOWED_PUBLISHERS) {
    throw new Error(`You can follow up to ${MAX_FOLLOWED_PUBLISHERS} publishers`);
  }

  const followId = await ctx.db.insert("publisherFollows", {
    followerUserId: args.followerUserId,
    publisherId: args.publisherId,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.insert("auditLogs", {
    actorUserId: args.followerUserId,
    action: "publisher.follow.create",
    targetType: "publisher",
    targetId: visibility.publisher._id,
    metadata: {
      handle: visibility.publisher.handle,
    },
    createdAt: now,
  });

  return toFollowResult({
    _id: followId,
    followerUserId: args.followerUserId,
    publisherId: args.publisherId,
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
      .withIndex("by_follower_and_updatedAt", (q) => q.eq("followerUserId", args.followerUserId))
      .order("desc")
      .paginate({ cursor, numItems: remaining });

    for (const follow of page.page) {
      const publisher = await ctx.db.get(follow.publisherId);
      const visibility = await getPublicPublisherVisibility(ctx, publisher);
      if (!visibility) continue;
      const visiblePublisher = visibility.publisher;
      if (
        normalizedQuery &&
        !visiblePublisher.displayName.toLowerCase().includes(normalizedQuery) &&
        !visiblePublisher.handle.toLowerCase().includes(normalizedQuery)
      ) {
        continue;
      }
      items.push({
        ...toFollowResult(follow),
        publisher: {
          _id: visiblePublisher._id,
          handle: visiblePublisher.handle,
          displayName: visiblePublisher.displayName,
          kind: visiblePublisher.kind,
          image: visiblePublisher.image ?? null,
        },
      });
      if (items.length >= limit) break;
    }

    cursor = page.continueCursor;
    isDone = page.isDone;
    scannedPages += 1;
  }

  return { ok: true as const, items, nextCursor: isDone ? null : cursor };
}

function toPublicPublisher(publisher: Doc<"publishers">) {
  return {
    publisherId: publisher._id,
    handle: publisher.handle,
    displayName: publisher.displayName,
    kind: publisher.kind,
    image: publisher.image ?? null,
  };
}

async function getVisiblePersonalPublisherForUser(ctx: QueryCtx, userId: Id<"users">) {
  const user = await ctx.db.get(userId);
  if (!user || user.deletedAt || user.deactivatedAt) return null;
  const publisher = user.personalPublisherId
    ? await ctx.db.get(user.personalPublisherId)
    : await getPersonalPublisherForUser(ctx, userId);
  const visibility = await getPublicPublisherVisibility(ctx, publisher);
  return visibility?.publisher.kind === "user" ? visibility.publisher : null;
}

async function listPublicPublisherConnectionsForTarget(
  ctx: QueryCtx,
  args: {
    publisherId: Id<"publishers">;
    direction: "followers" | "following";
    cursor?: string | null;
    limit?: number;
  },
) {
  const target = await requireActivePublisher(ctx, args.publisherId);
  const limit = clampListLimit(args.limit);
  const items: ReturnType<typeof toPublicPublisher>[] = [];
  let cursor = args.cursor ?? null;
  let isDone = false;
  let scannedPages = 0;

  if (args.direction === "following" && !target.linkedUser) {
    return { ok: true as const, items, nextCursor: null };
  }

  while (items.length < limit && !isDone && scannedPages < MAX_LIST_SCAN_PAGES) {
    const followQuery =
      args.direction === "followers"
        ? ctx.db
            .query("publisherFollows")
            .withIndex("by_publisher_and_updatedAt", (q) => q.eq("publisherId", args.publisherId))
        : ctx.db
            .query("publisherFollows")
            .withIndex("by_follower_and_updatedAt", (q) =>
              q.eq("followerUserId", target.linkedUser!._id),
            );
    const page = await followQuery.order("desc").paginate({
      cursor,
      numItems: Math.min(limit - items.length, LIST_SCAN_BATCH_SIZE),
    });

    for (const follow of page.page) {
      const publisher =
        args.direction === "followers"
          ? await getVisiblePersonalPublisherForUser(ctx, follow.followerUserId)
          : await ctx.db.get(follow.publisherId);
      if (!publisher || !(await getPublicPublisherVisibility(ctx, publisher))) continue;
      items.push(toPublicPublisher(publisher));
      if (items.length >= limit) break;
    }
    cursor = page.continueCursor;
    isDone = page.isDone;
    scannedPages += 1;
  }

  return { ok: true as const, items, nextCursor: isDone ? null : cursor };
}

export const isFollowingPublisher = query({
  args: { publisherId: v.id("publishers") },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx);
    const publisher = await ctx.db.get(args.publisherId);
    if (!(await getPublicPublisherVisibility(ctx, publisher))) return false;
    const existing = await getExistingFollow(ctx, userId, args.publisherId);
    return Boolean(existing);
  },
});

export const followPublisher = mutation({
  args: { publisherId: v.id("publishers") },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx);
    return await followPublisherForUser(ctx, {
      followerUserId: userId,
      publisherId: args.publisherId,
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

export const listPublicPublisherConnections = query({
  args: {
    publisherId: v.id("publishers"),
    direction: v.union(v.literal("followers"), v.literal("following")),
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  handler: listPublicPublisherConnectionsForTarget,
});

export const followPublisherInternal = internalMutation({
  args: {
    followerUserId: v.id("users"),
    publisherId: v.id("publishers"),
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

export const listPublicPublisherConnectionsInternal = internalQuery({
  args: {
    publisherId: v.id("publishers"),
    direction: v.union(v.literal("followers"), v.literal("following")),
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  handler: listPublicPublisherConnectionsForTarget,
});

async function deleteFollowBatch(
  ctx: MutationCtx,
  args:
    | { by: "follower"; followerUserId: Id<"users">; cursor?: string }
    | { by: "publisher"; publisherId: Id<"publishers">; cursor?: string },
) {
  const page = await (
    args.by === "follower"
      ? ctx.db
          .query("publisherFollows")
          .withIndex("by_follower_and_updatedAt", (q) =>
            q.eq("followerUserId", args.followerUserId),
          )
      : ctx.db
          .query("publisherFollows")
          .withIndex("by_publisher_and_updatedAt", (q) => q.eq("publisherId", args.publisherId))
  ).paginate({ cursor: args.cursor ?? null, numItems: DELETE_BATCH_SIZE });
  for (const follow of page.page) await ctx.db.delete(follow._id);
  return page;
}

export const deletePublisherFollowsForFollowerInternal = internalMutation({
  args: { followerUserId: v.id("users"), cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const page = await deleteFollowBatch(ctx, { by: "follower", ...args });
    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.publisherFollows.deletePublisherFollowsForFollowerInternal,
        {
          followerUserId: args.followerUserId,
          cursor: page.continueCursor,
        },
      );
    }
    return { deleted: page.page.length, scheduled: !page.isDone };
  },
});

export const deletePublisherFollowsForPublisherInternal = internalMutation({
  args: { publisherId: v.id("publishers"), cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const page = await deleteFollowBatch(ctx, { by: "publisher", ...args });
    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.publisherFollows.deletePublisherFollowsForPublisherInternal,
        {
          publisherId: args.publisherId,
          cursor: page.continueCursor,
        },
      );
    }
    return { deleted: page.page.length, scheduled: !page.isDone };
  },
});
