/* @vitest-environment node */
import { describe, expect, it, vi } from "vitest";

const apiRefs = vi.hoisted(() => ({
  applyAggregatedStatsAndUpdateCursor: Symbol("applyAggregatedStatsAndUpdateCursor"),
  claimSkillStatDocSyncLeaseInternal: Symbol("claimSkillStatDocSyncLeaseInternal"),
  getStatEventCursor: Symbol("getStatEventCursor"),
  getUnprocessedEventBatch: Symbol("getUnprocessedEventBatch"),
  kickProcessedSkillStatEventPruneInternal: Symbol("kickProcessedSkillStatEventPruneInternal"),
  processSkillStatEventBatchInternal: Symbol("processSkillStatEventBatchInternal"),
  processSkillStatEventsAction: Symbol("processSkillStatEventsAction"),
  processSkillStatEventsInternal: Symbol("processSkillStatEventsInternal"),
  pruneProcessedSkillStatEventsInternal: Symbol("pruneProcessedSkillStatEventsInternal"),
  pruneProcessedSkillStatEventBatchInternal: Symbol("pruneProcessedSkillStatEventBatchInternal"),
  releaseSkillStatDocSyncLeaseInternal: Symbol("releaseSkillStatDocSyncLeaseInternal"),
}));

vi.mock("./functions", () => ({
  internalAction: (def: { handler: unknown }) => ({ _handler: def.handler }),
  internalMutation: (def: { handler: unknown }) => ({ _handler: def.handler }),
  internalQuery: (def: { handler: unknown }) => ({ _handler: def.handler }),
}));

vi.mock("./_generated/api", () => ({
  internal: {
    skillStatEvents: {
      applyAggregatedStatsAndUpdateCursor: apiRefs.applyAggregatedStatsAndUpdateCursor,
      claimSkillStatDocSyncLeaseInternal: apiRefs.claimSkillStatDocSyncLeaseInternal,
      getStatEventCursor: apiRefs.getStatEventCursor,
      getUnprocessedEventBatch: apiRefs.getUnprocessedEventBatch,
      kickProcessedSkillStatEventPruneInternal: apiRefs.kickProcessedSkillStatEventPruneInternal,
      processSkillStatEventBatchInternal: apiRefs.processSkillStatEventBatchInternal,
      processSkillStatEventsAction: apiRefs.processSkillStatEventsAction,
      processSkillStatEventsInternal: apiRefs.processSkillStatEventsInternal,
      pruneProcessedSkillStatEventsInternal: apiRefs.pruneProcessedSkillStatEventsInternal,
      pruneProcessedSkillStatEventBatchInternal: apiRefs.pruneProcessedSkillStatEventBatchInternal,
      releaseSkillStatDocSyncLeaseInternal: apiRefs.releaseSkillStatDocSyncLeaseInternal,
    },
  },
}));

const {
  processSkillStatEventBatchInternal,
  processSkillStatEventsAction,
  processSkillStatEventsInternal,
  kickProcessedSkillStatEventPruneInternal,
  pruneProcessedSkillStatEventBatchInternal,
  pruneProcessedSkillStatEventsInternal,
} = await import("./skillStatEvents");

const processSkillStatEventBatchInternalHandler = (
  processSkillStatEventBatchInternal as unknown as {
    _handler: (
      ctx: unknown,
      args: { batchSize?: number; leaseOwner: string },
    ) => Promise<{ processed: number; skillsUpdated: number; hasMore: boolean }>;
  }
)._handler;

