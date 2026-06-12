/* @vitest-environment node */
import { describe, expect, it, vi } from "vitest";

// Mock the Convex function wrappers so that importing statsMaintenance.ts does
// not attempt to load the Convex runtime (convex/server) in the Node test env.
vi.mock("./functions", () => ({
  internalMutation: (def: { handler: unknown }) => def,
  internalQuery: (def: { handler: unknown }) => def,
  internalAction: (def: { handler: unknown }) => def,
}));

vi.mock("./_generated/api", () => ({
  internal: {
    statsMaintenance: {
      backfillSkillStatFieldsInternal: Symbol("backfillSkillStatFieldsInternal"),
      backfillSkillDigestRecommendationScoresInternal: Symbol(
        "backfillSkillDigestRecommendationScoresInternal",
      ),
      backfillPackageRecommendationScoresInternal: Symbol(
        "backfillPackageRecommendationScoresInternal",
      ),
      getSkillStatBackfillStateInternal: Symbol("getSkillStatBackfillStateInternal"),
      setSkillStatBackfillStateInternal: Symbol("setSkillStatBackfillStateInternal"),
      reconcileSkillStarCounts: Symbol("reconcileSkillStarCounts"),
      countPublicDigestPageInternal: Symbol("countPublicDigestPageInternal"),
      countPublicPackageDigestPageInternal: Symbol("countPublicPackageDigestPageInternal"),
      writeGlobalStatsInternal: Symbol("writeGlobalStatsInternal"),
    },
  },
}));

const {
  __test,
  backfillPackageRecommendationScoresInternal,
  backfillSkillDigestRecommendationScoresInternal,
  countPublicPackageDigestPageInternal,
  reconcileSkillStarCountsHandler,
  runRecommendationScoreBackfillInternal,
  updateGlobalStatsAction,
} = await import("./statsMaintenance");
const {
  buildSkillStatPatch,
  computePackageRecommendationScore,
  computeSkillDigestRecommendationScore,
} = __test;
const { RECOMMENDATION_SCORE_VERSION } = await import("./lib/recommendationScore");

