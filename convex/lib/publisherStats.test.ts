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
});
