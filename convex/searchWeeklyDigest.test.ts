/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import { buildSearchDigest } from "./lib/searchDigest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const weekEnd = Date.parse("2026-09-07T00:00:00Z");
afterEach(() => vi.restoreAllMocks());

it("claims one weekly delivery, rejects overlapping claims, fences stale attempts and never reclaims sent weeks", async () => {
  let now = weekEnd + 17 * 3_600_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const t = convexTest(schema, modules);
  const first = await t.mutation(internal.searchWeeklyDigest.claimInternal, { weekEnd });
  expect(first).toMatchObject({ attempt: 1 });
  expect(await t.mutation(internal.searchWeeklyDigest.claimInternal, { weekEnd })).toBeNull();
  now += 6 * 60_000;
  const second = await t.mutation(internal.searchWeeklyDigest.claimInternal, { weekEnd });
  expect(second).toMatchObject({ attempt: 2 });
  expect(
    await t.mutation(internal.searchWeeklyDigest.finishInternal, {
      weekEnd,
      attempt: 1,
      delivered: true,
    }),
  ).toEqual({ applied: false });
  expect(
    await t.mutation(internal.searchWeeklyDigest.finishInternal, {
      weekEnd,
      attempt: 2,
      delivered: true,
    }),
  ).toEqual({ applied: true });
  now += 24 * 3_600_000;
  expect(await t.mutation(internal.searchWeeklyDigest.claimInternal, { weekEnd })).toBeNull();
  const records = await t.run((ctx) => ctx.db.query("searchWeeklyDigests").collect());
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ status: "sent", attempts: 2 });
});

it("freezes one identity-free payload for retries and records query-free delivery failures", async () => {
  let now = weekEnd + 17 * 3_600_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const t = convexTest(schema, modules);
  const payload = buildSearchDigest({
    weekEnd,
    siteUrl: "https://clawhub.ai",
    totalSearches7d: 0,
    sources7d: { "clawhub-web": 0, "openclaw-control-ui": 0 },
    rows: [],
    classificationStatus: "unavailable",
    currentMetadataStatus: "unavailable",
    truncated: false,
  });
  await t.mutation(internal.searchWeeklyDigest.claimInternal, { weekEnd });
  expect(
    await t.mutation(internal.searchWeeklyDigest.savePayloadInternal, {
      weekEnd,
      attempt: 1,
      payload,
    }),
  ).toEqual({ applied: true });
  await expect(
    t.mutation(internal.searchWeeklyDigest.savePayloadInternal, {
      weekEnd,
      attempt: 1,
      payload: { ...payload, userId: "disallowed" },
    } as never),
  ).rejects.toThrow();
  await t.mutation(internal.searchWeeklyDigest.finishInternal, {
    weekEnd,
    attempt: 1,
    delivered: false,
    failureCode: "hermit_http_failure",
  });
  expect(await t.mutation(internal.searchWeeklyDigest.claimInternal, { weekEnd })).toBeNull();
  now += 3 * 60_000;
  const retry = await t.mutation(internal.searchWeeklyDigest.claimInternal, { weekEnd });
  expect(retry).toMatchObject({ attempt: 2, payload });
  expect(
    await t.mutation(internal.searchWeeklyDigest.savePayloadInternal, {
      weekEnd,
      attempt: 2,
      payload: { ...payload, totalSearches: 1 },
    }),
  ).toEqual({ applied: false });
});

it("prunes only expired weekly payloads at the indexed retention boundary", async () => {
  const t = convexTest(schema, modules);
  vi.spyOn(Date, "now").mockReturnValue(weekEnd);
  await t.run(async (ctx) => {
    for (const expirationTime of [weekEnd - 1, weekEnd, weekEnd + 1]) {
      await ctx.db.insert("searchWeeklyDigests", {
        weekEnd,
        status: "sent",
        attempts: 1,
        claimedUntil: 0,
        nextAttemptAt: 0,
        expirationTime,
      });
    }
  });
  expect(await t.mutation(internal.searchWeeklyDigest.pruneExpiredInternal, {})).toEqual({
    deleted: 2,
  });
  expect(await t.run((ctx) => ctx.db.query("searchWeeklyDigests").collect())).toHaveLength(1);
});
