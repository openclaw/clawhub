import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "./_generated/dataModel";
import {
  enqueueRegistryArtifactBackupJobHandler,
  getRegistryArtifactBackupHealthHandler,
  getRegistryArtifactBackupPageInternal,
  getPackageRegistryArtifactBackupPageInternal,
} from "./registryArtifactBackups";
import {
  backupPackageForPublishInternal,
  backupSkillForPublishInternal,
  processRegistryArtifactBackupRetriesInternalHandler,
  seedRegistryArtifactBackupsInternalHandler,
} from "./registryArtifactBackupsNode";

const registryBackupMocks = vi.hoisted(() => ({
  backupPackageReleaseToObjectStorage: vi.fn(),
  backupSkillVersionToObjectStorage: vi.fn(),
  fetchPackageReleaseBackupMeta: vi.fn(),
  fetchSkillVersionBackupMeta: vi.fn(),
  getRegistryArtifactBackupContext: vi.fn(),
  isRegistryArtifactBackupConfigured: vi.fn(),
}));

vi.mock("./lib/registryArtifactBackup", () => registryBackupMocks);

const handler = (getRegistryArtifactBackupPageInternal as unknown as { _handler: Function })
  ._handler;
const packagePageHandler = (
  getPackageRegistryArtifactBackupPageInternal as unknown as { _handler: Function }
)._handler;
const backupSkillForPublishHandler = (
  backupSkillForPublishInternal as unknown as { _handler: Function }
)._handler;
const backupPackageForPublishHandler = (
  backupPackageForPublishInternal as unknown as { _handler: Function }
)._handler;

beforeEach(() => {
  vi.clearAllMocks();
  registryBackupMocks.getRegistryArtifactBackupContext.mockReturnValue({
    endpoint: "https://account.r2.cloudflarestorage.com",
    bucket: "clawhub-registry-backup",
    accessKeyId: "access-key",
    secretAccessKey: "secret-key",
    region: "auto",
    skillsRoot: "skills",
    packagesRoot: "packages",
  });
  registryBackupMocks.isRegistryArtifactBackupConfigured.mockReturnValue(true);
});

describe("publish-time registry artifact backups", () => {
  it("rehydrates skill backup args from current Convex state before writing", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({
        _id: "skillVersions:demo-1",
        skillId: "skills:demo",
        version: "1.0.0",
        files: [{ path: "SKILL.md", size: 5, storageId: "storage:skill", sha256: "sha" }],
        createdAt: 1_700_000_000_000,
        softDeletedAt: undefined,
      })
      .mockResolvedValueOnce({
        _id: "skills:demo",
        slug: "current-slug",
        displayName: "Current Name",
        ownerUserId: "users:owner",
        ownerPublisherId: undefined,
        latestVersionId: "skillVersions:newer",
        softDeletedAt: undefined,
        moderationStatus: "active",
      })
      .mockResolvedValueOnce({
        _id: "users:owner",
        handle: "alice",
        deletedAt: undefined,
        deactivatedAt: undefined,
      });

    await backupSkillForPublishHandler({ runQuery, runMutation: vi.fn() } as never, {
      skillId: "skills:demo",
      versionId: "skillVersions:demo-1",
      slug: "stale-slug",
      version: "1.0.0",
      isLatest: true,
      displayName: "Stale Name",
      ownerHandle: "stale-owner",
      files: [],
      publishedAt: 1,
    });

    expect(registryBackupMocks.backupSkillVersionToObjectStorage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        slug: "current-slug",
        displayName: "Current Name",
        ownerHandle: "alice",
        isLatest: false,
      }),
    );
  });

  it("rehydrates package backup args from current Convex state before writing", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({
        _id: "packageReleases:demo-1",
        packageId: "packages:demo",
        version: "1.0.0",
        createdAt: 1_700_000_000_000,
        files: [],
        clawpackStorageId: "storage:artifact",
        clawpackSha256: "artifact-sha",
        clawpackSize: 10,
        clawpackFormat: "tgz",
        softDeletedAt: undefined,
      })
      .mockResolvedValueOnce({
        _id: "packages:demo",
        ownerUserId: "users:owner",
        ownerPublisherId: undefined,
        name: "@openclaw/demo",
        normalizedName: "@openclaw/demo",
        displayName: "Current Package",
        family: "code-plugin",
        latestReleaseId: "packageReleases:newer",
        softDeletedAt: undefined,
      })
      .mockResolvedValueOnce({
        _id: "users:owner",
        handle: "alice",
        deletedAt: undefined,
        deactivatedAt: undefined,
      });

    await backupPackageForPublishHandler({ runQuery, runMutation: vi.fn() } as never, {
      ownerHandle: "stale-owner",
      packageId: "packages:demo",
      releaseId: "packageReleases:demo-1",
      packageName: "@openclaw/stale",
      normalizedName: "@openclaw/stale",
      displayName: "Stale Package",
      family: "code-plugin",
      version: "1.0.0",
      isLatest: true,
      publishedAt: 1,
      artifactStorageId: "storage:artifact",
      files: [],
    });

    expect(registryBackupMocks.backupPackageReleaseToObjectStorage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        ownerHandle: "alice",
        packageName: "@openclaw/demo",
        normalizedName: "@openclaw/demo",
        displayName: "Current Package",
        isLatest: false,
      }),
    );
  });
});

