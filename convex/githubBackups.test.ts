import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "./_generated/dataModel";
import {
  enqueueRegistryArtifactBackupJobHandler,
  getRegistryArtifactBackupHealthHandler,
  getGitHubBackupPageInternal,
  getPackageGitHubBackupPageInternal,
} from "./githubBackups";
import { syncGitHubBackupsInternalHandler } from "./githubBackupsNode";

const githubBackupMocks = vi.hoisted(() => ({
  backupPackageReleaseToGitHub: vi.fn(),
  backupSkillToGitHub: vi.fn(),
  deleteGitHubSkillBackup: vi.fn(),
  fetchGitHubPackageReleaseMeta: vi.fn(),
  fetchGitHubSkillMeta: vi.fn(),
  getGitHubBackupContext: vi.fn(),
  isGitHubBackupConfigured: vi.fn(),
  listGitHubSkillBackupEntries: vi.fn(),
  normalizeOwner: vi.fn((value: string) => value),
}));

vi.mock("./lib/githubBackup", () => githubBackupMocks);

const handler = (getGitHubBackupPageInternal as unknown as { _handler: Function })._handler;
const packagePageHandler = (getPackageGitHubBackupPageInternal as unknown as { _handler: Function })
  ._handler;

beforeEach(() => {
  vi.clearAllMocks();
  githubBackupMocks.getGitHubBackupContext.mockResolvedValue({
    token: "token",
    repo: "openclaw/clawhub-backup",
    repoOwner: "openclaw",
    repoName: "clawhub-backup",
    branch: "main",
    root: "skills",
    packageRoot: "packages",
  });
  githubBackupMocks.isGitHubBackupConfigured.mockReturnValue(true);
  githubBackupMocks.listGitHubSkillBackupEntries.mockResolvedValue([]);
});

