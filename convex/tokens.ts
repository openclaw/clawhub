import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query } from "./functions";
import { requireUser } from "./lib/access";
import { generateToken, hashToken } from "./lib/tokens";

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireUser(ctx);
    const tokens = await ctx.db
      .query("apiTokens")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(100);
    return tokens.map((token) => ({
      _id: token._id,
      label: token.label,
      prefix: token.prefix,
      createdAt: token.createdAt,
      lastUsedAt: token.lastUsedAt,
      revokedAt: token.revokedAt,
    }));
  },
});

export const create = mutation({
  args: { label: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx);
    const label = args.label.trim() || "CLI token";
    const { token, prefix } = generateToken();
    const tokenHash = await hashToken(token);

    const now = Date.now();
    const tokenId = await ctx.db.insert("apiTokens", {
      userId,
      label,
      prefix,
      tokenHash,
      createdAt: now,
      lastUsedAt: undefined,
      revokedAt: undefined,
    });

    return { token, tokenId, label, prefix, createdAt: now };
  },
});

export const revoke = mutation({
  args: { tokenId: v.id("apiTokens") },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx);
    const token = await ctx.db.get(args.tokenId);
    if (!token) throw new Error("Token not found");
    if (token.userId !== userId) throw new Error("Forbidden");
    if (token.revokedAt) return;
    await ctx.db.patch(token._id, { revokedAt: Date.now() });
  },
});

export const getByHashInternal = internalQuery({
  args: { tokenHash: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("apiTokens")
      .withIndex("by_hash", (q) => q.eq("tokenHash", args.tokenHash))
      .unique();
  },
});

export const touchInternal = internalMutation({
  args: { tokenId: v.id("apiTokens") },
  handler: async (ctx, args) => {
    const token = await ctx.db.get(args.tokenId);
    if (!token || token.revokedAt) return;
    await ctx.db.patch(token._id, { lastUsedAt: Date.now() });
  },
});

export const getUserForTokenInternal = internalQuery({
  args: { tokenId: v.id("apiTokens") },
  handler: async (ctx, args): Promise<Doc<"users"> | null> => {
    const token = await ctx.db.get(args.tokenId);
    if (!token || token.revokedAt) return null;
    return ctx.db.get(token.userId);
  },
});
