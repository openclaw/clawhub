/* @vitest-environment node */
import { zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./lib/githubIdentity", () => ({
  getGitHubProviderAccountId: vi.fn(),
}));

vi.mock("./lib/publishers", async () => {
  const actual = await vi.importActual<typeof import("./lib/publishers")>("./lib/publishers");
  return {
    ...actual,
    requirePublisherRole: vi.fn(),
  };
});

const { getGitHubProviderAccountId } = await import("./lib/githubIdentity");
const { requirePublisherRole } = await import("./lib/publishers");
const {
  getGitHubSkillSyncPublisherContextHandler,
  listGitHubSkillSyncRepositoriesHandler,
  previewGitHubSkillSyncRepositoryHandler,
} = await import("./githubSkillSyncSettings");

beforeEach(() => {
  vi.stubEnv("CONVEX_DEPLOYMENT", "local:clawhub");
  vi.stubEnv("CLAWHUB_GITHUB_SKILL_SYNC_ROLLOUT_MODE", "test");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("getGitHubSkillSyncPublisherContextHandler", () => {
  it("uses the linked personal publisher's immutable GitHub provider id", async () => {
    vi.mocked(requirePublisherRole).mockResolvedValue({
      publisher: {
        _id: "publishers:patrick",
        kind: "user",
        handle: "patrick",
        linkedUserId: "users:patrick",
      },
    } as never);
    vi.mocked(getGitHubProviderAccountId).mockResolvedValue("123");

    await expect(
      getGitHubSkillSyncPublisherContextHandler({ db: {} } as never, {
        publisherId: "publishers:patrick" as never,
        userId: "users:patrick" as never,
        now: 100,
      }),
    ).resolves.toEqual({
      publisherId: "publishers:patrick",
      publisherHandle: "patrick",
      publisherKind: "user",
      githubOwnerId: "123",
    });
  });

  it("requires fresh current admin membership for a verified organization", async () => {
    vi.mocked(requirePublisherRole).mockResolvedValue({
      publisher: {
        _id: "publishers:openclaw",
        kind: "org",
        handle: "openclaw",
        githubOrgId: "42",
        githubVerifiedAt: 50,
      },
    } as never);
    const unique = vi.fn(async () => ({
      githubOrgId: "42",
      login: "openclaw",
      role: "admin",
      syncedAt: 90,
    }));
    const db = {
      query: vi.fn(() => ({
        withIndex: vi.fn((_name, build) => {
          build({ eq: () => ({ eq: () => undefined }) });
          return { unique };
        }),
      })),
    };

    await expect(
      getGitHubSkillSyncPublisherContextHandler({ db } as never, {
        publisherId: "publishers:openclaw" as never,
        userId: "users:patrick" as never,
        now: 100,
      }),
    ).resolves.toEqual({
      publisherId: "publishers:openclaw",
      publisherHandle: "openclaw",
      publisherKind: "org",
      githubOwnerId: "42",
      githubLogin: "openclaw",
    });
  });
});

describe("listGitHubSkillSyncRepositoriesHandler", () => {
  it("lists only public repositories with the verified immutable owner id", async () => {
    const runQuery = vi.fn(async () => ({
      publisherId: "publishers:patrick",
      publisherHandle: "patrick",
      publisherKind: "user",
      githubOwnerId: "123",
    }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 123, login: "patrick-erichsen" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers(),
        json: async () => [
          {
            id: 1,
            full_name: "patrick-erichsen/skills",
            private: false,
            visibility: "public",
            owner: { id: 123, login: "patrick-erichsen" },
            default_branch: "main",
            archived: false,
            disabled: false,
            fork: false,
            pushed_at: "2026-07-23T12:00:00Z",
          },
          {
            id: 2,
            full_name: "someone-else/skills",
            private: false,
            visibility: "public",
            owner: { id: 999, login: "someone-else" },
            default_branch: "main",
          },
          {
            id: 3,
            full_name: "patrick-erichsen/archived-skills",
            private: false,
            visibility: "public",
            owner: { id: 123, login: "patrick-erichsen" },
            default_branch: "main",
            archived: true,
            disabled: false,
            fork: false,
            pushed_at: "2026-07-22T12:00:00Z",
          },
          {
            id: 4,
            full_name: "patrick-erichsen/forked-skills",
            private: false,
            visibility: "public",
            owner: { id: 123, login: "patrick-erichsen" },
            default_branch: "main",
            archived: false,
            disabled: false,
            fork: true,
            pushed_at: "2026-07-21T12:00:00Z",
          },
        ],
      });

    await expect(
      listGitHubSkillSyncRepositoriesHandler(
        { runQuery } as never,
        { publisherId: "publishers:patrick" as never },
        fetchMock as never,
        { userId: "users:patrick" as never },
      ),
    ).resolves.toMatchObject({
      publisher: { handle: "patrick" },
      repositories: [
        {
          repositoryId: "1",
          repo: "patrick-erichsen/skills",
          defaultBranch: "main",
          selectable: true,
        },
        {
          repositoryId: "3",
          repo: "patrick-erichsen/archived-skills",
          defaultBranch: "main",
          selectable: true,
        },
        {
          repositoryId: "4",
          repo: "patrick-erichsen/forked-skills",
          defaultBranch: "main",
          selectable: true,
        },
      ],
    });
  });
});

describe("previewGitHubSkillSyncRepositoryHandler", () => {
  it("discovers repository skills directly after canonical ownership verification", async () => {
    const zip = zipSync({
      "skills-main/skills/html/SKILL.md": new TextEncoder().encode(
        "---\nname: HTML\ndescription: Build HTML artifacts\n---\n",
      ),
      "skills-main/skills/off-leaderboard/SKILL.md": new TextEncoder().encode(
        "---\nname: Off Leaderboard\n---\n",
      ),
    });
    const classifiedItems = [
      {
        slug: "html",
        displayName: "HTML",
        path: "skills/html",
        contentHash: "hash-html",
        classification: "replacement",
        eligible: true,
        destination: {
          skillId: "skills:html",
          ownerPublisherId: "publishers:patrick",
          ownerHandle: "patrick",
          slug: "html",
          displayName: "HTML",
        },
      },
      {
        slug: "off-leaderboard",
        displayName: "Off Leaderboard",
        path: "skills/off-leaderboard",
        contentHash: "hash-off-leaderboard",
        classification: "new-destination",
        eligible: true,
        destination: null,
      },
    ];
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({
        publisherId: "publishers:patrick",
        publisherHandle: "patrick",
        publisherKind: "user",
        githubOwnerId: "123",
      })
      .mockResolvedValueOnce(classifiedItems);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 77,
          full_name: "patrick-erichsen/skills",
          private: false,
          visibility: "public",
          owner: { id: 123, login: "patrick-erichsen" },
          default_branch: "main",
          archived: true,
          disabled: false,
          fork: true,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sha: "a".repeat(40) }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-length": String(zip.byteLength) }),
        body: null,
        arrayBuffer: async () => zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength),
      });

    const result = await previewGitHubSkillSyncRepositoryHandler(
      { runQuery } as never,
      {
        publisherId: "publishers:patrick" as never,
        repo: "patrick-aerichsen/skills",
      },
      fetchMock as never,
      { userId: "users:patrick" as never },
    );

    expect(result).toMatchObject({
      publisher: { handle: "patrick" },
      repository: {
        requestedRepo: "patrick-aerichsen/skills",
        repositoryId: "77",
        repo: "patrick-erichsen/skills",
        redirected: true,
        commit: "a".repeat(40),
      },
      summary: {
        total: 2,
        newDestinations: 1,
        replacements: 1,
        unavailable: 0,
        conflicts: 0,
      },
      items: classifiedItems,
    });
    expect(runQuery).toHaveBeenCalledTimes(2);
  });

  it("fails closed before GitHub requests when the rollout capability is off", async () => {
    vi.stubEnv("CLAWHUB_GITHUB_SKILL_SYNC_ROLLOUT_MODE", "off");
    const fetchMock = vi.fn();
    const runQuery = vi.fn();

    await expect(
      previewGitHubSkillSyncRepositoryHandler(
        { runQuery } as never,
        {
          publisherId: "publishers:patrick" as never,
          repo: "patrick-erichsen/skills",
        },
        fetchMock as never,
        { userId: "users:patrick" as never },
      ),
    ).rejects.toThrow(/rollout is disabled/i);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(runQuery).not.toHaveBeenCalled();
  });
});
