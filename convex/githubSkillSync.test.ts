import { zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import {
  __test,
  applyGitHubSkillSourceSyncHandler,
  applyGitHubSkillVerificationResultHandler,
  configurePublicGitHubSkillSourceHandler,
  recordGitHubSkillSourceSyncAttemptHandler,
  resolveOwnerUserIdForPublisherHandler,
  syncGitHubSkillSourcesHandler,
  verifyGitHubSkillHandler,
} from "./githubSkillSync";
import { stripGitHubZipRoot } from "./lib/githubImport";
import { buildGitHubSkillSourceSnapshot } from "./lib/githubSkillSync";

type Row = Record<string, unknown> & { _id: string };

function chainEq(constraints: Record<string, unknown>) {
  return {
    eq(field: string, value: unknown) {
      constraints[field] = value;
      return chainEq(constraints);
    },
  };
}

function matches(doc: Row, constraints: Record<string, unknown>) {
  return Object.entries(constraints).every(([key, value]) => doc[key] === value);
}

function createDb(initial: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = Object.fromEntries(
    Object.entries(initial).map(([table, rows]) => [table, [...rows]]),
  );
  const counters: Record<string, number> = {};
  const list = (table: string) => {
    tables[table] ??= [];
    return tables[table];
  };

  const db = {
    get: async (id: string) => {
      const table = id.split(":")[0] ?? "";
      return list(table).find((row) => row._id === id) ?? null;
    },
    insert: async (table: string, doc: Record<string, unknown>) => {
      counters[table] = (counters[table] ?? 0) + 1;
      const inserted = {
        _id: `${table}:new-${counters[table]}`,
        _creationTime: counters[table],
        ...doc,
      };
      list(table).push(inserted);
      return inserted._id;
    },
    patch: async (id: string, patch: Record<string, unknown>) => {
      const table = id.split(":")[0] ?? "";
      const row = list(table).find((candidate) => candidate._id === id);
      if (row) {
        for (const [key, value] of Object.entries(patch)) {
          if (value === undefined) delete row[key];
          else row[key] = value;
        }
      }
    },
    query: (table: string) => ({
      withIndex: (_indexName: string, build: (q: ReturnType<typeof chainEq>) => unknown) => {
        const constraints: Record<string, unknown> = {};
        build(chainEq(constraints));
        const matched = () => list(table).filter((row) => matches(row, constraints));
        return {
          collect: async () => matched(),
          unique: async () => matched()[0] ?? null,
          take: async (limit: number) => matched().slice(0, limit),
          order: () => ({
            take: async (limit: number) => matched().slice(0, limit),
          }),
        };
      },
    }),
  };

  return { db, tables };
}

describe("unzipToEntries", () => {
  it("skips GitHub codeload directory entries before root stripping", () => {
    const zip = zipSync({
      "repo-main/": new Uint8Array(),
      "repo-main/skills/": new Uint8Array(),
      "repo-main/skills/aiq-deploy/SKILL.md": new TextEncoder().encode("# AIQ Deploy\n"),
    });

    expect(stripGitHubZipRoot(__test.unzipToEntries(zip))).toMatchObject({
      "skills/aiq-deploy/SKILL.md": expect.any(Uint8Array),
    });
  });

  it("keeps valid filenames containing dot-dot text", () => {
    const zip = zipSync({
      "repo-main/skills/aiq-deploy/SKILL.md": new TextEncoder().encode("# AIQ Deploy\n"),
      "repo-main/skills/aiq-deploy/payload..sh": new TextEncoder().encode("echo safe\n"),
    });

    expect(__test.unzipToEntries(zip)).toMatchObject({
      "repo-main/skills/aiq-deploy/SKILL.md": expect.any(Uint8Array),
      "repo-main/skills/aiq-deploy/payload..sh": expect.any(Uint8Array),
    });
  });

  it("rejects traversal paths so verified content hashes cannot omit them", () => {
    const zip = zipSync({
      "repo-main/skills/aiq-deploy/SKILL.md": new TextEncoder().encode("# AIQ Deploy\n"),
      "repo-main/skills/aiq-deploy/../payload.sh": new TextEncoder().encode("echo unsafe\n"),
    });

    expect(() => __test.unzipToEntries(zip)).toThrow(/invalid path/i);
  });

  it("rejects oversized files so verified content hashes cannot omit them", () => {
    const zip = zipSync({
      "repo-main/skills/aiq-deploy/SKILL.md": new TextEncoder().encode("# AIQ Deploy\n"),
      "repo-main/skills/aiq-deploy/model.bin": new Uint8Array(10 * 1024 * 1024 + 1),
    });

    expect(() => __test.unzipToEntries(zip)).toThrow(/file that is too large/i);
  });
});

describe("buildGitHubSourceImport", () => {
  it("keeps slash-containing branch names as refs, not URL path segments", () => {
    expect(__test.buildGitHubSourceImport("NVIDIA/skills", "release/2026.06")).toEqual({
      owner: "NVIDIA",
      repo: "skills",
      ref: "release/2026.06",
      originalUrl: "https://github.com/NVIDIA/skills",
    });
  });
});

describe("buildGitHubSkillSourceFetch", () => {
  it("attaches configured GitHub auth to API and archive requests only", async () => {
    const previousToken = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = "github-token";
    const fetcher = vi.fn(async () => new Response("ok"));
    const wrapped = __test.buildGitHubSkillSourceFetch(fetcher as unknown as typeof fetch);

    try {
      await wrapped("https://api.github.com/repos/NVIDIA/skills/commits/main", {
        headers: { Accept: "application/vnd.github+json" },
      });
      await wrapped("https://codeload.github.com/NVIDIA/skills/zip/abc123");
      await wrapped("https://example.com/archive.zip");
    } finally {
      if (previousToken === undefined) delete process.env.GITHUB_TOKEN;
      else process.env.GITHUB_TOKEN = previousToken;
    }

    const calls = fetcher.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit?]>;
    const firstHeaders = calls[0]?.[1]?.headers as Headers;
    const secondHeaders = calls[1]?.[1]?.headers as Headers;
    const thirdInit = calls[2]?.[1];
    expect(firstHeaders.get("Authorization")).toBe("Bearer github-token");
    expect(firstHeaders.get("Accept")).toBe("application/vnd.github+json");
    expect(secondHeaders.get("Authorization")).toBe("Bearer github-token");
    expect(secondHeaders.get("User-Agent")).toBe("clawhub/github-skill-source");
    expect(thirdInit).toBeUndefined();
  });
});

