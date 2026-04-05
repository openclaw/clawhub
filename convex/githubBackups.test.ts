import { describe, expect, it, vi } from "vitest";
import { getGitHubBackupPageInternal } from "./githubBackups";

const handler = (getGitHubBackupPageInternal as unknown as { _handler: Function })._handler;

describe("githubBackups page filtering", () => {
  it("skips non-public skills (soft-deleted, hidden, removed)", async () => {
    const activeSkill = {
      _id: "skills:active",
      slug: "active-skill",
      displayName: "Active Skill",
      ownerUserId: "users:active",
      latestVersionId: "skillVersions:active",
      softDeletedAt: undefined,
      moderationStatus: "active",
    };

    const hiddenSkill = {
      _id: "skills:hidden",
      slug: "hidden-skill",
      displayName: "Hidden Skill",
      ownerUserId: "users:hidden",
      latestVersionId: "skillVersions:hidden",
      softDeletedAt: undefined,
      moderationStatus: "hidden",
    };

    const removedSkill = {
      _id: "skills:removed",
      slug: "removed-skill",
      displayName: "Removed Skill",
      ownerUserId: "users:removed",
      latestVersionId: "skillVersions:removed",
      softDeletedAt: undefined,
      moderationStatus: "removed",
    };

    const softDeletedSkill = {
      _id: "skills:soft",
      slug: "soft-skill",
      displayName: "Soft Skill",
      ownerUserId: "users:soft",
      latestVersionId: "skillVersions:soft",
      softDeletedAt: 1,
      moderationStatus: "active",
    };

    const get = vi.fn(async (id: string) => {
      if (id === "skillVersions:active") {
        return {
          _id: "skillVersions:active",
          version: "1.0.0",
          files: [{ path: "SKILL.md", size: 10, storageId: "storage:1", sha256: "abc" }],
          createdAt: 1_700_000_000_000,
        };
      }
      if (id === "users:active") {
        return {
          _id: "users:active",
          handle: "alice",
          deletedAt: undefined,
          deactivatedAt: undefined,
        };
      }
      return null;
    });

    const paginate = vi.fn().mockResolvedValue({
      page: [activeSkill, hiddenSkill, removedSkill, softDeletedSkill],
      isDone: true,
      continueCursor: null,
    });
    const order = vi.fn().mockReturnValue({ paginate });
    const query = vi.fn().mockReturnValue({ order });

    const result = await handler(
      {
        db: {
          query,
          get,
        },
      } as never,
      { batchSize: 50 },
    );

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
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("keeps legacy skills with undefined moderationStatus eligible", async () => {
    const legacySkill = {
      _id: "skills:legacy",
      slug: "legacy-skill",
      displayName: "Legacy Skill",
      ownerUserId: "users:legacy",
      latestVersionId: "skillVersions:legacy",
      softDeletedAt: undefined,
      moderationStatus: undefined,
    };

    const get = vi.fn(async (id: string) => {
      if (id === "skillVersions:legacy") {
        return {
          _id: "skillVersions:legacy",
          version: "2.0.0",
          files: [{ path: "SKILL.md", size: 20, storageId: "storage:2", sha256: "def" }],
          createdAt: 1_700_000_000_100,
        };
      }
      if (id === "users:legacy") {
        return {
          _id: "users:legacy",
          handle: null,
          deletedAt: undefined,
          deactivatedAt: undefined,
        };
      }
      return null;
    });

    const paginate = vi.fn().mockResolvedValue({
      page: [legacySkill],
      isDone: true,
      continueCursor: null,
    });
    const order = vi.fn().mockReturnValue({ paginate });
    const query = vi.fn().mockReturnValue({ order });

    const result = await handler(
      {
        db: {
          query,
          get,
        },
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
});
