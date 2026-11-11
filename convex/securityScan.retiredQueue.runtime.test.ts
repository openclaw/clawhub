/// <reference types="vite/client" />
/* @vitest-environment edge-runtime */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { dispatchGitHubRepositoryEvent } from "./lib/githubRepositoryDispatch";
import schema from "./schema";

// Exercise the real scheduler/action/mutation chain without contacting GitHub.
vi.mock("./lib/githubAuth", () => ({
  isGitHubAppConfigured: () => true,
  createGitHubAppInstallationToken: async () => ({
    token: "fixture-token",
    permissions: { contents: "write" },
  }),
}));
vi.mock("./lib/githubRepositoryDispatch", () => ({
  getGitHubRepositoryDispatchPermission: () => ({ canDispatch: true }),
  dispatchGitHubRepositoryEvent: vi.fn(async () => ({ ok: true })),
}));

const modules = import.meta.glob("./**/*.ts");
const NOW = 1_000_000;

async function fixture(
  status: Doc<"securityScanJobs">["status"],
  retiredCount: number,
  includeEligible = true,
) {
  const t = convexTest({ schema, modules, transactionLimits: true });
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { role: "admin" });
    const verification = {
      tier: "structural",
      scope: "artifact-only",
      scanStatus: "clean",
    } as const;
    const releases: Id<"packageReleases">[] = [];
    for (const family of ["code-plugin", "bundle-plugin", "claw"] as const) {
      const packageId = await ctx.db.insert("packages", {
        name: "fixture-" + family,
        normalizedName: "fixture-" + family,
        displayName: family,
        ownerUserId: userId,
        family,
        channel: "community",
        isOfficial: false,
        tags: {},
        compatibility: {},
        verification,
        scanStatus: "clean",
        stats: { downloads: 0, installs: 0, stars: 0, versions: 1 },
        createdAt: 1,
        updatedAt: 1,
      });
      releases.push(
        await ctx.db.insert("packageReleases", {
          packageId,
          version: "1.0.0",
          changelog: "Retained publication evidence",
          distTags: [],
          files: [],
          integritySha256: "a".repeat(64),
          compatibility: {},
          verification,
          createdBy: userId,
          publishActor: { kind: "user", userId },
          llmAnalysis: { status: "clean", verdict: "benign", checkedAt: 1 },
          createdAt: 1,
        }),
      );
    }
    const skillId = await ctx.db.insert("skills", {
      slug: "retired-queue-fixture",
      displayName: "Queue fixture",
      ownerUserId: userId,
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
      createdBy: userId,
      createdAt: 1,
    });
    const retiredIds: Id<"securityScanJobs">[] = [];
    const base = {
      status,
      priority: 0,
      hasMaliciousSignal: false,
      attempts: 2,
      lastError: "Retain the original diagnostic",
      runId: "historical-run",
      ...(status === "running"
        ? {
            leaseToken: "historical-lease",
            leaseExpiresAt: 0,
            workerId: "historical-worker",
          }
        : {}),
      createdAt: 1,
    };
    for (let i = 0; i < retiredCount; i++) {
      retiredIds.push(
        await ctx.db.insert("securityScanJobs", {
          ...base,
          targetKind: "packageRelease",
          packageReleaseId: releases[i % 2],
          source: i % 2 ? "backfill" : "publish",
          nextRunAt: i,
          updatedAt: i + 1,
        }),
      );
    }
    const eligibleIds: Id<"securityScanJobs">[] = [];
    if (includeEligible) {
      const targets = [
        { targetKind: "skillVersion", skillVersionId: versionId, source: "publish" },
        { targetKind: "packageRelease", packageReleaseId: releases[0], source: "manual" },
        { targetKind: "packageRelease", packageReleaseId: releases[1], source: "bulk-rescan" },
        {
          targetKind: "packageRelease",
          packageReleaseId: releases[0],
          source: "backfill",
          scanMode: "endor-report-only",
        },
        { targetKind: "packageRelease", packageReleaseId: releases[2], source: "publish" },
      ] as const;
      for (const [i, target] of targets.entries()) {
        eligibleIds.push(
          await ctx.db.insert("securityScanJobs", {
            ...base,
            ...target,
            nextRunAt: retiredCount + i,
            updatedAt: retiredCount + i + 1,
          }),
        );
      }
    }
    return { releases, retiredIds, eligibleIds };
  });
  return { t, ...ids };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

async function readJobs(f: Fixture, ids: Id<"securityScanJobs">[]) {
  return f.t.run(async (ctx) => Promise.all(ids.map((id) => ctx.db.get(id))));
}

async function readReleases(f: Fixture) {
  return f.t.run(async (ctx) => Promise.all(f.releases.map((id) => ctx.db.get(id))));
}

async function assertScheduledFunctionsSucceeded(f: Fixture) {
  const scheduled = await f.t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
  expect(scheduled.every((row) => row.state.kind === "success")).toBe(true);
}

