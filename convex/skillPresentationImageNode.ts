"use node";

import { v } from "convex/values";
import sharp from "sharp";
import { internalAction } from "./_generated/server";

const MAX_ICON_PIXELS = 2048 * 2048;

export const validateRasterInternal = internalAction({
  args: {
    bytes: v.bytes(),
    contentType: v.union(v.literal("image/png"), v.literal("image/jpeg"), v.literal("image/webp")),
  },
  handler: async (_ctx, args) => {
    try {
      const input = Buffer.from(args.bytes);
      const image = sharp(input, { failOn: "warning", limitInputPixels: MAX_ICON_PIXELS });
      const metadata = await image.metadata();
      const expectedFormat = args.contentType === "image/jpeg" ? "jpeg" : args.contentType.slice(6);
      if (
        metadata.format !== expectedFormat ||
        !metadata.width ||
        !metadata.height ||
        metadata.width * metadata.height > MAX_ICON_PIXELS
      ) {
        return false;
      }
      await image.raw().toBuffer();
      return true;
    } catch {
      return false;
    }
  },
});
