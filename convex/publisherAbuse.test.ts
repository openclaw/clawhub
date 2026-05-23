/* @vitest-environment node */

import { describe, expect, it, vi } from "vitest";

vi.mock("./functions", () => ({
  internalAction: (def: { handler: unknown }) => ({ _handler: def.handler }),
  internalMutation: (def: { handler: unknown }) => ({ _handler: def.handler }),
  internalQuery: (def: { handler: unknown }) => ({ _handler: def.handler }),
  mutation: (def: { handler: unknown }) => ({ _handler: def.handler }),
  query: (def: { handler: unknown }) => ({ _handler: def.handler }),
}));

vi.mock("./_generated/api", () => ({
  internal: {
    publisherAbuse: {
      collectPublisherAbuseScoresPageInternal: Symbol("collectPublisherAbuseScoresPageInternal"),
      finalizePublisherAbuseScoresPageInternal: Symbol("finalizePublisherAbuseScoresPageInternal"),
      getOrStartPublisherAbuseScoreRunInternal: Symbol("getOrStartPublisherAbuseScoreRunInternal"),
      runPublisherAbuseScoreRunInternal: Symbol("runPublisherAbuseScoreRunInternal"),
    },
  },
}));

vi.mock("./lib/access", () => ({
  assertAdmin: vi.fn((user: { role?: string }) => {
    if (user.role !== "admin") throw new Error("Forbidden");
  }),
  requireUser: vi.fn(async () => ({
    userId: "users:admin",
    user: { _id: "users:admin", role: "admin" },
  })),
}));

const publisherAbuse = await import("./publisherAbuse");

type Handler<TArgs, TResult> = (ctx: unknown, args: TArgs) => Promise<TResult>;
type Wrapped<TArgs, TResult> = { _handler: Handler<TArgs, TResult> };

const collectHandler = (
  publisherAbuse.collectPublisherAbuseScoresPageInternal as unknown as Wrapped<
    { runId: string; batchSize?: number },
    { isDone: boolean; scanned: number; phase: string }
  >
)._handler;

const finalizeHandler = (
  publisherAbuse.finalizePublisherAbuseScoresPageInternal as unknown as Wrapped<
    { runId: string; batchSize?: number },
    { isDone: boolean; finalized: number; nominations: number }
  >
)._handler;

const runHandler = (
  publisherAbuse.runPublisherAbuseScoreRunInternal as unknown as Wrapped<
    { batchSize?: number; maxPages?: number },
    { ok: true; runId: string; pages: number; isDone: boolean }
  >
)._handler;

const startManualHandler = (
  publisherAbuse.startManualPublisherAbuseScoreRun as unknown as Wrapped<
    { batchSize?: number; maxPages?: number },
    { ok: true; runId: string }
  >
)._handler;