describe("githubBackups page filtering", () => {
  it("skips non-public digests (soft-deleted, hidden, removed)", async () => {
    const activeDigest = {
      _id: "skillSearchDigest:active",
      skillId: "skills:active",
      slug: "active-skill",
      displayName: "Active Skill",
      ownerUserId: "users:active",
      ownerHandle: "alice",
      latestVersionId: "skillVersions:active",
      latestVersionSummary: {
        version: "1.0.0",
        createdAt: 1_700_000_000_000,
        changelog: "init",
      },
      softDeletedAt: undefined,
      moderationStatus: "active",
    };

    const hiddenDigest = {
      _id: "skillSearchDigest:hidden",
      skillId: "skills:hidden",
      slug: "hidden-skill",
      displayName: "Hidden Skill",
      ownerUserId: "users:hidden",
      ownerHandle: "bob",
      latestVersionId: "skillVersions:hidden",
      latestVersionSummary: {
        version: "1.0.0",
        createdAt: 1_700_000_000_000,
        changelog: "init",
      },
      softDeletedAt: undefined,
      moderationStatus: "hidden",
    };

    const removedDigest = {
      _id: "skillSearchDigest:removed",
      skillId: "skills:removed",
      slug: "removed-skill",
      displayName: "Removed Skill",
      ownerUserId: "users:removed",
      ownerHandle: "carol",
      latestVersionId: "skillVersions:removed",
      latestVersionSummary: {
        version: "1.0.0",
        createdAt: 1_700_000_000_000,
        changelog: "init",
      },
      softDeletedAt: undefined,
      moderationStatus: "removed",
    };

    const softDeletedDigest = {
      _id: "skillSearchDigest:soft",
      skillId: "skills:soft",
      slug: "soft-skill",
      displayName: "Soft Skill",
      ownerUserId: "users:soft",
      ownerHandle: "dave",
      latestVersionId: "skillVersions:soft",
      latestVersionSummary: {
        version: "1.0.0",
        createdAt: 1_700_000_000_000,
        changelog: "init",
      },
      softDeletedAt: 1,
      moderationStatus: "active",
    };

    const paginate = vi.fn().mockResolvedValue({
      page: [activeDigest, hiddenDigest, removedDigest, softDeletedDigest],
      isDone: true,
      continueCursor: null,
    });
    const order = vi.fn().mockReturnValue({ paginate });
    const query = vi.fn().mockReturnValue({ order });

    const result = await handler(
      {
        db: { query },
      } as never,
      { batchSize: 50 },
    );

    expect(query).toHaveBeenCalledWith("skillSearchDigest");
    expect(result).toMatchObject({
      isDone: true,
      cursor: null,
      items: [
        {
          kind: "ok",
          slug: "active-skill",
          ownerHandle: "alice",
          version: "1.0.0",
        },
      ],
    });
  });

  it("keeps legacy digests with undefined moderationStatus eligible", async () => {
    const legacyDigest = {
      _id: "skillSearchDigest:legacy",
      skillId: "skills:legacy",
      slug: "legacy-skill",
      displayName: "Legacy Skill",
      ownerUserId: "users:legacy",
      ownerHandle: "",
      latestVersionId: "skillVersions:legacy",
      latestVersionSummary: {
        version: "2.0.0",
        createdAt: 1_700_000_000_100,
        changelog: "update",
      },
      softDeletedAt: undefined,
      moderationStatus: undefined,
    };

    const paginate = vi.fn().mockResolvedValue({
      page: [legacyDigest],
      isDone: true,
      continueCursor: null,
    });
    const order = vi.fn().mockReturnValue({ paginate });
    const query = vi.fn().mockReturnValue({ order });

    const result = await handler(
      {
        db: { query },
      } as never,
      {},
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      kind: "ok",
      slug: "legacy-skill",
      ownerHandle: "users:legacy",
      version: "2.0.0",
    });
  });

  it("skips digests without ownerHandle or latestVersionSummary", async () => {
    const noOwnerHandle = {
      _id: "skillSearchDigest:no-owner",
      skillId: "skills:no-owner",
      slug: "no-owner",
      displayName: "No Owner",
      ownerUserId: "users:no-owner",
      ownerHandle: undefined,
      latestVersionId: "skillVersions:no-owner",
      latestVersionSummary: { version: "1.0.0", createdAt: 1, changelog: "init" },
      softDeletedAt: undefined,
      moderationStatus: "active",
    };
    const noVersion = {
      _id: "skillSearchDigest:no-version",
      skillId: "skills:no-version",
      slug: "no-version",
      displayName: "No Version",
      ownerUserId: "users:no-version",
      ownerHandle: "frank",
      latestVersionId: undefined,
      latestVersionSummary: undefined,
      softDeletedAt: undefined,
      moderationStatus: "active",
    };

    const paginate = vi.fn().mockResolvedValue({
      page: [noOwnerHandle, noVersion],
      isDone: true,
      continueCursor: null,
    });
    const order = vi.fn().mockReturnValue({ paginate });
    const query = vi.fn().mockReturnValue({ order });

    const result = await handler({ db: { query } } as never, {});

    expect(result.items).toEqual([
      { kind: "missingOwner", skillId: "skills:no-owner", ownerUserId: "users:no-owner" },
      { kind: "missingLatestVersion", skillId: "skills:no-version" },
    ]);
  });

  it("resets stale skills-table cursors after switching to digest pagination", async () => {
    const paginate = vi
      .fn()
      .mockRejectedValueOnce(new Error("cursor is from a different query"))
      .mockResolvedValueOnce({ page: [], isDone: true, continueCursor: null });
    const order = vi.fn().mockReturnValue({ paginate });
    const query = vi.fn().mockReturnValue({ order });

    const result = await handler({ db: { query } } as never, { cursor: "stale-cursor" });

    expect(result).toMatchObject({ items: [], isDone: true, cursor: null });
    expect(paginate).toHaveBeenNthCalledWith(1, { cursor: "stale-cursor", numItems: 50 });
    expect(paginate).toHaveBeenNthCalledWith(2, { cursor: null, numItems: 50 });
  });
});

describe("package github backup page filtering", () => {
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

describe("syncGitHubBackupsInternalHandler", () => {
  it("reports package cursor progress when skills are done but package releases remain", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({ items: [], cursor: null, isDone: true })
      .mockResolvedValueOnce({ items: [], cursor: "package-cursor", isDone: false })
      .mockResolvedValueOnce({ stale: 0, exhausted: 0 });

    const result = await syncGitHubBackupsInternalHandler(
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
      error: "GitHub 500",
      now,
    });

    expect(ctx.db.insert).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledWith("registryArtifactBackupJobs:existing", {
      status: "pending",
      reason: "publish",
      lastError: "GitHub 500",
      nextRunAt: now,
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
