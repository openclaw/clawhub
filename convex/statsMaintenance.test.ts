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
      getSkillStatBackfillStateInternal: Symbol("getSkillStatBackfillStateInternal"),
      setSkillStatBackfillStateInternal: Symbol("setSkillStatBackfillStateInternal"),
      reconcileSkillStarCounts: Symbol("reconcileSkillStarCounts"),
    },
  },
}));

const { __test, reconcileSkillStarCountsHandler } = await import("./statsMaintenance");
const { buildSkillStatPatch } = __test;

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
