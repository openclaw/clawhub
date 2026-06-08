import { getAuthUserId } from "@convex-dev/auth/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cancelQueuedVtUpdateJobsInternal,
  claimCodexScanJobs,
  clearQueuedBackfillJobsForLocalDev,
  claimQueuedJobsInternal,
  completeCodexScanJob,
  enqueueBulkSkillRescanBatchForAdminInternal,
  failCodexScanJob,
  getBulkSkillRescanBatchStatusForAdminInternal,
  getSkillScanRequestForUserInternal,
  getStoredScanReportForUserInternal,
  pruneExpiredSkillScanRequestsInternal,
  requestPackageRescanForUserInternal,
  requestPackageRescan,
  requestSkillRescanForUserInternal,
  requestSkillRescan,
} from "./securityScan";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
}));

type WrappedHandler<TArgs, TResult = unknown> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const claimCodexScanJobsHandler = (
  claimCodexScanJobs as unknown as WrappedHandler<
    { token: string; workerId: string; limit?: number },
    Array<unknown>
  >
)._handler;

const claimQueuedJobsInternalHandler = (
  claimQueuedJobsInternal as unknown as WrappedHandler<
    { workerId: string; limit: number; leaseMs?: number },
    Array<ScanJob & { leaseToken: string; workerId: string }>
  >
)._handler;

const failCodexScanJobHandler = (
  failCodexScanJob as unknown as WrappedHandler<
    { token: string; jobId: string; leaseToken: string; error: string },
    { ok: true; retry: boolean }
  >
)._handler;

const completeCodexScanJobHandler = (
  completeCodexScanJob as unknown as WrappedHandler<
    {
      token: string;
      jobId: string;
      leaseToken: string;
      llmAnalysis: {
        status: string;
        checkedAt: number;
      };
      skillSpectorAnalysis?: {
        status: string;
        issueCount: number;
        issues: Array<{
          issueId: string;
          severity: string;
          explanation: string;
          finding?: string;
          codeSnippet?: string;
        }>;
        checkedAt: number;
      };
      runId?: string;
    },
    { ok: true }
  >
)._handler;

type CancelArgs = {
  dryRun: boolean;
  createdBefore: number;
  scanLimit?: number;
  deleteLimit?: number;
};

type CancelResult = {
  dryRun: boolean;
  scanned: number;
  matched: number;
  deleted: number;
  wouldDelete: number;
  skippedByReason: Record<string, number>;
  oldestScannedCreatedAt: number | null;
  newestScannedCreatedAt: number | null;
  oldestScannedNextRunAt: number | null;
  newestScannedNextRunAt: number | null;
  sampleMatchedJobIds: string[];
  sampleDeletedJobIds: string[];
};

type ScanJob = {
  _id: string;
  _creationTime: number;
  status: string;
  targetKind: string;
  skillVersionId?: string;
  packageReleaseId?: string;
  skillScanRequestId?: string;
  source: string;
  priority: number;
  hasMaliciousSignal: boolean;
  waitForVtUntil: number;
  nextRunAt: number;
  attempts: number;
  leaseToken?: string;
  leaseExpiresAt?: number;
  workerId?: string;
  createdAt: number;
  updatedAt: number;
};

const cancelQueuedVtUpdateJobsInternalHandler = (
  cancelQueuedVtUpdateJobsInternal as unknown as WrappedHandler<CancelArgs, CancelResult>
)._handler;
const clearQueuedBackfillJobsForLocalDevHandler = (
  clearQueuedBackfillJobsForLocalDev as unknown as WrappedHandler<
    { dryRun?: boolean; limit?: number },
    { dryRun: boolean; matched: number; deleted: number; sampleDeletedJobIds: string[] }
  >
)._handler;
const pruneExpiredSkillScanRequestsInternalHandler = (
  pruneExpiredSkillScanRequestsInternal as unknown as WrappedHandler<
    { batchSize?: number },
    { ok: true; deletedRequests: number; deletedJobs: number; deletedFiles: number; done: boolean }
  >
)._handler;

const requestSkillRescanHandler = (
  requestSkillRescan as unknown as WrappedHandler<
    { skillId: string; version?: string },
    { jobId: string; alreadyQueued: boolean }
  >
)._handler;

const requestPackageRescanHandler = (
  requestPackageRescan as unknown as WrappedHandler<
    { packageId: string; version?: string },
    { jobId: string; alreadyQueued: boolean; packageReleaseId: string }
  >
)._handler;

const requestSkillRescanForUserInternalHandler = (
  requestSkillRescanForUserInternal as unknown as WrappedHandler<
    { actorUserId: string; slug: string; version?: string },
    { jobId: string; alreadyQueued: boolean; skillVersionId: string }
  >
)._handler;

const requestPackageRescanForUserInternalHandler = (
  requestPackageRescanForUserInternal as unknown as WrappedHandler<
    { actorUserId: string; name: string; version?: string },
    { jobId: string; alreadyQueued: boolean; packageReleaseId: string }
  >
)._handler;

const enqueueBulkSkillRescanBatchForAdminInternalHandler = (
  enqueueBulkSkillRescanBatchForAdminInternal as unknown as WrappedHandler<
    {
      actorUserId: string;
      mode?: "all-active-latest";
      cursor?: string | null;
      batchSize?: number;
      dryRun?: boolean;
    },
    {
      ok: true;
      queued: number;
      alreadyQueued: number;
      skipped: number;
      jobIds: string[];
      nextCursor: string | null;
      done: boolean;
      sampleSlugs: string[];
    }
  >
)._handler;

const getBulkSkillRescanBatchStatusForAdminInternalHandler = (
  getBulkSkillRescanBatchStatusForAdminInternal as unknown as WrappedHandler<
    { actorUserId: string; jobIds: string[] },
    {
      ok: true;
      total: number;
      queued: number;
      running: number;
      succeeded: number;
      failed: number;
      missing: number;
      terminal: number;
      done: boolean;
      failedJobIds: string[];
    }
  >
)._handler;

const getSkillScanRequestForUserInternalHandler = (
  getSkillScanRequestForUserInternal as unknown as WrappedHandler<
    { actorUserId: string; scanId: string },
    {
      ok: true;
      scanId: string;
      jobId?: string;
      status: string;
      queue: {
        queuedAhead: number;
        queuedAheadIsEstimate?: boolean;
        position: number | null;
        running: number;
        runningIsEstimate?: boolean;
        note: string;
      };
    }
  >
)._handler;

