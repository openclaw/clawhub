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

it.each([
  ["readIp", 3000],
  ["downloadIp", 1200],
  ["readKey", 12000],
] as const)(
  "keeps admitted %s traffic at the limit under batched accounting at 3x load",
  async (name, rate) => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const t = convexTest(schema, modules);
    registerRateLimiter(t);
    const shards = Math.max(1, Math.min(32, Math.floor(rate / 10)));
    const request = {
      name,
      key: `ip:203.0.113.81:${name}`,
      config: { kind: "fixed window", rate, period: 60_000, start: 0, shards },
    } as const;
    // Mirrors applyRateLimit: one request in four consumes a batch, the rest
    // run the read-only check for the same count.
    let admitted = 0;
    let consumed = 0;
    for (let i = 0; i < rate * 3; i++) {
      if (i % 4 === 0) {
        const status = await t.mutation(internal.rateLimits.consumeHttpRateLimitKeyInternal, {
          ...request,
          count: 4,
        });
        if (status.ok) {
          admitted++;
          consumed += 4;
        }
      } else {
        const status = await t.run(async (ctx) =>
          ctx.runQuery(components.rateLimiter.lib.checkRateLimit, { ...request, count: 4 }),
        );
        if (status.ok) admitted++;
      }
    }
    expect(consumed).toBeLessThanOrEqual(rate);
    // Deterministic sampling: admitted traffic cannot exceed the limit.
    expect(admitted).toBeLessThanOrEqual(rate);
    expect(admitted).toBeGreaterThanOrEqual(rate * 0.9);
  },
  120_000,
);

it("skips pruning entirely while rate-limiter storage is off", async () => {
  vi.spyOn(Date, "now").mockReturnValue(1_000_000);
  vi.stubEnv("CLAWHUB_RATE_LIMITER_DISABLED", "1");
  try {
    const t = convexTest(schema, modules);
    registerRateLimiter(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("httpRateLimitKeys", {
        name: "readIp",
        key: "ip:203.0.113.90:read",
        shard: 0,
        lastTouchedAt: 1,
        expiresAt: 2,
      });
    });
    expect(await t.mutation(internal.rateLimits.pruneHttpRateLimitKeysInternal, {})).toEqual({
      deleted: 0,
      hasMore: false,
    });
    const remaining = await t.run(async (ctx) => ctx.db.query("httpRateLimitKeys").collect());
    expect(remaining).toHaveLength(1);
  } finally {
    vi.unstubAllEnvs();
  }
});
