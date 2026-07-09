import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation, mutation } from "./functions";
import { requireUser } from "./lib/access";
import { RETENTION_STANDARD_BATCH_SIZE } from "./lib/retentionPolicy";
import {
  getSkillBySlugForPublisher,
  getSkillSlugAliasBySlugForPublisher,
  resolvePublisherByOwnerHandle,
} from "./lib/skills/slugResolution";
import { insertStatEvent } from "./skillStatEvents";

const DAY_MS = 86_400_000;
const INSTALL_TELEMETRY_DEDUPE_RETENTION_MS = 14 * DAY_MS;
const PRUNE_BATCH_SIZE = RETENTION_STANDARD_BATCH_SIZE;
const CLEAR_INSTALLS_BATCH_SIZE = 5_000;
const CLEAR_DEDUPES_BATCH_SIZE = 10_000;
const INSTALL_TELEMETRY_SLUG_MATCH_LIMIT = 25;

export const reportCliInstallInternal = internalMutation({
  args: {
    userId: v.id("users"),
    slug: v.string(),
    ownerHandle: v.optional(v.string()),
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

export const pruneInstallTelemetryDedupesInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoffDayStart = getDayStart(Date.now() - INSTALL_TELEMETRY_DEDUPE_RETENTION_MS);
    const stale = await ctx.db
      .query("installTelemetryDedupes")
      .withIndex("by_day", (q) => q.lt("dayStart", cutoffDayStart))
      .take(PRUNE_BATCH_SIZE);

    for (const entry of stale) {
      await ctx.db.delete(entry._id);
    }

    const hasMore = stale.length === PRUNE_BATCH_SIZE;
    if (hasMore) {
      await ctx.scheduler.runAfter(0, internal.telemetry.pruneInstallTelemetryDedupesInternal, {});
    }

    return { deleted: stale.length, hasMore };
  },
});

export const clearMyTelemetry = mutation({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireUser(ctx);
    await clearTelemetryForUser(ctx, { userId, clearStartedAt: Date.now() });
  },
});

export const clearUserTelemetryInternal = internalMutation({
  args: { userId: v.id("users"), clearStartedAt: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await clearTelemetryForUser(ctx, {
      userId: args.userId,
      clearStartedAt: args.clearStartedAt ?? Date.now(),
    });
  },
});

async function upsertUserSkillInstall(
  ctx: MutationCtx,
  params: { userId: Id<"users">; slug: string; ownerHandle?: string; version?: string },
) {
  const slug = params.slug.trim().toLowerCase();
  if (!slug) return;

  const skill = await resolveInstallTelemetrySkill(ctx, {
    slug,
    ownerHandle: params.ownerHandle,
  });
  if (!skill) return;

  const now = Date.now();
  const duplicate = await markInstallTelemetrySeen(ctx, {
    userId: params.userId,
    skillId: skill._id,
    now,
  });
  if (duplicate) return;

  const version = params.version?.trim() || undefined;
  const existing = await ctx.db
    .query("userSkillInstalls")
    .withIndex("by_user_skill", (q) => q.eq("userId", params.userId).eq("skillId", skill._id))
    .unique();

  if (existing) {
    await ctx.db.patch(existing._id, {
      lastSeenAt: now,
      lastVersion: version ?? existing.lastVersion,
    });
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

async function resolveInstallTelemetrySkill(
  ctx: MutationCtx,
  params: { slug: string; ownerHandle?: string },
) {
  if (params.ownerHandle) {
    const { publisher } = await resolvePublisherByOwnerHandle(ctx, params.ownerHandle);
    if (!publisher) return null;
    let skill = await getSkillBySlugForPublisher(ctx, params.slug, publisher);
    if (!skill) {
      const alias = await getSkillSlugAliasBySlugForPublisher(ctx, params.slug, publisher);
      skill = alias ? await ctx.db.get(alias.skillId) : null;
    }
    return skill && !skill.softDeletedAt ? skill : null;
  }

  // Older clients only report a bare slug. Once slugs are owner-scoped,
  // telemetry must not guess which publisher should receive the install.
  const candidates = await ctx.db
    .query("skills")
    .withIndex("by_slug", (q) => q.eq("slug", params.slug))
    .take(INSTALL_TELEMETRY_SLUG_MATCH_LIMIT + 1);
  if (candidates.length > INSTALL_TELEMETRY_SLUG_MATCH_LIMIT) return null;
  const activeSkills = candidates.filter((candidate) => !candidate.softDeletedAt);
  return activeSkills.length === 1 ? activeSkills[0] : null;
}

async function clearTelemetryForUser(
  ctx: MutationCtx,
  params: { userId: Id<"users">; clearStartedAt: number },
) {
  const installs = await ctx.db
    .query("userSkillInstalls")
    .withIndex("by_user_lastSeenAt", (q) =>
      q.eq("userId", params.userId).lte("lastSeenAt", params.clearStartedAt),
    )
    .take(CLEAR_INSTALLS_BATCH_SIZE);

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
        current: -1,
      },
    });
    await ctx.db.delete(entry._id);
  }
  if (installs.length === CLEAR_INSTALLS_BATCH_SIZE) {
    await scheduleClearUserTelemetry(ctx, params.userId, params.clearStartedAt);
    return;
  }

  const dedupes = await ctx.db
    .query("installTelemetryDedupes")
    .withIndex("by_user_createdAt", (q) =>
      q.eq("userId", params.userId).lte("createdAt", params.clearStartedAt),
    )
    .take(CLEAR_DEDUPES_BATCH_SIZE);
  for (const entry of dedupes) {
    await ctx.db.delete(entry._id);
  }
  if (dedupes.length === CLEAR_DEDUPES_BATCH_SIZE) {
    await scheduleClearUserTelemetry(ctx, params.userId, params.clearStartedAt);
  }
}

async function scheduleClearUserTelemetry(
  ctx: MutationCtx,
  userId: Id<"users">,
  clearStartedAt: number,
) {
  await ctx.scheduler.runAfter(0, internal.telemetry.clearUserTelemetryInternal, {
    userId,
    clearStartedAt,
  });
}

async function markInstallTelemetrySeen(
  ctx: MutationCtx,
  params: { userId: Id<"users">; skillId: Id<"skills">; now: number },
) {
  const dayStart = getDayStart(params.now);
  const existing = await ctx.db
    .query("installTelemetryDedupes")
    .withIndex("by_user_skill_day", (q) =>
      q.eq("userId", params.userId).eq("skillId", params.skillId).eq("dayStart", dayStart),
    )
    .unique();
  if (existing) return true;

  await ctx.db.insert("installTelemetryDedupes", {
    userId: params.userId,
    skillId: params.skillId,
    dayStart,
    createdAt: params.now,
  });
  return false;
}

function getDayStart(timestamp: number) {
  return Math.floor(timestamp / DAY_MS) * DAY_MS;
}

export const __test = {
  getDayStart,
};
