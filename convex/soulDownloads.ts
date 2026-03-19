import { v } from "convex/values";
import { internalMutation } from "./functions";

export const incrementInternal = internalMutation({
  args: { soulId: v.id("souls") },
  handler: async (ctx, args) => {
    const soul = await ctx.db.get(args.soulId);
    if (!soul) return;
    await ctx.db.patch(soul._id, {
      stats: { ...soul.stats, downloads: soul.stats.downloads + 1 },
      updatedAt: Date.now(),
    });
  },
});
