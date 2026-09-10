/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const enqueue = internal.securityScan.enqueueBulkPackageRescanBatchForAdminInternal;
const status = internal.securityScan.getBulkPackageRescanBatchStatusForAdminInternal;

async function fixture(count = 2) {
  const t = convexTest({ schema, modules, transactionLimits: true });
  const actorUserId = await t.run((ctx) => ctx.db.insert("users", { role: "admin" }));
  const rows: { packageId: Id<"packages">; releaseId: Id<"packageReleases"> }[] = [];
  for (let i = 0; i < count; i++) {
    rows.push(
      await t.run(async (ctx) => {
        const verification = {
          tier: "structural",
          scope: "artifact-only",
          scanStatus: "clean",
        } as const;
        const packageId = await ctx.db.insert("packages", {
          name: `@fixture/plugin-${i}`,
          normalizedName: `@fixture/plugin-${i}`,
          displayName: `Plugin ${i}`,
          ownerUserId: actorUserId,
          family: i % 2 ? "bundle-plugin" : "code-plugin",
          channel: "community",
          isOfficial: false,
          tags: {},
          compatibility: {},
          verification,
          scanStatus: "clean",
          stats: { downloads: 0, installs: 0, stars: 0, versions: 1 },
          createdAt: i,
          updatedAt: i,
        });
        const releaseId = await ctx.db.insert("packageReleases", {
          packageId,
          version: "1.0.0",
          changelog: "",
          distTags: [],
          files: [],
          integritySha256: "a".repeat(64),
          compatibility: {},
          verification,
          createdBy: actorUserId,
          publishActor: { kind: "user", userId: actorUserId },
          llmAnalysis: { status: "clean", checkedAt: 1 },
          createdAt: i,
        });
        await ctx.db.patch(packageId, { latestReleaseId: releaseId });
        return { packageId, releaseId };
      }),
    );
  }
  return { t, actorUserId, rows };
}

describe("package bulk rescan runtime", () => {
  it("dry-runs without writes, scans latest code/bundle releases, and preserves active jobs", async () => {
    const { t, actorUserId, rows } = await fixture();
    const activeId = await t.mutation(internal.securityScan.enqueuePackageReleaseScanInternal, {
      releaseId: rows[0].releaseId,
      source: "publish",
      priority: 100,
      waitForVtMs: 60_000,
    });
    const before = await t.run((ctx) => ctx.db.get(activeId.jobId!));
    const dry = await t.mutation(enqueue, { actorUserId, dryRun: true });
    expect(dry).toMatchObject({ queued: 1, alreadyQueued: 1, skipped: 0, jobIds: [] });
    expect(await t.run((ctx) => ctx.db.query("auditLogs").collect())).toEqual([]);
    const result = await t.mutation(enqueue, { actorUserId });
    expect(result).toMatchObject({ queued: 1, alreadyQueued: 1, skipped: 0 });
    expect(await t.run((ctx) => ctx.db.get(activeId.jobId!))).toEqual(before);
    const jobs = await t.run((ctx) => ctx.db.query("securityScanJobs").collect());
    expect(jobs).toHaveLength(2);
    expect(jobs[1]).toMatchObject({
      packageReleaseId: rows[1].releaseId,
      source: "bulk-rescan",
      priority: 0,
      status: "queued",
    });
    expect(jobs[1].nextRunAt).toEqual(jobs[1].createdAt);
    expect(await t.run((ctx) => ctx.db.query("auditLogs").collect())).toMatchObject([
      { action: "package.clawscan.bulk_rescan_batch" },
    ]);
  });

  it("skips deleted, non-plugin, missing, mismatched, and revoked releases without scanning history", async () => {
    const { t, actorUserId, rows } = await fixture(8);
    await t.run(async (ctx) => {
      await ctx.db.patch(rows[0].packageId, { softDeletedAt: 1 });
      await ctx.db.patch(rows[1].packageId, { family: "skill" });
      await ctx.db.patch(rows[2].packageId, { latestReleaseId: undefined });
      await ctx.db.patch(rows[3].releaseId, { softDeletedAt: 1 });
      await ctx.db.patch(rows[4].packageId, { latestReleaseId: rows[5].releaseId });
      await ctx.db.patch(rows[5].releaseId, {
        manualModeration: {
          state: "revoked",
          reason: "fixture",
          reviewerUserId: actorUserId,
          updatedAt: 1,
        },
      });
      await ctx.db.delete(rows[6].releaseId);
      const release = (await ctx.db.get(rows[7].releaseId))!;
      const { _id, _creationTime, ...history } = release;
      await ctx.db.insert("packageReleases", { ...history, version: "0.9.0" });
    });
    const result = await t.mutation(enqueue, { actorUserId, batchSize: 100 });
    expect(result).toMatchObject({ queued: 1, skipped: 7 });
    const jobs = await t.run((ctx) => ctx.db.query("securityScanJobs").collect());
    expect(jobs).toHaveLength(1);
    expect(jobs[0].packageReleaseId).toEqual(rows[7].releaseId);
  });

  it("resumes stable pages while previous packages change and caps large release reads", async () => {
    const { t, actorUserId, rows } = await fixture(12);
    for (const row of rows) {
      await t.run((ctx) => ctx.db.patch(row.releaseId, { summary: "x".repeat(820_000) }));
    }
    const first = await t.mutation(enqueue, { actorUserId, batchSize: 100, dryRun: true });
    expect(first.queued).toBe(10);
    expect(first.done).toBe(false);
    await t.run((ctx) => ctx.db.patch(rows[0].packageId, { updatedAt: 1000 }));
    const last = await t.mutation(enqueue, { actorUserId, cursor: first.nextCursor, dryRun: true });
    expect(last).toMatchObject({ queued: 2, done: true, nextCursor: null });
    expect(last.sampleNames).not.toContain(first.sampleNames[0]);
  });

  it("rejects unauthorized actors and reports terminal failures/missing jobs", async () => {
    const { t, actorUserId } = await fixture();
    const moderator = await t.run((ctx) => ctx.db.insert("users", { role: "moderator" }));
    await expect(t.mutation(enqueue, { actorUserId: moderator })).rejects.toThrow();
    await expect(t.query(status, { actorUserId: moderator, jobIds: [] })).rejects.toThrow();
    const result = await t.mutation(enqueue, { actorUserId });
    await t.run(async (ctx) => {
      await ctx.db.patch(result.jobIds[0], { status: "failed" });
      await ctx.db.delete(result.jobIds[1]);
    });
    expect(await t.query(status, { actorUserId, jobIds: result.jobIds })).toMatchObject({
      done: true,
      failed: 1,
      missing: 1,
      terminal: 2,
    });
    await t.run((ctx) => ctx.db.patch(actorUserId, { deactivatedAt: 1 } as Partial<Doc<"users">>));
    await expect(t.mutation(enqueue, { actorUserId })).rejects.toThrow("Unauthorized");
  });
});
