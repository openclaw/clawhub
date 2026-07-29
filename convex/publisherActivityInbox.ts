import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./functions";
import { requireUser } from "./lib/access";

async function getStateForUser(ctx: QueryCtx | MutationCtx, userId: Id<"users">) {
  return await ctx.db
    .query("publisherActivityInboxState")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

async function requireFollowedGroup(
  ctx: MutationCtx,
  userId: Id<"users">,
  groupId: Id<"publisherActivityGroups">,
) {
  const group = await ctx.db.get(groupId);
  if (!group) throw new ConvexError("Publisher activity group not found");
  const follow = await ctx.db
    .query("publisherFollows")
    .withIndex("by_follower_publisher", (q) =>
      q.eq("followerUserId", userId).eq("publisherId", group.publisherId),
    )
    .unique();
  if (!follow) throw new ConvexError("Publisher activity group not found");
  return group;
}

export const getMine = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireUser(ctx);
    const state = await getStateForUser(ctx, userId);
    return {
      ok: true as const,
      seenThroughSortKey: state?.seenThroughSortKey ?? null,
      updatedAt: state?.updatedAt ?? null,
    };
  },
});

export const markSeenThrough = mutation({
  args: { groupId: v.id("publisherActivityGroups") },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx);
    const group = await requireFollowedGroup(ctx, userId, args.groupId);
    const existing = await getStateForUser(ctx, userId);
    if (existing && existing.seenThroughSortKey >= group.sortKey) {
      return { ok: true as const, seenThroughSortKey: existing.seenThroughSortKey };
    }

    const updatedAt = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { seenThroughSortKey: group.sortKey, updatedAt });
    } else {
      await ctx.db.insert("publisherActivityInboxState", {
        userId,
        seenThroughSortKey: group.sortKey,
        updatedAt,
      });
    }
    return { ok: true as const, seenThroughSortKey: group.sortKey };
  },
});

export async function deletePublisherActivityInboxStateForUser(
  ctx: MutationCtx,
  userId: Id<"users">,
) {
  const state = (await getStateForUser(ctx, userId)) as Doc<"publisherActivityInboxState"> | null;
  if (state) await ctx.db.delete(state._id);
  return Boolean(state);
}
