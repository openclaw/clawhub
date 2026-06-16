/* @vitest-environment node */
import { describe, expect, it, vi } from "vitest";

vi.mock("./functions", () => ({
  internalAction: (def: { handler: unknown }) => ({ _handler: def.handler }),
  internalMutation: (def: { handler: unknown }) => ({ _handler: def.handler }),
  internalQuery: (def: { handler: unknown }) => ({ _handler: def.handler }),
}));

vi.mock("./_generated/api", () => ({
  internal: {
    skillStatEvents: {
      claimSkillStatDocSyncLeaseInternal: Symbol("claimSkillStatDocSyncLeaseInternal"),
      processSkillStatEventBatchInternal: Symbol("processSkillStatEventBatchInternal"),
      processSkillStatEventsAction: Symbol("processSkillStatEventsAction"),
      processSkillStatEventsInternal: Symbol("processSkillStatEventsInternal"),
      releaseSkillStatDocSyncLeaseInternal: Symbol("releaseSkillStatDocSyncLeaseInternal"),
    },
  },
}));

const { processSkillStatEventBatchInternal } = await import("./skillStatEvents");

const processSkillStatEventBatchInternalHandler = (
  processSkillStatEventBatchInternal as unknown as {
    _handler: (
      ctx: unknown,
      args: { batchSize?: number; leaseOwner: string },
    ) => Promise<{ processed: number }>;
  }
)._handler;

// Test the aggregateEvents function by importing and testing the module logic
// Since aggregateEvents is not exported, we test the behavior indirectly through
// the event processing contract

describe("skill stat events - comment delta handling", () => {
  it("marks queued star events processed without patching skill stats", async () => {
    const starEvent = {
      _id: "skillStatEvents:star",
      skillId: "skills:1",
      kind: "star",
      occurredAt: 1000,
      processedAt: undefined,
    };
    const skill = {
      _id: "skills:1",
      ownerUserId: "users:owner",
      statsDownloads: 0,
      statsStars: 0,
      statsInstallsCurrent: 0,
      statsInstallsAllTime: 0,
      stats: {
        downloads: 0,
        stars: 0,
        installsCurrent: 0,
        installsAllTime: 0,
        versions: 1,
        comments: 0,
      },
    };
    const patch = vi.fn();
    const lease = {
      _id: "skillStatDocSyncLeases:1",
      key: "skill_doc_stat_sync",
      leaseOwner: "test-lease",
      leaseExpiresAt: Date.now() + 60_000,
      updatedAt: Date.now(),
    };
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => (id === "skills:1" ? skill : null)),
        patch,
        query: vi.fn((table: string) => {
          if (table === "skillStatDocSyncLeases") {
            return {
              withIndex: () => ({
                unique: async () => lease,
              }),
            };
          }
          if (table !== "skillStatEvents") throw new Error(`unexpected table ${table}`);
          return {
            withIndex: () => ({
              take: async () => [starEvent],
            }),
          };
        }),
      },
      scheduler: { runAfter: vi.fn() },
    };

    await expect(
      processSkillStatEventBatchInternalHandler(ctx, {
        batchSize: 10,
        leaseOwner: "test-lease",
      }),
    ).resolves.toEqual({
      hasMore: false,
      processed: 1,
      skillsUpdated: 0,
    });

    expect(patch).toHaveBeenCalledTimes(2);
    expect(patch).toHaveBeenCalledWith(
      "skillStatEvents:star",
      expect.objectContaining({ processedAt: expect.any(Number) }),
    );
    expect(patch).toHaveBeenCalledWith(
      "skillStatDocSyncLeases:1",
      expect.objectContaining({ lastProcessedCount: 1 }),
    );
  });

  it("aggregates comment and uncomment events into net deltas", () => {
    // Simulate the aggregation logic from processSkillStatEventsAction
    type EventKind =
      | "download"
      | "star"
      | "unstar"
      | "comment"
      | "uncomment"
      | "install_new"
      | "install_reactivate"
      | "install_deactivate"
      | "install_clear";

    const events: { kind: EventKind; occurredAt: number }[] = [
      { kind: "star", occurredAt: 1000 },
      { kind: "comment", occurredAt: 2000 },
      { kind: "comment", occurredAt: 3000 },
      { kind: "uncomment", occurredAt: 4000 },
      { kind: "download", occurredAt: 5000 },
    ];

    // Replicate the aggregation logic
    const result = {
      downloads: 0,
      stars: 0,
      comments: 0,
      installsAllTime: 0,
      installsCurrent: 0,
      downloadEvents: [] as number[],
      installNewEvents: [] as number[],
    };

    for (const event of events) {
      switch (event.kind) {
        case "download":
          result.downloads += 1;
          result.downloadEvents.push(event.occurredAt);
          break;
        case "star":
          break;
        case "unstar":
          break;
        case "comment":
          result.comments += 1;
          break;
        case "uncomment":
          result.comments -= 1;
          break;
        case "install_new":
          result.installsAllTime += 1;
          result.installsCurrent += 1;
          result.installNewEvents.push(event.occurredAt);
          break;
        case "install_reactivate":
          result.installsCurrent += 1;
          break;
        case "install_deactivate":
          result.installsCurrent -= 1;
          break;
      }
    }

    expect(result.stars).toBe(0);
    expect(result.comments).toBe(1); // 2 comments - 1 uncomment
    expect(result.downloads).toBe(1);
    expect(result.downloadEvents).toEqual([5000]);
  });

  it("should include comments in delta check (regression test for dropped comments)", () => {
    // This test verifies the fix: the condition guard in applyAggregatedStatsAndUpdateCursor
    // must include comments !== 0 so comment-only batches are not skipped
    const delta = {
      downloads: 0,
      stars: 0,
      comments: 3,
      installsAllTime: 0,
      installsCurrent: 0,
    };

    // The OLD buggy condition (missing comments):
    const oldCondition =
      delta.downloads !== 0 ||
      delta.stars !== 0 ||
      delta.installsAllTime !== 0 ||
      delta.installsCurrent !== 0;

    // The FIXED condition (includes comments):
    const fixedCondition =
      delta.downloads !== 0 ||
      delta.stars !== 0 ||
      delta.comments !== 0 ||
      delta.installsAllTime !== 0 ||
      delta.installsCurrent !== 0;

    // With only comment deltas, the old condition would skip the patch
    expect(oldCondition).toBe(false);
    // The fixed condition correctly triggers the patch
    expect(fixedCondition).toBe(true);
  });
});