describe("configurePublicGitHubSkillSourceHandler", () => {
  it("configures any public GitHub repo for a publisher the user can manage", async () => {
    const zip = zipSync({
      "skills-main/skills/aiq-deploy/SKILL.md": new TextEncoder().encode("# AIQ Deploy\n"),
      "skills-main/skills/aiq-deploy/skill.oms.sig": new TextEncoder().encode("signature"),
    });
    const runQuery = vi.fn(async () => {
      return {
        ownerUserId: "users:publisher-owner",
        existingSource: null,
      };
    });
    const runMutation = vi.fn(async () => ({ ok: true, stats: { discovered: 1 } }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          full_name: "SomeoneElse/public-skills",
          private: false,
          visibility: "public",
          default_branch: "main",
          disabled: false,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sha: "1".repeat(40) }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-length": String(zip.byteLength) }),
        body: null,
        arrayBuffer: async () => zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength),
      });

    const result = await configurePublicGitHubSkillSourceHandler(
      {
        runQuery,
        runMutation,
        auth: { getUserIdentity: vi.fn() },
      } as never,
      {
        ownerPublisherId: "publishers:local" as never,
        repo: "someoneelse/public-skills",
      },
      fetchMock as never,
      {
        userId: "users:actor" as never,
      },
    );

    expect(result).toEqual({ ok: true, stats: { discovered: 1 } });
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        repo: "SomeoneElse/public-skills",
        ownerUserId: "users:publisher-owner",
        ownerPublisherId: "publishers:local",
        snapshot: expect.objectContaining({
          repo: "SomeoneElse/public-skills",
          defaultBranch: "main",
          manifestStatus: "missing",
          skills: expect.arrayContaining([
            expect.objectContaining({
              slug: "aiq-deploy",
              path: "skills/aiq-deploy",
            }),
          ]),
        }),
      }),
    );
  });

  it("rejects private GitHub repos before syncing", async () => {
    const runQuery = vi.fn(async () => ({
      ownerUserId: "users:publisher-owner",
      existingSource: null,
    }));
    const runMutation = vi.fn();
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        full_name: "SomeoneElse/private-skills",
        private: true,
        visibility: "private",
        default_branch: "main",
      }),
    });

    await expect(
      configurePublicGitHubSkillSourceHandler(
        { runQuery, runMutation, auth: { getUserIdentity: vi.fn() } } as never,
        {
          ownerPublisherId: "publishers:local" as never,
          repo: "someoneelse/private-skills",
        },
        fetchMock as never,
        {
          userId: "users:actor" as never,
        },
      ),
    ).rejects.toThrow(/public GitHub repo/i);

    expect(runMutation).not.toHaveBeenCalled();
  });
});

