import { v } from "convex/values";
import { internalMutation, mutation, internalQuery, query } from "./functions";
import { getOptionalActiveAuthUserId, requireUser } from "./lib/access";
import { toPublicSkill } from "./lib/public";
import { insertStatEvent } from "./skillStatEvents";

export const isStarred = query({
  args: { skillId: v.id("skills") },
  handler: async (ctx, args) => {
    const userId = await getOptionalActiveAuthUserId(ctx);
    if (!userId) return false;
    const existing = await ctx.db
      .query("stars")
      .withIndex("by_skill_user", (q) => q.eq("skillId", args.skillId).eq("userId", userId))
      .unique();
    return Boolean(existing);
  },
});

export const toggle = mutation({
  args: { skillId: v.id("skills") },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx);
    const skill = await ctx.db.get(args.skillId);
    if (!skill) throw new Error("Skill not found");

    const existing = await ctx.db
      .query("stars")
      .withIndex("by_skill_user", (q) => q.eq("skillId", args.skillId).eq("userId", userId))
      .unique();

    if (existing) {
      await ctx.db.delete(existing._id);
      await insertStatEvent(ctx, { skillId: skill._id, kind: "unstar" });
      return { starred: false };
    }

    if (skill.softDeletedAt) throw new Error("Skill not found");

    await ctx.db.insert("stars", {
      skillId: args.skillId,
      userId,
      createdAt: Date.now(),
    });

    await insertStatEvent(ctx, { skillId: skill._id, kind: "star" });

    return { starred: true };
  },
});

export const listByUser = query({
  args: { userId: v.id("users"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    const stars = await ctx.db
      .query("stars")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(limit);
    const skills: NonNullable<ReturnType<typeof toPublicSkill>>[] = [];
    for (const star of stars) {
      const skill = await ctx.db.get(star.skillId);
      const publicSkill = toPublicSkill(skill);
      if (!publicSkill) continue;
      skills.push(publicSkill);
    }
    return skills;
  },
});

export const addStarInternal = internalMutation({
  args: { userId: v.id("users"), skillId: v.id("skills") },
  handler: async (ctx, args) => {
    const skill = await ctx.db.get(args.skillId);
    if (!skill || skill.softDeletedAt) throw new Error("Skill not found");
    const existing = await ctx.db
      .query("stars")
      .withIndex("by_skill_user", (q) => q.eq("skillId", args.skillId).eq("userId", args.userId))
      .unique();
    if (existing) return { ok: true as const, starred: true, alreadyStarred: true };

    await ctx.db.insert("stars", {
      skillId: args.skillId,
      userId: args.userId,
      createdAt: Date.now(),
    });

    await insertStatEvent(ctx, { skillId: skill._id, kind: "star" });

    return { ok: true as const, starred: true, alreadyStarred: false };
  },
});

export const removeStarInternal = internalMutation({
  args: { userId: v.id("users"), skillId: v.id("skills") },
  handler: async (ctx, args) => {
    const skill = await ctx.db.get(args.skillId);
    if (!skill) throw new Error("Skill not found");
    const existing = await ctx.db
      .query("stars")
      .withIndex("by_skill_user", (q) => q.eq("skillId", args.skillId).eq("userId", args.userId))
      .unique();
    if (!existing) return { ok: true as const, unstarred: false, alreadyUnstarred: true };

    await ctx.db.delete(existing._id);
    await insertStatEvent(ctx, { skillId: skill._id, kind: "unstar" });

    return { ok: true as const, unstarred: true, alreadyUnstarred: false };
  },
});

export const listStarsByUserInternal = internalQuery({
  args: { userId: v.id("users"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    const skills: NonNullable<ReturnType<typeof toPublicSkill>>[] = [];

    let cursor = null;
    const BATCH_SIZE = 20;
    // Cap total star rows scanned to prevent unbounded reads when many starred
    // skills are hidden or deleted. Allow up to 4x the requested limit before
    // giving up so sparse accounts still get a full page in most cases.
    const MAX_SCAN = limit * 4;
    let scanned = 0;

    while (skills.length < limit && scanned < MAX_SCAN) {
      const remaining = MAX_SCAN - scanned;
      const batchSize = Math.min(BATCH_SIZE, remaining);
      const batch = await ctx.db
        .query("stars")
        .withIndex("by_user", (q) => q.eq("userId", args.userId))
        .order("desc")
        .paginate({ numItems: batchSize, cursor });

      scanned += batch.page.length;

      for (const star of batch.page) {
        if (skills.length >= limit) break;
        const skill = await ctx.db.get(star.skillId);
        const publicSkill = toPublicSkill(skill);
        if (!publicSkill) continue;
        skills.push(publicSkill);
      }

      if (batch.isDone) break;
      cursor = batch.continueCursor;
    }

    return { items: skills };
  },
});
