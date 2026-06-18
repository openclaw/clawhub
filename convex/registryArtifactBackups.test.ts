import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "./_generated/dataModel";
import {
  claimRegistryArtifactBackupJobsHandler,
  enqueueRegistryArtifactBackupJobHandler,
  getDueRegistryArtifactBackupJobsInternal,
  getRegistryArtifactBackupHealthHandler,
  getRegistryArtifactBackupPageInternal,
  getPackageRegistryArtifactBackupPageInternal,
  markRegistryArtifactBackupJobSucceededHandler,
  releaseRegistryArtifactBackupRetryLeaseHandler,
  tryAcquireRegistryArtifactBackupRetryLeaseHandler,
} from "./registryArtifactBackups";
import {
  backupPackageForPublishInternal,
  backupSkillForPublishInternal,
  processRegistryArtifactBackupQueueInternalHandler,
  processRegistryArtifactBackupRetriesInternalHandler,
  seedRegistryArtifactBackupsInternalHandler,
} from "./registryArtifactBackupsNode";

const registryBackupMocks = vi.hoisted(() => {
  return {
    backupPackageReleaseToObjectStorage: vi.fn(),
    backupSkillVersionToObjectStorage: vi.fn(),
    fetchPackageReleaseBackupMeta: vi.fn(),
    fetchSkillVersionBackupMeta: vi.fn(),
    getRegistryArtifactBackupContext: vi.fn(),
    isRegistryArtifactBackupConfigured: vi.fn(),
  };
});

vi.mock("./lib/registryArtifactBackup", () => registryBackupMocks);

const handler = (getRegistryArtifactBackupPageInternal as unknown as { _handler: Function })
  ._handler;
const packagePageHandler = (
  getPackageRegistryArtifactBackupPageInternal as unknown as { _handler: Function }
)._handler;
const dueJobsHandler = (
  getDueRegistryArtifactBackupJobsInternal as unknown as { _handler: Function }
)._handler;
const backupSkillForPublishHandler = (
  backupSkillForPublishInternal as unknown as { _handler: Function }
)._handler;
const backupPackageForPublishHandler = (
  backupPackageForPublishInternal as unknown as { _handler: Function }
)._handler;

beforeEach(() => {
  vi.clearAllMocks();
  const backupContext = {
    endpoint: "https://account.r2.cloudflarestorage.com",
    bucket: "clawhub-registry-backup",
    accessKeyId: "access-key",
    secretAccessKey: "secret-key",
    region: "auto",
    skillsRoot: "skills",
    packagesRoot: "packages",
  };
  registryBackupMocks.getRegistryArtifactBackupContext.mockReturnValue(backupContext);
  registryBackupMocks.isRegistryArtifactBackupConfigured.mockReturnValue(true);
  registryBackupMocks.backupSkillVersionToObjectStorage.mockResolvedValue(undefined);
  registryBackupMocks.backupPackageReleaseToObjectStorage.mockResolvedValue(undefined);
});

