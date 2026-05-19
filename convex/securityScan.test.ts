import { afterEach, describe, expect, it, vi } from "vitest";
import { claimCodexScanJobs, pruneRedundantQueuedVtScanJobsInternal } from "./securityScan";

type WrappedHandler<TArgs, TResult = unknown> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const claimCodexScanJobsHandler = (
  claimCodexScanJobs as unknown as WrappedHandler<
    { token: string; workerId: string; limit?: number },
    Array<unknown>
  >
)._handler;

type PruneArgs = {
  dryRun: boolean;
  scanLimit?: number;
  deleteLimit?: number;
};

type PruneResult = {
  dryRun: boolean;
  scanned: number;
  eligible: number;
  deleted: number;
  wouldDelete: number;
  skippedByReason: Record<string, number>;
  oldestScannedCreatedAt: number | null;
  newestScannedCreatedAt: number | null;
  oldestScannedNextRunAt: number | null;
  newestScannedNextRunAt: number | null;
  sampleEligibleJobIds: string[];
  sampleDeletedJobIds: string[];
};

type PruneJob = {
  _id: string;
  _creationTime: number;
  status: string;
  targetKind: string;
  skillVersionId?: string;
  packageReleaseId?: string;
  source: string;
  priority: number;
  hasMaliciousSignal: boolean;
  waitForVtUntil: number;
  nextRunAt: number;
  attempts: number;
  createdAt: number;
  updatedAt: number;
};

const pruneRedundantQueuedVtScanJobsInternalHandler = (
  pruneRedundantQueuedVtScanJobsInternal as unknown as WrappedHandler<PruneArgs, PruneResult>
)._handler;

const claimedJob = {
  _id: "securityScanJobs:1",
  _creationTime: 1,
  status: "running",
  targetKind: "skillVersion",
  skillVersionId: "skillVersions:1",
  source: "publish",
  priority: 0,
  hasMaliciousSignal: true,
  waitForVtUntil: 0,
  nextRunAt: 0,
  attempts: 1,
  leaseToken: "lease-token",
};

function makeScanJob(overrides: Partial<PruneJob> = {}): PruneJob {
  const suffix = (overrides._id ?? "eligible").split(":").at(-1) ?? "eligible";
  return {
    _id: `securityScanJobs:${suffix}`,
    _creationTime: 1,
    status: "queued",
    targetKind: "skillVersion",
    skillVersionId: `skillVersions:${suffix}`,
    source: "vt-update",
    priority: 0,
    hasMaliciousSignal: false,
    waitForVtUntil: 0,
    nextRunAt: 100,
    attempts: 0,
    createdAt: 50,
    updatedAt: 50,
    ...overrides,
  };
}

function makeVersion(
  llmStatus?: string,
  vtStatus?: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    ...(llmStatus
      ? {
          llmAnalysis: {
            status: llmStatus,
            checkedAt: 123,
          },
        }
      : {}),
    ...(vtStatus
      ? {
          vtAnalysis: {
            status: vtStatus,
            checkedAt: 456,
          },
        }
      : {}),
    ...overrides,
  };
}

function makePruneCtx(jobs: PruneJob[], versions: Map<string, unknown>) {
  const deleted: string[] = [];
  const deleteDoc = vi.fn(async (id: string) => {
    deleted.push(id);
  });
  const get = vi.fn(async (id: string) => versions.get(id) ?? null);
  const noopWrite = vi.fn(async () => undefined);
  const take = vi.fn(async (limit: number) => jobs.slice(0, limit));
  const order = vi.fn(() => ({ take }));
  const indexBuilder: { eq: ReturnType<typeof vi.fn> } = {
    eq: vi.fn(() => indexBuilder),
  };
  const withIndex = vi.fn((indexName: string, buildRange: (q: typeof indexBuilder) => unknown) => {
    expect(indexName).toBe("by_status_source_target_kind_created_at");
    buildRange(indexBuilder);
    expect(indexBuilder.eq).toHaveBeenCalledWith("status", "queued");
    expect(indexBuilder.eq).toHaveBeenCalledWith("source", "vt-update");
    expect(indexBuilder.eq).toHaveBeenCalledWith("targetKind", "skillVersion");
    return { order };
  });
  const query = vi.fn((tableName: string) => {
    expect(tableName).toBe("securityScanJobs");
    return { withIndex };
  });

  return {
    ctx: {
      db: {
        query,
        get,
        delete: deleteDoc,
        insert: noopWrite,
        patch: noopWrite,
        replace: noopWrite,
        normalizeId: vi.fn(() => null),
        system: {},
      },
    },
    deleted,
    deleteDoc,
    get,
    take,
  };
}

