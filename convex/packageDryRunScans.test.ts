/* @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireUser } from "./lib/access";
import { runPackageDryRunFilesystemScan } from "./lib/packageDryRunFilesystemScan";
import {
  claimPackageDryRunScanResultsInternal,
  completePackageDryRunScanResultInternal,
  createPackageDryRunScanJob,
  createPackageDryRunScanJobForUserInternal,
  enqueuePackageDryRunScanJobTargetsInternal,
  failPackageDryRunScanJobInternal,
  failPackageDryRunScanResultInternal,
  finalizePackageDryRunScanJobInternal,
  getPackageDryRunScanInputInternal,
  getPackageDryRunScanJobForUserInternal,
  listPackageDryRunScanResultsForUserInternal,
  processPackageDryRunScanJobBatchInternal,
  prunePackageDryRunScansInternal,
  skipPackageDryRunScanResultInternal,
} from "./packageDryRunScans";

vi.mock("./lib/access", () => ({
  requireUser: vi.fn(),
  assertAdmin: (user: { role?: string }) => {
    if (user.role !== "admin") throw new Error("Forbidden");
  },
}));
vi.mock("./lib/packageDryRunFilesystemScan", () => ({
  runPackageDryRunFilesystemScan: vi.fn(),
}));

type WrappedHandler<TArgs, TResult = unknown> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

type PackageDryRunScanJob = {
  _id: string;
  scanner: string;
  status: "queued" | "running" | "completed" | "failed";
  selector:
    | { kind: "releaseIds"; releaseIds: string[] }
    | { kind: "packageNames"; packageNames: string[] }
    | { kind: "latestActive"; limit: number }
    | { kind: "allActive" }
    | { kind: "seededSample"; seed: string; limit: number; maxCandidates: number };
  requestedByUserId: string;
  totalItems: number;
  queuedItems: number;
  runningItems: number;
  completedItems: number;
  failedItems: number;
  skippedItems: number;
  matchedItems: number;
  cursor?: string | null;
  targetSelectionDone?: boolean;
  candidateLimitReached?: boolean;
  staleRecheckAt?: number;
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
};

type PackageDryRunScanResult = {
  _id: string;
  jobId: string;
  releaseId: string;
  packageId: string;
  status: "queued" | "running" | "completed" | "failed" | "skipped";
  packageName: string;
  packageDisplayName: string;
  version: string;
  rawFsUsageCount: number;
  fsSafeUsageCount: number;
  findings: unknown[];
  errors: string[];
  claimToken?: string;
  leaseExpiresAt?: number;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: { status: "clean" | "suspicious" | "malicious"; summary: string };
  skippedReason?: string;
  error?: string;
};

const createJobHandler = (
  createPackageDryRunScanJob as unknown as WrappedHandler<
    {
      selector:
        | { kind: "releaseIds"; releaseIds: string[] }
        | { kind: "packageNames"; packageNames: string[] }
        | { kind: "latestActive"; limit: number }
        | { kind: "allActive" }
        | { kind: "seededSample"; seed: string; limit: number; maxCandidates: number };
    },
    {
      jobId: string;
      status: string;
      totalItems: number;
      targetSelectionDone: boolean;
      candidateLimitReached?: boolean;
    }
  >
)._handler;
const createJobForUserHandler = (
  createPackageDryRunScanJobForUserInternal as unknown as WrappedHandler<{
    actorUserId: string;
    selector:
      | { kind: "releaseIds"; releaseIds: string[] }
      | { kind: "packageNames"; packageNames: string[] }
      | { kind: "latestActive"; limit: number }
      | { kind: "allActive" }
      | { kind: "seededSample"; seed: string; limit: number; maxCandidates: number };
  }>
)._handler;
const getJobForUserHandler = (
  getPackageDryRunScanJobForUserInternal as unknown as WrappedHandler<{
    actorUserId: string;
    jobId: string;
  }>
)._handler;
const processBatchHandler = (
  processPackageDryRunScanJobBatchInternal as unknown as WrappedHandler<{
    jobId: string;
    batchSize?: number;
  }>
)._handler;
const enqueueTargetsHandler = (
  enqueuePackageDryRunScanJobTargetsInternal as unknown as WrappedHandler<{ jobId: string }>
)._handler;
const failResultHandler = (
  failPackageDryRunScanResultInternal as unknown as WrappedHandler<{
    itemId: string;
    claimToken: string;
    error: string;
  }>
)._handler;
const skipResultHandler = (
  skipPackageDryRunScanResultInternal as unknown as WrappedHandler<{
    itemId: string;
    claimToken: string;
    reason: string;
  }>
)._handler;
const failJobHandler = (
  failPackageDryRunScanJobInternal as unknown as WrappedHandler<{
    jobId: string;
    error: string;
  }>
)._handler;
const completeResultHandler = (
  completePackageDryRunScanResultInternal as unknown as WrappedHandler<{
    itemId: string;
    claimToken: string;
    result: {
      rawFsUsage: {
        reasonCode: string;
        totalCount: number;
        returnedCount: number;
        omittedCount: number;
        truncatedEvidenceCount: number;
        evidence: unknown[];
      };
      fsSafeUsage: {
        reasonCode: string;
        totalCount: number;
        returnedCount: number;
        omittedCount: number;
        truncatedEvidenceCount: number;
        evidence: unknown[];
      };
    };
  }>
)._handler;
const claimResultsHandler = (
  claimPackageDryRunScanResultsInternal as unknown as WrappedHandler<
    {
      jobId: string;
      batchSize?: number;
    },
    Array<{ itemId: string }>
  >
)._handler;
const pruneJobsHandler = (
  prunePackageDryRunScansInternal as unknown as WrappedHandler<{
    jobBatchSize?: number;
    resultBatchSize?: number;
  }>
)._handler;
const getScanInputHandler = (
  getPackageDryRunScanInputInternal as unknown as WrappedHandler<{ releaseId: string }>
)._handler;
const finalizeJobHandler = (
  finalizePackageDryRunScanJobInternal as unknown as WrappedHandler<{ jobId: string }>
)._handler;
const listResultsHandler = (
  listPackageDryRunScanResultsForUserInternal as unknown as WrappedHandler<
    {
      actorUserId: string;
      jobId: string;
      cursor: string | null;
      limit: number;
    },
    {
      items: Array<{ itemId: string; status: string }>;
    }
  >
)._handler;

function chainEq(constraints: Record<string, unknown>) {
  return {
    eq(field: string, value: unknown) {
      constraints[field] = value;
      return chainEq(constraints);
    },
    lte(field: string, value: unknown) {
      constraints[field] = value;
      return chainEq(constraints);
    },
  };
}

function matches(doc: Record<string, unknown>, constraints: Record<string, unknown>) {
  return Object.entries(constraints).every(([key, value]) => {
    if (key === "leaseExpiresAt" || key === "expiresAt") {
      return typeof doc[key] === "number" && typeof value === "number" && doc[key] <= value;
    }
    return doc[key] === value;
  });
}

function createDb() {
  const now = 1_700_000_000_000;
  const packages = new Map([
    [
      "packages:demo",
      {
        _id: "packages:demo",
        name: "demo-plugin",
        normalizedName: "demo-plugin",
        displayName: "Demo Plugin",
        summary: "A demo package",
        family: "code-plugin",
        latestReleaseId: "packageReleases:demo",
        softDeletedAt: undefined,
      },
    ],
  ]);
  const releases = new Map([
    [
      "packageReleases:demo",
      {
        _id: "packageReleases:demo",
        packageId: "packages:demo",
        version: "1.0.0",
        files: [],
        extractedPackageJson: { name: "demo-plugin" },
        extractedPluginManifest: { id: "demo-plugin" },
        normalizedBundleManifest: undefined,
        source: { kind: "test" },
        softDeletedAt: undefined,
        createdAt: now,
      },
    ],
  ]);
  const jobs: PackageDryRunScanJob[] = [];
  const items: PackageDryRunScanResult[] = [];

  const db = {
    get: vi.fn(async (id: string) => {
      if (id === "users:admin") return { _id: id, role: "admin" };
      if (id === "users:moderator") return { _id: id, role: "moderator" };
      if (id === "users:deactivated") {
        return { _id: id, role: "admin", deactivatedAt: 1_700_000_000_000 };
      }
      if (packages.has(id)) return packages.get(id);
      if (releases.has(id)) return releases.get(id);
      return jobs.find((job) => job._id === id) ?? items.find((item) => item._id === id) ?? null;
    }),
    insert: vi.fn(async (table: string, doc: Record<string, unknown>) => {
      if (table === "packageDryRunScanJobs") {
        const job = { _id: `packageDryRunScanJobs:${jobs.length + 1}`, ...doc };
        jobs.push(job as PackageDryRunScanJob);
        return job._id;
      }
      if (table === "packageDryRunScanResults") {
        const item = { _id: `packageDryRunScanResults:${items.length + 1}`, ...doc };
        items.push(item as PackageDryRunScanResult);
        return item._id;
      }
      throw new Error(`unexpected insert ${table}`);
    }),
    patch: vi.fn(async (id: string, patch: Record<string, unknown>) => {
      const job = jobs.find((candidate) => candidate._id === id);
      if (job) {
        Object.assign(job, patch);
        return;
      }
      const item = items.find((candidate) => candidate._id === id);
      if (item) {
        Object.assign(item, patch);
        return;
      }
      throw new Error(`unexpected patch ${id}`);
    }),
    delete: vi.fn(async (id: string) => {
      const jobIndex = jobs.findIndex((candidate) => candidate._id === id);
      if (jobIndex >= 0) {
        jobs.splice(jobIndex, 1);
        return;
      }
      const itemIndex = items.findIndex((candidate) => candidate._id === id);
      if (itemIndex >= 0) {
        items.splice(itemIndex, 1);
        return;
      }
      throw new Error(`unexpected delete ${id}`);
    }),
    query: vi.fn((table: string) => {
      if (table === "packageDryRunScanJobs") {
        return {
          withIndex: (_name: string, build: (q: ReturnType<typeof chainEq>) => unknown) => {
            const constraints: Record<string, unknown> = {};
            build(chainEq(constraints));
            return {
              take: async (limit: number) =>
                jobs
                  .filter((job) => {
                    const expiresAt = constraints.expiresAt;
                    const expiresAtMatches =
                      typeof expiresAt === "number" ? job.expiresAt <= expiresAt : true;
                    const statusMatches =
                      typeof constraints.status === "string"
                        ? job.status === constraints.status
                        : true;
                    return expiresAtMatches && statusMatches;
                  })
                  .slice(0, limit),
            };
          },
        };
      }
      if (table === "packageDryRunScanResults") {
        return {
          withIndex: (name: string, build: (q: ReturnType<typeof chainEq>) => unknown) => {
            const constraints: Record<string, unknown> = {};
            build(chainEq(constraints));
            const matched = items
              .filter((item) => matches(item as unknown as Record<string, unknown>, constraints))
              .sort((left, right) => {
                if (name !== "by_job_status_lease") return 0;
                const leftLease = left.leaseExpiresAt ?? Number.NEGATIVE_INFINITY;
                const rightLease = right.leaseExpiresAt ?? Number.NEGATIVE_INFINITY;
                return leftLease - rightLease;
              });
            return {
              take: async (limit: number) => matched.slice(0, limit),
              unique: async () => {
                if (matched.length > 1) throw new Error("expected unique result");
                return matched[0] ?? null;
              },
              paginate: async ({
                cursor,
                numItems,
              }: {
                cursor: string | null;
                numItems: number;
              }) => {
                const start = cursor ? Number.parseInt(cursor, 10) : 0;
                const page = matched.slice(start, start + numItems);
                const next = start + page.length;
                return {
                  page,
                  isDone: next >= matched.length,
                  continueCursor: next >= matched.length ? "" : String(next),
                };
              },
              order: () => ({
                take: async (limit: number) => matched.slice(0, limit),
              }),
            };
          },
        };
      }
      if (table === "packageReleases") {
        const orderedReleases = () =>
          [...releases.values()].sort(
            (left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0),
          );
        return {
          withIndex: () => ({
            order: () => ({
              take: async (limit: number) => orderedReleases().slice(0, limit),
              paginate: async ({
                cursor,
                numItems,
              }: {
                cursor: string | null;
                numItems: number;
              }) => {
                const all = orderedReleases();
                const start = cursor ? Number.parseInt(cursor, 10) : 0;
                const page = all.slice(start, start + numItems);
                const next = start + page.length;
                return {
                  page,
                  isDone: next >= all.length,
                  continueCursor: next >= all.length ? null : String(next),
                };
              },
            }),
          }),
        };
      }
      if (table === "packages") {
        return {
          withIndex: (_name: string, build?: (q: ReturnType<typeof chainEq>) => unknown) => ({
            unique: async () => {
              const constraints: Record<string, unknown> = {};
              build?.(chainEq(constraints));
              return (
                [...packages.values()].find((pkg) =>
                  matches(pkg as unknown as Record<string, unknown>, constraints),
                ) ?? null
              );
            },
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
    normalizeId: vi.fn((table: string, id: string) => (id.startsWith(`${table}:`) ? id : null)),
  };

  return { db, jobs, items, packages, releases };
}

beforeEach(() => {
  vi.mocked(requireUser).mockReset();
  vi.mocked(runPackageDryRunFilesystemScan).mockReset();
  vi.mocked(requireUser).mockResolvedValue({
    userId: "users:admin",
    user: { _id: "users:admin", role: "admin" },
  } as never);
});

describe("package dry-run scan jobs", () => {
  it("lets admins create a queued dry-run scan job for explicit releases", async () => {
    const { db, jobs, items } = createDb();
    const scheduler = { runAfter: vi.fn(async (_delay: number, ..._args: unknown[]) => undefined) };

    const result = await createJobHandler({ db, scheduler } as never, {
      selector: { kind: "releaseIds", releaseIds: ["packageReleases:demo"] },
    });

    expect(result).toEqual({
      jobId: "packageDryRunScanJobs:1",
      status: "queued",
      totalItems: 1,
      targetSelectionDone: true,
    });
    expect(jobs[0]).toMatchObject({
      status: "queued",
      requestedByUserId: "users:admin",
      totalItems: 1,
      queuedItems: 1,
      targetSelectionDone: true,
    });
    expect(items[0]).toMatchObject({
      jobId: "packageDryRunScanJobs:1",
      releaseId: "packageReleases:demo",
      packageId: "packages:demo",
      status: "queued",
      packageName: "demo-plugin",
      version: "1.0.0",
    });
    expect(db.patch).not.toHaveBeenCalledWith(
      "packageReleases:demo",
      expect.objectContaining({ staticScan: expect.anything() }),
    );
    expect(db.patch).not.toHaveBeenCalledWith(
      "packages:demo",
      expect.objectContaining({ scanStatus: expect.anything() }),
    );
    expect(scheduler.runAfter).toHaveBeenCalledTimes(1);
  });

  it("rejects explicit release selections when any requested release is unresolved", async () => {
    const { db, items } = createDb();
    const scheduler = { runAfter: vi.fn(async () => undefined) };

    await expect(
      createJobHandler({ db, scheduler } as never, {
        selector: {
          kind: "releaseIds",
          releaseIds: ["packageReleases:demo", "packageReleases:missing"],
        },
      }),
    ).rejects.toThrow(
      "Dry-run scan selector could not resolve releaseIds: packageReleases:missing",
    );
    expect(items).toHaveLength(0);
    expect(scheduler.runAfter).not.toHaveBeenCalled();
  });

  it("forbids non-admin actors on internal dry-run scan entrypoints", async () => {
    const { db } = createDb();
    const scheduler = { runAfter: vi.fn(async () => undefined) };

    await expect(
      createJobForUserHandler({ db, scheduler } as never, {
        actorUserId: "users:moderator",
        selector: { kind: "releaseIds", releaseIds: ["packageReleases:demo"] },
      }),
    ).rejects.toThrow("Forbidden");
    await expect(
      getJobForUserHandler({ db } as never, {
        actorUserId: "users:moderator",
        jobId: "packageDryRunScanJobs:1",
      }),
    ).rejects.toThrow("Forbidden");
    await expect(
      listResultsHandler({ db } as never, {
        actorUserId: "users:deactivated",
        jobId: "packageDryRunScanJobs:1",
        cursor: null,
        limit: 10,
      }),
    ).rejects.toThrow("Unauthorized");
  });

  it("queues latest active package releases by release creation order with a bounded limit", async () => {
    const { db, items } = createDb();
    const scheduler = { runAfter: vi.fn(async (_delay: number, ..._args: unknown[]) => undefined) };

    const result = await createJobHandler({ db, scheduler } as never, {
      selector: { kind: "latestActive", limit: 1 },
    });

    expect(result).toMatchObject({
      jobId: "packageDryRunScanJobs:1",
      status: "queued",
      totalItems: 1,
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      releaseId: "packageReleases:demo",
      packageId: "packages:demo",
      status: "queued",
    });
    expect(db.query).toHaveBeenCalledWith("packageReleases");
  });

  it("skips older active package releases in latest-active and seeded selectors", async () => {
    const { db, packages, releases, items } = createDb();
    const scheduler = { runAfter: vi.fn(async (_delay: number, ..._args: unknown[]) => undefined) };
    packages.set("packages:versioned", {
      _id: "packages:versioned",
      name: "versioned-plugin",
      normalizedName: "versioned-plugin",
      displayName: "Versioned Plugin",
      summary: "A plugin package",
      family: "code-plugin",
      latestReleaseId: "packageReleases:versioned-new",
      softDeletedAt: undefined,
    });
    releases.set("packageReleases:versioned-old", {
      _id: "packageReleases:versioned-old",
      packageId: "packages:versioned",
      version: "1.0.0",
      files: [],
      extractedPackageJson: { name: "versioned-plugin" },
      extractedPluginManifest: { id: "versioned-plugin" },
      normalizedBundleManifest: undefined,
      source: { kind: "test" },
      softDeletedAt: undefined,
      createdAt: 1_700_000_020_000,
    });
    releases.set("packageReleases:versioned-new", {
      _id: "packageReleases:versioned-new",
      packageId: "packages:versioned",
      version: "2.0.0",
      files: [],
      extractedPackageJson: { name: "versioned-plugin" },
      extractedPluginManifest: { id: "versioned-plugin" },
      normalizedBundleManifest: undefined,
      source: { kind: "test" },
      softDeletedAt: undefined,
      createdAt: 1_700_000_000_050,
    });

    await createJobHandler({ db, scheduler } as never, {
      selector: { kind: "latestActive", limit: 2 },
    });
    await createJobHandler({ db, scheduler } as never, {
      selector: { kind: "seededSample", seed: "fs-safe-v1", limit: 2, maxCandidates: 10 },
    });

    expect(items.map((item) => item.releaseId)).not.toContain("packageReleases:versioned-old");
    expect(items.map((item) => item.releaseId)).toContain("packageReleases:versioned-new");
  });

  it("selects latest active release ties deterministically by release id", async () => {
    function addReleaseSet(state: ReturnType<typeof createDb>, releaseIds: readonly string[]) {
      for (const releaseId of releaseIds) {
        const suffix = releaseId.split(":").at(-1);
        const packageId = `packages:${suffix}`;
        state.packages.set(packageId, {
          _id: packageId,
          name: `plugin-${suffix}`,
          normalizedName: `plugin-${suffix}`,
          displayName: `Plugin ${suffix}`,
          summary: "A plugin package",
          family: "code-plugin",
          latestReleaseId: releaseId,
          softDeletedAt: undefined,
        });
        state.releases.set(releaseId, {
          _id: releaseId,
          packageId,
          version: "1.0.0",
          files: [],
          extractedPackageJson: { name: `plugin-${suffix}` },
          extractedPluginManifest: { id: `plugin-${suffix}` },
          normalizedBundleManifest: undefined,
          source: { kind: "test" },
          softDeletedAt: undefined,
          createdAt: 1_700_000_010_000,
        });
      }
    }

    const first = createDb();
    const second = createDb();
    addReleaseSet(first, ["packageReleases:c", "packageReleases:a", "packageReleases:b"]);
    addReleaseSet(second, ["packageReleases:b", "packageReleases:c", "packageReleases:a"]);
    const scheduler = { runAfter: vi.fn(async () => undefined) };

    await createJobHandler({ db: first.db, scheduler } as never, {
      selector: { kind: "latestActive", limit: 2 },
    });
    await createJobHandler({ db: second.db, scheduler } as never, {
      selector: { kind: "latestActive", limit: 2 },
    });

    expect(first.items.map((item) => item.releaseId)).toEqual([
      "packageReleases:a",
      "packageReleases:b",
    ]);
    expect(second.items.map((item) => item.releaseId)).toEqual([
      "packageReleases:a",
      "packageReleases:b",
    ]);
  });

  it("caps latest active selection pages inside job creation", async () => {
    const { db, packages, releases } = createDb();
    const scheduler = { runAfter: vi.fn(async () => undefined) };
    packages.set("packages:skill", {
      _id: "packages:skill",
      name: "demo-skill",
      normalizedName: "demo-skill",
      displayName: "Demo Skill",
      summary: "A skill package",
      family: "skill",
      latestReleaseId: "packageReleases:skill-0",
      softDeletedAt: undefined,
    });
    for (let index = 0; index < 1_001; index += 1) {
      releases.set(`packageReleases:skill-${index}`, {
        _id: `packageReleases:skill-${index}`,
        packageId: "packages:skill",
        version: `1.0.${index}`,
        files: [],
        extractedPackageJson: { name: "demo-skill" },
        extractedPluginManifest: { id: "demo-skill" },
        normalizedBundleManifest: undefined,
        source: { kind: "test" },
        softDeletedAt: undefined,
        createdAt: 1_700_000_010_000 - index,
      });
    }

    await expect(
      createJobHandler({ db, scheduler } as never, {
        selector: { kind: "latestActive", limit: 1 },
      }),
    ).rejects.toThrow(
      "Dry-run scan selector reached selection scan limit before collecting requested releases",
    );
    expect(db.get).toHaveBeenCalledWith("packages:skill");
    expect(db.get).not.toHaveBeenCalledWith("packageReleases:skill-1000");
    expect(scheduler.runAfter).not.toHaveBeenCalled();
  });

  it("accepts latest active selection when the capped page resolves the boundary", async () => {
    const { db, packages, releases, items } = createDb();
    const scheduler = { runAfter: vi.fn(async () => undefined) };
    packages.set("packages:skill", {
      _id: "packages:skill",
      name: "demo-skill",
      normalizedName: "demo-skill",
      displayName: "Demo Skill",
      summary: "A skill package",
      family: "skill",
      latestReleaseId: "packageReleases:skill-0",
      softDeletedAt: undefined,
    });
    for (const index of [
      ...Array.from({ length: 998 }, (_, value) => value),
      ...Array.from({ length: 102 }, (_, value) => value + 1_000),
    ]) {
      releases.set(`packageReleases:skill-${index}`, {
        _id: `packageReleases:skill-${index}`,
        packageId: "packages:skill",
        version: `1.0.${index}`,
        files: [],
        extractedPackageJson: { name: "demo-skill" },
        extractedPluginManifest: { id: "demo-skill" },
        normalizedBundleManifest: undefined,
        source: { kind: "test" },
        softDeletedAt: undefined,
        createdAt: 1_700_000_010_000 - index,
      });
    }
    packages.set("packages:boundary-a", {
      _id: "packages:boundary-a",
      name: "boundary-a",
      normalizedName: "boundary-a",
      displayName: "Boundary A",
      summary: "A plugin package",
      family: "code-plugin",
      latestReleaseId: "packageReleases:boundary-a",
      softDeletedAt: undefined,
    });
    packages.set("packages:boundary-b", {
      _id: "packages:boundary-b",
      name: "boundary-b",
      normalizedName: "boundary-b",
      displayName: "Boundary B",
      summary: "A plugin package",
      family: "code-plugin",
      latestReleaseId: "packageReleases:boundary-b",
      softDeletedAt: undefined,
    });
    releases.set("packageReleases:boundary-a", {
      _id: "packageReleases:boundary-a",
      packageId: "packages:boundary-a",
      version: "1.0.0",
      files: [],
      extractedPackageJson: { name: "boundary-a" },
      extractedPluginManifest: { id: "boundary-a" },
      normalizedBundleManifest: undefined,
      source: { kind: "test" },
      softDeletedAt: undefined,
      createdAt: 1_700_000_010_000 - 998,
    });
    releases.set("packageReleases:boundary-b", {
      _id: "packageReleases:boundary-b",
      packageId: "packages:boundary-b",
      version: "1.0.0",
      files: [],
      extractedPackageJson: { name: "boundary-b" },
      extractedPluginManifest: { id: "boundary-b" },
      normalizedBundleManifest: undefined,
      source: { kind: "test" },
      softDeletedAt: undefined,
      createdAt: 1_700_000_010_000 - 999,
    });

    const result = await createJobHandler({ db, scheduler } as never, {
      selector: { kind: "latestActive", limit: 1 },
    });

    expect(result).toMatchObject({ totalItems: 1 });
    expect(items.map((item) => item.releaseId)).toEqual(["packageReleases:boundary-a"]);
    expect(db.get).not.toHaveBeenCalledWith("packageReleases:boundary-a");
    expect(scheduler.runAfter).toHaveBeenCalledTimes(1);
  });

  it("rejects latest active selection when a capped tie boundary is unresolved", async () => {
    const { db, packages, releases } = createDb();
    const scheduler = { runAfter: vi.fn(async () => undefined) };
    for (let index = 0; index < 1_001; index += 1) {
      const releaseId = `packageReleases:tie-${index}`;
      const packageId = `packages:tie-${index}`;
      packages.set(packageId, {
        _id: packageId,
        name: `tie-plugin-${index}`,
        normalizedName: `tie-plugin-${index}`,
        displayName: `Tie Plugin ${index}`,
        summary: "A plugin package",
        family: "code-plugin",
        latestReleaseId: releaseId,
        softDeletedAt: undefined,
      });
      releases.set(releaseId, {
        _id: releaseId,
        packageId,
        version: "1.0.0",
        files: [],
        extractedPackageJson: { name: `tie-plugin-${index}` },
        extractedPluginManifest: { id: `tie-plugin-${index}` },
        normalizedBundleManifest: undefined,
        source: { kind: "test" },
        softDeletedAt: undefined,
        createdAt: 1_700_000_010_000,
      });
    }

    await expect(
      createJobHandler({ db, scheduler } as never, {
        selector: { kind: "latestActive", limit: 2 },
      }),
    ).rejects.toThrow(
      "Dry-run scan selector reached selection scan limit before resolving release ordering",
    );
    expect(scheduler.runAfter).not.toHaveBeenCalled();
  });

  it("reconciles outstanding counters when a job-level failure makes the job terminal", async () => {
    const { db, jobs, items } = createDb();
    jobs.push({
      _id: "packageDryRunScanJobs:1",
      scanner: "filesystem-safety-v1",
      selector: { kind: "releaseIds", releaseIds: ["packageReleases:demo"] },
      status: "running",
      requestedByUserId: "users:admin",
      totalItems: 2,
      queuedItems: 1,
      runningItems: 1,
      completedItems: 0,
      failedItems: 0,
      skippedItems: 0,
      matchedItems: 0,
      targetSelectionDone: true,
      expiresAt: 1_700_086_400_000,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    });
    items.push(
      {
        _id: "packageDryRunScanResults:queued",
        jobId: "packageDryRunScanJobs:1",
        releaseId: "packageReleases:demo",
        packageId: "packages:demo",
        packageName: "demo-plugin",
        packageDisplayName: "Demo Plugin",
        version: "1.0.0",
        status: "queued",
        rawFsUsageCount: 0,
        fsSafeUsageCount: 0,
        findings: [],
        errors: [],
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_000,
      },
      {
        _id: "packageDryRunScanResults:running",
        jobId: "packageDryRunScanJobs:1",
        releaseId: "packageReleases:demo-2",
        packageId: "packages:demo",
        packageName: "demo-plugin",
        packageDisplayName: "Demo Plugin",
        version: "1.0.1",
        status: "running",
        rawFsUsageCount: 0,
        fsSafeUsageCount: 0,
        findings: [],
        errors: [],
        claimToken: "claim",
        leaseExpiresAt: 1_700_000_600_000,
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_000,
      },
    );

    await failJobHandler({ db } as never, {
      jobId: "packageDryRunScanJobs:1",
      error: "worker unavailable",
    });

    expect(jobs[0]).toMatchObject({
      status: "failed",
      queuedItems: 0,
      runningItems: 0,
      failedItems: 2,
      error: "worker unavailable",
    });
    expect(jobs[0]?.expiresAt).toBeGreaterThan(1_700_086_400_000);

    const job = await getJobForUserHandler({ db } as never, {
      actorUserId: "users:admin",
      jobId: "packageDryRunScanJobs:1",
    });
    expect(job).toMatchObject({
      status: "failed",
      queuedItems: 0,
      runningItems: 0,
      failedItems: 2,
    });

    const results = await listResultsHandler({ db } as never, {
      actorUserId: "users:admin",
      jobId: "packageDryRunScanJobs:1",
      cursor: null,
      limit: 10,
    });
    expect(results.items).toEqual([
      expect.objectContaining({ itemId: "packageDryRunScanResults:queued", status: "failed" }),
      expect.objectContaining({ itemId: "packageDryRunScanResults:running", status: "failed" }),
    ]);
  });

  it("bounds persisted dry-run scan error messages", async () => {
    const { db, jobs, items } = createDb();
    const longError = "x".repeat(2_000);
    jobs.push({
      _id: "packageDryRunScanJobs:1",
      scanner: "filesystem-safety-v1",
      selector: { kind: "releaseIds", releaseIds: ["packageReleases:demo"] },
      status: "running",
      requestedByUserId: "users:admin",
      totalItems: 1,
      queuedItems: 0,
      runningItems: 1,
      completedItems: 0,
      failedItems: 0,
      skippedItems: 0,
      matchedItems: 0,
      targetSelectionDone: true,
      expiresAt: 1_700_086_400_000,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    });
    items.push({
      _id: "packageDryRunScanResults:1",
      jobId: "packageDryRunScanJobs:1",
      releaseId: "packageReleases:demo",
      packageId: "packages:demo",
      packageName: "demo-plugin",
      packageDisplayName: "Demo Plugin",
      version: "1.0.0",
      status: "running",
      rawFsUsageCount: 0,
      fsSafeUsageCount: 0,
      findings: [],
      errors: [],
      claimToken: "claim",
      leaseExpiresAt: 1_700_000_600_000,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    });

    await failResultHandler({ db } as never, {
      itemId: "packageDryRunScanResults:1",
      claimToken: "claim",
      error: longError,
    });
    await failJobHandler({ db } as never, {
      jobId: "packageDryRunScanJobs:1",
      error: longError,
    });

    expect(items[0]?.errors[0]).toHaveLength(1_024);
    expect(items[0]?.errors[0]).toMatch(/\.\.\.$/);
    expect(jobs[0]?.error).toHaveLength(1_024);
    expect(jobs[0]?.error).toMatch(/\.\.\.$/);
  });

  it("rejects direct Convex dry-run limits above the API maximum", async () => {
    const { db } = createDb();
    const scheduler = { runAfter: vi.fn(async () => undefined) };

    await expect(
      createJobHandler({ db, scheduler } as never, {
        selector: { kind: "latestActive", limit: 201 },
      }),
    ).rejects.toThrow("limit must be at most 200");
    await expect(
      createJobHandler({ db, scheduler } as never, {
        selector: { kind: "seededSample", seed: "fs-safe-v1", limit: 1, maxCandidates: 1_001 },
      }),
    ).rejects.toThrow("maxCandidates must be at most 1000");
    await expect(
      createJobHandler({ db, scheduler } as never, {
        selector: { kind: "seededSample", seed: "x".repeat(129), limit: 1, maxCandidates: 1 },
      }),
    ).rejects.toThrow("seed must be at most 128 characters");
  });

  it("rejects seeded sample candidate pools smaller than the requested limit", async () => {
    const { db } = createDb();
    const scheduler = { runAfter: vi.fn(async () => undefined) };

    await expect(
      createJobHandler({ db, scheduler } as never, {
        selector: { kind: "seededSample", seed: "fs-safe-v1", limit: 20, maxCandidates: 10 },
      }),
    ).rejects.toThrow("maxCandidates must be greater than or equal to limit");
  });

  it("queues latest releases for explicit package names", async () => {
    const { db, items } = createDb();
    const scheduler = { runAfter: vi.fn(async (_delay: number, ..._args: unknown[]) => undefined) };

    const result = await createJobHandler({ db, scheduler } as never, {
      selector: { kind: "packageNames", packageNames: ["demo-plugin"] },
    });

    expect(result).toMatchObject({
      jobId: "packageDryRunScanJobs:1",
      status: "queued",
      totalItems: 1,
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      releaseId: "packageReleases:demo",
      packageName: "demo-plugin",
      version: "1.0.0",
    });
  });

  it("rejects explicit package selections when any requested package is unresolved", async () => {
    const { db, items } = createDb();
    const scheduler = { runAfter: vi.fn(async () => undefined) };

    await expect(
      createJobHandler({ db, scheduler } as never, {
        selector: { kind: "packageNames", packageNames: ["demo-plugin", "missing-plugin"] },
      }),
    ).rejects.toThrow("Dry-run scan selector could not resolve packageNames: missing-plugin");
    expect(items).toHaveLength(0);
    expect(scheduler.runAfter).not.toHaveBeenCalled();
  });

  it("reports pending target selection when creating all-active jobs", async () => {
    const { db, jobs, items } = createDb();
    const scheduler = { runAfter: vi.fn(async (_delay: number, ..._args: unknown[]) => undefined) };

    const result = await createJobHandler({ db, scheduler } as never, {
      selector: { kind: "allActive" },
    });

    expect(result).toEqual({
      jobId: "packageDryRunScanJobs:1",
      status: "queued",
      totalItems: 0,
      targetSelectionDone: false,
    });
    expect(jobs[0]).toMatchObject({
      selector: { kind: "allActive" },
      targetSelectionDone: false,
      totalItems: 0,
      queuedItems: 0,
    });
    expect(items).toHaveLength(0);
    expect(scheduler.runAfter).toHaveBeenCalledTimes(1);
  });

  it("keeps failed all-active result exports partial when target selection did not finish", async () => {
    const { db, jobs } = createDb();
    jobs.push({
      _id: "packageDryRunScanJobs:1",
      scanner: "filesystem-safety-v1",
      selector: { kind: "allActive" },
      status: "failed",
      requestedByUserId: "users:admin",
      totalItems: 0,
      queuedItems: 0,
      runningItems: 0,
      completedItems: 0,
      failedItems: 0,
      skippedItems: 0,
      matchedItems: 0,
      targetSelectionDone: false,
      error: "target selection failed",
      expiresAt: 1_700_086_400_000,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_100,
      completedAt: 1_700_000_000_100,
    });

    const listed = await listResultsHandler({ db } as never, {
      actorUserId: "users:admin",
      jobId: "packageDryRunScanJobs:1",
      cursor: null,
      limit: 10,
    });

    expect(listed).toMatchObject({
      jobStatus: "failed",
      jobDone: true,
      partial: true,
      done: true,
      nextCursor: null,
      items: [],
    });
  });

  it("selects seeded samples repeatably and reports candidate pool truncation", async () => {
    const first = createDb();
    const second = createDb();
    for (const state of [first, second]) {
      state.packages.set("packages:other", {
        _id: "packages:other",
        name: "other-plugin",
        normalizedName: "other-plugin",
        displayName: "Other Plugin",
        summary: "Another package",
        family: "code-plugin",
        latestReleaseId: "packageReleases:other",
        softDeletedAt: undefined,
      });
      state.releases.set("packageReleases:other", {
        _id: "packageReleases:other",
        packageId: "packages:other",
        version: "1.0.0",
        files: [],
        extractedPackageJson: { name: "other-plugin" },
        extractedPluginManifest: { id: "other-plugin" },
        normalizedBundleManifest: undefined,
        source: { kind: "test" },
        softDeletedAt: undefined,
        createdAt: 1_700_000_000_100,
      });
      state.packages.set("packages:third", {
        _id: "packages:third",
        name: "third-plugin",
        normalizedName: "third-plugin",
        displayName: "Third Plugin",
        summary: "A third package",
        family: "code-plugin",
        latestReleaseId: "packageReleases:third",
        softDeletedAt: undefined,
      });
      state.releases.set("packageReleases:third", {
        _id: "packageReleases:third",
        packageId: "packages:third",
        version: "1.0.0",
        files: [],
        extractedPackageJson: { name: "third-plugin" },
        extractedPluginManifest: { id: "third-plugin" },
        normalizedBundleManifest: undefined,
        source: { kind: "test" },
        softDeletedAt: undefined,
        createdAt: 1_700_000_000_200,
      });
    }

    const scheduler = { runAfter: vi.fn(async (_delay: number, ..._args: unknown[]) => undefined) };
    const firstResult = await createJobHandler({ db: first.db, scheduler } as never, {
      selector: { kind: "seededSample", seed: "fs-safe-v1", limit: 1, maxCandidates: 2 },
    });
    const secondResult = await createJobHandler({ db: second.db, scheduler } as never, {
      selector: { kind: "seededSample", seed: "fs-safe-v1", limit: 1, maxCandidates: 2 },
    });

    expect(firstResult).toMatchObject({
      totalItems: 1,
      candidateLimitReached: true,
    });
    expect(secondResult).toMatchObject({
      totalItems: 1,
      candidateLimitReached: true,
    });
    expect(first.items.map((item) => item.releaseId)).toEqual(
      second.items.map((item) => item.releaseId),
    );
  });

  it("rejects seeded samples when the max-candidate boundary is unresolved", async () => {
    const { db, packages, releases } = createDb();
    const scheduler = { runAfter: vi.fn(async () => undefined) };
    for (let index = 0; index < 1_101; index += 1) {
      const releaseId = `packageReleases:sample-tie-${index}`;
      const packageId = `packages:sample-tie-${index}`;
      packages.set(packageId, {
        _id: packageId,
        name: `sample-tie-plugin-${index}`,
        normalizedName: `sample-tie-plugin-${index}`,
        displayName: `Sample Tie Plugin ${index}`,
        summary: "A plugin package",
        family: "code-plugin",
        latestReleaseId: releaseId,
        softDeletedAt: undefined,
      });
      releases.set(releaseId, {
        _id: releaseId,
        packageId,
        version: "1.0.0",
        files: [],
        extractedPackageJson: { name: `sample-tie-plugin-${index}` },
        extractedPluginManifest: { id: `sample-tie-plugin-${index}` },
        normalizedBundleManifest: undefined,
        source: { kind: "test" },
        softDeletedAt: undefined,
        createdAt: 1_700_000_010_000,
      });
    }

    await expect(
      createJobHandler({ db, scheduler } as never, {
        selector: { kind: "seededSample", seed: "fs-safe-v1", limit: 1, maxCandidates: 1_000 },
      }),
    ).rejects.toThrow(
      "Dry-run scan selector reached selection scan limit before resolving release ordering",
    );
    expect(scheduler.runAfter).not.toHaveBeenCalled();
  });

  it("rejects seeded samples when the candidate pool is truncated before max candidates", async () => {
    const { db, packages, releases } = createDb();
    const scheduler = { runAfter: vi.fn(async () => undefined) };
    packages.set("packages:eligible", {
      _id: "packages:eligible",
      name: "eligible-plugin",
      normalizedName: "eligible-plugin",
      displayName: "Eligible Plugin",
      summary: "A plugin package",
      family: "code-plugin",
      latestReleaseId: "packageReleases:eligible",
      softDeletedAt: undefined,
    });
    releases.set("packageReleases:eligible", {
      _id: "packageReleases:eligible",
      packageId: "packages:eligible",
      version: "1.0.0",
      files: [],
      extractedPackageJson: { name: "eligible-plugin" },
      extractedPluginManifest: { id: "eligible-plugin" },
      normalizedBundleManifest: undefined,
      source: { kind: "test" },
      softDeletedAt: undefined,
      createdAt: 1_700_000_020_000,
    });
    packages.set("packages:skill", {
      _id: "packages:skill",
      name: "sample-skill",
      normalizedName: "sample-skill",
      displayName: "Sample Skill",
      summary: "A skill package",
      family: "skill",
      latestReleaseId: "packageReleases:skill-0",
      softDeletedAt: undefined,
    });
    for (let index = 0; index < 1_101; index += 1) {
      releases.set(`packageReleases:skill-${index}`, {
        _id: `packageReleases:skill-${index}`,
        packageId: "packages:skill",
        version: `1.0.${index}`,
        files: [],
        extractedPackageJson: { name: "sample-skill" },
        extractedPluginManifest: { id: "sample-skill" },
        normalizedBundleManifest: undefined,
        source: { kind: "test" },
        softDeletedAt: undefined,
        createdAt: 1_700_000_019_000 - index,
      });
    }

    await expect(
      createJobHandler({ db, scheduler } as never, {
        selector: { kind: "seededSample", seed: "fs-safe-v1", limit: 1, maxCandidates: 1_000 },
      }),
    ).rejects.toThrow(
      "Dry-run scan selector reached selection scan limit before resolving release ordering",
    );
    expect(scheduler.runAfter).not.toHaveBeenCalled();
  });

  it("enqueues all-active scan targets in a bounded page", async () => {
    const { db, jobs, items } = createDb();
    jobs.push({
      _id: "packageDryRunScanJobs:1",
      scanner: "filesystem-safety-v1",
      selector: { kind: "allActive" },
      status: "queued",
      requestedByUserId: "users:admin",
      totalItems: 0,
      queuedItems: 0,
      runningItems: 0,
      completedItems: 0,
      failedItems: 0,
      skippedItems: 0,
      matchedItems: 0,
      cursor: null,
      targetSelectionDone: false,
      expiresAt: 1_700_086_400_000,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    });

    const result = await enqueueTargetsHandler({ db } as never, {
      jobId: "packageDryRunScanJobs:1",
    });

    expect(result).toEqual({ enqueued: 1, done: true, advanced: true });
    expect(jobs[0]).toMatchObject({
      totalItems: 1,
      queuedItems: 1,
      targetSelectionDone: true,
    });
    expect(items[0]).toMatchObject({
      jobId: "packageDryRunScanJobs:1",
      releaseId: "packageReleases:demo",
      status: "queued",
    });
  });

  it("does not enqueue duplicate all-active targets for the same job and release", async () => {
    const { db, jobs, items } = createDb();
    jobs.push({
      _id: "packageDryRunScanJobs:1",
      scanner: "filesystem-safety-v1",
      selector: { kind: "allActive" },
      status: "queued",
      requestedByUserId: "users:admin",
      totalItems: 1,
      queuedItems: 1,
      runningItems: 0,
      completedItems: 0,
      failedItems: 0,
      skippedItems: 0,
      matchedItems: 0,
      cursor: null,
      targetSelectionDone: false,
      expiresAt: 1_700_086_400_000,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    });
    items.push({
      _id: "packageDryRunScanResults:1",
      jobId: "packageDryRunScanJobs:1",
      releaseId: "packageReleases:demo",
      packageId: "packages:demo",
      packageName: "demo-plugin",
      packageDisplayName: "Demo Plugin",
      version: "1.0.0",
      status: "queued",
      rawFsUsageCount: 0,
      fsSafeUsageCount: 0,
      findings: [],
      errors: [],
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    });

    const result = await enqueueTargetsHandler({ db } as never, {
      jobId: "packageDryRunScanJobs:1",
    });

    expect(result).toEqual({ enqueued: 0, done: true, advanced: true });
    expect(items).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      totalItems: 1,
      queuedItems: 1,
      targetSelectionDone: true,
    });
  });

  it("creates, processes, and lists an all-active dry-run scan through the job handlers", async () => {
    vi.mocked(runPackageDryRunFilesystemScan).mockResolvedValue({
      rawFsUsage: {
        reasonCode: "info.filesystem.raw_fs_api_usage",
        totalCount: 1,
        returnedCount: 1,
        omittedCount: 0,
        truncatedEvidenceCount: 0,
        evidence: [
          {
            code: "info.filesystem.raw_fs_api_usage",
            severity: "info",
            file: "dist/index.js",
            line: 1,
            message: "Raw Node filesystem API usage detected.",
            evidence: "import fs from 'node:fs';",
            evidenceTruncated: false,
          },
        ],
      },
      fsSafeUsage: {
        reasonCode: "info.filesystem.fs_safe_usage",
        totalCount: 0,
        returnedCount: 0,
        omittedCount: 0,
        truncatedEvidenceCount: 0,
        evidence: [],
      },
    });
    const { db, jobs, items } = createDb();
    const scheduler = { runAfter: vi.fn(async () => undefined) };

    const created = await createJobHandler({ db, scheduler } as never, {
      selector: { kind: "allActive" },
    });

    let jobOnlyMutationCalls = 0;
    const runMutation = vi.fn(async (_ref: unknown, args: Record<string, unknown>) => {
      if (args.jobId === created.jobId && Object.keys(args).length === 1) {
        jobOnlyMutationCalls += 1;
        if (jobOnlyMutationCalls === 1) {
          return await enqueueTargetsHandler({ db } as never, { jobId: created.jobId });
        }
        return await finalizeJobHandler({ db } as never, { jobId: created.jobId });
      }
      if (args.jobId === created.jobId && args.batchSize === 1) {
        return await claimResultsHandler({ db, scheduler } as never, {
          jobId: created.jobId,
          batchSize: 1,
        });
      }
      if (typeof args.itemId === "string" && "result" in args) {
        return await completeResultHandler({ db } as never, args as never);
      }
      throw new Error(`unexpected mutation ${JSON.stringify(args)}`);
    });
    const runQuery = vi.fn(async (_ref: unknown, args: Record<string, unknown>) => {
      if (typeof args.releaseId === "string") {
        return await getScanInputHandler({ db } as never, { releaseId: args.releaseId });
      }
      throw new Error(`unexpected query ${JSON.stringify(args)}`);
    });

    const processed = await processBatchHandler(
      { runMutation, runQuery, storage: {}, scheduler } as never,
      {
        jobId: created.jobId,
        batchSize: 1,
      },
    );
    const listed = await listResultsHandler({ db } as never, {
      actorUserId: "users:admin",
      jobId: created.jobId,
      cursor: null,
      limit: 10,
    });

    expect(processed).toMatchObject({
      jobId: created.jobId,
      enqueued: 1,
      claimed: 1,
      completed: 1,
      done: true,
      status: "completed",
    });
    expect(jobs[0]).toMatchObject({
      selector: { kind: "allActive" },
      status: "completed",
      totalItems: 1,
      completedItems: 1,
      matchedItems: 1,
    });
    expect(items[0]).toMatchObject({
      status: "completed",
      rawFsUsageCount: 1,
      fsSafeUsageCount: 0,
    });
    expect(listed).toMatchObject({
      jobStatus: "completed",
      jobDone: true,
      partial: false,
      done: true,
      nextCursor: null,
      items: [
        {
          jobId: created.jobId,
          releaseId: "packageReleases:demo",
          status: "completed",
          rawFsUsageCount: 1,
        },
      ],
    });
  });

  it("reclaims stale running scan results before claiming work", async () => {
    const { db, jobs, items } = createDb();
    jobs.push({
      _id: "packageDryRunScanJobs:1",
      scanner: "filesystem-safety-v1",
      selector: { kind: "releaseIds", releaseIds: ["packageReleases:demo"] },
      status: "running",
      requestedByUserId: "users:admin",
      totalItems: 1,
      queuedItems: 0,
      runningItems: 1,
      completedItems: 0,
      failedItems: 0,
      skippedItems: 0,
      matchedItems: 0,
      targetSelectionDone: true,
      expiresAt: 1_700_086_400_000,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    });
    items.push({
      _id: "packageDryRunScanResults:1",
      jobId: "packageDryRunScanJobs:1",
      releaseId: "packageReleases:demo",
      packageId: "packages:demo",
      packageName: "demo-plugin",
      packageDisplayName: "Demo Plugin",
      version: "1.0.0",
      status: "running",
      rawFsUsageCount: 0,
      fsSafeUsageCount: 0,
      findings: [],
      errors: [],
      leaseExpiresAt: 1,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    });
    const scheduler = { runAfter: vi.fn(async () => undefined) };

    const claimed = await claimResultsHandler({ db, scheduler } as never, {
      jobId: "packageDryRunScanJobs:1",
      batchSize: 1,
    });

    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({ itemId: "packageDryRunScanResults:1" });
    expect(items[0]).toMatchObject({ status: "running" });
    expect(items[0]?.leaseExpiresAt).toBeGreaterThan(Date.now());
    expect(jobs[0]).toMatchObject({ queuedItems: 0, runningItems: 1 });
    expect(scheduler.runAfter).toHaveBeenCalledTimes(1);
  });

  it("reclaims stale running scan results behind fresh running rows", async () => {
    const { db, jobs, items } = createDb();
    jobs.push({
      _id: "packageDryRunScanJobs:1",
      scanner: "filesystem-safety-v1",
      selector: { kind: "releaseIds", releaseIds: ["packageReleases:demo"] },
      status: "running",
      requestedByUserId: "users:admin",
      totalItems: 26,
      queuedItems: 0,
      runningItems: 26,
      completedItems: 0,
      failedItems: 0,
      skippedItems: 0,
      matchedItems: 0,
      targetSelectionDone: true,
      expiresAt: 1_700_086_400_000,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    });
    for (let index = 0; index < 25; index += 1) {
      items.push({
        _id: `packageDryRunScanResults:fresh-${index}`,
        jobId: "packageDryRunScanJobs:1",
        releaseId: "packageReleases:demo",
        packageId: "packages:demo",
        packageName: "demo-plugin",
        packageDisplayName: "Demo Plugin",
        version: "1.0.0",
        status: "running",
        rawFsUsageCount: 0,
        fsSafeUsageCount: 0,
        findings: [],
        errors: [],
        leaseExpiresAt: Date.now() + 60_000,
        createdAt: 1_700_000_000_000 + index,
        updatedAt: 1_700_000_000_000,
      });
    }
    items.push({
      _id: "packageDryRunScanResults:stale",
      jobId: "packageDryRunScanJobs:1",
      releaseId: "packageReleases:demo",
      packageId: "packages:demo",
      packageName: "demo-plugin",
      packageDisplayName: "Demo Plugin",
      version: "1.0.0",
      status: "running",
      rawFsUsageCount: 0,
      fsSafeUsageCount: 0,
      findings: [],
      errors: [],
      leaseExpiresAt: 1,
      createdAt: 1_700_000_000_100,
      updatedAt: 1_700_000_000_000,
    });
    const scheduler = { runAfter: vi.fn(async () => undefined) };

    const claimed = await claimResultsHandler({ db, scheduler } as never, {
      jobId: "packageDryRunScanJobs:1",
      batchSize: 1,
    });

    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({ itemId: "packageDryRunScanResults:stale" });
    expect(items.at(-1)).toMatchObject({ status: "running" });
    expect(jobs[0]).toMatchObject({ queuedItems: 0, runningItems: 26 });
  });

  it("updates a future stale recheck watchdog when it does not cover the new lease", async () => {
    const { db, jobs, items } = createDb();
    const existingRecheckAt = Date.now() + 60_000;
    jobs.push({
      _id: "packageDryRunScanJobs:1",
      scanner: "filesystem-safety-v1",
      selector: { kind: "releaseIds", releaseIds: ["packageReleases:demo"] },
      status: "running",
      requestedByUserId: "users:admin",
      totalItems: 2,
      queuedItems: 2,
      runningItems: 0,
      completedItems: 0,
      failedItems: 0,
      skippedItems: 0,
      matchedItems: 0,
      targetSelectionDone: true,
      staleRecheckAt: existingRecheckAt,
      expiresAt: 1_700_086_400_000,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    });
    for (const index of [1, 2]) {
      items.push({
        _id: `packageDryRunScanResults:${index}`,
        jobId: "packageDryRunScanJobs:1",
        releaseId: `packageReleases:demo-${index}`,
        packageId: "packages:demo",
        packageName: "demo-plugin",
        packageDisplayName: "Demo Plugin",
        version: "1.0.0",
        status: "queued",
        rawFsUsageCount: 0,
        fsSafeUsageCount: 0,
        findings: [],
        errors: [],
        createdAt: 1_700_000_000_000 + index,
        updatedAt: 1_700_000_000_000,
      });
    }
    const scheduler = { runAfter: vi.fn(async () => undefined) };

    const firstClaim = await claimResultsHandler({ db, scheduler } as never, {
      jobId: "packageDryRunScanJobs:1",
      batchSize: 1,
    });
    const secondClaim = await claimResultsHandler({ db, scheduler } as never, {
      jobId: "packageDryRunScanJobs:1",
      batchSize: 1,
    });

    expect(firstClaim).toHaveLength(1);
    expect(secondClaim).toHaveLength(1);
    expect(jobs[0]?.staleRecheckAt).toBeGreaterThan(existingRecheckAt);
    expect(scheduler.runAfter).toHaveBeenCalledTimes(1);
  });

  it("reuses an existing stale recheck watchdog when it covers the new lease", async () => {
    const { db, jobs, items } = createDb();
    const existingRecheckAt = Date.now() + 30 * 60_000;
    jobs.push({
      _id: "packageDryRunScanJobs:1",
      scanner: "filesystem-safety-v1",
      selector: { kind: "releaseIds", releaseIds: ["packageReleases:demo"] },
      status: "running",
      requestedByUserId: "users:admin",
      totalItems: 1,
      queuedItems: 1,
      runningItems: 0,
      completedItems: 0,
      failedItems: 0,
      skippedItems: 0,
      matchedItems: 0,
      targetSelectionDone: true,
      staleRecheckAt: existingRecheckAt,
      expiresAt: 1_700_086_400_000,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    });
    items.push({
      _id: "packageDryRunScanResults:1",
      jobId: "packageDryRunScanJobs:1",
      releaseId: "packageReleases:demo",
      packageId: "packages:demo",
      packageName: "demo-plugin",
      packageDisplayName: "Demo Plugin",
      version: "1.0.0",
      status: "queued",
      rawFsUsageCount: 0,
      fsSafeUsageCount: 0,
      findings: [],
      errors: [],
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    });
    const scheduler = { runAfter: vi.fn(async () => undefined) };

    const claimed = await claimResultsHandler({ db, scheduler } as never, {
      jobId: "packageDryRunScanJobs:1",
      batchSize: 1,
    });

    expect(claimed).toHaveLength(1);
    expect(jobs[0]?.staleRecheckAt).toBe(existingRecheckAt);
    expect(scheduler.runAfter).not.toHaveBeenCalled();
  });

  it("prunes expired dry-run scan jobs and results", async () => {
    const { db, jobs, items } = createDb();
    jobs.push({
      _id: "packageDryRunScanJobs:1",
      scanner: "filesystem-safety-v1",
      selector: { kind: "releaseIds", releaseIds: ["packageReleases:demo"] },
      status: "completed",
      requestedByUserId: "users:admin",
      totalItems: 1,
      queuedItems: 0,
      runningItems: 0,
      completedItems: 1,
      failedItems: 0,
      skippedItems: 0,
      matchedItems: 0,
      targetSelectionDone: true,
      expiresAt: 1,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    });
    items.push({
      _id: "packageDryRunScanResults:1",
      jobId: "packageDryRunScanJobs:1",
      releaseId: "packageReleases:demo",
      packageId: "packages:demo",
      packageName: "demo-plugin",
      packageDisplayName: "Demo Plugin",
      version: "1.0.0",
      status: "completed",
      rawFsUsageCount: 0,
      fsSafeUsageCount: 0,
      findings: [],
      errors: [],
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    });

    const scheduler = { runAfter: vi.fn(async (_delay: number, ..._args: unknown[]) => undefined) };

    const result = await pruneJobsHandler({ db, scheduler } as never, {
      jobBatchSize: 1,
      resultBatchSize: 10,
    });

    expect(result).toEqual({
      jobsScanned: 1,
      jobsDeleted: 1,
      resultsDeleted: 1,
    });
    expect(jobs).toHaveLength(0);
    expect(items).toHaveLength(0);
  });

  it("prunes expired terminal jobs when older non-terminal jobs also expired", async () => {
    const { db, jobs, items } = createDb();
    jobs.push(
      {
        _id: "packageDryRunScanJobs:queued",
        scanner: "filesystem-safety-v1",
        selector: { kind: "releaseIds", releaseIds: ["packageReleases:demo"] },
        status: "queued",
        requestedByUserId: "users:admin",
        totalItems: 1,
        queuedItems: 1,
        runningItems: 0,
        completedItems: 0,
        failedItems: 0,
        skippedItems: 0,
        matchedItems: 0,
        targetSelectionDone: true,
        expiresAt: 1,
        createdAt: 1_699_999_999_000,
        updatedAt: 1_699_999_999_000,
      },
      {
        _id: "packageDryRunScanJobs:completed",
        scanner: "filesystem-safety-v1",
        selector: { kind: "releaseIds", releaseIds: ["packageReleases:demo"] },
        status: "completed",
        requestedByUserId: "users:admin",
        totalItems: 1,
        queuedItems: 0,
        runningItems: 0,
        completedItems: 1,
        failedItems: 0,
        skippedItems: 0,
        matchedItems: 0,
        targetSelectionDone: true,
        expiresAt: 2,
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_000,
      },
    );
    items.push({
      _id: "packageDryRunScanResults:completed",
      jobId: "packageDryRunScanJobs:completed",
      releaseId: "packageReleases:demo",
      packageId: "packages:demo",
      packageName: "demo-plugin",
      packageDisplayName: "Demo Plugin",
      version: "1.0.0",
      status: "completed",
      rawFsUsageCount: 0,
      fsSafeUsageCount: 0,
      findings: [],
      errors: [],
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    });

    const scheduler = { runAfter: vi.fn(async (_delay: number, ..._args: unknown[]) => undefined) };

    const result = await pruneJobsHandler({ db, scheduler } as never, {
      jobBatchSize: 1,
      resultBatchSize: 10,
    });

    expect(result).toEqual({
      jobsScanned: 1,
      jobsDeleted: 1,
      resultsDeleted: 1,
    });
    expect(jobs.map((job) => job._id)).toEqual(["packageDryRunScanJobs:queued"]);
    expect(items).toHaveLength(0);
  });

  it("prunes expired terminal dry-run scan jobs by expiry across statuses", async () => {
    const { db, jobs, items } = createDb();
    jobs.push(
      {
        _id: "packageDryRunScanJobs:completed",
        scanner: "filesystem-safety-v1",
        selector: { kind: "releaseIds", releaseIds: ["packageReleases:demo"] },
        status: "completed",
        requestedByUserId: "users:admin",
        totalItems: 1,
        queuedItems: 0,
        runningItems: 0,
        completedItems: 1,
        failedItems: 0,
        skippedItems: 0,
        matchedItems: 0,
        targetSelectionDone: true,
        expiresAt: 100,
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_000,
      },
      {
        _id: "packageDryRunScanJobs:failed",
        scanner: "filesystem-safety-v1",
        selector: { kind: "releaseIds", releaseIds: ["packageReleases:demo"] },
        status: "failed",
        requestedByUserId: "users:admin",
        totalItems: 1,
        queuedItems: 0,
        runningItems: 0,
        completedItems: 0,
        failedItems: 1,
        skippedItems: 0,
        matchedItems: 0,
        targetSelectionDone: true,
        expiresAt: 1,
        createdAt: 1_700_000_000_001,
        updatedAt: 1_700_000_000_001,
      },
    );
    for (const job of jobs) {
      items.push({
        _id: `${job._id}:result`,
        jobId: job._id,
        releaseId: "packageReleases:demo",
        packageId: "packages:demo",
        packageName: "demo-plugin",
        packageDisplayName: "Demo Plugin",
        version: "1.0.0",
        status: job.status === "failed" ? "failed" : "completed",
        rawFsUsageCount: 0,
        fsSafeUsageCount: 0,
        findings: [],
        errors: [],
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_000,
      });
    }

    const scheduler = { runAfter: vi.fn(async (_delay: number, ..._args: unknown[]) => undefined) };

    const result = await pruneJobsHandler({ db, scheduler } as never, {
      jobBatchSize: 1,
      resultBatchSize: 10,
    });

    expect(result).toEqual({
      jobsScanned: 1,
      jobsDeleted: 1,
      resultsDeleted: 1,
    });
    expect(jobs.map((job) => job._id)).toEqual(["packageDryRunScanJobs:completed"]);
    expect(items.map((item) => item.jobId)).toEqual(["packageDryRunScanJobs:completed"]);
    expect(scheduler.runAfter).toHaveBeenCalledTimes(1);
  });

  it("bounds total pruned results per invocation across expired jobs", async () => {
    const { db, jobs, items } = createDb();
    for (const jobId of ["packageDryRunScanJobs:1", "packageDryRunScanJobs:2"]) {
      jobs.push({
        _id: jobId,
        scanner: "filesystem-safety-v1",
        selector: { kind: "releaseIds", releaseIds: ["packageReleases:demo"] },
        status: "completed",
        requestedByUserId: "users:admin",
        totalItems: 2,
        queuedItems: 0,
        runningItems: 0,
        completedItems: 2,
        failedItems: 0,
        skippedItems: 0,
        matchedItems: 0,
        targetSelectionDone: true,
        expiresAt: 1,
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_000,
      });
      for (let index = 0; index < 2; index += 1) {
        items.push({
          _id: `${jobId}:result-${index}`,
          jobId,
          releaseId: "packageReleases:demo",
          packageId: "packages:demo",
          packageName: "demo-plugin",
          packageDisplayName: "Demo Plugin",
          version: "1.0.0",
          status: "completed",
          rawFsUsageCount: 0,
          fsSafeUsageCount: 0,
          findings: [],
          errors: [],
          createdAt: 1_700_000_000_000,
          updatedAt: 1_700_000_000_000,
        });
      }
    }

    const scheduler = { runAfter: vi.fn(async (_delay: number, ..._args: unknown[]) => undefined) };

    const result = await pruneJobsHandler({ db, scheduler } as never, {
      jobBatchSize: 2,
      resultBatchSize: 2,
    });

    expect(result).toEqual({
      jobsScanned: 2,
      jobsDeleted: 0,
      resultsDeleted: 2,
    });
    expect(jobs).toHaveLength(2);
    expect(items).toHaveLength(2);
    expect(scheduler.runAfter).toHaveBeenCalledTimes(1);
    expect(scheduler.runAfter.mock.calls[0]?.[0]).toBe(0);
  });

  it("processes a bounded worker batch without patching package release state", async () => {
    vi.mocked(runPackageDryRunFilesystemScan).mockResolvedValue({
      rawFsUsage: {
        reasonCode: "info.filesystem.raw_fs_api_usage",
        totalCount: 0,
        returnedCount: 0,
        omittedCount: 0,
        truncatedEvidenceCount: 0,
        evidence: [],
      },
      fsSafeUsage: {
        reasonCode: "info.filesystem.fs_safe_usage",
        totalCount: 0,
        returnedCount: 0,
        omittedCount: 0,
        truncatedEvidenceCount: 0,
        evidence: [],
      },
    });
    let jobOnlyMutationCalls = 0;
    const runMutation = vi.fn(async (_ref: unknown, args: Record<string, unknown>) => {
      if (args.jobId === "packageDryRunScanJobs:1" && Object.keys(args).length === 1) {
        jobOnlyMutationCalls += 1;
        if (jobOnlyMutationCalls === 1) {
          return { enqueued: 0, done: true };
        }
        return { done: true, status: "completed" };
      }
      if (args.jobId === "packageDryRunScanJobs:1" && args.batchSize === 2) {
        return [
          {
            itemId: "packageDryRunScanResults:1",
            releaseId: "packageReleases:demo",
            packageId: "packages:demo",
            packageName: "demo-plugin",
            packageDisplayName: "Demo Plugin",
            version: "1.0.0",
            claimToken: "claim-1",
          },
        ];
      }
      if (args.itemId === "packageDryRunScanResults:1" && args.result) return null;
      throw new Error(`unexpected mutation ${JSON.stringify(args)}`);
    });
    const runQuery = vi.fn(async (_ref: unknown, args: Record<string, unknown>) => {
      if (args.releaseId !== "packageReleases:demo") {
        throw new Error(`unexpected query ${JSON.stringify(args)}`);
      }
      return {
        kind: "scan",
        releaseId: "packageReleases:demo",
        packageId: "packages:demo",
        packageName: "demo-plugin",
        packageDisplayName: "Demo Plugin",
        packageSummary: "A demo package",
        metadata: {
          packageJson: { name: "demo-plugin" },
          pluginManifest: { id: "demo-plugin" },
        },
        files: [],
      };
    });

    const scheduler = { runAfter: vi.fn(async () => undefined) };
    const result = await processBatchHandler(
      { runMutation, runQuery, storage: {}, scheduler } as never,
      {
        jobId: "packageDryRunScanJobs:1",
        batchSize: 2,
      },
    );

    expect(result).toEqual({
      jobId: "packageDryRunScanJobs:1",
      enqueued: 0,
      claimed: 1,
      completed: 1,
      skipped: 0,
      failed: 0,
      done: true,
      status: "completed",
    });
    expect(runPackageDryRunFilesystemScan).toHaveBeenCalledWith(
      expect.objectContaining({ runMutation, runQuery }),
      expect.objectContaining({
        files: [],
      }),
    );
    expect(runMutation).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        releaseId: "packageReleases:demo",
        staticScan: expect.anything(),
      }),
    );
    expect(scheduler.runAfter).not.toHaveBeenCalled();
  });

  it("records scan read failures separately from scanner findings", async () => {
    const { db, jobs, items } = createDb();
    jobs.push({
      _id: "packageDryRunScanJobs:1",
      scanner: "filesystem-safety-v1",
      selector: { kind: "releaseIds", releaseIds: ["packageReleases:demo"] },
      status: "running",
      requestedByUserId: "users:admin",
      totalItems: 1,
      queuedItems: 0,
      runningItems: 1,
      completedItems: 0,
      failedItems: 0,
      skippedItems: 0,
      matchedItems: 0,
      targetSelectionDone: true,
      expiresAt: 1_700_086_400_000,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    });
    items.push({
      _id: "packageDryRunScanResults:1",
      jobId: "packageDryRunScanJobs:1",
      releaseId: "packageReleases:demo",
      packageId: "packages:demo",
      packageName: "demo-plugin",
      packageDisplayName: "Demo Plugin",
      version: "1.0.0",
      status: "running",
      claimToken: "claim-1",
      rawFsUsageCount: 0,
      fsSafeUsageCount: 0,
      findings: [],
      errors: [],
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    });

    await failResultHandler({ db } as never, {
      itemId: "packageDryRunScanResults:1",
      claimToken: "claim-1",
      error: "storage object missing",
    });

    expect(items[0]).toMatchObject({
      status: "failed",
      findings: [],
      errors: ["storage object missing"],
    });
    expect(jobs[0]).toMatchObject({
      runningItems: 0,
      failedItems: 1,
    });
  });

  it("bounds persisted skipped-result reasons", async () => {
    const { db, jobs, items } = createDb();
    jobs.push({
      _id: "packageDryRunScanJobs:1",
      scanner: "filesystem-safety-v1",
      selector: { kind: "releaseIds", releaseIds: ["packageReleases:demo"] },
      status: "running",
      requestedByUserId: "users:admin",
      totalItems: 1,
      queuedItems: 0,
      runningItems: 1,
      completedItems: 0,
      failedItems: 0,
      skippedItems: 0,
      matchedItems: 0,
      targetSelectionDone: true,
      expiresAt: 1_700_086_400_000,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    });
    items.push({
      _id: "packageDryRunScanResults:1",
      jobId: "packageDryRunScanJobs:1",
      releaseId: "packageReleases:demo",
      packageId: "packages:demo",
      packageName: "demo-plugin",
      packageDisplayName: "Demo Plugin",
      version: "1.0.0",
      status: "running",
      claimToken: "claim-1",
      rawFsUsageCount: 0,
      fsSafeUsageCount: 0,
      findings: [],
      errors: [],
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    });

    await skipResultHandler({ db } as never, {
      itemId: "packageDryRunScanResults:1",
      claimToken: "claim-1",
      reason: "x".repeat(2_000),
    });

    expect(items[0]?.errors[0]).toHaveLength(1_024);
    expect(items[0]?.errors[0]?.endsWith("...")).toBe(true);
    expect(jobs[0]).toMatchObject({
      runningItems: 0,
      skippedItems: 1,
    });
  });

  it("ignores stale worker completions after a result is requeued", async () => {
    const { db, jobs, items } = createDb();
    jobs.push({
      _id: "packageDryRunScanJobs:1",
      scanner: "filesystem-safety-v1",
      selector: { kind: "releaseIds", releaseIds: ["packageReleases:demo"] },
      status: "running",
      requestedByUserId: "users:admin",
      totalItems: 1,
      queuedItems: 1,
      runningItems: 0,
      completedItems: 0,
      failedItems: 0,
      skippedItems: 0,
      matchedItems: 0,
      targetSelectionDone: true,
      expiresAt: 1_700_086_400_000,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    });
    items.push({
      _id: "packageDryRunScanResults:1",
      jobId: "packageDryRunScanJobs:1",
      releaseId: "packageReleases:demo",
      packageId: "packages:demo",
      packageName: "demo-plugin",
      packageDisplayName: "Demo Plugin",
      version: "1.0.0",
      status: "queued",
      rawFsUsageCount: 0,
      fsSafeUsageCount: 0,
      findings: [],
      errors: [],
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    });

    await failResultHandler({ db } as never, {
      itemId: "packageDryRunScanResults:1",
      claimToken: "old-claim",
      error: "late worker failed",
    });

    expect(items[0]).toMatchObject({
      status: "queued",
      errors: [],
    });
    expect(jobs[0]).toMatchObject({
      queuedItems: 1,
      runningItems: 0,
      failedItems: 0,
    });
  });

  it("preserves failed terminal jobs when a later finalize runs", async () => {
    const { db, jobs } = createDb();
    jobs.push({
      _id: "packageDryRunScanJobs:1",
      scanner: "filesystem-safety-v1",
      selector: { kind: "releaseIds", releaseIds: ["packageReleases:demo"] },
      status: "failed",
      requestedByUserId: "users:admin",
      totalItems: 0,
      queuedItems: 0,
      runningItems: 0,
      completedItems: 0,
      failedItems: 0,
      skippedItems: 0,
      matchedItems: 0,
      targetSelectionDone: true,
      expiresAt: 1_700_086_400_000,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
      completedAt: 1_700_000_000_000,
      error: "worker unavailable",
    });

    const result = await finalizeJobHandler({ db } as never, {
      jobId: "packageDryRunScanJobs:1",
    });

    expect(result).toEqual({ done: true, status: "failed" });
    expect(jobs[0]).toMatchObject({
      status: "failed",
      error: "worker unavailable",
    });
    expect(db.patch).not.toHaveBeenCalled();
  });

  it("ignores late result completions after the parent job is terminal", async () => {
    const { db, jobs, items } = createDb();
    jobs.push({
      _id: "packageDryRunScanJobs:1",
      scanner: "filesystem-safety-v1",
      selector: { kind: "releaseIds", releaseIds: ["packageReleases:demo"] },
      status: "failed",
      requestedByUserId: "users:admin",
      totalItems: 1,
      queuedItems: 0,
      runningItems: 0,
      completedItems: 0,
      failedItems: 1,
      skippedItems: 0,
      matchedItems: 0,
      targetSelectionDone: true,
      expiresAt: 1_700_086_400_000,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
      completedAt: 1_700_000_000_000,
      error: "worker unavailable",
    });
    items.push({
      _id: "packageDryRunScanResults:1",
      jobId: "packageDryRunScanJobs:1",
      releaseId: "packageReleases:demo",
      packageId: "packages:demo",
      packageName: "demo-plugin",
      packageDisplayName: "Demo Plugin",
      version: "1.0.0",
      status: "running",
      rawFsUsageCount: 0,
      fsSafeUsageCount: 0,
      findings: [],
      errors: [],
      claimToken: "claim-1",
      leaseExpiresAt: 1_700_000_600_000,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    });

    await completeResultHandler({ db } as never, {
      itemId: "packageDryRunScanResults:1",
      claimToken: "claim-1",
      result: {
        rawFsUsage: {
          reasonCode: "info.filesystem.raw_fs_api_usage",
          totalCount: 1,
          returnedCount: 1,
          omittedCount: 0,
          truncatedEvidenceCount: 0,
          evidence: [
            {
              code: "info.filesystem.raw_fs_api_usage",
              severity: "info",
              file: "dist/index.js",
              line: 1,
              message: "Raw Node filesystem API usage detected.",
              evidence: "import fs from 'node:fs';",
              evidenceTruncated: false,
            },
          ],
        },
        fsSafeUsage: {
          reasonCode: "info.filesystem.fs_safe_usage",
          totalCount: 0,
          returnedCount: 0,
          omittedCount: 0,
          truncatedEvidenceCount: 0,
          evidence: [],
        },
      },
    });

    expect(items[0]).toMatchObject({
      status: "running",
      rawFsUsageCount: 0,
      claimToken: "claim-1",
    });
    expect(jobs[0]).toMatchObject({
      status: "failed",
      completedItems: 0,
      failedItems: 1,
      matchedItems: 0,
    });
  });

  it("schedules a continuation when the worker batch is not done", async () => {
    let jobOnlyMutationCalls = 0;
    const runMutation = vi.fn(async (_ref: unknown, args: Record<string, unknown>) => {
      if (args.jobId === "packageDryRunScanJobs:1" && Object.keys(args).length === 1) {
        jobOnlyMutationCalls += 1;
        if (jobOnlyMutationCalls === 1) return { enqueued: 1, done: false };
        return { done: false, status: "running" };
      }
      if (args.jobId === "packageDryRunScanJobs:1" && args.batchSize === 5) return [];
      throw new Error(`unexpected mutation ${JSON.stringify(args)}`);
    });
    const scheduler = { runAfter: vi.fn(async (_delay: number, ..._args: unknown[]) => undefined) };

    const result = await processBatchHandler(
      { runMutation, runQuery: vi.fn(), storage: {}, scheduler } as never,
      {
        jobId: "packageDryRunScanJobs:1",
        batchSize: 5,
      },
    );

    expect(result).toMatchObject({
      jobId: "packageDryRunScanJobs:1",
      enqueued: 1,
      claimed: 0,
      done: false,
      status: "running",
    });
    expect(scheduler.runAfter).toHaveBeenCalledTimes(1);
    expect(scheduler.runAfter.mock.calls[0]?.[0]).toBe(0);
  });

  it("continues immediately when target selection advanced without queued targets", async () => {
    let jobOnlyMutationCalls = 0;
    const runMutation = vi.fn(async (_ref: unknown, args: Record<string, unknown>) => {
      if (args.jobId === "packageDryRunScanJobs:1" && Object.keys(args).length === 1) {
        jobOnlyMutationCalls += 1;
        if (jobOnlyMutationCalls === 1) return { enqueued: 0, done: false, advanced: true };
        return { done: false, status: "running" };
      }
      if (args.jobId === "packageDryRunScanJobs:1" && args.batchSize === 5) return [];
      throw new Error(`unexpected mutation ${JSON.stringify(args)}`);
    });
    const scheduler = { runAfter: vi.fn(async (_delay: number, ..._args: unknown[]) => undefined) };

    const result = await processBatchHandler(
      { runMutation, runQuery: vi.fn(), storage: {}, scheduler } as never,
      {
        jobId: "packageDryRunScanJobs:1",
        batchSize: 5,
      },
    );

    expect(result).toMatchObject({
      jobId: "packageDryRunScanJobs:1",
      enqueued: 0,
      claimed: 0,
      done: false,
      status: "running",
    });
    expect(scheduler.runAfter).toHaveBeenCalledTimes(1);
    expect(scheduler.runAfter.mock.calls[0]?.[0]).toBe(0);
  });

  it("backs off instead of hot-looping when only running items remain", async () => {
    let jobOnlyMutationCalls = 0;
    const runMutation = vi.fn(async (_ref: unknown, args: Record<string, unknown>) => {
      if (args.jobId === "packageDryRunScanJobs:1" && Object.keys(args).length === 1) {
        jobOnlyMutationCalls += 1;
        if (jobOnlyMutationCalls === 1) return { enqueued: 0, done: true, advanced: false };
        return { done: false, status: "running" };
      }
      if (args.jobId === "packageDryRunScanJobs:1" && args.batchSize === 5) return [];
      throw new Error(`unexpected mutation ${JSON.stringify(args)}`);
    });
    const scheduler = { runAfter: vi.fn(async (_delay: number, ..._args: unknown[]) => undefined) };

    const result = await processBatchHandler(
      { runMutation, runQuery: vi.fn(), storage: {}, scheduler } as never,
      {
        jobId: "packageDryRunScanJobs:1",
        batchSize: 5,
      },
    );

    expect(result).toMatchObject({
      jobId: "packageDryRunScanJobs:1",
      enqueued: 0,
      claimed: 0,
      done: false,
      status: "running",
    });
    expect(scheduler.runAfter).toHaveBeenCalledTimes(1);
    expect(scheduler.runAfter.mock.calls[0]?.[0]).toBeGreaterThan(0);
  });

  it("marks the job failed when the worker action cannot continue", async () => {
    const runMutation = vi.fn(async (_ref: unknown, args: Record<string, unknown>) => {
      if (
        args.jobId === "packageDryRunScanJobs:1" &&
        Object.keys(args).length === 1 &&
        runMutation.mock.calls.length === 1
      ) {
        throw new Error("target enqueue unavailable");
      }
      if (args.jobId === "packageDryRunScanJobs:1" && args.error === "target enqueue unavailable") {
        return { done: true, status: "failed" };
      }
      throw new Error(`unexpected mutation ${JSON.stringify(args)}`);
    });
    const scheduler = { runAfter: vi.fn(async (_delay: number, ..._args: unknown[]) => undefined) };

    const result = await processBatchHandler(
      { runMutation, runQuery: vi.fn(), storage: {}, scheduler } as never,
      {
        jobId: "packageDryRunScanJobs:1",
        batchSize: 5,
      },
    );

    expect(result).toMatchObject({
      jobId: "packageDryRunScanJobs:1",
      enqueued: 0,
      claimed: 0,
      completed: 0,
      skipped: 0,
      failed: 0,
      done: true,
      status: "failed",
    });
    expect(scheduler.runAfter).not.toHaveBeenCalled();
  });
});
