import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import type { ActionCtx, QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery } from "./functions";
import { buildSkillPresentationIconPath } from "./lib/skillPresentation";

const skillPresentationContentTypeValidator = v.union(
  v.literal("image/png"),
  v.literal("image/jpeg"),
  v.literal("image/webp"),
  v.literal("image/svg+xml"),
);

type SkillPresentationContentType = Doc<"skillPresentationAssets">["contentType"];

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

export async function storeSkillPresentationAsset(
  ctx: Pick<ActionCtx, "runMutation" | "runQuery" | "storage">,
  args: {
    bytes: Uint8Array;
    sha256: string;
    contentType: SkillPresentationContentType;
  },
) {
  const sha256 = normalizeSha256(args.sha256);
  const existing = (await ctx.runQuery(internal.skillPresentationAssets.getBySha256Internal, {
    sha256,
  })) as Doc<"skillPresentationAssets"> | null;
  if (existing) return buildSkillPresentationIconPath(existing.sha256);

  const storageId = await ctx.storage.store(
    new Blob([new Uint8Array(args.bytes)], { type: args.contentType }),
  );
  try {
    const asset = (await ctx.runMutation(internal.skillPresentationAssets.registerInternal, {
      sha256,
      storageId,
      contentType: args.contentType,
      size: args.bytes.byteLength,
    })) as Doc<"skillPresentationAssets">;
    if (asset.storageId !== storageId) await ctx.storage.delete(storageId);
    return buildSkillPresentationIconPath(asset.sha256);
  } catch (error) {
    await ctx.storage.delete(storageId);
    throw error;
  }
}

export async function isDecodableSkillPresentationRaster(
  ctx: Pick<ActionCtx, "runAction">,
  args: {
    bytes: Uint8Array;
    contentType: Exclude<SkillPresentationContentType, "image/svg+xml">;
  },
) {
  return (await ctx.runAction(internal.skillPresentationImageNode.validateRasterInternal, {
    bytes: new Uint8Array(args.bytes).buffer,
    contentType: args.contentType,
  })) as boolean;
}

async function getSkillPresentationAssetByHash(ctx: Pick<QueryCtx, "db">, rawSha256: string) {
  const sha256 = normalizeSha256(rawSha256);
  return await ctx.db
    .query("skillPresentationAssets")
    .withIndex("by_sha256", (query) => query.eq("sha256", sha256))
    .unique();
}

function normalizeSha256(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f\d]{64}$/.test(normalized)) throw new Error("Invalid skill icon SHA-256 digest.");
  return normalized;
}

export type { SkillPresentationContentType };