describe("securityScan", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fails claimed jobs when an artifact file URL is unavailable", async () => {
    vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", "worker-secret");

    const runMutation = vi.fn(async (_ref: unknown, args: Record<string, unknown>) => {
      if ("limit" in args) return [claimedJob];
      return { ok: true };
    });
    const runQuery = vi.fn(async () => ({
      version: {
        files: [
          {
            path: "SKILL.md",
            size: 12,
            sha256: "a".repeat(64),
            storageId: "storage:skill",
          },
          {
            path: "payload.js",
            size: 24,
            sha256: "b".repeat(64),
            storageId: "storage:missing",
          },
        ],
      },
    }));
    const getUrl = vi.fn(async (storageId: string) =>
      storageId === "storage:skill" ? "https://storage.example/SKILL.md" : null,
    );

    const result = await claimCodexScanJobsHandler(
      { runMutation, runQuery, storage: { getUrl } },
      { token: "worker-secret", workerId: "worker-1", limit: 10 },
    );

    expect(result).toEqual([]);
    expect(runMutation).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        jobId: "securityScanJobs:1",
        leaseToken: "lease-token",
        error: "Artifact file unavailable: payload.js",
      }),
    );
  });

  it("fails claimed package jobs when the ClawPack URL is unavailable", async () => {
    vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", "worker-secret");

    const runMutation = vi.fn(async (_ref: unknown, args: Record<string, unknown>) => {
      if ("limit" in args) return [claimedJob];
      return { ok: true };
    });
    const runQuery = vi.fn(async () => ({
      release: {
        files: [],
        clawpackStorageId: "storage:clawpack",
      },
    }));
    const getUrl = vi.fn(async () => null);

    const result = await claimCodexScanJobsHandler(
      { runMutation, runQuery, storage: { getUrl } },
      { token: "worker-secret", workerId: "worker-1", limit: 10 },
    );

    expect(result).toEqual([]);
    expect(runMutation).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        jobId: "securityScanJobs:1",
        leaseToken: "lease-token",
        error: "ClawPack artifact unavailable",
      }),
    );
  });

  it("dry-runs redundant queued vt-update skill jobs without deleting", async () => {
    const job = makeScanJob({ _id: "securityScanJobs:dry-run" });
    const versions = new Map<string, unknown>([["skillVersions:dry-run", makeVersion("clean")]]);
    const { ctx, deleteDoc, take } = makePruneCtx([job], versions);

    const result = await pruneRedundantQueuedVtScanJobsInternalHandler(ctx, {
      dryRun: true,
    });

    expect(take).toHaveBeenCalledWith(1000);
    expect(result).toMatchObject({
      dryRun: true,
      scanned: 1,
      eligible: 1,
      wouldDelete: 1,
      deleted: 0,
      oldestScannedCreatedAt: 50,
      newestScannedCreatedAt: 50,
      oldestScannedNextRunAt: 100,
      newestScannedNextRunAt: 100,
      skippedByReason: {},
      sampleEligibleJobIds: ["securityScanJobs:dry-run"],
      sampleDeletedJobIds: [],
    });
    expect(deleteDoc).not.toHaveBeenCalled();
  });

  it("deletes only queued vt-update skill jobs with final llmAnalysis", async () => {
    const jobs = [
      makeScanJob({ _id: "securityScanJobs:clean" }),
      makeScanJob({ _id: "securityScanJobs:suspicious" }),
      makeScanJob({ _id: "securityScanJobs:malicious" }),
      makeScanJob({ _id: "securityScanJobs:publish", source: "publish" }),
      makeScanJob({ _id: "securityScanJobs:running", status: "running" }),
      makeScanJob({
        _id: "securityScanJobs:package",
        targetKind: "packageRelease",
        skillVersionId: undefined,
        packageReleaseId: "packageReleases:package",
      }),
      makeScanJob({
        _id: "securityScanJobs:malicious-signal",
        hasMaliciousSignal: true,
      }),
      makeScanJob({ _id: "securityScanJobs:missing-version" }),
      makeScanJob({ _id: "securityScanJobs:no-llm" }),
      makeScanJob({ _id: "securityScanJobs:error-llm" }),
      makeScanJob({ _id: "securityScanJobs:clawscan-note-fresh" }),
      makeScanJob({ _id: "securityScanJobs:vt-mismatch" }),
    ];
    const versions = new Map<string, unknown>([
      ["skillVersions:clean", makeVersion("clean")],
      ["skillVersions:suspicious", makeVersion("suspicious")],
      ["skillVersions:malicious", makeVersion("malicious")],
      ["skillVersions:running", makeVersion("clean")],
      ["skillVersions:malicious-signal", makeVersion("clean")],
      ["skillVersions:no-llm", makeVersion()],
      ["skillVersions:error-llm", makeVersion("error")],
      [
        "skillVersions:clawscan-note-fresh",
        makeVersion("clean", "clean", { clawScanNoteUpdatedAt: 456 }),
      ],
      ["skillVersions:vt-mismatch", makeVersion("clean", "malicious")],
    ]);
    const { ctx, deleted } = makePruneCtx(jobs, versions);

    const result = await pruneRedundantQueuedVtScanJobsInternalHandler(ctx, {
      dryRun: false,
      scanLimit: 25,
      deleteLimit: 10,
    });

    expect(deleted).toEqual([
      "securityScanJobs:clean",
      "securityScanJobs:suspicious",
      "securityScanJobs:malicious",
    ]);
    expect(result).toMatchObject({
      dryRun: false,
      scanned: 12,
      eligible: 3,
      wouldDelete: 3,
      deleted: 3,
      skippedByReason: {
        "not-vt-update": 1,
        "not-queued": 1,
        "not-skill-version": 1,
        "malicious-signal": 1,
        "missing-version": 1,
        "missing-llm-analysis": 1,
        "non-final-llm-analysis": 1,
        "clawscan-note-newer-than-llm": 1,
        "vt-llm-status-mismatch": 1,
      },
      sampleEligibleJobIds: [
        "securityScanJobs:clean",
        "securityScanJobs:suspicious",
        "securityScanJobs:malicious",
      ],
      sampleDeletedJobIds: [
        "securityScanJobs:clean",
        "securityScanJobs:suspicious",
        "securityScanJobs:malicious",
      ],
    });
  });

  it("counts eligible jobs beyond the per-run delete limit without deleting them", async () => {
    const jobs = [
      makeScanJob({ _id: "securityScanJobs:first" }),
      makeScanJob({ _id: "securityScanJobs:second" }),
    ];
    const versions = new Map<string, unknown>([
      ["skillVersions:first", makeVersion("clean")],
      ["skillVersions:second", makeVersion("clean")],
    ]);
    const { ctx, deleted } = makePruneCtx(jobs, versions);

    const result = await pruneRedundantQueuedVtScanJobsInternalHandler(ctx, {
      dryRun: false,
      deleteLimit: 1,
    });

    expect(deleted).toEqual(["securityScanJobs:first"]);
    expect(result).toMatchObject({
      scanned: 2,
      eligible: 2,
      wouldDelete: 1,
      deleted: 1,
      skippedByReason: {
        "delete-limit-reached": 1,
      },
      sampleEligibleJobIds: ["securityScanJobs:first", "securityScanJobs:second"],
      sampleDeletedJobIds: ["securityScanJobs:first"],
    });
  });
});
