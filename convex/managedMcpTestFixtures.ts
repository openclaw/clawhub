import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation } from "./functions";
import { isLocalDevAuthEnabled } from "./lib/devAuth";

export const prepare = internalAction({
  args: {},
  handler: async (ctx): Promise<{ userId: Id<"users">; publisherId: Id<"publishers"> }> => {
    if (!isLocalDevAuthEnabled()) throw new ConvexError("Local dev authentication required");
    const userId = await ctx.runMutation(internal.users.upsertDevPersonaInternal, {
      persona: "admin",
    });
    const publisherId = await ctx.runMutation(internal.managedMcpTestFixtures.ensurePublisher, {
      userId,
    });
    return { userId, publisherId };
  },
});

export const ensurePublisher = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    if (!isLocalDevAuthEnabled()) throw new ConvexError("Local dev authentication required");
    const user = await ctx.db.get(userId);
    if (user?.handle !== "local-admin" || user.role !== "admin")
      throw new ConvexError("Local admin required");
    const now = Date.now();
    const existing = await ctx.db
      .query("publishers")
      .withIndex("by_handle", (q) => q.eq("handle", "openclaw"))
      .unique();
    const publisherId =
      existing?._id ??
      (await ctx.db.insert("publishers", {
        kind: "org",
        handle: "openclaw",
        displayName: "OpenClaw",
        createdAt: now,
        updatedAt: now,
      }));
    const membership = await ctx.db
      .query("publisherMembers")
      .withIndex("by_publisher_user", (q) => q.eq("publisherId", publisherId).eq("userId", userId))
      .unique();
    if (!membership)
      await ctx.db.insert("publisherMembers", {
        publisherId,
        userId,
        role: "owner",
        createdAt: now,
        updatedAt: now,
      });
    const official = await ctx.db
      .query("officialPublishers")
      .withIndex("by_publisher", (q) => q.eq("publisherId", publisherId))
      .unique();
    if (!official)
      await ctx.db.insert("officialPublishers", {
        publisherId,
        createdByUserId: userId,
        reason: "Local managed MCP proof fixture",
        createdAt: now,
        updatedAt: now,
      });
    return publisherId;
  },
});
