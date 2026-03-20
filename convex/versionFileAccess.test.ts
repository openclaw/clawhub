/* @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
  authTables: {},
}));

vi.mock("./lib/skillPublish", () => ({
  fetchText: vi.fn().mockResolvedValue("# skill"),
}));

vi.mock("./lib/soulPublish", () => ({
  fetchText: vi.fn().mockResolvedValue("# soul"),
  publishSoulVersionForUser: vi.fn(),
}));

const { getAuthUserId } = await import("@convex-dev/auth/server");
const { getReadme: getSkillReadme, getFileText: getSkillFileText } = await import("./skills");
const { getReadme: getSoulReadme, getFileText: getSoulFileText } = await import("./souls");
const getSkillReadmeHandler = getSkillReadme as unknown as { _handler: Function };
const getSkillFileTextHandler = getSkillFileText as unknown as { _handler: Function };
const getSoulReadmeHandler = getSoulReadme as unknown as { _handler: Function };
const getSoulFileTextHandler = getSoulFileText as unknown as { _handler: Function };

function makeSkillVersion() {
  return {
    _id: "skillVersions:1",
    _creationTime: 1,
    skillId: "skills:1",
    version: "1.0.0",
    changelog: "init",
    files: [
      {
        path: "SKILL.md",
        size: 10,
        storageId: "_storage:1",
        sha256: "abc",
        contentType: "text/markdown",
      },
    ],
  };
}

function makeActionCtx(args: {
  skill?: Record<string, unknown> | null;
  soul?: Record<string, unknown> | null;
  version?: Record<string, unknown> | null;
  actor?: Record<string, unknown> | null;
}) {
  return {
    runQuery: vi.fn(async (_endpoint: unknown, payload: Record<string, unknown>) => {
      if (payload.versionId && args.version) return args.version ?? null;
      if (payload.skillId && args.skill) return args.skill ?? null;
      if (payload.soulId && args.soul) return args.soul ?? null;
      if (payload.userId === args.actor?._id) {
        return args.actor ?? null;
      }
      throw new Error("Unexpected endpoint");
    }),
  } as never;
}

describe("version file access actions", () => {
  beforeEach(() => {
    vi.mocked(getAuthUserId).mockReset();
    vi.mocked(getAuthUserId).mockResolvedValue(null as never);
  });

  it("blocks unauthenticated access to hidden skill versions", async () => {
    const ctx = makeActionCtx({
      version: makeSkillVersion(),
      skill: {
        _id: "skills:1",
        ownerUserId: "users:owner",
        softDeletedAt: undefined,
        moderationStatus: "hidden",
        moderationReason: "pending.scan",
        moderationFlags: [],
      },
    });

    await expect(
      getSkillReadmeHandler._handler(ctx, { versionId: "skillVersions:1" } as never),
    ).rejects.toThrow("Version not available");
  });

  it("allows owners to read hidden skill versions", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);
    const ctx = makeActionCtx({
      version: makeSkillVersion(),
      skill: {
        _id: "skills:1",
        ownerUserId: "users:owner",
        softDeletedAt: undefined,
        moderationStatus: "hidden",
        moderationReason: "pending.scan",
        moderationFlags: [],
      },
    });

    await expect(
      getSkillReadmeHandler._handler(ctx, { versionId: "skillVersions:1" } as never),
    ).resolves.toEqual({ path: "SKILL.md", text: "# skill" });
  });

  it("allows owners to read hidden skill files", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);
    const ctx = makeActionCtx({
      version: makeSkillVersion(),
      skill: {
        _id: "skills:1",
        ownerUserId: "users:owner",
        softDeletedAt: undefined,
        moderationStatus: "hidden",
        moderationReason: "pending.scan",
        moderationFlags: [],
      },
    });

    await expect(
      getSkillFileTextHandler._handler(ctx, {
        versionId: "skillVersions:1",
        path: "SKILL.md",
      } as never),
    ).resolves.toMatchObject({ path: "SKILL.md", text: "# skill" });
  });

  it("blocks unauthenticated file reads from hidden skill versions", async () => {
    const ctx = makeActionCtx({
      version: makeSkillVersion(),
      skill: {
        _id: "skills:1",
        ownerUserId: "users:owner",
        softDeletedAt: undefined,
        moderationStatus: "hidden",
        moderationReason: "pending.scan",
        moderationFlags: [],
      },
    });

    await expect(
      getSkillFileTextHandler._handler(ctx, {
        versionId: "skillVersions:1",
        path: "SKILL.md",
      } as never),
    ).rejects.toThrow("Version not available");
  });

  it("keeps malware-blocked skill files readable to public callers", async () => {
    const ctx = makeActionCtx({
      version: makeSkillVersion(),
      skill: {
        _id: "skills:1",
        ownerUserId: "users:owner",
        softDeletedAt: undefined,
        moderationStatus: "hidden",
        moderationReason: "scanner.vt.malicious",
        moderationFlags: ["blocked.malware"],
      },
    });

    await expect(
      getSkillFileTextHandler._handler(ctx, {
        versionId: "skillVersions:1",
        path: "SKILL.md",
      } as never),
    ).resolves.toMatchObject({ path: "SKILL.md", text: "# skill" });
  });

  it("still allows public access to visible skill files", async () => {
    const ctx = makeActionCtx({
      version: makeSkillVersion(),
      skill: {
        _id: "skills:1",
        _creationTime: 1,
        slug: "demo",
        displayName: "Demo",
        summary: "Summary",
        ownerUserId: "users:owner",
        canonicalSkillId: undefined,
        forkOf: undefined,
        latestVersionId: "skillVersions:1",
        tags: {},
        badges: undefined,
        stats: {
          downloads: 1,
          installsCurrent: 1,
          installsAllTime: 1,
          stars: 1,
          versions: 1,
          comments: 0,
        },
        createdAt: 1,
        updatedAt: 2,
        softDeletedAt: undefined,
        moderationStatus: "active",
        moderationFlags: [],
        moderationReason: undefined,
      },
    });

    await expect(
      getSkillFileTextHandler._handler(ctx, {
        versionId: "skillVersions:1",
        path: "SKILL.md",
      } as never),
    ).resolves.toMatchObject({ path: "SKILL.md", text: "# skill" });
  });

  it("blocks unauthenticated access to deleted soul versions", async () => {
    const ctx = makeActionCtx({
      version: {
        _id: "soulVersions:1",
        _creationTime: 1,
        soulId: "souls:1",
        version: "1.0.0",
        changelog: "init",
        files: [
          {
            path: "SOUL.md",
            size: 10,
            storageId: "_storage:1",
            sha256: "abc",
            contentType: "text/markdown",
          },
        ],
      },
      soul: {
        _id: "souls:1",
        ownerUserId: "users:owner",
        softDeletedAt: 123,
      },
    });

    await expect(
      getSoulReadmeHandler._handler(ctx, { versionId: "soulVersions:1" } as never),
    ).rejects.toThrow("Version not available");
  });

  it("blocks file reads from deleted soul versions", async () => {
    const ctx = makeActionCtx({
      version: {
        _id: "soulVersions:1",
        _creationTime: 1,
        soulId: "souls:1",
        version: "1.0.0",
        changelog: "init",
        files: [
          {
            path: "SOUL.md",
            size: 10,
            storageId: "_storage:1",
            sha256: "abc",
            contentType: "text/markdown",
          },
        ],
      },
      soul: {
        _id: "souls:1",
        ownerUserId: "users:owner",
        softDeletedAt: 123,
      },
    });

    await expect(
      getSoulFileTextHandler._handler(ctx, {
        versionId: "soulVersions:1",
        path: "SOUL.md",
      } as never),
    ).rejects.toThrow("Version not available");
  });
});