describe("syncGitHubSkillSourcesHandler", () => {
  it("rechecks repo visibility before scheduled syncs", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce([
        {
          _id: "githubSkillSources:nvidia",
          repo: "NVIDIA/skills",
          ownerPublisherId: "publishers:nvidia",
          defaultBranch: "main",
        },
      ])
      .mockResolvedValueOnce("users:nvidia");
    const runMutation = vi.fn(async () => ({ ok: true }));
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        full_name: "NVIDIA/skills",
        private: true,
        visibility: "private",
        default_branch: "main",
      }),
    });

    const result = await syncGitHubSkillSourcesHandler(
      { runQuery, runMutation } as never,
      { limit: 25 },
      fetchMock as never,
    );

    expect(result).toMatchObject({ ok: true, synced: 0, errors: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sourceId: "githubSkillSources:nvidia" }),
    );
    expect(runMutation).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ snapshot: expect.anything() }),
    );
  });
});

describe("resolveOwnerUserIdForPublisherHandler", () => {
  it("returns the owner user for org publishers", async () => {
    const { db } = createDb({
      publishers: [
        {
          _id: "publishers:nvidia",
          kind: "org",
          handle: "nvidia",
          displayName: "NVIDIA",
        },
      ],
      publisherMembers: [
        {
          _id: "publisherMembers:nvidia-owner",
          publisherId: "publishers:nvidia",
          userId: "users:nvidia-owner",
          role: "owner",
        },
      ],
    });

    await expect(
      resolveOwnerUserIdForPublisherHandler({ db } as never, {
        publisherId: "publishers:nvidia" as never,
      }),
    ).resolves.toBe("users:nvidia-owner");
  });

  it("returns the linked user for personal publishers", async () => {
    const { db } = createDb({
      publishers: [
        {
          _id: "publishers:patrick",
          kind: "user",
          handle: "patrick",
          displayName: "Patrick",
          linkedUserId: "users:patrick",
        },
      ],
    });

    await expect(
      resolveOwnerUserIdForPublisherHandler({ db } as never, {
        publisherId: "publishers:patrick" as never,
      }),
    ).resolves.toBe("users:patrick");
  });
});

