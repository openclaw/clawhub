import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export const GLOBAL_STATS_KEY = "default";

type GlobalStatsReadCtx = Pick<MutationCtx | QueryCtx, "db">;
type GlobalStatsWriteCtx = Pick<MutationCtx, "db">;

function getErrorMessage(error: unknown) {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "";
}

export function isGlobalStatsStorageNotReadyError(error: unknown) {
  const message = getErrorMessage(error).toLowerCase();
  if (!message) return false;
  const referencesGlobalStats = message.includes("globalstats") || message.includes("by_key");
  if (!referencesGlobalStats) return false;
  return (
    message.includes("table") ||
    message.includes("index") ||
    message.includes("schema") ||
    message.includes("not found") ||
    message.includes("does not exist") ||
    message.includes("unknown")
  );
}

export async function setGlobalPublicSkillsCount(
  ctx: GlobalStatsWriteCtx,
  count: number,
  now = Date.now(),
) {
  const normalizedCount = Math.max(0, Math.trunc(Number.isFinite(count) ? count : 0));
  try {
    const existing = await ctx.db
      .query("globalStats")
      .withIndex("by_key", (q) => q.eq("key", GLOBAL_STATS_KEY))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { activeSkillsCount: normalizedCount, updatedAt: now });
    } else {
      await ctx.db.insert("globalStats", {
        key: GLOBAL_STATS_KEY,
        activeSkillsCount: normalizedCount,
        updatedAt: now,
      });
    }
  } catch (error) {
    if (isGlobalStatsStorageNotReadyError(error)) return;
    throw error;
  }
}

export async function setGlobalPublicPluginsCount(
  ctx: GlobalStatsWriteCtx,
  count: number,
  now = Date.now(),
) {
  const normalizedCount = Math.max(0, Math.trunc(Number.isFinite(count) ? count : 0));
  try {
    const existing = await ctx.db
      .query("globalStats")
      .withIndex("by_key", (q) => q.eq("key", GLOBAL_STATS_KEY))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { activePluginsCount: normalizedCount, updatedAt: now });
    } else {
      await ctx.db.insert("globalStats", {
        key: GLOBAL_STATS_KEY,
        activeSkillsCount: 0,
        activePluginsCount: normalizedCount,
        updatedAt: now,
      });
    }
  } catch (error) {
    if (isGlobalStatsStorageNotReadyError(error)) return;
    throw error;
  }
}

export async function setGlobalPublicExternalSkillsCount(
  ctx: GlobalStatsWriteCtx,
  count: number,
  now = Date.now(),
) {
  const normalizedCount = Math.max(0, Math.trunc(Number.isFinite(count) ? count : 0));
  const existing = await ctx.db
    .query("globalStats")
    .withIndex("by_key", (q) => q.eq("key", GLOBAL_STATS_KEY))
    .unique();
  if (existing) {
    await ctx.db.patch(existing._id, {
      activeExternalSkillsCount: normalizedCount,
      updatedAt: now,
    });
    return;
  }
  await ctx.db.insert("globalStats", {
    key: GLOBAL_STATS_KEY,
    activeSkillsCount: 0,
    activeExternalSkillsCount: normalizedCount,
    updatedAt: now,
  });
}

export async function adjustGlobalPublicSkillsCount(
  ctx: GlobalStatsWriteCtx,
  delta: number,
  now = Date.now(),
) {
  const normalizedDelta = Math.trunc(Number.isFinite(delta) ? delta : 0);
  if (normalizedDelta === 0) return;

  let existing:
    | {
        _id: Doc<"globalStats">["_id"];
        activeSkillsCount: number;
      }
    | null
    | undefined;
  try {
    existing = await ctx.db
      .query("globalStats")
      .withIndex("by_key", (q) => q.eq("key", GLOBAL_STATS_KEY))
      .unique();
  } catch (error) {
    if (isGlobalStatsStorageNotReadyError(error)) return;
    throw error;
  }

  if (!existing) {
    // No baseline yet. The paginated stats maintenance action reconciles the full count.
    await setGlobalPublicSkillsCount(ctx, Math.max(0, normalizedDelta), now);
    return;
  }

  const nextCount = Math.max(0, existing.activeSkillsCount + normalizedDelta);
  await ctx.db.patch(existing._id, { activeSkillsCount: nextCount, updatedAt: now });
}

export async function adjustGlobalPublicPluginsCount(
  ctx: GlobalStatsWriteCtx,
  delta: number,
  now = Date.now(),
) {
  const normalizedDelta = Math.trunc(Number.isFinite(delta) ? delta : 0);
  if (normalizedDelta === 0) return;

  let existing:
    | {
        _id: Doc<"globalStats">["_id"];
        activePluginsCount?: number;
      }
    | null
    | undefined;
  try {
    existing = await ctx.db
      .query("globalStats")
      .withIndex("by_key", (q) => q.eq("key", GLOBAL_STATS_KEY))
      .unique();
  } catch (error) {
    if (isGlobalStatsStorageNotReadyError(error)) return;
    throw error;
  }

  if (!existing || existing.activePluginsCount === undefined) return;

  const nextCount = Math.max(0, existing.activePluginsCount + normalizedDelta);
  await ctx.db.patch(existing._id, { activePluginsCount: nextCount, updatedAt: now });
}

export async function readGlobalPublicSkillsCount(ctx: GlobalStatsReadCtx) {
  try {
    const stats = await ctx.db
      .query("globalStats")
      .withIndex("by_key", (q) => q.eq("key", GLOBAL_STATS_KEY))
      .unique();
    return stats ? stats.activeSkillsCount + (stats.activeExternalSkillsCount ?? 0) : null;
  } catch (error) {
    if (isGlobalStatsStorageNotReadyError(error)) return null;
    throw error;
  }
}

export async function readGlobalPublicPluginsCount(ctx: GlobalStatsReadCtx) {
  try {
    const stats = await ctx.db
      .query("globalStats")
      .withIndex("by_key", (q) => q.eq("key", GLOBAL_STATS_KEY))
      .unique();
    return stats?.activePluginsCount ?? null;
  } catch (error) {
    if (isGlobalStatsStorageNotReadyError(error)) return null;
    throw error;
  }
}
