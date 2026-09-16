/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import schema from "./schema";

vi.mock("./lib/verifiedClientIp", () => ({
  getVerifiedClientIp: async () => "203.0.113.1",
}));

const modules = import.meta.glob("./**/*.ts");
afterEach(() => vi.unstubAllEnvs());

async function createPackageScanFixture() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  const fixture = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { handle: "endor-owner" });
    const publisherId = await ctx.db.insert("publishers", {
      kind: "user",
      handle: "endor-owner",
      displayName: "Endor owner",
      linkedUserId: userId,
      createdAt: 1,
      updatedAt: 1,
    });
    const verification = {
      tier: "structural",
      scope: "artifact-only",
      scanStatus: "pending",
    } as const;
    const packageId = await ctx.db.insert("packages", {
      name: "endor-plugin",
      normalizedName: "endor-plugin",
      displayName: "Endor plugin",
      ownerUserId: userId,
      ownerPublisherId: publisherId,
      family: "code-plugin",
      channel: "community",
      isOfficial: false,
      tags: {},
      compatibility: {},
      verification,
      scanStatus: "pending",
      stats: { downloads: 0, installs: 0, stars: 0, versions: 1 },
      createdAt: 1,
      updatedAt: 1,
    });
    const releaseId = await ctx.db.insert("packageReleases", {
      packageId,
      version: "1.0.0",
      changelog: "Initial release",
      distTags: ["latest"],
      files: [],
      integritySha256: "a".repeat(64),
      compatibility: {},
      verification,
      createdBy: userId,
      publishActor: { kind: "user", userId },
      createdAt: 1,
    });
    const latestVersionSummary: NonNullable<Doc<"packages">["latestVersionSummary"]> = {
      version: "1.0.0",
      createdAt: 1,
      changelog: "Initial release",
      compatibility: {},
      verification,
    };
    await ctx.db.patch(packageId, {
      latestReleaseId: releaseId,
      tags: { latest: releaseId },
      latestVersionSummary,
    });
    const jobId = await ctx.db.insert("securityScanJobs", {
      targetKind: "packageRelease",
      packageReleaseId: releaseId,
      status: "running",
      source: "manual",
      priority: 1,
      hasMaliciousSignal: false,
      waitForVtUntil: 0,
      nextRunAt: 0,
      attempts: 1,
      leaseToken: "lease-one",
      workerId: "endor-worker",
      leaseExpiresAt: Date.now() + 60_000,
      createdAt: 1,
      updatedAt: 1,
    });
    return { packageId, releaseId, jobId };
  });
  return { t, ...fixture };
}

