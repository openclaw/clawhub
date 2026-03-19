import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { isSkillSuspicious } from "./skillSafety";

const DAY_MS = 24 * 60 * 60 * 1000;
export const TRENDING_DAYS = 7;
export const TRENDING_LEADERBOARD_KIND = "trending";
export const TRENDING_NON_SUSPICIOUS_LEADERBOARD_KIND = "trending_non_suspicious";

export type LeaderboardEntry = {
  skillId: Id<"skills">;
  score: number;
  installs: number;
  downloads: number;
};

type DailyTrendingRow = {
  skillId: Id<"skills">;
  installs: number;
  downloads: number;
};

export function toDayKey(timestamp: number) {
  return Math.floor(timestamp / DAY_MS);
}

export function getTrendingRange(now: number) {
  const endDay = toDayKey(now);
  const startDay = endDay - (TRENDING_DAYS - 1);
  return { startDay, endDay };
}

export async function queryDailyStats(ctx: QueryCtx | MutationCtx, day: number) {
  return ctx.db
    .query("skillDailyStats")
    .withIndex("by_day", (q) => q.eq("day", day))
    .collect();
}

export function buildTrendingEntriesFromDailyRows(perDayRows: DailyTrendingRow[][]) {
  const totals = new Map<Id<"skills">, { installs: number; downloads: number }>();
  for (const rows of perDayRows) {
    for (const row of rows) {
      const current = totals.get(row.skillId) ?? { installs: 0, downloads: 0 };
      current.installs += row.installs;
      current.downloads += row.downloads;
      totals.set(row.skillId, current);
    }
  }

  const entries = Array.from(totals, ([skillId, totalsEntry]) => ({
    skillId,
    installs: totalsEntry.installs,
    downloads: totalsEntry.downloads,
    score: totalsEntry.installs,
  }));

  entries.sort((a, b) => compareTrendingEntries(b, a));

  return entries;
}

export function takeTopTrendingEntries(entries: LeaderboardEntry[], limit: number) {
  return topN(entries, limit, compareTrendingEntries).sort((a, b) => compareTrendingEntries(b, a));
}

export async function takeTopNonSuspiciousTrendingEntries(
  ctx: QueryCtx | MutationCtx,
  entries: LeaderboardEntry[],
  limit: number,
) {
  const items: LeaderboardEntry[] = [];

  for (const entry of entries) {
    const skill = await ctx.db.get(entry.skillId);
    if (!skill || skill.softDeletedAt || isSkillSuspicious(skill)) continue;
    items.push(entry);
    if (items.length >= limit) break;
  }

  return items;
}

export function compareTrendingEntries(a: LeaderboardEntry, b: LeaderboardEntry) {
  if (a.score !== b.score) return a.score - b.score;
  if (a.downloads !== b.downloads) return a.downloads - b.downloads;
  return 0;
}

export function topN<T>(entries: T[], limit: number, compare: (a: T, b: T) => number) {
  if (entries.length <= limit) return entries.slice();

  const heap: T[] = [];
  for (const entry of entries) {
    if (heap.length < limit) {
      heap.push(entry);
      siftUp(heap, heap.length - 1, compare);
      continue;
    }
    if (compare(entry, heap[0]) <= 0) continue;
    heap[0] = entry;
    siftDown(heap, 0, compare);
  }
  return heap;
}

function siftUp<T>(heap: T[], index: number, compare: (a: T, b: T) => number) {
  let current = index;
  while (current > 0) {
    const parent = Math.floor((current - 1) / 2);
    if (compare(heap[current], heap[parent]) >= 0) break;
    [heap[current], heap[parent]] = [heap[parent], heap[current]];
    current = parent;
  }
}

function siftDown<T>(heap: T[], index: number, compare: (a: T, b: T) => number) {
  let current = index;
  const length = heap.length;
  while (true) {
    const left = current * 2 + 1;
    const right = current * 2 + 2;
    let smallest = current;
    if (left < length && compare(heap[left], heap[smallest]) < 0) smallest = left;
    if (right < length && compare(heap[right], heap[smallest]) < 0) smallest = right;
    if (smallest === current) break;
    [heap[current], heap[smallest]] = [heap[smallest], heap[current]];
    current = smallest;
  }
}
