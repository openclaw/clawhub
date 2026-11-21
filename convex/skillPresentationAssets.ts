import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery } from "./functions";
import { normalizeSha256 } from "./lib/skillPresentationAssetStorage";

const skillPresentationContentTypeValidator = v.union(
  v.literal("image/png"),
  v.literal("image/jpeg"),
  v.literal("image/webp"),
  v.literal("image/svg+xml"),
);

export const getBySha256Internal = internalQuery({
  args: { sha256: v.string() },
  handler: async (ctx, args) => getSkillPresentationAssetByHash(ctx, args.sha256),
});

export const registerInternal = internalMutation({
  args: {
    sha256: v.string(),
    storageId: v.id("_storage"),
    contentType: skillPresentationContentTypeValidator,
    size: v.number(),
  },
  handler: async (ctx, args) => {
    const sha256 = normalizeSha256(args.sha256);
    const existing = await getSkillPresentationAssetByHash(ctx, sha256);
    if (existing) return existing;
    const assetId = await ctx.db.insert("skillPresentationAssets", {
      ...args,
      sha256,
      createdAt: Date.now(),
    });
    return (await ctx.db.get(assetId)) as Doc<"skillPresentationAssets">;
  },
});

async function getSkillPresentationAssetByHash(ctx: Pick<QueryCtx, "db">, rawSha256: string) {
  const sha256 = normalizeSha256(rawSha256);
  return await ctx.db
    .query("skillPresentationAssets")
    .withIndex("by_sha256", (query) => query.eq("sha256", sha256))
    .unique();
}