describe("applyGitHubSkillSourceSyncHandler", () => {
  it("applies a trusted fetched snapshot without overwriting unrelated slug owners", async () => {
    const snapshot = await buildGitHubSkillSourceSnapshot({
      repo: "NVIDIA/skills",
      defaultBranch: "main",
      commit: "2".repeat(40),
      entries: {
        "skills/aiq-deploy/SKILL.md": new TextEncoder().encode("# AIQ Deploy v2\n"),
        "skills/aiq-deploy/skill-card.md": new TextEncoder().encode("# AIQ Card v2\n"),
        "skills/aiq-deploy/skill.oms.sig": new TextEncoder().encode("signature"),
        "skills/vision-helper/SKILL.md": new TextEncoder().encode("# Vision Helper\n"),
        "skills.sh.json": new TextEncoder().encode(
          JSON.stringify({ groupings: [{ title: "Agentic AI", skills: ["aiq-deploy"] }] }),
        ),
      },
    });
    const { db, tables } = createDb({
      githubSkillSources: [
        {
          _id: "githubSkillSources:nvidia",
          repo: "NVIDIA/skills",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      globalStats: [
        {
          _id: "globalStats:default",
          key: "default",
          activeSkillsCount: 10,
          updatedAt: 1,
        },
      ],
      skills: [
        {
          _id: "skills:aiq-deploy",
          slug: "aiq-deploy",
          displayName: "AIQ Deploy",
          ownerUserId: "users:nvidia",
          ownerPublisherId: "publishers:nvidia",
          installKind: "github",
          githubSourceId: "githubSkillSources:nvidia",
          githubPath: "skills/aiq-deploy",
          githubVerifiedCommit: "1".repeat(40),
          githubVerifiedContentHash: "old-hash",
          githubScanStatus: "clean",
          githubSignatureStatus: "verified",
          tags: {},
          stats: { downloads: 0, stars: 0, installsCurrent: 0, installsAllTime: 0, versions: 0 },
          createdAt: 1,
          updatedAt: 1,
        },
        {
          _id: "skills:vision-helper-conflict",
          slug: "vision-helper",
          displayName: "Existing Direct Skill",
          ownerUserId: "users:someone-else",
          ownerPublisherId: "publishers:someone-else",
          tags: {},
          stats: { downloads: 0, stars: 0, installsCurrent: 0, installsAllTime: 0, versions: 1 },
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });

    const result = await applyGitHubSkillSourceSyncHandler({ db } as never, {
      sourceId: "githubSkillSources:nvidia" as never,
      repo: "NVIDIA/skills",
      ownerUserId: "users:nvidia" as never,
      ownerPublisherId: "publishers:nvidia" as never,
      snapshot,
      now: 123,
    });

    expect(result.stats).toMatchObject({
      discovered: 2,
      changed: 1,
      inserted: 0,
      conflicts: 1,
    });
    expect(tables.githubSkillSources[0]).toMatchObject({
      ownerPublisherId: "publishers:nvidia",
      displayManifestStatus: "ok",
      displayManifestCommit: "2".repeat(40),
    });
    expect(tables.skills.find((skill) => skill._id === "skills:aiq-deploy")).toMatchObject({
      githubCurrentCommit: "2".repeat(40),
      githubVerifiedCommit: "1".repeat(40),
      githubVerifiedContentHash: "old-hash",
      githubScanStatus: "pending",
      githubSignatureStatus: "pending",
      moderationStatus: "hidden",
    });
    expect(tables.githubSkillContents).toEqual([
      expect.objectContaining({
        skillId: "skills:aiq-deploy",
        githubSourceId: "githubSkillSources:nvidia",
        githubPath: "skills/aiq-deploy",
        skillMarkdownPath: "skills/aiq-deploy/SKILL.md",
        skillMarkdown: "# AIQ Deploy v2\n",
        skillCardMarkdownPath: "skills/aiq-deploy/skill-card.md",
        skillCardMarkdown: "# AIQ Card v2\n",
        githubCommit: "2".repeat(40),
        githubContentHash: snapshot.skills.find((skill) => skill.slug === "aiq-deploy")
          ?.contentHash,
        fetchedAt: 123,
      }),
    ]);
    expect(tables.globalStats[0]).toMatchObject({
      activeSkillsCount: 9,
      updatedAt: 123,
    });
    const conflict = tables.skills.find((skill) => skill._id === "skills:vision-helper-conflict");
    expect(conflict).toMatchObject({
      displayName: "Existing Direct Skill",
    });
    expect(conflict).not.toHaveProperty("installKind");
    expect(tables.skills).toHaveLength(2);
  });

  it("stores GitHub content for newly inserted source-backed skills without creating versions", async () => {
    const snapshot = await buildGitHubSkillSourceSnapshot({
      repo: "NVIDIA/skills",
      defaultBranch: "main",
      commit: "2".repeat(40),
      entries: {
        "skills/aiq-deploy/SKILL.md": new TextEncoder().encode("# AIQ Deploy\n"),
        "skills/aiq-deploy/skill-card.md": new TextEncoder().encode("# AIQ Card\n"),
        "skills/aiq-deploy/skill.oms.sig": new TextEncoder().encode("signature"),
      },
    });
    const { db, tables } = createDb({
      githubSkillSources: [
        {
          _id: "githubSkillSources:nvidia",
          repo: "NVIDIA/skills",
          ownerPublisherId: "publishers:nvidia",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      globalStats: [
        {
          _id: "globalStats:default",
          key: "default",
          activeSkillsCount: 10,
          updatedAt: 1,
        },
      ],
    });

    const result = await applyGitHubSkillSourceSyncHandler({ db } as never, {
      sourceId: "githubSkillSources:nvidia" as never,
      repo: "NVIDIA/skills",
      ownerUserId: "users:nvidia" as never,
      ownerPublisherId: "publishers:nvidia" as never,
      snapshot,
      now: 123,
    });

    expect(result.stats).toMatchObject({ inserted: 1, conflicts: 0, invalid: 0 });
    expect(tables.skills).toHaveLength(1);
    expect(tables.skillVersions ?? []).toEqual([]);
    expect(tables.githubSkillContents).toEqual([
      expect.objectContaining({
        skillId: "skills:new-1",
        githubSourceId: "githubSkillSources:nvidia",
        githubPath: "skills/aiq-deploy",
        skillMarkdown: "# AIQ Deploy\n",
        skillCardMarkdown: "# AIQ Card\n",
        githubCommit: "2".repeat(40),
        githubContentHash: snapshot.skills[0]?.contentHash,
      }),
    ]);
  });

  it("rejects cross-publisher source ownership changes inside the sync mutation", async () => {
    const snapshot = await buildGitHubSkillSourceSnapshot({
      repo: "NVIDIA/skills",
      defaultBranch: "main",
      commit: "2".repeat(40),
      entries: {
        "skills/aiq-deploy/SKILL.md": new TextEncoder().encode("# AIQ Deploy\n"),
      },
    });
    const { db, tables } = createDb({
      githubSkillSources: [
        {
          _id: "githubSkillSources:nvidia",
          repo: "NVIDIA/skills",
          ownerPublisherId: "publishers:nvidia",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });

    await expect(
      applyGitHubSkillSourceSyncHandler({ db } as never, {
        sourceId: "githubSkillSources:nvidia" as never,
        repo: "NVIDIA/skills",
        ownerUserId: "users:other" as never,
        ownerPublisherId: "publishers:other" as never,
        snapshot,
        now: 123,
      }),
    ).rejects.toThrow(/already configured/i);

    expect(tables.githubSkillSources[0]).toMatchObject({
      ownerPublisherId: "publishers:nvidia",
      updatedAt: 1,
    });
    expect(tables.skills ?? []).toEqual([]);
  });

  it("queues verification for newly inserted pending source-backed skills", async () => {
    const snapshot = await buildGitHubSkillSourceSnapshot({
      repo: "NVIDIA/skills",
      defaultBranch: "main",
      commit: "2".repeat(40),
      entries: {
        "skills/aiq-deploy/SKILL.md": new TextEncoder().encode("# AIQ Deploy\n"),
        "skills/aiq-deploy/skill.oms.sig": new TextEncoder().encode("signature"),
      },
    });
    const { db } = createDb({
      githubSkillSources: [
        {
          _id: "githubSkillSources:nvidia",
          repo: "NVIDIA/skills",
          ownerPublisherId: "publishers:nvidia",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    const scheduler = { runAfter: vi.fn(async () => undefined) };

    await applyGitHubSkillSourceSyncHandler({ db, scheduler } as never, {
      sourceId: "githubSkillSources:nvidia" as never,
      repo: "NVIDIA/skills",
      ownerUserId: "users:nvidia" as never,
      ownerPublisherId: "publishers:nvidia" as never,
      snapshot,
      now: 123,
    });

    expect(scheduler.runAfter).toHaveBeenCalledWith(0, expect.anything(), {
      skillId: "skills:new-1",
      contentHash: snapshot.skills[0]?.contentHash,
    });
  });

  it("refreshes cached GitHub content metadata when bytes are unchanged at a new commit", async () => {
    const snapshot = await buildGitHubSkillSourceSnapshot({
      repo: "NVIDIA/skills",
      defaultBranch: "main",
      commit: "2".repeat(40),
      entries: {
        "skills/aiq-deploy/SKILL.md": new TextEncoder().encode("# AIQ Deploy\n"),
        "skills/aiq-deploy/skill.oms.sig": new TextEncoder().encode("signature"),
      },
    });
    const contentHash = snapshot.skills[0]?.contentHash;
    const { db, tables } = createDb({
      githubSkillSources: [
        {
          _id: "githubSkillSources:nvidia",
          repo: "NVIDIA/skills",
          ownerPublisherId: "publishers:nvidia",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      skills: [
        {
          _id: "skills:aiq-deploy",
          slug: "aiq-deploy",
          displayName: "AIQ Deploy",
          ownerUserId: "users:nvidia",
          ownerPublisherId: "publishers:nvidia",
          installKind: "github",
          githubSourceId: "githubSkillSources:nvidia",
          githubPath: "skills/aiq-deploy",
          githubVerifiedCommit: "1".repeat(40),
          githubVerifiedContentHash: contentHash,
          githubCurrentCommit: "1".repeat(40),
          githubCurrentContentHash: contentHash,
          githubCurrentStatus: "present",
          githubScanStatus: "clean",
          githubSignatureStatus: "verified",
          tags: {},
          stats: { downloads: 0, stars: 0, installsCurrent: 0, installsAllTime: 0, versions: 0 },
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      githubSkillContents: [
        {
          _id: "githubSkillContents:aiq-deploy",
          skillId: "skills:aiq-deploy",
          githubSourceId: "githubSkillSources:nvidia",
          githubPath: "skills/aiq-deploy",
          skillMarkdownPath: "skills/aiq-deploy/SKILL.md",
          skillMarkdown: "# AIQ Deploy\n",
          githubCommit: "1".repeat(40),
          githubContentHash: contentHash,
          fetchedAt: 7,
          createdAt: 7,
          updatedAt: 7,
        },
      ],
    });

    await applyGitHubSkillSourceSyncHandler({ db } as never, {
      sourceId: "githubSkillSources:nvidia" as never,
      repo: "NVIDIA/skills",
      ownerUserId: "users:nvidia" as never,
      ownerPublisherId: "publishers:nvidia" as never,
      snapshot,
      now: 123,
    });

    expect(tables.githubSkillContents[0]).toMatchObject({
      githubPath: "skills/aiq-deploy",
      skillMarkdown: "# AIQ Deploy\n",
      githubCommit: "2".repeat(40),
      githubContentHash: contentHash,
      fetchedAt: 123,
      updatedAt: 123,
    });
  });

  it("clears cached skill card content when the upstream skill card is removed", async () => {
    const snapshot = await buildGitHubSkillSourceSnapshot({
      repo: "NVIDIA/skills",
      defaultBranch: "main",
      commit: "2".repeat(40),
      entries: {
        "skills/aiq-deploy/SKILL.md": new TextEncoder().encode("# AIQ Deploy\n"),
        "skills/aiq-deploy/skill.oms.sig": new TextEncoder().encode("signature"),
      },
    });
    const { db, tables } = createDb({
      githubSkillSources: [
        {
          _id: "githubSkillSources:nvidia",
          repo: "NVIDIA/skills",
          ownerPublisherId: "publishers:nvidia",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      skills: [
        {
          _id: "skills:aiq-deploy",
          slug: "aiq-deploy",
          displayName: "AIQ Deploy",
          ownerUserId: "users:nvidia",
          ownerPublisherId: "publishers:nvidia",
          installKind: "github",
          githubSourceId: "githubSkillSources:nvidia",
          githubPath: "skills/aiq-deploy",
          githubHasSkillCard: true,
          githubVerifiedCommit: "1".repeat(40),
          githubVerifiedContentHash: "old-hash",
          githubScanStatus: "clean",
          githubSignatureStatus: "verified",
          tags: {},
          stats: { downloads: 0, stars: 0, installsCurrent: 0, installsAllTime: 0, versions: 0 },
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      githubSkillContents: [
        {
          _id: "githubSkillContents:aiq-deploy",
          skillId: "skills:aiq-deploy",
          githubSourceId: "githubSkillSources:nvidia",
          githubPath: "skills/aiq-deploy",
          skillMarkdownPath: "skills/aiq-deploy/SKILL.md",
          skillMarkdown: "# AIQ Deploy old\n",
          skillCardMarkdownPath: "skills/aiq-deploy/skill-card.md",
          skillCardMarkdown: "# Old card\n",
          githubCommit: "1".repeat(40),
          githubContentHash: "old-hash",
          fetchedAt: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });

    await applyGitHubSkillSourceSyncHandler({ db } as never, {
      sourceId: "githubSkillSources:nvidia" as never,
      repo: "NVIDIA/skills",
      ownerUserId: "users:nvidia" as never,
      ownerPublisherId: "publishers:nvidia" as never,
      snapshot,
      now: 123,
    });

    expect(tables.skills[0]).toMatchObject({ githubHasSkillCard: false });
    expect(tables.githubSkillContents[0]).toMatchObject({
      skillMarkdown: "# AIQ Deploy\n",
      githubCommit: "2".repeat(40),
      githubContentHash: snapshot.skills[0]?.contentHash,
    });
    expect(tables.githubSkillContents[0]).not.toHaveProperty("skillCardMarkdownPath");
    expect(tables.githubSkillContents[0]).not.toHaveProperty("skillCardMarkdown");
  });
});

describe("applyGitHubSkillVerificationResultHandler", () => {
  it("promotes only the exact current content hash that was verified", async () => {
    const { db, tables } = createDb({
      skills: [
        {
          _id: "skills:aiq-deploy",
          slug: "aiq-deploy",
          displayName: "AIQ Deploy",
          ownerUserId: "users:nvidia",
          ownerPublisherId: "publishers:nvidia",
          installKind: "github",
          githubSourceId: "githubSkillSources:nvidia",
          githubPath: "skills/aiq-deploy",
          githubVerifiedCommit: "1".repeat(40),
          githubVerifiedContentHash: "old-hash",
          githubCurrentCommit: "2".repeat(40),
          githubCurrentContentHash: "new-hash",
          githubCurrentStatus: "present",
          githubScanStatus: "pending",
          githubSignatureStatus: "pending",
          tags: {},
          stats: { downloads: 0, stars: 0, installsCurrent: 0, installsAllTime: 0, versions: 0 },
          moderationStatus: "hidden",
          moderationReason: "pending.scan",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      globalStats: [
        {
          _id: "globalStats:default",
          key: "default",
          activeSkillsCount: 10,
          updatedAt: 1,
        },
      ],
    });

    const stale = await applyGitHubSkillVerificationResultHandler({ db } as never, {
      skillId: "skills:aiq-deploy" as never,
      contentHash: "stale-hash",
      scanStatus: "clean",
      signatureStatus: "verified",
      now: 122,
    });

    expect(stale).toEqual({
      ok: true,
      skipped: "stale-current-hash",
      currentContentHash: "new-hash",
    });
    expect(tables.skills[0]).toMatchObject({
      githubVerifiedContentHash: "old-hash",
      githubScanStatus: "pending",
    });

    const promoted = await applyGitHubSkillVerificationResultHandler({ db } as never, {
      skillId: "skills:aiq-deploy" as never,
      contentHash: "new-hash",
      scanStatus: "clean",
      signatureStatus: "verified",
      now: 123,
    });

    expect(promoted).toEqual({ ok: true, promoted: true });
    expect(tables.skills[0]).toMatchObject({
      githubVerifiedCommit: "2".repeat(40),
      githubVerifiedContentHash: "new-hash",
      githubVerifiedAt: 123,
      githubScanStatus: "clean",
      githubSignatureStatus: "verified",
      moderationStatus: "active",
      moderationVerdict: "clean",
    });
    expect(tables.globalStats[0]).toMatchObject({
      activeSkillsCount: 11,
      updatedAt: 123,
    });
  });
});

describe("verifyGitHubSkillHandler", () => {
  it("does not treat detached signature file presence as verification", async () => {
    const commit = "3".repeat(40);
    const zip = zipSync({
      "skills-main/skills/aiq-deploy/SKILL.md": new TextEncoder().encode("# AIQ Deploy\n"),
      "skills-main/skills/aiq-deploy/skill.oms.sig": new TextEncoder().encode("signature"),
    });
    const snapshot = await buildGitHubSkillSourceSnapshot({
      repo: "NVIDIA/skills",
      defaultBranch: "main",
      commit,
      entries: stripGitHubZipRoot(__test.unzipToEntries(zip)),
    });
    const contentHash = snapshot.skills[0]?.contentHash;
    if (!contentHash) throw new Error("missing fixture hash");

    const runMutation = vi.fn(async () => ({ ok: true, promoted: false }));
    const ctx = {
      runQuery: vi.fn(async () => ({
        skill: {
          _id: "skills:aiq-deploy",
          slug: "aiq-deploy",
          displayName: "AIQ Deploy",
          summary: "Deploy workflows",
          githubPath: "skills/aiq-deploy",
          githubCurrentCommit: commit,
          githubCurrentContentHash: contentHash,
          githubCurrentStatus: "present",
        },
        source: {
          _id: "githubSkillSources:nvidia",
          repo: "NVIDIA/skills",
          defaultBranch: "main",
        },
      })),
      runMutation,
    };
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.startsWith("https://api.github.com/")) {
        return new Response(JSON.stringify({ sha: commit }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.startsWith("https://codeload.github.com/")) {
        return new Response(zip, { headers: { "content-length": String(zip.byteLength) } });
      }
      return new Response("not found", { status: 404 });
    });

    const result = await verifyGitHubSkillHandler(
      ctx as never,
      { skillId: "skills:aiq-deploy" as never, contentHash },
      fetcher as unknown as typeof fetch,
    );

    expect(result).toMatchObject({ ok: true, scanStatus: "clean", signatureStatus: "failed" });
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        skillId: "skills:aiq-deploy",
        contentHash,
        scanStatus: "clean",
        signatureStatus: "failed",
      }),
    );
  });
});

describe("recordGitHubSkillSourceSyncAttemptHandler", () => {
  it("advances the source sync cursor after skipped or failed cron attempts", async () => {
    const { db, tables } = createDb({
      githubSkillSources: [
        {
          _id: "githubSkillSources:nvidia",
          repo: "NVIDIA/skills",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });

    await expect(
      recordGitHubSkillSourceSyncAttemptHandler({ db } as never, {
        sourceId: "githubSkillSources:nvidia" as never,
        now: 99,
      }),
    ).resolves.toEqual({ ok: true });

    expect(tables.githubSkillSources[0]).toMatchObject({ updatedAt: 99 });
  });
});
