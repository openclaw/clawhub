import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation, mutation, query } from "./functions";
import { requireUser } from "./lib/access";
import { insertStatEvent } from "./skillStatEvents";

export const reportCliInstallInternal = internalMutation({
  args: {
    userId: v.id("users"),
    slug: v.string(),
    version: v.optional(v.string()),
    rootId: v.optional(v.string()),
    rootLabel: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const slug = args.slug.trim().toLowerCase();
    if (!slug) return;

    const skill = await ctx.db
      .query("skills")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (!skill || skill.softDeletedAt) return;

    const now = Date.now();
    const rootId = args.rootId?.trim();
    if (rootId) {
      await upsertSingleRootInstall(ctx, {
        userId: args.userId,
        skillId: skill._id,
        rootId,
        label: args.rootLabel?.trim() || "Unknown",
        now,
        version: args.version,
      });
      return;
    }

    const existing = await ctx.db
      .query("userSkillInstalls")
      .withIndex("by_user_skill", (q) => q.eq("userId", args.userId).eq("skillId", skill._id))
      .unique();
    if (existing) {
      const wasInactive = existing.activeRoots <= 0;
      await ctx.db.patch(existing._id, {
        lastSeenAt: now,
        activeRoots: Math.max(1, existing.activeRoots),
        lastVersion: args.version,
      });
      if (wasInactive) {
        await insertStatEvent(ctx, { skillId: skill._id, kind: "install_reactivate" });
      }
      return;
    }

    await ctx.db.insert("userSkillInstalls", {
      userId: args.userId,
      skillId: skill._id,
      firstSeenAt: now,
      lastSeenAt: now,
      activeRoots: 1,
      lastVersion: args.version,
    });
    await insertStatEvent(ctx, { skillId: skill._id, kind: "install_new" });
  },
});

