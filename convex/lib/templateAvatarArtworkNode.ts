"use node";

import { v } from "convex/values";
import sharp from "sharp";
import { internalAction } from "../_generated/server";
import {
  MAX_SKILL_PRESENTATION_ICON_BYTES,
  validateSkillPresentationIcon,
} from "./skillPresentation";
import { staticTemplateAvatarSvg } from "./templateAvatarArtworkSvg";

type AvatarFormat = "png" | "jpeg" | "webp" | "gif" | "svg";
const MAX_INPUT_PIXELS = 2048 * 2048;
const OUTPUT_SIDE = 256;

function isAnimatedPng(bytes: Buffer) {
  // libvips may expose only the default frame of APNG. Inspect real chunk boundaries.
  for (let offset = 8; offset + 12 <= bytes.length; offset += 12 + bytes.readUInt32BE(offset)) {
    if (bytes.toString("ascii", offset + 4, offset + 8) === "acTL") return true;
  }
  return false;
}

/** Returns a fully decoded, metadata-free PNG. No original avatar bytes are hosted. */
export async function renderTemplateAvatarPng(
  bytes: ArrayBuffer,
  format: AvatarFormat,
): Promise<ArrayBuffer | null> {
  if (!bytes.byteLength || bytes.byteLength > MAX_SKILL_PRESENTATION_ICON_BYTES) return null;
  try {
    let input = Buffer.from(bytes);
    if (format === "svg") {
      input = Buffer.from(staticTemplateAvatarSvg(input, MAX_INPUT_PIXELS, OUTPUT_SIDE));
    } else if (format === "gif") {
      if (!["GIF87a", "GIF89a"].includes(input.toString("latin1", 0, 6))) return null;
    } else {
      // Do not let libvips auto-detect untrusted XML from a file claimed to be raster.
      validateSkillPresentationIcon({ path: "avatar." + format, bytes: input });
      if (format === "png" && isAnimatedPng(input)) return null;
    }
    const image = sharp(input, {
      failOn: "warning",
      limitInputPixels: MAX_INPUT_PIXELS,
      limitInputChannels: 4,
    });
    const meta = await image.metadata();
    if (
      meta.format !== format ||
      (meta.pages ?? 1) !== 1 ||
      !meta.width ||
      !meta.height ||
      meta.width * meta.height > MAX_INPUT_PIXELS
    )
      return null;
    const png = await image
      .timeout({ seconds: 3 })
      .autoOrient()
      .resize({ width: OUTPUT_SIDE, height: OUTPUT_SIDE, fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
    return png.byteLength <= MAX_SKILL_PRESENTATION_ICON_BYTES ? new Uint8Array(png).buffer : null;
  } catch {
    return null;
  }
}

export const renderPngInternal = internalAction({
  args: {
    bytes: v.bytes(),
    format: v.union(
      v.literal("png"),
      v.literal("jpeg"),
      v.literal("webp"),
      v.literal("gif"),
      v.literal("svg"),
    ),
  },
  handler: async (_ctx, { bytes, format }): Promise<ArrayBuffer | null> =>
    renderTemplateAvatarPng(bytes, format),
});
