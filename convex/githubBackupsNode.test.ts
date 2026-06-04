import { beforeEach, describe, expect, it, vi } from "vitest";

const deleteGitHubSkillBackup = vi.fn();
const listGitHubSkillBackupEntries = vi.fn();

vi.mock("./lib/githubBackup", async () => {
  const actual = await vi.importActual<typeof import("./lib/githubBackup")>("./lib/githubBackup");
  return {
    ...actual,
    backupSkillToGitHub: vi.fn(),
    deleteGitHubSkillBackup,
    fetchGitHubSkillMeta: vi.fn(),
    getGitHubBackupContext: vi.fn(async () => ({ owner: "openclaw", repo: "backup" })),
    isGitHubBackupConfigured: vi.fn(() => true),
    listGitHubSkillBackupEntries,
  };
});

const { syncGitHubBackupsInternalHandler } = await import("./githubBackupsNode");

describe("githubBackupsNode pruning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves backup entries by owner namespace before pruning", async () => {
    listGitHubSkillBackupEntries.mockResolvedValueOnce([
      {
        owner: "openclaw",
        slug: "shared",
        rootPath: "openclaw/shared",
        metaPath: "openclaw/shared/.clawhub-backup.json",
      },
    ]);

    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if (Object.keys(args).length === 0) {
        return { cursor: null, pruneCursor: null };
      }
      if ("batchSize" in args) {
        return { items: [], cursor: null, isDone: true };
      }
      if ("slug" in args) {
        expect(args).toEqual({ slug: "shared", ownerHandle: "openclaw" });
        return {
          _id: "skills:shared",
          slug: "shared",
          ownerUserId: "users:creator",
          ownerPublisherId: "publishers:openclaw",
          moderationStatus: "active",
          softDeletedAt: undefined,
        };
      }
      if ("publisherId" in args) {
        expect(args).toEqual({ publisherId: "publishers:openclaw" });
        return {
          _id: "publishers:openclaw",
          handle: "openclaw",
          deletedAt: undefined,
          deactivatedAt: undefined,
        };
      }
      throw new Error(`unexpected query args ${JSON.stringify(args)}`);
    });
    const runMutation = vi.fn(async () => ({}));

    const result = await syncGitHubBackupsInternalHandler({ runQuery, runMutation } as never, {
      pruneBatchSize: 10,
    });

    expect(result.stats.skillsDeleted).toBe(0);
    expect(deleteGitHubSkillBackup).not.toHaveBeenCalled();
  });
});
