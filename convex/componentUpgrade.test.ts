/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import rateLimiter from "@convex-dev/rate-limiter/test";
import workpool from "@convex-dev/workpool/test";
import { convexTest } from "convex-test";
import previousRateLimiter from "rate-limiter-previous/test";
import { expect, it, vi } from "vitest";
import previousWorkpool from "workpool-previous/test";
import { api, internal } from "./_generated/api";
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

it("retains consumed quota and queued reports when component implementations change", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 8, 16));
  try {
    let upgraded = false;
    const t = convexTest(schema, import.meta.glob("./**/*.ts"));
    const implementations: Record<string, Modules> = {
      rateLimiter: switchingModules(
        previousRateLimiter.modules,
        rateLimiter.modules,
        () => upgraded,
      ),
      searchReports: switchingModules(previousWorkpool.modules, workpool.modules, () => upgraded),
    };
    // Register once: replacing registrations would erase component data and queued jobs.
    // The candidate's additive schema is used throughout; this proves runtime continuity,
    // not a backend deployment or schema migration.
    const registration: typeof t = {
      ...t,
      registerComponent: (name, componentSchema, modules) =>
        t.registerComponent(name, componentSchema, implementations[name] ?? modules),
    };
    rateLimiter.register(registration);
    workpool.register(registration, "searchReports");

    const quota = {
      name: "component-upgrade",
      key: "retained-user",
      config: { kind: "fixed window" as const, rate: 1, period: 60_000, start: 0 },
    };
    expect(await t.mutation(internal.rateLimits.consumeHttpRateLimitKeyInternal, quota)).toEqual({
      ok: true,
    });
    const staff = await t.run((ctx) => ctx.db.insert("users", { role: "moderator" }));
    const signed = t.withIdentity({ subject: staff });
    const queued = await signed.mutation(api.searchReports.start, {
      view: "recommendations",
      artifactKind: "plugin",
    });
    expect(queued.status).toBe("pending");
    const before = await t.run((ctx) => ctx.db.query("searchReportRuns").unique());
    expect(before?.workId).toBeTruthy();

    upgraded = true;
    expect(await t.run((ctx) => ctx.db.query("searchReportRuns").unique())).toEqual(before);
    expect(
      await t.mutation(internal.rateLimits.consumeHttpRateLimitKeyInternal, quota),
    ).toMatchObject({
      ok: false,
      retryAfter: 60_000,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const ready = await signed.action(api.searchReports.get, { reportId: queued.reportId });
    expect(ready.status).toBe("ready");
    const reused = await signed.mutation(api.searchReports.start, {
      view: "recommendations",
      artifactKind: "plugin",
    });
    expect(reused).toMatchObject({ reportId: queued.reportId, status: "ready" });
    vi.advanceTimersByTime(60_000);
    expect(await t.mutation(internal.rateLimits.consumeHttpRateLimitKeyInternal, quota)).toEqual({
      ok: true,
    });
  } finally {
    vi.useRealTimers();
  }
});
