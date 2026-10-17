import { describe, expect, it, vi } from "vitest";
import {
  adjustPublisherStatsForPackageChange,
  adjustPublisherStatsForSkillChange,
} from "./publisherStats";

function makeSkill(overrides: Record<string, unknown>) {
  return {
    _id: "skills:demo",
    ownerPublisherId: "publishers:alice",
    softDeletedAt: undefined,
    statsDownloads: 10,
    statsStars: 2,
    statsInstallsAllTime: 4,
    stats: { downloads: 10, stars: 2, installsCurrent: 1, installsAllTime: 4 },
    ...overrides,
  } as never;
}

function makePackage(overrides: Record<string, unknown>) {
  return {
    _id: "packages:demo",
    ownerPublisherId: "publishers:alice",
    softDeletedAt: undefined,
    stats: { downloads: 10, installs: 4, stars: 2, versions: 1 },
    ...overrides,
  } as never;
}

describe("publisher stat maintenance", () => {
  it("recomputes missing publisher aggregates before accepting incremental deltas", async () => {
    const patch = vi.fn();
    const ctx = {
      db: {
        get: vi.fn(async (id: string) =>
          id === "publishers:alice"
            ? {
                _id: id,
                kind: "user",
                handle: "alice",
                displayName: "Alice",
                linkedUserId: "users:alice",
                createdAt: 1,
                updatedAt: 1,
              }
            : null,
        ),
        patch,
        query: vi.fn((table: string) => ({
          withIndex: vi.fn((indexName: string) => {
            if (table === "skills" && indexName === "by_owner_publisher_active_updated") {
              return {
                collect: vi.fn(async () => [
                  makeSkill({ statsDownloads: 11, statsStars: 2, statsInstallsAllTime: 5 }),
                  makeSkill({
                    _id: "skills:hidden",
                    moderationStatus: "hidden",
                    statsDownloads: 100,
                    statsStars: 100,
                    statsInstallsAllTime: 100,
                  }),
                ]),
              };
            }
            if (table === "packages" && indexName === "by_owner_publisher_active_updated") {
              return {
                collect: vi.fn(async () => [
                  {
                    _id: "packages:demo",
                    ownerPublisherId: "publishers:alice",
                    softDeletedAt: undefined,
                    stats: { downloads: 7, installs: 3, stars: 1, versions: 1 },
                  },
                ]),
              };
            }
            throw new Error(`unexpected ${table} index ${indexName}`);
          }),
        })),
      },
    };

    await adjustPublisherStatsForSkillChange(
      ctx as never,
      makeSkill({ statsDownloads: 10, statsInstallsAllTime: 4 }),
      makeSkill({ statsDownloads: 11, statsInstallsAllTime: 5 }),
    );

    expect(patch).toHaveBeenCalledWith("publishers:alice", {
      publishedSkills: 1,
      publishedPackages: 1,
      totalInstalls: 8,
      totalDownloads: 18,
      totalStars: 3,
      skillTotalInstalls: 5,
      skillTotalDownloads: 11,
      skillTotalStars: 2,
    });
  });

  it("uses deltas when publisher aggregates are already initialized", async () => {
    const patch = vi.fn();
    const ctx = {
      db: {
        get: vi.fn(async () => ({
          _id: "publishers:alice",
          kind: "user",
          handle: "alice",
          displayName: "Alice",
          linkedUserId: "users:alice",
          publishedSkills: 1,
          publishedPackages: 1,
          totalInstalls: 7,
          totalDownloads: 17,
          totalStars: 3,
          skillTotalInstalls: 4,
          skillTotalDownloads: 10,
          skillTotalStars: 2,
          createdAt: 1,
          updatedAt: 1,
        })),
        patch,
        query: vi.fn(),
      },
    };

    await adjustPublisherStatsForSkillChange(
      ctx as never,
      makeSkill({ statsDownloads: 10, statsInstallsAllTime: 4 }),
      makeSkill({ statsDownloads: 11, statsInstallsAllTime: 5 }),
    );

    expect(patch).toHaveBeenCalledWith("publishers:alice", {
      publishedSkills: 1,
      publishedPackages: 1,
      totalInstalls: 8,
      totalDownloads: 18,
      totalStars: 3,
      skillTotalInstalls: 5,
      skillTotalDownloads: 11,
      skillTotalStars: 2,
    });
    expect(ctx.db.query).not.toHaveBeenCalled();
  });

  it("does not count hidden skills in public publisher aggregates", async () => {
    const ctx = {
      db: {
        get: vi.fn(),
        patch: vi.fn(),
        query: vi.fn(),
      },
    };

    await adjustPublisherStatsForSkillChange(
      ctx as never,
      null,
      makeSkill({ moderationStatus: "hidden", moderationReason: "pending.scan" }),
    );

    expect(ctx.db.get).not.toHaveBeenCalled();
    expect(ctx.db.patch).not.toHaveBeenCalled();
    expect(ctx.db.query).not.toHaveBeenCalled();
  });

  it("keeps legacy aggregate updates bounded when skill-only aggregates are missing", async () => {
    const patch = vi.fn();
    const ctx = {
      db: {
        get: vi.fn(async () => ({
          _id: "publishers:alice",
          kind: "user",
          handle: "alice",
          displayName: "Alice",
          linkedUserId: "users:alice",
          publishedSkills: 1,
          publishedPackages: 1,
          totalInstalls: 7,
          totalDownloads: 17,
          totalStars: 3,
          createdAt: 1,
          updatedAt: 1,
        })),
        patch,
        query: vi.fn(),
      },
    };

    await adjustPublisherStatsForSkillChange(
      ctx as never,
      makeSkill({ statsDownloads: 10, statsInstallsAllTime: 4 }),
      makeSkill({ statsDownloads: 11, statsInstallsAllTime: 5 }),
    );

    expect(patch).toHaveBeenCalledWith("publishers:alice", {
      publishedSkills: 1,
      publishedPackages: 1,
      totalInstalls: 8,
      totalDownloads: 18,
      totalStars: 3,
    });
    expect(ctx.db.query).not.toHaveBeenCalled();
  });

  it("does not touch publisher rows for existing package version-only updates", async () => {
    const ctx = {
      db: {
        get: vi.fn(),
        patch: vi.fn(),
        query: vi.fn(),
      },
    };

    await adjustPublisherStatsForPackageChange(
      ctx as never,
      makePackage({ stats: { downloads: 10, installs: 4, stars: 2, versions: 1 } }),
      makePackage({ stats: { downloads: 10, installs: 4, stars: 2, versions: 2 } }),
    );

    expect(ctx.db.get).not.toHaveBeenCalled();
    expect(ctx.db.patch).not.toHaveBeenCalled();
    expect(ctx.db.query).not.toHaveBeenCalled();
  });

  it("keeps concurrent package version publishes off the shared publisher row", async () => {
    const ctx = {
      db: {
        get: vi.fn(),
        patch: vi.fn(),
        query: vi.fn(),
      },
    };

    await Promise.all(
      ["alpha", "bravo", "charlie", "delta"].map((name, index) =>
        adjustPublisherStatsForPackageChange(
          ctx as never,
          makePackage({
            _id: `packages:${name}`,
            stats: { downloads: 10 + index, installs: 4, stars: 2, versions: 1 },
          }),
          makePackage({
            _id: `packages:${name}`,
            stats: { downloads: 10 + index, installs: 4, stars: 2, versions: 2 },
          }),
        ),
      ),
    );

    expect(ctx.db.get).not.toHaveBeenCalled();
    expect(ctx.db.patch).not.toHaveBeenCalled();
    expect(ctx.db.query).not.toHaveBeenCalled();
  });

  it("does not count a staged package that has no published release", async () => {
    const ctx = {
      db: {
        get: vi.fn(),
        patch: vi.fn(),
        query: vi.fn(),
      },
    };

    await adjustPublisherStatsForPackageChange(
      ctx as never,
      null,
      makePackage({
        latestReleaseId: undefined,
        latestVersionSummary: undefined,
        stats: { downloads: 9, installs: 8, stars: 7, versions: 0 },
      }),
    );

    expect(ctx.db.get).not.toHaveBeenCalled();
    expect(ctx.db.patch).not.toHaveBeenCalled();
    expect(ctx.db.query).not.toHaveBeenCalled();
  });

  it("counts a package when its first release is published", async () => {
    const patch = vi.fn();
    const ctx = {
      db: {
        get: vi.fn(async () => ({
          _id: "publishers:alice",
          publishedSkills: 0,
          publishedPackages: 0,
          totalInstalls: 0,
          totalDownloads: 0,
          totalStars: 0,
          createdAt: 1,
          updatedAt: 1,
        })),
        patch,
        query: vi.fn(),
      },
    };

    await adjustPublisherStatsForPackageChange(
      ctx as never,
      makePackage({
        latestReleaseId: undefined,
        latestVersionSummary: undefined,
        stats: { downloads: 10, installs: 4, stars: 2, versions: 0 },
      }),
      makePackage({
        latestReleaseId: "packageReleases:one",
        stats: { downloads: 10, installs: 4, stars: 2, versions: 1 },
      }),
    );

    expect(patch).toHaveBeenCalledWith("publishers:alice", {
      publishedSkills: 0,
      publishedPackages: 1,
      totalInstalls: 4,
      totalDownloads: 10,
      totalStars: 2,
    });
    expect(ctx.db.query).not.toHaveBeenCalled();
  });

  it("counts a private package that already has a release", async () => {
    const patch = vi.fn();
    const ctx = {
      db: {
        get: vi.fn(async () => ({
          _id: "publishers:alice",
          publishedSkills: 0,
          publishedPackages: 0,
          totalInstalls: 0,
          totalDownloads: 0,
          totalStars: 0,
          createdAt: 1,
          updatedAt: 1,
        })),
        patch,
        query: vi.fn(),
      },
    };

    await adjustPublisherStatsForPackageChange(
      ctx as never,
      null,
      makePackage({
        channel: "private",
        latestReleaseId: "packageReleases:private",
        stats: { downloads: 3, installs: 2, stars: 1, versions: 1 },
      }),
    );

    expect(patch).toHaveBeenCalledWith("publishers:alice", {
      publishedSkills: 0,
      publishedPackages: 1,
      totalInstalls: 2,
      totalDownloads: 3,
      totalStars: 1,
    });
    expect(ctx.db.query).not.toHaveBeenCalled();
  });

  it("counts a package that already has a version summary when the version counter is zero", async () => {
    const patch = vi.fn();
    const ctx = {
      db: {
        get: vi.fn(async () => ({
          _id: "publishers:alice",
          publishedSkills: 0,
          publishedPackages: 0,
          totalInstalls: 0,
          totalDownloads: 0,
          totalStars: 0,
          createdAt: 1,
          updatedAt: 1,
        })),
        patch,
        query: vi.fn(),
      },
    };

    await adjustPublisherStatsForPackageChange(
      ctx as never,
      null,
      makePackage({
        latestReleaseId: undefined,
        latestVersionSummary: { version: "1.0.0" },
        stats: { downloads: 1, installs: 2, stars: 3, versions: 0 },
      }),
    );

    expect(patch).toHaveBeenCalledWith("publishers:alice", {
      publishedSkills: 0,
      publishedPackages: 1,
      totalInstalls: 2,
      totalDownloads: 1,
      totalStars: 3,
    });
    expect(ctx.db.query).not.toHaveBeenCalled();
  });

  it("counts a package that already has a release id when the version counter is zero", async () => {
    const patch = vi.fn();
    const ctx = {
      db: {
        get: vi.fn(async () => ({
          _id: "publishers:alice",
          publishedSkills: 0,
          publishedPackages: 0,
          totalInstalls: 0,
          totalDownloads: 0,
          totalStars: 0,
          createdAt: 1,
          updatedAt: 1,
        })),
        patch,
        query: vi.fn(),
      },
    };

    await adjustPublisherStatsForPackageChange(
      ctx as never,
      null,
      makePackage({
        latestReleaseId: "packageReleases:kept",
        latestVersionSummary: undefined,
        stats: { downloads: 5, installs: 6, stars: 7, versions: 0 },
      }),
    );

    expect(patch).toHaveBeenCalledWith("publishers:alice", {
      publishedSkills: 0,
      publishedPackages: 1,
      totalInstalls: 6,
      totalDownloads: 5,
      totalStars: 7,
    });
    expect(ctx.db.query).not.toHaveBeenCalled();
  });

  it("recomputes publisher package totals from published releases only", async () => {
    const patch = vi.fn();
    const ctx = {
      db: {
        get: vi.fn(async (id: string) =>
          id === "publishers:alice"
            ? {
                _id: id,
                kind: "user",
                handle: "alice",
                displayName: "Alice",
                linkedUserId: "users:alice",
                createdAt: 1,
                updatedAt: 1,
              }
            : null,
        ),
        patch,
        query: vi.fn((table: string) => ({
          withIndex: vi.fn((indexName: string) => {
            if (table === "skills" && indexName === "by_owner_publisher_active_updated") {
              return { collect: vi.fn(async () => []) };
            }
            if (table === "packages" && indexName === "by_owner_publisher_active_updated") {
              return {
                collect: vi.fn(async () => [
                  makePackage({
                    _id: "packages:staged",
                    latestReleaseId: undefined,
                    latestVersionSummary: undefined,
                    stats: { downloads: 100, installs: 100, stars: 100, versions: 0 },
                  }),
                  makePackage({
                    _id: "packages:live",
                    channel: "private",
                    latestReleaseId: "packageReleases:live",
                    stats: { downloads: 7, installs: 3, stars: 1, versions: 1 },
                  }),
                ]),
              };
            }
            throw new Error(`unexpected ${table} index ${indexName}`);
          }),
        })),
      },
    };

    await adjustPublisherStatsForPackageChange(
      ctx as never,
      null,
      makePackage({
        _id: "packages:live",
        channel: "private",
        latestReleaseId: "packageReleases:live",
        stats: { downloads: 7, installs: 3, stars: 1, versions: 1 },
      }),
    );

    expect(patch).toHaveBeenCalledWith("publishers:alice", {
      publishedSkills: 0,
      publishedPackages: 1,
      totalInstalls: 3,
      totalDownloads: 7,
      totalStars: 1,
      skillTotalInstalls: 0,
      skillTotalDownloads: 0,
      skillTotalStars: 0,
    });
  });
});