export const reportCliLegacyInstallBatchInternal = internalMutation({
  args: {
    userId: v.id("users"),
    rootId: v.string(),
    rootLabel: v.string(),
    skills: v.array(
      v.object({
        slug: v.string(),
        version: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const rootId = args.rootId.trim();
    if (!rootId) return;

    const now = Date.now();
    await upsertRoot(ctx, {
      userId: args.userId,
      rootId,
      label: args.rootLabel.trim() || "Unknown",
      now,
    });

    const seen = new Set<string>();
    for (const entry of args.skills) {
      const slug = entry.slug.trim().toLowerCase();
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);

      const skill = await ctx.db
        .query("skills")
        .withIndex("by_slug", (q) => q.eq("slug", slug))
        .unique();
      if (!skill || skill.softDeletedAt) continue;

      await upsertRootSkillInstall(ctx, {
        userId: args.userId,
        skillId: skill._id,
        rootId,
        now,
        version: entry.version?.trim() || undefined,
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

export const getMyInstalled = query({
  args: {
    includeRemoved: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const roots = await ctx.db
      .query("userSyncRoots")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(200);

    const includeRemoved = Boolean(args.includeRemoved);
    const resultRoots: Array<{
      rootId: string;
      label: string;
      firstSeenAt: number;
      lastSeenAt: number;
      expiredAt?: number;
      skills: Array<{
        skill: {
          slug: string;
          displayName: string;
          summary?: string;
          stats: unknown;
          ownerUserId: Id<"users">;
        };
        firstSeenAt: number;
        lastSeenAt: number;
        lastVersion?: string;
        removedAt?: number;
      }>;
    }> = [];

    for (const root of roots) {
      const installs = await ctx.db
        .query("userSkillRootInstalls")
        .withIndex("by_user_root", (q) => q.eq("userId", userId).eq("rootId", root.rootId))
        .order("desc")
        .take(2000);

      const filtered = includeRemoved ? installs : installs.filter((entry) => !entry.removedAt);
      const skills: Array<{
        skill: {
          slug: string;
          displayName: string;
          summary?: string;
          stats: unknown;
          ownerUserId: Id<"users">;
        };
        firstSeenAt: number;
        lastSeenAt: number;
        lastVersion?: string;
        removedAt?: number;
      }> = [];

      for (const entry of filtered) {
        const skill = await ctx.db.get(entry.skillId);
        if (!skill) continue;
        skills.push({
          skill: {
            slug: skill.slug,
            displayName: skill.displayName,
            summary: skill.summary,
            stats: skill.stats,
            ownerUserId: skill.ownerUserId,
          },
          firstSeenAt: entry.firstSeenAt,
          lastSeenAt: entry.lastSeenAt,
          lastVersion: entry.lastVersion,
          removedAt: entry.removedAt,
        });
      }

      resultRoots.push({
        rootId: root.rootId,
        label: root.label,
        firstSeenAt: root.firstSeenAt,
        lastSeenAt: root.lastSeenAt,
        expiredAt: root.expiredAt,
        skills,
      });
    }

    return {
      roots: resultRoots,
      cutoffDays: 120,
    };
  },
});

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
    await insertStatEvent(ctx, {
      skillId: skill._id,
      kind: "install_clear",
      delta: {
        allTime: -1,
        current: entry.activeRoots > 0 ? -1 : 0,
      },
    });
    await ctx.db.delete(entry._id);
  }

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

async function upsertSingleRootInstall(
  ctx: MutationCtx,
  params: {
    userId: Id<"users">;
    skillId: Id<"skills">;
    rootId: string;
    label: string;
    now: number;
    version?: string;
  },
) {
  await upsertRoot(ctx, {
    userId: params.userId,
    rootId: params.rootId,
    label: params.label,
    now: params.now,
  });

  await upsertRootSkillInstall(ctx, params);
}

async function upsertRootSkillInstall(
  ctx: MutationCtx,
  params: {
    userId: Id<"users">;
    skillId: Id<"skills">;
    rootId: string;
    now: number;
    version?: string;
  },
) {
  const existing = await ctx.db
    .query("userSkillRootInstalls")
    .withIndex("by_user_root_skill", (q) =>
      q.eq("userId", params.userId).eq("rootId", params.rootId).eq("skillId", params.skillId),
    )
    .unique();

  if (existing) {
    const wasRemoved = Boolean(existing.removedAt);
    await ctx.db.patch(existing._id, {
      lastSeenAt: params.now,
      lastVersion: params.version ?? existing.lastVersion,
      removedAt: undefined,
    });
    if (wasRemoved) {
      await incrementActiveRoots(ctx, {
        userId: params.userId,
        skillId: params.skillId,
        now: params.now,
        version: params.version,
      });
    }
    return;
  }

  await ctx.db.insert("userSkillRootInstalls", {
    userId: params.userId,
    rootId: params.rootId,
    skillId: params.skillId,
    firstSeenAt: params.now,
    lastSeenAt: params.now,
    lastVersion: params.version,
  });
  await incrementActiveRoots(ctx, {
    userId: params.userId,
    skillId: params.skillId,
    now: params.now,
    version: params.version,
  });
}

async function upsertRoot(
  ctx: MutationCtx,
  params: { userId: Id<"users">; rootId: string; now: number; label: string },
) {
  const existing = await ctx.db
    .query("userSyncRoots")
    .withIndex("by_user_root", (q) => q.eq("userId", params.userId).eq("rootId", params.rootId))
    .unique();
  if (existing) {
    await ctx.db.patch(existing._id, {
      label: params.label,
      lastSeenAt: params.now,
      expiredAt: undefined,
    });
    return;
  }
  await ctx.db.insert("userSyncRoots", {
    userId: params.userId,
    rootId: params.rootId,
    label: params.label,
    firstSeenAt: params.now,
    lastSeenAt: params.now,
    expiredAt: undefined,
  });
}

async function incrementActiveRoots(
  ctx: MutationCtx,
  params: { userId: Id<"users">; skillId: Id<"skills">; now: number; version?: string },
) {
  const existing = await ctx.db
    .query("userSkillInstalls")
    .withIndex("by_user_skill", (q) => q.eq("userId", params.userId).eq("skillId", params.skillId))
    .unique();

  if (!existing) {
    await ctx.db.insert("userSkillInstalls", {
      userId: params.userId,
      skillId: params.skillId,
      firstSeenAt: params.now,
      lastSeenAt: params.now,
      activeRoots: 1,
      lastVersion: params.version,
    });
    await bumpSkillInstallCounts(ctx, {
      skillId: params.skillId,
      deltaAllTime: 1,
      deltaCurrent: 1,
    });
    return;
  }

  const nextActive = Math.max(0, (existing.activeRoots ?? 0) + 1);
  await ctx.db.patch(existing._id, {
    activeRoots: nextActive,
    lastSeenAt: params.now,
    lastVersion: params.version ?? existing.lastVersion,
  });
  if ((existing.activeRoots ?? 0) === 0 && nextActive > 0) {
    await bumpSkillInstallCounts(ctx, {
      skillId: params.skillId,
      deltaAllTime: 0,
      deltaCurrent: 1,
    });
  }
}

async function bumpSkillInstallCounts(
  ctx: MutationCtx,
  params: { skillId: Id<"skills">; deltaAllTime: number; deltaCurrent: number },
) {
  if (params.deltaAllTime === 1 && params.deltaCurrent === 1) {
    await insertStatEvent(ctx, { skillId: params.skillId, kind: "install_new" });
  } else if (params.deltaAllTime === 0 && params.deltaCurrent === 1) {
    await insertStatEvent(ctx, { skillId: params.skillId, kind: "install_reactivate" });
  }
}