function retryLeaseRunMutation(claimedJobs: Array<unknown> = []) {
  return vi.fn(async (_ref, args) => {
    if (args && typeof args === "object" && "token" in args) {
      return { acquired: true, released: true };
    }
    if (args && typeof args === "object" && "leaseToken" in args && "limit" in args) {
      return claimedJobs;
    }
    if (args && typeof args === "object" && "jobId" in args) {
      return { missing: false, stale: false, exhausted: false, attempts: 1 };
    }
    return undefined;
  });
}

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

    await backupSkillForPublishHandler(
      { runQuery, runMutation: retryLeaseRunMutation() } as never,
      {
        skillId: "skills:demo",
        versionId: "skillVersions:demo-1",
        slug: "stale-slug",
        version: "1.0.0",
        isLatest: true,
        displayName: "Stale Name",
        ownerHandle: "stale-owner",
        files: [],
        publishedAt: 1,
      },
    );

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

    await backupPackageForPublishHandler(
      { runQuery, runMutation: retryLeaseRunMutation() } as never,
      {
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
      },
    );

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
  it("can seed the backup ledger without uploading artifacts inline", async () => {
    const runQuery = vi
      .fn()
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
            isLatest: true,
            ownerHandle: "alice",
            publishedAt: 1,
          },
        ],
        cursor: null,
        isDone: true,
      })
      .mockResolvedValueOnce({ cursor: null })
      .mockResolvedValueOnce({
        items: [
          {
            kind: "ok",
            packageId: "packages:demo",
            releaseId: "packageReleases:demo-1",
            ownerHandle: "alice",
            packageName: "@openclaw/demo",
            normalizedName: "@openclaw/demo",
            displayName: "Demo",
            family: "code-plugin",
            version: "1.0.0",
            isLatest: true,
            publishedAt: 1,
            artifactStorageId: "storage:artifact",
            files: [],
          },
          {
            kind: "missingArtifact",
            releaseId: "packageReleases:missing",
            packageId: "packages:missing",
          },
        ],
        cursor: null,
        isDone: true,
      })
      .mockResolvedValueOnce({ stale: 0, exhausted: 0 });
    const runMutation = retryLeaseRunMutation();

    const result = await seedRegistryArtifactBackupsInternalHandler(
      { runQuery, runMutation } as never,
      { queueOnly: true, batchSize: 2, maxBatches: 1 },
    );

    expect(result.stats.skillsEnqueued).toBe(1);
    expect(result.stats.packagesEnqueued).toBe(1);
    expect(result.stats.packagesMissingArtifact).toBe(1);
    expect(registryBackupMocks.fetchSkillVersionBackupMeta).not.toHaveBeenCalled();
    expect(registryBackupMocks.backupSkillVersionToObjectStorage).not.toHaveBeenCalled();
    expect(registryBackupMocks.backupPackageReleaseToObjectStorage).not.toHaveBeenCalled();
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        targetKind: "skillVersion",
        skillVersionId: "skillVersions:demo-1",
        reason: "seed",
        preserveTerminal: true,
      }),
    );
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        targetKind: "packageRelease",
        packageReleaseId: "packageReleases:demo-1",
        reason: "seed",
        preserveTerminal: true,
      }),
    );
  });

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
    const runMutation = retryLeaseRunMutation();

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
  it("skips retry drain when another retry action holds the lease", async () => {
    const runMutation = vi.fn().mockResolvedValueOnce({ acquired: false });
    const runQuery = vi.fn();

    const result = await processRegistryArtifactBackupRetriesInternalHandler(
      { runQuery, runMutation } as never,
      {},
    );

    expect(result.stats.retryJobsProcessed).toBe(0);
    expect(runQuery).not.toHaveBeenCalled();
    expect(registryBackupMocks.backupPackageReleaseToObjectStorage).not.toHaveBeenCalled();
  });

  it("releases the retry lease after draining jobs", async () => {
    const runMutation = retryLeaseRunMutation();
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ stale: 0, exhausted: 0 });

    await processRegistryArtifactBackupRetriesInternalHandler(
      { runQuery, runMutation } as never,
      {},
    );

    const token = runMutation.mock.calls[0]?.[1]?.token;
    expect(typeof token).toBe("string");
    expect(runMutation.mock.calls.at(-1)?.[1]).toMatchObject({ token });
  });

  it("can force pending retry jobs regardless of nextRunAt for operator drains", async () => {
    const runMutation = retryLeaseRunMutation();
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ stale: 0, exhausted: 0 });

    await processRegistryArtifactBackupRetriesInternalHandler({ runQuery, runMutation } as never, {
      forceDue: true,
    });

    expect(runMutation.mock.calls[1]?.[1]).toMatchObject({ forceDue: true });
  });

  it("backs up retry artifacts without acquiring per-index leases", async () => {
    const jobs = [makeSkillBackupJob("demo", "skillVersions:demo")];
    const skill = {
      ...makeSkill("skills:demo", "demo-skill"),
      latestVersionId: "skillVersions:demo",
    };
    const owner = {
      _id: "users:owner",
      handle: "alice",
      deletedAt: undefined,
      deactivatedAt: undefined,
    };
    const runQuery = vi.fn(async (_ref, args) => {
      if ("limit" in args) return jobs;
      if (args.versionId) return makeSkillVersion("skillVersions:demo", "skills:demo", "1.0.0");
      if (args.skillId === "skills:demo") return skill;
      if (args.userId === "users:owner") return owner;
      if ("staleAfterMs" in args) return { stale: 0, exhausted: 0 };
      throw new Error(`unexpected query ${JSON.stringify(args)}`);
    });
    const runMutation = retryLeaseRunMutation(jobs);
    registryBackupMocks.fetchSkillVersionBackupMeta.mockResolvedValue(null);

    const result = await processRegistryArtifactBackupRetriesInternalHandler(
      { runQuery, runMutation } as never,
      {},
    );

    expect(result.stats.retryJobsSucceeded).toBe(1);
    expect(registryBackupMocks.backupSkillVersionToObjectStorage).toHaveBeenCalledOnce();
    expect(runMutation.mock.calls.some((call) => "indexPath" in (call[1] ?? {}))).toBe(false);
  });

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
    const runMutation = retryLeaseRunMutation([dueJob]);

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

  it("requests a larger retry batch so publish bursts drain promptly", async () => {
    const runMutation = retryLeaseRunMutation();
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ stale: 0, exhausted: 0 });

    await processRegistryArtifactBackupRetriesInternalHandler(
      { runQuery, runMutation } as never,
      {},
    );

    expect(runMutation.mock.calls[1]?.[1]).toMatchObject({
      includeExhaustedRepair: true,
      limit: 500,
      maxRepairAttempts: 16,
    });
  });

  it("uses a unique queue lease token even with a stable worker id", async () => {
    const runMutation = vi.fn().mockResolvedValueOnce([]);
    const runQuery = vi.fn().mockResolvedValueOnce({ stale: 0, exhausted: 0 });

    await processRegistryArtifactBackupQueueInternalHandler({ runQuery, runMutation } as never, {
      workerId: "worker-a",
      limit: 1,
    });

    const leaseToken = runMutation.mock.calls[0]?.[1]?.leaseToken;
    expect(leaseToken).not.toBe("worker-a");
    expect(leaseToken).toEqual(expect.stringMatching(/^worker-a-\d+-[a-z0-9]+$/));
  });

  it("gives repaired exhausted jobs a finite second retry budget", async () => {
    const dueJob = {
      _id: "registryArtifactBackupJobs:demo",
      targetKind: "skillVersion",
      skillVersionId: "skillVersions:demo",
      status: "exhausted",
      attempts: 8,
      nextRunAt: 1,
      createdAt: 1,
      updatedAt: 1,
    };
    const version = {
      _id: "skillVersions:demo",
      skillId: "skills:demo",
      version: "1.0.0",
      createdAt: 1,
      files: [{ path: "SKILL.md", size: 5, storageId: "storage:skill", sha256: "sha" }],
      softDeletedAt: undefined,
    };
    const skill = {
      _id: "skills:demo",
      ownerUserId: "users:owner",
      ownerPublisherId: undefined,
      slug: "demo-skill",
      displayName: "Demo Skill",
      latestVersionId: "skillVersions:demo",
      softDeletedAt: undefined,
      moderationStatus: "active",
    };
    const owner = {
      _id: "users:owner",
      handle: "alice",
      deletedAt: undefined,
      deactivatedAt: undefined,
    };
    const runQuery = vi.fn(async (_ref, args) => {
      if ("limit" in args) return [dueJob];
      if (args.versionId === "skillVersions:demo") return version;
      if (args.skillId === "skills:demo") return skill;
      if (args.userId === "users:owner") return owner;
      if ("staleAfterMs" in args) return { stale: 0, exhausted: 0 };
      throw new Error(`unexpected query ${JSON.stringify(args)}`);
    });
    registryBackupMocks.fetchSkillVersionBackupMeta.mockResolvedValue(null);
    registryBackupMocks.backupSkillVersionToObjectStorage.mockRejectedValueOnce(
      new Error("R2 still down"),
    );
    const runMutation = retryLeaseRunMutation([dueJob]);

    const result = await processRegistryArtifactBackupRetriesInternalHandler(
      { runQuery, runMutation } as never,
      {},
    );

    expect(result.stats.retryJobsFailed).toBe(1);
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        jobId: "registryArtifactBackupJobs:demo",
        error: "R2 still down",
        maxAttempts: 16,
      }),
    );
  });

  it("marks skill retries succeeded without reuploading when version metadata already exists", async () => {
    const dueJob = {
      _id: "registryArtifactBackupJobs:demo",
      targetKind: "skillVersion",
      skillVersionId: "skillVersions:demo",
      status: "pending",
      attempts: 1,
      nextRunAt: 1,
      createdAt: 1,
      updatedAt: 1,
    };
    const version = {
      _id: "skillVersions:demo",
      skillId: "skills:demo",
      version: "1.0.0",
      createdAt: 1,
      files: [{ path: "SKILL.md", size: 5, storageId: "storage:skill", sha256: "sha" }],
      softDeletedAt: undefined,
    };
    const skill = {
      _id: "skills:demo",
      ownerUserId: "users:owner",
      ownerPublisherId: undefined,
      slug: "demo-skill",
      displayName: "Demo Skill",
      latestVersionId: "skillVersions:demo",
      softDeletedAt: undefined,
      moderationStatus: "active",
    };
    const owner = {
      _id: "users:owner",
      handle: "alice",
      deletedAt: undefined,
      deactivatedAt: undefined,
    };
    const runQuery = vi.fn(async (_ref, args) => {
      if ("limit" in args) return [dueJob];
      if (args.versionId === "skillVersions:demo") {
        return version;
      }
      if (args.skillId === "skills:demo") return skill;
      if (args.userId === "users:owner") return owner;
      if ("staleAfterMs" in args) return { stale: 0, exhausted: 0 };
      throw new Error(`unexpected query ${JSON.stringify(args)}`);
    });
    registryBackupMocks.fetchSkillVersionBackupMeta.mockResolvedValueOnce({
      version: "1.0.0",
      restore: { versionId: "skillVersions:demo" },
    });
    const runMutation = retryLeaseRunMutation([dueJob]);

    const result = await processRegistryArtifactBackupRetriesInternalHandler(
      { runQuery, runMutation } as never,
      {},
    );

    expect(result.stats.retryJobsSucceeded).toBe(1);
    expect(registryBackupMocks.backupSkillVersionToObjectStorage).not.toHaveBeenCalled();
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ jobId: "registryArtifactBackupJobs:demo" }),
    );
  });

  it("marks multiple skill retries succeeded from matching version metadata", async () => {
    const jobs = [
      makeSkillBackupJob("demo-1", "skillVersions:demo-1"),
      makeSkillBackupJob("demo-2", "skillVersions:demo-2"),
    ];
    const versions = new Map([
      ["skillVersions:demo-1", makeSkillVersion("skillVersions:demo-1", "skills:demo", "1.0.0")],
      ["skillVersions:demo-2", makeSkillVersion("skillVersions:demo-2", "skills:demo", "1.1.0")],
    ]);
    const skill = {
      ...makeSkill("skills:demo", "demo-skill"),
      latestVersionId: "skillVersions:demo-2",
    };
    const owner = {
      _id: "users:owner",
      handle: "alice",
      deletedAt: undefined,
      deactivatedAt: undefined,
    };
    const runQuery = vi.fn(async (_ref, args) => {
      if ("limit" in args) return jobs;
      if (args.versionId) return versions.get(args.versionId) ?? null;
      if (args.skillId === "skills:demo") return skill;
      if (args.userId === "users:owner") return owner;
      if ("staleAfterMs" in args) return { stale: 0, exhausted: 0 };
      throw new Error(`unexpected query ${JSON.stringify(args)}`);
    });
    const versionIdsByVersion = new Map([
      ["1.0.0", "skillVersions:demo-1"],
      ["1.1.0", "skillVersions:demo-2"],
    ]);
    registryBackupMocks.fetchSkillVersionBackupMeta.mockImplementation(
      async (_context, _ownerHandle, _slug, version) => ({
        version,
        restore: { versionId: versionIdsByVersion.get(version) },
      }),
    );

    const result = await processRegistryArtifactBackupRetriesInternalHandler(
      { runQuery, runMutation: retryLeaseRunMutation(jobs) } as never,
      {},
    );

    expect(result.stats.retryJobsSucceeded).toBe(2);
    expect(result.stats.retryJobsFailed).toBe(0);
    expect(registryBackupMocks.backupSkillVersionToObjectStorage).not.toHaveBeenCalled();
    expect(registryBackupMocks.fetchSkillVersionBackupMeta).toHaveBeenCalledTimes(2);
  });

  it("marks package retries succeeded from matching version metadata", async () => {
    const jobs = [
      makePackageBackupJob("demo-1", "packageReleases:demo-1"),
      makePackageBackupJob("demo-2", "packageReleases:demo-2"),
    ];
    const releases = new Map([
      [
        "packageReleases:demo-1",
        makePackageRelease("packageReleases:demo-1", "packages:demo", "1.0.0"),
      ],
      [
        "packageReleases:demo-2",
        makePackageRelease("packageReleases:demo-2", "packages:demo", "1.1.0"),
      ],
    ]);
    const pkg = makePackage("packages:demo", "@openclaw/demo");
    const owner = {
      _id: "users:owner",
      handle: "alice",
      deletedAt: undefined,
      deactivatedAt: undefined,
    };
    const runQuery = vi.fn(async (_ref, args) => {
      if ("limit" in args) return jobs;
      if (args.releaseId) return releases.get(args.releaseId) ?? null;
      if (args.packageId === "packages:demo") return pkg;
      if (args.userId === "users:owner") return owner;
      if ("staleAfterMs" in args) return { stale: 0, exhausted: 0 };
      throw new Error(`unexpected query ${JSON.stringify(args)}`);
    });
    const releaseIdsByVersion = new Map([
      ["1.0.0", "packageReleases:demo-1"],
      ["1.1.0", "packageReleases:demo-2"],
    ]);
    const shaByVersion = new Map([
      ["1.0.0", "sha:packageReleases:demo-1"],
      ["1.1.0", "sha:packageReleases:demo-2"],
    ]);
    registryBackupMocks.fetchPackageReleaseBackupMeta.mockImplementation(
      async (_context, _ownerHandle, _normalizedName, version) => ({
        restore: { releaseId: releaseIdsByVersion.get(version) },
        artifact: { sha256: shaByVersion.get(version) },
      }),
    );

    const result = await processRegistryArtifactBackupRetriesInternalHandler(
      { runQuery, runMutation: retryLeaseRunMutation(jobs) } as never,
      {},
    );

    expect(result.stats.retryJobsSucceeded).toBe(2);
    expect(result.stats.retryJobsFailed).toBe(0);
    expect(registryBackupMocks.backupPackageReleaseToObjectStorage).not.toHaveBeenCalled();
    expect(registryBackupMocks.fetchPackageReleaseBackupMeta).toHaveBeenCalledTimes(2);
  });

  it("processes different retry roots in parallel while keeping one root sequential", async () => {
    const jobs = [
      makeSkillBackupJob("same-1", "skillVersions:same-1"),
      makeSkillBackupJob("same-2", "skillVersions:same-2"),
      makeSkillBackupJob("other", "skillVersions:other"),
    ];
    const versions = new Map([
      ["skillVersions:same-1", makeSkillVersion("skillVersions:same-1", "skills:same", "1.0.0")],
      ["skillVersions:same-2", makeSkillVersion("skillVersions:same-2", "skills:same", "1.1.0")],
      ["skillVersions:other", makeSkillVersion("skillVersions:other", "skills:other", "1.0.0")],
    ]);
    const skills = new Map([
      ["skills:same", makeSkill("skills:same", "same-root")],
      ["skills:other", makeSkill("skills:other", "other-root")],
    ]);
    const owner = {
      _id: "users:owner",
      handle: "alice",
      deletedAt: undefined,
      deactivatedAt: undefined,
    };
    const runQuery = vi.fn(async (_ref, args) => {
      if ("limit" in args) return jobs;
      if (args.versionId) return versions.get(args.versionId) ?? null;
      if (args.skillId) return skills.get(args.skillId) ?? null;
      if (args.userId) return owner;
      if ("staleAfterMs" in args) return { stale: 0, exhausted: 0 };
      throw new Error(`unexpected query ${JSON.stringify(args)}`);
    });
    registryBackupMocks.fetchSkillVersionBackupMeta.mockResolvedValue(null);

    const activeByRoot = new Map<string, number>();
    let maxActiveTotal = 0;
    let activeTotal = 0;
    registryBackupMocks.backupSkillVersionToObjectStorage.mockImplementation(async (_ctx, item) => {
      const root = `${item.ownerHandle}/${item.slug}`;
      const active = activeByRoot.get(root) ?? 0;
      if (active > 0) {
        throw new Error(`same root overlapped: ${root}`);
      }
      activeByRoot.set(root, active + 1);
      activeTotal += 1;
      maxActiveTotal = Math.max(maxActiveTotal, activeTotal);
      await new Promise((resolve) => setTimeout(resolve, 10));
      activeTotal -= 1;
      activeByRoot.set(root, active);
    });

    const result = await processRegistryArtifactBackupRetriesInternalHandler(
      { runQuery, runMutation: retryLeaseRunMutation(jobs) } as never,
      {},
    );

    expect(result.stats.retryJobsSucceeded).toBe(3);
    expect(result.stats.retryJobsFailed).toBe(0);
    expect(maxActiveTotal).toBeGreaterThan(1);
  });

  it("caps parallel full-artifact retry work by estimated bytes", async () => {
    const jobs = [
      makePackageBackupJob("one", "packageReleases:one"),
      makePackageBackupJob("two", "packageReleases:two"),
      makePackageBackupJob("three", "packageReleases:three"),
    ];
    const releases = new Map([
      ["packageReleases:one", makePackageRelease("packageReleases:one", "packages:one")],
      ["packageReleases:two", makePackageRelease("packageReleases:two", "packages:two")],
      ["packageReleases:three", makePackageRelease("packageReleases:three", "packages:three")],
    ]);
    const packages = new Map([
      ["packages:one", makePackage("packages:one", "@openclaw/one")],
      ["packages:two", makePackage("packages:two", "@openclaw/two")],
      ["packages:three", makePackage("packages:three", "@openclaw/three")],
    ]);
    const owner = {
      _id: "users:owner",
      handle: "alice",
      deletedAt: undefined,
      deactivatedAt: undefined,
    };
    const runQuery = vi.fn(async (_ref, args) => {
      if ("limit" in args) return jobs;
      if (args.releaseId) return releases.get(args.releaseId) ?? null;
      if (args.packageId) return packages.get(args.packageId) ?? null;
      if (args.userId) return owner;
      if ("staleAfterMs" in args) return { stale: 0, exhausted: 0 };
      throw new Error(`unexpected query ${JSON.stringify(args)}`);
    });
    registryBackupMocks.fetchPackageReleaseBackupMeta.mockResolvedValue(null);

    let activeTotal = 0;
    let maxActiveTotal = 0;
    registryBackupMocks.backupPackageReleaseToObjectStorage.mockImplementation(async () => {
      activeTotal += 1;
      maxActiveTotal = Math.max(maxActiveTotal, activeTotal);
      await new Promise((resolve) => setTimeout(resolve, 10));
      activeTotal -= 1;
    });

    const result = await processRegistryArtifactBackupRetriesInternalHandler(
      { runQuery, runMutation: retryLeaseRunMutation(jobs) } as never,
      {},
    );

    expect(result.stats.retryJobsSucceeded).toBe(3);
    expect(maxActiveTotal).toBe(1);
  });

  it("keeps retry source lookup failures isolated to their own jobs", async () => {
    const jobs = [
      makeSkillBackupJob("bad", "skillVersions:bad"),
      makeSkillBackupJob("good", "skillVersions:good"),
    ];
    const goodVersion = makeSkillVersion("skillVersions:good", "skills:good", "1.0.0");
    const goodSkill = makeSkill("skills:good", "good-root");
    const owner = {
      _id: "users:owner",
      handle: "alice",
      deletedAt: undefined,
      deactivatedAt: undefined,
    };
    const runQuery = vi.fn(async (_ref, args) => {
      if ("limit" in args) return jobs;
      if (args.versionId === "skillVersions:bad") throw new Error("lookup failed");
      if (args.versionId === "skillVersions:good") return goodVersion;
      if (args.skillId === "skills:good") return goodSkill;
      if (args.userId === "users:owner") return owner;
      if ("staleAfterMs" in args) return { stale: 0, exhausted: 0 };
      throw new Error(`unexpected query ${JSON.stringify(args)}`);
    });
    const runMutation = retryLeaseRunMutation(jobs);
    registryBackupMocks.fetchSkillVersionBackupMeta.mockResolvedValue(null);

    const result = await processRegistryArtifactBackupRetriesInternalHandler(
      { runQuery, runMutation } as never,
      {},
    );

    expect(result.stats.retryJobsProcessed).toBe(2);
    expect(result.stats.retryJobsSucceeded).toBe(1);
    expect(result.stats.retryJobsFailed).toBe(1);
    expect(registryBackupMocks.backupSkillVersionToObjectStorage).toHaveBeenCalledOnce();
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        jobId: "registryArtifactBackupJobs:bad",
        error: "lookup failed",
      }),
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
    const runMutation = retryLeaseRunMutation([dueJob]);

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