describe("publisher abuse dry-run persistence", () => {
  it("collects score rows without patching enforcement tables", async () => {
    const insert = vi.fn(async (table: string) => `${table}:new`);
    const patch = vi.fn(async () => null);
    const ctx = {
      db: {
        get: vi.fn(async () => ({
          _id: "publisherAbuseScoreRuns:run",
          status: "running",
          phase: "collecting",
          collectCursor: undefined,
          scannedPublishers: 0,
          scoredPublishers: 0,
          sumLogPressure: 0,
          sumSquaredLogPressure: 0,
        })),
        insert,
        patch,
        query: vi.fn((table: string) => {
          if (table !== "publishers") throw new Error(`unexpected table ${table}`);
          return {
            withIndex: () => ({
              paginate: async () => ({
                page: [
                  {
                    _id: "publishers:gora050",
                    handle: "gora050",
                    linkedUserId: "users:gora050",
                    publishedSkills: 1200,
                    totalInstalls: 8,
                    totalStars: 0,
                    totalDownloads: 120,
                  },
                ],
                isDone: true,
                continueCursor: "",
              }),
            }),
          };
        }),
      },
    };

    await expect(collectHandler(ctx, { runId: "publisherAbuseScoreRuns:run" })).resolves.toEqual(
      expect.objectContaining({ isDone: false, scanned: 1, phase: "finalizing" }),
    );

    expect(insert).toHaveBeenCalledWith(
      "publisherAbuseScores",
      expect.objectContaining({
        ownerKey: "publisher:publishers:gora050",
        handleSnapshot: "gora050",
      }),
    );
    expect(insert).not.toHaveBeenCalledWith("users", expect.anything());
    expect(insert).not.toHaveBeenCalledWith("publishers", expect.anything());
    expect(insert).not.toHaveBeenCalledWith("skills", expect.anything());
    expect(insert).not.toHaveBeenCalledWith("skillSearchDigest", expect.anything());
    expect(patch).not.toHaveBeenCalledWith(
      expect.stringMatching(/^(users|publishers|skills|skillSearchDigest):/),
      expect.anything(),
    );
  });

  it("updates an existing nomination for the same publisher and model version", async () => {
    const insert = vi.fn(async (table: string) => `${table}:new`);
    const patch = vi.fn(async () => null);
    const ctx = {
      db: {
        get: vi.fn(async () => ({
          _id: "publisherAbuseScoreRuns:run",
          status: "running",
          phase: "finalizing",
          modelVersion: "publisher-abuse-pressure.v1",
          scoredPublishers: 1,
          finalizedScores: 0,
          passCount: 0,
          reviewCount: 0,
          potentialBanCandidateCount: 0,
          nominatedPublishers: 0,
          sumLogPressure: 3,
          sumSquaredLogPressure: 9,
        })),
        insert,
        patch,
        query: vi.fn((table: string) => {
          if (table === "publisherAbuseScores") {
            return {
              withIndex: () => ({
                order: () => ({
                  paginate: async () => ({
                    page: [
                      {
                        _id: "publisherAbuseScores:score",
                        ownerKey: "publisher:publishers:gora050",
                        ownerPublisherId: "publishers:gora050",
                        ownerUserId: "users:gora050",
                        handleSnapshot: "gora050",
                        modelVersion: "publisher-abuse-pressure.v1",
                        pressure: 1000,
                        logPressure: 6,
                        publishedSkills: 1200,
                        totalInstalls: 8,
                        totalStars: 0,
                        totalDownloads: 120,
                        installsPerSkill: 0.006,
                        starsPerSkill: 0,
                        downloadsPerSkill: 0.1,
                        reasonCodes: ["high_catalog_volume"],
                      },
                    ],
                    isDone: true,
                    continueCursor: "",
                  }),
                }),
              }),
            };
          }
          if (table === "publisherAbuseReviewNominations") {
            return {
              withIndex: () => ({
                first: async () => ({
                  _id: "publisherAbuseReviewNominations:existing",
                  status: "pending",
                }),
              }),
            };
          }
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await expect(finalizeHandler(ctx, { runId: "publisherAbuseScoreRuns:run" })).resolves.toEqual(
      expect.objectContaining({ isDone: true, finalized: 1, nominations: 1 }),
    );

    expect(insert).not.toHaveBeenCalledWith("publisherAbuseReviewNominations", expect.anything());
    expect(patch).toHaveBeenCalledWith(
      "publisherAbuseReviewNominations:existing",
      expect.objectContaining({ latestScoreId: "publisherAbuseScores:score" }),
    );
  });

  it("schedules a continuation after the action page budget is exhausted", async () => {
    const scheduler = { runAfter: vi.fn(async () => null) };
    const ctx = {
      scheduler,
      runMutation: vi
        .fn()
        .mockResolvedValueOnce({
          runId: "publisherAbuseScoreRuns:run",
          phase: "collecting",
          status: "running",
        })
        .mockResolvedValueOnce({
          runId: "publisherAbuseScoreRuns:run",
          phase: "collecting",
          isDone: false,
          scanned: 100,
        }),
    };

    await expect(runHandler(ctx, { batchSize: 100, maxPages: 1 })).resolves.toEqual({
      ok: true,
      runId: "publisherAbuseScoreRuns:run",
      pages: 1,
      isDone: false,
    });

    expect(scheduler.runAfter).toHaveBeenCalledWith(
      60_000,
      expect.anything(),
      expect.objectContaining({ runId: "publisherAbuseScoreRuns:run" }),
    );
  });

  it("lets an admin start a manual dry-run recompute", async () => {
    const scheduler = { runAfter: vi.fn(async () => null) };
    const ctx = {
      scheduler,
      db: {
        insert: vi.fn(async () => "publisherAbuseScoreRuns:manual"),
      },
    };

    await expect(startManualHandler(ctx, { batchSize: 50, maxPages: 2 })).resolves.toEqual({
      ok: true,
      runId: "publisherAbuseScoreRuns:manual",
    });

    expect(ctx.db.insert).toHaveBeenCalledWith(
      "publisherAbuseScoreRuns",
      expect.objectContaining({ trigger: "manual", actorUserId: "users:admin" }),
    );
    expect(scheduler.runAfter).toHaveBeenCalledWith(
      0,
      expect.anything(),
      expect.objectContaining({ runId: "publisherAbuseScoreRuns:manual" }),
    );
  });
});
