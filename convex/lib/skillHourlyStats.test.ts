/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import {
  HOUR_MS,
  bumpHistoricalHourlySkillStats,
  bumpLiveHourlySkillStats,
  getHistoricalEventHourlyDelta,
  getHistoricalStarHourlyDelta,
  getCompletedRolling24HourWindow,
  sumRollingHourlyStats,
} from "./skillHourlyStats";

const modules = import.meta.glob("../**/*.ts");

describe("rolling 24-hour skill metrics", () => {
  it("uses exactly the latest 24 complete hourly buckets", () => {
    const now = 100 * HOUR_MS + 37 * 60 * 1_000;

    expect(getCompletedRolling24HourWindow(now)).toEqual({
      startHour: 76,
      endHour: 99,
      startAt: 76 * HOUR_MS,
      endAt: 100 * HOUR_MS,
    });
  });

  it("combines the historical seed and live deltas without exposing negative totals", () => {
    expect(
      sumRollingHourlyStats([
        {
          skillId: "skills:one",
          downloads: 6,
          installs: 8,
          bookmarks: 0,
          updatedAt: 10,
        },
        {
          skillId: "skills:one",
          downloads: 1,
          installs: 2,
          bookmarks: 0,
          updatedAt: 20,
        },
      ]),
    ).toEqual(
      new Map([
        [
          "skills:one",
          {
            downloads: 7,
            installs: 10,
            bookmarks: 0,
            updatedAt: 20,
          },
        ],
      ]),
    );
  });

  it("keeps historical seed counts separate from concurrent live deltas", async () => {
    const t = convexTest(schema, modules);
    const hourAt = 90 * HOUR_MS;
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(100 * HOUR_MS);
    const rows = await t.run(async (ctx) => {
      const now = Date.now();
      const userId = await ctx.db.insert("users", {
        handle: "hourly-owner",
        createdAt: now,
        updatedAt: now,
      });
      const skillId = await ctx.db.insert("skills", {
        slug: "hourly-skill",
        displayName: "Hourly skill",
        ownerUserId: userId,
        tags: {},
        stats: { downloads: 0, stars: 0, versions: 0, comments: 0 },
        createdAt: now,
        updatedAt: now,
      });

      await bumpHistoricalHourlySkillStats(ctx, {
        skillId,
        occurredAt: hourAt,
        downloads: 2,
        installs: 3,
        bookmarks: 1,
      });
      await bumpLiveHourlySkillStats(ctx, {
        skillId,
        occurredAt: hourAt,
        downloads: 4,
        installs: 5,
        bookmarks: -1,
      });

      return await ctx.db
        .query("skillHourlyStats")
        .withIndex("by_skill_and_hour_and_generation", (q) =>
          q.eq("skillId", skillId).eq("hour", 90),
        )
        .collect();
    });
    nowSpy.mockRestore();

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          hour: 90,
          generation: 0,
          downloads: 2,
          installs: 3,
          bookmarks: 1,
        }),
        expect.objectContaining({
          hour: 90,
          generation: 1,
          downloads: 4,
          installs: 5,
          bookmarks: -1,
        }),
      ]),
    );
  });

  it("captures the existing event cursor before the first live hourly write", async () => {
    const t = convexTest(schema, modules);
    const now = 200 * HOUR_MS;
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    const state = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        handle: "hourly-state-owner",
        createdAt: now,
        updatedAt: now,
      });
      const skillId = await ctx.db.insert("skills", {
        slug: "hourly-state-skill",
        displayName: "Hourly state skill",
        ownerUserId: userId,
        tags: {},
        stats: { downloads: 0, stars: 0, versions: 0, comments: 0 },
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("skillStatUpdateCursors", {
        key: "skill_stat_events",
        cursorCreationTime: 500,
        updatedAt: now - 1,
      });

      await bumpLiveHourlySkillStats(ctx, {
        skillId,
        occurredAt: now,
        downloads: 1,
      });
      return await ctx.db
        .query("skillHourlyStatStates")
        .withIndex("by_key", (q) => q.eq("key", "canonical_trending"))
        .unique();
    });
    nowSpy.mockRestore();

    expect(state).toMatchObject({
      key: "canonical_trending",
      liveStartedAt: now,
      eventBackfillThroughCreationTime: 500,
      activeGeneration: 1,
    });
  });

  it("seeds only retained activity on the historical side of the live boundary", () => {
    const now = 200 * HOUR_MS;
    const state = {
      liveStartedAt: 190 * HOUR_MS,
      eventBackfillThroughCreationTime: 500,
    };

    expect(
      getHistoricalEventHourlyDelta(
        { kind: "download", occurredAt: 128 * HOUR_MS, _creationTime: 500 },
        state,
        now,
      ),
    ).toEqual({ downloads: 1 });
    expect(
      getHistoricalEventHourlyDelta(
        { kind: "install_new", occurredAt: 128 * HOUR_MS, _creationTime: 501 },
        state,
        now,
      ),
    ).toBeNull();
    expect(
      getHistoricalEventHourlyDelta(
        { kind: "download", occurredAt: 127 * HOUR_MS, _creationTime: 499 },
        state,
        now,
      ),
    ).toBeNull();
    expect(getHistoricalStarHourlyDelta({ createdAt: 189 * HOUR_MS }, state, now)).toEqual({
      bookmarks: 1,
    });
    expect(getHistoricalStarHourlyDelta({ createdAt: 191 * HOUR_MS }, state, now)).toBeNull();
    expect(
      getHistoricalStarHourlyDelta(
        { createdAt: 189 * HOUR_MS, hourlyStatsRecordedAt: 195 * HOUR_MS },
        state,
        now,
      ),
    ).toBeNull();
  });

  it("moves live writes to a new generation when a snapshot seals its cutoff", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const skillId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        handle: "hourly-generation-owner",
        createdAt: now,
        updatedAt: now,
      });
      const id = await ctx.db.insert("skills", {
        slug: "hourly-generation-skill",
        displayName: "Hourly generation skill",
        ownerUserId: userId,
        tags: {},
        stats: { downloads: 0, stars: 0, versions: 0, comments: 0 },
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("skillHourlyStatStates", {
        key: "canonical_trending",
        liveStartedAt: now - HOUR_MS,
        eventBackfillThroughCreationTime: 100,
        activeGeneration: 1,
        backfillCompletedAt: now - HOUR_MS,
        lastAggregationCompletedAt: now - 1,
        updatedAt: now - 1,
      });
      return id;
    });

    await expect(
      t.mutation(internal.skillHourlyStats.sealForSnapshotInternal, { now }),
    ).resolves.toMatchObject({ sealedGeneration: 1 });
    await t.run(async (ctx) => {
      await bumpLiveHourlySkillStats(ctx, {
        skillId,
        occurredAt: now - HOUR_MS,
        downloads: 1,
      });
    });

    await expect(
      t.run(
        async (ctx) =>
          await ctx.db
            .query("skillHourlyStats")
            .withIndex("by_skill_and_hour_and_generation", (q) => q.eq("skillId", skillId))
            .collect(),
      ),
    ).resolves.toEqual([expect.objectContaining({ generation: 2, downloads: 1 })]);
  });

  it("records processed downloads and first installs in their original hourly buckets", async () => {
    const t = convexTest(schema, modules);
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(100 * HOUR_MS);
    const userId = await t.run(async (ctx) => {
      const now = Date.now();
      return await ctx.db.insert("users", {
        handle: "hourly-processor-owner",
        createdAt: now,
        updatedAt: now,
      });
    });
    const skillId = await t.run(async (ctx) => {
      const now = Date.now();
      return await ctx.db.insert("skills", {
        slug: "hourly-processor-skill",
        displayName: "Hourly processor skill",
        ownerUserId: userId,
        tags: {},
        stats: { downloads: 0, stars: 0, versions: 0, comments: 0 },
        createdAt: now,
        updatedAt: now,
      });
    });

    await t.mutation(internal.skillStatEvents.applyAggregatedStatsAndUpdateCursor, {
      skillDeltas: [
        {
          skillId,
          downloads: 1,
          stars: 0,
          installsAllTime: 1,
          installsCurrent: 1,
          downloadEvents: [80 * HOUR_MS + 1],
          installNewEvents: [81 * HOUR_MS + 1],
        },
      ],
      newCursor: 123,
    });

    const rows = await t.run(
      async (ctx) =>
        await ctx.db
          .query("skillHourlyStats")
          .withIndex("by_skill_and_hour_and_generation", (q) => q.eq("skillId", skillId))
          .collect(),
    );
    nowSpy.mockRestore();
    expect(rows.map(({ hour, downloads, installs }) => ({ hour, downloads, installs }))).toEqual([
      { hour: 80, downloads: 1, installs: 0 },
      { hour: 81, downloads: 0, installs: 1 },
    ]);
  });

  it("prunes only expired hourly buckets in bounded batches", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    const { expiredId, freshId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        handle: "hourly-prune-owner",
        createdAt: now,
        updatedAt: now,
      });
      const skillId = await ctx.db.insert("skills", {
        slug: "hourly-prune-skill",
        displayName: "Hourly prune skill",
        ownerUserId: userId,
        tags: {},
        stats: { downloads: 0, stars: 0, versions: 0, comments: 0 },
        createdAt: now,
        updatedAt: now,
      });
      const base = {
        skillId,
        generation: 1,
        downloads: 1,
        installs: 0,
        bookmarks: 0,
        updatedAt: now,
      };
      return {
        expiredId: await ctx.db.insert("skillHourlyStats", {
          ...base,
          hour: 1,
          expiresAt: now - 1,
        }),
        freshId: await ctx.db.insert("skillHourlyStats", {
          ...base,
          hour: 2,
          expiresAt: now + 1,
        }),
      };
    });

    await expect(
      t.mutation(internal.skillHourlyStats.pruneExpiredInternal, { batchSize: 10 }),
    ).resolves.toEqual({ deleted: 1, hasMore: false });
    await expect(
      t.run(async (ctx) => ({
        expired: await ctx.db.get(expiredId),
        fresh: await ctx.db.get(freshId),
      })),
    ).resolves.toMatchObject({ expired: null, fresh: expect.objectContaining({ _id: freshId }) });
    nowSpy.mockRestore();
  });

  it("requires an explicit confirmation token before applying the historical seed", async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.action(internal.migrations.runSkillHourlyStatsBackfill, { dryRun: false }),
    ).rejects.toThrow('Pass confirm="apply-skill-hourly-stats-backfill" to apply.');
  });
});