type WrappedHandler<TArgs, TResult> = {
  handler?: (ctx: unknown, args: TArgs) => Promise<TResult>;
  _handler?: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

function getHandler<TArgs, TResult>(fn: WrappedHandler<TArgs, TResult>) {
  const handler = fn.handler ?? fn._handler;
  if (!handler) throw new Error("Missing function handler");
  return handler;
}

const countPublicPackageDigestPageHandler = getHandler<
  { cursor?: string; pageSize?: number },
  { count: number; isDone: boolean; cursor: string }
>(countPublicPackageDigestPageInternal as never);

const backfillSkillDigestRecommendationScoresHandler = getHandler<
  { cursor?: string; batchSize?: number; dryRun?: boolean },
  { scanned: number; patched: number; cursor: string | null; isDone: boolean; dryRun: boolean }
>(backfillSkillDigestRecommendationScoresInternal as never);

const backfillPackageRecommendationScoresHandler = getHandler<
  { cursor?: string; batchSize?: number; dryRun?: boolean },
  { scanned: number; patched: number; cursor: string | null; isDone: boolean; dryRun: boolean }
>(backfillPackageRecommendationScoresInternal as never);

const runRecommendationScoreBackfillHandler = getHandler<
  {
    skillCursor?: string;
    packageCursor?: string;
    skillsDone?: boolean;
    packagesDone?: boolean;
    batchSize?: number;
    maxBatches?: number;
    dryRun?: boolean;
  },
  {
    ok: true;
    dryRun: boolean;
    scoreVersion: number;
    isDone: boolean;
    skillsDone: boolean;
    packagesDone: boolean;
    skillCursor: string | null;
    packageCursor: string | null;
    stats: {
      skills: { scanned: number; patched: number; batches: number };
      packages: { scanned: number; patched: number; batches: number };
    };
  }
>(runRecommendationScoreBackfillInternal as never);

const updateGlobalStatsActionHandler = getHandler<
  Record<string, never>,
  { activeSkillsCount: number; activePluginsCount: number }
>(updateGlobalStatsAction as never);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal skill doc for testing.  Only the stat-related fields are
 * required; everything else is left as `undefined` / cast via `as never`.
 */
function makeSkill(overrides: {
  statsDownloads?: number;
  statsStars?: number;
  statsInstallsCurrent?: number;
  statsInstallsAllTime?: number;
  stats: {
    downloads: number;
    stars: number;
    installsCurrent?: number;
    installsAllTime?: number;
    comments: number;
  };
}) {
  return overrides as never;
}

function oldRecommendationScore(stats: { downloads: number; installs: number; stars: number }) {
  return Math.round(
    Math.log1p(stats.downloads) * 100 +
      Math.log1p(stats.installs) * 60 +
      Math.log1p(stats.stars) * 120,
  );
}

// ---------------------------------------------------------------------------
// buildSkillStatPatch
// ---------------------------------------------------------------------------

describe("buildSkillStatPatch", () => {
  it("scenario 1: top-level fields present and already in sync with nested → returns null", () => {
    const skill = makeSkill({
      statsDownloads: 10,
      statsStars: 5,
      statsInstallsCurrent: 3,
      statsInstallsAllTime: 20,
      stats: { downloads: 10, stars: 5, installsCurrent: 3, installsAllTime: 20, comments: 1 },
    });

    expect(buildSkillStatPatch(skill)).toBeNull();
  });

  it("scenario 2: top-level fields present but nested fields are stale → patches nested to match top-level", () => {
    const skill = makeSkill({
      statsDownloads: 10,
      statsStars: 5,
      statsInstallsCurrent: 3,
      statsInstallsAllTime: 20,
      stats: { downloads: 1, stars: 1, installsCurrent: 0, installsAllTime: 0, comments: 0 },
    });

    const patch = buildSkillStatPatch(skill);
    expect(patch).not.toBeNull();
    // Top-level fields must be written with the canonical (top-level) values.
    expect(patch!.statsDownloads).toBe(10);
    expect(patch!.statsStars).toBe(5);
    expect(patch!.statsInstallsCurrent).toBe(3);
    expect(patch!.statsInstallsAllTime).toBe(20);
    // Nested fields must be brought in sync with the top-level values.
    expect(patch!.stats.downloads).toBe(10);
    expect(patch!.stats.stars).toBe(5);
    expect(patch!.stats.installsCurrent).toBe(3);
    expect(patch!.stats.installsAllTime).toBe(20);
  });

  it("scenario 3: top-level fields absent (pre-migration doc) → reads from nested, writes both sets", () => {
    const skill = makeSkill({
      // No statsDownloads / statsStars / etc. — pre-migration document.
      stats: { downloads: 7, stars: 3, installsCurrent: 2, installsAllTime: 15, comments: 4 },
    });

    const patch = buildSkillStatPatch(skill);
    expect(patch).not.toBeNull();
    // Top-level fields must be populated from the nested values.
    expect(patch!.statsDownloads).toBe(7);
    expect(patch!.statsStars).toBe(3);
    expect(patch!.statsInstallsCurrent).toBe(2);
    expect(patch!.statsInstallsAllTime).toBe(15);
    // Nested fields must remain consistent.
    expect(patch!.stats.downloads).toBe(7);
    expect(patch!.stats.stars).toBe(3);
    expect(patch!.stats.installsCurrent).toBe(2);
    expect(patch!.stats.installsAllTime).toBe(15);
  });

  it("scenario 4: top-level fields present but nested is out of sync → patches nested to match top-level (not the other way around)", () => {
    // This is the exact bug that was previously shipped: the old code wrote
    // nested → top-level instead of top-level → nested.
    const skill = makeSkill({
      statsDownloads: 100,
      statsStars: 50,
      statsInstallsCurrent: 30,
      statsInstallsAllTime: 200,
      stats: { downloads: 1, stars: 1, installsCurrent: 1, installsAllTime: 1, comments: 0 },
    });

    const patch = buildSkillStatPatch(skill);
    expect(patch).not.toBeNull();
    // The canonical top-level values must win.
    expect(patch!.statsDownloads).toBe(100);
    expect(patch!.statsStars).toBe(50);
    expect(patch!.statsInstallsCurrent).toBe(30);
    expect(patch!.statsInstallsAllTime).toBe(200);
    // The stale nested values must be overwritten by the top-level values.
    expect(patch!.stats.downloads).toBe(100);
    expect(patch!.stats.stars).toBe(50);
    expect(patch!.stats.installsCurrent).toBe(30);
    expect(patch!.stats.installsAllTime).toBe(200);
  });

  it("preserves unrelated nested fields (e.g. comments) when patching stat fields", () => {
    const skill = makeSkill({
      statsDownloads: 5,
      statsStars: 2,
      statsInstallsCurrent: 1,
      statsInstallsAllTime: 10,
      stats: { downloads: 0, stars: 0, installsCurrent: 0, installsAllTime: 0, comments: 99 },
    });

    const patch = buildSkillStatPatch(skill);
    expect(patch).not.toBeNull();
    // comments is not a stat field managed by buildSkillStatPatch — it must be
    // carried over unchanged from the original nested object.
    expect(patch!.stats.comments).toBe(99);
  });
});

describe("public package digest count maintenance", () => {
  it("counts only public code and bundle plugin digests", async () => {
    const paginate = vi.fn().mockResolvedValue({
      page: [
        {
          family: "code-plugin",
          channel: "community",
          scanStatus: "clean",
          softDeletedAt: undefined,
        },
        {
          family: "bundle-plugin",
          channel: "official",
          scanStatus: "not-run",
          softDeletedAt: undefined,
        },
        {
          family: "skill",
          channel: "community",
          scanStatus: "clean",
          softDeletedAt: undefined,
        },
        {
          family: "code-plugin",
          channel: "private",
          scanStatus: "clean",
          softDeletedAt: undefined,
        },
        {
          family: "bundle-plugin",
          channel: "community",
          scanStatus: "malicious",
          softDeletedAt: undefined,
        },
        {
          family: "code-plugin",
          channel: "community",
          scanStatus: "clean",
          softDeletedAt: 123,
        },
      ],
      continueCursor: "next",
      isDone: true,
    });
    const ctx = {
      db: {
        query: vi.fn((table: string) => {
          expect(table).toBe("packageSearchDigest");
          return {
            paginate,
          };
        }),
      },
    };

    const result = await countPublicPackageDigestPageHandler(ctx, {});

    expect(result).toEqual({ count: 2, isDone: true, cursor: "next" });
  });

  it("writes skills and plugin counts in one global stats update", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({ count: 70_300, isDone: true, cursor: "" })
      .mockResolvedValueOnce({ count: 321, isDone: true, cursor: "" });
    const runMutation = vi.fn();

    const result = await updateGlobalStatsActionHandler({ runQuery, runMutation }, {});

    expect(result).toEqual({ activeSkillsCount: 70_300, activePluginsCount: 321 });
    expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
      activeSkillsCount: 70_300,
      activePluginsCount: 321,
    });
  });
});

