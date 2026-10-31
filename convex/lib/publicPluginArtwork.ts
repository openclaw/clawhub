import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

const MAX_ARTWORK_CARDS = 25;
const RASTER_CONTENT_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const HOSTED_ICON = /^\/api\/v1\/skill-icons\/([a-f\d]{64})$/;

export type PublicPluginArtwork = { iconAssetUrl?: string };

export async function withPublicPluginArtwork<T extends { icon?: string | null }>(
  ctx: Pick<QueryCtx, "db" | "storage">,
  items: T[],
): Promise<Array<T & PublicPluginArtwork>> {
  const urls = new Map<string, Promise<string | null>>();
  return await Promise.all(
    items.map(async (item, index) => {
      if (index >= MAX_ARTWORK_CARDS) return item;
      const sha256 = HOSTED_ICON.exec(item.icon ?? "")?.[1];
      if (!sha256) return item;
      let pending = urls.get(sha256);
      if (!pending) {
        pending = readRasterUrl(ctx, sha256);
        urls.set(sha256, pending);
      }
      const iconAssetUrl = await pending;
      return iconAssetUrl ? { ...item, iconAssetUrl } : item;
    }),
  );
}

async function readRasterUrl(ctx: Pick<QueryCtx, "db" | "storage">, sha256: string) {
  const asset = await ctx.db
    .query("skillPresentationAssets")
    .withIndex("by_sha256", (q) => q.eq("sha256", sha256))
    .unique();
  if (!asset || !RASTER_CONTENT_TYPES.has(asset.contentType)) return null;

  // SVGs retain the sandboxed HTTP representation. A raster URL must bind to
  // the same stored bytes and MIME type as the content-addressed public icon.
  const stored = await ctx.db.system.get("_storage", asset.storageId);
  if (!isDirectRasterRepresentation(asset, stored)) return null;
  return await ctx.storage.getUrl(asset.storageId);
}

export function isDirectRasterRepresentation(
  asset: Pick<Doc<"skillPresentationAssets">, "sha256" | "contentType" | "size">,
  stored: { sha256: string; contentType?: string; size: number } | null,
) {
  if (!RASTER_CONTENT_TYPES.has(asset.contentType) || !/^[a-f\d]{64}$/.test(asset.sha256))
    return false;
  // Convex storage metadata encodes SHA-256 as base64; public icon paths use hex.
  const digest = btoa(
    String.fromCharCode(
      ...(asset.sha256.match(/../g) ?? []).map((byte) => Number.parseInt(byte, 16)),
    ),
  );
  return (
    stored !== null &&
    stored.sha256 === digest &&
    stored.contentType === asset.contentType &&
    stored.size === asset.size
  );
}
