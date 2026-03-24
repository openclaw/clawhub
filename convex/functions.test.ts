/* @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import {
  repointPackageLatestRelease,
  scheduleOwnerPublisherDigestSync,
  syncPackageSearchDigestForPackageId,
  syncPackageSearchDigestsForOwnerPublisherId,
  syncPackageSearchDigestsForOwnerUserId,
  syncSkillSearchDigestsForOwnerPublisherId,
} from "./functions";

describe("package digest sync", () => {
  it("clears latestVersion when the current package release is soft-deleted", async () => {
    const pkg = {
      _id: "packages:demo",
      name: "demo-plugin",
      normalizedName: "demo-plugin",
      displayName: "Demo Plugin",
      family: "code-plugin",
      channel: "community",
      isOfficial: false,
      ownerUserId: "users:owner",
      summary: "demo",
      capabilityTags: ["tools"],
      executesCode: true,
      runtimeId: null,
      softDeletedAt: undefined,
      createdAt: 1,
      updatedAt: 2,
      latestReleaseId: "packageReleases:demo-2",
      latestVersionSummary: { version: "2.0.0" },
      verification: { tier: "community" },
    };
    const latestRelease = {
      _id: "packageReleases:demo-2",
      version: "2.0.0",
      softDeletedAt: 10,
    };
    const owner = {
      _id: "users:owner",
      handle: "owner",
      deletedAt: undefined,
      deactivatedAt: undefined,
    };
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "packages:demo") return pkg;
          if (id === "packageReleases:demo-2") return latestRelease;
          if (id === "users:owner") return owner;
          return null;
        }),
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            unique: vi.fn().mockResolvedValue(null),
            collect: vi.fn().mockResolvedValue([]),
          })),
        })),
        patch: vi.fn(),
        insert: vi.fn(),
        delete: vi.fn(),
      },
    };

    await syncPackageSearchDigestForPackageId(
      ctx as never,
      "packages:demo" as never,
    );

    expect(ctx.db.insert).toHaveBeenCalledWith(
      "packageSearchDigest",
      expect.objectContaining({
        packageId: "packages:demo",
        latestVersion: undefined,
        ownerHandle: "owner",
      }),
    );
  });

  it("preserves latestVersion when the current package release is active", async () => {
    const pkg = {
      _id: "packages:demo",
      name: "demo-plugin",
      normalizedName: "demo-plugin",
      displayName: "Demo Plugin",
      family: "code-plugin",
      channel: "community",
      isOfficial: false,
      ownerUserId: "users:owner",
      summary: "demo",
      capabilityTags: ["tools"],
      executesCode: true,
      runtimeId: null,
      softDeletedAt: undefined,
      createdAt: 1,
      updatedAt: 2,
      latestReleaseId: "packageReleases:demo-2",
      latestVersionSummary: { version: "2.0.0" },
      verification: { tier: "community" },
    };
    const latestRelease = {
      _id: "packageReleases:demo-2",
      version: "2.0.0",
    };
    const owner = {
      _id: "users:owner",
      handle: "owner",
      deletedAt: undefined,
      deactivatedAt: undefined,
    };
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "packages:demo") return pkg;
          if (id === "packageReleases:demo-2") return latestRelease;
          if (id === "users:owner") return owner;
          return null;
        }),
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            unique: vi.fn().mockResolvedValue(null),
            collect: vi.fn().mockResolvedValue([]),
          })),
        })),
        patch: vi.fn(),
        insert: vi.fn(),
        delete: vi.fn(),
      },
    };

    await syncPackageSearchDigestForPackageId(
      ctx as never,
      "packages:demo" as never,
    );

    expect(ctx.db.insert).toHaveBeenCalledWith(
      "packageSearchDigest",
      expect.objectContaining({
        packageId: "packages:demo",
        latestVersion: "2.0.0",
        ownerHandle: "owner",
      }),
    );
  });

  it("repoints packages to the highest-version active release and restores its summary", async () => {
    const pkg = {
      _id: "packages:demo",
      _creationTime: 1,
      name: "demo-plugin",
      normalizedName: "demo-plugin",
      displayName: "Demo Plugin",
      family: "code-plugin",
      channel: "community",
      isOfficial: false,
      ownerUserId: "users:owner",
      summary: "latest summary",
      tags: {
        latest: "packageReleases:demo-2",
        stable: "packageReleases:demo-2",
      },
      latestReleaseId: "packageReleases:demo-2",
      latestVersionSummary: { version: "2.0.0" },
      capabilityTags: ["new"],
      executesCode: true,
      compatibility: { openclaw: "^2.0.0" },
      capabilities: { capabilityTags: ["new"], executesCode: true },
      verification: { tier: "community" },
      runtimeId: null,
      softDeletedAt: undefined,
      createdAt: 1,
      updatedAt: 2,
    };
    const fallbackRelease = {
      _id: "packageReleases:demo-1",
      _creationTime: 10,
      packageId: "packages:demo",
      version: "1.0.0",
      changelog: "old stable",
      summary: "stable summary",
      compatibility: { openclaw: "^1.0.0" },
      capabilities: { capabilityTags: ["stable"], executesCode: false },
      verification: { tier: "verified" },
      distTags: ["stable"],
      createdAt: 10,
      softDeletedAt: undefined,
    };
    const legacyHotfixRelease = {
      _id: "packageReleases:demo-legacy",
      _creationTime: 20,
      packageId: "packages:demo",
      version: "0.9.9",
      changelog: "legacy hotfix",
      summary: "legacy summary",
      compatibility: { openclaw: "^0.9.0" },
      capabilities: { capabilityTags: ["legacy"], executesCode: false },
      verification: { tier: "verified" },
      distTags: ["legacy"],
      createdAt: 20,
      softDeletedAt: undefined,
    };
    const owner = {
      _id: "users:owner",
      handle: "owner",
      deletedAt: undefined,
      deactivatedAt: undefined,
    };
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "packages:demo") return pkg;
          if (id === "packageReleases:demo-1") return fallbackRelease;
          if (id === "users:owner") return owner;
          return null;
        }),
        query: vi.fn((table: string) => {
          if (table === "packageReleases") {
            return {
              withIndex: vi.fn(() => ({
                order: vi.fn(() => ({
                  paginate: vi.fn().mockResolvedValue({
                    page: [legacyHotfixRelease, fallbackRelease],
                    isDone: true,
                    continueCursor: "",
                  }),
                })),
              })),
            };
          }
          if (table === "packageSearchDigest") {
            return {
              withIndex: vi.fn(() => ({
                unique: vi.fn().mockResolvedValue(null),
                collect: vi.fn().mockResolvedValue([]),
              })),
            };
          }
          if (table === "packageCapabilitySearchDigest") {
            return {
              withIndex: vi.fn(() => ({
                unique: vi.fn().mockResolvedValue(null),
                collect: vi.fn().mockResolvedValue([]),
              })),
            };
          }
          throw new Error(`Unexpected table ${table}`);
        }),
        patch: vi.fn(),
        insert: vi.fn(),
        delete: vi.fn(),
      },
    };

    await repointPackageLatestRelease(
      ctx as never,
      "packages:demo" as never,
      "packageReleases:demo-2" as never,
    );

    expect(ctx.db.patch).toHaveBeenCalledWith("packageReleases:demo-1", {
      distTags: ["stable", "latest"],
    });
    expect(ctx.db.patch).toHaveBeenCalledWith(
      "packages:demo",
      expect.objectContaining({
        latestReleaseId: "packageReleases:demo-1",
        tags: { latest: "packageReleases:demo-1" },
        latestVersionSummary: expect.objectContaining({ version: "1.0.0" }),
        summary: "stable summary",
        capabilityTags: ["stable"],
        executesCode: false,
      }),
    );
    expect(ctx.db.insert).toHaveBeenCalledWith(
      "packageSearchDigest",
      expect.objectContaining({
        latestVersion: "1.0.0",
        ownerHandle: "owner",
      }),
    );
  });

  it("repoints bundle packages to the newest surviving release, not semver-looking versions", async () => {
    const pkg = {
      _id: "packages:bundle",
      _creationTime: 1,
      name: "demo-bundle",
      normalizedName: "demo-bundle",
      displayName: "Demo Bundle",
      family: "bundle-plugin",
      channel: "community",
      isOfficial: false,
      ownerUserId: "users:owner",
      summary: "latest summary",
      tags: {
        latest: "packageReleases:bundle-latest",
      },
      latestReleaseId: "packageReleases:bundle-latest",
      latestVersionSummary: { version: "latest" },
      capabilityTags: ["new"],
      executesCode: false,
      compatibility: { hosts: ["openclaw"] },
      capabilities: { capabilityTags: ["new"], executesCode: false },
      verification: { tier: "community" },
      runtimeId: "bundle.runtime",
      softDeletedAt: undefined,
      createdAt: 1,
      updatedAt: 2,
    };
    const semverLookingRelease = {
      _id: "packageReleases:bundle-semver",
      _creationTime: 10,
      packageId: "packages:bundle",
      version: "2.0.0",
      changelog: "older semver",
      summary: "older semver summary",
      compatibility: { hosts: ["openclaw"] },
      capabilities: { capabilityTags: ["semver"], executesCode: false },
      verification: { tier: "verified" },
      distTags: ["legacy"],
      createdAt: 10,
      softDeletedAt: undefined,
    };
    const newestRelease = {
      _id: "packageReleases:bundle-newest",
      _creationTime: 20,
      packageId: "packages:bundle",
      version: "2024-12",
      changelog: "newest bundle build",
      summary: "newest bundle summary",
      compatibility: { hosts: ["openclaw"] },
      capabilities: { capabilityTags: ["bundle"], executesCode: false },
      verification: { tier: "verified" },
      distTags: ["release-2024-12"],
      createdAt: 20,
      softDeletedAt: undefined,
    };
    const owner = {
      _id: "users:owner",
      handle: "owner",
      deletedAt: undefined,
      deactivatedAt: undefined,
    };
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "packages:bundle") return pkg;
          if (id === "packageReleases:bundle-newest") return newestRelease;
          if (id === "users:owner") return owner;
          return null;
        }),
        query: vi.fn((table: string) => {
          if (table === "packageReleases") {
            return {
              withIndex: vi.fn(() => ({
                order: vi.fn(() => ({
                  paginate: vi.fn().mockResolvedValue({
                    page: [newestRelease, semverLookingRelease],
                    isDone: true,
                    continueCursor: "",
                  }),
                })),
              })),
            };
          }
          if (table === "packageSearchDigest") {
            return {
              withIndex: vi.fn(() => ({
                unique: vi.fn().mockResolvedValue(null),
                collect: vi.fn().mockResolvedValue([]),
              })),
            };
          }
          if (table === "packageCapabilitySearchDigest") {
            return {
              withIndex: vi.fn(() => ({
                unique: vi.fn().mockResolvedValue(null),
                collect: vi.fn().mockResolvedValue([]),
              })),
            };
          }
          throw new Error(`Unexpected table ${table}`);
        }),
        patch: vi.fn(),
        insert: vi.fn(),
        delete: vi.fn(),
      },
    };

    await repointPackageLatestRelease(
      ctx as never,
      "packages:bundle" as never,
      "packageReleases:bundle-latest" as never,
    );

    expect(ctx.db.patch).toHaveBeenCalledWith("packageReleases:bundle-newest", {
      distTags: ["release-2024-12", "latest"],
    });
    expect(ctx.db.patch).toHaveBeenCalledWith(
      "packages:bundle",
      expect.objectContaining({
        latestReleaseId: "packageReleases:bundle-newest",
        tags: { latest: "packageReleases:bundle-newest" },
        latestVersionSummary: expect.objectContaining({ version: "2024-12" }),
        summary: "newest bundle summary",
      }),
    );
    expect(ctx.db.insert).toHaveBeenCalledWith(
      "packageSearchDigest",
      expect.objectContaining({
        latestVersion: "2024-12",
        ownerHandle: "owner",
      }),
    );
  });

  it("re-syncs package digests when an owner handle changes", async () => {
    const owner = {
      _id: "users:owner",
      handle: "renamed",
      deletedAt: undefined,
      deactivatedAt: undefined,
    };
    const pkg = {
      _id: "packages:demo",
      _creationTime: 1,
      name: "demo-plugin",
      normalizedName: "demo-plugin",
      displayName: "Demo Plugin",
      family: "code-plugin",
      channel: "community",
      isOfficial: false,
      ownerUserId: "users:owner",
      summary: "demo",
      tags: {},
      latestReleaseId: undefined,
      latestVersionSummary: undefined,
      capabilityTags: [],
      executesCode: false,
      runtimeId: null,
      softDeletedAt: undefined,
      createdAt: 1,
      updatedAt: 2,
      verification: undefined,
    };
    const take = vi.fn().mockResolvedValueOnce([pkg]);
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:owner") return owner;
          return null;
        }),
        query: vi.fn((table: string) => {
          if (table === "packages") {
            return {
              withIndex: vi.fn(() => ({
                take,
              })),
            };
          }
          if (table === "packageSearchDigest") {
            return {
              withIndex: vi.fn(() => ({
                unique: vi.fn().mockResolvedValue(null),
                collect: vi.fn().mockResolvedValue([]),
              })),
            };
          }
          if (table === "packageCapabilitySearchDigest") {
            return {
              withIndex: vi.fn(() => ({
                unique: vi.fn().mockResolvedValue(null),
                collect: vi.fn().mockResolvedValue([]),
              })),
            };
          }
          throw new Error(`Unexpected table ${table}`);
        }),
        patch: vi.fn(),
        insert: vi.fn(),
        delete: vi.fn(),
      },
    };

    await syncPackageSearchDigestsForOwnerUserId(
      ctx as never,
      "users:owner" as never,
    );

    expect(take).toHaveBeenCalled();
    expect(ctx.db.insert).toHaveBeenCalledWith(
      "packageSearchDigest",
      expect.objectContaining({
        packageId: "packages:demo",
        ownerHandle: "renamed",
      }),
    );
  });

  it("publisher trigger can call both package and skill sync without pagination conflict (#1201)", async () => {
    const publisher = {
      _id: "publishers:pub1",
      handle: "testpub",
      kind: "user" as const,
      displayName: "Test Publisher",
      linkedUserId: "users:owner",
      image: undefined,
      deletedAt: undefined,
      deactivatedAt: undefined,
    };
    const pkg = {
      _id: "packages:demo",
      name: "demo-plugin",
      normalizedName: "demo-plugin",
      displayName: "Demo Plugin",
      family: "code-plugin",
      channel: "community",
      isOfficial: false,
      ownerUserId: "users:owner",
      ownerPublisherId: "publishers:pub1",
      summary: "demo",
      capabilityTags: [],
      executesCode: false,
      runtimeId: null,
      softDeletedAt: undefined,
      createdAt: 1,
      updatedAt: 2,
      latestReleaseId: undefined,
      latestVersionSummary: undefined,
      verification: undefined,
    };
    const skill = {
      _id: "skills:skill1",
      slug: "test-skill",
      displayName: "Test Skill",
      summary: "A test skill",
      ownerUserId: "users:owner",
      ownerPublisherId: "publishers:pub1",
      canonicalSkillId: undefined,
      forkOf: undefined,
      latestVersionId: undefined,
      latestVersionSummary: undefined,
      tags: [],
      badges: [],
      stats: undefined,
      statsDownloads: 0,
      statsStars: 0,
      statsInstallsCurrent: 0,
      statsInstallsAllTime: 0,
      softDeletedAt: undefined,
      moderationStatus: undefined,
      moderationFlags: undefined,
      moderationReason: undefined,
      createdAt: 1,
      updatedAt: 2,
      isSuspicious: false,
    };
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "publishers:pub1") return publisher;
          return null;
        }),
        query: vi.fn((table: string) => {
          if (table === "packages") {
            return {
              withIndex: vi.fn(() => ({
                take: vi.fn().mockResolvedValue([pkg]),
              })),
            };
          }
          if (table === "skills") {
            return {
              withIndex: vi.fn(() => ({
                take: vi.fn().mockResolvedValue([skill]),
              })),
            };
          }
          if (table === "packageSearchDigest" || table === "packageCapabilitySearchDigest") {
            return {
              withIndex: vi.fn(() => ({
                unique: vi.fn().mockResolvedValue(null),
                collect: vi.fn().mockResolvedValue([]),
              })),
            };
          }
          if (table === "skillSearchDigest") {
            return {
              withIndex: vi.fn(() => ({
                unique: vi.fn().mockResolvedValue(null),
              })),
            };
          }
          throw new Error(`Unexpected table ${table}`);
        }),
        patch: vi.fn(),
        insert: vi.fn(),
        delete: vi.fn(),
      },
    };

    // This simulates what the publishers trigger does — calling both
    // sync functions sequentially. With .paginate() this would fail
    // because Convex only allows one paginated query per function.
    await syncPackageSearchDigestsForOwnerPublisherId(
      ctx as never,
      "publishers:pub1" as never,
    );
    await syncSkillSearchDigestsForOwnerPublisherId(
      ctx as never,
      "publishers:pub1" as never,
    );

    expect(ctx.db.insert).toHaveBeenCalledWith(
      "packageSearchDigest",
      expect.objectContaining({ packageId: "packages:demo" }),
    );
    expect(ctx.db.insert).toHaveBeenCalledWith(
      "skillSearchDigest",
      expect.objectContaining({ skillId: "skills:skill1" }),
    );
  });
});

describe("publisher digest scheduling", () => {
  it("schedules package and skill digest sync in separate background mutations", async () => {
    const ctx = {
      scheduler: {
        runAfter: vi.fn().mockResolvedValue(undefined),
      },
    };

    await scheduleOwnerPublisherDigestSync(ctx as never, "publishers:demo" as never);

    expect(ctx.scheduler.runAfter).toHaveBeenCalledTimes(2);
    expect(ctx.scheduler.runAfter).toHaveBeenNthCalledWith(
      1,
      0,
      internal.functions.syncPackageSearchDigestsForOwnerPublisherIdInternal,
      { ownerPublisherId: "publishers:demo" },
    );
    expect(ctx.scheduler.runAfter).toHaveBeenNthCalledWith(
      2,
      0,
      internal.functions.syncSkillSearchDigestsForOwnerPublisherIdInternal,
      { ownerPublisherId: "publishers:demo" },
    );
  });

  it("skips scheduling when the trigger context has no scheduler", async () => {
    await expect(
      scheduleOwnerPublisherDigestSync({} as never, "publishers:demo" as never),
    ).resolves.toBeUndefined();
  });
});
