import { CATALOG_FEED_ID, CATALOG_SKILLS_FEED_ID } from "clawhub-schema";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery, mutation, query } from "./functions";
import { requireUser } from "./lib/access";

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 100;
const MAX_ITEM_WATCHES = 500;
const MAX_ACTIVE_INBOX_ITEMS = 200;
const MAX_ID_BYTES = 256;
const MAX_URL_BYTES = 2_048;
const INBOX_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;
const PRUNE_BATCH_SIZE = 200;
const ACCOUNT_DELETE_BATCH_SIZE = 200;
const WATCHER_FANOUT_BATCH_SIZE = 25;

const representationValidator = v.union(v.literal("catalog"), v.literal("publisher"));
const itemKindValidator = v.union(v.literal("plugin"), v.literal("skill"));
const watchSourceValidator = v.union(v.literal("explicit"), v.literal("installed-sync"));
const notificationReasonValidator = v.union(
  v.literal("updated"),
  v.literal("removed"),
  v.literal("blocked"),
  v.literal("security-state-changed"),
);

type WatchIdentity = {
  feedId: string;
  representation: "catalog" | "publisher";
  itemKind: "plugin" | "skill";
  itemId: string;
};

type NotificationReason = "updated" | "removed" | "blocked" | "security-state-changed";
type NormalizedInboxEvent = WatchIdentity & {
  userId: Id<"users">;
  eventId: string;
  sequence: number;
  reason: NotificationReason;
  signedStateUrl: string;
  createdAt: number;
};

function utf8Length(value: string) {
  return new TextEncoder().encode(value).length;
}

function requireBoundedIdentity(value: string, name: string) {
  const normalized = value.trim();
  if (!normalized || utf8Length(normalized) > MAX_ID_BYTES) {
    throw new ConvexError(`${name} must be between 1 and ${MAX_ID_BYTES} UTF-8 bytes`);
  }
  return normalized;
}

function normalizeIdentity(identity: WatchIdentity): WatchIdentity {
  return {
    feedId: requireBoundedIdentity(identity.feedId, "feedId"),
    representation: identity.representation,
    itemKind: identity.itemKind,
    itemId: requireBoundedIdentity(identity.itemId, "itemId"),
  };
}

function requireSupportedPublicCatalogWatch(identity: WatchIdentity) {
  const supported =
    (identity.itemKind === "plugin" && identity.feedId === CATALOG_FEED_ID) ||
    (identity.itemKind === "skill" && identity.feedId === CATALOG_SKILLS_FEED_ID);
  if (!supported) {
    throw new ConvexError("Only official ClawHub plugin and skill catalog watches are available");
  }
}

function requireSignedStateUrl(value: string) {
  if (!value || utf8Length(value) > MAX_URL_BYTES) {
    throw new ConvexError("signedStateUrl is invalid");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConvexError("signedStateUrl must be absolute HTTPS");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new ConvexError("signedStateUrl must be absolute HTTPS without credentials");
  }
  return url.href;
}

function clampListLimit(value: number | undefined) {
  if (!Number.isFinite(value ?? DEFAULT_LIST_LIMIT)) return DEFAULT_LIST_LIMIT;
  return Math.min(Math.max(Math.trunc(value ?? DEFAULT_LIST_LIMIT), 1), MAX_LIST_LIMIT);
}

async function getWatch(
  ctx: Pick<QueryCtx | MutationCtx, "db">,
  userId: Id<"users">,
  identity: WatchIdentity,
) {
  return await ctx.db
    .query("feedItemWatches")
    .withIndex("by_user_feed_representation_kind_item", (q) =>
      q
        .eq("userId", userId)
        .eq("feedId", identity.feedId)
        .eq("representation", identity.representation)
        .eq("itemKind", identity.itemKind)
        .eq("itemId", identity.itemId),
    )
    .unique();
}

