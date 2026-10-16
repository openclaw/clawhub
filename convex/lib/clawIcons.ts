import { resolveClawAvatarSource, type ClawManifest } from "clawhub-schema";
import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import {
  isDecodableSkillPresentationRaster,
  storeSkillPresentationAsset,
} from "../skillPresentationAssets";
import { sha256Hex } from "./clawpack";
import {
  MAX_SKILL_PRESENTATION_ICON_BYTES,
  validateSkillPresentationIcon,
} from "./skillPresentation";

/** Derive the listing icon from the identity installed by Add, never a separate icon field. */
export async function resolveClawIcon(
  ctx: Pick<ActionCtx, "storage" | "runAction" | "runQuery" | "runMutation">,
  manifest: ClawManifest,
  files: Array<{ path: string; size: number; sha256: string; storageId: string }>,
): Promise<string | undefined> {
  const source = resolveClawAvatarSource(manifest);
  if (!source) return undefined;
  let bytes: Uint8Array;
  let path: string;
  const data = /^data:(image\/(?:png|jpeg|webp|svg\+xml))((?:;[^,]*)?),(.*)$/is.exec(source);
  if (source.toLowerCase().startsWith("data:")) {
    if (!data || source.length > MAX_SKILL_PRESENTATION_ICON_BYTES * 4) return undefined;
    try {
      bytes = /(?:^|;)base64(?:;|$)/i.test(data[2])
        ? Uint8Array.from(atob(data[3]), (char) => char.charCodeAt(0))
        : new TextEncoder().encode(decodeURIComponent(data[3]));
    } catch {
      return undefined;
    }
    path = `avatar.${data[1].toLowerCase() === "image/svg+xml" ? "svg" : data[1].slice(6).toLowerCase()}`;
  } else {
    const file = files.find((entry) => entry.path === source);
    if (!file || file.size > MAX_SKILL_PRESENTATION_ICON_BYTES) return undefined;
    const blob = await ctx.storage.get(file.storageId as Id<"_storage">);
    if (!blob) throw new ConvexError("Claw avatar could not be read. Please retry.");
    if (blob.size > MAX_SKILL_PRESENTATION_ICON_BYTES) return undefined;
    bytes = new Uint8Array(await blob.arrayBuffer());
    if ((await sha256Hex(bytes)) !== file.sha256.toLowerCase())
      throw new ConvexError("Claw avatar changed during upload. Please retry.");
    // The source may be renamed during Add; the installed filename defines its format.
    path = manifest.agent.identity?.avatar ?? source;
  }
  let contentType: ReturnType<typeof validateSkillPresentationIcon>["contentType"];
  try {
    contentType = validateSkillPresentationIcon({ path, bytes }).contentType;
  } catch {
    return undefined;
  }
  if (
    contentType !== "image/svg+xml" &&
    !(await isDecodableSkillPresentationRaster(ctx, { bytes, contentType }))
  )
    return undefined;
  return storeSkillPresentationAsset(ctx, { bytes, sha256: await sha256Hex(bytes), contentType });
}
