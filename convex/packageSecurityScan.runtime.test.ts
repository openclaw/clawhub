/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";

// Route behavior assumes verified ingress; trust validation is covered by httpRateLimit.edge.test.ts.
vi.mock("./lib/verifiedClientIp", () => ({
  getVerifiedClientIp: async () => "203.0.113.1",
}));

const modules = import.meta.glob("./**/*.ts");
const aigAnalysis = { status: "clean", issueCount: 0, findings: [], checkedAt: 10 };

async function createPackageScanFixture() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiterV2");
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

async function readReleaseAndJob(
  t: Awaited<ReturnType<typeof createPackageScanFixture>>["t"],
  releaseId: Id<"packageReleases">,
  jobId: Id<"securityScanJobs">,
) {
  return await t.run(async (ctx) => ({
    release: await ctx.db.get(releaseId),
    job: await ctx.db.get(jobId),
  }));
}

it("claims an assigned plugin, stores its Endor summary, and serves the exact release", async () => {
  const { t, releaseId, jobId } = await createPackageScanFixture();
  await t.run((ctx) =>
    ctx.db.patch(jobId, {
      status: "queued",
      source: "bulk-rescan",
      attempts: 0,
      leaseToken: undefined,
      workerId: undefined,
      leaseExpiresAt: undefined,
    }),
  );
  vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", "fixture-worker-token");
  const leases = await t
    .action(api.securityScan.claimCodexScanJobLeases, {
      token: "fixture-worker-token",
      workerId: "endor-worker",
      lane: "shared",
      limit: 3,
      assignedJobIds: [jobId],
    })
    .finally(() => vi.unstubAllEnvs());
  expect(leases.map((job) => job._id)).toEqual([jobId]);
  const lease = leases[0];
  if (!lease) throw new Error("Plugin scan was not claimed");
  expect((await readReleaseAndJob(t, releaseId, jobId)).job).toMatchObject({
    status: "running",
    workerId: "endor-worker",
    leaseToken: lease.leaseToken,
  });
  const endorAnalysis = {
    status: "completed" as const,
    checkedAt: 9,
    reachableFunctionCount: 4,
    findings: [{ severity: "high", summary: "Reachable vulnerable function" }],
  };
  const skillSpectorAnalysis = {
    status: "suspicious",
    inspectionStatus: "partial" as const,
    issueCount: 0,
    issues: [],
    checkedAt: 10,
  };

  await expect(
    t.mutation(internal.packages.completeReleaseSecurityScanInternal, {
      releaseId,
      jobId,
      leaseToken: lease.leaseToken,
      runId: "run-one",
      aigAnalysis,
      llmAnalysis: { status: "clean", verdict: "benign", checkedAt: 10 },
      endorAnalysis,
      skillSpectorAnalysis,
    }),
  ).resolves.toEqual({ ok: true });

  const { release, job } = await readReleaseAndJob(t, releaseId, jobId);
  expect(release).toMatchObject({
    endorAnalysis,
    skillSpectorAnalysis,
    llmAnalysis: { status: "clean", verdict: "benign", checkedAt: 10 },
  });
  expect(job).toMatchObject({ status: "succeeded", runId: "run-one" });
  expect(job).not.toHaveProperty("leaseToken");

  const versionResponse = await t.fetch("/api/v1/packages/endor-plugin/versions/1.0.0");
  expect(versionResponse.status).toBe(200);
  const versionBody = await versionResponse.json();
  expect(versionBody.version.endorAnalysis).toEqual(endorAnalysis);
  expect(versionBody.version.skillSpectorAnalysis).toEqual(skillSpectorAnalysis);

  const securityResponse = await t.fetch("/api/v1/packages/endor-plugin/versions/1.0.0/security");
  expect(securityResponse.status).toBe(200);
  const securityBody = await securityResponse.json();
  expect(securityBody.release.endorAnalysis).toEqual(endorAnalysis);
});

it("preserves prior optional scanner results when an older worker omits them", async () => {
  const { t, releaseId, jobId } = await createPackageScanFixture();
  const endorAnalysis = {
    status: "completed" as const,
    checkedAt: 9,
    reachableFunctionCount: 0,
    findings: [],
  };
  const skillSpectorAnalysis = { status: "clean", issueCount: 0, issues: [], checkedAt: 8 };
  await t.run((ctx) => ctx.db.patch(releaseId, { endorAnalysis, skillSpectorAnalysis }));

  await expect(
    t.mutation(internal.packages.completeReleaseSecurityScanInternal, {
      releaseId,
      jobId,
      leaseToken: "lease-one",
      aigAnalysis,
      llmAnalysis: { status: "clean", verdict: "benign", checkedAt: 10 },
    }),
  ).resolves.toEqual({ ok: true });

  expect((await readReleaseAndJob(t, releaseId, jobId)).release).toMatchObject({
    endorAnalysis,
    skillSpectorAnalysis,
  });
});