const processSkillStatEventsActionHandler = (
  processSkillStatEventsAction as unknown as {
    _handler: (
      ctx: unknown,
      args: Record<string, never>,
    ) => Promise<{ skillsUpdated: number; exhausted: boolean }>;
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

const pruneProcessedSkillStatEventBatchInternalHandler = (
  pruneProcessedSkillStatEventBatchInternal as unknown as {
    _handler: (
      ctx: unknown,
      args: {
        cutoffProcessedAt: number;
        dryRun: boolean;
        batchSize?: number;
        minProcessedAt?: number;
        maxProcessedAt?: number;
        confirmationToken?: string;
      },
    ) => Promise<{ matched: number; deleted: number; hasMore: boolean }>;
  }
)._handler;

const pruneProcessedSkillStatEventsInternalHandler = (
  pruneProcessedSkillStatEventsInternal as unknown as {
    _handler: (
      ctx: unknown,
      args: {
        dryRun?: boolean;
        retentionDays?: number;
        batchSize?: number;
        maxBatches?: number;
        minProcessedAt?: number;
        maxProcessedAt?: number;
        confirmationToken?: string;
      },
    ) => Promise<{ matched: number; deleted: number; scheduledContinuation: boolean }>;
  }
)._handler;

const kickProcessedSkillStatEventPruneInternalHandler = (
  kickProcessedSkillStatEventPruneInternal as unknown as {
    _handler: (
      ctx: unknown,
      args: {
        dryRun?: boolean;
        retentionDays?: number;
        batchSize?: number;
        maxBatches?: number;
        minProcessedAt?: number;
        maxProcessedAt?: number;
        confirmationToken?: string;
      },
    ) => Promise<{
      ok: true;
      dryRun: boolean;
      retentionDays: number;
      batchSize: number;
      maxBatches: number;
    }>;
  }
)._handler;

describe("skill stat events", () => {
  it("advances the action cursor for retired comment events without writing stat deltas", async () => {
    const event = {
      _id: "skillStatEvents:comment",
      _creationTime: 456,
      skillId: "skills:1",
      kind: "comment",
      occurredAt: 1000,
      processedAt: undefined,
    };
    const runQuery = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce([event]);
    const runMutation = vi.fn(async () => ({ skillsUpdated: 1 }));
    const scheduler = { runAfter: vi.fn() };
    const ctx = { runQuery, runMutation, scheduler };

    await expect(processSkillStatEventsActionHandler(ctx, {})).resolves.toEqual({
      skillsUpdated: 1,
      exhausted: true,
    });

    expect(runQuery).toHaveBeenNthCalledWith(1, apiRefs.getStatEventCursor);
    expect(runQuery).toHaveBeenNthCalledWith(2, apiRefs.getUnprocessedEventBatch, {
      cursorCreationTime: undefined,
      limit: 500,
    });
    expect(runMutation).toHaveBeenCalledWith(apiRefs.applyAggregatedStatsAndUpdateCursor, {
      skillDeltas: [
        {
          skillId: "skills:1",
          downloads: 0,
          stars: 0,
          installsAllTime: 0,
          installsCurrent: 0,
          downloadEvents: [],
          installNewEvents: [],
        },
      ],
      newCursor: 456,
    });
    expect(scheduler.runAfter).not.toHaveBeenCalled();
  });

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

  it("dry-runs processed event pruning through a bounded processedAt range", async () => {
    const oldProcessedEvent = {
      _id: "skillStatEvents:old",
      skillId: "skills:1",
      kind: "download",
      occurredAt: 1000,
      processedAt: 2000,
    };
    const deleteDoc = vi.fn();
    const gt = vi.fn(function (this: unknown) {
      return this;
    });
    const lt = vi.fn(function (this: unknown) {
      return this;
    });
    const take = vi.fn(async () => [oldProcessedEvent]);
    const ctx = {
      db: {
        delete: deleteDoc,
        query: vi.fn((table: string) => {
          if (table !== "skillStatEvents") throw new Error(`unexpected table ${table}`);
          return {
            withIndex: vi.fn((indexName: string, range: (q: unknown) => unknown) => {
              expect(indexName).toBe("by_unprocessed");
              range({ gt, lt });
              return { take };
            }),
          };
        }),
      },
    };

    await expect(
      pruneProcessedSkillStatEventBatchInternalHandler(ctx, {
        cutoffProcessedAt: 10_000,
        dryRun: true,
        batchSize: 5000,
      }),
    ).resolves.toMatchObject({ matched: 1, deleted: 0, hasMore: false });

    expect(gt).toHaveBeenCalledWith("processedAt", 0);
    expect(lt).toHaveBeenCalledWith("processedAt", 10_000);
    expect(take).toHaveBeenCalledWith(3000);
    expect(deleteDoc).not.toHaveBeenCalled();
  });

  it("dry-runs processed event pruning within a lane-specific processedAt range", async () => {
    const laneEvent = {
      _id: "skillStatEvents:lane",
      skillId: "skills:1",
      kind: "download",
      occurredAt: 1000,
      processedAt: 7000,
    };
    const gte = vi.fn(function (this: unknown) {
      return this;
    });
    const lt = vi.fn(function (this: unknown) {
      return this;
    });
    const take = vi.fn(async () => [laneEvent]);
    const ctx = {
      db: {
        delete: vi.fn(),
        query: vi.fn((table: string) => {
          if (table !== "skillStatEvents") throw new Error(`unexpected table ${table}`);
          return {
            withIndex: vi.fn((indexName: string, range: (q: unknown) => unknown) => {
              expect(indexName).toBe("by_unprocessed");
              range({ gte, lt });
              return { take };
            }),
          };
        }),
      },
    };

    await expect(
      pruneProcessedSkillStatEventBatchInternalHandler(ctx, {
        cutoffProcessedAt: 10_000,
        dryRun: true,
        batchSize: 1000,
        minProcessedAt: 5_000,
        maxProcessedAt: 8_000,
      }),
    ).resolves.toMatchObject({ matched: 1, deleted: 0, hasMore: false });

    expect(gte).toHaveBeenCalledWith("processedAt", 5_000);
    expect(lt).toHaveBeenCalledWith("processedAt", 8_000);
    expect(take).toHaveBeenCalledWith(1000);
  });

  it("requires confirmation before deleting old processed stat events", async () => {
    const ctx = { db: { delete: vi.fn(), query: vi.fn() } };

    await expect(
      pruneProcessedSkillStatEventBatchInternalHandler(ctx, {
        cutoffProcessedAt: 10_000,
        dryRun: false,
      }),
    ).rejects.toThrow("confirmationToken=PRUNE_PROCESSED_SKILL_STAT_EVENTS");
  });

  it("continues processed event pruning when the manual kick hits its batch cap", async () => {
    vi.spyOn(Date, "now").mockReturnValue(20 * 24 * 60 * 60 * 1000);
    const runQuery = vi.fn().mockResolvedValue(15 * 24 * 60 * 60 * 1000);
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce({ matched: 1000, deleted: 1000, hasMore: true })
      .mockResolvedValueOnce({ matched: 1000, deleted: 1000, hasMore: true });
    const scheduler = { runAfter: vi.fn() };

    await expect(
      pruneProcessedSkillStatEventsInternalHandler(
        { runQuery, runMutation, scheduler },
        {
          dryRun: false,
          retentionDays: 7,
          batchSize: 1000,
          maxBatches: 2,
          confirmationToken: "PRUNE_PROCESSED_SKILL_STAT_EVENTS",
        },
      ),
    ).resolves.toMatchObject({
      matched: 2000,
      deleted: 2000,
      scheduledContinuation: true,
    });

    expect(runQuery).toHaveBeenCalledWith(apiRefs.getStatEventCursor);
    expect(runMutation).toHaveBeenCalledTimes(2);
    expect(runMutation.mock.calls[0]?.[0]).toBe(apiRefs.pruneProcessedSkillStatEventBatchInternal);
    expect(runMutation.mock.calls[0]?.[1]).toMatchObject({
      cutoffProcessedAt: 13 * 24 * 60 * 60 * 1000,
      batchSize: 1000,
      dryRun: false,
      confirmationToken: "PRUNE_PROCESSED_SKILL_STAT_EVENTS",
    });
    expect(scheduler.runAfter).toHaveBeenCalledWith(
      0,
      apiRefs.pruneProcessedSkillStatEventsInternal,
      expect.objectContaining({
        dryRun: false,
        retentionDays: 7,
        batchSize: 1000,
        maxBatches: 2,
        confirmationToken: "PRUNE_PROCESSED_SKILL_STAT_EVENTS",
      }),
    );
  });

  it("preserves lane bounds when processed event pruning schedules continuation", async () => {
    vi.spyOn(Date, "now").mockReturnValue(20 * 24 * 60 * 60 * 1000);
    const runQuery = vi.fn().mockResolvedValue(15 * 24 * 60 * 60 * 1000);
    const runMutation = vi.fn().mockResolvedValue({ matched: 1000, deleted: 1000, hasMore: true });
    const scheduler = { runAfter: vi.fn() };

    await expect(
      pruneProcessedSkillStatEventsInternalHandler(
        { runQuery, runMutation, scheduler },
        {
          dryRun: false,
          retentionDays: 7,
          batchSize: 1000,
          maxBatches: 1,
          minProcessedAt: 5 * 24 * 60 * 60 * 1000,
          maxProcessedAt: 9 * 24 * 60 * 60 * 1000,
          confirmationToken: "PRUNE_PROCESSED_SKILL_STAT_EVENTS",
        },
      ),
    ).resolves.toMatchObject({
      matched: 1000,
      deleted: 1000,
      scheduledContinuation: true,
    });

    expect(runMutation).toHaveBeenCalledWith(
      apiRefs.pruneProcessedSkillStatEventBatchInternal,
      expect.objectContaining({
        cutoffProcessedAt: 9 * 24 * 60 * 60 * 1000,
        minProcessedAt: 5 * 24 * 60 * 60 * 1000,
        maxProcessedAt: 9 * 24 * 60 * 60 * 1000,
      }),
    );
    expect(scheduler.runAfter).toHaveBeenCalledWith(
      0,
      apiRefs.pruneProcessedSkillStatEventsInternal,
      expect.objectContaining({
        minProcessedAt: 5 * 24 * 60 * 60 * 1000,
        maxProcessedAt: 9 * 24 * 60 * 60 * 1000,
      }),
    );
  });

  it("caps processed event pruning at the daily stats cursor", async () => {
    vi.spyOn(Date, "now").mockReturnValue(20 * 24 * 60 * 60 * 1000);
    const dailyCursor = 11 * 24 * 60 * 60 * 1000;
    const runQuery = vi.fn().mockResolvedValue(dailyCursor);
    const runMutation = vi.fn().mockResolvedValue({ matched: 0, deleted: 0, hasMore: false });
    const scheduler = { runAfter: vi.fn() };

    await expect(
      pruneProcessedSkillStatEventsInternalHandler(
        { runQuery, runMutation, scheduler },
        {
          dryRun: false,
          retentionDays: 7,
          batchSize: 1000,
          maxBatches: 2,
          confirmationToken: "PRUNE_PROCESSED_SKILL_STAT_EVENTS",
        },
      ),
    ).resolves.toMatchObject({
      cutoffProcessedAt: dailyCursor,
      retentionCutoffProcessedAt: 13 * 24 * 60 * 60 * 1000,
      dailyStatsCursorCreationTime: dailyCursor,
      matched: 0,
      deleted: 0,
      scheduledContinuation: false,
    });

    expect(runMutation.mock.calls[0]?.[1]).toMatchObject({
      cutoffProcessedAt: dailyCursor,
    });
  });

  it("does not prune processed events before the daily stats cursor exists", async () => {
    const runQuery = vi.fn().mockResolvedValue(undefined);
    const runMutation = vi.fn();
    const scheduler = { runAfter: vi.fn() };

    await expect(
      pruneProcessedSkillStatEventsInternalHandler(
        { runQuery, runMutation, scheduler },
        {
          dryRun: false,
          confirmationToken: "PRUNE_PROCESSED_SKILL_STAT_EVENTS",
        },
      ),
    ).resolves.toMatchObject({
      batches: 0,
      matched: 0,
      deleted: 0,
      stoppedReason: "cursor_not_ready",
      scheduledContinuation: false,
    });

    expect(runMutation).not.toHaveBeenCalled();
    expect(scheduler.runAfter).not.toHaveBeenCalled();
  });

  it("samples only one processed event batch during dry-run", async () => {
    vi.spyOn(Date, "now").mockReturnValue(20 * 24 * 60 * 60 * 1000);
    const runQuery = vi.fn().mockResolvedValue(15 * 24 * 60 * 60 * 1000);
    const runMutation = vi.fn().mockResolvedValue({ matched: 1000, deleted: 0, hasMore: true });
    const scheduler = { runAfter: vi.fn() };

    await expect(
      pruneProcessedSkillStatEventsInternalHandler(
        { runQuery, runMutation, scheduler },
        {
          dryRun: true,
          retentionDays: 7,
          batchSize: 1000,
          maxBatches: 20,
        },
      ),
    ).resolves.toMatchObject({
      batches: 1,
      matched: 1000,
      deleted: 0,
      stoppedReason: "max_batches",
      scheduledContinuation: false,
    });

    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(scheduler.runAfter).not.toHaveBeenCalled();
  });

  it("manual prune kick defaults to dry-run and schedules the bounded prune action", async () => {
    const scheduler = { runAfter: vi.fn() };

    await expect(
      kickProcessedSkillStatEventPruneInternalHandler({ scheduler }, {}),
    ).resolves.toEqual({
      ok: true,
      dryRun: true,
      retentionDays: 7,
      batchSize: 1000,
      maxBatches: 20,
    });

    expect(scheduler.runAfter).toHaveBeenCalledWith(
      0,
      apiRefs.pruneProcessedSkillStatEventsInternal,
      {
        dryRun: true,
        retentionDays: 7,
        batchSize: 1000,
        maxBatches: 20,
        confirmationToken: undefined,
      },
    );
  });

  it("manual prune kick forwards lane bounds to the bounded prune action", async () => {
    const scheduler = { runAfter: vi.fn() };

    await expect(
      kickProcessedSkillStatEventPruneInternalHandler(
        { scheduler },
        {
          dryRun: false,
          retentionDays: 7,
          batchSize: 3000,
          maxBatches: 20,
          minProcessedAt: 5_000,
          maxProcessedAt: 10_000,
          confirmationToken: "PRUNE_PROCESSED_SKILL_STAT_EVENTS",
        },
      ),
    ).resolves.toMatchObject({
      ok: true,
      dryRun: false,
      retentionDays: 7,
      batchSize: 3000,
      maxBatches: 20,
    });

    expect(scheduler.runAfter).toHaveBeenCalledWith(
      0,
      apiRefs.pruneProcessedSkillStatEventsInternal,
      expect.objectContaining({
        minProcessedAt: 5_000,
        maxProcessedAt: 10_000,
      }),
    );
  });

  it("manual prune kick clamps oversized lane batches to the production-safe batch size", async () => {
    const scheduler = { runAfter: vi.fn() };

    await expect(
      kickProcessedSkillStatEventPruneInternalHandler(
        { scheduler },
        {
          dryRun: false,
          batchSize: 5000,
          maxBatches: 20,
          minProcessedAt: 5_000,
          maxProcessedAt: 10_000,
          confirmationToken: "PRUNE_PROCESSED_SKILL_STAT_EVENTS",
        },
      ),
    ).resolves.toMatchObject({
      batchSize: 3000,
    });

    expect(scheduler.runAfter).toHaveBeenCalledWith(
      0,
      apiRefs.pruneProcessedSkillStatEventsInternal,
      expect.objectContaining({
        batchSize: 3000,
      }),
    );
  });

  it("manual prune kick requires confirmation before scheduling destructive apply", async () => {
    const scheduler = { runAfter: vi.fn() };

    await expect(
      kickProcessedSkillStatEventPruneInternalHandler(
        { scheduler },
        {
          dryRun: false,
        },
      ),
    ).rejects.toThrow("confirmationToken=PRUNE_PROCESSED_SKILL_STAT_EVENTS");

    expect(scheduler.runAfter).not.toHaveBeenCalled();
  });
});
