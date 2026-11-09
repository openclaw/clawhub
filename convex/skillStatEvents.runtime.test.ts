/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function seedSkill(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const ownerUserId = await ctx.db.insert("users", { handle: "stat-cursor-owner" });
    return await ctx.db.insert("skills", {
      slug: "stat-cursor",
      displayName: "Stat cursor",
      ownerUserId,
      tags: {},
      stats: { comments: 0, downloads: 0, stars: 0, versions: 0 },
      createdAt: 1,
      updatedAt: 1,
    });
  });
}

it("drops the partial page cursor once that creation-time range is finished", async () => {
  const t = convexTest(schema, modules);
  const skillId = await seedSkill(t);
  await t.run(async (ctx) => {
    await ctx.db.insert("skillStatUpdateCursors", {
      key: "skill_stat_events",
      cursorCreationTime: 10,
      paginationCursor: "page-2",
      paginationLowerBound: 10,
      updatedAt: 1,
    });
  });

  await t.mutation(internal.skillStatEvents.applyAggregatedStatsAndUpdateCursor, {
    skillDeltas: [
      {
        skillId,
        downloads: 0,
        stars: 0,
        installsAllTime: 1,
        installsCurrent: 1,
        downloadEvents: [],
        installNewEvents: [20],
      },
    ],
    newCursor: 30,
    clearPaginationCursor: true,
  });

  const cursor = await t.run(async (ctx) => {
    return await ctx.db
      .query("skillStatUpdateCursors")
      .withIndex("by_key", (q) => q.eq("key", "skill_stat_events"))
      .unique();
  });
  expect(cursor?.cursorCreationTime).toBe(30);
  expect(cursor?.paginationCursor).toBeUndefined();
  expect(cursor?.paginationLowerBound).toBeUndefined();
  expect(cursor?.pendingCreationTime).toBeUndefined();
});

it("aggregates a full page and the following row through the scheduled action", async () => {
  const t = convexTest(schema, modules);
  const occurredAt = Date.UTC(2026, 9, 24, 12);
  await t.run(async (ctx) => {
    const ownerUserId = await ctx.db.insert("users", { handle: "stat-page-owner" });
    await ctx.db.insert("skillStatUpdateCursors", {
      key: "skill_stat_events",
      cursorCreationTime: 1,
      updatedAt: 1,
    });
    const skillIds = [];
    for (let skillIndex = 0; skillIndex < 51; skillIndex += 1) {
      skillIds.push(
        await ctx.db.insert("skills", {
          slug: `stat-page-${skillIndex}`,
          displayName: `Stat page ${skillIndex}`,
          ownerUserId,
          tags: {},
          stats: { comments: 0, downloads: 0, stars: 0, versions: 0 },
          createdAt: 1,
          updatedAt: 1,
        }),
      );
    }
    for (let eventIndex = 0; eventIndex < 501; eventIndex += 1) {
      const skillId = skillIds[Math.min(50, Math.floor(eventIndex / 10))]!;
      await ctx.db.insert("skillStatEvents", {
        skillId,
        kind: "install_new",
        occurredAt,
        processedAt: undefined,
      });
    }
  });

  const first = await t.action(internal.skillStatEvents.processSkillStatEventsAction, {});
  const midpoint = await t.run(async (ctx) => {
    return await ctx.db
      .query("skillStatUpdateCursors")
      .withIndex("by_key", (q) => q.eq("key", "skill_stat_events"))
      .unique();
  });
  const second = await t.action(internal.skillStatEvents.processSkillStatEventsAction, {});
  const finalState = await t.run(async (ctx) => {
    const cursor = await ctx.db
      .query("skillStatUpdateCursors")
      .withIndex("by_key", (q) => q.eq("key", "skill_stat_events"))
      .unique();
    const daily = await ctx.db.query("skillDailyStats").collect();
    return {
      cursor,
      installs: daily.reduce((sum, row) => sum + row.installs, 0),
    };
  });

  expect(first.skillsUpdated).toBe(50);
  expect(first.exhausted).toBe(false);
  expect(midpoint?.cursorCreationTime).toBe(1);
  expect(midpoint?.paginationCursor).toEqual(expect.any(String));
  expect(midpoint?.pendingCreationTime).toEqual(expect.any(Number));
  expect(second.exhausted).toBe(true);
  expect(finalState.installs).toBe(501);
  expect(finalState.cursor?.paginationCursor).toBeUndefined();
  expect(finalState.cursor?.pendingCreationTime).toBeUndefined();
  expect(finalState.cursor?.cursorCreationTime).toBeGreaterThan(1);
});
