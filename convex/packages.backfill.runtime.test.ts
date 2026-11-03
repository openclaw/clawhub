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

async function seedBackfillPublicationStates(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {});
    const packageId = await ctx.db.insert("packages", {
      name: "@runtime/backfill-publication-states",
      normalizedName: "@runtime/backfill-publication-states",
      displayName: "Backfill publication states",
      ownerUserId: userId,
      family: "code-plugin",
      channel: "community",
      isOfficial: false,
      tags: {},
      compatibility: {},
      scanStatus: "pending",
      stats: { downloads: 0, installs: 0, stars: 0, versions: 6 },
      createdAt: 1,
      updatedAt: 1,
    });
    const releaseIds = [];
    for (const [index, state] of [
      { ownerDeletedAt: 1 },
      { softDeletedAt: 1 },
      { publicationStatus: "pending" as const },
      { publicationStatus: "blocked" as const },
      { publicationStatus: "published" as const },
      {},
    ].entries()) {
      const releaseId = await ctx.db.insert("packageReleases", {
        packageId,
        version: `1.0.${index}`,
        changelog: "Backfill eligibility regression",
        distTags: [],
        files: [],
        integritySha256: "a".repeat(64),
        compatibility: {},
        vtAnalysis: { status: "clean", checkedAt: 1 },
        staticScan: {
          status: "clean",
          reasonCodes: [],
          findings: [],
          summary: "clean",
          engineVersion: "runtime-test",
          checkedAt: 1,
        },
        createdBy: userId,
        publishActor: { kind: "user", userId },
        createdAt: index,
        ...state,
      });
      releaseIds.push(releaseId);
    }
    const pendingId = releaseIds[2]!;
    const failedAttemptId = await ctx.db.insert("publishAttempts", {
      kind: "package",
      status: "failed",
      userId,
      ownerUserId: userId,
      packageId,
      packageReleaseId: pendingId,
      slug: "@runtime/backfill-publication-states",
      displayName: "Backfill publication states",
      version: "1.0.2",
      idempotencyKey: "backfill-failed-attempt",
      artifactFingerprint: "a".repeat(64),
      files: [],
      checks: {
        trufflehog: { status: "clean", checkedAt: 1 },
        clawscan: { status: "failed", checkedAt: 1, summary: "SkillSpector failed" },
      },
      checkFailureCount: 3,
      failedAt: 1,
      createdAt: 1,
      updatedAt: 1,
      expiresAt: Date.now() + 60_000,
    });
    await ctx.db.patch(pendingId, { publishAttemptId: failedAttemptId });
    const exhaustedJobId = await ctx.db.insert("securityScanJobs", {
      targetKind: "packageRelease",
      packageReleaseId: pendingId,
      source: "backfill",
      status: "failed",
      priority: 0,
      hasMaliciousSignal: false,
      waitForVtUntil: 0,
      nextRunAt: 0,
      attempts: 3,
      lastError: "skillspector timed out",
      createdAt: 1,
      updatedAt: 1,
    });
    return { releaseIds, pendingId, failedAttemptId, exhaustedJobId };
  });
}

describe("postpublication scan backfill eligibility", () => {
  it.each([true, false])(
    "keeps retained and deleted releases out while preserving published and legacy work (recent=%s)",
    async (prioritizeRecent) => {
      const t = convexTest({ schema, modules, transactionLimits: true });
      const { releaseIds } = await seedBackfillPublicationStates(t);
      const selected = [];
      let cursor = 0;
      for (;;) {
        const page = await t.query(internal.packages.getPackageReleaseScanBackfillBatchInternal, {
          cursor,
          batchSize: 10,
          prioritizeRecent,
        });
        selected.push(...page.releases.map((release) => release.releaseId));
        if (prioritizeRecent || page.done) break;
        expect(page.nextCursor).toBeGreaterThan(cursor);
        cursor = page.nextCursor;
      }
      expect(selected.sort((a, b) => String(a).localeCompare(String(b)))).toEqual(
        releaseIds.slice(-2).sort((a, b) => String(a).localeCompare(String(b))),
      );
    },
  );

  it("advances through a retained-only historical page to later published work", async () => {
    const t = convexTest({ schema, modules, transactionLimits: true });
    const { releaseIds, pendingId } = await seedBackfillPublicationStates(t);
    const publishedId = await t.run(async (ctx) => {
      for (const id of releaseIds.slice(-2)) {
        await ctx.db.patch(id, { publicationStatus: "pending" });
      }
      const pending = await ctx.db.get(pendingId);
      if (!pending) throw new Error("Pending fixture missing");
      const { _id, _creationTime, publishAttemptId: _publishAttemptId, ...release } = pending;
      return await ctx.db.insert("packageReleases", {
        ...release,
        version: "2.0.0",
        publicationStatus: "published",
      });
    });
    const first = await t.query(internal.packages.getPackageReleaseScanBackfillBatchInternal, {
      cursor: 0,
      batchSize: 2,
      prioritizeRecent: false,
    });
    expect(first.releases).toEqual([]);
    expect(first.done).toBe(false);
    expect(first.nextCursor).toBeGreaterThan(0);
    const next = await t.query(internal.packages.getPackageReleaseScanBackfillBatchInternal, {
      cursor: first.nextCursor,
      batchSize: 2,
      prioritizeRecent: false,
    });
    expect(next.releases.map((release) => release.releaseId)).toEqual([publishedId]);
    expect(next.done).toBe(true);
    expect(next.nextCursor).toBeGreaterThan(first.nextCursor);
  });

  it("does not recreate exhausted jobs for an unpublished release on repeated cron passes", async () => {
    const t = convexTest({ schema, modules, transactionLimits: true });
    const { releaseIds, pendingId, failedAttemptId, exhaustedJobId } =
      await seedBackfillPublicationStates(t);
    const before = await t.run(async (ctx) => ({
      release: await ctx.db.get(pendingId),
      attempt: await ctx.db.get(failedAttemptId),
    }));
    for (let pass = 0; pass < 2; pass += 1) {
      await t.action(internal.packages.backfillPackageReleaseScansInternal, { batchSize: 10 });
    }
    const jobs = await t.run(async (ctx) => ctx.db.query("securityScanJobs").collect());
    expect(jobs.filter((job) => job.packageReleaseId === pendingId).map((job) => job._id)).toEqual([
      exhaustedJobId,
    ]);
    expect(
      jobs
        .filter((job) => job.status === "queued")
        .map((job) => job.packageReleaseId)
        .sort((a, b) => String(a).localeCompare(String(b))),
    ).toEqual(releaseIds.slice(-2).sort((a, b) => String(a).localeCompare(String(b))));
    const after = await t.run(async (ctx) => ({
      release: await ctx.db.get(pendingId),
      attempt: await ctx.db.get(failedAttemptId),
    }));
    expect(after).toEqual(before);
  });
});