it("rejects stale status, lease, and target completions without writing scan results", async () => {
  const { t, releaseId, jobId } = await createPackageScanFixture();
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
  };

  await expect(
    t.mutation(internal.packages.completeReleaseSecurityScanInternal, args),
  ).rejects.toThrow("Lease mismatch");

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

  await t.run((ctx) => ctx.db.patch(jobId, { status: "queued" }));
  await expect(
    t.mutation(internal.packages.completeReleaseSecurityScanInternal, {
      ...args,
      leaseToken: "lease-one",
    }),
  ).rejects.toThrow("Lease mismatch");

  const { release, job } = await readReleaseAndJob(t, releaseId, jobId);
  expect(release).not.toHaveProperty("endorAnalysis");
  expect(release).not.toHaveProperty("llmAnalysis");
  expect(release).not.toHaveProperty("skillSpectorAnalysis");
  expect(await t.run((ctx) => ctx.db.get(otherReleaseId))).not.toHaveProperty("endorAnalysis");
  expect(job).toMatchObject({ status: "queued", leaseToken: "lease-one" });
});

it("stores a failed Endor summary while enforcing a malicious primary verdict", async () => {
  const { t, packageId, releaseId, jobId } = await createPackageScanFixture();
  const endorAnalysis = {
    status: "failed" as const,
    checkedAt: 11,
    reason: "Endor dependency resolution failed",
  };

  await expect(
    t.mutation(internal.packages.completeReleaseSecurityScanInternal, {
      releaseId,
      jobId,
      leaseToken: "lease-one",
      runId: "run-malicious",
      aigAnalysis,
      llmAnalysis: {
        status: "malicious",
        verdict: "malicious",
        confidence: "high",
        summary: "Primary ClawScan found malicious behavior.",
        checkedAt: 12,
      },
      endorAnalysis,
    }),
  ).resolves.toEqual({ ok: true });

  const { release, job } = await readReleaseAndJob(t, releaseId, jobId);
  expect(release).toMatchObject({
    endorAnalysis,
    llmAnalysis: { status: "malicious", verdict: "malicious" },
    verification: { scanStatus: "malicious" },
    softDeletedAt: expect.any(Number),
  });
  expect(job).toMatchObject({ status: "succeeded", runId: "run-malicious" });
  expect(await t.run((ctx) => ctx.db.get(packageId))).toMatchObject({
    scanStatus: "malicious",
  });

  const versionResponse = await t.fetch("/api/v1/packages/endor-plugin/versions/1.0.0");
  expect(versionResponse.status).toBe(404);
});

it("automatic plugin jobs store only Endor and cannot replace admitted scanner evidence", async () => {
  const { t, packageId, releaseId, jobId } = await createPackageScanFixture();
  const llmAnalysis = {
    status: "clean",
    verdict: "benign",
    checkedAt: 5,
    summary: "Exact publication adjudication",
    guidance: "Retain original guidance",
    dimensions: [{ name: "intent", label: "Intent", rating: "pass", detail: "Exact detail" }],
  };
  await t.run(async (ctx) => {
    await ctx.db.patch(releaseId, { llmAnalysis, aigAnalysis });
    await ctx.db.patch(jobId, { source: "publish", scanMode: "endor-report-only" });
  });
  const before = await t.run(async (ctx) => ({
    release: await ctx.db.get(releaseId),
    pkg: await ctx.db.get(packageId),
  }));
  const endorAnalysis = {
    status: "completed" as const,
    checkedAt: 12,
    reachableFunctionCount: 2,
    findings: [{ severity: "critical", summary: "Report-only dependency finding" }],
  };
  await expect(
    t.mutation(internal.packages.completeReleaseSecurityScanInternal, {
      releaseId,
      jobId,
      leaseToken: "lease-one",
      endorAnalysis,
      llmAnalysis: { status: "malicious", verdict: "malicious", checkedAt: 12 },
    }),
  ).rejects.toThrow("cannot replace ClawScan evidence");
  expect((await readReleaseAndJob(t, releaseId, jobId)).release).toEqual(before.release);
  vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", "report-worker-token");
  try {
    await t.action(api.securityScan.completeCodexScanJob, {
      token: "report-worker-token",
      jobId,
      leaseToken: "lease-one",
      endorAnalysis,
    });
  } finally {
    vi.unstubAllEnvs();
  }
  const after = await readReleaseAndJob(t, releaseId, jobId);
  expect(after.release).toEqual({ ...before.release, endorAnalysis });
  expect(await t.run((ctx) => ctx.db.get(packageId))).toEqual(before.pkg);
  expect(after.job?.status).toBe("succeeded");
  const response = await t.fetch("/api/v1/packages/endor-plugin/versions/1.0.0/security");
  const body = await response.json();
  expect(body.release.endorAnalysis).toEqual(endorAnalysis);
  const version = await (await t.fetch("/api/v1/packages/endor-plugin/versions/1.0.0")).json();
  expect(version.version.llmAnalysis).toEqual(llmAnalysis);
  expect(version.version.aigAnalysis).toEqual(aigAnalysis);
  expect(
    await t.mutation(internal.securityScan.enqueuePackageReleaseScanInternal, {
      releaseId,
      source: "backfill",
    }),
  ).toMatchObject({ skipped: "reported" });
  expect(await t.run((ctx) => ctx.db.query("securityScanJobs").collect())).toHaveLength(1);
});