describe("recommendation score backfills", () => {
  it("computes skill digest recommendation scores from top-level stats first", () => {
    expect(
      computeSkillDigestRecommendationScore({
        statsDownloads: 43_080,
        statsInstallsAllTime: 2,
        statsStars: 0,
        stats: { downloads: 1, installsAllTime: 1, installsCurrent: 0, stars: 20 },
      } as never),
    ).toBeGreaterThan(
      computeSkillDigestRecommendationScore({
        statsDownloads: 1,
        statsInstallsAllTime: 0,
        statsStars: 1,
        stats: { downloads: 43_080, installsAllTime: 2, installsCurrent: 0, stars: 0 },
      } as never),
    );
  });

  it("patches stale skill digest recommendation scores in bounded pages", async () => {
    const patch = vi.fn();
    const stats = { downloads: 393, installsAllTime: 74, installsCurrent: 0, stars: 0 };
    const paginate = vi.fn().mockResolvedValue({
      page: [
        {
          _id: "skillSearchDigest:one",
          statsDownloads: stats.downloads,
          statsInstallsAllTime: stats.installsAllTime,
          statsStars: 0,
          recommendedScore: oldRecommendationScore({
            downloads: stats.downloads,
            installs: stats.installsAllTime,
            stars: 0,
          }),
          stats,
        },
      ],
      isDone: false,
      continueCursor: "next",
    });
    const ctx = {
      db: {
        query: vi.fn((table: string) => {
          expect(table).toBe("skillSearchDigest");
          return { order: vi.fn(() => ({ paginate })) };
        }),
        patch,
      },
    };

    const result = await backfillSkillDigestRecommendationScoresHandler(ctx, {
      cursor: "current",
      batchSize: 1,
    });

    expect(result).toMatchObject({
      scanned: 1,
      patched: 1,
      cursor: "next",
      isDone: false,
      dryRun: false,
    });
    expect(paginate).toHaveBeenCalledWith({ cursor: "current", numItems: 1 });
    expect(patch).toHaveBeenCalledWith("skillSearchDigest:one", {
      recommendedScore: computeSkillDigestRecommendationScore({
        statsDownloads: stats.downloads,
        statsInstallsAllTime: stats.installsAllTime,
        statsStars: 0,
        stats,
      } as never),
      recommendedScoreVersion: RECOMMENDATION_SCORE_VERSION,
    });
  });

  it("dry-runs package recommendation score backfills without patching", async () => {
    const patch = vi.fn();
    const paginate = vi.fn().mockResolvedValue({
      page: [
        {
          _id: "packages:one",
          stats: { downloads: 100, installs: 5, stars: 2, versions: 1 },
          recommendedScore: -1,
        },
      ],
      isDone: true,
      continueCursor: "",
    });
    const ctx = {
      db: {
        query: vi.fn((table: string) => {
          expect(table).toBe("packages");
          return { order: vi.fn(() => ({ paginate })) };
        }),
        patch,
      },
    };

    const result = await backfillPackageRecommendationScoresHandler(ctx, {
      batchSize: 5,
      dryRun: true,
    });

    expect(result).toMatchObject({
      scanned: 1,
      patched: 1,
      cursor: null,
      isDone: true,
      dryRun: true,
    });
    expect(paginate).toHaveBeenCalledWith({ cursor: null, numItems: 5 });
    expect(patch).not.toHaveBeenCalled();
    expect(
      computePackageRecommendationScore({
        stats: { downloads: 100, installs: 5, stars: 2, versions: 1 },
      } as never),
    ).toBeGreaterThan(0);
  });

  it("patches old-formula package recommendation scores", async () => {
    const patch = vi.fn();
    const stats = { downloads: 393, installs: 74, stars: 0, versions: 1 };
    const paginate = vi.fn().mockResolvedValue({
      page: [
        {
          _id: "packages:one",
          stats,
          recommendedScore: oldRecommendationScore(stats),
        },
      ],
      isDone: true,
      continueCursor: "",
    });
    const ctx = {
      db: {
        query: vi.fn((table: string) => {
          expect(table).toBe("packages");
          return { order: vi.fn(() => ({ paginate })) };
        }),
        patch,
      },
    };

    const result = await backfillPackageRecommendationScoresHandler(ctx, {
      batchSize: 5,
    });

    expect(result).toMatchObject({
      scanned: 1,
      patched: 1,
      cursor: null,
      isDone: true,
      dryRun: false,
    });
    expect(patch).toHaveBeenCalledWith("packages:one", {
      recommendedScore: computePackageRecommendationScore({ stats } as never),
      recommendedScoreVersion: RECOMMENDATION_SCORE_VERSION,
    });
  });

  it("runs skill and package recommendation score backfills with resumable cursors", async () => {
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce({
        scanned: 5,
        patched: 4,
        cursor: "skill-next",
        isDone: false,
      })
      .mockResolvedValueOnce({
        scanned: 3,
        patched: 2,
        cursor: null,
        isDone: true,
      })
      .mockResolvedValueOnce({
        scanned: 2,
        patched: 1,
        cursor: null,
        isDone: true,
      });

    const result = await runRecommendationScoreBackfillHandler(
      { runMutation },
      { batchSize: 10, maxBatches: 2, dryRun: true },
    );

    expect(result).toMatchObject({
      ok: true,
      dryRun: true,
      scoreVersion: RECOMMENDATION_SCORE_VERSION,
      isDone: true,
      skillsDone: true,
      packagesDone: true,
      skillCursor: null,
      packageCursor: null,
      stats: {
        skills: { scanned: 7, patched: 5, batches: 2 },
        packages: { scanned: 3, patched: 2, batches: 1 },
      },
    });
    expect(runMutation).toHaveBeenCalledTimes(3);
    expect(runMutation.mock.calls.map((call) => call[1])).toEqual([
      { cursor: undefined, batchSize: 10, dryRun: true },
      { cursor: undefined, batchSize: 10, dryRun: true },
      { cursor: "skill-next", batchSize: 10, dryRun: true },
    ]);
  });

  it("skips completed recommendation score backfill sides when resuming", async () => {
    const runMutation = vi.fn().mockResolvedValueOnce({
      scanned: 2,
      patched: 1,
      cursor: null,
      isDone: true,
    });

    const result = await runRecommendationScoreBackfillHandler(
      { runMutation },
      {
        skillCursor: "skill-next",
        skillsDone: false,
        packagesDone: true,
        batchSize: 10,
        maxBatches: 1,
      },
    );

    expect(result).toMatchObject({
      isDone: true,
      skillsDone: true,
      packagesDone: true,
      skillCursor: null,
      packageCursor: null,
      stats: {
        skills: { scanned: 2, patched: 1, batches: 1 },
        packages: { scanned: 0, patched: 0, batches: 0 },
      },
    });
    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runMutation.mock.calls[0]?.[1]).toEqual({
      cursor: "skill-next",
      batchSize: 10,
      dryRun: false,
    });
  });
});

