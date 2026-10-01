/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */

import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const CRON_BATCH_SIZE = 100;
const LARGE_TEXT = "x".repeat(820_000);

async function seedLargeScannedPackageReleases(t: ReturnType<typeof convexTest>, count: number) {
  const userId = await t.run(async (ctx) => await ctx.db.insert("users", {}));
  const releaseCreationTimes: number[] = [];

  for (let index = 0; index < count; index += 1) {
    const packageId = await t.run(async (ctx) =>
      ctx.db.insert("packages", {
        name: `@runtime/backfill-${index}`,
        normalizedName: `@runtime/backfill-${index}`,
        displayName: `Backfill ${index}`,
        summary: LARGE_TEXT,
        ownerUserId: userId,
        family: "code-plugin",
        channel: "community",
        isOfficial: false,
        tags: {},
        compatibility: {},
        verification: { tier: "structural", scope: "artifact-only", scanStatus: "clean" },
        scanStatus: "clean",
        stats: { downloads: 0, installs: 0, stars: 0, versions: 1 },
        createdAt: index,
        updatedAt: index,
      }),
    );
    const releaseId = await t.run(async (ctx) =>
      ctx.db.insert("packageReleases", {
        packageId,
        version: "1.0.0",
        changelog: "",
        summary: LARGE_TEXT,
        distTags: [],
        files: [],
        integritySha256: `${index}`.padStart(64, "0"),
        compatibility: {},
        verification: { tier: "structural", scope: "artifact-only", scanStatus: "clean" },
        vtAnalysis: { status: "clean", checkedAt: 1 },
        llmAnalysis: { status: "clean", checkedAt: 1 },
        staticScan: {
          status: "clean",
          reasonCodes: [],
          findings: [],
          summary: "clean",
          engineVersion: "runtime-test",
          checkedAt: 1,
        },
        source: {},
        createdBy: userId,
        publishActor: { kind: "user", userId },
        createdAt: index,
      }),
    );
    const release = await t.run(async (ctx) => ctx.db.get(releaseId));
    releaseCreationTimes.push(release?._creationTime ?? 0);
  }

  return releaseCreationTimes;
}

describe("package release scan backfill runtime", () => {
  it("keeps a cron-sized historical continuation within the Convex read limit", async () => {
    const t = convexTest({ schema, modules, transactionLimits: true });
    const creationTimes = await seedLargeScannedPackageReleases(t, 20);

    let cursor = 0;
    let done = false;
    let pages = 0;
    while (!done) {
      const page = await t.query(internal.packages.getPackageReleaseScanBackfillBatchInternal, {
        cursor,
        batchSize: CRON_BATCH_SIZE,
        prioritizeRecent: false,
      });
      expect(page.nextCursor).toBeGreaterThan(cursor);
      cursor = page.nextCursor;
      done = page.done;
      pages += 1;
    }

    expect(pages).toBeGreaterThan(1);
    expect(cursor).toBe(Math.max(...creationTimes));
  });

  it("completes the normal cron action through large historical continuation pages", async () => {
    const t = convexTest({ schema, modules, transactionLimits: true });
    await seedLargeScannedPackageReleases(t, 20);

    const initial = await t.action(internal.packages.backfillPackageReleaseScansInternal, {
      batchSize: CRON_BATCH_SIZE,
    });
    expect(initial).toEqual({ scheduled: 0, nextCursor: 0, done: false });

    vi.useFakeTimers();
    try {
      await t.finishAllScheduledFunctions(vi.runAllTimers);
    } finally {
      vi.useRealTimers();
    }

    const scheduled = await t.run(async (ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    expect(scheduled.length).toBeGreaterThan(1);
    expect(scheduled.every((job) => job.state.kind === "success")).toBe(true);
  });
});
