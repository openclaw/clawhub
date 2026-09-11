/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => vi.unstubAllEnvs());

it("returns complete vendor JSON through scan completion and verify, replacing stale reports", async () => {
  vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", "worker-fixture");
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  const { versionId, jobId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { handle: "report-owner" });
    const publisherId = await ctx.db.insert("publishers", {
      kind: "user",
      handle: "report-owner",
      displayName: "Report owner",
      linkedUserId: userId,
      createdAt: 1,
      updatedAt: 1,
    });
    const skillId = await ctx.db.insert("skills", {
      slug: "report-fixture",
      displayName: "Report fixture",
      ownerUserId: userId,
      ownerPublisherId: publisherId,
      tags: {},
      badges: {},
      moderationStatus: "active",
      stats: { comments: 0, downloads: 0, stars: 0, versions: 1 },
      createdAt: 1,
      updatedAt: 1,
    });
    const createdVersionId = await ctx.db.insert("skillVersions", {
      skillId,
      version: "1.0.0",
      changelog: "Fixture",
      files: [],
      parsed: { frontmatter: {} },
      createdBy: userId,
      createdAt: 1,
    });
    await ctx.db.patch(skillId, { latestVersionId: createdVersionId });
    const createdJobId = await ctx.db.insert("securityScanJobs", {
      targetKind: "skillVersion",
      skillVersionId: createdVersionId,
      status: "running",
      source: "manual",
      priority: 1,
      hasMaliciousSignal: false,
      waitForVtUntil: 0,
      nextRunAt: 0,
      attempts: 1,
      leaseToken: "lease-fixture",
      workerId: "report-worker",
      leaseExpiresAt: Date.now() + 60_000,
      createdAt: 1,
      updatedAt: 1,
    });
    return { versionId: createdVersionId, jobId: createdJobId };
  });
  const claimed = await t.action(api.securityScan.hydrateCodexScanJob, {
    token: "worker-fixture",
    jobId,
    leaseToken: "lease-fixture",
    workerId: "report-worker",
  });
  expect(claimed?.scannerReportsUploadUrl).toBeTypeOf("string");
  async function verify() {
    const response = await t.fetch("/api/v1/skills/report-fixture/verify?ownerHandle=report-owner");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).not.toHaveProperty("scannerReports");
    expect(body.security).not.toHaveProperty("signals");
    return body;
  }
  expect((await verify()).security.scannerReports).toEqual({ aig: null, skillspector: null });
  const scannerReports = {
    aig: {
      $schema: "https://json.schemastore.org/sarif-2.1.0.json",
      version: "2.1.0",
      runs: [],
      futureField: true,
    },
    skillspector: {
      risk_assessment: { score: 0, recommendation: "CAUTION" },
      analysis_completeness: {
        coverage_percent: 99.1,
        exceptions: [{ reason: "reference_unresolved" }],
      },
      evidence: "unabridged evidence ".repeat(60_000),
    },
  };
  expect(JSON.stringify(scannerReports).length).toBeGreaterThan(1024 * 1024);
  async function complete(checkedAt: number) {
    return t.action(api.securityScan.completeCodexScanJob, {
      token: "worker-fixture",
      jobId,
      leaseToken: "lease-fixture",
      llmAnalysis: { status: "clean", verdict: "benign", checkedAt },
      aigAnalysis: { status: "clean", issueCount: 0, findings: [], checkedAt },
      skillSpectorAnalysis: {
        status: "clean",
        score: 0,
        recommendation: "CAUTION",
        issueCount: 0,
        issues: [],
        checkedAt,
      },
      scannerReportsStorageId: await t.run((ctx) =>
        ctx.storage.store(new Blob([JSON.stringify({ checkedAt, ...scannerReports })])),
      ),
    });
  }
  await complete(10);
  const firstId = await t.run(
    async (ctx) => (await ctx.db.get(versionId))!.scannerReportsStorageId!,
  );
  expect((await verify()).security.scannerReports).toEqual(scannerReports);
  // The normal verdict still governs verification; raw CAUTION does not replace it.
  expect((await verify()).security.status).toBe("clean");

  await t.mutation(internal.skills.updateVersionAigAnalysisInternal, {
    versionId,
    aigAnalysis: { status: "clean", issueCount: 0, findings: [], checkedAt: 20 },
  });
  expect((await verify()).security.scannerReports).toEqual({ aig: null, skillspector: null });
  await t.run(async (ctx) => {
    await ctx.db.patch(jobId, {
      status: "running",
      leaseToken: "lease-fixture",
      leaseExpiresAt: Date.now() + 60_000,
    });
  });
  await complete(20);
  const secondId = await t.run(
    async (ctx) => (await ctx.db.get(versionId))!.scannerReportsStorageId!,
  );
  expect(secondId).not.toBe(firstId);
  expect(await t.run((ctx) => ctx.storage.get(firstId))).toBeNull();
  expect((await verify()).security.scannerReports).toEqual(scannerReports);

  await t.mutation(internal.skills.updateVersionLlmAnalysisInternal, {
    versionId,
    llmAnalysis: { status: "error", checkedAt: 30 },
  });
  expect(await t.run((ctx) => ctx.storage.get(secondId))).toBeNull();
  expect((await verify()).security.scannerReports).toEqual({ aig: null, skillspector: null });

  // Pending publication discard owns the same blob lifecycle as version removal.
  const discardedReportId = await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob([JSON.stringify(scannerReports)]));
    await ctx.db.patch(versionId, {
      publicationStatus: "pending",
      scannerReportsStorageId: storageId,
    });
    return storageId;
  });
  const skillId = await t.run(async (ctx) => (await ctx.db.get(versionId))!.skillId);
  await t.mutation(internal.skills.discardPendingPublicationInternal, { skillId, versionId });
  expect(await t.run((ctx) => ctx.db.get(versionId))).toBeNull();
  expect(await t.run((ctx) => ctx.storage.get(discardedReportId))).toBeNull();
});
