"use node";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { runStaticPublishScan } from "./lib/staticPublishScan";

// Package publish actions run in the Convex runtime, whose 64 MiB action ceiling
// dies decoding every file of a large ClawPack for the moderation scan. The
// Node runtime has 512 MiB, so the scan itself crosses over here unchanged.
export const runStaticPublishScanInternal = internalAction({
  args: {
    slug: v.string(),
    displayName: v.string(),
    summary: v.optional(v.string()),
    frontmatter: v.optional(v.any()),
    metadata: v.optional(v.any()),
    files: v.array(
      v.object({
        path: v.string(),
        size: v.number(),
        storageId: v.id("_storage"),
        contentType: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => await runStaticPublishScan(ctx, args),
});
