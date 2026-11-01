/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import { components, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

afterEach(() => vi.restoreAllMocks());

it("does not reset an active quota when expired metadata is pruned", async () => {
  const now = 1_000_000;
  vi.spyOn(Date, "now").mockReturnValue(now);
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  const request = {
    name: "retention-proof",
    key: "ip:203.0.113.77:read",
    config: { kind: "fixed window", rate: 1, period: 60_000, start: 0, shards: 1 },
  } as const;
  await t.run(async (ctx) => {
    await ctx.db.insert("httpRateLimitKeys", {
      name: request.name,
      key: request.key,
      shard: 0,
      lastTouchedAt: now - 60_001,
      expiresAt: now - 1,
    });
  });

  expect(
    await t.mutation(internal.rateLimits.consumeHttpRateLimitKeyInternal, {
      ...request,
      metadata: { now, ttlMs: 60_000 },
    }),
  ).toMatchObject({ ok: true });
  expect(await t.mutation(internal.rateLimits.pruneHttpRateLimitKeysInternal, {})).toEqual({
    deleted: 1,
    hasMore: false,
  });
  expect(await t.mutation(internal.rateLimits.consumeHttpRateLimitKeyInternal, request)).toEqual({
    ok: false,
    retryAfter: 20_000,
  });
});

it("rolls back quota when a parent transaction aborts after a combined check", async () => {
  vi.spyOn(Date, "now").mockReturnValue(1_000_000);
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  const request = {
    name: "rollback-proof",
    key: "ip:203.0.113.78:read",
    config: { kind: "fixed window", rate: 1, period: 60_000, start: 0, shards: 1 },
    metadata: { now: 1_000_000, ttlMs: 60_000 },
  } as const;

  await expect(
    t.run(async (ctx) => {
      await ctx.runMutation(internal.rateLimits.consumeHttpRateLimitKeyInternal, request);
      throw new Error("fixture transaction abort");
    }),
  ).rejects.toThrow("fixture transaction abort");
  expect(await t.mutation(internal.rateLimits.consumeHttpRateLimitKeyInternal, request)).toEqual({
    ok: true,
  });
  expect(await t.mutation(internal.rateLimits.consumeHttpRateLimitKeyInternal, request)).toEqual({
    ok: false,
    retryAfter: 20_000,
  });
});

it("consumes batched counts in one write and exposes exhaustion to read-only checks", async () => {
  vi.spyOn(Date, "now").mockReturnValue(1_000_000);
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  const request = {
    name: "batched-proof",
    key: "ip:203.0.113.79:read",
    config: { kind: "fixed window", rate: 40, period: 60_000, start: 0, shards: 1 },
  } as const;
  for (let i = 0; i < 10; i++) {
    expect(
      await t.mutation(internal.rateLimits.consumeHttpRateLimitKeyInternal, {
        ...request,
        count: 4,
      }),
    ).toEqual({ ok: true });
  }
  expect(
    await t.mutation(internal.rateLimits.consumeHttpRateLimitKeyInternal, { ...request, count: 4 }),
  ).toMatchObject({ ok: false });
  const peek = await t.run(async (ctx) =>
    ctx.runQuery(components.rateLimiter.lib.checkRateLimit, {
      name: request.name,
      key: request.key,
      config: request.config,
    }),
  );
  expect(peek).toMatchObject({ ok: false });
});

it("never exceeds the production read bucket with batched counts", async () => {
  vi.spyOn(Date, "now").mockReturnValue(1_000_000);
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  const request = {
    name: "readIp",
    key: "ip:203.0.113.80:read",
    config: { kind: "fixed window", rate: 3000, period: 60_000, start: 0, shards: 32 },
  } as const;
  let consumed = 0;
  for (let i = 0; i < 850; i++) {
    const status = await t.mutation(internal.rateLimits.consumeHttpRateLimitKeyInternal, {
      ...request,
      count: 4,
    });
    if (status.ok) consumed += 4;
  }
  // Shard fragmentation can strand less than one batch per shard.
  expect(consumed).toBeLessThanOrEqual(3000);
  expect(consumed).toBeGreaterThanOrEqual(3000 - 4 * 32);
});
