import { v } from "convex/values";
import { internalMutation, internalQuery } from "./functions";
import { packagePublishTokenFields } from "./lib/packagePublishTokenValidators";

const TOKEN_TOUCH_MIN_INTERVAL_MS = 15 * 60_000;

export const createInternal = internalMutation({
  args: packagePublishTokenFields,
  handler: async (ctx, args) => {
    const now = Date.now();
    if (args.authorizationKey) {
      const existing = await ctx.db
        .query("packagePublishTokens")
        .withIndex("by_package", (q) =>
          q.eq("packageId", args.packageId).eq("version", args.version),
        )
        .filter((q) => q.eq(q.field("authorizationKey"), args.authorizationKey))
        .first();
      if (existing) {
        throw new Error("This trusted publish authorization transaction was already minted");
      }
    }
    return await ctx.db.insert("packagePublishTokens", {
      ...args,
      createdAt: now,
      lastUsedAt: undefined,
      consumedAt: undefined,
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
    const now = Date.now();
    const token = await ctx.db.get(args.tokenId);
    if (!token || token.revokedAt || token.expiresAt <= now) return;
    if (token.lastUsedAt && now - token.lastUsedAt < TOKEN_TOUCH_MIN_INTERVAL_MS) return;
    await ctx.db.patch(token._id, { lastUsedAt: now });
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
