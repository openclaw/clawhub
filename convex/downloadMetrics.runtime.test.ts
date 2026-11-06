/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { unzipSync } from "fflate";
import { afterEach, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const dayStart = Date.UTC(2026, 10, 5);
const occurredAt = dayStart + 12 * 60 * 60 * 1000;

async function seedPackage(
  t: ReturnType<typeof convexTest>,
  overrides: Partial<Doc<"packages">> = {},
) {
  return await t.run(async (ctx) => {
    const ownerUserId = await ctx.db.insert("users", { handle: "metric-owner" });
    return await ctx.db.insert("packages", {
      name: "@fixture/research",
      normalizedName: "@fixture/research",
      displayName: "Research",
      ownerUserId,
      family: "claw",
      channel: "community",
      isOfficial: false,
      tags: {},
      stats: { downloads: 0, installs: 0, stars: 0, versions: 1 },
      createdAt: 1,
      updatedAt: 1,
      ...overrides,
    });
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

it("logs the committed Template download stat-event ID with an allowlisted payload", async () => {
  vi.useFakeTimers();
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  const t = convexTest(schema, modules);
  const packageId = await seedPackage(t, {
    summary: "private-listing-detail-sentinel",
    sourceRepo: "token-sentinel",
  });

  await t.mutation(internal.downloadMetrics.recordDownloadMetricInternal, {
    target: { kind: "package", id: packageId },
    identityKind: "ip",
    identityHash: "sensitive-identity-hash",
    dayStart,
    occurredAt,
  });
  expect(log).not.toHaveBeenCalled();
  const events = await t.run(async (ctx) => await ctx.db.query("packageStatEvents").collect());
  expect(events).toHaveLength(1);
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  expect(log).toHaveBeenCalledExactlyOnceWith(
    JSON.stringify({
      event: "template_download_counted",
      schemaVersion: 1,
      eventId: events[0]!._id,
      packageId,
      packageName: "@fixture/research",
      family: "template",
      occurredAt,
      dayStart,
    }),
  );
});

it("dedupes repeat downloads per target/identity/UTC day and preserves event IDs on replay", async () => {
  vi.useFakeTimers();
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  const t = convexTest(schema, modules);
  const packageId = await seedPackage(t);
  const args = {
    target: { kind: "package" as const, id: packageId },
    identityKind: "user" as const,
    identityHash: "sensitive-user-hash",
    dayStart,
    occurredAt,
  };
  await t.mutation(internal.downloadMetrics.recordDownloadMetricInternal, args);
  await t.mutation(internal.downloadMetrics.recordDownloadMetricInternal, args);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(log).toHaveBeenCalledTimes(1);
  await t.mutation(internal.downloadMetrics.recordDownloadMetricInternal, {
    ...args,
    dayStart: dayStart + 86_400_000,
    occurredAt: occurredAt + 86_400_000,
  });
  await t.mutation(internal.downloadMetrics.recordDownloadMetricInternal, {
    ...args,
    identityHash: "different-user-hash",
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(log).toHaveBeenCalledTimes(3);
  const events = await t.run(async (ctx) => await ctx.db.query("packageStatEvents").collect());
  expect(events).toHaveLength(3);
  await t.mutation(internal.downloadMetrics.emitTemplateDownloadCountedInternal, {
    eventId: events[0]!._id,
    dayStart,
  });
  expect(log).toHaveBeenCalledTimes(4);
  expect(log.mock.calls[3]).toEqual(log.mock.calls[0]);
  const uniqueIds = new Set(log.mock.calls.map(([line]) => JSON.parse(String(line)).eventId));
  expect(uniqueIds.size).toBe(3);
});

it("rolls back the stat, dedupe and scheduled emission if the enclosing transaction fails", async () => {
  vi.useFakeTimers();
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  const t = convexTest(schema, modules);
  const packageId = await seedPackage(t);
  await expect(
    t.run(async (ctx) => {
      await ctx.runMutation(internal.downloadMetrics.recordDownloadMetricInternal, {
        target: { kind: "package", id: packageId },
        identityKind: "ip",
        identityHash: "rolled-back",
        dayStart,
        occurredAt,
      });
      throw new Error("rollback after scheduling");
    }),
  ).rejects.toThrow("rollback after scheduling");
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(log).not.toHaveBeenCalled();
  const state = await t.run(async (ctx) => ({
    events: await ctx.db.query("packageStatEvents").collect(),
    dedupes: await ctx.db.query("downloadMetricDedupes").collect(),
    scheduled: await ctx.db.system.query("_scheduled_functions").collect(),
  }));
  expect(state).toEqual({ events: [], dedupes: [], scheduled: [] });
});

it("makes queued metrics a no-op while paused", async () => {
  vi.useFakeTimers();
  vi.stubEnv("CLAWHUB_DOWNLOAD_METRICS_PAUSED", "1");
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  const t = convexTest(schema, modules);
  const packageId = await seedPackage(t);
  await t.mutation(internal.downloadMetrics.recordDownloadMetricInternal, {
    target: { kind: "package", id: packageId },
    identityKind: "ip",
    identityHash: "paused",
    dayStart,
    occurredAt,
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(log).not.toHaveBeenCalled();
  expect(await t.run(async (ctx) => await ctx.db.query("packageStatEvents").collect())).toEqual([]);
  expect(await t.run(async (ctx) => await ctx.db.query("downloadMetricDedupes").collect())).toEqual(
    [],
  );
});

it.each([
  { family: "code-plugin" as const },
  { family: "bundle-plugin" as const },
  { family: "skill" as const },
  { channel: "private" as const, name: "private-name" },
  { softDeletedAt: 1 },
])(
  "preserves existing package metrics without logging excluded listings: %j",
  async (overrides) => {
    vi.useFakeTimers();
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const t = convexTest(schema, modules);
    const packageId = await seedPackage(t, overrides);
    await t.mutation(internal.downloadMetrics.recordDownloadMetricInternal, {
      target: { kind: "package", id: packageId },
      identityKind: "ip",
      identityHash: "excluded",
      dayStart,
      occurredAt,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(log).not.toHaveBeenCalled();
    expect(
      await t.run(async (ctx) => await ctx.db.query("packageStatEvents").collect()),
    ).toHaveLength(1);
  },
);

it("rechecks listing privacy at emission and ignores missing or non-download stat events", async () => {
  vi.useFakeTimers();
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  const t = convexTest(schema, modules);
  const packageId = await seedPackage(t);
  await t.mutation(internal.downloadMetrics.recordDownloadMetricInternal, {
    target: { kind: "package", id: packageId },
    identityKind: "ip",
    identityHash: "public-then-private",
    dayStart,
    occurredAt,
  });
  await t.run(async (ctx) => {
    await ctx.db.patch(packageId, { channel: "private", name: "private-name" });
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(log).not.toHaveBeenCalled();
  const installId = await t.run(async (ctx) => {
    await ctx.db.patch(packageId, { channel: "community" });
    return await ctx.db.insert("packageStatEvents", { packageId, kind: "install", occurredAt });
  });
  await t.mutation(internal.downloadMetrics.emitTemplateDownloadCountedInternal, {
    eventId: installId,
    dayStart,
  });
  await t.run(async (ctx) => {
    await ctx.db.delete(installId);
  });
  await t.mutation(internal.downloadMetrics.emitTemplateDownloadCountedInternal, {
    eventId: installId,
    dayStart,
  });
  expect(log).not.toHaveBeenCalled();
});

it("counts the real Template download HTTP route once while serving repeated downloads", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(occurredAt);
  vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiterV2");
  const packageId = await seedPackage(t, {
    name: "fixture-research",
    normalizedName: "fixture-research",
  });
  await t.run(async (ctx) => {
    const pkg = (await ctx.db.get(packageId))!;
    const storageId = await ctx.storage.store(
      new Blob(["# Research fixture\n"], { type: "text/markdown" }),
    );
    const releaseId = await ctx.db.insert("packageReleases", {
      packageId,
      version: "1.0.0",
      publicationStatus: "published",
      changelog: "Fixture",
      integritySha256: "b".repeat(64),
      distTags: ["latest"],
      files: [{ path: "README.md", size: 19, sha256: "a".repeat(64), storageId }],
      llmAnalysis: { status: "clean", checkedAt: 1 },
      createdAt: 1,
      createdBy: pkg.ownerUserId,
    });
    await ctx.db.patch(packageId, { latestReleaseId: releaseId, tags: { latest: releaseId } });
  });
  const request = () => t.fetch("/api/v1/packages/fixture-research/download");
  for (let repeat = 0; repeat < 2; repeat += 1) {
    const response = await request();
    expect(response.status).toBe(200);
    const entries = unzipSync(new Uint8Array(await response.arrayBuffer()));
    expect(new TextDecoder().decode(entries["package/README.md"])).toBe("# Research fixture\n");
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(log).toHaveBeenCalledTimes(1);
  }
  expect(
    await t.run(async (ctx) => await ctx.db.query("packageStatEvents").collect()),
  ).toHaveLength(1);
  vi.stubEnv("CLAWHUB_DOWNLOAD_METRICS_PAUSED", "1");
  vi.setSystemTime(occurredAt + 86_400_000);
  expect((await request()).status).toBe(200);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(log).toHaveBeenCalledTimes(1);
  expect(
    await t.run(async (ctx) => await ctx.db.query("packageStatEvents").collect()),
  ).toHaveLength(1);
});

it("uses the existing fallback timestamp and retains a committed count across a later pause", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(occurredAt);
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  const t = convexTest(schema, modules);
  const packageId = await seedPackage(t);
  await t.mutation(internal.downloadMetrics.recordDownloadMetricInternal, {
    target: { kind: "package", id: packageId },
    identityKind: "ip",
    identityHash: "fallback",
    dayStart,
  });
  vi.stubEnv("CLAWHUB_DOWNLOAD_METRICS_PAUSED", "1");
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(log).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(log.mock.calls[0]![0]))).toMatchObject({ occurredAt, dayStart });
});

it("keeps skill-target downloads on the existing stat path without a Template log", async () => {
  vi.useFakeTimers();
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  const t = convexTest(schema, modules);
  const skillId = await t.run(async (ctx) => {
    const ownerUserId = await ctx.db.insert("users", { handle: "skill-owner" });
    return await ctx.db.insert("skills", {
      slug: "metric-skill",
      displayName: "Metric skill",
      ownerUserId,
      tags: {},
      stats: { comments: 0, downloads: 0, stars: 0, versions: 0 },
      createdAt: 1,
      updatedAt: 1,
    });
  });
  await t.mutation(internal.downloadMetrics.recordDownloadMetricInternal, {
    target: { kind: "skill", id: skillId },
    identityKind: "user",
    identityHash: "skill-identity",
    dayStart,
    occurredAt,
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(log).not.toHaveBeenCalled();
  expect(await t.run(async (ctx) => await ctx.db.query("skillStatEvents").collect())).toHaveLength(
    1,
  );
});
