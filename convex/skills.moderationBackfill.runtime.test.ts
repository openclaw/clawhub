/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const workerToken = "moderation-backfill-test-worker";

async function fixture() {
  vi.useFakeTimers();
  vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", workerToken);
  vi.stubEnv("SECURITY_SCAN_EVENT_DISPATCH_ENABLED", "0");
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const adminId = await ctx.db.insert("users", { handle: "backfill-admin", role: "admin" });
    const ownerId = await ctx.db.insert("users", { handle: "backfill-owner", role: "user" });
    await ctx.db.insert("globalStats", { key: "default", activeSkillsCount: 0, updatedAt: 1 });
    const rows = [];
    for (const kind of ["vt", "static", "unfinished", "clean", "held"] as const) {
      const skillId = await ctx.db.insert("skills", {
        slug: `backfill-${kind}`,
        displayName: `Backfill ${kind}`,
        ownerUserId: ownerId,
        tags: {},
        badges: {},
        moderationStatus: "hidden",
        moderationReason: kind === "static" ? "scanner.static.malicious" : "scanner.vt.malicious",
        moderationFlags: ["blocked.malware"],
        stats: { comments: 0, downloads: 0, stars: 0, versions: 1 },
        createdAt: 1,
        updatedAt: 1,
      });
      const versionId = await ctx.db.insert("skillVersions", {
        skillId,
        version: "1.0.0",
        changelog: "Legacy scanner fixture",
        files: [],
        parsed: { frontmatter: {} },
        createdBy: ownerId,
        createdAt: 1,
        vtAnalysis: { status: "malicious", checkedAt: 1 },
        ...(kind === "static"
          ? {
              staticScan: {
                status: "malicious",
                reasonCodes: ["malicious.fixture"],
                findings: [],
                summary: "Legacy static result",
                engineVersion: "v2.1.1",
                checkedAt: 1,
              },
            }
          : {}),
        ...(kind === "clean"
          ? { llmAnalysis: { status: "clean", verdict: "clean", checkedAt: 1 } }
          : {}),
        ...(kind === "unfinished" ? { llmAnalysis: { status: "pending", checkedAt: 1 } } : {}),
      });
      await ctx.db.patch(skillId, {
        latestVersionId: versionId,
        moderationSourceVersionId: versionId,
      });
      rows.push({ kind, skillId, versionId });
    }
    return { adminId, ownerId, rows };
  });
  return {
    t,
    ...ids,
    admin: t.withIdentity({ subject: ids.adminId }),
    user: t.withIdentity({ subject: ids.ownerId }),
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

it("authorizes admin backfill and keeps persisted legacy and unfinished scans out of public reads", async () => {
  const f = await fixture();
  await expect(f.t.action(api.maintenance.backfillLatestSkillModeration, {})).rejects.toThrow();
  await expect(f.user.action(api.maintenance.backfillLatestSkillModeration, {})).rejects.toThrow();
  expect(await f.t.run((ctx) => ctx.db.query("securityScanJobs").collect())).toEqual([]);
  expect(await f.admin.action(api.maintenance.backfillLatestSkillModeration, {})).toMatchObject({
    patched: 5,
  });
  await f.t.finishAllScheduledFunctions(vi.runAllTimers);
  const jobs = await f.t.run((ctx) => ctx.db.query("securityScanJobs").collect());
  expect(jobs).toHaveLength(4);
  for (const row of f.rows) {
    const stored = await f.t.run((ctx) => ctx.db.get(row.skillId));
    if (row.kind === "clean") {
      expect(stored).toMatchObject({
        moderationStatus: "active",
        moderationReason: "scanner.llm.clean",
      });
    } else {
      expect(stored).toMatchObject({
        moderationStatus: "hidden",
        moderationReason: "pending.scan",
      });
      expect(jobs).toContainEqual(
        expect.objectContaining({
          skillVersionId: row.versionId,
          status: "queued",
          source: "backfill",
        }),
      );
    }
  }
  const publicPage = await f.t.query(api.skills.listPublicPageV4, { sort: "newest", numItems: 20 });
  expect(publicPage.page.map((row) => row.skill.slug)).toEqual(["backfill-clean"]);
  expect(await f.t.query(api.skills.countPublicSkills, {})).toBe(1);
});

it("preserves an existing running job and keeps an intervening staff hold through worker completion", async () => {
  const f = await fixture();
  const held = f.rows.find((row) => row.kind === "held")!;
  const enqueued = await f.t.mutation(internal.securityScan.enqueueSkillVersionScanInternal, {
    versionId: held.versionId,
    source: "manual",
  });
  const [claimed] = await f.t.action(api.securityScan.claimCodexScanJobLeases, {
    token: workerToken,
    workerId: "backfill-test-worker",
    limit: 1,
  });
  expect(claimed._id).toBe(enqueued.jobId);
  const activeJob = await f.t.run((ctx) => ctx.db.get(claimed._id));
  await f.admin.action(api.maintenance.backfillLatestSkillModeration, {});
  await f.t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await f.t.run((ctx) => ctx.db.get(claimed._id))).toEqual(activeJob);
  await f.t.mutation(internal.skills.hideSkillForSecurityRedactionInternal, {
    actorUserId: f.adminId,
    slug: "backfill-held",
    reason: "Staff hold after enqueue",
  });
  const hold = await f.t.run((ctx) => ctx.db.get(held.skillId));
  const complete = {
    token: workerToken,
    jobId: claimed._id,
    leaseToken: claimed.leaseToken!,
    llmAnalysis: { status: "clean", verdict: "clean", checkedAt: Date.now() },
    aigAnalysis: { status: "clean", issueCount: 0, findings: [], checkedAt: Date.now() },
  };
  await expect(
    f.t.action(api.securityScan.completeCodexScanJob, { ...complete, leaseToken: "wrong-lease" }),
  ).rejects.toThrow("Lease mismatch");
  await f.t.action(api.securityScan.completeCodexScanJob, complete);
  expect(await f.t.run((ctx) => ctx.db.get(claimed._id))).toMatchObject({ status: "succeeded" });
  expect(await f.t.run((ctx) => ctx.db.get(held.versionId))).toMatchObject({
    llmAnalysis: { status: "clean" },
  });
  expect(await f.t.run((ctx) => ctx.db.get(held.skillId))).toMatchObject({
    moderationStatus: "hidden",
    moderationReason: "security.redaction",
    hiddenBy: f.adminId,
    hiddenAt: hold!.hiddenAt,
    softDeletedAt: hold!.softDeletedAt,
  });
  expect(
    (await f.t.query(api.skills.listPublicPageV4, { sort: "newest", numItems: 20 })).page.map(
      (row) => row.skill.slug,
    ),
  ).toEqual(["backfill-clean"]);
  expect(await f.t.query(api.skills.countPublicSkills, {})).toBe(1);
  const pending = f.rows.find((row) => row.kind === "vt")!;
  const queued = await f.t.run((ctx) =>
    ctx.db
      .query("securityScanJobs")
      .withIndex("by_skill_version", (q) => q.eq("skillVersionId", pending.versionId))
      .unique(),
  );
  const nextJobs = await f.t.action(api.securityScan.claimCodexScanJobLeases, {
    token: workerToken,
    workerId: "backfill-test-worker",
    limit: 10,
  });
  const next = nextJobs.find((job) => job._id === queued!._id)!;
  await f.t.action(api.securityScan.completeCodexScanJob, {
    ...complete,
    jobId: next._id,
    leaseToken: next.leaseToken!,
  });
  expect(
    (await f.t.query(api.skills.listPublicPageV4, { sort: "newest", numItems: 20 })).page
      .map((row) => row.skill.slug)
      .sort(),
  ).toEqual(["backfill-clean", "backfill-vt"]);
  expect(await f.t.query(api.skills.countPublicSkills, {})).toBe(2);
  await f.t.finishAllScheduledFunctions(vi.runAllTimers);
});