it("keeps automatic reports distinct from explicit plugin rescans and retires legacy automatic jobs", async () => {
  const { t, releaseId, jobId } = await createPackageScanFixture();
  await t.run((ctx) =>
    ctx.db.patch(jobId, {
      status: "queued",
      source: "publish",
      leaseToken: undefined,
      workerId: undefined,
      leaseExpiresAt: undefined,
      attempts: 0,
    }),
  );
  const legacy = (await readReleaseAndJob(t, releaseId, jobId)).job;
  const report = await t.mutation(internal.securityScan.enqueuePackageReleaseScanInternal, {
    releaseId,
    source: "backfill",
  });
  expect(report.jobId).not.toBe(jobId);
  expect((await t.run((ctx) => ctx.db.get(report.jobId!)))?.scanMode).toBe("endor-report-only");
  const explicit = await t.mutation(internal.securityScan.enqueuePackageReleaseScanInternal, {
    releaseId,
    source: "manual",
  });
  expect(explicit.jobId).not.toBe(report.jobId);
  const claimed = await t.mutation(internal.securityScan.claimQueuedJobsInternal, {
    workerId: "single-scan-worker",
    limit: 10,
  });
  expect(new Set(claimed.map((job) => job._id))).toEqual(new Set([report.jobId, explicit.jobId]));
  expect((await readReleaseAndJob(t, releaseId, jobId)).job).toEqual(legacy);
  await t.run((ctx) =>
    ctx.db.patch(jobId, {
      status: "running",
      leaseToken: "legacy-lease",
      workerId: "legacy-worker",
      leaseExpiresAt: 0,
    }),
  );
  expect(await t.query(internal.securityScan.getJobTargetInternal, { jobId })).toMatchObject({
    missing: true,
  });
  await expect(
    t.mutation(internal.packages.completeReleaseSecurityScanInternal, {
      releaseId,
      jobId,
      leaseToken: "legacy-lease",
      aigAnalysis,
      llmAnalysis: { status: "clean", verdict: "benign", checkedAt: 10 },
    }),
  ).rejects.toThrow("Automatic plugin ClawScan jobs are retired");
  expect(await t.mutation(internal.securityScan.requeueExpiredCodexScanJobsInternal, {})).toEqual({
    requeued: 0,
  });
  await t.run((ctx) => ctx.db.patch(jobId, { status: "failed", updatedAt: 5 }));
  const recovered = await t.mutation(internal.securityScan.requeueFailedSecurityScanJobsInternal, {
    failedAfter: 0,
    failedBefore: 10,
    dryRun: false,
  });
  expect(recovered.requeued).toBe(0);
  expect((await readReleaseAndJob(t, releaseId, jobId)).job?.status).toBe("failed");
});

it("explicit plugin rescans reject missing or failed AIG evidence before any release write", async () => {
  const { t, releaseId, jobId } = await createPackageScanFixture();
  const before = await readReleaseAndJob(t, releaseId, jobId);
  for (const invalidAigAnalysis of [
    undefined,
    { status: "failed", issueCount: 0, findings: [], checkedAt: 10 },
  ]) {
    await expect(
      t.mutation(internal.packages.completeReleaseSecurityScanInternal, {
        releaseId,
        jobId,
        leaseToken: "lease-one",
        aigAnalysis: invalidAigAnalysis,
        llmAnalysis: { status: "clean", verdict: "benign", checkedAt: 10 },
      }),
    ).rejects.toThrow("completed ClawScan and A.I.G evidence");
    expect(await readReleaseAndJob(t, releaseId, jobId)).toEqual(before);
  }
});