describe("registry artifact backup page filtering", () => {
  it("scans all active skill versions so historical versions are present in the restore catalog", async () => {
    const firstVersion = {
      _id: "skillVersions:demo-1",
      skillId: "skills:demo",
      version: "1.0.0",
      createdAt: 1_700_000_000_000,
      softDeletedAt: undefined,
    };
    const secondVersion = {
      _id: "skillVersions:demo-2",
      skillId: "skills:demo",
      version: "1.1.0",
      createdAt: 1_700_000_100_000,
      softDeletedAt: undefined,
    };
    const skill = {
      _id: "skills:demo",
      slug: "demo-skill",
      displayName: "Demo Skill",
      ownerUserId: "users:owner",
      ownerPublisherId: "publishers:owner",
      softDeletedAt: undefined,
      moderationStatus: "active",
      latestVersionId: "skillVersions:demo-2",
    };
    const owner = {
      _id: "publishers:owner",
      handle: "alice",
      deletedAt: undefined,
      deactivatedAt: undefined,
    };
    const paginate = vi.fn().mockResolvedValue({
      page: [firstVersion, secondVersion],
      isDone: true,
      continueCursor: null,
    });
    const order = vi.fn().mockReturnValue({ paginate });
    const withIndex = vi.fn().mockReturnValue({ order });
    const query = vi.fn().mockReturnValue({ withIndex });
    const get = vi.fn(async (id: string) => {
      if (id === "skills:demo") return skill;
      if (id === "publishers:owner") return owner;
      return null;
    });

    const result = await handler({ db: { query, get } } as never, { batchSize: 50 });

    expect(query).toHaveBeenCalledWith("skillVersions");
    expect(result.items).toEqual([
      {
        kind: "ok",
        skillId: "skills:demo",
        versionId: "skillVersions:demo-1",
        slug: "demo-skill",
        displayName: "Demo Skill",
        version: "1.0.0",
        isLatest: false,
        ownerHandle: "alice",
        publishedAt: 1_700_000_000_000,
      },
      {
        kind: "ok",
        skillId: "skills:demo",
        versionId: "skillVersions:demo-2",
        slug: "demo-skill",
        displayName: "Demo Skill",
        version: "1.1.0",
        isLatest: true,
        ownerHandle: "alice",
        publishedAt: 1_700_000_100_000,
      },
    ]);
  });

  it("skips non-public skills and keeps legacy skills with undefined moderationStatus eligible", async () => {
    const versions = [
      {
        _id: "skillVersions:active",
        skillId: "skills:active",
        version: "1.0.0",
        createdAt: 1_700_000_000_000,
        softDeletedAt: undefined,
      },
      {
        _id: "skillVersions:legacy",
        skillId: "skills:legacy",
        version: "2.0.0",
        createdAt: 1_700_000_000_100,
        softDeletedAt: undefined,
      },
      {
        _id: "skillVersions:hidden",
        skillId: "skills:hidden",
        version: "1.0.0",
        createdAt: 1_700_000_000_200,
        softDeletedAt: undefined,
      },
      {
        _id: "skillVersions:removed",
        skillId: "skills:removed",
        version: "1.0.0",
        createdAt: 1_700_000_000_300,
        softDeletedAt: undefined,
      },
      {
        _id: "skillVersions:soft",
        skillId: "skills:soft",
        version: "1.0.0",
        createdAt: 1_700_000_000_400,
        softDeletedAt: undefined,
      },
    ];
    const owner = {
      _id: "publishers:owner",
      handle: "alice",
      deletedAt: undefined,
      deactivatedAt: undefined,
    };
    const skills = new Map([
      [
        "skills:active",
        {
          _id: "skills:active",
          slug: "active-skill",
          displayName: "Active Skill",
          ownerUserId: "users:active",
          ownerPublisherId: "publishers:owner",
          softDeletedAt: undefined,
          moderationStatus: "active",
        },
      ],
      [
        "skills:legacy",
        {
          _id: "skills:legacy",
          slug: "legacy-skill",
          displayName: "Legacy Skill",
          ownerUserId: "users:legacy",
          ownerPublisherId: "publishers:owner",
          softDeletedAt: undefined,
          moderationStatus: undefined,
        },
      ],
      [
        "skills:hidden",
        {
          _id: "skills:hidden",
          slug: "hidden-skill",
          displayName: "Hidden Skill",
          ownerUserId: "users:hidden",
          ownerPublisherId: "publishers:owner",
          softDeletedAt: undefined,
          moderationStatus: "hidden",
        },
      ],
      [
        "skills:removed",
        {
          _id: "skills:removed",
          slug: "removed-skill",
          displayName: "Removed Skill",
          ownerUserId: "users:removed",
          ownerPublisherId: "publishers:owner",
          softDeletedAt: undefined,
          moderationStatus: "removed",
        },
      ],
      [
        "skills:soft",
        {
          _id: "skills:soft",
          slug: "soft-skill",
          displayName: "Soft Skill",
          ownerUserId: "users:soft",
          ownerPublisherId: "publishers:owner",
          softDeletedAt: 1,
          moderationStatus: "active",
        },
      ],
    ]);
    const paginate = vi.fn().mockResolvedValue({
      page: versions,
      isDone: true,
      continueCursor: null,
    });
    const order = vi.fn().mockReturnValue({ paginate });
    const withIndex = vi.fn().mockReturnValue({ order });
    const query = vi.fn().mockReturnValue({ withIndex });
    const get = vi.fn(async (id: string) => {
      if (id === "publishers:owner") return owner;
      return skills.get(id) ?? null;
    });

    const result = await handler({ db: { query, get } } as never, { batchSize: 50 });

    expect(query).toHaveBeenCalledWith("skillVersions");
    expect(result.items).toMatchObject([
      {
        kind: "ok",
        slug: "active-skill",
        ownerHandle: "alice",
        version: "1.0.0",
      },
      {
        kind: "ok",
        slug: "legacy-skill",
        ownerHandle: "alice",
        version: "2.0.0",
      },
    ]);
  });

  it("marks public skill versions with missing owners as skipped seed items", async () => {
    const version = {
      _id: "skillVersions:no-owner",
      skillId: "skills:no-owner",
      version: "1.0.0",
      createdAt: 1,
      softDeletedAt: undefined,
    };
    const skill = {
      _id: "skills:no-owner",
      slug: "no-owner",
      displayName: "No Owner",
      ownerUserId: "users:no-owner",
      ownerPublisherId: undefined,
      softDeletedAt: undefined,
      moderationStatus: "active",
    };
    const paginate = vi.fn().mockResolvedValue({
      page: [version],
      isDone: true,
      continueCursor: null,
    });
    const order = vi.fn().mockReturnValue({ paginate });
    const withIndex = vi.fn().mockReturnValue({ order });
    const query = vi.fn().mockReturnValue({ withIndex });
    const get = vi.fn(async (id: string) => (id === "skills:no-owner" ? skill : null));

    const result = await handler({ db: { query, get } } as never, {});

    expect(result.items).toEqual([
      { kind: "missingOwner", skillId: "skills:no-owner", ownerUserId: "users:no-owner" },
    ]);
  });

  it("resets stale cursors after switching the skill backup page query", async () => {
    const paginate = vi
      .fn()
      .mockRejectedValueOnce(new Error("cursor is from a different query"))
      .mockResolvedValueOnce({ page: [], isDone: true, continueCursor: null });
    const order = vi.fn().mockReturnValue({ paginate });
    const withIndex = vi.fn().mockReturnValue({ order });
    const query = vi.fn().mockReturnValue({ withIndex });

    const result = await handler({ db: { query } } as never, { cursor: "stale-cursor" });

    expect(result).toMatchObject({ items: [], isDone: true, cursor: null });
    expect(paginate).toHaveBeenNthCalledWith(1, { cursor: "stale-cursor", numItems: 50 });
    expect(paginate).toHaveBeenNthCalledWith(2, { cursor: null, numItems: 50 });
  });
});

