import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export const HOUR_MS = 60 * 60 * 1_000;
export const ROLLING_TRENDING_HOURS = 24;
export const HOURLY_STATS_RETENTION_MS = 72 * HOUR_MS;
export const HOURLY_STATS_STATE_KEY = "canonical_trending";
const SKILL_STAT_EVENT_CURSOR_KEY = "skill_stat_events";

export function toHourKey(timestamp: number) {
  return Math.floor(timestamp / HOUR_MS);
}

export function getHourlyStatExpiresAt(timestamp: number) {
  return (toHourKey(timestamp) + 1) * HOUR_MS + HOURLY_STATS_RETENTION_MS;
}

export function getCompletedRolling24HourWindow(now: number) {
  const currentHour = toHourKey(now);
  const endHour = currentHour - 1;
  const startHour = endHour - (ROLLING_TRENDING_HOURS - 1);
  return {
    startHour,
    endHour,
    startAt: startHour * HOUR_MS,
    endAt: currentHour * HOUR_MS,
  };
}

type HourlySkillStat = {
  skillId: string;
  downloads: number;
  installs: number;
  bookmarks: number;
  updatedAt: number;
};

export function sumRollingHourlyStats(rows: readonly HourlySkillStat[]) {
  const totals = new Map<
    string,
    { downloads: number; installs: number; bookmarks: number; updatedAt: number }
  >();
  for (const row of rows) {
    const current = totals.get(row.skillId) ?? {
      downloads: 0,
      installs: 0,
      bookmarks: 0,
      updatedAt: 0,
    };
    current.downloads += row.downloads;
    current.installs += row.installs;
    current.bookmarks += row.bookmarks;
    current.updatedAt = Math.max(current.updatedAt, row.updatedAt);
    totals.set(row.skillId, current);
  }
  for (const total of totals.values()) {
    total.downloads = Math.max(0, total.downloads);
    total.installs = Math.max(0, total.installs);
    total.bookmarks = Math.max(0, total.bookmarks);
  }
  return totals;
}

type HourlyStatDeltas = {
  skillId: Id<"skills">;
  occurredAt: number;
  downloads?: number;
  installs?: number;
  bookmarks?: number;
};

type HourlyStatsBackfillState = {
  liveStartedAt: number;
  eventBackfillThroughCreationTime: number;
};

export function getHistoricalEventHourlyDelta(
  event: { kind: string; occurredAt: number; _creationTime: number },
  state: HourlyStatsBackfillState,
  now: number,
) {
  if (
    event._creationTime > state.eventBackfillThroughCreationTime ||
    getHourlyStatExpiresAt(event.occurredAt) <= now
  ) {
    return null;
  }
  if (event.kind === "download") return { downloads: 1 };
  if (event.kind === "install_new") return { installs: 1 };
  return null;
}

export function getHistoricalStarHourlyDelta(
  star: { createdAt: number; hourlyStatsRecordedAt?: number },
  state: HourlyStatsBackfillState,
  now: number,
) {
  if (
    star.hourlyStatsRecordedAt !== undefined ||
    star.createdAt >= state.liveStartedAt ||
    getHourlyStatExpiresAt(star.createdAt) <= now
  ) {
    return null;
  }
  return { bookmarks: 1 };
}

export async function ensureHourlyStatsState(ctx: Pick<MutationCtx, "db">) {
  const existing = await ctx.db
    .query("skillHourlyStatStates")
    .withIndex("by_key", (q) => q.eq("key", HOURLY_STATS_STATE_KEY))
    .unique();
  if (existing) return existing;

  const cursor = await ctx.db
    .query("skillStatUpdateCursors")
    .withIndex("by_key", (q) => q.eq("key", SKILL_STAT_EVENT_CURSOR_KEY))
    .unique();
  const now = Date.now();
  const stateId = await ctx.db.insert("skillHourlyStatStates", {
    key: HOURLY_STATS_STATE_KEY,
    liveStartedAt: now,
    eventBackfillThroughCreationTime: cursor?.cursorCreationTime ?? 0,
    activeGeneration: 1,
    updatedAt: now,
  });
  const created = await ctx.db.get(stateId);
  if (!created) throw new Error("Failed to initialize hourly skill stat state");
  return created;
}

async function bumpHourlySkillStats(
  ctx: Pick<MutationCtx, "db">,
  generation: number,
  params: HourlyStatDeltas,
) {
  const hour = toHourKey(params.occurredAt);
  const existing = await ctx.db
    .query("skillHourlyStats")
    .withIndex("by_skill_and_hour_and_generation", (q) =>
      q.eq("skillId", params.skillId).eq("hour", hour).eq("generation", generation),
    )
    .unique();
  const now = Date.now();
  const expiresAt = getHourlyStatExpiresAt(params.occurredAt);
  if (expiresAt <= now) return null;
  const downloads = params.downloads ?? 0;
  const installs = params.installs ?? 0;
  const bookmarks = params.bookmarks ?? 0;

  if (!existing) {
    return await ctx.db.insert("skillHourlyStats", {
      skillId: params.skillId,
      hour,
      generation,
      downloads,
      installs,
      bookmarks,
      updatedAt: now,
      expiresAt,
    });
  }

  await ctx.db.patch(existing._id, {
    downloads: existing.downloads + downloads,
    installs: existing.installs + installs,
    bookmarks: existing.bookmarks + bookmarks,
    updatedAt: now,
    expiresAt,
  });
  return existing._id;
}

export async function bumpHistoricalHourlySkillStats(
  ctx: Pick<MutationCtx, "db">,
  params: HourlyStatDeltas,
) {
  return await bumpHourlySkillStats(ctx, 0, params);
}

export async function bumpLiveHourlySkillStats(
  ctx: Pick<MutationCtx, "db">,
  params: HourlyStatDeltas,
  options?: { state?: { activeGeneration: number } },
) {
  const state = options?.state ?? (await ensureHourlyStatsState(ctx));
  return await bumpHourlySkillStats(ctx, state.activeGeneration, params);
}