async function watchItemForUser(
  ctx: MutationCtx,
  args: WatchIdentity & { userId: Id<"users">; source: "explicit" | "installed-sync" },
) {
  const identity = normalizeIdentity(args);
  const existing = await getWatch(ctx, args.userId, identity);
  const now = Date.now();
  if (existing) {
    if (existing.source === "installed-sync" && args.source === "explicit") {
      await ctx.db.patch(existing._id, { source: "explicit", updatedAt: now });
      return {
        ok: true as const,
        created: false,
        watchId: existing._id,
        source: "explicit" as const,
      };
    }
    return { ok: true as const, created: false, watchId: existing._id, source: existing.source };
  }

  const watches = await ctx.db
    .query("feedItemWatches")
    .withIndex("by_user_and_updatedAt", (q) => q.eq("userId", args.userId))
    .take(MAX_ITEM_WATCHES);
  if (watches.length >= MAX_ITEM_WATCHES) {
    throw new ConvexError(`An account can watch up to ${MAX_ITEM_WATCHES} feed items`);
  }

  const watchId = await ctx.db.insert("feedItemWatches", {
    userId: args.userId,
    ...identity,
    source: args.source,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.insert("auditLogs", {
    actorUserId: args.userId,
    action: "feed.item-watch.create",
    targetType: "feed-item",
    targetId: identity.itemId,
    metadata: { ...identity, source: args.source },
    createdAt: now,
  });
  return { ok: true as const, created: true, watchId, source: args.source };
}

async function unwatchItemForUser(ctx: MutationCtx, args: WatchIdentity & { userId: Id<"users"> }) {
  const identity = normalizeIdentity(args);
  const existing = await getWatch(ctx, args.userId, identity);
  if (!existing) return { ok: true as const, removed: false };
  const now = Date.now();
  await ctx.db.delete(existing._id);
  await ctx.db.insert("auditLogs", {
    actorUserId: args.userId,
    action: "feed.item-watch.delete",
    targetType: "feed-item",
    targetId: identity.itemId,
    metadata: identity,
    createdAt: now,
  });
  return { ok: true as const, removed: true };
}

async function listWatchesForUser(
  ctx: QueryCtx,
  args: { userId: Id<"users">; cursor?: string | null; limit?: number },
) {
  const page = await ctx.db
    .query("feedItemWatches")
    .withIndex("by_user_and_updatedAt", (q) => q.eq("userId", args.userId))
    .order("desc")
    .paginate({ cursor: args.cursor ?? null, numItems: clampListLimit(args.limit) });
  return {
    ok: true as const,
    items: page.page.map(
      ({ _id, feedId, representation, itemKind, itemId, source, createdAt, updatedAt }) => ({
        watchId: _id,
        feedId,
        representation,
        itemKind,
        itemId,
        source,
        createdAt,
        updatedAt,
      }),
    ),
    nextCursor: page.isDone ? null : page.continueCursor,
  };
}

async function listInboxForUser(
  ctx: QueryCtx,
  args: { userId: Id<"users">; cursor?: string | null; limit?: number },
) {
  const page = await ctx.db
    .query("feedNotificationInbox")
    .withIndex("by_user_archived_createdAt", (q) =>
      q.eq("userId", args.userId).eq("archived", false),
    )
    .order("desc")
    .paginate({ cursor: args.cursor ?? null, numItems: clampListLimit(args.limit) });
  return {
    ok: true as const,
    items: page.page.map(
      ({
        _id,
        eventId,
        feedId,
        representation,
        itemKind,
        itemId,
        sequence,
        reason,
        signedStateUrl,
        readAt,
        dismissedAt,
        createdAt,
        updatedAt,
        expiresAt,
      }) => ({
        notificationId: _id,
        eventId,
        feedId,
        representation,
        itemKind,
        itemId,
        sequence,
        reason,
        signedStateUrl,
        ...(readAt === undefined ? {} : { readAt }),
        ...(dismissedAt === undefined ? {} : { dismissedAt }),
        createdAt,
        updatedAt,
        expiresAt,
      }),
    ),
    nextCursor: page.isDone ? null : page.continueCursor,
  };
}

async function acknowledgeInboxItemForUser(
  ctx: MutationCtx,
  args: {
    userId: Id<"users">;
    notificationId: string;
    action: "read" | "dismiss";
  },
) {
  const notificationId = ctx.db.normalizeId("feedNotificationInbox", args.notificationId);
  if (!notificationId) throw new ConvexError("Invalid notification id");
  const item = await ctx.db.get(notificationId);
  if (!item || item.userId !== args.userId) throw new ConvexError("Notification not found");
  const alreadyApplied =
    args.action === "read"
      ? item.readAt !== undefined
      : item.dismissedAt !== undefined && item.archived;
  if (alreadyApplied) {
    return { ok: true as const, notificationId: item._id, action: args.action };
  }
  const now = Date.now();
  await ctx.db.patch(item._id, {
    readAt: item.readAt ?? now,
    ...(args.action === "dismiss" ? { dismissedAt: item.dismissedAt ?? now, archived: true } : {}),
    updatedAt: now,
  });
  return { ok: true as const, notificationId: item._id, action: args.action };
}

async function insertInboxEventForWatch(
  ctx: MutationCtx,
  args: NormalizedInboxEvent,
  watchCreatedAt: number,
) {
  if (args.createdAt < watchCreatedAt) {
    return { ok: true as const, created: false, reason: "before-watch" as const };
  }
  const existing = await ctx.db
    .query("feedNotificationInbox")
    .withIndex("by_user_and_eventId", (q) =>
      q.eq("userId", args.userId).eq("eventId", args.eventId),
    )
    .unique();
  if (existing) {
    return {
      ok: true as const,
      created: false,
      reason: "duplicate" as const,
      notificationId: existing._id,
    };
  }
  const active = await ctx.db
    .query("feedNotificationInbox")
    .withIndex("by_user_archived_createdAt", (q) =>
      q.eq("userId", args.userId).eq("archived", false),
    )
    .order("desc")
    .take(MAX_ACTIVE_INBOX_ITEMS);
  const oldestActive = active.length === MAX_ACTIVE_INBOX_ITEMS ? active.at(-1) : undefined;
  const archiveIncoming = oldestActive !== undefined && args.createdAt <= oldestActive.createdAt;
  const now = Date.now();
  if (oldestActive && !archiveIncoming) {
    await ctx.db.patch(oldestActive._id, { archived: true, updatedAt: now });
  }
  const notificationId = await ctx.db.insert("feedNotificationInbox", {
    userId: args.userId,
    eventId: args.eventId,
    feedId: args.feedId,
    representation: args.representation,
    itemKind: args.itemKind,
    itemId: args.itemId,
    sequence: args.sequence,
    reason: args.reason,
    signedStateUrl: args.signedStateUrl,
    archived: archiveIncoming,
    createdAt: args.createdAt,
    updatedAt: args.createdAt,
    expiresAt: args.createdAt + INBOX_RETENTION_MS,
  });
  return { ok: true as const, created: true, notificationId };
}

export const watchItem = mutation({
  args: {
    feedId: v.string(),
    representation: v.literal("catalog"),
    itemKind: itemKindValidator,
    itemId: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx);
    requireSupportedPublicCatalogWatch(args);
    return await watchItemForUser(ctx, { ...args, userId, source: "explicit" });
  },
});

export const unwatchItem = mutation({
  args: {
    feedId: v.string(),
    representation: representationValidator,
    itemKind: itemKindValidator,
    itemId: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx);
    return await unwatchItemForUser(ctx, { ...args, userId });
  },
});

