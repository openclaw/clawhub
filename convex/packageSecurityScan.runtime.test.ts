/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";

// Route behavior assumes verified ingress; trust validation is covered by httpRateLimit.edge.test.ts.
vi.mock("./lib/verifiedClientIp", () => ({
  getVerifiedClientIp: async () => "203.0.113.1",
}));

const modules = import.meta.glob("./**/*.ts");

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

it("atomically stores a completed Endor summary and succeeds the package scan job", async () => {
  const { t, releaseId, jobId } = await createPackageScanFixture();
  const endorAnalysis = {
    status: "completed" as const,
    checkedAt: 9,
    reachableFunctionCount: 4,
    findings: [{ severity: "high", summary: "Reachable vulnerable function" }],
  };

  await expect(
    t.mutation(internal.packages.completeReleaseSecurityScanInternal, {
      releaseId,
      jobId,
      leaseToken: "lease-one",
      runId: "run-one",
      llmAnalysis: { status: "clean", verdict: "benign", checkedAt: 10 },
      endorAnalysis,
    }),
  ).resolves.toEqual({ ok: true });

  const { release, job } = await readReleaseAndJob(t, releaseId, jobId);
  expect(release).toMatchObject({
    endorAnalysis,
    llmAnalysis: { status: "clean", verdict: "benign", checkedAt: 10 },
  });
  expect(release).not.toHaveProperty("scannerReportsStorageId");
  expect(job).toMatchObject({ status: "succeeded", runId: "run-one" });
  expect(job).not.toHaveProperty("leaseToken");

  const versionResponse = await t.fetch("/api/v1/packages/endor-plugin/versions/1.0.0");
  expect(versionResponse.status).toBe(200);
  const versionBody = await versionResponse.json();
  expect(versionBody.version.endorAnalysis).toEqual(endorAnalysis);

  const securityResponse = await t.fetch("/api/v1/packages/endor-plugin/versions/1.0.0/security");
  expect(securityResponse.status).toBe(200);
  const securityBody = await securityResponse.json();
  expect(securityBody.release.endorAnalysis).toEqual(endorAnalysis);
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

it("parses bounded Endor summaries before any package release write", async () => {
  const { t, releaseId, jobId } = await createPackageScanFixture();

  await expect(
    t.mutation(internal.packages.completeReleaseSecurityScanInternal, {
      releaseId,
      jobId,
      leaseToken: "lease-one",
      llmAnalysis: { status: "clean", checkedAt: 10 },
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

  const { release, job } = await readReleaseAndJob(t, releaseId, jobId);
  expect(release).not.toHaveProperty("endorAnalysis");
  expect(release).not.toHaveProperty("llmAnalysis");
  expect(job).toMatchObject({ status: "running", leaseToken: "lease-one" });
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
