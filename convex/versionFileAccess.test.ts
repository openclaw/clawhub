/* @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
  authTables: {},
}));

vi.mock("./lib/skillPublish", () => ({
  fetchText: vi.fn().mockResolvedValue("# skill"),
}));

const { getAuthUserId } = await import("@convex-dev/auth/server");
const {
  getReadme: getSkillReadme,
  getFileText: getSkillFileText,
  getGitHubSkillContent,
} = await import("./skills");
const getSkillReadmeHandler = getSkillReadme as unknown as { _handler: Function };
const getSkillFileTextHandler = getSkillFileText as unknown as { _handler: Function };
const getGitHubSkillContentHandler = getGitHubSkillContent as unknown as { _handler: Function };

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
  version?: Record<string, unknown> | null;
  actor?: Record<string, unknown> | null;
  publisherMemberRole?: "owner" | "admin" | "publisher" | null;
  publisherAccess?: boolean;
}) {
  return {
    runQuery: vi.fn(async (_endpoint: unknown, payload: Record<string, unknown>) => {
      if (payload.versionId && args.version) return args.version ?? null;
      if (payload.skillId && args.skill) return args.skill ?? null;
      if (payload.publisherId && payload.userId === args.actor?._id) {
        if (Array.isArray(payload.allowedPublisherRoles)) {
          if (args.publisherAccess !== undefined) return args.publisherAccess;
          if (payload.legacyOwnerUserId) return payload.legacyOwnerUserId === args.actor?._id;
          return Boolean(args.publisherMemberRole);
        }
        return args.publisherMemberRole ?? null;
      }
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

  it("blocks unauthenticated access to pending-publication versions on public skills", async () => {
    const ctx = makeActionCtx({
      version: { ...makeSkillVersion(), publicationStatus: "pending" },
      skill: {
        _id: "skills:1",
        ownerUserId: "users:owner",
        softDeletedAt: undefined,
        moderationStatus: "active",
        moderationFlags: [],
        stats: {
          downloads: 0,
          stars: 0,
          installsAllTime: 0,
          versions: 1,
          comments: 0,
        },
      },
    });

    await expect(
      getSkillReadmeHandler._handler(ctx, { versionId: "skillVersions:1" } as never),
    ).rejects.toThrow("Version not available");
  });

  it("allows owners to read pending-publication versions", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);
    const ctx = makeActionCtx({
      actor: { _id: "users:owner", role: "user" },
      version: { ...makeSkillVersion(), publicationStatus: "pending" },
      skill: {
        _id: "skills:1",
        ownerUserId: "users:owner",
        softDeletedAt: undefined,
        moderationStatus: "active",
        moderationFlags: [],
        stats: {
          downloads: 0,
          stars: 0,
          installsAllTime: 0,
          versions: 1,
          comments: 0,
        },
      },
    });

    await expect(
      getSkillReadmeHandler._handler(ctx, { versionId: "skillVersions:1" } as never),
    ).resolves.toEqual({ path: "SKILL.md", text: "# skill" });
  });

  it("allows owners to read hidden skill versions", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);
    const ctx = makeActionCtx({
      actor: { _id: "users:owner", role: "user" },
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

  it("does not let stale ownerUserId read publisher-owned hidden skill versions", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);
    const ctx = makeActionCtx({
      actor: { _id: "users:owner", role: "user" },
      publisherMemberRole: null,
      publisherAccess: false,
      version: makeSkillVersion(),
      skill: {
        _id: "skills:1",
        ownerUserId: "users:owner",
        ownerPublisherId: "publishers:org",
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

  it("allows org collaborators to read hidden skill versions", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:member" as never);
    const ctx = makeActionCtx({
      actor: { _id: "users:member", role: "user" },
      publisherMemberRole: "publisher",
      publisherAccess: true,
      version: makeSkillVersion(),
      skill: {
        _id: "skills:1",
        ownerUserId: "users:owner",
        ownerPublisherId: "publishers:org",
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

  it("allows linked personal publisher users to read hidden skill versions", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);
    const ctx = makeActionCtx({
      actor: { _id: "users:owner", role: "user" },
      publisherMemberRole: null,
      publisherAccess: true,
      version: makeSkillVersion(),
      skill: {
        _id: "skills:1",
        ownerUserId: "users:legacy-owner",
        ownerPublisherId: "publishers:owner",
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

  it("allows legacy no-link personal publisher owners to read hidden skill versions", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);
    const ctx = makeActionCtx({
      actor: { _id: "users:owner", role: "user" },
      publisherMemberRole: null,
      version: makeSkillVersion(),
      skill: {
        _id: "skills:1",
        ownerUserId: "users:owner",
        ownerPublisherId: "publishers:owner",
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

  it("does not honor stale personal publisher memberships for hidden skill versions", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:friend" as never);
    const ctx = makeActionCtx({
      actor: { _id: "users:friend", role: "user" },
      publisherMemberRole: "owner",
      publisherAccess: false,
      version: makeSkillVersion(),
      skill: {
        _id: "skills:1",
        ownerUserId: "users:owner",
        ownerPublisherId: "publishers:owner",
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

  it("allows owners to read hidden skill files", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);
    const ctx = makeActionCtx({
      actor: { _id: "users:owner", role: "user" },
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

  it("blocks public reads from malware-blocked skill files", async () => {
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
    ).rejects.toThrow("Version not available");
  });

  it("returns null instead of throwing for public reads from malware-blocked GitHub skill content", async () => {
    const skill = {
      _id: "skills:github",
      _creationTime: 1,
      slug: "github-demo",
      displayName: "GitHub Demo",
      summary: "Summary",
      ownerUserId: "users:owner",
      canonicalSkillId: undefined,
      forkOf: undefined,
      latestVersionId: undefined,
      installKind: "github",
      githubCurrentStatus: "present",
      githubCurrentContentHash: "hash-a",
      tags: {},
      badges: undefined,
      stats: {
        downloads: 1,
        installsCurrent: 1,
        installsAllTime: 1,
        stars: 1,
        versions: 0,
        comments: 0,
      },
      createdAt: 1,
      updatedAt: 2,
      softDeletedAt: undefined,
      moderationStatus: "hidden",
      moderationFlags: ["blocked.malware"],
      moderationReason: "scanner.vt.malicious",
    };
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => (id === "skills:github" ? skill : null)),
        query: vi.fn(() => {
          throw new Error("Content should not be read when the skill is not publicly readable");
        }),
      },
    };

    await expect(
      getGitHubSkillContentHandler._handler(ctx, {
        skillId: "skills:github",
        kind: "readme",
      } as never),
    ).resolves.toBeNull();
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
});