function makeSkillBackupJob(suffix: string, skillVersionId: string) {
  return {
    _id: `registryArtifactBackupJobs:${suffix}`,
    targetKind: "skillVersion",
    skillVersionId,
    status: "pending",
    attempts: 0,
    nextRunAt: 1,
    createdAt: 1,
    updatedAt: 1,
  };
}

function makeSkillVersion(id: string, skillId: string, version: string) {
  return {
    _id: id,
    skillId,
    version,
    createdAt: 1,
    files: [{ path: "SKILL.md", size: 5, storageId: `storage:${id}`, sha256: `sha:${id}` }],
    softDeletedAt: undefined,
  };
}

function makeSkill(id: string, slug: string) {
  return {
    _id: id,
    ownerUserId: "users:owner",
    ownerPublisherId: undefined,
    slug,
    displayName: slug,
    latestVersionId: "skillVersions:latest",
    softDeletedAt: undefined,
    moderationStatus: "active",
  };
}

function makePackageBackupJob(suffix: string, packageReleaseId: string) {
  return {
    _id: `registryArtifactBackupJobs:${suffix}`,
    targetKind: "packageRelease",
    packageReleaseId,
    status: "pending",
    attempts: 0,
    nextRunAt: 1,
    createdAt: 1,
    updatedAt: 1,
  };
}

