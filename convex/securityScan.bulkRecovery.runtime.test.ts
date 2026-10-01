/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const enqueue = internal.securityScan.enqueueBulkSkillRescanBatchForAdminInternal;

async function fixture() {
  const t = convexTest({ schema, modules, transactionLimits: true });
  const ids = await t.run(async (ctx) => {
    const actorUserId = await ctx.db.insert("users", { role: "admin" });
    const skillId = await ctx.db.insert("skills", {
      slug: "receipt-fixture",
      displayName: "Receipt fixture",
      ownerUserId: actorUserId,
      tags: {},
      badges: {},
      moderationStatus: "active",
      stats: { comments: 0, downloads: 0, stars: 0, versions: 1 },
      createdAt: 1,
      updatedAt: 1,
    });
    const versionId = await ctx.db.insert("skillVersions", {
      skillId,
      version: "1.0.0",
      changelog: "",
      files: [],
      parsed: { frontmatter: {} },
      createdBy: actorUserId,
      createdAt: 1,
    });
    await ctx.db.patch(skillId, { latestVersionId: versionId });
    return { actorUserId, skillId, versionId };
  });
  return { t, ...ids };
}

describe("bulk skill response-loss recovery", () => {
  it("replays the exact receipt after a lost response even when jobs are terminal and the page changes", async () => {
    const { t, actorUserId, skillId, versionId } = await fixture();
    const request = {
      actorUserId,
      requestId: "campaign-305",
      expectedVersionIds: [versionId],
      batchSize: 1,
    };
    const committed = await t.mutation(enqueue, request);
    await t.run(async (ctx) => {
      await ctx.db.patch(committed.jobIds[0], {
        status: "failed",
        lastError: "permanent fixture failure",
      });
      await ctx.db.patch(skillId, { softDeletedAt: 2 });
    });
    expect(await t.mutation(enqueue, request)).toEqual(committed);
    expect(await t.run((ctx) => ctx.db.query("securityScanJobs").collect())).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.query("auditLogs").collect())).toHaveLength(1);
  });

  it("rejects a reused request ID with different parameters without admitting work", async () => {
    const { t, actorUserId } = await fixture();
    await t.mutation(enqueue, { actorUserId, requestId: "same", batchSize: 1 });
    await expect(
      t.mutation(enqueue, { actorUserId, requestId: "same", batchSize: 2 }),
    ).rejects.toThrow(/different parameters/);
    expect(await t.run((ctx) => ctx.db.query("securityScanJobs").collect())).toHaveLength(1);
  });

  it("rejects a changed exact-version baseline atomically", async () => {
    const { t, actorUserId } = await fixture();
    await expect(
      t.mutation(enqueue, { actorUserId, requestId: "drift", expectedVersionIds: [] }),
    ).rejects.toThrow(/baseline changed/);
    expect(await t.run((ctx) => ctx.db.query("securityScanJobs").collect())).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("auditLogs").collect())).toEqual([]);
  });

  it("does not consume a request ID on dry run and rechecks admin authorization on replay", async () => {
    const { t, actorUserId } = await fixture();
    const request = { actorUserId, requestId: "dry" };
    expect((await t.mutation(enqueue, { ...request, dryRun: true })).jobIds).toEqual([]);
    expect((await t.mutation(enqueue, request)).jobIds).toHaveLength(1);
    await t.run((ctx) => ctx.db.patch(actorUserId, { role: "user" }));
    await expect(t.mutation(enqueue, request)).rejects.toThrow();
  });
  it("paginates retained legacy job identities without creating jobs or exposing worker secrets", async () => {
    const { t, actorUserId, versionId } = await fixture();
    const receipt = await t.mutation(enqueue, { actorUserId });
    await t.run(async (ctx) => {
      const job = (await ctx.db.get(receipt.jobIds[0]))!;
      const { _id, _creationTime, ...fields } = job;
      for (let i = 0; i < 102; i++) {
        await ctx.db.insert("securityScanJobs", {
          ...fields,
          status: "succeeded",
          leaseToken: "do-not-return",
          createdAt: i,
        });
      }
    });
    const history = internal.securityScan.getSkillScanJobHistoryForAdminInternal;
    const first = await t.query(history, { actorUserId, versionId });
    expect(first.done).toBe(false);
    expect(first.jobs).toHaveLength(100);
    const last = await t.query(history, { actorUserId, versionId, cursor: first.nextCursor });
    expect(last.done).toBe(true);
    expect(last.nextCursor).toBeNull();
    expect(new Set([...first.jobs, ...last.jobs].map((job) => job.jobId)).size).toBe(103);
    expect(JSON.stringify(first)).not.toContain("do-not-return");
    expect(await t.run((ctx) => ctx.db.query("auditLogs").collect())).toHaveLength(1);
    await t.run((ctx) => ctx.db.patch(actorUserId, { deactivatedAt: 1 }));
    await expect(t.query(history, { actorUserId, versionId })).rejects.toThrow("Unauthorized");
  });

  it("preserves an existing publish job and its priority in the saved receipt", async () => {
    const { t, actorUserId, versionId } = await fixture();
    const active = await t.mutation(internal.securityScan.enqueueSkillVersionScanInternal, {
      versionId,
      source: "publish",
      priority: 100,
      waitForVtMs: 60_000,
    });
    const before = await t.run((ctx) => ctx.db.get(active.jobId!));
    const request = { actorUserId, requestId: "preserve-publish" };
    const result = await t.mutation(enqueue, request);
    expect(result).toMatchObject({ queued: 0, alreadyQueued: 1, jobIds: [active.jobId] });
    expect(await t.mutation(enqueue, request)).toEqual(result);
    expect(await t.run((ctx) => ctx.db.get(active.jobId!))).toEqual(before);
  });
});