export const listWatches = query({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx);
    return await listWatchesForUser(ctx, { ...args, userId });
  },
});

export const listInbox = query({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx);
    return await listInboxForUser(ctx, { ...args, userId });
  },
});

export const acknowledgeInboxItem = mutation({
  args: {
    notificationId: v.id("feedNotificationInbox"),
    action: v.union(v.literal("read"), v.literal("dismiss")),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx);
    return await acknowledgeInboxItemForUser(ctx, { ...args, userId });
  },
});

export const watchItemInternal = internalMutation({
  args: {
    userId: v.id("users"),
    feedId: v.string(),
    representation: representationValidator,
    itemKind: itemKindValidator,
    itemId: v.string(),
    source: watchSourceValidator,
  },
  handler: watchItemForUser,
});

export const unwatchItemInternal = internalMutation({
  args: {
    userId: v.id("users"),
    feedId: v.string(),
    representation: representationValidator,
    itemKind: itemKindValidator,
    itemId: v.string(),
  },
  handler: unwatchItemForUser,
});

export const listWatchesInternal = internalQuery({
  args: {
    userId: v.id("users"),
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  handler: listWatchesForUser,
});

export const listInboxInternal = internalQuery({
  args: {
    userId: v.id("users"),
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  handler: listInboxForUser,
});

export const acknowledgeInboxItemInternal = internalMutation({
  args: {
    userId: v.id("users"),
    notificationId: v.string(),
    action: v.union(v.literal("read"), v.literal("dismiss")),
  },
  handler: acknowledgeInboxItemForUser,
});

export const deleteAccountNotificationStateInternal = internalMutation({
  args: {
    userId: v.id("users"),
    watchCursor: v.optional(v.string()),
    inboxCursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const watchPage = await ctx.db
      .query("feedItemWatches")
      .withIndex("by_user_and_updatedAt", (q) => q.eq("userId", args.userId))
      .paginate({ cursor: args.watchCursor ?? null, numItems: ACCOUNT_DELETE_BATCH_SIZE });
    const inboxPage = await ctx.db
      .query("feedNotificationInbox")
      .withIndex("by_user_and_eventId", (q) => q.eq("userId", args.userId))
      .paginate({ cursor: args.inboxCursor ?? null, numItems: ACCOUNT_DELETE_BATCH_SIZE });
    for (const watch of watchPage.page) await ctx.db.delete(watch._id);
    for (const notification of inboxPage.page) await ctx.db.delete(notification._id);

    const scheduled = !watchPage.isDone || !inboxPage.isDone;
    if (scheduled) {
      await ctx.scheduler.runAfter(
        0,
        internal.feedItemNotifications.deleteAccountNotificationStateInternal,
        {
          userId: args.userId,
          ...(watchPage.isDone ? {} : { watchCursor: watchPage.continueCursor }),
          ...(inboxPage.isDone ? {} : { inboxCursor: inboxPage.continueCursor }),
        },
      );
    }
    return {
      feedItemWatches: watchPage.page.length,
      feedNotificationInbox: inboxPage.page.length,
      scheduled,
    };
  },
});

export const recordInboxEventInternal = internalMutation({
  args: {
    userId: v.id("users"),
    eventId: v.string(),
    feedId: v.string(),
    representation: representationValidator,
    itemKind: itemKindValidator,
    itemId: v.string(),
    sequence: v.number(),
    reason: notificationReasonValidator,
    signedStateUrl: v.string(),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    const identity = normalizeIdentity(args);
    const eventId = requireBoundedIdentity(args.eventId, "eventId");
    if (!Number.isSafeInteger(args.sequence) || args.sequence < 0) {
      throw new ConvexError("sequence must be a non-negative safe integer");
    }
    if (!Number.isSafeInteger(args.createdAt) || args.createdAt < 0) {
      throw new ConvexError("createdAt must be a non-negative safe integer");
    }
    if (!Number.isSafeInteger(args.createdAt + INBOX_RETENTION_MS)) {
      throw new ConvexError("createdAt cannot produce a valid inbox expiry");
    }
    const signedStateUrl = requireSignedStateUrl(args.signedStateUrl);
    const now = Date.now();
    if (args.createdAt > now + 5 * 60 * 1_000) {
      throw new ConvexError("createdAt cannot be more than five minutes in the future");
    }
    if (args.createdAt + INBOX_RETENTION_MS <= now) {
      return { ok: true as const, created: false, reason: "expired" as const };
    }
    const watch = await getWatch(ctx, args.userId, identity);
    if (!watch) return { ok: true as const, created: false, reason: "not-watched" as const };
    return await insertInboxEventForWatch(
      ctx,
      {
        userId: args.userId,
        ...identity,
        eventId,
        sequence: args.sequence,
        reason: args.reason,
        signedStateUrl,
        createdAt: args.createdAt,
      },
      watch.createdAt,
    );
  },
});

export const processCatalogMaterializationInternal = internalMutation({
  args: { materializationId: v.id("feedNotificationMaterializations") },
  handler: async (ctx, args) => {
    const materialization = await ctx.db.get(args.materializationId);
    if (!materialization) return { ok: true as const, status: "missing" as const };
    const now = Date.now();
    if (materialization.expiresAt <= now) {
      await ctx.db.delete(materialization._id);
      return { ok: true as const, status: "expired" as const };
    }
    const change = materialization.changes[materialization.nextChangeIndex];
    if (!change) {
      await ctx.db.delete(materialization._id);
      return { ok: true as const, status: "complete" as const };
    }

    const page = await ctx.db
      .query("feedItemWatches")
      .withIndex("by_feed_representation_kind_item", (q) =>
        q
          .eq("feedId", materialization.feedId)
          .eq("representation", "catalog")
          .eq("itemKind", materialization.itemKind)
          .eq("itemId", change.itemId),
      )
      .paginate({
        cursor: materialization.watchCursor ?? null,
        numItems: WATCHER_FANOUT_BATCH_SIZE,
      });
    let created = 0;
    for (const watch of page.page) {
      const result = await insertInboxEventForWatch(
        ctx,
        {
          userId: watch.userId,
          feedId: materialization.feedId,
          representation: "catalog",
          itemKind: materialization.itemKind,
          itemId: change.itemId,
          eventId: `catalog:${materialization.feedId}:${materialization.sequence}:${materialization.nextChangeIndex}`,
          sequence: materialization.sequence,
          reason: change.reason,
          signedStateUrl: materialization.signedStateUrl,
          createdAt: materialization.createdAt,
        },
        watch.createdAt,
      );
      if (result.created) created += 1;
    }

    const nextChangeIndex = page.isDone
      ? materialization.nextChangeIndex + 1
      : materialization.nextChangeIndex;
    if (page.isDone && nextChangeIndex >= materialization.changes.length) {
      await ctx.db.delete(materialization._id);
      return { ok: true as const, status: "complete" as const, created };
    }
    await ctx.db.patch(materialization._id, {
      nextChangeIndex,
      watchCursor: page.isDone ? undefined : page.continueCursor,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.feedItemNotifications.processCatalogMaterializationInternal,
      { materializationId: materialization._id },
    );
    return { ok: true as const, status: "scheduled" as const, created };
  },
});

export const pruneExpiredInboxInternal = internalMutation({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const expired = await ctx.db
      .query("feedNotificationInbox")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", now))
      .take(PRUNE_BATCH_SIZE);
    for (const item of expired) await ctx.db.delete(item._id);
    const expiredMaterializations = await ctx.db
      .query("feedNotificationMaterializations")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", now))
      .take(PRUNE_BATCH_SIZE);
    for (const materialization of expiredMaterializations) {
      await ctx.db.delete(materialization._id);
    }
    const scheduled =
      expired.length === PRUNE_BATCH_SIZE || expiredMaterializations.length === PRUNE_BATCH_SIZE;
    if (scheduled) {
      await ctx.scheduler.runAfter(0, internal.feedItemNotifications.pruneExpiredInboxInternal, {
        now,
      });
    }
    return {
      deleted: expired.length,
      materializationsDeleted: expiredMaterializations.length,
      scheduled,
    };
  },
});
