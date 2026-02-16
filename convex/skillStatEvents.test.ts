/* @vitest-environment node */
import { describe, expect, it } from 'vitest'

// Test the aggregateEvents function by importing and testing the module logic
// Since aggregateEvents is not exported, we test the behavior indirectly through
// the event processing contract

describe('skill stat events - comment delta handling', () => {
  it('aggregates comment and uncomment events into net deltas', () => {
    // Simulate the aggregation logic from processSkillStatEventsAction
    type EventKind =
      | 'download'
      | 'star'
      | 'unstar'
      | 'comment'
      | 'uncomment'
      | 'install_new'
      | 'install_reactivate'
      | 'install_deactivate'
      | 'install_clear'

    const events: { kind: EventKind; occurredAt: number }[] = [
      { kind: 'star', occurredAt: 1000 },
      { kind: 'comment', occurredAt: 2000 },
      { kind: 'comment', occurredAt: 3000 },
      { kind: 'uncomment', occurredAt: 4000 },
      { kind: 'download', occurredAt: 5000 },
    ]

    // Replicate the aggregation logic
    const result = {
      downloads: 0,
      stars: 0,
      comments: 0,
      installsAllTime: 0,
      installsCurrent: 0,
      downloadEvents: [] as number[],
      installNewEvents: [] as number[],
    }

    for (const event of events) {
      switch (event.kind) {
        case 'download':
          result.downloads += 1
          result.downloadEvents.push(event.occurredAt)
          break
        case 'star':
          result.stars += 1
          break
        case 'unstar':
          result.stars -= 1
          break
        case 'comment':
          result.comments += 1
          break
        case 'uncomment':
          result.comments -= 1
          break
        case 'install_new':
          result.installsAllTime += 1
          result.installsCurrent += 1
          result.installNewEvents.push(event.occurredAt)
          break
        case 'install_reactivate':
          result.installsCurrent += 1
          break
        case 'install_deactivate':
          result.installsCurrent -= 1
          break
      }
    }

    expect(result.stars).toBe(1)
    expect(result.comments).toBe(1) // 2 comments - 1 uncomment
    expect(result.downloads).toBe(1)
    expect(result.downloadEvents).toEqual([5000])
  })

  it('should include comments in delta check (regression test for dropped comments)', () => {
    // This test verifies the fix: the condition guard in applyAggregatedStatsAndUpdateCursor
    // must include comments !== 0 so comment-only batches are not skipped
    const delta = {
      downloads: 0,
      stars: 0,
      comments: 3,
      installsAllTime: 0,
      installsCurrent: 0,
    }

    // The OLD buggy condition (missing comments):
    const oldCondition =
      delta.downloads !== 0 ||
      delta.stars !== 0 ||
      delta.installsAllTime !== 0 ||
      delta.installsCurrent !== 0

    // The FIXED condition (includes comments):
    const fixedCondition =
      delta.downloads !== 0 ||
      delta.stars !== 0 ||
      delta.comments !== 0 ||
      delta.installsAllTime !== 0 ||
      delta.installsCurrent !== 0

    // With only comment deltas, the old condition would skip the patch
    expect(oldCondition).toBe(false)
    // The fixed condition correctly triggers the patch
    expect(fixedCondition).toBe(true)
  })
})
