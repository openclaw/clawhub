import type { Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'

const DAY_MS = 24 * 60 * 60 * 1000
export const TRENDING_DAYS = 7

type LeaderboardEntry = {
  skillId: Id<'skills'>
  score: number
  installs: number
  downloads: number
}

export function toDayKey(timestamp: number) {
  return Math.floor(timestamp / DAY_MS)
}

export function getTrendingRange(now: number) {
  const endDay = toDayKey(now)
  const startDay = endDay - (TRENDING_DAYS - 1)
  return { startDay, endDay }
}

export async function buildTrendingLeaderboard(
  ctx: QueryCtx | MutationCtx,
  params: { limit: number; now?: number },
) {
  const now = params.now ?? Date.now()
  const { startDay, endDay } = getTrendingRange(now)

  // Query one day at a time to stay well under the 32K document limit.
  // Each daily query reads ~4,500 docs instead of 32K for the full 7-day range.
  const totals = new Map<Id<'skills'>, { installs: number; downloads: number }>()
  for (let day = startDay; day <= endDay; day++) {
    const rows = await ctx.db
      .query('skillDailyStats')
      .withIndex('by_day', (q) => q.eq('day', day))
      .collect()
    for (const row of rows) {
      const current = totals.get(row.skillId) ?? { installs: 0, downloads: 0 }
      current.installs += row.installs
      current.downloads += row.downloads
      totals.set(row.skillId, current)
    }
  }

  const entries = Array.from(totals, ([skillId, totalsEntry]) => ({
    skillId,
    installs: totalsEntry.installs,
    downloads: totalsEntry.downloads,
    score: totalsEntry.installs,
  }))

  const items = topN(entries, params.limit, compareTrendingEntries).sort((a, b) =>
    compareTrendingEntries(b, a),
  )

  return { startDay, endDay, items }
}

function compareTrendingEntries(a: LeaderboardEntry, b: LeaderboardEntry) {
  if (a.score !== b.score) return a.score - b.score
  if (a.downloads !== b.downloads) return a.downloads - b.downloads
  return 0
}

function topN<T>(entries: T[], limit: number, compare: (a: T, b: T) => number) {
  if (entries.length <= limit) return entries.slice()

  const heap: T[] = []
  for (const entry of entries) {
    if (heap.length < limit) {
      heap.push(entry)
      siftUp(heap, heap.length - 1, compare)
      continue
    }
    if (compare(entry, heap[0]) <= 0) continue
    heap[0] = entry
    siftDown(heap, 0, compare)
  }
  return heap
}

function siftUp<T>(heap: T[], index: number, compare: (a: T, b: T) => number) {
  let current = index
  while (current > 0) {
    const parent = Math.floor((current - 1) / 2)
    if (compare(heap[current], heap[parent]) >= 0) break
    ;[heap[current], heap[parent]] = [heap[parent], heap[current]]
    current = parent
  }
}

function siftDown<T>(heap: T[], index: number, compare: (a: T, b: T) => number) {
  let current = index
  const length = heap.length
  while (true) {
    const left = current * 2 + 1
    const right = current * 2 + 2
    let smallest = current
    if (left < length && compare(heap[left], heap[smallest]) < 0) smallest = left
    if (right < length && compare(heap[right], heap[smallest]) < 0) smallest = right
    if (smallest === current) break
    ;[heap[current], heap[smallest]] = [heap[smallest], heap[current]]
    current = smallest
  }
}
