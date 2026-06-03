import { v } from "convex/values";
import { internalQuery } from "./_generated/server";

export const getByIdInternal = internalQuery({
  args: { sourceId: v.id("githubSkillSources") },
  handler: async (ctx, args) => ctx.db.get(args.sourceId),
});
