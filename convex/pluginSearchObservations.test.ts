/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const observation = {
  source: "clawhub-web" as const,
  artifactKind: "plugin" as const,
  normalizedQuery: "weather api",
  category: "tools",
  topic: "automation",
  resultCount: 3,
  officialResultCount: 1,
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("plugin search observations", () => {
  it.each([
    { normalizedQuery: "" },
    { normalizedQuery: " Not normalized " },
    { normalizedQuery: "x".repeat(257) },
    { category: "x".repeat(121) },
    { topic: "x".repeat(121) },
    { resultCount: -1 },
    { resultCount: 1.5 },
    { officialResultCount: 4 },
  ])("rejects invalid bounded facts before persistence: %j", async (override) => {
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(internal.pluginSearchObservations.recordInternal, { ...observation, ...override }),
    ).rejects.toThrow();
    expect(await t.run((ctx) => ctx.db.query("pluginSearchObservations").collect())).toEqual([]);
  });
  it("persists only the bounded search facts with the server observation time", async () => {
    const now = Date.UTC(2026, 8, 8, 22);
    vi.spyOn(Date, "now").mockReturnValue(now);
    const t = convexTest(schema, modules);

    const result = await t.mutation(internal.pluginSearchObservations.recordInternal, observation);
    const rows = await t.run(
      async (ctx) => await ctx.db.query("pluginSearchObservations").collect(),
    );

    expect(result.observedAt).toBe(now);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ...observation, observedAt: now });
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual(
      [
        "_creationTime",
        "_id",
        "artifactKind",
        "category",
        "normalizedQuery",
        "observedAt",
        "officialResultCount",
        "resultCount",
        "source",
        "topic",
      ].sort(),
    );
  });

  it("prunes observations at the 30-day cutoff and keeps newer rows", async () => {
    const cutoff = Date.UTC(2026, 7, 9, 22);
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (const observedAt of [cutoff - 1, cutoff, cutoff + 1]) {
        await ctx.db.insert("pluginSearchObservations", { ...observation, observedAt });
      }
    });

    const result = await t.mutation(internal.pluginSearchObservations.pruneExpiredInternal, {
      batchSize: 10,
      cutoff,
    });
    const rows = await t.run(
      async (ctx) => await ctx.db.query("pluginSearchObservations").collect(),
    );

    expect(result).toEqual({ deleted: 2, hasMore: false });
    expect(rows.map((row) => row.observedAt)).toEqual([cutoff + 1]);
  });

  it("continues a full bounded prune batch with the same cutoff", async () => {
    vi.useFakeTimers();
    const cutoff = Date.UTC(2026, 7, 9, 22);
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("pluginSearchObservations", { ...observation, observedAt: cutoff - 2 });
      await ctx.db.insert("pluginSearchObservations", { ...observation, observedAt: cutoff - 1 });
    });

    const result = await t.mutation(internal.pluginSearchObservations.pruneExpiredInternal, {
      batchSize: 1,
      cutoff,
    });
    expect(result).toEqual({ deleted: 1, hasMore: true });

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const rows = await t.run(
      async (ctx) => await ctx.db.query("pluginSearchObservations").collect(),
    );
    expect(rows).toEqual([]);
  });
});
