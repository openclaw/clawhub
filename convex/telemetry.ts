import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation, mutation } from "./functions";
import { requireUser } from "./lib/access";
import { insertStatEvent } from "./skillStatEvents";

export const reportCliInstallInternal = internalMutation({
  args: {
    userId: v.id("users"),
    slug: v.string(),
    version: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await upsertUserSkillInstall(ctx, args);
  },
});

export const reportCliLegacyInstallBatchInternal = internalMutation({
  args: {
    userId: v.id("users"),
    skills: v.array(
      v.object({
        slug: v.string(),
        version: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const seen = new Set<string>();
    for (const entry of args.skills) {
      const slug = entry.slug.trim().toLowerCase();
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      await upsertUserSkillInstall(ctx, {
        userId: args.userId,
        slug,
        version: entry.version,
      });
    }
  },
});

export const clearMyTelemetry = mutation({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireUser(ctx);
    await clearTelemetryForUser(ctx, { userId });
  },
});

export const clearUserTelemetryInternal = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await clearTelemetryForUser(ctx, { userId: args.userId });
  },
});

async function upsertUserSkillInstall(
  ctx: MutationCtx,
  params: { userId: Id<"users">; slug: string; version?: string },
) {
  const slug = params.slug.trim().toLowerCase();
  if (!slug) return;

  const skill = await ctx.db
    .query("skills")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .unique();
  if (!skill || skill.softDeletedAt) return;

  const now = Date.now();
  const version = params.version?.trim() || undefined;
  const existing = await ctx.db
    .query("userSkillInstalls")
    .withIndex("by_user_skill", (q) => q.eq("userId", params.userId).eq("skillId", skill._id))
    .unique();

  if (existing) {
    const wasLegacyInactive = typeof existing.activeRoots === "number" && existing.activeRoots <= 0;
    await ctx.db.patch(existing._id, {
      activeRoots: undefined,
      lastSeenAt: now,
      lastVersion: version ?? existing.lastVersion,
    });
    if (wasLegacyInactive) {
      await insertStatEvent(ctx, { skillId: skill._id, kind: "install_reactivate" });
    }
    return;
  }

  await ctx.db.insert("userSkillInstalls", {
    userId: params.userId,
    skillId: skill._id,
    firstSeenAt: now,
    lastSeenAt: now,
    lastVersion: version,
  });
  await insertStatEvent(ctx, { skillId: skill._id, kind: "install_new" });
}

async function clearTelemetryForUser(ctx: MutationCtx, params: { userId: Id<"users"> }) {
  const installs = await ctx.db
    .query("userSkillInstalls")
    .withIndex("by_user", (q) => q.eq("userId", params.userId))
    .take(5000);

  for (const entry of installs) {
    const skill = await ctx.db.get(entry.skillId);
    if (!skill) {
      await ctx.db.delete(entry._id);
      continue;
    }
    const wasLegacyInactive = typeof entry.activeRoots === "number" && entry.activeRoots <= 0;
    await insertStatEvent(ctx, {
      skillId: skill._id,
      kind: "install_clear",
      delta: {
        allTime: -1,
        current: wasLegacyInactive ? 0 : -1,
      },
    });
    await ctx.db.delete(entry._id);
  }

  // Keep per-user privacy deletion complete until the global cleanup removes these tables.
  const roots = await ctx.db
    .query("userSyncRoots")
    .withIndex("by_user", (q) => q.eq("userId", params.userId))
    .take(5000);
  for (const root of roots) {
    await ctx.db.delete(root._id);
  }

  const rootInstalls = await ctx.db
    .query("userSkillRootInstalls")
    .withIndex("by_user", (q) => q.eq("userId", params.userId))
    .take(10000);
  for (const entry of rootInstalls) {
    await ctx.db.delete(entry._id);
  }
}