// ---------------------------------------------------------------------------
// reconcileSkillStarCountsHandler
// ---------------------------------------------------------------------------

describe("reconcileSkillStarCounts", () => {
  /**
   * Build a minimal db mock that returns a single-page result for skills and
   * configurable star / comment record counts.
   */
  function makeCtx(options: {
    skill: {
      _id: string;
      statsStars?: number;
      stats: { stars: number; comments: number };
      softDeletedAt?: number;
    };
    actualStarCount: number;
    actualCommentCount: number;
  }) {
    const { skill, actualStarCount, actualCommentCount } = options;

    const starRecords = Array.from({ length: actualStarCount }, (_, i) => ({
      _id: `stars:${i}`,
      skillId: skill._id,
    }));

    const commentRecords = Array.from({ length: actualCommentCount }, (_, i) => ({
      _id: `comments:${i}`,
      skillId: skill._id,
      softDeletedAt: undefined,
    }));

    const paginate = vi.fn().mockResolvedValue({
      page: [skill],
      continueCursor: null,
      isDone: true,
    });

    const collect = vi
      .fn()
      .mockResolvedValueOnce(starRecords)
      .mockResolvedValueOnce(commentRecords);

    const withIndex = vi.fn().mockReturnValue({ collect });

    const patch = vi.fn().mockResolvedValue(undefined);

    const ctx = {
      db: {
        query: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({ paginate }),
          withIndex,
        }),
        patch,
      },
    } as never;

    return { ctx, patch };
  }

  it("reads from top-level statsStars (canonical path) when deciding whether to patch", async () => {
    // statsStars is correct (matches actual count), but stats.stars is stale.
    // The reconcile job uses the canonical read path (top-level preferred), so
    // it should NOT trigger a patch based on the star count alone.
    const skill = {
      _id: "skills:1",
      statsStars: 5, // canonical value — correct
      stats: { stars: 99, comments: 0 }, // legacy value — stale, but not reconcile's concern
    };

    const { ctx, patch } = makeCtx({ skill, actualStarCount: 5, actualCommentCount: 0 });

    const result = await reconcileSkillStarCountsHandler(ctx, {});

    expect(result.scanned).toBe(1);
    expect(result.patched).toBe(0);
    expect(patch).not.toHaveBeenCalled();
  });

  it("falls back to stats.stars when statsStars is absent (pre-migration doc)", async () => {
    // Pre-migration doc: no top-level statsStars.  The canonical read path
    // falls back to stats.stars.  If that also matches actual count, no patch.
    const skill = {
      _id: "skills:1",
      // statsStars intentionally absent
      stats: { stars: 3, comments: 0 },
    };

    const { ctx, patch } = makeCtx({ skill, actualStarCount: 3, actualCommentCount: 0 });

    const result = await reconcileSkillStarCountsHandler(ctx, {});

    expect(result.scanned).toBe(1);
    expect(result.patched).toBe(0);
    expect(patch).not.toHaveBeenCalled();
  });

  it("patches both statsStars and stats.stars when canonical value drifts from actual count", async () => {
    const skill = {
      _id: "skills:1",
      statsStars: 10, // canonical value — out of sync with actual
      stats: { stars: 10, comments: 0 },
    };

    const { ctx, patch } = makeCtx({ skill, actualStarCount: 7, actualCommentCount: 0 });

    const result = await reconcileSkillStarCountsHandler(ctx, {});

    expect(result.scanned).toBe(1);
    expect(result.patched).toBe(1);
    expect(patch).toHaveBeenCalledWith(
      "skills:1",
      expect.objectContaining({
        statsStars: 7,
        stats: expect.objectContaining({ stars: 7 }),
      }),
    );
  });

  it("patches when comment count drifts even if star count is correct", async () => {
    const skill = {
      _id: "skills:1",
      statsStars: 5,
      stats: { stars: 5, comments: 10 }, // comments out of sync
    };

    const { ctx, patch } = makeCtx({ skill, actualStarCount: 5, actualCommentCount: 3 });

    const result = await reconcileSkillStarCountsHandler(ctx, {});

    expect(result.scanned).toBe(1);
    expect(result.patched).toBe(1);
    expect(patch).toHaveBeenCalledWith(
      "skills:1",
      expect.objectContaining({
        stats: expect.objectContaining({ comments: 3 }),
      }),
    );
  });

  it("skips soft-deleted skills", async () => {
    const skill = {
      _id: "skills:1",
      softDeletedAt: 12345,
      statsStars: 0,
      stats: { stars: 0, comments: 0 },
    };

    const { ctx, patch } = makeCtx({ skill, actualStarCount: 5, actualCommentCount: 0 });

    const result = await reconcileSkillStarCountsHandler(ctx, {});

    // Soft-deleted skills are excluded from scanned count and never patched.
    expect(result.scanned).toBe(0);
    expect(result.patched).toBe(0);
    expect(patch).not.toHaveBeenCalled();
  });
});
