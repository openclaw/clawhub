/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import rateLimiter from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import previousRateLimiter from "rate-limiter-previous/test";
import { expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

type Modules = Record<string, () => Promise<unknown>>;

function switchingModules(previous: Modules, current: Modules, upgraded: () => boolean): Modules {
  return Object.fromEntries(
    [...new Set([...Object.keys(previous), ...Object.keys(current)])].map((key) => [
      key,
      () => {
        const load = (upgraded() ? current : previous)[key];
        if (!load) throw new Error(`Missing component module: ${key}`);
        return load();
      },
    ]),
  );
}

it("retains consumed quota when rate limiter implementations change", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 8, 16));
  try {
    let upgraded = false;
    const t = convexTest(schema, import.meta.glob("./**/*.ts"));
    const implementations: Record<string, Modules> = {
      rateLimiterV2: switchingModules(
        previousRateLimiter.modules,
        rateLimiter.modules,
        () => upgraded,
      ),
    };
    // Register once: replacing registrations would erase the consumed quota.
    // The candidate's additive schema is used throughout; this proves runtime continuity,
    // not a backend deployment or schema migration.
    const registration: typeof t = {
      ...t,
      registerComponent: (name, componentSchema, modules) =>
        t.registerComponent(name, componentSchema, implementations[name] ?? modules),
    };
    rateLimiter.register(registration, "rateLimiterV2");

    const quota = {
      name: "component-upgrade",
      key: "retained-user",
      config: { kind: "fixed window" as const, rate: 1, period: 60_000, start: 0 },
    };
    expect(await t.mutation(internal.rateLimits.consumeHttpRateLimitKeyInternal, quota)).toEqual({
      ok: true,
    });
    upgraded = true;
    const denied = await t.run(async (ctx) => ({
      now: Date.now(),
      status: await ctx.runMutation(internal.rateLimits.consumeHttpRateLimitKeyInternal, quota),
    }));
    const windowEnd = Date.UTC(2026, 8, 16) + quota.config.period;
    expect(denied.status).toMatchObject({
      ok: false,
      retryAfter: windowEnd - denied.now,
    });
    vi.setSystemTime(windowEnd - 1);
    expect(await t.mutation(internal.rateLimits.consumeHttpRateLimitKeyInternal, quota)).toEqual({
      ok: false,
      retryAfter: 1,
    });
    vi.setSystemTime(windowEnd);
    expect(await t.mutation(internal.rateLimits.consumeHttpRateLimitKeyInternal, quota)).toEqual({
      ok: true,
    });
  } finally {
    vi.useRealTimers();
  }
});