function enableDispatch() {
  vi.stubEnv("SECURITY_SCAN_EVENT_DISPATCH_ENABLED", "1");
  vi.stubEnv("CLAWHUB_PREVIEW", "0");
  vi.stubEnv("GITHUB_APP_ID", "fixture");
  vi.stubEnv("GITHUB_APP_INSTALLATION_ID", "fixture");
  vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "fixture");
}

describe("retired automatic plugin queue heads", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.stubEnv("SECURITY_SCAN_EVENT_DISPATCH_ENABLED", "0");
    vi.mocked(dispatchGitHubRepositoryEvent).mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("advances bounded expired-lease batches beyond retired heads without changing publication evidence", async () => {
    const f = await fixture("running", 7);
    const releases = await readReleases(f);
    expect(
      await f.t.mutation(internal.securityScan.requeueExpiredCodexScanJobsInternal, { limit: 3 }),
    ).toEqual({ requeued: 0 });
    // The first transaction is bounded; the remaining work is a scheduled mutation.
    expect(
      (await readJobs(f, f.retiredIds)).filter((job) => job?.status === "failed"),
    ).toHaveLength(3);
    expect((await readJobs(f, f.eligibleIds)).every((job) => job?.status === "running")).toBe(true);
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await readJobs(f, f.eligibleIds)).every((job) => job?.status === "queued")).toBe(true);
    for (const job of await readJobs(f, f.retiredIds)) {
      expect(job).toMatchObject({
        status: "failed",
        attempts: 2,
        runId: "historical-run",
        lastError: "Retain the original diagnostic",
        completedAt: expect.any(Number),
      });
      expect(job).not.toHaveProperty("leaseToken");
      expect(job).not.toHaveProperty("leaseExpiresAt");
      expect(job).not.toHaveProperty("workerId");
    }
    const claimed = await f.t.mutation(internal.securityScan.claimQueuedJobsInternal, {
      workerId: "eligible-worker",
      limit: 10,
    });
    expect(new Set(claimed.map((job) => job._id))).toEqual(new Set(f.eligibleIds));
    await expect(
      f.t.mutation(internal.securityScan.requeueJobLeaseInternal, {
        jobId: f.retiredIds[0],
        leaseToken: "historical-lease",
        workerId: "historical-worker",
      }),
    ).rejects.toThrow("Lease mismatch");
    expect(await readReleases(f)).toEqual(releases);
    await assertScheduledFunctionsSucceeded(f);
  });

  it.each([true, false])(
    "paginates failed recovery past retained heads (dryRun=%s)",
    async (dryRun) => {
      const f = await fixture("failed", 7);
      const retired = await readJobs(f, f.retiredIds);
      const eligible = await readJobs(f, f.eligibleIds);
      const releases = await readReleases(f);
      const request = { failedAfter: 0, failedBefore: 100, dryRun, limit: 2 };
      let result = await f.t.mutation(
        internal.securityScan.requeueFailedSecurityScanJobsInternal,
        request,
      );
      expect(result).toMatchObject({ matched: 0, requeued: 0, hasMore: true, sampleJobIds: [] });
      const found: Id<"securityScanJobs">[] = [];
      let requeued = 0;
      for (let page = 0; page < 10; page++) {
        found.push(...result.sampleJobIds);
        requeued += result.requeued;
        if (!result.hasMore) break;
        expect(result.nextCursor).toBeTypeOf("string");
        result = await f.t.mutation(internal.securityScan.requeueFailedSecurityScanJobsInternal, {
          ...request,
          cursor: result.nextCursor!,
        });
      }
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeNull();
      expect(found).toEqual(f.eligibleIds);
      expect(requeued).toBe(dryRun ? 0 : f.eligibleIds.length);
      expect(await readJobs(f, f.retiredIds)).toEqual(retired);
      if (dryRun) expect(await readJobs(f, f.eligibleIds)).toEqual(eligible);
      else
        expect((await readJobs(f, f.eligibleIds)).every((job) => job?.status === "queued")).toBe(
          true,
        );
      expect(await readReleases(f)).toEqual(releases);
    },
  );

  it("resumes after the native read budget even when excluded catalog failures fill the window", async () => {
    const f = await fixture("failed", 0);
    await f.t.run(async (ctx) => {
      const native = (await ctx.db.get(f.eligibleIds[0]))!;
      const { _id, _creationTime, ...fields } = native;
      for (let i = 0; i < 1002; i++) {
        await ctx.db.insert("securityScanJobs", {
          ...fields,
          source: "skills-sh-catalog-test",
          updatedAt: 0,
        });
      }
    });
    const request = { failedAfter: 0, failedBefore: 100, dryRun: false, limit: 2 };
    let result = await f.t.mutation(
      internal.securityScan.requeueFailedSecurityScanJobsInternal,
      request,
    );
    // The post-index exclusion must not scan an arbitrarily large catalog backlog.
    expect(result).toMatchObject({ matched: 0, requeued: 0, hasMore: true });
    let recovered = 0;
    for (let page = 0; result.hasMore && page < 5; page++) {
      result = await f.t.mutation(internal.securityScan.requeueFailedSecurityScanJobsInternal, {
        ...request,
        cursor: result.nextCursor!,
      });
      recovered += result.requeued;
    }
    expect(result.hasMore).toBe(false);
    expect(recovered).toBe(f.eligibleIds.length);
    expect((await readJobs(f, f.eligibleIds)).every((job) => job?.status === "queued")).toBe(true);
  });

  it.each(["request", "begin"] as const)(
    "%s never dispatches workers for an only-retired queue larger than the cleanup bound",
    async (entry) => {
      const f = await fixture("queued", 130, false);
      enableDispatch();
      if (entry === "request") {
        expect(
          await f.t.mutation(internal.securityScanDispatch.requestSecurityScanDispatchInternal, {}),
        ).toEqual({ scheduled: false });
      } else {
        await f.t.run((ctx) =>
          ctx.db.insert("securityScanDispatchState", {
            key: "codex-worker",
            scheduledToken: "old-schedule",
            scheduledAt: NOW,
            updatedAt: NOW,
          }),
        );
        expect(
          await f.t.mutation(internal.securityScanDispatch.beginSecurityScanDispatchInternal, {
            scheduleToken: "old-schedule",
          }),
        ).toEqual({ shouldDispatch: false });
      }
      expect(
        (await readJobs(f, f.retiredIds)).filter((job) => job?.status === "failed"),
      ).toHaveLength(64);
      await f.t.finishAllScheduledFunctions(vi.runAllTimers);
      expect(dispatchGitHubRepositoryEvent).not.toHaveBeenCalled();
      expect((await readJobs(f, f.retiredIds)).every((job) => job?.status === "failed")).toBe(true);
      const state = await f.t.run((ctx) => ctx.db.query("securityScanDispatchState").first());
      expect(state?.scheduledToken).toBeUndefined();
      expect(state?.leaseToken).toBeUndefined();
      expect(
        await f.t.mutation(internal.securityScanDispatch.requestSecurityScanDispatchInternal, {}),
      ).toEqual({ scheduled: false });
      await assertScheduledFunctionsSucceeded(f);
    },
  );

  it.each(["request", "begin"] as const)(
    "%s reaches mixed eligible work behind more than one retired cleanup batch",
    async (entry) => {
      const f = await fixture("queued", 130);
      const releases = await readReleases(f);
      enableDispatch();
      if (entry === "request") {
        await f.t.mutation(internal.securityScanDispatch.requestSecurityScanDispatchInternal, {});
      } else {
        await f.t.run((ctx) =>
          ctx.db.insert("securityScanDispatchState", {
            key: "codex-worker",
            scheduledToken: "old-schedule",
            scheduledAt: NOW,
            updatedAt: NOW,
          }),
        );
        expect(
          await f.t.mutation(internal.securityScanDispatch.beginSecurityScanDispatchInternal, {
            scheduleToken: "old-schedule",
          }),
        ).toEqual({ shouldDispatch: false });
      }
      expect(dispatchGitHubRepositoryEvent).not.toHaveBeenCalled();
      await f.t.finishAllScheduledFunctions(vi.runAllTimers);
      expect(dispatchGitHubRepositoryEvent).toHaveBeenCalledTimes(1);
      expect((await readJobs(f, f.retiredIds)).every((job) => job?.status === "failed")).toBe(true);
      const claimed = await f.t.mutation(internal.securityScan.claimQueuedJobsInternal, {
        workerId: "eligible-worker",
        limit: 10,
      });
      expect(new Set(claimed.map((job) => job._id))).toEqual(new Set(f.eligibleIds));
      expect(await readReleases(f)).toEqual(releases);
      await assertScheduledFunctionsSucceeded(f);
    },
  );

  it("keeps a dispatch retry's notBefore across retired cleanup batches", async () => {
    const f = await fixture("queued", 130);
    enableDispatch();
    await f.t.mutation(internal.securityScanDispatch.requestSecurityScanDispatchInternal, {
      notBefore: NOW + 60_000,
    });
    for (let batch = 0; batch < 3; batch++) {
      vi.advanceTimersByTime(1);
      await f.t.finishInProgressScheduledFunctions();
    }
    expect(dispatchGitHubRepositoryEvent).not.toHaveBeenCalled();
    const state = await f.t.run((ctx) => ctx.db.query("securityScanDispatchState").first());
    expect(state?.scheduledAt).toBe(NOW + 60_000);
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(dispatchGitHubRepositoryEvent).toHaveBeenCalledTimes(1);
    await assertScheduledFunctionsSucceeded(f);
  });
});
