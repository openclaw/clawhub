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

const { processSkillStatEventBatchInternal, processSkillStatEventsInternal } =
  await import("./skillStatEvents");

const processSkillStatEventBatchInternalHandler = (
  processSkillStatEventBatchInternal as unknown as {
    _handler: (
      ctx: unknown,
      args: { batchSize?: number; leaseOwner: string },
    ) => Promise<{ processed: number; skillsUpdated: number; hasMore: boolean }>;
  }
)._handler;

const processSkillStatEventsInternalHandler = (
  processSkillStatEventsInternal as unknown as {
    _handler: (
      ctx: unknown,
      args: { batchSize?: number; maxBatches?: number },
    ) => Promise<{ processed: number; scheduledContinuation: boolean }>;
  }
)._handler;

describe("skill stat events", () => {
  it.each(["star", "unstar", "comment", "uncomment"] as const)(
    "marks historical %s events processed without patching skill stats",
    async (kind) => {
      const eventId = `skillStatEvents:${kind}`;
      const statEvent = {
        _id: eventId,
        skillId: "skills:1",
        kind,
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
      const lease = {
        _id: "skillStatDocSyncLeases:1",
        key: "skill_doc_stat_sync",
        leaseOwner: "test-lease",
        leaseExpiresAt: Date.now() + 60_000,
        updatedAt: Date.now(),
      };
      const patch = vi.fn();
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
                take: async () => [statEvent],
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
        eventId,
        expect.objectContaining({ processedAt: expect.any(Number) }),
      );
      expect(patch).toHaveBeenCalledWith(
        "skillStatDocSyncLeases:1",
        expect.objectContaining({ lastProcessedCount: 1 }),
      );
      expect(patch).not.toHaveBeenCalledWith("skills:1", expect.anything());
    },
  );

  it("bounds action drain work so stale continuations do not crawl or time out", async () => {
    const runMutation = vi.fn(async (_ref: unknown, args: Record<string, unknown>) => {
      if ("leaseMs" in args) {
        return {
          acquired: true,
          leaseOwner: "test-lease",
          leaseExpiresAt: Date.now() + 60_000,
          now: Date.now(),
        };
      }
      if ("leaseOwner" in args && "batchSize" in args) {
        return { processed: 100, skillsUpdated: 1, hasMore: true };
      }
      if ("processed" in args) {
        return { released: true };
      }
      throw new Error(`unexpected mutation args ${JSON.stringify(args)}`);
    });
    const scheduler = { runAfter: vi.fn() };

    await expect(
      processSkillStatEventsInternalHandler(
        { runMutation, scheduler },
        { batchSize: 10, maxBatches: 100 },
      ),
    ).resolves.toMatchObject({
      processed: 500,
      scheduledContinuation: true,
    });

    const batchCalls = runMutation.mock.calls.filter(([, args]) => {
      return args && typeof args === "object" && "leaseOwner" in args && "batchSize" in args;
    });
    expect(batchCalls).toHaveLength(5);
    expect(batchCalls[0]?.[1]).toMatchObject({ batchSize: 100 });
    expect(scheduler.runAfter.mock.calls[0]?.[2]).toMatchObject({
      batchSize: 100,
      maxBatches: 5,
    });
  });

  it("applies install deltas to skill ranking fields", async () => {
    const installEvent = {
      _id: "skillStatEvents:install",
      skillId: "skills:1",
      kind: "install_new",
      occurredAt: 1000,
      processedAt: undefined,
    };
    const skill = {
      _id: "skills:1",
      ownerUserId: "users:owner",
      statsDownloads: 10,
      statsStars: 5,
      statsInstallsCurrent: 2,
      statsInstallsAllTime: 7,
      stats: {
        downloads: 10,
        stars: 5,
        installsCurrent: 2,
        installsAllTime: 7,
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
          if (table === "skillStatEvents") {
            return {
              withIndex: () => ({
                take: async () => [installEvent],
              }),
            };
          }
          throw new Error(`unexpected table ${table}`);
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
      skillsUpdated: 1,
    });

    expect(patch).toHaveBeenCalledWith("skills:1", {
      statsDownloads: 10,
      statsStars: 5,
      statsInstallsCurrent: 3,
      statsInstallsAllTime: 8,
      stats: {
        downloads: 10,
        stars: 5,
        installsCurrent: 3,
        installsAllTime: 8,
        versions: 1,
        comments: 0,
      },
    });
    expect(patch).toHaveBeenCalledWith(
      "skillStatEvents:install",
      expect.objectContaining({ processedAt: expect.any(Number) }),
    );
  });
});