describe("package registry artifact backup page filtering", () => {
  it("returns backup-ready package releases and marks missing artifact rows", async () => {
    const backupableRelease = {
      _id: "packageReleases:ready",
      packageId: "packages:ready",
      version: "1.0.0",
      createdAt: 1_700_000_000_000,
      files: [{ path: "package.json", size: 10, sha256: "sha256:package" }],
      artifactKind: "npm-pack",
      clawpackStorageId: "storage:clawpack",
      clawpackSha256: "sha256:clawpack",
      clawpackSize: 123,
      clawpackFormat: "tgz",
      npmTarballName: "ready-1.0.0.tgz",
      compatibility: { openclaw: ">=2026.1.0" },
      capabilities: { executesCode: true },
      extractedPackageJson: { name: "ready" },
      extractedPluginManifest: { id: "ready" },
      softDeletedAt: undefined,
    };
    const missingArtifactRelease = {
      _id: "packageReleases:missing-artifact",
      packageId: "packages:missing-artifact",
      version: "1.0.0",
      createdAt: 1_700_000_000_100,
      files: [],
      softDeletedAt: undefined,
    };
    const readyPackage = {
      _id: "packages:ready",
      ownerUserId: "users:owner",
      ownerPublisherId: "publishers:openclaw",
      name: "@openclaw/ready",
      normalizedName: "@openclaw/ready",
      displayName: "Ready",
      family: "code-plugin",
      softDeletedAt: undefined,
      latestReleaseId: "packageReleases:ready",
    };
    const missingArtifactPackage = {
      ...readyPackage,
      _id: "packages:missing-artifact",
      name: "@openclaw/missing-artifact",
      normalizedName: "@openclaw/missing-artifact",
    };
    const owner = {
      _id: "publishers:openclaw",
      handle: "openclaw",
      deletedAt: undefined,
      deactivatedAt: undefined,
    };

    const paginate = vi.fn().mockResolvedValue({
      page: [backupableRelease, missingArtifactRelease],
      isDone: true,
      continueCursor: null,
    });
    const order = vi.fn().mockReturnValue({ paginate });
    const withIndex = vi.fn().mockReturnValue({ order });
    const query = vi.fn().mockReturnValue({ withIndex });
    const get = vi.fn(async (id: string) => {
      if (id === "packages:ready") return readyPackage;
      if (id === "packages:missing-artifact") return missingArtifactPackage;
      if (id === "publishers:openclaw") return owner;
      return null;
    });

    const result = await packagePageHandler({ db: { query, get } } as never, { batchSize: 50 });

    expect(query).toHaveBeenCalledWith("packageReleases");
    expect(result).toMatchObject({
      isDone: true,
      cursor: null,
      items: [
        {
          kind: "ok",
          releaseId: "packageReleases:ready",
          packageName: "@openclaw/ready",
          ownerHandle: "openclaw",
          isLatest: true,
          artifactStorageId: "storage:clawpack",
          artifactFileName: "ready-1.0.0.tgz",
        },
        {
          kind: "missingArtifact",
          releaseId: "packageReleases:missing-artifact",
          packageId: "packages:missing-artifact",
        },
      ],
    });
  });
});