it("persists bounded Endor package results with raw reports and replaces stale report storage", async () => {
  vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", "worker-fixture");
  const { t, releaseId, jobId } = await createPackageScanFixture();

  const hydrated = await t.action(api.securityScan.hydrateCodexScanJob, {
    token: "worker-fixture",
    jobId,
    leaseToken: "lease-one",
    workerId: "endor-worker",
  });
  expect(hydrated?.scannerReportsUploadUrl).toBeTypeOf("string");

  const firstRawReport = {
    checkedAt: 10,
    endor: {
      status: "completed",
      all_findings: [{ severity: "high", description: "raw finding" }],
      blocking_findings: [],
      warning_findings: [{ severity: "high", description: "raw finding" }],
      preparation: {
        sourceRoot: "/tmp/private",
        normalizations: ["package-layout"],
      },
    },
    skillspector: null,
  };
  const firstStorageId = await t.run((ctx) =>
    ctx.storage.store(new Blob([JSON.stringify(firstRawReport)])),
  );
  const firstSummary = {
    status: "completed" as const,
    checkedAt: 9,
    reachableFunctionCount: 4,
    findings: [{ severity: "high", summary: "Reachable vulnerable function" }],
  };
  const completionPayload = {
    token: "worker-fixture",
    jobId,
    leaseToken: "lease-one",
    runId: "run-one",
    llmAnalysis: { status: "clean", verdict: "benign", checkedAt: 10 },
    endorAnalysis: firstSummary,
    scannerReportsStorageId: firstStorageId,
  };
  const concurrentCompletions = await Promise.allSettled([
    t.action(api.securityScan.completeCodexScanJob, completionPayload),
    t.action(api.securityScan.completeCodexScanJob, completionPayload),
  ]);
  expect(concurrentCompletions.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  const rejectedCompletion = concurrentCompletions.find((result) => result.status === "rejected");
  expect(rejectedCompletion).toBeDefined();
  if (!rejectedCompletion || rejectedCompletion.status !== "rejected") {
    throw new Error("Expected one concurrent completion to lose its lease");
  }
  expect(
    rejectedCompletion.reason instanceof Error
      ? rejectedCompletion.reason.message
      : String(rejectedCompletion.reason),
  ).toContain("Lease mismatch");

  expect(await t.run((ctx) => ctx.db.get(releaseId))).toMatchObject({
    endorAnalysis: firstSummary,
    scannerReportsStorageId: firstStorageId,
    llmAnalysis: { status: "clean", checkedAt: 10 },
  });
  const completedJob = await t.run((ctx) => ctx.db.get(jobId));
  expect(completedJob).toMatchObject({
    status: "succeeded",
    runId: "run-one",
  });
  expect(completedJob).not.toHaveProperty("leaseToken");
  const storedFirstReport = await t.run(async (ctx) => {
    const report = await ctx.storage.get(firstStorageId);
    return report ? await report.text() : null;
  });
  if (!storedFirstReport) throw new Error("Stored scanner report missing");
  expect(JSON.parse(storedFirstReport)).toEqual(firstRawReport);

  expect(await t.run(async (ctx) => Boolean(await ctx.storage.get(firstStorageId)))).toBe(true);
  expect(await t.run((ctx) => ctx.db.get(releaseId))).toMatchObject({
    scannerReportsStorageId: firstStorageId,
    endorAnalysis: firstSummary,
  });
  expect(
    await t.mutation(internal.securityScan.deleteScannerReportIfUnattachedInternal, {
      jobId,
      storageId: firstStorageId,
    }),
  ).toEqual({ deleted: false, reason: "attached" });
  expect(await t.run(async (ctx) => Boolean(await ctx.storage.get(firstStorageId)))).toBe(true);

  const unattachedStorageId = await t.run((ctx) => ctx.storage.store(new Blob(["orphaned"])));
  await expect(
    t.action(api.securityScan.completeCodexScanJob, {
      ...completionPayload,
      leaseToken: "lost-lease",
      scannerReportsStorageId: unattachedStorageId,
    }),
  ).rejects.toThrow("Lease mismatch");
  expect(await t.run((ctx) => ctx.storage.get(unattachedStorageId))).toBeNull();
  expect(await t.run(async (ctx) => Boolean(await ctx.storage.get(firstStorageId)))).toBe(true);

  const versionResponse = await t.fetch("/api/v1/packages/endor-plugin/versions/1.0.0");
  expect(versionResponse.status).toBe(200);
  const versionBody = await versionResponse.json();
  expect(versionBody.version.endorAnalysis).toEqual(firstSummary);
  expect(versionBody.version).not.toHaveProperty("scannerReportsStorageId");
  expect(JSON.stringify(versionBody)).not.toContain("/tmp/private");

  const securityResponse = await t.fetch("/api/v1/packages/endor-plugin/versions/1.0.0/security");
  expect(securityResponse.status).toBe(200);
  const securityBody = await securityResponse.json();
  expect(securityBody.release.endorAnalysis).toEqual(firstSummary);
  expect(securityBody.release).not.toHaveProperty("scannerReportsStorageId");
  expect(securityBody.trust.scanStatus).toBe("clean");

  const secondStorageId = await t.run((ctx) =>
    ctx.storage.store(new Blob([JSON.stringify({ checkedAt: 20, endor: { scanner: "endor" } })])),
  );
  await t.run(async (ctx) => {
    await ctx.db.patch(jobId, {
      status: "running",
      leaseToken: "lease-two",
      leaseExpiresAt: Date.now() + 60_000,
    });
  });
  await t.action(api.securityScan.completeCodexScanJob, {
    token: "worker-fixture",
    jobId,
    leaseToken: "lease-two",
    llmAnalysis: { status: "clean", checkedAt: 20 },
    endorAnalysis: { status: "skipped", checkedAt: 19, reason: "No supported call graph" },
    scannerReportsStorageId: secondStorageId,
  });
  expect(await t.run((ctx) => ctx.storage.get(firstStorageId))).toBeNull();
  expect(await t.run((ctx) => ctx.db.get(releaseId))).toMatchObject({
    scannerReportsStorageId: secondStorageId,
    endorAnalysis: { status: "skipped", checkedAt: 19 },
  });
});

it("rejects mismatched package targets and leases without attaching Endor results", async () => {
  const { t, releaseId, jobId } = await createPackageScanFixture();
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["raw report"])));
  const args = {
    releaseId,
    jobId,
    leaseToken: "wrong-lease",
    llmAnalysis: { status: "clean", checkedAt: 10 },
    endorAnalysis: {
      status: "completed" as const,
      checkedAt: 9,
      reachableFunctionCount: 1,
      findings: [],
    },
    scannerReportsStorageId: storageId,
  };

  await expect(
    t.mutation(internal.packages.completeReleaseSecurityScanInternal, args),
  ).rejects.toThrow("Lease mismatch");

  await t.run(async (ctx) => {
    await ctx.db.patch(jobId, { status: "succeeded" });
  });
  await expect(
    t.mutation(internal.packages.completeReleaseSecurityScanInternal, {
      ...args,
      leaseToken: "lease-one",
    }),
  ).rejects.toThrow("Lease mismatch");
  await t.run(async (ctx) => {
    await ctx.db.patch(jobId, { status: "running" });
  });

  await expect(
    t.mutation(internal.packages.completeReleaseSecurityScanInternal, {
      ...args,
      leaseToken: "lease-one",
      endorAnalysis: {
        status: "completed",
        checkedAt: 9,
        reachableFunctionCount: 51,
        findings: Array.from({ length: 51 }, (_, index) => ({
          severity: "high",
          summary: `Finding ${index}`,
        })),
      },
    }),
  ).rejects.toThrow();

  const otherReleaseId = await t.run(async (ctx) => {
    const release = await ctx.db.get(releaseId);
    if (!release) throw new Error("Fixture release missing");
    const { _id: _releaseId, _creationTime: _createdAt, ...fields } = release;
    return await ctx.db.insert("packageReleases", { ...fields, version: "2.0.0" });
  });
  await expect(
    t.mutation(internal.packages.completeReleaseSecurityScanInternal, {
      ...args,
      releaseId: otherReleaseId,
      leaseToken: "lease-one",
    }),
  ).rejects.toThrow("Lease mismatch");

  expect(await t.run((ctx) => ctx.db.get(releaseId))).not.toMatchObject({
    scannerReportsStorageId: storageId,
  });
  expect(await t.run((ctx) => ctx.db.get(otherReleaseId))).not.toHaveProperty("endorAnalysis");
});

