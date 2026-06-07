/* @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
}));

vi.mock("./_generated/api", () => ({
  internal: {
    maintenance: {
      getSkillBackfillPageInternal: Symbol("getSkillBackfillPageInternal"),
      applySkillBackfillPatchInternal: Symbol("applySkillBackfillPatchInternal"),
      backfillSkillSummariesInternal: Symbol("backfillSkillSummariesInternal"),
      getUserStatsBackfillPageInternal: Symbol("getUserStatsBackfillPageInternal"),
      getUserOwnedSkillsBackfillPageInternal: Symbol("getUserOwnedSkillsBackfillPageInternal"),
      applyUserStatsBackfillPatchInternal: Symbol("applyUserStatsBackfillPatchInternal"),
      backfillUserStatsInternal: Symbol("backfillUserStatsInternal"),
      getPublisherStatsBackfillPageInternal: Symbol("getPublisherStatsBackfillPageInternal"),
      recomputePublisherStatsInternal: Symbol("recomputePublisherStatsInternal"),
      backfillPublisherStatsInternal: Symbol("backfillPublisherStatsInternal"),
      getSkillFingerprintBackfillPageInternal: Symbol("getSkillFingerprintBackfillPageInternal"),
      applySkillFingerprintBackfillPatchInternal: Symbol(
        "applySkillFingerprintBackfillPatchInternal",
      ),
      backfillSkillFingerprintsInternal: Symbol("backfillSkillFingerprintsInternal"),
      applySkillCapabilityTagsInternal: Symbol("applySkillCapabilityTagsInternal"),
      backfillSkillCapabilityTagsInternal: Symbol("backfillSkillCapabilityTagsInternal"),
      getDependencyRegistryScanCleanupPageInternal: Symbol(
        "getDependencyRegistryScanCleanupPageInternal",
      ),
      applyDependencyRegistryScanCleanupInternal: Symbol(
        "applyDependencyRegistryScanCleanupInternal",
      ),
      backfillDigestVersionSummary: Symbol("backfillDigestVersionSummary"),
      getEmptySkillCleanupPageInternal: Symbol("getEmptySkillCleanupPageInternal"),
      applyEmptySkillCleanupInternal: Symbol("applyEmptySkillCleanupInternal"),
      nominateUserForEmptySkillSpamInternal: Symbol("nominateUserForEmptySkillSpamInternal"),
      cleanupEmptySkillsInternal: Symbol("cleanupEmptySkillsInternal"),
      nominateEmptySkillSpammersInternal: Symbol("nominateEmptySkillSpammersInternal"),
      repairLegacyPublisherOwnership: Symbol("repairLegacyPublisherOwnership"),
    },
    skills: {
      backfillLatestSkillModerationInternal: Symbol("skills.backfillLatestSkillModerationInternal"),
      getVersionByIdInternal: Symbol("skills.getVersionByIdInternal"),
      getOwnerSkillActivityInternal: Symbol("skills.getOwnerSkillActivityInternal"),
    },
    skillCards: {
      enqueueForVersionInternal: Symbol("skillCards.enqueueForVersionInternal"),
    },
    securityScan: {
      enqueueSkillVersionScanInternal: Symbol("securityScan.enqueueSkillVersionScanInternal"),
    },
    users: {
      getByIdInternal: Symbol("users.getByIdInternal"),
    },
  },
}));

vi.mock("./lib/skillSummary", () => ({
  generateSkillSummary: vi.fn(),
}));

const {
  applyDependencyRegistryScanCleanupInternalHandler,
  cleanupDependencyRegistryScanDataHandler,
  cleanupDependencyRegistryScanDataInternalHandler,
  applySkillCapabilityTagsInternal,
  backfillDigestVersionSummary,
  backfillLatestVersionSummaryInternal,
  backfillPublisherStatsInternalHandler,
  backfillSkillSearchDigestInternal,
  backfillSkillFingerprintsInternalHandler,
  backfillSkillSummariesInternalHandler,
  backfillUserStatsInternalHandler,
  cleanupEmptySkillsInternalHandler,
  nominateEmptySkillSpammersInternalHandler,
  repairLegacyPublisherOwnershipForUserHandler,
  repairLegacyPublisherOwnershipHandler,
  upsertSkillBadgeRecordInternal,
} = await import("./maintenance");
const { internal } = await import("./_generated/api");
const { generateSkillSummary } = await import("./lib/skillSummary");
const { getAuthUserId } = await import("@convex-dev/auth/server");

beforeEach(() => {
  vi.mocked(getAuthUserId).mockReset();
  vi.mocked(getAuthUserId).mockResolvedValue(null);
});

function makeBlob(text: string) {
  return { text: () => Promise.resolve(text) } as unknown as Blob;
}

describe("maintenance dependency registry scan cleanup", () => {
  it("rejects non-admin public cleanup before scanning cleanup targets", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:caller" as never);
    const runQuery = vi.fn(async () => ({
      _id: "users:caller",
      role: "user",
      deletedAt: undefined,
      deactivatedAt: undefined,
    }));
    const runMutation = vi.fn();

    await expect(
      cleanupDependencyRegistryScanDataHandler({ runQuery, runMutation } as never, {
        batchSize: 25,
      }),
    ).rejects.toThrow("Forbidden");

    expect(runQuery).toHaveBeenCalledOnce();
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("allows admin public cleanup to delegate to the internal cleanup runner", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:admin" as never);
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("userId" in args) {
        return {
          _id: "users:admin",
          role: "admin",
          deletedAt: undefined,
          deactivatedAt: undefined,
        };
      }
      return {
        versionItems: [],
        skillItems: [],
        cacheRowIds: [],
        versionCursor: null,
        skillCursor: null,
        cacheCursor: null,
        versionsDone: true,
        skillsDone: true,
        cacheDone: true,
      };
    });
    const runMutation = vi.fn();

    const result = await cleanupDependencyRegistryScanDataHandler(
      { runQuery, runMutation } as never,
      { batchSize: 25 },
    );

    expect(result).toMatchObject({ ok: true, dryRun: true, isDone: true });
    expect(runQuery).toHaveBeenCalledTimes(2);
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("dry-runs by default and does not write", async () => {
    const runQuery = vi.fn(async () => ({
      versionItems: [
        {
          id: "skillVersions:legacy",
          hasDepRegistryAnalysis: true,
          hasDepRegistryScanStatus: true,
          hasLegacyStaticScan: true,
        },
      ],
      skillItems: [{ id: "skills:legacy", hasLegacyModeration: true }],
      cacheRowIds: ["depRegistryCache:1"],
      versionCursor: null,
      skillCursor: null,
      cacheCursor: null,
      versionsDone: true,
      skillsDone: true,
      cacheDone: true,
    }));
    const runMutation = vi.fn();

    const result = await cleanupDependencyRegistryScanDataInternalHandler(
      { runQuery, runMutation } as never,
      { batchSize: 25, maxBatches: 1 },
    );

    expect(result).toMatchObject({
      ok: true,
      dryRun: true,
      stats: {
        versionRowsScanned: 1,
        versionRowsMatched: 1,
        staticScansMatched: 1,
        skillRowsScanned: 1,
        skillRowsMatched: 1,
        cacheRowsScanned: 1,
        versionRowsPatched: 0,
        staticScansRewritten: 0,
        skillRowsPatched: 0,
        cacheRowsDeleted: 0,
      },
      samples: {
        versionIds: ["skillVersions:legacy"],
        skillIds: ["skills:legacy"],
        cacheRowIds: ["depRegistryCache:1"],
      },
      isDone: true,
    });
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("requires the confirmation token before applying", async () => {
    await expect(
      cleanupDependencyRegistryScanDataInternalHandler({ runQuery: vi.fn() } as never, {
        dryRun: false,
      }),
    ).rejects.toThrow(/delete-dependency-registry-scan-data/);
  });

  it("applies only matched dependency registry cleanup targets", async () => {
    const runQuery = vi.fn(async () => ({
      versionItems: [
        {
          id: "skillVersions:legacy",
          hasDepRegistryAnalysis: true,
          hasDepRegistryScanStatus: true,
          hasLegacyStaticScan: false,
        },
        {
          id: "skillVersions:clean",
          hasDepRegistryAnalysis: false,
          hasDepRegistryScanStatus: false,
          hasLegacyStaticScan: false,
        },
      ],
      skillItems: [
        { id: "skills:legacy", hasLegacyModeration: true },
        { id: "skills:clean", hasLegacyModeration: false },
      ],
      cacheRowIds: ["depRegistryCache:1"],
      versionCursor: "next-version",
      skillCursor: "next-skill",
      cacheCursor: null,
      versionsDone: false,
      skillsDone: false,
      cacheDone: true,
    }));
    const runMutation = vi.fn(async () => ({
      versionRowsPatched: 1,
      staticScansRewritten: 0,
      skillRowsPatched: 1,
      cacheRowsDeleted: 1,
    }));

    const result = await cleanupDependencyRegistryScanDataInternalHandler(
      { runQuery, runMutation } as never,
      {
        dryRun: false,
        confirm: "delete-dependency-registry-scan-data",
        batchSize: 25,
        maxBatches: 1,
      },
    );

    expect(result).toMatchObject({
      dryRun: false,
      stats: {
        versionRowsScanned: 2,
        versionRowsMatched: 1,
        skillRowsScanned: 2,
        skillRowsMatched: 1,
        cacheRowsScanned: 1,
        versionRowsPatched: 1,
        skillRowsPatched: 1,
        cacheRowsDeleted: 1,
      },
      cursors: { versionCursor: "next-version", skillCursor: "next-skill", cacheCursor: null },
      isDone: false,
    });
    expect(runMutation).toHaveBeenCalledWith(
      internal.maintenance.applyDependencyRegistryScanCleanupInternal,
      {
        confirm: "delete-dependency-registry-scan-data",
        versionIds: ["skillVersions:legacy"],
        skillIds: ["skills:legacy"],
        cacheRowIds: ["depRegistryCache:1"],
      },
    );
  });

  it("requires the confirmation token at the internal write boundary", async () => {
    const get = vi.fn();
    const patch = vi.fn();
    const deleteRow = vi.fn();

    await expect(
      applyDependencyRegistryScanCleanupInternalHandler(
        {
          db: {
            get,
            patch,
            delete: deleteRow,
          },
        } as never,
        {
          versionIds: ["skillVersions:legacy" as never],
          skillIds: [],
          cacheRowIds: ["depRegistryCache:delete-me" as never],
        } as never,
      ),
    ).rejects.toThrow(/delete-dependency-registry-scan-data/);

    expect(get).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
    expect(deleteRow).not.toHaveBeenCalled();
  });

  it("removes only targeted version scan fields and cache rows", async () => {
    const skillVersions = new Map<string, Record<string, unknown>>([
      [
        "skillVersions:legacy",
        {
          _id: "skillVersions:legacy",
          depRegistryAnalysis: { status: "suspicious", missing: [] },
          depRegistryScanStatus: "suspicious",
          staticScan: {
            status: "suspicious",
            reasonCodes: ["suspicious.dep_not_found_on_registry", "review.too_short"],
            findings: [
              { code: "suspicious.dep_not_found_on_registry", message: "missing package" },
              { code: "review.too_short", message: "too short" },
            ],
            summary: "Detected: missing package",
          },
        },
      ],
      [
        "skillVersions:untouched",
        {
          _id: "skillVersions:untouched",
          depRegistryAnalysis: { status: "clean", missing: [] },
          depRegistryScanStatus: "clean",
        },
      ],
    ]);
    const depRegistryCache = new Map<string, Record<string, unknown>>([
      ["depRegistryCache:delete-me", { _id: "depRegistryCache:delete-me" }],
      ["depRegistryCache:keep-me", { _id: "depRegistryCache:keep-me" }],
    ]);
    const tableMap: Record<string, Map<string, Record<string, unknown>>> = {
      skillVersions,
      depRegistryCache,
    };
    const getTableForId = (id: string) => id.split(":")[0];
    const patch = vi.fn(async (id: string, value: Record<string, unknown>) => {
      Object.assign(tableMap[getTableForId(id)].get(id) ?? {}, value);
    });
    const deleteRow = vi.fn(async (id: string) => {
      tableMap[getTableForId(id)].delete(id);
    });
    const runAfter = vi.fn();

    const result = await applyDependencyRegistryScanCleanupInternalHandler(
      {
        db: {
          get: vi.fn(async (id: string) => tableMap[getTableForId(id)]?.get(id) ?? null),
          patch,
          delete: deleteRow,
        },
        scheduler: { runAfter },
      } as never,
      {
        confirm: "delete-dependency-registry-scan-data",
        versionIds: ["skillVersions:legacy" as never],
        skillIds: [],
        cacheRowIds: ["depRegistryCache:delete-me" as never],
      },
    );

    expect(result).toEqual({
      versionRowsPatched: 1,
      staticScansRewritten: 1,
      skillRowsPatched: 0,
      cacheRowsDeleted: 1,
    });
    expect(patch).toHaveBeenCalledWith("skillVersions:legacy", {
      depRegistryAnalysis: undefined,
      depRegistryScanStatus: undefined,
      staticScan: {
        status: "clean",
        reasonCodes: ["review.too_short"],
        findings: [{ code: "review.too_short", message: "too short" }],
        summary: "Review: review.too_short",
      },
    });
    expect(deleteRow).toHaveBeenCalledWith("depRegistryCache:delete-me");
    expect(skillVersions.get("skillVersions:untouched")).toMatchObject({
      depRegistryAnalysis: { status: "clean", missing: [] },
      depRegistryScanStatus: "clean",
    });
    expect(depRegistryCache.has("depRegistryCache:keep-me")).toBe(true);
    expect(runAfter).toHaveBeenCalledTimes(2);
    expect(runAfter).toHaveBeenCalledWith(0, internal.skillCards.enqueueForVersionInternal, {
      versionId: "skillVersions:legacy",
      source: "scan",
    });
    expect(runAfter).toHaveBeenCalledWith(
      0,
      internal.securityScan.enqueueSkillVersionScanInternal,
      {
        versionId: "skillVersions:legacy",
        source: "backfill",
        waitForVtMs: 0,
      },
    );
  });

  it("recomputes a hidden skill when retired dependency registry moderation was the only finding", async () => {
    const skill = {
      _id: "skills:legacy",
      _creationTime: 100,
      slug: "legacy",
      displayName: "Legacy",
      summary: "Legacy dep registry-only finding.",
      icon: undefined,
      ownerUserId: undefined,
      ownerPublisherId: undefined,
      canonicalSkillId: undefined,
      forkOf: undefined,
      latestVersionId: "skillVersions:legacy",
      installKind: undefined,
      githubHasSkillCard: undefined,
      githubCurrentStatus: undefined,
      githubScanStatus: undefined,
      latestVersionSummary: undefined,
      tags: {},
      capabilityTags: [],
      badges: undefined,
      stats: { downloads: 0, stars: 0, installsCurrent: 0, installsAllTime: 0 },
      statsDownloads: 0,
      statsStars: 0,
      statsInstallsCurrent: 0,
      statsInstallsAllTime: 0,
      softDeletedAt: undefined,
      moderationStatus: "hidden",
      moderationFlags: ["flagged.suspicious"],
      moderationReason: "scanner.aggregate.suspicious",
      moderationVerdict: "suspicious",
      moderationReasonCodes: ["suspicious.dep_not_found_on_registry"],
      moderationEvidence: [
        {
          code: "suspicious.dep_not_found_on_registry",
          severity: "warn",
          message: "Dependency was not found on its registry.",
        },
      ],
      moderationSummary: "Suspicious: suspicious.dep_not_found_on_registry",
      isSuspicious: true,
      hiddenAt: 111,
      hiddenBy: "users:moderator",
      createdAt: 100,
      updatedAt: 110,
    };
    const skillVersions = new Map<string, Record<string, unknown>>([
      [
        "skillVersions:legacy",
        {
          _id: "skillVersions:legacy",
          skillId: "skills:legacy",
          softDeletedAt: undefined,
        },
      ],
    ]);
    const skills = new Map<string, Record<string, unknown>>([["skills:legacy", skill]]);
    const skillSearchDigest = new Map<string, Record<string, unknown>>([
      ["skillSearchDigest:legacy", { _id: "skillSearchDigest:legacy", skillId: "skills:legacy" }],
    ]);
    const globalStats = new Map<string, Record<string, unknown>>([
      ["globalStats:default", { _id: "globalStats:default", key: "default", activeSkillsCount: 4 }],
    ]);
    const tables: Record<string, Map<string, Record<string, unknown>>> = {
      skills,
      skillVersions,
      skillSearchDigest,
      globalStats,
      depRegistryCache: new Map(),
    };
    const getTableForId = (id: string) => id.split(":")[0];
    const uniqueFromTable = (tableName: string, filters: Record<string, unknown>) => {
      for (const row of tables[tableName]?.values() ?? []) {
        const matches = Object.entries(filters).every(([field, value]) => row[field] === value);
        if (matches) return row;
      }
      return null;
    };
    const patch = vi.fn(async (id: string, value: Record<string, unknown>) => {
      Object.assign(tables[getTableForId(id)].get(id) ?? {}, value);
    });
    const runAfter = vi.fn();
    const query = vi.fn((tableName: string) => ({
      withIndex: (
        _indexName: string,
        build: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
      ) => {
        const filters: Record<string, unknown> = {};
        build({
          eq: (field, value) => {
            filters[field] = value;
            return {
              eq: (nextField: string, nextValue: unknown) => {
                filters[nextField] = nextValue;
                return filters;
              },
            };
          },
        });
        return { unique: async () => uniqueFromTable(tableName, filters) };
      },
    }));

    const result = await applyDependencyRegistryScanCleanupInternalHandler(
      {
        db: {
          get: vi.fn(async (id: string) => tables[getTableForId(id)]?.get(id) ?? null),
          patch,
          delete: vi.fn(),
          query,
        },
        scheduler: { runAfter },
      } as never,
      {
        confirm: "delete-dependency-registry-scan-data",
        versionIds: [],
        skillIds: ["skills:legacy" as never],
        cacheRowIds: [],
      },
    );

    expect(result).toEqual({
      versionRowsPatched: 0,
      staticScansRewritten: 0,
      skillRowsPatched: 1,
      cacheRowsDeleted: 0,
    });
    expect(skills.get("skills:legacy")).toMatchObject({
      moderationStatus: "active",
      moderationReason: "scanner.aggregate.clean",
      moderationVerdict: "clean",
      moderationReasonCodes: undefined,
      moderationEvidence: undefined,
      moderationFlags: undefined,
      moderationSummary: "No suspicious patterns detected.",
      isSuspicious: false,
      hiddenAt: undefined,
      hiddenBy: undefined,
    });
    expect(skillSearchDigest.get("skillSearchDigest:legacy")).toMatchObject({
      moderationStatus: "active",
      moderationReason: "scanner.aggregate.clean",
      isSuspicious: false,
      skillId: "skills:legacy",
    });
    expect(globalStats.get("globalStats:default")).toMatchObject({ activeSkillsCount: 5 });
    expect(runAfter).not.toHaveBeenCalled();
  });
});

type QueryEq = {
  eq: (field: string, value: unknown) => QueryEq;
};

function makeLegacyPublisherOwnershipDb() {
  const now = 1_717_456_000_000;
  let nextPublisherId = 2;
  let nextMemberId = 1;
  const users = new Map<string, Record<string, unknown>>([
    [
      "users:legacy",
      {
        _id: "users:legacy",
        _creationTime: now - 1000,
        handle: "legacy-owner",
        name: "Legacy Owner",
        displayName: "Legacy Owner",
        deletedAt: undefined,
        deactivatedAt: undefined,
        purgedAt: undefined,
      },
    ],
    [
      "users:deleted",
      {
        _id: "users:deleted",
        _creationTime: now - 1000,
        handle: "deleted-owner",
        deletedAt: now - 10,
        deactivatedAt: undefined,
        purgedAt: undefined,
      },
    ],
  ]);
  const publishers = new Map<string, Record<string, unknown>>([
    [
      "publishers:existing",
      {
        _id: "publishers:existing",
        _creationTime: now - 500,
        kind: "user",
        handle: "existing-owner",
        displayName: "Existing Owner",
        linkedUserId: "users:existing",
        publishedSkills: 0,
        publishedPackages: 0,
        totalInstalls: 0,
        totalDownloads: 0,
        totalStars: 0,
        skillTotalInstalls: 0,
        skillTotalDownloads: 0,
        skillTotalStars: 0,
        createdAt: now - 500,
        updatedAt: now - 500,
      },
    ],
  ]);
  const publisherMembers = new Map<string, Record<string, unknown>>();
  const skills = new Map<string, Record<string, unknown>>([
    [
      "skills:legacy",
      {
        _id: "skills:legacy",
        _creationTime: now - 400,
        slug: "legacy-skill",
        displayName: "Legacy Skill",
        ownerUserId: "users:legacy",
        ownerPublisherId: undefined,
        latestVersionId: "skillVersions:legacy",
        tags: { latest: "skillVersions:legacy" },
        stats: {
          downloads: 10,
          stars: 3,
          installsCurrent: 2,
          installsAllTime: 5,
          comments: 0,
          versions: 1,
        },
        statsDownloads: 10,
        statsStars: 3,
        statsInstallsCurrent: 2,
        statsInstallsAllTime: 5,
        softDeletedAt: undefined,
        moderationStatus: "active",
        createdAt: now - 300,
        updatedAt: now - 200,
      },
    ],
    [
      "skills:deleted-owner",
      {
        _id: "skills:deleted-owner",
        _creationTime: now - 400,
        slug: "deleted-owner-skill",
        displayName: "Deleted Owner Skill",
        ownerUserId: "users:deleted",
        ownerPublisherId: undefined,
        latestVersionId: "skillVersions:deleted-owner",
        tags: { latest: "skillVersions:deleted-owner" },
        stats: {
          downloads: 1,
          stars: 0,
          installsCurrent: 0,
          installsAllTime: 0,
          comments: 0,
          versions: 1,
        },
        softDeletedAt: undefined,
        moderationStatus: "active",
        createdAt: now - 300,
        updatedAt: now - 200,
      },
    ],
  ]);
  const skillVersions = new Map<string, Record<string, unknown>>([
    [
      "skillVersions:legacy",
      {
        _id: "skillVersions:legacy",
        skillId: "skills:legacy",
        version: "1.0.0",
        softDeletedAt: undefined,
      },
    ],
    [
      "skillVersions:deleted-owner",
      {
        _id: "skillVersions:deleted-owner",
        skillId: "skills:deleted-owner",
        version: "1.0.0",
        softDeletedAt: undefined,
      },
    ],
  ]);
  const skillSlugAliases = new Map<string, Record<string, unknown>>([
    [
      "skillSlugAliases:legacy",
      {
        _id: "skillSlugAliases:legacy",
        slug: "old-legacy-skill",
        skillId: "skills:legacy",
        ownerUserId: "users:legacy",
        ownerPublisherId: undefined,
        createdAt: now - 250,
        updatedAt: now - 250,
      },
    ],
  ]);
  const skillEmbeddings = new Map<string, Record<string, unknown>>([
    [
      "skillEmbeddings:legacy",
      {
        _id: "skillEmbeddings:legacy",
        skillId: "skills:legacy",
        versionId: "skillVersions:legacy",
        ownerId: "users:legacy",
        ownerPublisherId: undefined,
        embedding: [0.1, 0.2],
        isLatest: true,
        isApproved: true,
        visibility: "public",
        updatedAt: now - 200,
      },
    ],
  ]);
  const skillSearchDigest = new Map<string, Record<string, unknown>>([
    [
      "skillSearchDigest:legacy",
      {
        _id: "skillSearchDigest:legacy",
        skillId: "skills:legacy",
        slug: "legacy-skill",
        displayName: "Legacy Skill",
        ownerUserId: "users:legacy",
        ownerPublisherId: undefined,
        ownerHandle: "legacy-owner",
        ownerKind: "user",
        stats: {
          downloads: 10,
          stars: 3,
          installsCurrent: 2,
          installsAllTime: 5,
          comments: 0,
          versions: 1,
        },
        statsDownloads: 10,
        statsStars: 3,
        statsInstallsCurrent: 2,
        statsInstallsAllTime: 5,
        softDeletedAt: undefined,
        moderationStatus: "active",
        createdAt: now - 300,
        updatedAt: now - 200,
      },
    ],
  ]);
  const packages = new Map<string, Record<string, unknown>>([
    [
      "packages:legacy",
      {
        _id: "packages:legacy",
        _creationTime: now - 400,
        name: "@legacy-owner/demo-plugin",
        normalizedName: "@legacy-owner/demo-plugin",
        displayName: "Demo Plugin",
        family: "bundle-plugin",
        channel: "community",
        isOfficial: false,
        ownerUserId: "users:legacy",
        ownerPublisherId: undefined,
        summary: "Demo package",
        latestReleaseId: undefined,
        tags: {},
        compatibility: undefined,
        capabilities: undefined,
        verification: undefined,
        scanStatus: "clean",
        stats: { downloads: 7, installs: 4, stars: 2, versions: 1 },
        softDeletedAt: undefined,
        createdAt: now - 300,
        updatedAt: now - 200,
      },
    ],
  ]);
  const packageSearchDigest = new Map<string, Record<string, unknown>>([
    [
      "packageSearchDigest:legacy",
      {
        _id: "packageSearchDigest:legacy",
        packageId: "packages:legacy",
        name: "@legacy-owner/demo-plugin",
        normalizedName: "@legacy-owner/demo-plugin",
        displayName: "Demo Plugin",
        family: "bundle-plugin",
        channel: "community",
        isOfficial: false,
        ownerUserId: "users:legacy",
        ownerPublisherId: undefined,
        ownerHandle: "legacy-owner",
        ownerKind: "user",
        summary: "Demo package",
        scanStatus: "clean",
        softDeletedAt: undefined,
        createdAt: now - 300,
        updatedAt: now - 200,
      },
    ],
  ]);
  const packageCapabilitySearchDigest = new Map<string, Record<string, unknown>>();
  const packagePluginCategorySearchDigest = new Map<string, Record<string, unknown>>();

  const tableMap: Record<string, Map<string, Record<string, unknown>>> = {
    users,
    publishers,
    publisherMembers,
    skills,
    skillVersions,
    skillSlugAliases,
    skillEmbeddings,
    skillSearchDigest,
    packages,
    packageSearchDigest,
    packageCapabilitySearchDigest,
    packagePluginCategorySearchDigest,
  };
  const patchCalls: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const insertCalls: Array<{ table: string; value: Record<string, unknown> }> = [];

  const getRows = (table: string) => Array.from(tableMap[table]?.values() ?? []);
  const getTableForId = (id: string) => id.split(":")[0];
  const readField = (row: Record<string, unknown>, field: string) =>
    field.split(".").reduce<unknown>((value, part) => {
      if (!value || typeof value !== "object") return undefined;
      return (value as Record<string, unknown>)[part];
    }, row);
  const makeQuery = (table: string, rows: Record<string, unknown>[]) => ({
    collect: vi.fn(async () => rows),
    unique: vi.fn(async () => rows[0] ?? null),
    take: vi.fn(async (limit: number) => rows.slice(0, limit)),
    order: vi.fn(() => ({
      take: vi.fn(async (limit: number) => rows.slice(0, limit)),
      paginate: vi.fn(async ({ cursor, numItems }: { cursor: string | null; numItems: number }) =>
        paginateRows(rows, cursor, numItems),
      ),
    })),
    paginate: vi.fn(async ({ cursor, numItems }: { cursor: string | null; numItems: number }) =>
      paginateRows(rows, cursor, numItems),
    ),
    withIndex: vi.fn((indexName: string, build?: (q: QueryEq) => unknown) => {
      const filters: Array<{ field: string; value: unknown }> = [];
      const q: QueryEq = {
        eq: (field, value) => {
          filters.push({ field, value });
          return q;
        },
      };
      build?.(q);
      let indexedRows = getRows(table).filter((row) =>
        filters.every((filter) => readField(row, filter.field) === filter.value),
      );
      if (table === "users" && indexName === "by_active_handle") {
        indexedRows = indexedRows.filter(
          (row) => row.deletedAt === undefined && row.deactivatedAt === undefined,
        );
      }
      return makeQuery(table, indexedRows);
    }),
  });

  const db = {
    get: vi.fn(async (id: string) => tableMap[getTableForId(id)]?.get(id) ?? null),
    query: vi.fn((table: string) => makeQuery(table, getRows(table))),
    patch: vi.fn(async (id: string, patch: Record<string, unknown>) => {
      patchCalls.push({ id, patch });
      const row = tableMap[getTableForId(id)]?.get(id);
      if (row) Object.assign(row, patch);
    }),
    insert: vi.fn(async (table: string, value: Record<string, unknown>) => {
      const id =
        table === "publishers"
          ? `publishers:created${nextPublisherId++}`
          : table === "publisherMembers"
            ? `publisherMembers:created${nextMemberId++}`
            : `${table}:created`;
      insertCalls.push({ table, value });
      tableMap[table].set(id, { _id: id, _creationTime: now, ...value });
      return id;
    }),
    delete: vi.fn(async (id: string) => {
      tableMap[getTableForId(id)]?.delete(id);
    }),
    normalizeId: vi.fn(),
  };

  return {
    db,
    patchCalls,
    insertCalls,
    tableMap,
  };
}

function paginateRows(rows: Record<string, unknown>[], cursor: string | null, numItems: number) {
  const start = cursor ? Number(cursor) : 0;
  const page = rows.slice(start, start + numItems);
  const next = start + page.length;
  return {
    page,
    continueCursor: next >= rows.length ? null : String(next),
    isDone: next >= rows.length,
  };
}

describe("maintenance legacy publisher ownership repair", () => {
  it("dry-runs legacy publisher ownership repair without writes", async () => {
    const { db, patchCalls, insertCalls } = makeLegacyPublisherOwnershipDb();

    const result = await repairLegacyPublisherOwnershipHandler(
      { db, scheduler: { runAfter: vi.fn() } } as never,
      { phase: "users", dryRun: true, batchSize: 10, scheduleNext: false },
    );

    expect(result).toMatchObject({
      phase: "users",
      dryRun: true,
      scanned: 1,
      repaired: 1,
      skipped: 0,
      isDone: true,
    });
    expect(patchCalls).toEqual([]);
    expect(insertCalls).toEqual([]);
  });

  it("reports dry-run personal publisher handle conflicts without writes", async () => {
    const { db, tableMap, patchCalls, insertCalls } = makeLegacyPublisherOwnershipDb();
    tableMap.users.set("users:conflict", {
      _id: "users:conflict",
      _creationTime: 1_717_456_000_000 - 1000,
      handle: "existing-owner",
      name: "Conflicting Owner",
      displayName: "Conflicting Owner",
      deletedAt: undefined,
      deactivatedAt: undefined,
      purgedAt: undefined,
    });

    const result = await repairLegacyPublisherOwnershipHandler(
      { db, scheduler: { runAfter: vi.fn() } } as never,
      { phase: "users", dryRun: true, batchSize: 10, scheduleNext: false },
    );

    expect(result).toMatchObject({
      phase: "users",
      dryRun: true,
      scanned: 2,
      repaired: 1,
      skipped: 1,
      isDone: true,
      errors: ['user:users:conflict: Publisher handle "@existing-owner" is already claimed'],
    });
    expect(patchCalls).toEqual([]);
    expect(insertCalls).toEqual([]);
  });

  it("skips apply-mode personal publisher handle conflicts while repairing other users", async () => {
    const { db, tableMap } = makeLegacyPublisherOwnershipDb();
    tableMap.users.set("users:conflict", {
      _id: "users:conflict",
      _creationTime: 1_717_456_000_000 - 1000,
      handle: "existing-owner",
      name: "Conflicting Owner",
      displayName: "Conflicting Owner",
      deletedAt: undefined,
      deactivatedAt: undefined,
      purgedAt: undefined,
    });

    const result = await repairLegacyPublisherOwnershipHandler(
      { db, scheduler: { runAfter: vi.fn() } } as never,
      { phase: "users", dryRun: false, batchSize: 10, scheduleNext: false },
    );

    const createdPublisher = Array.from(tableMap.publishers.values()).find(
      (publisher) => publisher.handle === "legacy-owner",
    );
    expect(result).toMatchObject({
      phase: "users",
      dryRun: false,
      scanned: 2,
      repaired: 1,
      skipped: 1,
      isDone: true,
      errors: ['user:users:conflict: Publisher handle "@existing-owner" is already claimed'],
    });
    expect(createdPublisher).toMatchObject({
      kind: "user",
      linkedUserId: "users:legacy",
    });
    expect(tableMap.users.get("users:legacy")).toMatchObject({
      personalPublisherId: createdPublisher?._id,
    });
    expect(tableMap.users.get("users:conflict")).not.toHaveProperty("personalPublisherId");
  });

  it("repairs active legacy users, skills, aliases, embeddings, and packages", async () => {
    const { db, tableMap, patchCalls, insertCalls } = makeLegacyPublisherOwnershipDb();
    const scheduler = { runAfter: vi.fn() };

    const usersResult = await repairLegacyPublisherOwnershipHandler({ db, scheduler } as never, {
      phase: "users",
      dryRun: false,
      batchSize: 10,
      scheduleNext: false,
    });
    const createdPublisher = Array.from(tableMap.publishers.values()).find(
      (publisher) => publisher.handle === "legacy-owner",
    );
    expect(usersResult).toMatchObject({
      phase: "users",
      dryRun: false,
      scanned: 1,
      repaired: 1,
      skipped: 0,
      isDone: true,
    });
    expect(createdPublisher).toMatchObject({
      kind: "user",
      handle: "legacy-owner",
      displayName: "Legacy Owner",
      linkedUserId: "users:legacy",
    });
    expect(tableMap.users.get("users:legacy")).toMatchObject({
      personalPublisherId: createdPublisher?._id,
    });
    expect(insertCalls.some((call) => call.table === "publisherMembers")).toBe(true);

    const skillsResult = await repairLegacyPublisherOwnershipHandler({ db, scheduler } as never, {
      phase: "skills",
      dryRun: false,
      batchSize: 10,
      scheduleNext: false,
    });
    expect(skillsResult).toMatchObject({
      phase: "skills",
      dryRun: false,
      scanned: 2,
      repaired: 1,
      skipped: 1,
      isDone: true,
    });
    expect(tableMap.skills.get("skills:legacy")).toMatchObject({
      ownerPublisherId: createdPublisher?._id,
    });
    expect(tableMap.skills.get("skills:deleted-owner")).toMatchObject({
      ownerPublisherId: undefined,
    });
    expect(tableMap.skillSlugAliases.get("skillSlugAliases:legacy")).toMatchObject({
      ownerPublisherId: createdPublisher?._id,
    });
    expect(tableMap.skillEmbeddings.get("skillEmbeddings:legacy")).not.toHaveProperty(
      "ownerPublisherId",
      createdPublisher?._id,
    );

    const packagesResult = await repairLegacyPublisherOwnershipHandler({ db, scheduler } as never, {
      phase: "packages",
      dryRun: false,
      batchSize: 10,
      scheduleNext: false,
    });
    expect(packagesResult).toMatchObject({
      phase: "packages",
      dryRun: false,
      scanned: 1,
      repaired: 1,
      skipped: 0,
      isDone: true,
    });
    expect(tableMap.packages.get("packages:legacy")).toMatchObject({
      ownerPublisherId: createdPublisher?._id,
    });
    expect(patchCalls.some((call) => call.id === "skillSearchDigest:legacy")).toBe(false);
    expect(patchCalls.some((call) => call.id === "packageSearchDigest:legacy")).toBe(false);
    expect(
      patchCalls.some(
        (call) =>
          call.id === createdPublisher?._id &&
          ("publishedSkills" in call.patch || "publishedPackages" in call.patch),
      ),
    ).toBe(false);
  });

  it("repairs legacy owner projections for one targeted user by handle", async () => {
    const { db, tableMap } = makeLegacyPublisherOwnershipDb();
    const scheduler = { runAfter: vi.fn() };

    await repairLegacyPublisherOwnershipHandler({ db, scheduler } as never, {
      phase: "users",
      dryRun: false,
      batchSize: 10,
      scheduleNext: false,
    });
    const createdPublisher = Array.from(tableMap.publishers.values()).find(
      (publisher) => publisher.handle === "legacy-owner",
    );

    const skillsResult = await repairLegacyPublisherOwnershipForUserHandler(
      { db, scheduler } as never,
      {
        handle: "legacy-owner",
        phase: "skills",
        dryRun: false,
        batchSize: 10,
        scheduleNext: false,
      },
    );
    expect(skillsResult).toMatchObject({
      phase: "skills",
      dryRun: false,
      userId: "users:legacy",
      publisherId: createdPublisher?._id,
      scanned: 1,
      repaired: 1,
      skipped: 0,
      isDone: true,
    });
    expect(tableMap.skills.get("skills:legacy")).toMatchObject({
      ownerPublisherId: createdPublisher?._id,
    });
    expect(tableMap.skills.get("skills:deleted-owner")).toMatchObject({
      ownerPublisherId: undefined,
    });
    expect(tableMap.skillSlugAliases.get("skillSlugAliases:legacy")).toMatchObject({
      ownerPublisherId: createdPublisher?._id,
    });
    expect(tableMap.skillEmbeddings.get("skillEmbeddings:legacy")).not.toHaveProperty(
      "ownerPublisherId",
      createdPublisher?._id,
    );

    const packagesResult = await repairLegacyPublisherOwnershipForUserHandler(
      { db, scheduler } as never,
      {
        handle: "legacy-owner",
        phase: "packages",
        dryRun: false,
        batchSize: 10,
        scheduleNext: false,
      },
    );
    expect(packagesResult).toMatchObject({
      phase: "packages",
      dryRun: false,
      userId: "users:legacy",
      publisherId: createdPublisher?._id,
      scanned: 1,
      repaired: 1,
      skipped: 0,
      isDone: true,
    });
    expect(tableMap.packages.get("packages:legacy")).toMatchObject({
      ownerPublisherId: createdPublisher?._id,
    });
  });

  it("does not touch skill embeddings during apply-mode skill repair", async () => {
    const { db } = makeLegacyPublisherOwnershipDb();
    const scheduler = { runAfter: vi.fn() };

    await repairLegacyPublisherOwnershipHandler({ db, scheduler } as never, {
      phase: "users",
      dryRun: false,
      batchSize: 10,
      scheduleNext: false,
    });

    const patch = db.patch;
    db.patch = vi.fn(async (id: string, value: Record<string, unknown>) => {
      if (id === "skillEmbeddings:legacy") throw new Error("embedding sync failed");
      await patch(id, value);
    });

    await expect(
      repairLegacyPublisherOwnershipHandler({ db, scheduler } as never, {
        phase: "skills",
        dryRun: false,
        batchSize: 10,
        scheduleNext: false,
      }),
    ).resolves.toMatchObject({
      phase: "skills",
      repaired: 1,
    });
  });

  it("propagates apply-mode package patch failures", async () => {
    const { db } = makeLegacyPublisherOwnershipDb();
    const scheduler = { runAfter: vi.fn() };

    await repairLegacyPublisherOwnershipHandler({ db, scheduler } as never, {
      phase: "users",
      dryRun: false,
      batchSize: 10,
      scheduleNext: false,
    });

    const patch = db.patch;
    db.patch = vi.fn(async (id: string, value: Record<string, unknown>) => {
      if (id === "packages:legacy") throw new Error("package patch failed");
      await patch(id, value);
    });

    await expect(
      repairLegacyPublisherOwnershipHandler({ db, scheduler } as never, {
        phase: "packages",
        dryRun: false,
        batchSize: 10,
        scheduleNext: false,
      }),
    ).rejects.toThrow("package patch failed");
  });
});

describe("maintenance backfill", () => {
  it("patches stale skill search digest rank stats from legacy skill stats", async () => {
    const existingDigest = {
      _id: "skillSearchDigest:1",
      skillId: "skills:1",
      slug: "demo",
      displayName: "Demo",
      summary: "Old summary",
      ownerUserId: "users:owner",
      tags: {},
      stats: {
        downloads: 3,
        stars: 2,
        installsCurrent: 4,
        installsAllTime: 5,
        versions: 1,
        comments: 0,
      },
      softDeletedAt: undefined,
      createdAt: 100,
      updatedAt: 200,
    };
    const skill = {
      _id: "skills:1",
      slug: "demo",
      displayName: "Demo",
      summary: "New summary",
      ownerUserId: "users:owner",
      tags: {},
      stats: {
        downloads: 42,
        stars: 7,
        installsCurrent: 9,
        installsAllTime: 100,
        versions: 1,
        comments: 0,
      },
      softDeletedAt: undefined,
      createdAt: 100,
      updatedAt: 300,
    };
    const paginate = vi.fn().mockResolvedValue({
      page: [skill],
      continueCursor: null,
      isDone: true,
    });
    const unique = vi.fn().mockResolvedValue(existingDigest);
    class TestEqBuilder {
      eq(_field: string, _value: unknown) {
        return this;
      }
    }
    const withIndex = vi.fn((_indexName: string, build: (q: TestEqBuilder) => unknown) => {
      build(new TestEqBuilder());
      return { unique };
    });
    const query = vi.fn((table: string) => {
      if (table === "skills") return { paginate };
      if (table === "skillSearchDigest") return { withIndex };
      throw new Error(`unexpected table ${table}`);
    });
    const patch = vi.fn().mockResolvedValue(undefined);
    const insert = vi.fn().mockResolvedValue("skillSearchDigest:inserted");
    const replace = vi.fn().mockResolvedValue(undefined);
    const deleteDoc = vi.fn().mockResolvedValue(undefined);

    const result = await (
      backfillSkillSearchDigestInternal as unknown as { _handler: Function }
    )._handler(
      {
        db: {
          get: vi.fn(),
          query,
          patch,
          insert,
          replace,
          delete: deleteDoc,
          normalizeId: vi.fn(),
        },
        scheduler: {
          runAfter: vi.fn(),
        },
      } as never,
      { batchSize: 10 },
    );

    expect(result).toEqual({ upserted: 1, isDone: true, scanned: 1 });
    expect(paginate).toHaveBeenCalledWith({ cursor: null, numItems: 10 });
    expect(withIndex).toHaveBeenCalledWith("by_skill", expect.any(Function));
    expect(insert).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledWith(
      "skillSearchDigest:1",
      expect.objectContaining({
        summary: "New summary",
        statsDownloads: 42,
        statsStars: 7,
        statsInstallsCurrent: 9,
        statsInstallsAllTime: 100,
        stats: expect.objectContaining({
          downloads: 42,
          stars: 7,
          installsCurrent: 9,
          installsAllTime: 100,
        }),
      }),
    );
  });

  it("repairs summary + parsed by reparsing SKILL.md", async () => {
    const runQuery = vi.fn().mockResolvedValue({
      items: [
        {
          kind: "ok",
          skillId: "skills:1",
          skillSlug: "skill-1",
          skillDisplayName: "Skill 1",
          versionId: "skillVersions:1",
          skillSummary: ">",
          versionParsed: { frontmatter: { description: ">" } },
          readmeStorageId: "storage:1",
        },
      ],
      cursor: null,
      isDone: true,
    });

    const runMutation = vi.fn().mockResolvedValue({ ok: true });
    const storageGet = vi
      .fn()
      .mockResolvedValue(makeBlob(`---\ndescription: >\n  Hello\n  world.\n---\nBody`));

    const result = await backfillSkillSummariesInternalHandler(
      { runQuery, runMutation, storage: { get: storageGet } } as never,
      { dryRun: false, batchSize: 10, maxBatches: 1 },
    );

    expect(result.ok).toBe(true);
    expect(result.stats.skillsScanned).toBe(1);
    expect(result.stats.skillsPatched).toBe(1);
    expect(result.stats.versionsPatched).toBe(1);
    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
      skillId: "skills:1",
      versionId: "skillVersions:1",
      summary: "Hello world.",
      parsed: {
        frontmatter: { description: "Hello world." },
        metadata: undefined,
        clawdis: undefined,
        license: "MIT-0",
      },
    });
  });

  it("dryRun does not patch", async () => {
    const runQuery = vi.fn().mockResolvedValue({
      items: [
        {
          kind: "ok",
          skillId: "skills:1",
          skillSlug: "skill-1",
          skillDisplayName: "Skill 1",
          versionId: "skillVersions:1",
          skillSummary: ">",
          versionParsed: { frontmatter: { description: ">" } },
          readmeStorageId: "storage:1",
        },
      ],
      cursor: null,
      isDone: true,
    });

    const runMutation = vi.fn();
    const storageGet = vi.fn().mockResolvedValue(makeBlob(`---\ndescription: Hello\n---\nBody`));

    const result = await backfillSkillSummariesInternalHandler(
      { runQuery, runMutation, storage: { get: storageGet } } as never,
      { dryRun: true, batchSize: 10, maxBatches: 1 },
    );

    expect(result.ok).toBe(true);
    expect(result.stats.skillsPatched).toBe(1);
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("counts missing storage blob", async () => {
    const runQuery = vi.fn().mockResolvedValue({
      items: [
        {
          kind: "ok",
          skillId: "skills:1",
          skillSlug: "skill-1",
          skillDisplayName: "Skill 1",
          versionId: "skillVersions:1",
          skillSummary: null,
          versionParsed: { frontmatter: {} },
          readmeStorageId: "storage:missing",
        },
      ],
      cursor: null,
      isDone: true,
    });

    const runMutation = vi.fn();
    const storageGet = vi.fn().mockResolvedValue(null);

    const result = await backfillSkillSummariesInternalHandler(
      { runQuery, runMutation, storage: { get: storageGet } } as never,
      { dryRun: false, batchSize: 10, maxBatches: 1 },
    );

    expect(result.stats.missingStorageBlob).toBe(1);
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("fills empty summary via AI when useAi is enabled", async () => {
    vi.mocked(generateSkillSummary).mockResolvedValue("AI generated summary.");

    const runQuery = vi.fn().mockResolvedValue({
      items: [
        {
          kind: "ok",
          skillId: "skills:1",
          skillSlug: "ai-skill",
          skillDisplayName: "AI Skill",
          versionId: "skillVersions:1",
          skillSummary: null,
          versionParsed: { frontmatter: {} },
          readmeStorageId: "storage:1",
        },
      ],
      cursor: null,
      isDone: true,
    });

    const runMutation = vi.fn().mockResolvedValue({ ok: true });
    const storageGet = vi.fn().mockResolvedValue(makeBlob("# AI Skill\n\nUseful automation."));

    const result = await backfillSkillSummariesInternalHandler(
      { runQuery, runMutation, storage: { get: storageGet } } as never,
      { dryRun: false, batchSize: 10, maxBatches: 1, useAi: true },
    );

    expect(result.ok).toBe(true);
    expect(result.stats.skillsPatched).toBe(1);
    expect(result.stats.aiSummariesPatched).toBe(1);
    expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
      skillId: "skills:1",
      versionId: "skillVersions:1",
      summary: "AI generated summary.",
      parsed: {
        frontmatter: {},
        metadata: undefined,
        clawdis: undefined,
        license: "MIT-0",
      },
    });
  });

  it("re-syncs latestVersionSummary when changelogSource or clawdis drift", async () => {
    const paginate = vi.fn().mockResolvedValue({
      page: [
        {
          _id: "skills:1",
          latestVersionId: "skillVersions:1",
          latestVersionSummary: {
            version: "1.0.0",
            createdAt: 123,
            changelog: "Same changelog",
            changelogSource: "user",
            clawdis: undefined,
          },
        },
      ],
      continueCursor: null,
      isDone: true,
    });
    const get = vi.fn().mockResolvedValue({
      _id: "skillVersions:1",
      version: "1.0.0",
      createdAt: 123,
      changelog: "Same changelog",
      changelogSource: "auto",
      parsed: { clawdis: { emoji: "lobster" } },
    });
    const patch = vi.fn().mockResolvedValue(undefined);
    const runAfter = vi.fn();

    const ctx = {
      db: {
        query: vi.fn(() => ({ paginate })),
        get,
        patch,
        normalizeId: vi.fn(),
      },
      scheduler: {
        runAfter,
      },
    } as never;

    const result = await (
      backfillLatestVersionSummaryInternal as unknown as { _handler: Function }
    )._handler(ctx, {
      batchSize: 10,
    });

    expect(result).toEqual({ patched: 1, isDone: true, scanned: 1 });
    expect(paginate).toHaveBeenCalledWith({ cursor: null, numItems: 10 });
    expect(patch).toHaveBeenCalledWith("skills:1", {
      latestVersionSummary: {
        version: "1.0.0",
        createdAt: 123,
        changelog: "Same changelog",
        changelogSource: "auto",
        clawdis: { emoji: "lobster" },
      },
    });
    expect(runAfter).not.toHaveBeenCalled();
  });

  it("backfills digest capability tags even when version summary already matches", async () => {
    const digest = {
      _id: "skillSearchDigest:1",
      skillId: "skills:1",
      latestVersionId: "skillVersions:1",
      latestVersionSkillId: "skills:1",
      latestVersionSummary: {
        version: "1.0.0",
        createdAt: 123,
        changelog: "Same changelog",
        changelogSource: "user",
        clawdis: undefined,
      },
      capabilityTags: ["old"],
    };
    const skill = {
      _id: "skills:1",
      slug: "demo",
      displayName: "Demo",
      stats: {
        downloads: 0,
        stars: 0,
        installsCurrent: 0,
        installsAllTime: 0,
        versions: 1,
        comments: 0,
      },
      latestVersionId: "skillVersions:1",
      latestVersionSummary: digest.latestVersionSummary,
      capabilityTags: ["read-files"],
    };
    const version = {
      _id: "skillVersions:1",
      skillId: "skills:1",
      softDeletedAt: undefined,
      version: "1.0.0",
    };
    const paginate = vi.fn().mockResolvedValue({
      page: [digest],
      continueCursor: null,
      isDone: true,
    });
    const patch = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      db: {
        query: vi.fn(() => ({ paginate })),
        get: vi.fn(async (id: string) => {
          if (id === "skills:1") return skill;
          if (id === "skillVersions:1") return version;
          return null;
        }),
        patch,
        normalizeId: vi.fn(),
      },
      scheduler: {
        runAfter: vi.fn(),
      },
    } as never;

    const result = await (
      backfillDigestVersionSummary as unknown as { _handler: Function }
    )._handler(ctx, {
      batchSize: 10,
    });

    expect(result).toEqual({ patched: 1, isDone: true, scanned: 1 });
    expect(patch).toHaveBeenCalledWith("skillSearchDigest:1", {
      latestVersionId: "skillVersions:1",
      latestVersionSkillId: "skills:1",
      latestVersionSummary: digest.latestVersionSummary,
      capabilityTags: ["read-files"],
    });
  });

  it("backfills denormalized user hover stats from indexed owner pages", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({
        items: [{ _id: "users:1" }],
        cursor: null,
        isDone: true,
      })
      .mockResolvedValueOnce({
        items: [
          { stats: { stars: 4, downloads: 30 }, softDeletedAt: undefined },
          { stats: { stars: 2, downloads: 10 }, softDeletedAt: 123 },
          { stats: { stars: 1, downloads: 5 }, softDeletedAt: undefined },
        ],
        cursor: null,
        isDone: true,
      });
    const runMutation = vi.fn().mockResolvedValue({ ok: true });

    const result = await backfillUserStatsInternalHandler({ runQuery, runMutation } as never, {
      batchSize: 10,
      skillBatchSize: 50,
      maxBatches: 1,
    });

    expect(result).toEqual({
      ok: true,
      stats: {
        usersScanned: 1,
        usersPatched: 1,
      },
      isDone: true,
      cursor: null,
    });
    expect(runQuery).toHaveBeenNthCalledWith(
      1,
      internal.maintenance.getUserStatsBackfillPageInternal,
      {
        cursor: undefined,
        batchSize: 10,
      },
    );
    expect(runQuery).toHaveBeenNthCalledWith(
      2,
      internal.maintenance.getUserOwnedSkillsBackfillPageInternal,
      {
        ownerUserId: "users:1",
        cursor: undefined,
        batchSize: 50,
      },
    );
    expect(runMutation).toHaveBeenCalledWith(
      internal.maintenance.applyUserStatsBackfillPatchInternal,
      {
        userId: "users:1",
        publishedSkills: 2,
        totalStars: 5,
        totalDownloads: 35,
      },
    );
  });

  it("backfills denormalized publisher stats through the recompute mutation", async () => {
    const runQuery = vi.fn().mockResolvedValue({
      items: [{ _id: "publishers:1" }, { _id: "publishers:2" }],
      cursor: "next",
      isDone: false,
    });
    const runMutation = vi.fn().mockResolvedValue({ ok: true });

    const result = await backfillPublisherStatsInternalHandler({ runQuery, runMutation } as never, {
      dryRun: true,
      batchSize: 2,
      maxBatches: 1,
    });

    expect(result).toEqual({
      ok: true,
      stats: {
        publishersScanned: 2,
        publishersPatched: 0,
      },
      isDone: false,
      cursor: "next",
    });
    expect(runQuery).toHaveBeenCalledWith(
      internal.maintenance.getPublisherStatsBackfillPageInternal,
      {
        cursor: undefined,
        batchSize: 2,
      },
    );
    expect(runMutation).toHaveBeenNthCalledWith(
      1,
      internal.maintenance.recomputePublisherStatsInternal,
      {
        publisherId: "publishers:1",
        dryRun: true,
      },
    );
    expect(runMutation).toHaveBeenNthCalledWith(
      2,
      internal.maintenance.recomputePublisherStatsInternal,
      {
        publisherId: "publishers:2",
        dryRun: true,
      },
    );
  });
});

describe("maintenance badge denormalization", () => {
  it("upserts table badge and keeps skill.badges in sync", async () => {
    const unique = vi.fn().mockResolvedValue(null);
    const query = vi.fn().mockReturnValue({
      withIndex: () => ({ unique }),
    });
    const insert = vi.fn().mockResolvedValue("skillBadges:1");
    const get = vi.fn().mockResolvedValue({ _id: "skills:1", badges: undefined });
    const patch = vi.fn().mockResolvedValue(undefined);

    const ctx = {
      db: {
        query,
        insert,
        get,
        patch,
        normalizeId: vi.fn(),
      },
    } as never;

    const result = await (
      upsertSkillBadgeRecordInternal as unknown as { _handler: Function }
    )._handler(ctx, {
      skillId: "skills:1",
      kind: "highlighted",
      byUserId: "users:1",
      at: 123,
    });

    expect(result).toEqual({ inserted: true });
    expect(insert).toHaveBeenCalledWith("skillBadges", {
      skillId: "skills:1",
      kind: "highlighted",
      byUserId: "users:1",
      at: 123,
    });
    expect(patch).toHaveBeenCalledWith("skills:1", {
      badges: {
        highlighted: { byUserId: "users:1", at: 123 },
      },
    });
  });

  it("resyncs denormalized badge even when table record already exists", async () => {
    const unique = vi.fn().mockResolvedValue({ _id: "skillBadges:existing" });
    const query = vi.fn().mockReturnValue({
      withIndex: () => ({ unique }),
    });
    const insert = vi.fn();
    const get = vi.fn().mockResolvedValue({ _id: "skills:1", badges: {} });
    const patch = vi.fn().mockResolvedValue(undefined);

    const ctx = {
      db: {
        query,
        insert,
        get,
        patch,
        normalizeId: vi.fn(),
      },
    } as never;

    const result = await (
      upsertSkillBadgeRecordInternal as unknown as { _handler: Function }
    )._handler(ctx, {
      skillId: "skills:1",
      kind: "official",
      byUserId: "users:2",
      at: 456,
    });

    expect(result).toEqual({ inserted: false });
    expect(insert).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledWith("skills:1", {
      badges: {
        official: { byUserId: "users:2", at: 456 },
      },
    });
  });
});

describe("maintenance capability tag backfill", () => {
  it("keeps latest skill search digest capability tags in sync", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1234);
    const get = vi
      .fn()
      .mockResolvedValueOnce({
        _id: "skillVersions:1",
        capabilityTags: ["can-make-purchases"],
      })
      .mockResolvedValueOnce({
        _id: "skills:1",
        latestVersionId: "skillVersions:1",
        capabilityTags: ["can-make-purchases"],
      });
    const unique = vi.fn().mockResolvedValue({
      _id: "skillSearchDigest:1",
      capabilityTags: ["can-make-purchases"],
    });
    const withIndex = vi.fn((_indexName, callback) => {
      callback({ eq: vi.fn() });
      return { unique };
    });
    const query = vi.fn().mockReturnValue({ withIndex });
    const patch = vi.fn().mockResolvedValue(undefined);

    const result = await (
      applySkillCapabilityTagsInternal as unknown as { _handler: Function }
    )._handler(
      {
        db: {
          get,
          patch,
          query,
          normalizeId: vi.fn(),
        },
      } as never,
      {
        skillId: "skills:1",
        versionId: "skillVersions:1",
        capabilityTags: ["financial-authority", "can-make-purchases"],
      },
    );

    expect(result).toEqual({
      ok: true,
      versionPatched: true,
      skillPatched: true,
      digestPatched: true,
    });
    expect(patch).toHaveBeenNthCalledWith(1, "skillVersions:1", {
      capabilityTags: ["financial-authority", "can-make-purchases"],
    });
    expect(patch).toHaveBeenNthCalledWith(2, "skills:1", {
      capabilityTags: ["financial-authority", "can-make-purchases"],
      updatedAt: 1234,
    });
    expect(patch).toHaveBeenNthCalledWith(3, "skillSearchDigest:1", {
      capabilityTags: ["financial-authority", "can-make-purchases"],
      updatedAt: 1234,
    });
    expect(query).toHaveBeenCalledWith("skillSearchDigest");
    expect(withIndex).toHaveBeenCalledWith("by_skill", expect.any(Function));

    nowSpy.mockRestore();
  });

  it("counts trigger-synced digest tags when the latest skill tags change", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(2222);
    const get = vi
      .fn()
      .mockResolvedValueOnce({
        _id: "skillVersions:1",
        capabilityTags: ["can-make-purchases"],
      })
      .mockResolvedValueOnce({
        _id: "skills:1",
        latestVersionId: "skillVersions:1",
        capabilityTags: ["can-make-purchases"],
      });
    const unique = vi.fn().mockResolvedValue({
      _id: "skillSearchDigest:1",
      capabilityTags: ["financial-authority", "can-make-purchases"],
    });
    const withIndex = vi.fn((_indexName, callback) => {
      callback({ eq: vi.fn() });
      return { unique };
    });
    const query = vi.fn().mockReturnValue({ withIndex });
    const patch = vi.fn().mockResolvedValue(undefined);

    const result = await (
      applySkillCapabilityTagsInternal as unknown as { _handler: Function }
    )._handler(
      {
        db: {
          get,
          patch,
          query,
          normalizeId: vi.fn(),
        },
      } as never,
      {
        skillId: "skills:1",
        versionId: "skillVersions:1",
        capabilityTags: ["financial-authority", "can-make-purchases"],
      },
    );

    expect(result).toEqual({
      ok: true,
      versionPatched: true,
      skillPatched: true,
      digestPatched: true,
    });
    expect(patch).toHaveBeenCalledTimes(2);
    expect(patch).toHaveBeenNthCalledWith(1, "skillVersions:1", {
      capabilityTags: ["financial-authority", "can-make-purchases"],
    });
    expect(patch).toHaveBeenNthCalledWith(2, "skills:1", {
      capabilityTags: ["financial-authority", "can-make-purchases"],
      updatedAt: 2222,
    });

    nowSpy.mockRestore();
  });

  it("repairs a stale latest skill search digest even when skill tags already match", async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({
        _id: "skillVersions:1",
        capabilityTags: ["financial-authority", "can-make-purchases"],
      })
      .mockResolvedValueOnce({
        _id: "skills:1",
        latestVersionId: "skillVersions:1",
        capabilityTags: ["financial-authority", "can-make-purchases"],
        updatedAt: 987,
      });
    const unique = vi.fn().mockResolvedValue({
      _id: "skillSearchDigest:1",
      capabilityTags: ["can-make-purchases"],
    });
    const withIndex = vi.fn((_indexName, callback) => {
      callback({ eq: vi.fn() });
      return { unique };
    });
    const query = vi.fn().mockReturnValue({ withIndex });
    const patch = vi.fn().mockResolvedValue(undefined);

    const result = await (
      applySkillCapabilityTagsInternal as unknown as { _handler: Function }
    )._handler(
      {
        db: {
          get,
          patch,
          query,
          normalizeId: vi.fn(),
        },
      } as never,
      {
        skillId: "skills:1",
        versionId: "skillVersions:1",
        capabilityTags: ["financial-authority", "can-make-purchases"],
      },
    );

    expect(result).toEqual({
      ok: true,
      versionPatched: false,
      skillPatched: false,
      digestPatched: true,
    });
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith("skillSearchDigest:1", {
      capabilityTags: ["financial-authority", "can-make-purchases"],
      updatedAt: 987,
    });
  });
});

describe("maintenance fingerprint backfill", () => {
  it("backfills fingerprint field and inserts index entry", async () => {
    const { hashSkillFiles } = await import("./lib/skills");
    const expected = await hashSkillFiles([{ path: "SKILL.md", sha256: "abc" }]);

    const runQuery = vi.fn().mockResolvedValue({
      items: [
        {
          skillId: "skills:1",
          versionId: "skillVersions:1",
          versionFingerprint: undefined,
          files: [{ path: "SKILL.md", sha256: "abc" }],
          existingEntries: [],
        },
      ],
      cursor: null,
      isDone: true,
    });

    const runMutation = vi.fn().mockResolvedValue({ ok: true });

    const result = await backfillSkillFingerprintsInternalHandler(
      { runQuery, runMutation } as never,
      { dryRun: false, batchSize: 10, maxBatches: 1 },
    );

    expect(result.ok).toBe(true);
    expect(result.stats.versionsScanned).toBe(1);
    expect(result.stats.versionsPatched).toBe(1);
    expect(result.stats.fingerprintsInserted).toBe(1);
    expect(result.stats.fingerprintMismatches).toBe(0);
    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
      versionId: "skillVersions:1",
      fingerprint: expected,
      patchVersion: true,
      replaceEntries: true,
      existingEntryIds: [],
    });
  });

  it("dryRun does not patch", async () => {
    const runQuery = vi.fn().mockResolvedValue({
      items: [
        {
          skillId: "skills:1",
          versionId: "skillVersions:1",
          versionFingerprint: undefined,
          files: [{ path: "SKILL.md", sha256: "abc" }],
          existingEntries: [],
        },
      ],
      cursor: null,
      isDone: true,
    });

    const runMutation = vi.fn();

    const result = await backfillSkillFingerprintsInternalHandler(
      { runQuery, runMutation } as never,
      { dryRun: true, batchSize: 10, maxBatches: 1 },
    );

    expect(result.ok).toBe(true);
    expect(result.stats.versionsPatched).toBe(1);
    expect(result.stats.fingerprintsInserted).toBe(1);
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("patches missing version fingerprint without touching correct entries", async () => {
    const { hashSkillFiles } = await import("./lib/skills");
    const expected = await hashSkillFiles([{ path: "SKILL.md", sha256: "abc" }]);

    const runQuery = vi.fn().mockResolvedValue({
      items: [
        {
          skillId: "skills:1",
          versionId: "skillVersions:1",
          versionFingerprint: undefined,
          files: [{ path: "SKILL.md", sha256: "abc" }],
          existingEntries: [{ id: "skillVersionFingerprints:1", fingerprint: expected }],
        },
      ],
      cursor: null,
      isDone: true,
    });

    const runMutation = vi.fn().mockResolvedValue({ ok: true });

    const result = await backfillSkillFingerprintsInternalHandler(
      { runQuery, runMutation } as never,
      { dryRun: false, batchSize: 10, maxBatches: 1 },
    );

    expect(result.ok).toBe(true);
    expect(result.stats.versionsPatched).toBe(1);
    expect(result.stats.fingerprintsInserted).toBe(0);
    expect(result.stats.fingerprintMismatches).toBe(0);
    expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
      versionId: "skillVersions:1",
      fingerprint: expected,
      patchVersion: true,
      replaceEntries: false,
      existingEntryIds: [],
    });
  });

  it("replaces mismatched fingerprint entries", async () => {
    const { hashSkillFiles } = await import("./lib/skills");
    const expected = await hashSkillFiles([{ path: "SKILL.md", sha256: "abc" }]);

    const runQuery = vi.fn().mockResolvedValue({
      items: [
        {
          skillId: "skills:1",
          versionId: "skillVersions:1",
          versionFingerprint: "wrong",
          files: [{ path: "SKILL.md", sha256: "abc" }],
          existingEntries: [{ id: "skillVersionFingerprints:1", fingerprint: "wrong" }],
        },
      ],
      cursor: null,
      isDone: true,
    });

    const runMutation = vi.fn().mockResolvedValue({ ok: true });

    const result = await backfillSkillFingerprintsInternalHandler(
      { runQuery, runMutation } as never,
      { dryRun: false, batchSize: 10, maxBatches: 1 },
    );

    expect(result.ok).toBe(true);
    expect(result.stats.fingerprintMismatches).toBe(1);
    expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
      versionId: "skillVersions:1",
      fingerprint: expected,
      patchVersion: true,
      replaceEntries: true,
      existingEntryIds: ["skillVersionFingerprints:1"],
    });
  });

  it("ignores generated Skill Cards and bundle fingerprints for source backfills", async () => {
    const { hashSkillFiles } = await import("./lib/skills");
    const sourceFingerprint = await hashSkillFiles([{ path: "SKILL.md", sha256: "abc" }]);
    const bundleFingerprint = await hashSkillFiles([
      { path: "SKILL.md", sha256: "abc" },
      { path: "skill-card.md", sha256: "def" },
    ]);

    const runQuery = vi.fn().mockResolvedValue({
      items: [
        {
          skillId: "skills:1",
          versionId: "skillVersions:1",
          versionFingerprint: sourceFingerprint,
          files: [
            { path: "SKILL.md", sha256: "abc" },
            { path: "skill-card.md", sha256: "def" },
          ],
          hasGeneratedBundleFingerprint: true,
          existingEntries: [
            {
              id: "skillVersionFingerprints:source",
              fingerprint: sourceFingerprint,
              kind: "source",
            },
            {
              id: "skillVersionFingerprints:bundle",
              fingerprint: bundleFingerprint,
              kind: "generated-bundle",
            },
          ],
        },
      ],
      cursor: null,
      isDone: true,
    });

    const runMutation = vi.fn();

    const result = await backfillSkillFingerprintsInternalHandler(
      { runQuery, runMutation } as never,
      { dryRun: false, batchSize: 10, maxBatches: 1 },
    );

    expect(result.ok).toBe(true);
    expect(result.stats.versionsPatched).toBe(0);
    expect(result.stats.fingerprintsInserted).toBe(0);
    expect(result.stats.fingerprintMismatches).toBe(0);
    expect(runMutation).not.toHaveBeenCalled();
  });
});

describe("maintenance empty skill cleanup", () => {
  it("dryRun detects empty skills and returns nominations", async () => {
    const runQuery = vi.fn().mockImplementation(async (endpoint: unknown) => {
      if (endpoint === internal.maintenance.getEmptySkillCleanupPageInternal) {
        return {
          items: [
            {
              skillId: "skills:1",
              slug: "spam-skill",
              ownerUserId: "users:1",
              latestVersionId: "skillVersions:1",
              softDeletedAt: undefined,
              summary: "Expert guidance for spam-skill.",
            },
          ],
          cursor: null,
          isDone: true,
        };
      }
      if (endpoint === internal.skills.getVersionByIdInternal) {
        return {
          _id: "skillVersions:1",
          files: [{ path: "SKILL.md", size: 120, storageId: "storage:1" }],
        };
      }
      if (endpoint === internal.users.getByIdInternal) {
        return { _id: "users:1", handle: "spammer", _creationTime: Date.now() };
      }
      if (endpoint === internal.skills.getOwnerSkillActivityInternal) {
        return [];
      }
      throw new Error(`Unexpected endpoint: ${String(endpoint)}`);
    });

    const runMutation = vi.fn();
    const storageGet = vi
      .fn()
      .mockResolvedValue(
        makeBlob(`# Demo\n- Step-by-step tutorials\n- Tips and techniques\n- Project ideas`),
      );

    const result = await cleanupEmptySkillsInternalHandler(
      { runQuery, runMutation, storage: { get: storageGet } } as never,
      { dryRun: true, batchSize: 10, maxBatches: 1, nominationThreshold: 1 },
    );

    expect(result.ok).toBe(true);
    expect(result.isDone).toBe(true);
    expect(result.cursor).toBeNull();
    expect(result.stats.emptyDetected).toBe(1);
    expect(result.stats.skillsDeleted).toBe(0);
    expect(result.nominations).toEqual([
      {
        userId: "users:1",
        handle: "spammer",
        emptySkillCount: 1,
        sampleSlugs: ["spam-skill"],
      },
    ]);
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("apply mode deletes empty skills", async () => {
    const runQuery = vi.fn().mockImplementation(async (endpoint: unknown) => {
      if (endpoint === internal.maintenance.getEmptySkillCleanupPageInternal) {
        return {
          items: [
            {
              skillId: "skills:1",
              slug: "spam-a",
              ownerUserId: "users:1",
              latestVersionId: "skillVersions:1",
              summary: "Expert guidance for spam-a.",
            },
            {
              skillId: "skills:2",
              slug: "spam-b",
              ownerUserId: "users:1",
              latestVersionId: "skillVersions:2",
              summary: "Expert guidance for spam-b.",
            },
          ],
          cursor: null,
          isDone: true,
        };
      }
      if (endpoint === internal.skills.getVersionByIdInternal) {
        return {
          files: [{ path: "SKILL.md", size: 120, storageId: "storage:1" }],
        };
      }
      if (endpoint === internal.users.getByIdInternal) {
        return { _id: "users:1", handle: "spammer", _creationTime: Date.now() };
      }
      if (endpoint === internal.skills.getOwnerSkillActivityInternal) {
        return [];
      }
      throw new Error(`Unexpected endpoint: ${String(endpoint)}`);
    });

    const runMutation = vi.fn().mockImplementation(async (endpoint: unknown) => {
      if (endpoint === internal.maintenance.applyEmptySkillCleanupInternal) {
        return { deleted: true };
      }
      throw new Error(`Unexpected mutation endpoint: ${String(endpoint)}`);
    });

    const storageGet = vi
      .fn()
      .mockResolvedValue(
        makeBlob(`# Demo\n- Step-by-step tutorials\n- Tips and techniques\n- Project ideas`),
      );

    const result = await cleanupEmptySkillsInternalHandler(
      { runQuery, runMutation, storage: { get: storageGet } } as never,
      { dryRun: false, batchSize: 10, maxBatches: 1, nominationThreshold: 2 },
    );

    expect(result.ok).toBe(true);
    expect(result.isDone).toBe(true);
    expect(result.cursor).toBeNull();
    expect(result.stats.emptyDetected).toBe(2);
    expect(result.stats.skillsDeleted).toBe(2);
    expect(result.nominations).toEqual([
      {
        userId: "users:1",
        handle: "spammer",
        emptySkillCount: 2,
        sampleSlugs: ["spam-a", "spam-b"],
      },
    ]);
  });
});

describe("maintenance empty skill nominations", () => {
  it("creates ban nominations from backfilled empty deletions", async () => {
    const runQuery = vi.fn().mockImplementation(async (endpoint: unknown, args: unknown) => {
      if (endpoint === internal.maintenance.getEmptySkillCleanupPageInternal) {
        const cursor = (args as { cursor?: string | undefined }).cursor;
        if (!cursor) {
          return {
            items: [
              {
                skillId: "skills:1",
                slug: "spam-a",
                ownerUserId: "users:1",
                softDeletedAt: 1,
                moderationReason: "quality.empty.backfill",
              },
              {
                skillId: "skills:2",
                slug: "spam-b",
                ownerUserId: "users:1",
                softDeletedAt: 1,
                moderationReason: "quality.empty.backfill",
              },
            ],
            cursor: "next",
            isDone: false,
          };
        }
        return {
          items: [
            {
              skillId: "skills:3",
              slug: "valid-hidden",
              ownerUserId: "users:2",
              softDeletedAt: 1,
              moderationReason: "scanner.vt.suspicious",
            },
          ],
          cursor: null,
          isDone: true,
        };
      }
      if (endpoint === internal.users.getByIdInternal) {
        return { _id: "users:1", handle: "spammer" };
      }
      throw new Error(`Unexpected query endpoint: ${String(endpoint)}`);
    });

    const runMutation = vi.fn().mockImplementation(async (endpoint: unknown) => {
      if (endpoint === internal.maintenance.nominateUserForEmptySkillSpamInternal) {
        return { created: true };
      }
      throw new Error(`Unexpected mutation endpoint: ${String(endpoint)}`);
    });

    const result = await nominateEmptySkillSpammersInternalHandler(
      { runQuery, runMutation } as never,
      { batchSize: 10, maxBatches: 2, nominationThreshold: 2 },
    );

    expect(result.ok).toBe(true);
    expect(result.isDone).toBe(true);
    expect(result.stats.usersFlagged).toBe(1);
    expect(result.stats.nominationsCreated).toBe(1);
    expect(result.stats.nominationsExisting).toBe(0);
    expect(result.nominations).toEqual([
      {
        userId: "users:1",
        handle: "spammer",
        emptySkillCount: 2,
        sampleSlugs: ["spam-a", "spam-b"],
      },
    ]);
  });
});