describe("seedRegistryArtifactBackupsInternalHandler", () => {
  it("reports package cursor progress when skills are done but package releases remain", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({ items: [], cursor: null, isDone: true })
      .mockResolvedValueOnce({ items: [], cursor: "package-cursor", isDone: false })
      .mockResolvedValueOnce({ stale: 0, exhausted: 0 });

    const result = await seedRegistryArtifactBackupsInternalHandler(
      {
        runQuery,
        runMutation: vi.fn(),
      } as never,
      { dryRun: true, batchSize: 1, maxBatches: 1 },
    );

    expect(result).toMatchObject({
      cursor: null,
      packageCursor: "package-cursor",
      skillsIsDone: true,
      packageIsDone: false,
      isDone: false,
    });
  });

  it("queues failed skill seed attempts into the retry backlog", async () => {
    registryBackupMocks.fetchSkillVersionBackupMeta.mockRejectedValueOnce(new Error("R2 500"));
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ cursor: null })
      .mockResolvedValueOnce({
        items: [
          {
            kind: "ok",
            skillId: "skills:demo",
            versionId: "skillVersions:demo-1",
            slug: "demo-skill",
            displayName: "Demo Skill",
            version: "1.0.0",
            ownerHandle: "alice",
            publishedAt: 1,
          },
        ],
        cursor: null,
        isDone: true,
      })
      .mockResolvedValueOnce({ cursor: null })
      .mockResolvedValueOnce({ items: [], cursor: null, isDone: true })
      .mockResolvedValueOnce({ stale: 0, exhausted: 0 });
    const runMutation = vi.fn();

    const result = await seedRegistryArtifactBackupsInternalHandler(
      { runQuery, runMutation } as never,
      { batchSize: 1, maxBatches: 1 },
    );

    expect(result.stats.errors).toBe(1);
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        targetKind: "skillVersion",
        skillVersionId: "skillVersions:demo-1",
        reason: "seed",
        error: "R2 500",
      }),
    );
  });
});

