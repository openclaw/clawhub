/* @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import {
  computeRecommendationScore,
  RECOMMENDATION_SCORE_VERSION,
} from "./lib/recommendationScore";
import {
  processPackageStatEventsInternal,
  recordPackageDownloadInternal,
  recordPackageInstallInternal,
} from "./packages";

type WrappedHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const recordDownloadHandler = (
  recordPackageDownloadInternal as unknown as WrappedHandler<{ packageId: string }, void>
)._handler;

const recordInstallHandler = (
  recordPackageInstallInternal as unknown as WrappedHandler<{ packageId: string }, void>
)._handler;

const processStatsHandler = (
  processPackageStatEventsInternal as unknown as WrappedHandler<
    { batchSize?: number },
    { processed: number; packagesUpdated: number }
  >
)._handler;

describe("package stat events", () => {
  it("records downloads as append-only events", async () => {
    const insert = vi.fn();

    await recordDownloadHandler(
      {
        db: {
          query: vi.fn(),
          get: vi.fn(),
          normalizeId: vi.fn(),
          insert,
          patch: vi.fn(),
          replace: vi.fn(),
          delete: vi.fn(),
          system: {
            get: vi.fn(),
            query: vi.fn(),
          },
        },
      },
      {
        packageId: "packages:one",
      },
    );

    expect(insert).toHaveBeenCalledWith(
      "packageStatEvents",
      expect.objectContaining({
        packageId: "packages:one",
        kind: "download",
        processedAt: undefined,
      }),
    );
  });

  it("records installs as append-only events", async () => {
    const insert = vi.fn();

    await recordInstallHandler(
      {
        db: {
          query: vi.fn(),
          get: vi.fn(),
          normalizeId: vi.fn(),
          insert,
          patch: vi.fn(),
          replace: vi.fn(),
          delete: vi.fn(),
          system: {
            get: vi.fn(),
            query: vi.fn(),
          },
        },
      },
      {
        packageId: "packages:one",
      },
    );

    expect(insert).toHaveBeenCalledWith(
      "packageStatEvents",
      expect.objectContaining({
        packageId: "packages:one",
        kind: "install",
        processedAt: undefined,
      }),
    );
  });

  it("aggregates queued downloads and installs before patching package stats", async () => {
    const events = [
      { _id: "packageStatEvents:1", packageId: "packages:one", kind: "download" },
      { _id: "packageStatEvents:2", packageId: "packages:one", kind: "install" },
      { _id: "packageStatEvents:3", packageId: "packages:two", kind: "download" },
    ];
    const patch = vi.fn();
    const ctx = {
      db: {
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            take: vi.fn(async () => events),
          })),
        })),
        get: vi.fn(async (id: string) => ({
          _id: id,
          stats: { downloads: 10, installs: 1, stars: 2, versions: 3 },
        })),
        normalizeId: vi.fn(),
        insert: vi.fn(),
        patch,
        replace: vi.fn(),
        delete: vi.fn(),
        system: {
          get: vi.fn(),
          query: vi.fn(),
        },
      },
      scheduler: {
        runAfter: vi.fn(),
      },
    };

    const result = await processStatsHandler(ctx, { batchSize: 10 });

    expect(result).toEqual({ processed: 3, packagesUpdated: 2 });
    expect(patch).toHaveBeenCalledWith(
      "packages:one",
      expect.objectContaining({
        stats: expect.objectContaining({ downloads: 11 }),
        recommendedScore: computeRecommendationScore({
          downloads: 11,
          installs: 2,
          stars: 2,
        }),
        recommendedScoreVersion: RECOMMENDATION_SCORE_VERSION,
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      "packages:one",
      expect.objectContaining({
        stats: expect.objectContaining({ installs: 2 }),
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      "packages:two",
      expect.objectContaining({
        stats: expect.objectContaining({ downloads: 11 }),
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      "packageStatEvents:1",
      expect.objectContaining({ processedAt: expect.any(Number) }),
    );
  });
});