it("keeps submitted scanner storage when its job target no longer exists", async () => {
  const { t, releaseId, jobId } = await createPackageScanFixture();
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["unresolved target"])));
  await t.run(async (ctx) => {
    await ctx.db.delete(releaseId);
  });

  const result = await t.mutation(internal.securityScan.deleteScannerReportIfUnattachedInternal, {
    jobId,
    storageId,
  });

  expect(result).toEqual({ deleted: false, reason: "target-missing" });
  expect(await t.run(async (ctx) => Boolean(await ctx.storage.get(storageId)))).toBe(true);
});

it.each([
  { attempts: 1, expectedRetry: true, expectedStatus: "queued" as const },
  { attempts: 3, expectedRetry: false, expectedStatus: "failed" as const },
])(
  "preserves and enforces a malicious primary verdict when Endor fails at attempt $attempts",
  async ({ attempts, expectedRetry, expectedStatus }) => {
    vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", "worker-fixture");
    const { t, packageId, releaseId, jobId } = await createPackageScanFixture();
    await t.run((ctx) => ctx.db.patch(jobId, { attempts }));
    const downloadPath = "/api/v1/packages/endor-plugin/download?version=1.0.0";
    const downloadBeforeFailure = await t.fetch(downloadPath);
    expect(downloadBeforeFailure.status).toBe(200);
    expect(downloadBeforeFailure.headers.get("content-type")).toBe("application/zip");
    expect((await downloadBeforeFailure.arrayBuffer()).byteLength).toBeGreaterThan(0);

    await expect(
      t.action(api.securityScan.failCodexScanJob, {
        token: "worker-fixture",
        jobId,
        leaseToken: "lease-one",
        error: "Endor dependency resolution failed",
        llmAnalysis: {
          status: "malicious",
          verdict: "malicious",
          confidence: "high",
          summary: "Primary ClawScan found malicious behavior.",
          checkedAt: 10,
        },
      }),
    ).resolves.toEqual({ ok: true, retry: expectedRetry });

    expect(await t.run((ctx) => ctx.db.get(releaseId))).toMatchObject({
      llmAnalysis: {
        status: "malicious",
        verdict: "malicious",
      },
      verification: { scanStatus: "malicious" },
      softDeletedAt: expect.any(Number),
    });
    expect(await t.run((ctx) => ctx.db.get(packageId))).toMatchObject({
      scanStatus: "malicious",
    });
    expect(await t.run((ctx) => ctx.db.get(jobId))).toMatchObject({
      status: expectedStatus,
      lastError: "Endor dependency resolution failed",
    });
    const downloadAfterFailure = await t.fetch(downloadPath);
    expect(downloadAfterFailure.status).toBe(404);
    expect(await downloadAfterFailure.text()).toBe("Package not found");
  },
);