describe("processRegistryArtifactBackupRetriesInternalHandler", () => {
  it("drains retry jobs without scanning the historical registry", async () => {
    const dueJob = {
      _id: "registryArtifactBackupJobs:demo",
      targetKind: "packageRelease",
      packageReleaseId: "packageReleases:demo",
      status: "pending",
      attempts: 0,
      nextRunAt: 1,
      createdAt: 1,
      updatedAt: 1,
    };
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce([dueJob])
      .mockResolvedValueOnce({
        _id: "packageReleases:demo",
        packageId: "packages:demo",
        version: "1.0.0",
        createdAt: 1,
        files: [],
        clawpackStorageId: "storage:artifact",
        softDeletedAt: undefined,
      })
      .mockResolvedValueOnce({
        _id: "packages:demo",
        ownerUserId: "users:owner",
        ownerPublisherId: undefined,
        name: "@openclaw/demo",
        normalizedName: "@openclaw/demo",
        displayName: "Demo",
        family: "code-plugin",
        softDeletedAt: undefined,
      })
      .mockResolvedValueOnce({
        _id: "users:owner",
        handle: "alice",
        deletedAt: undefined,
        deactivatedAt: undefined,
      })
      .mockResolvedValueOnce({ stale: 0, exhausted: 0 });
    const runMutation = vi.fn();

    const result = await processRegistryArtifactBackupRetriesInternalHandler(
      { runQuery, runMutation } as never,
      {},
    );

    expect(result.stats.retryJobsProcessed).toBe(1);
    expect(registryBackupMocks.backupPackageReleaseToObjectStorage).toHaveBeenCalledOnce();
    expect(runQuery).not.toHaveBeenCalledWith(
      expect.objectContaining({
        _name: "registryArtifactBackups:getRegistryArtifactBackupPageInternal",
      }),
      expect.anything(),
    );
    expect(runQuery).not.toHaveBeenCalledWith(
      expect.objectContaining({
        _name: "registryArtifactBackups:getPackageRegistryArtifactBackupPageInternal",
      }),
      expect.anything(),
    );
  });

  it("skips queued skill version retries after the skill is no longer public", async () => {
    const dueJob = {
      _id: "registryArtifactBackupJobs:hidden",
      targetKind: "skillVersion",
      skillVersionId: "skillVersions:hidden",
      status: "pending",
      attempts: 0,
      nextRunAt: 1,
      createdAt: 1,
      updatedAt: 1,
    };
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce([dueJob])
      .mockResolvedValueOnce({
        _id: "skillVersions:hidden",
        skillId: "skills:hidden",
        version: "1.0.0",
        createdAt: 1,
        files: [],
        softDeletedAt: undefined,
      })
      .mockResolvedValueOnce({
        _id: "skills:hidden",
        ownerUserId: "users:owner",
        ownerPublisherId: undefined,
        slug: "hidden-skill",
        displayName: "Hidden Skill",
        latestVersionId: "skillVersions:hidden",
        softDeletedAt: undefined,
        moderationStatus: "hidden",
      })
      .mockResolvedValueOnce({ stale: 0, exhausted: 0 });
    const runMutation = vi.fn();

    const result = await processRegistryArtifactBackupRetriesInternalHandler(
      { runQuery, runMutation } as never,
      {},
    );

    expect(result.stats.retryJobsProcessed).toBe(1);
    expect(result.stats.retryJobsSucceeded).toBe(1);
    expect(registryBackupMocks.backupSkillVersionToObjectStorage).not.toHaveBeenCalled();
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ jobId: "registryArtifactBackupJobs:hidden" }),
    );
  });
});