function makePackageRelease(id: string, packageId: string, version = "1.0.0") {
  return {
    _id: id,
    packageId,
    version,
    createdAt: 1,
    files: [],
    clawpackStorageId: `storage:${id}`,
    clawpackSha256: `sha:${id}`,
    clawpackSize: 120 * 1024 * 1024,
    clawpackFormat: "tgz",
    softDeletedAt: undefined,
  };
}

function makePackage(id: string, name: string) {
  return {
    _id: id,
    ownerUserId: "users:owner",
    ownerPublisherId: undefined,
    name,
    normalizedName: name,
    displayName: name,
    family: "code-plugin",
    latestReleaseId: "packageReleases:latest",
    softDeletedAt: undefined,
  };
}

describe("registry artifact backup jobs", () => {
  it("ignores stale worker completion after a job lease is reclaimed", async () => {
    const now = 1_700_000_000_000;
    const job = {
      _id: "registryArtifactBackupJobs:demo",
      status: "running",
      leaseToken: "worker-b",
    };
    const ctx = {
      db: {
        get: vi.fn().mockResolvedValue(job),
        patch: vi.fn(),
      },
    };

    const result = await markRegistryArtifactBackupJobSucceededHandler(ctx as never, {
      jobId: "registryArtifactBackupJobs:demo" as Id<"registryArtifactBackupJobs">,
      leaseToken: "worker-a",
      now,
    });

    expect(result).toEqual({ missing: false, stale: true });
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it("ignores worker completion after a leased job is requeued", async () => {
    const now = 1_700_000_000_000;
    const job = {
      _id: "registryArtifactBackupJobs:demo",
      status: "pending",
      leaseToken: "worker-a",
    };
    const ctx = {
      db: {
        get: vi.fn().mockResolvedValue(job),
        patch: vi.fn(),
      },
    };

    const result = await markRegistryArtifactBackupJobSucceededHandler(ctx as never, {
      jobId: "registryArtifactBackupJobs:demo" as Id<"registryArtifactBackupJobs">,
      leaseToken: "worker-a",
      now,
    });

    expect(result).toEqual({ missing: false, stale: true });
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  it("claims pending and expired running jobs with a lease for parallel workers", async () => {
    const now = 1_700_000_000_000;
    const pendingJob = {
      _id: "registryArtifactBackupJobs:pending",
      status: "pending",
      nextRunAt: now - 1,
    };
    const expiredRunningJob = {
      _id: "registryArtifactBackupJobs:expired",
      status: "running",
      leaseExpiresAt: now - 1,
    };
    const pendingTake = vi.fn().mockResolvedValue([pendingJob]);
    const runningTake = vi.fn().mockResolvedValue([expiredRunningJob]);
    const patch = vi.fn();
    const withIndex = vi.fn((indexName: string) => ({
      take: indexName === "by_status_leaseExpiresAt" ? runningTake : pendingTake,
    }));
    const ctx = {
      db: {
        query: vi.fn(() => ({ withIndex })),
        patch,
      },
    };

    const result = await claimRegistryArtifactBackupJobsHandler(ctx as never, {
      now,
      limit: 2,
      leaseToken: "worker-1",
      leaseTtlMs: 60_000,
    });

    expect(result.map((job: { _id: string }) => job._id)).toEqual([
      "registryArtifactBackupJobs:pending",
      "registryArtifactBackupJobs:expired",
    ]);
    expect(patch).toHaveBeenCalledWith(
      "registryArtifactBackupJobs:pending",
      expect.objectContaining({
        status: "running",
        leaseToken: "worker-1",
        leaseExpiresAt: now + 60_000,
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      "registryArtifactBackupJobs:expired",
      expect.objectContaining({
        status: "running",
        leaseToken: "worker-1",
        leaseExpiresAt: now + 60_000,
      }),
    );
  });

  it("can force pending jobs without waiting for nextRunAt", async () => {
    const now = 1_700_000_000_000;
    const pendingJobs = [
      {
        _id: "registryArtifactBackupJobs:future",
        status: "pending",
        attempts: 1,
        nextRunAt: now + 60 * 60 * 1000,
      },
    ];
    const take = vi.fn((limit: number) => Promise.resolve(pendingJobs.slice(0, limit)));
    const lte = vi.fn();
    const withIndex = vi.fn(
      (
        _indexName: string,
        buildIndex: (q: {
          eq: (field: string, value: unknown) => { lte: (field: string, value: number) => unknown };
        }) => unknown,
      ) => {
        buildIndex({
          eq: () => ({
            lte,
          }),
        });
        return { take };
      },
    );
    const ctx = {
      db: {
        query: vi.fn(() => ({ withIndex })),
      },
    };

    const result = await dueJobsHandler(ctx as never, {
      ignoreNextRunAt: true,
      limit: 3,
      now,
    });

    expect(result).toEqual(pendingJobs);
    expect(lte).not.toHaveBeenCalled();
    expect(take).toHaveBeenCalledWith(3);
  });

  it("can include exhausted jobs that still have repair attempts left", async () => {
    const now = 1_700_000_000_000;
    const pendingJobs = [
      {
        _id: "registryArtifactBackupJobs:pending",
        status: "pending",
        attempts: 1,
        nextRunAt: now - 1000,
      },
    ];
    const exhaustedJobs = [
      {
        _id: "registryArtifactBackupJobs:maxed",
        status: "exhausted",
        attempts: 16,
        nextRunAt: now - 1000,
      },
      {
        _id: "registryArtifactBackupJobs:repairable",
        status: "exhausted",
        attempts: 8,
        nextRunAt: now - 1000,
      },
    ];
    let repairAttemptLimit = Number.POSITIVE_INFINITY;
    const pendingTake = vi.fn((limit: number) => Promise.resolve(pendingJobs.slice(0, limit)));
    const exhaustedTake = vi.fn((limit: number) =>
      Promise.resolve(
        exhaustedJobs.filter((job) => job.attempts < repairAttemptLimit).slice(0, limit),
      ),
    );
    const withIndex = vi.fn(
      (
        indexName: string,
        buildIndex:
          | ((q: {
              eq: (
                field: string,
                value: unknown,
              ) => {
                lt: (field: string, value: number) => unknown;
                lte: (field: string, value: number) => unknown;
              };
            }) => unknown)
          | undefined,
      ) => {
        buildIndex?.({
          eq: () => ({
            lt: (_field: string, value: number) => {
              repairAttemptLimit = value;
              return {};
            },
            lte: () => ({}),
          }),
        });
        return { take: indexName === "by_status_attempts" ? exhaustedTake : pendingTake };
      },
    );
    const ctx = {
      db: {
        query: vi.fn(() => ({ withIndex })),
      },
    };

    const result = await dueJobsHandler(ctx as never, {
      includeExhaustedRepair: true,
      limit: 3,
      maxRepairAttempts: 16,
      now,
    });

    expect(result.map((job: { _id: string }) => job._id)).toEqual([
      "registryArtifactBackupJobs:pending",
      "registryArtifactBackupJobs:repairable",
    ]);
    expect(withIndex).toHaveBeenNthCalledWith(1, "by_status_nextRunAt", expect.any(Function));
    expect(withIndex).toHaveBeenNthCalledWith(2, "by_status_attempts", expect.any(Function));
    expect(pendingTake).toHaveBeenCalledWith(3);
    expect(exhaustedTake).toHaveBeenCalledWith(2);
  });

  it("acquires a retry lease when no active lease exists", async () => {
    const now = 1_700_000_000_000;
    const insert = vi.fn();
    const ctx = {
      db: {
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({ unique: vi.fn().mockResolvedValue(null) })),
        })),
        insert,
        patch: vi.fn(),
      },
    };

    const result = await tryAcquireRegistryArtifactBackupRetryLeaseHandler(ctx as never, {
      now,
      token: "lease-token",
      ttlMs: 60_000,
    });

    expect(result).toEqual({ acquired: true });
    expect(insert).toHaveBeenCalledWith("registryArtifactBackupSyncState", {
      key: "retryLease",
      cursor: "lease-token",
      updatedAt: now,
    });
  });

  it("refuses a retry lease while a fresh lease exists", async () => {
    const now = 1_700_000_000_000;
    const existing = {
      _id: "registryArtifactBackupSyncState:lease",
      key: "retryLease",
      cursor: "other-token",
      updatedAt: now - 1_000,
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

    const result = await tryAcquireRegistryArtifactBackupRetryLeaseHandler(ctx as never, {
      now,
      token: "lease-token",
      ttlMs: 60_000,
    });

    expect(result).toEqual({ acquired: false, holderUpdatedAt: existing.updatedAt });
    expect(patch).not.toHaveBeenCalled();
  });

  it("acquires a retry lease after the previous lease was released", async () => {
    const now = 1_700_000_000_000;
    const existing = {
      _id: "registryArtifactBackupSyncState:lease",
      key: "retryLease",
      cursor: undefined,
      updatedAt: now - 1_000,
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

    const result = await tryAcquireRegistryArtifactBackupRetryLeaseHandler(ctx as never, {
      now,
      token: "new-token",
      ttlMs: 60_000,
    });

    expect(result).toEqual({ acquired: true });
    expect(patch).toHaveBeenCalledWith("registryArtifactBackupSyncState:lease", {
      cursor: "new-token",
      updatedAt: now,
    });
  });

  it("reclaims a stale retry lease", async () => {
    const now = 1_700_000_000_000;
    const existing = {
      _id: "registryArtifactBackupSyncState:lease",
      key: "retryLease",
      cursor: "old-token",
      updatedAt: now - 120_000,
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

    const result = await tryAcquireRegistryArtifactBackupRetryLeaseHandler(ctx as never, {
      now,
      token: "lease-token",
      ttlMs: 60_000,
    });

    expect(result).toEqual({ acquired: true });
    expect(patch).toHaveBeenCalledWith("registryArtifactBackupSyncState:lease", {
      cursor: "lease-token",
      updatedAt: now,
    });
  });

  it("releases only the matching retry lease token", async () => {
    const now = 1_700_000_000_000;
    const existing = {
      _id: "registryArtifactBackupSyncState:lease",
      key: "retryLease",
      cursor: "lease-token",
      updatedAt: now - 1_000,
    };
    const patch = vi.fn();
    const ctx = {
      db: {
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({ unique: vi.fn().mockResolvedValue(existing) })),
        })),
        patch,
      },
    };

    const result = await releaseRegistryArtifactBackupRetryLeaseHandler(ctx as never, {
      now,
      token: "lease-token",
    });

    expect(result).toEqual({ released: true });
    expect(patch).toHaveBeenCalledWith("registryArtifactBackupSyncState:lease", {
      cursor: undefined,
      updatedAt: now,
    });
  });

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
    expect(patch).toHaveBeenCalledWith(
      "registryArtifactBackupJobs:existing",
      expect.objectContaining({
        status: "pending",
        reason: "publish",
        attempts: 0,
        lastError: "R2 500",
        nextRunAt: now,
        createdAt: now,
        updatedAt: now,
        exhaustedAt: undefined,
        completedAt: undefined,
        leaseToken: undefined,
        leaseExpiresAt: undefined,
        claimedAt: undefined,
      }),
    );
  });

  it("reports stale, expired running, and exhausted backup jobs for alerting", async () => {
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
    const runningJobs = [
      {
        _id: "registryArtifactBackupJobs:running",
        targetKind: "skillVersion",
        skillVersionId: "skillVersions:running",
        status: "running",
        attempts: 1,
        createdAt: now - 60 * 60 * 1000,
        updatedAt: now - 1000,
        nextRunAt: now - 1000,
        leaseExpiresAt: now + 60 * 1000,
      },
      {
        _id: "registryArtifactBackupJobs:running-extra",
        targetKind: "skillVersion",
        skillVersionId: "skillVersions:running-extra",
        status: "running",
        attempts: 1,
        createdAt: now - 60 * 60 * 1000,
        updatedAt: now - 1000,
        nextRunAt: now - 1000,
        leaseExpiresAt: now + 60 * 1000,
      },
    ];
    const expiredRunningJobs = [
      {
        _id: "registryArtifactBackupJobs:expired-running",
        targetKind: "skillVersion",
        skillVersionId: "skillVersions:expired-running",
        status: "running",
        attempts: 1,
        createdAt: now - 60 * 60 * 1000,
        updatedAt: now - 1000,
        nextRunAt: now - 1000,
        leaseExpiresAt: now - 1000,
      },
    ];
    const pendingTake = vi.fn((limit: number) => Promise.resolve(pendingJobs.slice(0, limit)));
    const exhaustedTake = vi.fn((limit: number) => Promise.resolve(exhaustedJobs.slice(0, limit)));
    const runningTake = vi.fn((limit: number) => Promise.resolve(runningJobs.slice(0, limit)));
    const expiredRunningTake = vi.fn((limit: number) =>
      Promise.resolve(expiredRunningJobs.slice(0, limit)),
    );
    const takeByCall = [pendingTake, exhaustedTake, runningTake, expiredRunningTake];
    const withIndex = vi.fn(() => ({ take: takeByCall[withIndex.mock.calls.length - 1] }));
    const ctx = {
      db: {
        query: vi.fn(() => ({
          withIndex,
        })),
      },
    };

    const result = await getRegistryArtifactBackupHealthHandler(ctx as never, {
      now,
      staleAfterMs: 24 * 60 * 60 * 1000,
      sampleLimit: 1,
    });

    expect(pendingTake).toHaveBeenCalledWith(2);
    expect(exhaustedTake).toHaveBeenCalledWith(2);
    expect(runningTake).toHaveBeenCalledWith(2);
    expect(expiredRunningTake).toHaveBeenCalledWith(2);
    expect(result).toMatchObject({
      pending: 1,
      running: 1,
      expiredRunning: 1,
      stale: 2,
      exhausted: 1,
      oldestPendingAgeMs: 49 * 60 * 60 * 1000,
      pendingCapped: true,
      runningCapped: true,
      expiredRunningCapped: false,
      exhaustedCapped: false,
    });
  });
});
