import { v } from "convex/values";
import { internalMutation, internalQuery } from "./functions";

export const createInternal = internalMutation({
  args: {
    packageId: v.id("packages"),
    version: v.string(),
    prefix: v.string(),
    tokenHash: v.string(),
    provider: v.literal("github-actions"),
    repository: v.string(),
    repositoryId: v.string(),
    repositoryOwner: v.string(),
    repositoryOwnerId: v.string(),
    workflowFilename: v.string(),
    environment: v.optional(v.string()),
    runId: v.string(),
    runAttempt: v.string(),
    sha: v.string(),
    ref: v.string(),
    refType: v.optional(v.string()),
    actor: v.optional(v.string()),
    actorId: v.optional(v.string()),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("packagePublishTokens", {
      ...args,
      createdAt: now,
      lastUsedAt: undefined,
      revokedAt: undefined,
    });
  },
});

export const getByHashInternal = internalQuery({
  args: { tokenHash: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("packagePublishTokens")
      .withIndex("by_hash", (q) => q.eq("tokenHash", args.tokenHash))
      .unique();
  },
});

export const getByIdInternal = internalQuery({
  args: { tokenId: v.id("packagePublishTokens") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.tokenId);
  },
});

export const touchInternal = internalMutation({
  args: { tokenId: v.id("packagePublishTokens") },
  handler: async (ctx, args) => {
    const token = await ctx.db.get(args.tokenId);
    if (!token || token.revokedAt || token.expiresAt <= Date.now()) return;
    await ctx.db.patch(token._id, { lastUsedAt: Date.now() });
  },
});

export const revokeInternal = internalMutation({
  args: { tokenId: v.id("packagePublishTokens") },
  handler: async (ctx, args) => {
    const token = await ctx.db.get(args.tokenId);
    if (!token || token.revokedAt) return;
    await ctx.db.patch(token._id, { revokedAt: Date.now() });
  },
});