describe("registry artifact backup jobs", () => {
  it("upserts package release backup failures into a retryable backlog", async () => {
    const now = 1_700_000_000_000;
    const existing = {
      _id: "registryArtifactBackupJobs:existing",
      targetKind: "packageRelease",
      packageReleaseId: "packageReleases:demo" as Id<"packageReleases">,
      status: "pending",
      attempts: 1,
      createdAt: now - 1000,
      updatedAt: now - 1000,
      nextRunAt: now - 1000,
    };
    const patch = vi.fn();
    const ctx = {
      db: {
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({ unique: vi.fn().mockResolvedValue(existing) })),
        })),
        insert: vi.fn(),
        patch,
      },
    };

    await enqueueRegistryArtifactBackupJobHandler(ctx as never, {
      targetKind: "packageRelease",
      packageReleaseId: "packageReleases:demo" as Id<"packageReleases">,
      reason: "publish",
      error: "R2 500",
      now,
    });

    expect(ctx.db.insert).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledWith("registryArtifactBackupJobs:existing", {
      status: "pending",
      reason: "publish",
      attempts: 0,
      lastError: "R2 500",
      nextRunAt: now,
      createdAt: now,
      updatedAt: now,
      exhaustedAt: undefined,
      completedAt: undefined,
    });
  });

  it("reports stale and exhausted backup jobs for alerting", async () => {
    const now = 1_700_000_000_000;
    const pendingJobs = [
      {
        _id: "registryArtifactBackupJobs:stale",
        targetKind: "packageRelease",
        packageReleaseId: "packageReleases:stale",
        status: "pending",
        attempts: 2,
        createdAt: now - 49 * 60 * 60 * 1000,
        updatedAt: now - 60 * 60 * 1000,
        nextRunAt: now - 1000,
      },
      {
        _id: "registryArtifactBackupJobs:extra",
        targetKind: "packageRelease",
        packageReleaseId: "packageReleases:extra",
        status: "pending",
        attempts: 1,
        createdAt: now - 60 * 60 * 1000,
        updatedAt: now - 1000,
        nextRunAt: now - 1000,
      },
    ];
    const exhaustedJobs = [
      {
        _id: "registryArtifactBackupJobs:exhausted",
        targetKind: "skillVersion",
        skillVersionId: "skillVersions:exhausted",
        status: "exhausted",
        attempts: 8,
        createdAt: now - 10 * 60 * 60 * 1000,
        updatedAt: now - 1000,
        nextRunAt: now - 1000,
      },
    ];
    const take = vi.fn((limit: number) => {
      if (take.mock.calls.length === 1) return Promise.resolve(pendingJobs.slice(0, limit));
      return Promise.resolve(exhaustedJobs.slice(0, limit));
    });
    const ctx = {
      db: {
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            take,
          })),
        })),
      },
    };

    const result = await getRegistryArtifactBackupHealthHandler(ctx as never, {
      now,
      staleAfterMs: 24 * 60 * 60 * 1000,
      sampleLimit: 1,
    });

    expect(take).toHaveBeenNthCalledWith(1, 2);
    expect(take).toHaveBeenNthCalledWith(2, 2);
    expect(result).toMatchObject({
      pending: 1,
      stale: 1,
      exhausted: 1,
      oldestPendingAgeMs: 49 * 60 * 60 * 1000,
      pendingCapped: true,
      exhaustedCapped: false,
    });
  });
});