it("rejects stale, mismatched, and deleted release guards without storing primary analysis", async () => {
  const maliciousAnalysis = {
    status: "malicious",
    verdict: "malicious",
    checkedAt: 10,
  };

  const stale = await createPackageScanFixture();
  await stale.t.mutation(internal.packages.updateReleaseLlmAnalysisInternal, {
    releaseId: stale.releaseId,
    securityScanJob: { jobId: stale.jobId, leaseToken: "stale-lease" },
    llmAnalysis: maliciousAnalysis,
  });
  expect(await stale.t.run((ctx) => ctx.db.get(stale.releaseId))).not.toHaveProperty("llmAnalysis");

  const mismatched = await createPackageScanFixture();
  const otherReleaseId = await mismatched.t.run(async (ctx) => {
    const release = await ctx.db.get(mismatched.releaseId);
    if (!release) throw new Error("Fixture release missing");
    const { _id: _releaseId, _creationTime: _createdAt, ...fields } = release;
    return await ctx.db.insert("packageReleases", { ...fields, version: "2.0.0" });
  });
  await mismatched.t.mutation(internal.packages.updateReleaseLlmAnalysisInternal, {
    releaseId: otherReleaseId,
    securityScanJob: { jobId: mismatched.jobId, leaseToken: "lease-one" },
    llmAnalysis: maliciousAnalysis,
  });
  expect(await mismatched.t.run((ctx) => ctx.db.get(otherReleaseId))).not.toHaveProperty(
    "llmAnalysis",
  );

  const deleted = await createPackageScanFixture();
  await deleted.t.run((ctx) => ctx.db.patch(deleted.releaseId, { softDeletedAt: 9 }));
  await deleted.t.mutation(internal.packages.updateReleaseLlmAnalysisInternal, {
    releaseId: deleted.releaseId,
    securityScanJob: { jobId: deleted.jobId, leaseToken: "lease-one" },
    llmAnalysis: maliciousAnalysis,
  });
  expect(await deleted.t.run((ctx) => ctx.db.get(deleted.releaseId))).not.toHaveProperty(
    "llmAnalysis",
  );
});
