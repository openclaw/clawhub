/* @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Doc, Id, TableNames } from "./_generated/dataModel";
import {
  internalMutation,
  isGitHubMirrorEligibleSkillDoc,
  repointPackageLatestRelease,
  scheduleGitHubBackupDeletionForSkill,
  scheduleOwnerPublisherDigestSync,
  shouldScheduleOwnerPublisherDigestSyncForPublisherChange,
  shouldScheduleOwnerUserPackageDigestSyncForUserChange,
  syncPackageSearchDigestForPackageId,
  syncPackageSearchDigestsForOwnerPublisherId,
  syncPackageSearchDigestsForOwnerUserId,
  syncSkillSearchDigestsForOwnerPublisherId,
} from "./functions";
import { computeRecommendationScore } from "./lib/recommendationScore";

type WrappedHandler = {
  _handler: (ctx: unknown, args: Record<string, never>) => Promise<unknown>;
};

function hasWrappedHandler(value: unknown): value is WrappedHandler {
  return typeof value === "function" && "_handler" in value && typeof value._handler === "function";
}

function getWrappedHandler(value: unknown): WrappedHandler["_handler"] {
  if (!hasWrappedHandler(value)) {
    throw new Error("Expected a Convex function with a test-callable _handler");
  }
  return value._handler;
}

function testId<TableName extends TableNames>(
  tableName: TableName,
  value: `${TableName}:${string}`,
): Id<TableName> {
  if (!value.startsWith(`${tableName}:`)) {
    throw new Error(`Expected ${value} to be a ${tableName} id`);
  }
  return value as Id<TableName>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

describe("package digest sync", () => {
  it("identifies GitHub mirror eligibility from skill visibility fields", () => {
    expect(isGitHubMirrorEligibleSkillDoc({ softDeletedAt: undefined })).toBe(true);
    expect(
      isGitHubMirrorEligibleSkillDoc({
        softDeletedAt: undefined,
        moderationStatus: "active",
      }),
    ).toBe(true);
    expect(
      isGitHubMirrorEligibleSkillDoc({
        softDeletedAt: undefined,
        moderationStatus: "active",
        moderationVerdict: "malicious",
      }),
    ).toBe(false);
    expect(
      isGitHubMirrorEligibleSkillDoc({
        softDeletedAt: undefined,
        moderationStatus: "active",
        moderationFlags: ["blocked.malware"],
      }),
    ).toBe(false);
    expect(
      isGitHubMirrorEligibleSkillDoc({
        softDeletedAt: undefined,
        moderationStatus: "hidden",
      }),
    ).toBe(false);
    expect(
      isGitHubMirrorEligibleSkillDoc({
        softDeletedAt: undefined,
        moderationStatus: "removed",
      }),
    ).toBe(false);
    expect(isGitHubMirrorEligibleSkillDoc({ softDeletedAt: 123 })).toBe(false);
  });

  it("schedules GitHub mirror deletion for a skill using the owner handle", async () => {
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:owner") {
            return {
              _id: "users:owner",
              handle: "alice",
              deletedAt: undefined,
              deactivatedAt: undefined,
            };
          }
          return null;
        }),
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            unique: vi.fn().mockResolvedValue(null),
          })),
        })),
      },
      scheduler: {
        runAfter: vi.fn(),
      },
    };

    await scheduleGitHubBackupDeletionForSkill(
      ctx as never,
      {
        slug: "hidden-skill",
        ownerUserId: "users:owner",
        ownerPublisherId: undefined,
        softDeletedAt: 123,
        moderationStatus: "hidden",
      } as never,
    );

    expect(ctx.scheduler.runAfter).toHaveBeenCalledWith(
      0,
      internal.githubBackupsNode.deleteGitHubBackupForSlugInternal,
      {
        ownerHandle: "alice",
        slug: "hidden-skill",
      },
    );
  });

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

    await syncPackageSearchDigestForPackageId(ctx as never, "packages:demo" as never);

    expect(ctx.db.insert).toHaveBeenCalledWith(
      "packageSearchDigest",
      expect.objectContaining({
        packageId: "packages:demo",
        latestVersion: undefined,
        ownerHandle: "owner",
        pluginCategoryTags: ["dev-tools"],
      }),
    );
    expect(ctx.db.insert).toHaveBeenCalledWith(
      "packagePluginCategorySearchDigest",
      expect.objectContaining({
        packageId: "packages:demo",
        pluginCategory: "dev-tools",
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

    await syncPackageSearchDigestForPackageId(ctx as never, "packages:demo" as never);

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
          if (
            table === "packageCapabilitySearchDigest" ||
            table === "packagePluginCategorySearchDigest"
          ) {
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
          if (
            table === "packageCapabilitySearchDigest" ||
            table === "packagePluginCategorySearchDigest"
          ) {
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
    const paginate = vi.fn().mockResolvedValueOnce({
      page: [pkg],
      isDone: true,
      continueCursor: "",
    });
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
                paginate,
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
          if (
            table === "packageCapabilitySearchDigest" ||
            table === "packagePluginCategorySearchDigest"
          ) {
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

    await syncPackageSearchDigestsForOwnerUserId(ctx as never, "users:owner" as never);

    expect(paginate).toHaveBeenCalledWith({ cursor: null, numItems: 100 });
    expect(ctx.db.insert).toHaveBeenCalledWith(
      "packageSearchDigest",
      expect.objectContaining({
        packageId: "packages:demo",
        ownerHandle: "renamed",
      }),
    );
  });
});

describe("user package digest scheduling", () => {
  const user = {
    _id: "users:owner",
    handle: "owner",
    deletedAt: undefined,
    deactivatedAt: undefined,
  };

  it("schedules package digest sync when an active user's handle changes", () => {
    expect(
      shouldScheduleOwnerUserPackageDigestSyncForUserChange({
        id: "users:owner",
        operation: "update",
        oldDoc: user,
        newDoc: { ...user, handle: "renamed" },
      } as never),
    ).toBe(true);
  });

  it("skips redundant package digest sync when a user becomes deactivated", () => {
    expect(
      shouldScheduleOwnerUserPackageDigestSyncForUserChange({
        id: "users:owner",
        operation: "update",
        oldDoc: user,
        newDoc: { ...user, handle: null, deactivatedAt: 1_700_000_000_000 },
      } as never),
    ).toBe(false);
  });

  it("skips unchanged user updates", () => {
    expect(
      shouldScheduleOwnerUserPackageDigestSyncForUserChange({
        id: "users:owner",
        operation: "update",
        oldDoc: user,
        newDoc: { ...user },
      } as never),
    ).toBe(false);
  });
});

describe("publisher digest scheduling", () => {
  const publisherChangeDoc = {
    _id: "publishers:demo",
    kind: "org",
    handle: "demo",
    displayName: "Demo",
    image: null,
    deletedAt: undefined,
    deactivatedAt: undefined,
  };

  it("schedules digest sync when an active publisher's profile changes", () => {
    expect(
      shouldScheduleOwnerPublisherDigestSyncForPublisherChange({
        id: "publishers:demo",
        operation: "update",
        oldDoc: publisherChangeDoc,
        newDoc: { ...publisherChangeDoc, displayName: "Renamed Demo" },
      } as never),
    ).toBe(true);
  });

  it("skips redundant digest sync when a publisher becomes deactivated", () => {
    expect(
      shouldScheduleOwnerPublisherDigestSyncForPublisherChange({
        id: "publishers:demo",
        operation: "update",
        oldDoc: publisherChangeDoc,
        newDoc: { ...publisherChangeDoc, handle: null, deactivatedAt: 1_700_000_000_000 },
      } as never),
    ).toBe(false);
  });

  it("skips unchanged publisher updates", () => {
    expect(
      shouldScheduleOwnerPublisherDigestSyncForPublisherChange({
        id: "publishers:demo",
        operation: "update",
        oldDoc: publisherChangeDoc,
        newDoc: { ...publisherChangeDoc },
      } as never),
    ).toBe(false);
  });

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

  it("continues owner-publisher package digest sync one page at a time", async () => {
    const paginate = vi.fn().mockResolvedValue({
      page: [],
      isDone: false,
      continueCursor: "next-packages",
    });
    const ctx = {
      db: {
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({ paginate })),
        })),
      },
      scheduler: {
        runAfter: vi.fn().mockResolvedValue(undefined),
      },
    };

    await syncPackageSearchDigestsForOwnerPublisherId(
      ctx as never,
      "publishers:demo" as never,
      "current-packages",
    );

    expect(paginate).toHaveBeenCalledTimes(1);
    expect(paginate).toHaveBeenCalledWith({ cursor: "current-packages", numItems: 100 });
    expect(ctx.scheduler.runAfter).toHaveBeenCalledWith(
      0,
      internal.functions.syncPackageSearchDigestsForOwnerPublisherIdInternal,
      { ownerPublisherId: "publishers:demo", cursor: "next-packages" },
    );
  });

  it("continues owner-publisher skill digest sync one page at a time", async () => {
    const paginate = vi.fn().mockResolvedValue({
      page: [],
      isDone: false,
      continueCursor: "next-skills",
    });
    const ctx = {
      db: {
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({ paginate })),
        })),
      },
      scheduler: {
        runAfter: vi.fn().mockResolvedValue(undefined),
      },
    };

    await syncSkillSearchDigestsForOwnerPublisherId(
      ctx as never,
      "publishers:demo" as never,
      "current-skills",
    );

    expect(paginate).toHaveBeenCalledTimes(1);
    expect(paginate).toHaveBeenCalledWith({ cursor: "current-skills", numItems: 100 });
    expect(ctx.scheduler.runAfter).toHaveBeenCalledWith(
      0,
      internal.functions.syncSkillSearchDigestsForOwnerPublisherIdInternal,
      { ownerPublisherId: "publishers:demo", cursor: "next-skills" },
    );
  });

  it("syncs recommended rank stats into the skill search digest after wrapped skill patches", async () => {
    const skillId = testId("skills", "skills:demo");
    const ownerUserId = testId("users", "users:owner");
    const publisherId = testId("publishers", "publishers:owner");
    const digestId = testId("skillSearchDigest", "skillSearchDigest:demo");

    const skill = {
      _id: skillId,
      _creationTime: 1,
      slug: "demo-skill",
      displayName: "Demo Skill",
      summary: "Demo summary",
      ownerUserId,
      ownerPublisherId: publisherId,
      tags: {},
      statsDownloads: 3,
      statsStars: 2,
      statsInstallsCurrent: 4,
      statsInstallsAllTime: 5,
      stats: {
        downloads: 3,
        stars: 2,
        installsCurrent: 4,
        installsAllTime: 5,
        versions: 1,
        comments: 0,
      },
      createdAt: 10,
      updatedAt: 20,
    } satisfies Doc<"skills">;
    const publisher = {
      _id: publisherId,
      _creationTime: 2,
      kind: "user",
      handle: "owner",
      displayName: "Owner",
      linkedUserId: ownerUserId,
      publishedSkills: 1,
      publishedPackages: 0,
      totalInstalls: 5,
      totalDownloads: 3,
      totalStars: 2,
      skillTotalInstalls: 5,
      skillTotalDownloads: 3,
      skillTotalStars: 2,
      createdAt: 10,
      updatedAt: 20,
    } satisfies Doc<"publishers">;
    const digest = {
      _id: digestId,
      _creationTime: 3,
      skillId,
      slug: "demo-skill",
      displayName: "Demo Skill",
      summary: "Demo summary",
      ownerUserId,
      ownerPublisherId: publisherId,
      ownerHandle: "owner",
      ownerKind: "user",
      ownerDisplayName: "Owner",
      tags: {},
      statsDownloads: 3,
      statsStars: 2,
      statsInstallsCurrent: 4,
      statsInstallsAllTime: 5,
      stats: {
        downloads: 3,
        stars: 2,
        installsCurrent: 4,
        installsAllTime: 5,
        versions: 1,
        comments: 0,
      },
      createdAt: 10,
      updatedAt: 20,
    } satisfies Doc<"skillSearchDigest">;
    const docs = new Map<string, unknown>([
      [skillId, skill],
      [publisherId, publisher],
      [digestId, digest],
    ]);
    const patchSkillRankStats = internalMutation({
      args: {},
      handler: async (ctx) => {
        await ctx.db.patch(skillId, {
          statsDownloads: 13,
          statsStars: 7,
          statsInstallsAllTime: 11,
          stats: {
            downloads: 13,
            stars: 7,
            installsCurrent: 4,
            installsAllTime: 11,
            versions: 1,
            comments: 0,
          },
        });
      },
    });
    const handler = getWrappedHandler(patchSkillRankStats);
    const db = {
      system: {},
      normalizeId: vi.fn((tableName: string, id: string) =>
        id.startsWith(`${tableName}:`) ? id : null,
      ),
      get: vi.fn(async (first: string, second?: string) => docs.get(second ?? first) ?? null),
      insert: vi.fn(async (tableName: string, value: unknown) => {
        if (!isRecord(value))
          throw new Error(`Expected inserted ${tableName} value to be an object`);
        const insertedId = `${tableName}:inserted`;
        docs.set(insertedId, { ...value, _id: insertedId, _creationTime: 0 });
        return insertedId;
      }),
      patch: vi.fn(
        async (first: string, second: string | Record<string, unknown>, third?: unknown) => {
          const id = typeof second === "string" ? second : first;
          const patch = typeof second === "string" ? third : second;
          if (!isRecord(patch)) throw new Error(`Expected patch for ${id} to be an object`);
          const existing = docs.get(id);
          if (!isRecord(existing)) throw new Error(`Missing test doc ${id}`);
          docs.set(id, { ...existing, ...patch });
        },
      ),
      delete: vi.fn(async (first: string, second?: string) => {
        docs.delete(second ?? first);
      }),
      query: vi.fn((tableName: string) => ({
        withIndex: vi.fn(() => ({
          unique: vi.fn(async () => {
            if (tableName === "skillSearchDigest") return docs.get(digestId) ?? null;
            return null;
          }),
          collect: vi.fn(async () => []),
          paginate: vi.fn(async () => ({ page: [], isDone: true, continueCursor: "" })),
          take: vi.fn(async () => []),
        })),
      })),
    };

    await expect(handler({ db }, {})).resolves.toBeUndefined();

    expect(docs.get(digestId)).toEqual(
      expect.objectContaining({
        statsDownloads: 13,
        statsStars: 7,
        statsInstallsAllTime: 11,
        recommendedScore: computeRecommendationScore({ downloads: 13, installs: 11, stars: 7 }),
        stats: expect.objectContaining({
          downloads: 13,
          stars: 7,
          installsAllTime: 11,
        }),
      }),
    );
  });
});