const getStoredScanReportForUserInternalHandler = (
  getStoredScanReportForUserInternal as unknown as WrappedHandler<
    {
      actorUserId: string;
      kind: "skill" | "plugin";
      name: string;
      version: string;
    },
    {
      ok: true;
      status: string;
      artifact: Record<string, unknown>;
      report: {
        clawscan: Record<string, unknown> | null;
        skillspector: Record<string, unknown> | null;
        staticAnalysis: Record<string, unknown> | null;
        virustotal: Record<string, unknown> | null;
      };
    }
  >
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

function makeScanJob(overrides: Partial<ScanJob> = {}): ScanJob {
  const suffix = (overrides._id ?? "matched").split(":").at(-1) ?? "matched";
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

function makeTarget(llmStatus?: string) {
  if (!llmStatus) return {};
  return {
    llmAnalysis: {
      status: llmStatus,
      checkedAt: 123,
    },
  };
}

function makeRescanCtx(options: {
  actorId: string;
  actorRole?: "admin" | "moderator" | "user";
  docs: Record<string, Record<string, unknown>>;
  activeJobs?: Array<Record<string, unknown>>;
  membership?: Record<string, unknown> | null;
}) {
  vi.mocked(getAuthUserId).mockResolvedValue(options.actorId as never);
  const docs = new Map<string, Record<string, unknown>>(
    Object.entries({
      [options.actorId]: {
        _id: options.actorId,
        role: options.actorRole ?? "user",
      },
      ...options.docs,
    }),
  );
  const inserts: Array<{ table: string; doc: Record<string, unknown> }> = [];
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const get = vi.fn(async (id: string) => docs.get(id) ?? null);
  const insert = vi.fn(async (table: string, doc: Record<string, unknown>) => {
    const id = `${table}:${inserts.length + 1}`;
    inserts.push({ table, doc });
    return id;
  });
  const patch = vi.fn(async (id: string, doc: Record<string, unknown>) => {
    patches.push({ id, patch: doc });
  });
  const query = vi.fn((table: string) => ({
    withIndex: vi.fn((_indexName: string, buildRange: (q: { eq: typeof eq }) => unknown) => {
      const equals = new Map<string, unknown>();
      function eq(field: string, value: unknown) {
        equals.set(field, value);
        return { eq };
      }
      buildRange({ eq });
      return {
        collect: vi.fn(async () => {
          if (table === "securityScanJobs") return options.activeJobs ?? [];
          return [];
        }),
        unique: vi.fn(async () => {
          if (table === "publisherMembers") return options.membership ?? null;
          if (table === "skills") {
            return (
              Array.from(docs.values()).find(
                (doc) =>
                  doc._id?.toString().startsWith("skills:") && doc.slug === equals.get("slug"),
              ) ?? null
            );
          }
          if (table === "packages") {
            return (
              Array.from(docs.values()).find(
                (doc) =>
                  doc._id?.toString().startsWith("packages:") &&
                  doc.normalizedName === equals.get("normalizedName"),
              ) ?? null
            );
          }
          if (table === "skillVersions") {
            return (
              Array.from(docs.values()).find(
                (doc) =>
                  doc._id?.toString().startsWith("skillVersions:") &&
                  doc.skillId === equals.get("skillId") &&
                  doc.version === equals.get("version"),
              ) ?? null
            );
          }
          if (table === "packageReleases") {
            return (
              Array.from(docs.values()).find(
                (doc) =>
                  doc._id?.toString().startsWith("packageReleases:") &&
                  doc.packageId === equals.get("packageId") &&
                  doc.version === equals.get("version"),
              ) ?? null
            );
          }
          return null;
        }),
      };
    }),
  }));

  return {
    ctx: {
      db: {
        get,
        insert,
        patch,
        query,
        replace: vi.fn(),
        delete: vi.fn(),
        normalizeId: vi.fn(() => null),
        system: {},
      },
    },
    inserts,
    patches,
    get,
    insert,
    patch,
    query,
  };
}

function makeBulkRescanCtx(options: {
  actorId?: string;
  actorRole?: "admin" | "moderator" | "user";
  skills: Array<Record<string, unknown>>;
  versions: Array<Record<string, unknown>>;
  jobs?: Array<Record<string, unknown>>;
}) {
  const actorId = options.actorId ?? "users:admin";
  const docs = new Map<string, Record<string, unknown>>([
    [
      actorId,
      {
        _id: actorId,
        role: options.actorRole ?? "admin",
      },
    ],
    ...options.skills.map((skill) => [String(skill._id), skill] as const),
    ...options.versions.map((version) => [String(version._id), version] as const),
    ...(options.jobs ?? []).map((job) => [String(job._id), job] as const),
  ]);
  const inserts: Array<{ table: string; doc: Record<string, unknown> }> = [];
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const get = vi.fn(async (id: string) => docs.get(id) ?? null);
  const insert = vi.fn(async (table: string, doc: Record<string, unknown>) => {
    const id = `${table}:${inserts.filter((entry) => entry.table === table).length + 1}`;
    const inserted = { _id: id, _creationTime: Date.now(), ...doc };
    docs.set(id, inserted);
    inserts.push({ table, doc });
    return id;
  });
  const patch = vi.fn(async (id: string, doc: Record<string, unknown>) => {
    patches.push({ id, patch: doc });
    docs.set(id, { ...(docs.get(id) ?? { _id: id }), ...doc });
  });
  const query = vi.fn((table: string) => ({
    withIndex: vi.fn((indexName: string, buildRange: (q: { eq: typeof eq }) => unknown) => {
      const equals = new Map<string, unknown>();
      function eq(field: string, value: unknown) {
        equals.set(field, value);
        return { eq };
      }
      buildRange({ eq });

      if (table === "skills") {
        return {
          order: vi.fn(() => ({
            paginate: vi.fn(
              async ({ cursor, numItems }: { cursor: string | null; numItems: number }) => {
                expect(indexName).toBe("by_active_created");
                const start = cursor ? Number.parseInt(cursor, 10) : 0;
                const allSkills = options.skills.filter(
                  (skill) => skill.softDeletedAt === equals.get("softDeletedAt"),
                );
                const page = allSkills.slice(start, start + numItems);
                const next = start + page.length;
                return {
                  page,
                  isDone: next >= allSkills.length,
                  continueCursor: next >= allSkills.length ? "" : String(next),
                };
              },
            ),
          })),
        };
      }

      return {
        collect: vi.fn(async () => {
          if (table !== "securityScanJobs") return [];
          return (options.jobs ?? []).filter((job) => {
            if (
              equals.has("skillVersionId") &&
              job.skillVersionId !== equals.get("skillVersionId")
            ) {
              return false;
            }
            return true;
          });
        }),
      };
    }),
  }));

  return {
    ctx: {
      db: {
        get,
        insert,
        patch,
        query,
        replace: vi.fn(),
        delete: vi.fn(),
        normalizeId: vi.fn(() => null),
        system: {},
      },
    },
    inserts,
    patches,
    get,
    insert,
    patch,
    query,
  };
}

function makeCancelCtx(jobs: ScanJob[], targets: Map<string, unknown> = new Map()) {
  const deleted: string[] = [];
  const deleteDoc = vi.fn(async (id: string) => {
    deleted.push(id);
  });
  const get = vi.fn(async (id: string) => targets.get(id) ?? null);
  const noopWrite = vi.fn(async () => undefined);
  const take = vi.fn(async (limit: number) => jobs.slice(0, limit));
  const order = vi.fn(() => ({ take }));
  const indexBuilder: {
    eq: ReturnType<typeof vi.fn>;
    lt: ReturnType<typeof vi.fn>;
  } = {
    eq: vi.fn(() => indexBuilder),
    lt: vi.fn(() => indexBuilder),
  };
  const withIndex = vi.fn((indexName: string, buildRange: (q: typeof indexBuilder) => unknown) => {
    expect(indexName).toBe("by_status_source_created_at");
    buildRange(indexBuilder);
    expect(indexBuilder.eq).toHaveBeenCalledWith("status", "queued");
    expect(indexBuilder.eq).toHaveBeenCalledWith("source", "vt-update");
    expect(indexBuilder.lt).toHaveBeenCalledWith("createdAt", 1000);
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

function makeClaimCtx(jobs: ScanJob[]) {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const patch = vi.fn(async (id: string, doc: Record<string, unknown>) => {
    patches.push({ id, patch: doc });
  });
  const query = vi.fn((tableName: string) => {
    expect(tableName).toBe("securityScanJobs");
    return {
      withIndex: vi.fn(
        (
          indexName: string,
          buildRange: (q: {
            eq: (field: string, value: unknown) => unknown;
            lte: (field: string, value: number) => unknown;
          }) => unknown,
        ) => {
          const eqFilters = new Map<string, unknown>();
          const lteFilters = new Map<string, number>();
          const indexBuilder = {
            eq(field: string, value: unknown) {
              eqFilters.set(field, value);
              return indexBuilder;
            },
            lte(field: string, value: number) {
              lteFilters.set(field, value);
              return indexBuilder;
            },
          };
          buildRange(indexBuilder);
          const select = () =>
            jobs
              .filter((job) => {
                for (const [field, value] of eqFilters) {
                  if ((job as unknown as Record<string, unknown>)[field] !== value) return false;
                }
                for (const [field, value] of lteFilters) {
                  const fieldValue = (job as unknown as Record<string, unknown>)[field];
                  if (typeof fieldValue !== "number" || fieldValue > value) return false;
                }
                return true;
              })
              .sort((a, b) => {
                if (indexName.includes("next_run_at")) return a.nextRunAt - b.nextRunAt;
                if (indexName.includes("lease_expires_at")) {
                  return (
                    ((a as unknown as { leaseExpiresAt?: number }).leaseExpiresAt ?? 0) -
                    ((b as unknown as { leaseExpiresAt?: number }).leaseExpiresAt ?? 0)
                  );
                }
                return a.createdAt - b.createdAt;
              });
          const take = vi.fn(async (limit: number) => select().slice(0, limit));
          return {
            take,
            order: vi.fn(() => ({ take })),
          };
        },
      ),
    };
  });

  return {
    ctx: {
      db: {
        query,
        patch,
        get: vi.fn(),
        insert: vi.fn(),
        replace: vi.fn(),
        delete: vi.fn(),
        normalizeId: vi.fn(() => null),
        system: {},
      },
    },
    patches,
    patch,
    query,
  };
}

function makeSkillScanStatusCtx(options: {
  actor: Record<string, unknown>;
  request: Record<string, unknown>;
  jobs: ScanJob[];
}) {
  const docs = new Map<string, Record<string, unknown>>([
    [String(options.actor._id), options.actor],
    [String(options.request._id), options.request],
    ...options.jobs.map((job) => [job._id, job] as const),
  ]);
  const get = vi.fn(async (id: string) => docs.get(id) ?? null);
  const query = vi.fn((tableName: string) => {
    expect(tableName).toBe("securityScanJobs");
    return {
      withIndex: vi.fn(
        (
          indexName: string,
          buildRange: (q: {
            eq: (field: string, value: unknown) => unknown;
            lte: (field: string, value: number) => unknown;
          }) => unknown,
        ) => {
          const eqFilters = new Map<string, unknown>();
          const lteFilters = new Map<string, number>();
          const indexBuilder = {
            eq(field: string, value: unknown) {
              eqFilters.set(field, value);
              return indexBuilder;
            },
            lte(field: string, value: number) {
              lteFilters.set(field, value);
              return indexBuilder;
            },
          };
          buildRange(indexBuilder);
          const select = () =>
            options.jobs
              .filter((job) => {
                for (const [field, value] of eqFilters) {
                  if ((job as unknown as Record<string, unknown>)[field] !== value) return false;
                }
                for (const [field, value] of lteFilters) {
                  const fieldValue = (job as unknown as Record<string, unknown>)[field];
                  if (typeof fieldValue !== "number" || fieldValue > value) return false;
                }
                return true;
              })
              .sort((a, b) => {
                if (indexName.includes("next_run_at")) {
                  if (a.nextRunAt !== b.nextRunAt) return a.nextRunAt - b.nextRunAt;
                  if (a._creationTime !== b._creationTime) {
                    return a._creationTime - b._creationTime;
                  }
                  return a._id.localeCompare(b._id);
                }
                return a.createdAt - b.createdAt;
              });
          const collect = vi.fn(async () => select());
          const take = vi.fn(async (limit: number) => select().slice(0, limit));
          return {
            collect,
            take,
            order: vi.fn(() => ({ collect, take })),
          };
        },
      ),
    };
  });

  return {
    db: {
      get,
      query,
    },
  };
}

function makeStoredScanReportCtx(options: {
  actor: Record<string, unknown>;
  docs: Record<string, Record<string, unknown>>;
  membership?: Record<string, unknown> | null;
}) {
  const docs = new Map<string, Record<string, unknown>>([
    [String(options.actor._id), options.actor],
    ...Object.entries(options.docs),
  ]);
  const get = vi.fn(async (id: string) => docs.get(id) ?? null);
  const query = vi.fn((table: string) => ({
    withIndex: vi.fn((_indexName: string, buildRange: (q: { eq: typeof eq }) => unknown) => {
      const equals = new Map<string, unknown>();
      function eq(field: string, value: unknown) {
        equals.set(field, value);
        return { eq };
      }
      buildRange({ eq });
      return {
        unique: vi.fn(async () => {
          if (table === "publisherMembers") return options.membership ?? null;
          if (table === "skills") {
            return (
              Array.from(docs.values()).find(
                (doc) => String(doc._id).startsWith("skills:") && doc.slug === equals.get("slug"),
              ) ?? null
            );
          }
          if (table === "skillVersions") {
            return (
              Array.from(docs.values()).find(
                (doc) =>
                  String(doc._id).startsWith("skillVersions:") &&
                  doc.skillId === equals.get("skillId") &&
                  doc.version === equals.get("version"),
              ) ?? null
            );
          }
          if (table === "packages") {
            return (
              Array.from(docs.values()).find(
                (doc) =>
                  String(doc._id).startsWith("packages:") &&
                  doc.normalizedName === equals.get("normalizedName"),
              ) ?? null
            );
          }
          if (table === "packageReleases") {
            return (
              Array.from(docs.values()).find(
                (doc) =>
                  String(doc._id).startsWith("packageReleases:") &&
                  doc.packageId === equals.get("packageId") &&
                  doc.version === equals.get("version"),
              ) ?? null
            );
          }
          return null;
        }),
      };
    }),
  }));

  return {
    db: {
      get,
      query,
    },
  };
}

describe("securityScan", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(getAuthUserId).mockReset();
  });

  it("lets platform moderators request skill rescans", async () => {
    const { ctx, inserts } = makeRescanCtx({
      actorId: "users:moderator",
      actorRole: "moderator",
      docs: {
        "skills:1": {
          _id: "skills:1",
          slug: "demo-skill",
          ownerUserId: "users:owner",
          latestVersionId: "skillVersions:1",
        },
        "skillVersions:1": {
          _id: "skillVersions:1",
          skillId: "skills:1",
          version: "1.0.0",
        },
      },
    });

    const result = await requestSkillRescanHandler(ctx, {
      skillId: "skills:1",
      version: "1.0.0",
    });

    expect(result).toMatchObject({
      jobId: "securityScanJobs:1",
      alreadyQueued: false,
    });
    expect(inserts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "securityScanJobs",
          doc: expect.objectContaining({
            targetKind: "skillVersion",
            skillVersionId: "skillVersions:1",
            source: "manual",
            priority: 100,
          }),
        }),
        expect.objectContaining({
          table: "auditLogs",
          doc: expect.objectContaining({
            actorUserId: "users:moderator",
            action: "skill.clawscan.rescan",
            targetType: "skillVersion",
            targetId: "skillVersions:1",
          }),
        }),
      ]),
    );
  });

  it("returns stored scan reports for hidden skill versions to the owner", async () => {
    const ctx = makeStoredScanReportCtx({
      actor: { _id: "users:owner", role: "user" },
      docs: {
        "skills:hidden": {
          _id: "skills:hidden",
          slug: "hidden-skill",
          displayName: "Hidden Skill",
          ownerUserId: "users:owner",
        },
        "skillVersions:hidden": {
          _id: "skillVersions:hidden",
          skillId: "skills:hidden",
          version: "1.2.3",
          softDeletedAt: 1_700_000_100_000,
          files: [],
          sha256hash: "abc123",
          llmAnalysis: {
            status: "malicious",
            summary: "Attempts to exfiltrate credentials.",
            checkedAt: 1_700_000_000_000,
          },
          staticScan: {
            status: "malicious",
            reasonCodes: ["network.exfiltration"],
            findings: [],
            summary: "Credential exfiltration pattern.",
            checkedAt: 1_700_000_000_000,
          },
          createdAt: 1_700_000_000_000,
        },
      },
    });

    const report = await getStoredScanReportForUserInternalHandler(ctx, {
      actorUserId: "users:owner",
      kind: "skill",
      name: "hidden-skill",
      version: "1.2.3",
    });

    expect(report).toMatchObject({
      ok: true,
      status: "succeeded",
      artifact: {
        kind: "skill",
        slug: "hidden-skill",
        displayName: "Hidden Skill",
        version: "1.2.3",
      },
      report: {
        clawscan: {
          status: "malicious",
          summary: "Attempts to exfiltrate credentials.",
        },
        staticAnalysis: {
          status: "malicious",
          summary: "Credential exfiltration pattern.",
        },
      },
    });
  });

  it("returns stored scan reports for hidden org skill versions to publisher-role uploaders", async () => {
    const ctx = makeStoredScanReportCtx({
      actor: { _id: "users:member", role: "user" },
      membership: {
        _id: "publisherMembers:member",
        publisherId: "publishers:org",
        userId: "users:member",
        role: "publisher",
      },
      docs: {
        "publishers:org": {
          _id: "publishers:org",
          kind: "org",
          handle: "org",
        },
        "skills:hidden": {
          _id: "skills:hidden",
          slug: "hidden-skill",
          displayName: "Hidden Skill",
          ownerUserId: "users:owner",
          ownerPublisherId: "publishers:org",
        },
        "skillVersions:hidden": {
          _id: "skillVersions:hidden",
          skillId: "skills:hidden",
          version: "1.2.3",
          softDeletedAt: 1_700_000_100_000,
          files: [],
          sha256hash: "abc123",
          llmAnalysis: {
            status: "malicious",
            summary: "Attempts to exfiltrate credentials.",
            checkedAt: 1_700_000_000_000,
          },
          createdAt: 1_700_000_000_000,
        },
      },
    });

    const report = await getStoredScanReportForUserInternalHandler(ctx, {
      actorUserId: "users:member",
      kind: "skill",
      name: "hidden-skill",
      version: "1.2.3",
    });

    expect(report).toMatchObject({
      ok: true,
      artifact: {
        kind: "skill",
        slug: "hidden-skill",
        displayName: "Hidden Skill",
        version: "1.2.3",
      },
    });
  });

  it("denies stored scan reports to non-owners", async () => {
    const ctx = makeStoredScanReportCtx({
      actor: { _id: "users:intruder", role: "user" },
      docs: {
        "skills:hidden": {
          _id: "skills:hidden",
          slug: "hidden-skill",
          displayName: "Hidden Skill",
          ownerUserId: "users:owner",
        },
        "skillVersions:hidden": {
          _id: "skillVersions:hidden",
          skillId: "skills:hidden",
          version: "1.2.3",
          softDeletedAt: 1,
          files: [],
          llmAnalysis: { status: "malicious", checkedAt: 1 },
          createdAt: 1,
        },
      },
    });

    await expect(
      getStoredScanReportForUserInternalHandler(ctx, {
        actorUserId: "users:intruder",
        kind: "skill",
        name: "hidden-skill",
        version: "1.2.3",
      }),
    ).rejects.toThrow("Forbidden");
  });

  it("returns stored scan reports for hidden plugin releases to platform moderators", async () => {
    const ctx = makeStoredScanReportCtx({
      actor: { _id: "users:moderator", role: "moderator" },
      docs: {
        "packages:plugin": {
          _id: "packages:plugin",
          name: "@scope/demo",
          normalizedName: "@scope/demo",
          displayName: "Demo Plugin",
          ownerUserId: "users:owner",
        },
        "packageReleases:hidden": {
          _id: "packageReleases:hidden",
          packageId: "packages:plugin",
          version: "2.0.0",
          softDeletedAt: 1_700_000_100_000,
          files: [],
          integritySha256: "def456",
          llmAnalysis: {
            status: "malicious",
            summary: "Runs unexpected shell commands.",
            checkedAt: 1_700_000_000_000,
          },
          createdAt: 1_700_000_000_000,
        },
      },
    });

    const report = await getStoredScanReportForUserInternalHandler(ctx, {
      actorUserId: "users:moderator",
      kind: "plugin",
      name: "@scope/demo",
      version: "2.0.0",
    });

    expect(report).toMatchObject({
      ok: true,
      status: "succeeded",
      artifact: {
        kind: "plugin",
        name: "@scope/demo",
        displayName: "Demo Plugin",
        version: "2.0.0",
      },
      report: {
        clawscan: {
          status: "malicious",
          summary: "Runs unexpected shell commands.",
        },
      },
    });
  });

  it("returns stored scan reports for hidden org plugin releases to publisher-role uploaders", async () => {
    const ctx = makeStoredScanReportCtx({
      actor: { _id: "users:member", role: "user" },
      membership: {
        _id: "publisherMembers:member",
        publisherId: "publishers:org",
        userId: "users:member",
        role: "publisher",
      },
      docs: {
        "publishers:org": {
          _id: "publishers:org",
          kind: "org",
          handle: "org",
        },
        "packages:plugin": {
          _id: "packages:plugin",
          name: "@org/demo",
          normalizedName: "@org/demo",
          displayName: "Org Plugin",
          ownerUserId: "users:owner",
          ownerPublisherId: "publishers:org",
        },
        "packageReleases:hidden": {
          _id: "packageReleases:hidden",
          packageId: "packages:plugin",
          version: "2.0.0",
          softDeletedAt: 1_700_000_100_000,
          files: [],
          integritySha256: "def456",
          llmAnalysis: {
            status: "malicious",
            summary: "Runs unexpected shell commands.",
            checkedAt: 1_700_000_000_000,
          },
          createdAt: 1_700_000_000_000,
        },
      },
    });

    const report = await getStoredScanReportForUserInternalHandler(ctx, {
      actorUserId: "users:member",
      kind: "plugin",
      name: "@org/demo",
      version: "2.0.0",
    });

    expect(report).toMatchObject({
      ok: true,
      artifact: {
        kind: "plugin",
        name: "@org/demo",
        displayName: "Org Plugin",
        version: "2.0.0",
      },
    });
  });

  it("lets skill owners request skill rescans through the API helper", async () => {
    const { ctx, inserts } = makeRescanCtx({
      actorId: "users:owner",
      docs: {
        "skills:1": {
          _id: "skills:1",
          slug: "demo-skill",
          ownerUserId: "users:owner",
          latestVersionId: "skillVersions:1",
        },
        "skillVersions:1": {
          _id: "skillVersions:1",
          skillId: "skills:1",
          version: "1.0.0",
        },
      },
    });

    const result = await requestSkillRescanForUserInternalHandler(ctx, {
      actorUserId: "users:owner",
      slug: "demo-skill",
      version: "1.0.0",
    });

    expect(result).toMatchObject({
      skillVersionId: "skillVersions:1",
      jobId: "securityScanJobs:1",
      alreadyQueued: false,
    });
    expect(inserts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "auditLogs",
          doc: expect.objectContaining({
            actorUserId: "users:owner",
            action: "skill.clawscan.rescan",
          }),
        }),
      ]),
    );
  });

  it("queues bulk rescans for active latest skill versions as low-priority jobs", async () => {
    const { ctx, inserts } = makeBulkRescanCtx({
      skills: [
        {
          _id: "skills:active-1",
          slug: "active-one",
          moderationStatus: "active",
          latestVersionId: "skillVersions:active-1",
        },
        {
          _id: "skills:hidden",
          slug: "hidden-skill",
          moderationStatus: "hidden",
          latestVersionId: "skillVersions:hidden",
        },
        {
          _id: "skills:active-2",
          slug: "active-two",
          moderationStatus: "active",
          latestVersionId: "skillVersions:active-2",
        },
      ],
      versions: [
        { _id: "skillVersions:active-1", skillId: "skills:active-1", version: "1.0.0" },
        { _id: "skillVersions:hidden", skillId: "skills:hidden", version: "1.0.0" },
        { _id: "skillVersions:active-2", skillId: "skills:active-2", version: "1.0.0" },
      ],
    });

    const result = await enqueueBulkSkillRescanBatchForAdminInternalHandler(ctx, {
      actorUserId: "users:admin",
      batchSize: 3,
    });

    expect(result).toMatchObject({
      ok: true,
      queued: 2,
      alreadyQueued: 0,
      skipped: 1,
      done: true,
    });
    expect(result.jobIds).toEqual(["securityScanJobs:1", "securityScanJobs:2"]);
    expect(inserts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "securityScanJobs",
          doc: expect.objectContaining({
            targetKind: "skillVersion",
            skillVersionId: "skillVersions:active-1",
            source: "bulk-rescan",
            priority: 0,
          }),
        }),
        expect.objectContaining({
          table: "auditLogs",
          doc: expect.objectContaining({
            action: "skill.clawscan.bulk_rescan_batch",
            targetType: "securityScanBatch",
          }),
        }),
      ]),
    );
  });

  it("treats missing moderation status as active during bulk rescans", async () => {
    const { ctx } = makeBulkRescanCtx({
      skills: [
        {
          _id: "skills:legacy-active",
          slug: "legacy-active",
          latestVersionId: "skillVersions:legacy-active",
        },
      ],
      versions: [
        {
          _id: "skillVersions:legacy-active",
          skillId: "skills:legacy-active",
          version: "1.0.0",
        },
      ],
    });

    const result = await enqueueBulkSkillRescanBatchForAdminInternalHandler(ctx, {
      actorUserId: "users:admin",
      batchSize: 1,
    });

    expect(result).toMatchObject({
      queued: 1,
      alreadyQueued: 0,
      skipped: 0,
      jobIds: ["securityScanJobs:1"],
    });
  });

  it("does not demote existing active jobs during bulk rescans", async () => {
    const { ctx, inserts, patch } = makeBulkRescanCtx({
      skills: [
        {
          _id: "skills:active-1",
          slug: "active-one",
          moderationStatus: "active",
          latestVersionId: "skillVersions:active-1",
        },
      ],
      versions: [{ _id: "skillVersions:active-1", skillId: "skills:active-1", version: "1.0.0" }],
      jobs: [
        makeScanJob({
          _id: "securityScanJobs:manual",
          skillVersionId: "skillVersions:active-1",
          source: "manual",
          priority: 100,
        }),
      ],
    });

    const result = await enqueueBulkSkillRescanBatchForAdminInternalHandler(ctx, {
      actorUserId: "users:admin",
      batchSize: 1,
    });

    expect(result).toMatchObject({
      queued: 0,
      alreadyQueued: 1,
      skipped: 0,
      jobIds: ["securityScanJobs:manual"],
    });
    expect(patch).not.toHaveBeenCalled();
    expect(inserts).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ table: "securityScanJobs" })]),
    );
  });

  it("dry-runs bulk rescans without inserting jobs", async () => {
    const { ctx, inserts } = makeBulkRescanCtx({
      skills: [
        {
          _id: "skills:active-1",
          slug: "active-one",
          moderationStatus: "active",
          latestVersionId: "skillVersions:active-1",
        },
      ],
      versions: [{ _id: "skillVersions:active-1", skillId: "skills:active-1", version: "1.0.0" }],
    });

    const result = await enqueueBulkSkillRescanBatchForAdminInternalHandler(ctx, {
      actorUserId: "users:admin",
      batchSize: 1,
      dryRun: true,
    });

    expect(result).toMatchObject({ queued: 1, alreadyQueued: 0, skipped: 0, jobIds: [] });
    expect(inserts).toEqual([]);
  });

  it("aggregates bulk rescan batch status", async () => {
    const { ctx } = makeBulkRescanCtx({
      skills: [],
      versions: [],
      jobs: [
        makeScanJob({ _id: "securityScanJobs:queued", status: "queued" }),
        makeScanJob({ _id: "securityScanJobs:running", status: "running" }),
        makeScanJob({ _id: "securityScanJobs:succeeded", status: "succeeded" }),
        makeScanJob({ _id: "securityScanJobs:failed", status: "failed" }),
      ],
    });

    const result = await getBulkSkillRescanBatchStatusForAdminInternalHandler(ctx, {
      actorUserId: "users:admin",
      jobIds: [
        "securityScanJobs:queued",
        "securityScanJobs:running",
        "securityScanJobs:succeeded",
        "securityScanJobs:failed",
        "securityScanJobs:missing",
      ],
    });

    expect(result).toEqual({
      ok: true,
      total: 5,
      queued: 1,
      running: 1,
      succeeded: 1,
      failed: 1,
      missing: 1,
      terminal: 3,
      done: false,
      failedJobIds: ["securityScanJobs:failed"],
    });
  });

  it("lets platform moderators request package rescans", async () => {
    const { ctx, inserts } = makeRescanCtx({
      actorId: "users:moderator",
      actorRole: "moderator",
      docs: {
        "packages:1": {
          _id: "packages:1",
          name: "@acme/demo-plugin",
          normalizedName: "@acme/demo-plugin",
          family: "plugin",
          ownerUserId: "users:owner",
          latestReleaseId: "packageReleases:1",
        },
        "packageReleases:1": {
          _id: "packageReleases:1",
          packageId: "packages:1",
          version: "1.0.0",
        },
      },
    });

    const result = await requestPackageRescanHandler(ctx, {
      packageId: "packages:1",
      version: "1.0.0",
    });

    expect(result).toMatchObject({
      packageReleaseId: "packageReleases:1",
      jobId: "securityScanJobs:1",
      alreadyQueued: false,
    });
    expect(inserts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "securityScanJobs",
          doc: expect.objectContaining({
            targetKind: "packageRelease",
            packageReleaseId: "packageReleases:1",
            source: "manual",
            priority: 100,
          }),
        }),
        expect.objectContaining({
          table: "auditLogs",
          doc: expect.objectContaining({
            actorUserId: "users:moderator",
            action: "package.clawscan.rescan",
            targetType: "packageRelease",
            targetId: "packageReleases:1",
          }),
        }),
      ]),
    );
  });

  it("lets package owners request package rescans through the API helper", async () => {
    const { ctx, inserts } = makeRescanCtx({
      actorId: "users:owner",
      docs: {
        "packages:1": {
          _id: "packages:1",
          name: "@acme/demo-plugin",
          normalizedName: "@acme/demo-plugin",
          family: "code-plugin",
          ownerUserId: "users:owner",
          latestReleaseId: "packageReleases:1",
        },
        "packageReleases:1": {
          _id: "packageReleases:1",
          packageId: "packages:1",
          version: "1.0.0",
        },
      },
    });

    const result = await requestPackageRescanForUserInternalHandler(ctx, {
      actorUserId: "users:owner",
      name: "@acme/demo-plugin",
      version: "1.0.0",
    });

    expect(result).toMatchObject({
      packageReleaseId: "packageReleases:1",
      jobId: "securityScanJobs:1",
      alreadyQueued: false,
    });
    expect(inserts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "auditLogs",
          doc: expect.objectContaining({
            actorUserId: "users:owner",
            action: "package.clawscan.rescan",
          }),
        }),
      ]),
    );
  });

  it("rejects unrelated package rescan callers", async () => {
    const { ctx, insert } = makeRescanCtx({
      actorId: "users:random",
      actorRole: "user",
      docs: {
        "packages:1": {
          _id: "packages:1",
          name: "@acme/demo-plugin",
          normalizedName: "@acme/demo-plugin",
          family: "plugin",
          ownerUserId: "users:owner",
          latestReleaseId: "packageReleases:1",
        },
        "packageReleases:1": {
          _id: "packageReleases:1",
          packageId: "packages:1",
          version: "1.0.0",
        },
      },
    });

    await expect(
      requestPackageRescanHandler(ctx, {
        packageId: "packages:1",
      }),
    ).rejects.toThrow("Forbidden");
    expect(insert).not.toHaveBeenCalled();
  });

  it("fails claimed jobs when an artifact file URL is unavailable", async () => {
    vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", "worker-secret");

    const runMutation = vi.fn(async (_ref: unknown, args: Record<string, unknown>) => {
      if ("limit" in args) return [claimedJob];
      return { ok: true };
    });
    const runQuery = vi.fn(async (_ref: unknown, args: Record<string, unknown>) => {
      if ("jobId" in args) {
        return {
          version: {
            _id: "skillVersions:1",
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
        };
      }
      if ("skillVersionId" in args) return [];
      throw new Error(`Unexpected query args: ${JSON.stringify(args)}`);
    });
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

  it("omits generated Skill Card files from claimed skill scan files", async () => {
    vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", "worker-secret");

    const runMutation = vi.fn(async (_ref: unknown, args: Record<string, unknown>) => {
      if ("limit" in args) return [claimedJob];
      return { ok: true };
    });
    const runQuery = vi.fn(async (_ref: unknown, args: Record<string, unknown>) => {
      if ("jobId" in args) {
        return {
          job: claimedJob,
          skill: {
            _id: "skills:1",
            slug: "demo",
          },
          version: {
            _id: "skillVersions:1",
            files: [
              {
                path: "SKILL.md",
                size: 12,
                sha256: "a".repeat(64),
                storageId: "storage:skill",
                contentType: "text/markdown",
              },
              {
                path: "skill-card.md",
                size: 24,
                sha256: "b".repeat(64),
                storageId: "storage:card",
                contentType: "text/markdown",
              },
            ],
          },
        };
      }
      if ("skillVersionId" in args) {
        return [{ fingerprint: "bundle-fingerprint", kind: "generated-bundle" }];
      }
      throw new Error(`Unexpected query args: ${JSON.stringify(args)}`);
    });
    const getUrl = vi.fn(async (storageId: string) => `https://storage.example/${storageId}`);

    const result = (await claimCodexScanJobsHandler(
      { runMutation, runQuery, storage: { getUrl } },
      { token: "worker-secret", workerId: "worker-1", limit: 10 },
    )) as Array<{ target: { files: Array<{ path: string }> } }>;

    expect(result[0]?.target.files.map((file) => file.path)).toEqual(["SKILL.md"]);
    expect(getUrl).toHaveBeenCalledWith("storage:skill");
    expect(getUrl).not.toHaveBeenCalledWith("storage:card");
  });

  it("keeps publisher-authored Skill Card files in claimed skill scans", async () => {
    vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", "worker-secret");

    const runMutation = vi.fn(async (_ref: unknown, args: Record<string, unknown>) => {
      if ("limit" in args) return [claimedJob];
      return { ok: true };
    });
    const runQuery = vi.fn(async (_ref: unknown, args: Record<string, unknown>) => {
      if ("jobId" in args) {
        return {
          job: claimedJob,
          skill: {
            _id: "skills:1",
            slug: "demo",
          },
          version: {
            _id: "skillVersions:1",
            files: [
              {
                path: "SKILL.md",
                size: 12,
                sha256: "a".repeat(64),
                storageId: "storage:skill",
                contentType: "text/markdown",
              },
              {
                path: "skill-card.md",
                size: 24,
                sha256: "b".repeat(64),
                storageId: "storage:card",
                contentType: "text/markdown",
              },
            ],
          },
        };
      }
      if ("skillVersionId" in args) return [];
      throw new Error(`Unexpected query args: ${JSON.stringify(args)}`);
    });
    const getUrl = vi.fn(async (storageId: string) => `https://storage.example/${storageId}`);

    const result = (await claimCodexScanJobsHandler(
      { runMutation, runQuery, storage: { getUrl } },
      { token: "worker-secret", workerId: "worker-1", limit: 10 },
    )) as Array<{ target: { files: Array<{ path: string }> } }>;

    expect(result[0]?.target.files.map((file) => file.path)).toEqual(["SKILL.md", "skill-card.md"]);
    expect(getUrl).toHaveBeenCalledWith("storage:skill");
    expect(getUrl).toHaveBeenCalledWith("storage:card");
  });

  it("clears only queued backfill jobs in local dev", async () => {
    vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", "local-dev-worker-token");
    const jobs = [
      makeScanJob({ _id: "securityScanJobs:backfill-1", source: "backfill" }),
      makeScanJob({ _id: "securityScanJobs:backfill-2", source: "backfill" }),
    ];
    const deleted: string[] = [];
    const take = vi.fn(async () => jobs);
    const order = vi.fn(() => ({ take }));
    const indexBuilder = {
      eq: vi.fn(() => indexBuilder),
    };
    const withIndex = vi.fn(
      (indexName: string, buildRange: (q: typeof indexBuilder) => unknown) => {
        expect(indexName).toBe("by_status_source_created_at");
        buildRange(indexBuilder);
        expect(indexBuilder.eq).toHaveBeenCalledWith("status", "queued");
        expect(indexBuilder.eq).toHaveBeenCalledWith("source", "backfill");
        return { order };
      },
    );
    const ctx = {
      db: {
        query: vi.fn((tableName: string) => {
          expect(tableName).toBe("securityScanJobs");
          return { withIndex };
        }),
        insert: vi.fn(async () => "noop"),
        patch: vi.fn(async () => undefined),
        replace: vi.fn(async () => undefined),
        delete: vi.fn(async (id: string) => {
          deleted.push(id);
        }),
        get: vi.fn(async () => null),
        normalizeId: vi.fn(() => null),
        system: {},
      },
    };

    const result = await clearQueuedBackfillJobsForLocalDevHandler(ctx as never, {});

    expect(result).toEqual({
      dryRun: false,
      matched: 2,
      deleted: 2,
      sampleDeletedJobIds: ["securityScanJobs:backfill-1", "securityScanJobs:backfill-2"],
    });
    expect(deleted).toEqual(["securityScanJobs:backfill-1", "securityScanJobs:backfill-2"]);
  });

  it("prunes expired uploaded scan request blobs without deleting published version files", async () => {
    const requests = [
      {
        _id: "skillScanRequests:upload",
        sourceKind: "upload",
        securityScanJobId: "securityScanJobs:upload",
        files: [{ storageId: "storage:upload-1" }, { storageId: "storage:upload-2" }],
      },
      {
        _id: "skillScanRequests:published",
        sourceKind: "published",
        securityScanJobId: "securityScanJobs:published",
        files: [{ storageId: "storage:published-version-file" }],
      },
    ];
    const deletedDocs: string[] = [];
    const deletedStorage: string[] = [];
    const take = vi.fn(async () => requests);
    const indexBuilder = {
      lt: vi.fn(() => indexBuilder),
    };
    const withIndex = vi.fn(
      (indexName: string, buildRange: (q: typeof indexBuilder) => unknown) => {
        expect(indexName).toBe("by_expires_at");
        buildRange(indexBuilder);
        expect(indexBuilder.lt).toHaveBeenCalledWith("expiresAt", expect.any(Number));
        return { take };
      },
    );
    const ctx = {
      db: {
        query: vi.fn((tableName: string) => {
          expect(tableName).toBe("skillScanRequests");
          return { withIndex };
        }),
        insert: vi.fn(async () => "noop"),
        patch: vi.fn(async () => undefined),
        replace: vi.fn(async () => undefined),
        get: vi.fn(async (id: string) => ({
          _id: id,
          targetKind: "skillScanRequest",
        })),
        delete: vi.fn(async (id: string) => {
          deletedDocs.push(id);
        }),
        normalizeId: vi.fn(() => null),
        system: {},
      },
      storage: {
        delete: vi.fn(async (id: string) => {
          deletedStorage.push(id);
        }),
      },
    };

    const result = await pruneExpiredSkillScanRequestsInternalHandler(ctx as never, {
      batchSize: 10,
    });

    expect(result).toEqual({
      ok: true,
      deletedRequests: 2,
      deletedJobs: 2,
      deletedFiles: 2,
      done: true,
    });
    expect(deletedStorage).toEqual(["storage:upload-1", "storage:upload-2"]);
    expect(deletedDocs).toEqual([
      "securityScanJobs:upload",
      "skillScanRequests:upload",
      "securityScanJobs:published",
      "skillScanRequests:published",
    ]);
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

  it("claims manual rescans and malicious signals before older publish backlog", async () => {
    const { ctx, patches } = makeClaimCtx([
      makeScanJob({
        _id: "securityScanJobs:old-publish",
        source: "publish",
        createdAt: 10,
        nextRunAt: 10,
      }),
      makeScanJob({
        _id: "securityScanJobs:older-vt-update",
        source: "vt-update",
        createdAt: 20,
        nextRunAt: 20,
      }),
      makeScanJob({
        _id: "securityScanJobs:malicious-publish",
        source: "publish",
        hasMaliciousSignal: true,
        createdAt: 30,
        nextRunAt: 30,
      }),
      makeScanJob({
        _id: "securityScanJobs:clawscan-note",
        source: "clawscan-note",
        createdAt: 40,
        nextRunAt: 40,
      }),
      makeScanJob({
        _id: "securityScanJobs:backfill",
        source: "backfill",
        createdAt: 50,
        nextRunAt: 50,
      }),
      makeScanJob({
        _id: "securityScanJobs:manual",
        source: "manual",
        priority: 100,
        createdAt: 1000,
        nextRunAt: 1000,
      }),
    ]);

    const claimed = await claimQueuedJobsInternalHandler(ctx, {
      workerId: "worker-1",
      limit: 4,
      leaseMs: 60_000,
    });

    expect(claimed.map((job) => job._id)).toEqual([
      "securityScanJobs:manual",
      "securityScanJobs:malicious-publish",
      "securityScanJobs:clawscan-note",
      "securityScanJobs:backfill",
    ]);
    expect(patches.map((entry) => entry.id)).toEqual(claimed.map((job) => job._id));
  });

  it("claims bulk rescans after every existing source", async () => {
    const { ctx } = makeClaimCtx([
      makeScanJob({
        _id: "securityScanJobs:bulk-rescan",
        source: "bulk-rescan",
        createdAt: 1,
        nextRunAt: 1,
      }),
      makeScanJob({
        _id: "securityScanJobs:publish",
        source: "publish",
        createdAt: 20,
        nextRunAt: 20,
      }),
      makeScanJob({
        _id: "securityScanJobs:vt-update",
        source: "vt-update",
        createdAt: 30,
        nextRunAt: 30,
      }),
      makeScanJob({
        _id: "securityScanJobs:clawscan-note",
        source: "clawscan-note",
        createdAt: 40,
        nextRunAt: 40,
      }),
      makeScanJob({
        _id: "securityScanJobs:backfill",
        source: "backfill",
        createdAt: 50,
        nextRunAt: 50,
      }),
      makeScanJob({
        _id: "securityScanJobs:manual",
        source: "manual",
        priority: 100,
        createdAt: 100,
        nextRunAt: 100,
      }),
    ]);

    const claimed = await claimQueuedJobsInternalHandler(ctx, {
      workerId: "worker-1",
      limit: 6,
      leaseMs: 60_000,
    });

    expect(claimed.map((job) => job._id)).toEqual([
      "securityScanJobs:manual",
      "securityScanJobs:clawscan-note",
      "securityScanJobs:backfill",
      "securityScanJobs:publish",
      "securityScanJobs:vt-update",
      "securityScanJobs:bulk-rescan",
    ]);
  });

  it("caps each Codex scan claim request", async () => {
    const { ctx } = makeClaimCtx(
      Array.from({ length: 600 }, (_, index) =>
        makeScanJob({
          _id: `securityScanJobs:manual-${index}`,
          source: "manual",
          priority: 100,
          createdAt: index,
          nextRunAt: index,
        }),
      ),
    );

    const claimed = await claimQueuedJobsInternalHandler(ctx, {
      workerId: "worker-1",
      limit: 10_000,
      leaseMs: 60_000,
    });

    expect(claimed).toHaveLength(512);
  });

  it("claims requested jobs even when many other scans are already active", async () => {
    const activeJobs = Array.from({ length: 80 }, (_, index) =>
      makeScanJob({
        _id: `securityScanJobs:running-${index}`,
        status: "running",
        leaseExpiresAt: Date.now() + 60_000,
        source: "bulk-rescan",
      }),
    );
    const queuedJobs = Array.from({ length: 3 }, (_, index) =>
      makeScanJob({
        _id: `securityScanJobs:manual-${index}`,
        source: "manual",
        priority: 100,
        createdAt: index,
        nextRunAt: index,
      }),
    );
    const { ctx } = makeClaimCtx([...activeJobs, ...queuedJobs]);

    const claimed = await claimQueuedJobsInternalHandler(ctx, {
      workerId: "worker-1",
      limit: 3,
      leaseMs: 60_000,
    });

    expect(claimed.map((job) => job._id)).toEqual([
      "securityScanJobs:manual-0",
      "securityScanJobs:manual-1",
      "securityScanJobs:manual-2",
    ]);
  });

  it("reports queued scan position for manual scan requests", async () => {
    const targetJob = makeScanJob({
      _id: "securityScanJobs:target",
      targetKind: "skillScanRequest",
      skillScanRequestId: "skillScanRequests:target",
      source: "manual",
      createdAt: 300,
      nextRunAt: 300,
    });
    const ctx = makeSkillScanStatusCtx({
      actor: { _id: "users:owner", role: "user" },
      request: {
        _id: "skillScanRequests:target",
        actorUserId: "users:owner",
        sourceKind: "upload",
        update: false,
        writtenBack: false,
        status: "queued",
        securityScanJobId: targetJob._id,
        files: [],
        expiresAt: 1000,
        createdAt: 300,
        updatedAt: 300,
      },
      jobs: [
        makeScanJob({
          _id: "securityScanJobs:older",
          source: "manual",
          createdAt: 100,
          nextRunAt: 100,
        }),
        makeScanJob({
          _id: "securityScanJobs:running",
          status: "running",
          source: "manual",
          createdAt: 200,
          nextRunAt: 200,
        }),
        targetJob,
        makeScanJob({
          _id: "securityScanJobs:bulk",
          source: "bulk-rescan",
          createdAt: 1,
          nextRunAt: 1,
        }),
      ],
    });

    const status = await getSkillScanRequestForUserInternalHandler(ctx, {
      actorUserId: "users:owner",
      scanId: "skillScanRequests:target",
    });

    expect(status.queue).toEqual({
      queuedAhead: 1,
      queuedAheadIsEstimate: false,
      position: 2,
      running: 1,
      runningIsEstimate: false,
      note: "Scans are asynchronous and may take time to complete.",
    });
  });

  it("uses claim-order tie-breaks for same-timestamp queued scan positions", async () => {
    const targetJob = makeScanJob({
      _id: "securityScanJobs:target",
      _creationTime: 2,
      targetKind: "skillScanRequest",
      skillScanRequestId: "skillScanRequests:target",
      source: "manual",
      createdAt: 300,
      nextRunAt: 300,
    });
    const ctx = makeSkillScanStatusCtx({
      actor: { _id: "users:owner", role: "user" },
      request: {
        _id: "skillScanRequests:target",
        actorUserId: "users:owner",
        sourceKind: "upload",
        update: false,
        writtenBack: false,
        status: "queued",
        securityScanJobId: targetJob._id,
        files: [],
        expiresAt: 1000,
        createdAt: 300,
        updatedAt: 300,
      },
      jobs: [
        makeScanJob({
          _id: "securityScanJobs:first",
          _creationTime: 1,
          source: "manual",
          createdAt: 300,
          nextRunAt: 300,
        }),
        targetJob,
        makeScanJob({
          _id: "securityScanJobs:last",
          _creationTime: 3,
          source: "manual",
          createdAt: 300,
          nextRunAt: 300,
        }),
      ],
    });

    const status = await getSkillScanRequestForUserInternalHandler(ctx, {
      actorUserId: "users:owner",
      scanId: "skillScanRequests:target",
    });

    expect(status.queue).toMatchObject({
      queuedAhead: 1,
      queuedAheadIsEstimate: false,
      position: 2,
    });
  });

  it("bounds large queue position scans and marks the count as estimated", async () => {
    const targetJob = makeScanJob({
      _id: "securityScanJobs:target",
      targetKind: "skillScanRequest",
      skillScanRequestId: "skillScanRequests:target",
      source: "manual",
      createdAt: 1_000,
      nextRunAt: 1_000,
    });
    const ctx = makeSkillScanStatusCtx({
      actor: { _id: "users:owner", role: "user" },
      request: {
        _id: "skillScanRequests:target",
        actorUserId: "users:owner",
        sourceKind: "upload",
        update: false,
        writtenBack: false,
        status: "queued",
        securityScanJobId: targetJob._id,
        files: [],
        expiresAt: 1000,
        createdAt: 1_000,
        updatedAt: 1_000,
      },
      jobs: [
        ...Array.from({ length: 300 }, (_, index) =>
          makeScanJob({
            _id: `securityScanJobs:older-${index}`,
            source: "manual",
            createdAt: index,
            nextRunAt: index,
          }),
        ),
        targetJob,
      ],
    });

    const status = await getSkillScanRequestForUserInternalHandler(ctx, {
      actorUserId: "users:owner",
      scanId: "skillScanRequests:target",
    });

    expect(status.queue).toEqual({
      queuedAhead: 250,
      queuedAheadIsEstimate: true,
      position: null,
      running: 0,
      runningIsEstimate: false,
      note: "Scans are asynchronous and may take time to complete.",
    });
  });

  it("caps SkillSpector findings before storing completed scan results", async () => {
    vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", "worker-secret");
    const longSnippet = "sensitive SkillSpector artifact text ".repeat(200);
    const runQuery = vi.fn(async () => ({
      job: {
        _id: "securityScanJobs:1",
        targetKind: "skillVersion",
        leaseToken: "lease-token",
      },
      version: {
        _id: "skillVersions:1",
      },
    }));
    const runMutation = vi.fn(async (_ref: unknown, _args: Record<string, unknown>) => ({
      ok: true,
    }));

    await completeCodexScanJobHandler(
      { runMutation, runQuery },
      {
        token: "worker-secret",
        jobId: "securityScanJobs:1",
        leaseToken: "lease-token",
        llmAnalysis: {
          status: "suspicious",
          checkedAt: 123,
        },
        skillSpectorAnalysis: {
          status: "suspicious",
          issueCount: 30,
          checkedAt: 123,
          issues: Array.from({ length: 30 }, (_, index) => ({
            issueId: `SDI-${index + 1}`,
            severity: "HIGH",
            explanation: `Issue ${index + 1}: ${longSnippet}`,
            finding: longSnippet,
            codeSnippet: longSnippet,
          })),
        },
      },
    );

    const skillSpectorCall = runMutation.mock.calls.find(
      ([, args]) => "skillSpectorAnalysis" in (args as Record<string, unknown>),
    );
    expect(skillSpectorCall).toBeDefined();
    if (!skillSpectorCall) throw new Error("Expected SkillSpector persistence call");
    const stored = skillSpectorCall[1].skillSpectorAnalysis as {
      issueCount: number;
      issues: Array<{ codeSnippet?: string; finding?: string }>;
    };
    expect(stored.issueCount).toBe(30);
    expect(stored.issues).toHaveLength(25);
    expect(stored.issues[0]?.codeSnippet).toContain("...[truncated ");
    expect(stored.issues[0]?.finding?.length).toBeLessThan(longSnippet.length);
  });

  it("persists an error ClawScan result when worker retries are exhausted", async () => {
    vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", "worker-secret");

    const runMutation = vi.fn(async (_ref: unknown, args: Record<string, unknown>) => {
      if ("error" in args) return { ok: true, retry: false };
      return { ok: true };
    });
    const runQuery = vi.fn(async () => ({
      job: {
        _id: "securityScanJobs:1",
        targetKind: "skillVersion",
      },
      version: {
        _id: "skillVersions:1",
      },
    }));

    const result = await failCodexScanJobHandler(
      { runMutation, runQuery },
      {
        token: "worker-secret",
        jobId: "securityScanJobs:1",
        leaseToken: "lease-token",
        error:
          "Download failed https://signed.example.invalid/file?token=secret Authorization: Bearer sk-short-secret OPENAI_API_KEY=sk-short-secret",
      },
    );

    expect(result).toEqual({ ok: true, retry: false });
    expect(runMutation).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        jobId: "securityScanJobs:1",
        leaseToken: "lease-token",
      }),
    );
    expect(runMutation).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        versionId: "skillVersions:1",
        moderationMode: "preserve",
        llmAnalysis: expect.objectContaining({
          confidence: "low",
          status: "error",
          summary: expect.stringContaining("could not complete"),
        }),
      }),
    );
    const llmAnalysis = runMutation.mock.calls[1]?.[1]?.llmAnalysis as
      | { findings?: string }
      | undefined;
    expect(llmAnalysis?.findings).toContain("Worker error");
    expect(llmAnalysis?.findings).not.toContain("token=secret");
    expect(llmAnalysis?.findings).not.toContain("sk-short-secret");
  });

  it("completes skill scans without directly enqueueing duplicate Skill Card jobs", async () => {
    vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", "worker-secret");

    const runQuery = vi.fn(async () => ({
      job: {
        _id: "securityScanJobs:1",
        targetKind: "skillVersion",
        leaseToken: "lease-token",
      },
      version: {
        _id: "skillVersions:1",
      },
    }));
    const runMutation = vi.fn(async () => ({ ok: true }));

    await completeCodexScanJobHandler(
      { runQuery, runMutation },
      {
        token: "worker-secret",
        jobId: "securityScanJobs:1",
        leaseToken: "lease-token",
        llmAnalysis: { status: "clean", checkedAt: 123 },
      },
    );

    expect(runMutation).toHaveBeenCalledTimes(2);
    expect(runMutation).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        versionId: "skillVersions:1",
        llmAnalysis: { status: "clean", checkedAt: 123 },
      }),
    );
    expect(runMutation).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        jobId: "securityScanJobs:1",
        leaseToken: "lease-token",
      }),
    );
  });

  it("preserves a prior blocking skill ClawScan verdict when worker retries are exhausted", async () => {
    vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", "worker-secret");

    const runMutation = vi.fn(async (_ref: unknown, args: Record<string, unknown>) => {
      if ("error" in args) return { ok: true, retry: false };
      return { ok: true };
    });
    const runQuery = vi.fn(async () => ({
      job: {
        _id: "securityScanJobs:1",
        targetKind: "skillVersion",
      },
      version: {
        _id: "skillVersions:1",
        llmAnalysis: {
          status: "suspicious",
          checkedAt: 123,
        },
      },
    }));

    const result = await failCodexScanJobHandler(
      { runMutation, runQuery },
      {
        token: "worker-secret",
        jobId: "securityScanJobs:1",
        leaseToken: "lease-token",
        error: "Codex worker failed",
      },
    );

    expect(result).toEqual({ ok: true, retry: false });
    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        jobId: "securityScanJobs:1",
        leaseToken: "lease-token",
      }),
    );
  });

  it("preserves a prior blocking package ClawScan verdict when worker retries are exhausted", async () => {
    vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", "worker-secret");

    const runMutation = vi.fn(async (_ref: unknown, args: Record<string, unknown>) => {
      if ("error" in args) return { ok: true, retry: false };
      return { ok: true };
    });
    const runQuery = vi.fn(async () => ({
      job: {
        _id: "securityScanJobs:1",
        targetKind: "packageRelease",
      },
      release: {
        _id: "packageReleases:1",
        llmAnalysis: {
          status: "error",
          verdict: "malicious",
          checkedAt: 123,
        },
      },
    }));

    const result = await failCodexScanJobHandler(
      { runMutation, runQuery },
      {
        token: "worker-secret",
        jobId: "securityScanJobs:1",
        leaseToken: "lease-token",
        error: "Codex worker failed",
      },
    );

    expect(result).toEqual({ ok: true, retry: false });
    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        jobId: "securityScanJobs:1",
        leaseToken: "lease-token",
      }),
    );
  });

  it("preserves a prior clean package ClawScan verdict when worker retries are exhausted", async () => {
    vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", "worker-secret");

    const runMutation = vi.fn(async (_ref: unknown, args: Record<string, unknown>) => {
      if ("error" in args) return { ok: true, retry: false };
      return { ok: true };
    });
    const runQuery = vi.fn(async () => ({
      job: {
        _id: "securityScanJobs:1",
        targetKind: "packageRelease",
      },
      release: {
        _id: "packageReleases:1",
        llmAnalysis: {
          status: "clean",
          verdict: "benign",
          checkedAt: 123,
        },
      },
    }));

    const result = await failCodexScanJobHandler(
      { runMutation, runQuery },
      {
        token: "worker-secret",
        jobId: "securityScanJobs:1",
        leaseToken: "lease-token",
        error: "Codex worker failed",
      },
    );

    expect(result).toEqual({ ok: true, retry: false });
    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        jobId: "securityScanJobs:1",
        leaseToken: "lease-token",
      }),
    );
  });

  it("dry-runs queued vt-update jobs without deleting", async () => {
    const job = makeScanJob({ _id: "securityScanJobs:dry-run" });
    const { ctx, deleteDoc, take } = makeCancelCtx(
      [job],
      new Map<string, unknown>([["skillVersions:dry-run", makeTarget("clean")]]),
    );

    const result = await cancelQueuedVtUpdateJobsInternalHandler(ctx, {
      dryRun: true,
      createdBefore: 1000,
    });

    expect(take).toHaveBeenCalledWith(1000);
    expect(result).toMatchObject({
      dryRun: true,
      scanned: 1,
      matched: 1,
      wouldDelete: 1,
      deleted: 0,
      oldestScannedCreatedAt: 50,
      newestScannedCreatedAt: 50,
      oldestScannedNextRunAt: 100,
      newestScannedNextRunAt: 100,
      skippedByReason: {},
      sampleMatchedJobIds: ["securityScanJobs:dry-run"],
      sampleDeletedJobIds: [],
    });
    expect(deleteDoc).not.toHaveBeenCalled();
  });

  it("deletes all queued vt-update jobs while preserving other sources and running jobs", async () => {
    const jobs = [
      makeScanJob({ _id: "securityScanJobs:clean" }),
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
      makeScanJob({ _id: "securityScanJobs:vt-mismatch" }),
      makeScanJob({ _id: "securityScanJobs:no-llm" }),
      makeScanJob({ _id: "securityScanJobs:publish", source: "publish" }),
      makeScanJob({ _id: "securityScanJobs:manual", source: "manual" }),
      makeScanJob({ _id: "securityScanJobs:clawscan-note", source: "clawscan-note" }),
      makeScanJob({ _id: "securityScanJobs:backfill", source: "backfill" }),
      makeScanJob({ _id: "securityScanJobs:running", status: "running" }),
    ];
    const { ctx, deleted, get } = makeCancelCtx(
      jobs,
      new Map<string, unknown>([
        ["skillVersions:clean", makeTarget("clean")],
        ["packageReleases:package", makeTarget("clean")],
        ["skillVersions:malicious-signal", makeTarget("clean")],
        ["skillVersions:vt-mismatch", makeTarget("clean")],
        ["skillVersions:no-llm", makeTarget()],
        ["skillVersions:running", makeTarget("clean")],
      ]),
    );

    const result = await cancelQueuedVtUpdateJobsInternalHandler(ctx, {
      dryRun: false,
      createdBefore: 1000,
      scanLimit: 25,
      deleteLimit: 10,
    });

    expect(deleted).toEqual([
      "securityScanJobs:clean",
      "securityScanJobs:package",
      "securityScanJobs:vt-mismatch",
    ]);
    expect(get).toHaveBeenCalled();
    expect(result).toMatchObject({
      dryRun: false,
      scanned: 10,
      matched: 3,
      wouldDelete: 3,
      deleted: 3,
      skippedByReason: {
        "not-vt-update": 4,
        "not-queued-vt-update": 1,
        "malicious-signal": 1,
        "missing-llm-analysis": 1,
      },
      sampleMatchedJobIds: [
        "securityScanJobs:clean",
        "securityScanJobs:package",
        "securityScanJobs:vt-mismatch",
      ],
      sampleDeletedJobIds: [
        "securityScanJobs:clean",
        "securityScanJobs:package",
        "securityScanJobs:vt-mismatch",
      ],
    });
  });

  it("counts matched jobs beyond the per-run delete limit without deleting them", async () => {
    const jobs = [
      makeScanJob({ _id: "securityScanJobs:first" }),
      makeScanJob({ _id: "securityScanJobs:second" }),
    ];
    const { ctx, deleted } = makeCancelCtx(
      jobs,
      new Map<string, unknown>([
        ["skillVersions:first", makeTarget("clean")],
        ["skillVersions:second", makeTarget("clean")],
      ]),
    );

    const result = await cancelQueuedVtUpdateJobsInternalHandler(ctx, {
      dryRun: false,
      createdBefore: 1000,
      deleteLimit: 1,
    });

    expect(deleted).toEqual(["securityScanJobs:first"]);
    expect(result).toMatchObject({
      scanned: 2,
      matched: 2,
      wouldDelete: 1,
      deleted: 1,
      skippedByReason: {
        "delete-limit-reached": 1,
      },
      sampleMatchedJobIds: ["securityScanJobs:first", "securityScanJobs:second"],
      sampleDeletedJobIds: ["securityScanJobs:first"],
    });
  });
});
