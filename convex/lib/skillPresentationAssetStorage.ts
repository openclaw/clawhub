import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { buildSkillPresentationIconPath } from "./skillPresentation";

type SkillPresentationContentType = Doc<"skillPresentationAssets">["contentType"];

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

export function normalizeSha256(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f\d]{64}$/.test(normalized)) throw new Error("Invalid skill icon SHA-256 digest.");
  return normalized;
}

export type { SkillPresentationContentType };
