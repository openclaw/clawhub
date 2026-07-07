import { getFunctionName } from "convex/server";
import { ConvexError } from "convex/values";
import { zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import {
  __test,
  applyGitHubSkillSourceSyncHandler,
  applyGitHubSkillVerificationResultHandler,
  configurePublicGitHubSkillSourceHandler,
  listSourcesForSyncHandler,
  recordGitHubSkillSourceSyncAttemptHandler,
  resolveOwnerUserIdForPublisherHandler,
  syncGitHubSkillSourcesHandler,
  upsertGitHubSkillContentHandler,
  verifyGitHubSkillHandler,
} from "./githubSkillSync";
import { stripGitHubZipRoot } from "./lib/githubImport";
import { buildGitHubSkillSourceSnapshot } from "./lib/githubSkillSync";
import { buildSkillInstallResolution } from "./lib/installResolver";
import { Events } from "./lib/observabilityEvents";

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
      withIndex: (_indexName: string, build?: (q: ReturnType<typeof chainEq>) => unknown) => {
        const constraints: Record<string, unknown> = {};
        build?.(chainEq(constraints));
        const matched = () => list(table).filter((row) => matches(row, constraints));
        const paginate = async ({
          cursor,
          numItems,
        }: {
          cursor: string | null;
          numItems: number;
        }) => {
          const rows = matched();
          const offset = cursor ? Number(cursor) : 0;
          const start = Number.isFinite(offset) && offset > 0 ? Math.trunc(offset) : 0;
          const page = rows.slice(start, start + numItems);
          const next = start + page.length;
          return {
            page,
            continueCursor: next < rows.length ? String(next) : null,
            isDone: next >= rows.length,
          };
        };
        return {
          collect: async () => matched(),
          unique: async () => matched()[0] ?? null,
          take: async (limit: number) => matched().slice(0, limit),
          order: () => ({
            collect: async () => matched(),
            take: async (limit: number) => matched().slice(0, limit),
            paginate,
          }),
          paginate,
        };
      },
    }),
  };

  return { db, tables };
}

function createFakeGitHubSkillsRepo() {
  let commit = "a".repeat(40);
  let entries: Record<string, string> = {};
  const repo = "openclaw/agent-skills";
  const defaultBranch = "main";

  function setSnapshot(next: { commit: string; entries: Record<string, string> }) {
    commit = next.commit;
    entries = next.entries;
  }

  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const parsed = new URL(url);

    if (
      parsed.hostname === "api.github.com" &&
      parsed.pathname === "/repos/openclaw/agent-skills"
    ) {
      return new Response(
        JSON.stringify({
          full_name: repo,
          private: false,
          visibility: "public",
          default_branch: defaultBranch,
          disabled: false,
        }),
        { headers: { "content-type": "application/json" } },
      );
    }

    if (
      parsed.hostname === "api.github.com" &&
      (parsed.pathname === "/repos/openclaw/agent-skills/commits/main" ||
        parsed.pathname === `/repos/openclaw/agent-skills/commits/${commit}`)
    ) {
      return new Response(JSON.stringify({ sha: commit }), {
        headers: { "content-type": "application/json" },
      });
    }

    if (
      parsed.hostname === "codeload.github.com" &&
      parsed.pathname === `/openclaw/agent-skills/zip/${commit}`
    ) {
      const prefixedEntries = Object.fromEntries(
        Object.entries(entries).map(([path, text]) => [
          `agent-skills-${commit}/${path}`,
          new TextEncoder().encode(text),
        ]),
      );
      const zip = zipSync(prefixedEntries);
      return new Response(zip, { headers: { "content-length": String(zip.byteLength) } });
    }

    return new Response("not found", { status: 404 });
  });

  return { repo, defaultBranch, fetcher, setSnapshot };
}

function githubRepoEntriesForSkill(markdown: string) {
  return {
    "skills.sh.json": JSON.stringify({
      notGrouped: "bottom",
      groupings: [
        {
          title: "Review",
          description: "Review workflow skills.",
          skills: ["demo-source"],
        },
      ],
    }),
    "skills/demo-source/SKILL.md": markdown,
    "skills/demo-source/skill-card.md": "# Demo Source Card\n",
  };
}

function getSkill(tables: Record<string, Row[]>, slug: string) {
  const skill = tables.skills?.find((row) => row.slug === slug);
  if (!skill) throw new Error(`missing skill fixture: ${slug}`);
  return skill;
}

function resolveInstallFromTables(tables: Record<string, Row[]>, slug: string) {
  const skill = getSkill(tables, slug);
  const source =
    typeof skill.githubSourceId === "string"
      ? (tables.githubSkillSources?.find((row) => row._id === skill.githubSourceId) ?? null)
      : null;
  return buildSkillInstallResolution({
    origin: "https://clawhub.ai",
    skill: skill as never,
    source: source as never,
  });
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
    const previousEnv = {
      token: process.env.GITHUB_TOKEN,
      appId: process.env.GITHUB_APP_ID,
      installationId: process.env.GITHUB_APP_INSTALLATION_ID,
      privateKey: process.env.GITHUB_APP_PRIVATE_KEY,
    };
    process.env.GITHUB_TOKEN = "github-token";
    delete process.env.GITHUB_APP_ID;
    delete process.env.GITHUB_APP_INSTALLATION_ID;
    delete process.env.GITHUB_APP_PRIVATE_KEY;
    const fetcher = vi.fn(async () => new Response("ok"));
    const wrapped = __test.buildGitHubSkillSourceFetch(fetcher as unknown as typeof fetch);

    try {
      await wrapped("https://api.github.com/repos/NVIDIA/skills/commits/main", {
        headers: { Accept: "application/vnd.github+json" },
      });
      await wrapped("https://codeload.github.com/NVIDIA/skills/zip/abc123");
      await wrapped("https://example.com/archive.zip");
    } finally {
      if (previousEnv.token === undefined) delete process.env.GITHUB_TOKEN;
      else process.env.GITHUB_TOKEN = previousEnv.token;
      if (previousEnv.appId === undefined) delete process.env.GITHUB_APP_ID;
      else process.env.GITHUB_APP_ID = previousEnv.appId;
      if (previousEnv.installationId === undefined) delete process.env.GITHUB_APP_INSTALLATION_ID;
      else process.env.GITHUB_APP_INSTALLATION_ID = previousEnv.installationId;
      if (previousEnv.privateKey === undefined) delete process.env.GITHUB_APP_PRIVATE_KEY;
      else process.env.GITHUB_APP_PRIVATE_KEY = previousEnv.privateKey;
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
  it("configures any public GitHub repo for an official publisher the user can manage", async () => {
    const zip = zipSync({
      "skills-main/skills/aiq-deploy/SKILL.md": new TextEncoder().encode("# AIQ Deploy\n"),
    });
    const runQuery = vi.fn(async () => {
      return {
        ownerUserId: "users:publisher-owner",
        existingSource: null,
        official: true,
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

  it("prefers nested catalog skill paths over duplicate plugin package copies", async () => {
    const zip = zipSync({
      "repo-main/plugins/aws-core/skills/amazon-bedrock/SKILL.md": new TextEncoder().encode(
        "# Amazon Bedrock Plugin Copy\n",
      ),
      "repo-main/skills/core-skills/amazon-bedrock/SKILL.md": new TextEncoder().encode(
        "# Amazon Bedrock\n",
      ),
    });
    const runQuery = vi.fn(async () => ({
      ownerUserId: "users:publisher-owner",
      existingSource: null,
      official: true,
    }));
    const runMutation = vi.fn(async () => ({ ok: true, stats: { discovered: 1 } }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          full_name: "aws/agent-toolkit-for-aws",
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

    await expect(
      configurePublicGitHubSkillSourceHandler(
        { runQuery, runMutation, auth: { getUserIdentity: vi.fn() } } as never,
        {
          ownerPublisherId: "publishers:local" as never,
          repo: "aws/agent-toolkit-for-aws",
        },
        fetchMock as never,
        {
          userId: "users:actor" as never,
        },
      ),
    ).resolves.toEqual({ ok: true, stats: { discovered: 1 } });

    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        snapshot: expect.objectContaining({
          skills: [
            expect.objectContaining({
              slug: "amazon-bedrock",
              path: "skills/core-skills/amazon-bedrock",
            }),
          ],
        }),
      }),
    );
  });

  it("rejects ambiguous catalog duplicate slugs with a client-visible error", async () => {
    const zip = zipSync({
      "repo-main/skills/core-skills/amazon-bedrock/SKILL.md": new TextEncoder().encode(
        "# Amazon Bedrock\n",
      ),
      "repo-main/skills/other-skills/amazon-bedrock/SKILL.md": new TextEncoder().encode(
        "# Amazon Bedrock Duplicate\n",
      ),
    });
    const runQuery = vi.fn(async () => ({
      ownerUserId: "users:publisher-owner",
      existingSource: null,
      official: true,
    }));
    const runMutation = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          full_name: "aws/agent-toolkit-for-aws",
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

    let caught: unknown;
    try {
      await configurePublicGitHubSkillSourceHandler(
        { runQuery, runMutation, auth: { getUserIdentity: vi.fn() } } as never,
        {
          ownerPublisherId: "publishers:local" as never,
          repo: "aws/agent-toolkit-for-aws",
        },
        fetchMock as never,
        {
          userId: "users:actor" as never,
        },
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ConvexError);
    expect((caught as { data?: unknown }).data).toMatch(
      /duplicate normalized slug "amazon-bedrock"/i,
    );
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("rejects non-official publishers before fetching skill contents", async () => {
    const runQuery = vi.fn(async () => ({
      ownerUserId: "users:publisher-owner",
      existingSource: null,
      official: false,
    }));
    const runMutation = vi.fn();
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        full_name: "SomeoneElse/public-skills",
        private: false,
        visibility: "public",
        default_branch: "main",
        disabled: false,
      }),
    });

    await expect(
      configurePublicGitHubSkillSourceHandler(
        { runQuery, runMutation, auth: { getUserIdentity: vi.fn() } } as never,
        {
          ownerPublisherId: "publishers:local" as never,
          repo: "someoneelse/public-skills",
        },
        fetchMock as never,
        {
          userId: "users:actor" as never,
        },
      ),
    ).rejects.toThrow(/official publishers/i);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(runMutation).not.toHaveBeenCalled();
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
  it("pages configured sources for scheduled sync", async () => {
    const { db } = createDb({
      githubSkillSources: Array.from({ length: 30 }, (_, index) => ({
        _id: `githubSkillSources:source-${index}`,
        repo: `owner/repo-${index}`,
        createdAt: index,
        updatedAt: index,
      })),
    });

    await expect(listSourcesForSyncHandler({ db } as never, { batchSize: 20 })).resolves.toEqual(
      expect.objectContaining({
        sources: expect.arrayContaining([
          expect.objectContaining({ _id: "githubSkillSources:source-0" }),
        ]),
        continueCursor: "20",
        isDone: false,
      }),
    );
  });

  it("emits structured sync lifecycle events", async () => {
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({ sources: [], continueCursor: null, isDone: true });
    const runMutation = vi.fn();

    try {
      const result = await syncGitHubSkillSourcesHandler(
        { runQuery, runMutation } as never,
        {},
        vi.fn() as never,
      );

      expect(result).toMatchObject({ ok: true, synced: 0, skipped: 0, errors: 0 });
      const events = consoleLog.mock.calls.map(([message]) => JSON.parse(String(message)));
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: Events.GitHubSkillSourceSyncStarted,
          }),
          expect.objectContaining({
            event: Events.GitHubSkillSourceSyncCompleted,
            sourcesTotal: 0,
            sourcesSucceeded: 0,
            sourcesFailed: 0,
            sourcesSkipped: 0,
            isDone: true,
          }),
        ]),
      );
    } finally {
      consoleLog.mockRestore();
    }
  });

  it("continues paginated scheduled syncs in the Node runtime", async () => {
    const scheduler = {
      runAfter: vi.fn(
        async (_delayMs: number, _functionRef: unknown, _args: Record<string, unknown>) =>
          undefined,
      ),
    };
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({ sources: [], continueCursor: "next-page", isDone: false });

    const result = await syncGitHubSkillSourcesHandler(
      { runQuery, runMutation: vi.fn(), scheduler } as never,
      {},
      vi.fn() as never,
    );

    expect(result).toMatchObject({ scheduledNext: true, cursor: "next-page", isDone: false });
    const scheduledFunction = scheduler.runAfter.mock.calls[0]?.[1];
    expect(getFunctionName(scheduledFunction as Parameters<typeof getFunctionName>[0])).toBe(
      "githubSkillSyncNode:syncGitHubSkillSourcesInternal",
    );
  });

  it("rechecks repo visibility before scheduled syncs", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({
        sources: [
          {
            _id: "githubSkillSources:nvidia",
            repo: "NVIDIA/skills",
            ownerPublisherId: "publishers:nvidia",
            defaultBranch: "main",
          },
        ],
        continueCursor: null,
        isDone: true,
      })
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
      {},
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

describe("GitHub-backed skill source lifecycle", () => {
  it("records invalid GitHub-backed skills from the last sync", async () => {
    const longSlug = "x".repeat(97);
    const { db, tables } = createDb();
    const snapshot = await buildGitHubSkillSourceSnapshot({
      repo: "NVIDIA/skills",
      defaultBranch: "main",
      commit: "b".repeat(40),
      entries: {
        "skills.sh.json": new TextEncoder().encode(
          JSON.stringify({
            groupings: [{ title: "Invalid", skills: [longSlug] }],
          }),
        ),
        [`skills/${longSlug}/SKILL.md`]: new TextEncoder().encode(`---
name: Invalid Length
description: Invalid because the folder name is too long.
---

# Invalid Length
`),
      },
    });

    const result = await applyGitHubSkillSourceSyncHandler(
      { db, scheduler: { runAfter: vi.fn() } } as never,
      {
        repo: "NVIDIA/skills",
        ownerUserId: "users:owner" as never,
        ownerPublisherId: "publishers:nvidia" as never,
        snapshot,
        now: 123,
      },
    );

    expect(result.stats).toMatchObject({ discovered: 1, inserted: 0, invalid: 1 });
    expect(result.invalidSkills).toEqual([
      {
        slug: longSlug,
        path: `skills/${longSlug}`,
        displayName: "Invalid Length",
        error: "Slug must be at most 96 characters.",
      },
    ]);
    expect(result.issues).toEqual([
      {
        slug: longSlug,
        path: `skills/${longSlug}`,
        displayName: "Invalid Length",
        kind: "invalid_slug",
        severity: "error",
        message: "Slug must be at most 96 characters.",
      },
    ]);
    expect(tables.githubSkillSources[0]).toMatchObject({
      repo: "NVIDIA/skills",
      lastSyncIssues: result.issues,
      lastSyncInvalidSkills: result.invalidSkills,
    });
    expect(tables.skills ?? []).toHaveLength(0);
  });

  it("moves official publisher installs from commit A to pending B to verified B without serving stale commits", async () => {
    const fakeGitHub = createFakeGitHubSkillsRepo();
    fakeGitHub.setSnapshot({
      commit: "a".repeat(40),
      entries: githubRepoEntriesForSkill(`---
name: Demo Source
description: Install from a GitHub-backed source.
---

# Demo Source A
`),
    });
    const { db, tables } = createDb({
      publishers: [
        {
          _id: "publishers:openclaw",
          kind: "org",
          handle: "openclaw",
          displayName: "OpenClaw",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      publisherMembers: [
        {
          _id: "publisherMembers:openclaw-owner",
          publisherId: "publishers:openclaw",
          userId: "users:owner",
          role: "admin",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      officialPublishers: [
        {
          _id: "officialPublishers:openclaw",
          publisherId: "publishers:openclaw",
          createdAt: 1,
        },
      ],
      globalStats: [
        {
          _id: "globalStats:default",
          key: "default",
          activeSkillsCount: 0,
          updatedAt: 1,
        },
      ],
    });
    const scheduler = { runAfter: vi.fn(async () => undefined) };
    let storedFile = 0;
    let now = 100;
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const actionCtx = {
      runQuery: vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
        if ("ownerPublisherId" in args && "actorUserId" in args) {
          return {
            ownerUserId: "users:owner",
            existingSource:
              tables.githubSkillSources?.find((source) => source.repo === fakeGitHub.repo) ?? null,
            official: true,
          };
        }
        if ("publisherId" in args) {
          return await resolveOwnerUserIdForPublisherHandler({ db } as never, {
            publisherId: args.publisherId as never,
          });
        }
        if ("skillId" in args) {
          const skill = tables.skills?.find((row) => row._id === args.skillId);
          const source =
            skill && typeof skill.githubSourceId === "string"
              ? tables.githubSkillSources?.find((row) => row._id === skill.githubSourceId)
              : null;
          return skill && source ? { skill, source } : null;
        }
        if ("sourceId" in args) {
          return (tables.skills ?? []).flatMap((skill) => {
            if (
              skill.githubSourceId !== args.sourceId ||
              skill.installKind !== "github" ||
              skill.githubCurrentStatus !== "present" ||
              typeof skill.githubPath !== "string" ||
              typeof skill.githubCurrentContentHash !== "string"
            ) {
              return [];
            }
            return [
              {
                skillId: skill._id,
                githubPath: skill.githubPath,
                githubCurrentContentHash: skill.githubCurrentContentHash,
              },
            ];
          });
        }
        if ("batchSize" in args || "cursor" in args || Object.keys(args).length === 0) {
          return await listSourcesForSyncHandler({ db } as never, args);
        }
        throw new Error(`unexpected lifecycle query args: ${JSON.stringify(args)}`);
      }),
      runMutation: vi.fn(async (mutation: unknown, args: Record<string, unknown>) => {
        const mutationName = getFunctionName(mutation as Parameters<typeof getFunctionName>[0]);
        if ("snapshot" in args) {
          return await applyGitHubSkillSourceSyncHandler(
            { db, scheduler } as never,
            {
              ...args,
              now,
            } as never,
          );
        }
        if (mutationName === "securityScan:prepareGitHubSkillScanRequestInternal") {
          return {
            ok: true,
            prepared: true,
            scanId: "githubSkillScans:1",
            requestId: "skillScanRequests:1",
          };
        }
        if (mutationName === "securityScan:appendGitHubSkillScanRequestFilesInternal") {
          return { ok: true, appended: true };
        }
        if (mutationName === "securityScan:finalizeGitHubSkillScanRequestInternal") {
          return {
            ok: true,
            queued: true,
            scanId: "githubSkillScans:1",
            requestId: "skillScanRequests:1",
            jobId: "securityScanJobs:1",
          };
        }
        if ("scanStatus" in args && "contentHash" in args) {
          return await applyGitHubSkillVerificationResultHandler(
            { db } as never,
            {
              ...args,
              now,
            } as never,
          );
        }
        if ("discovered" in args && "commit" in args) {
          return await upsertGitHubSkillContentHandler(
            { db } as never,
            {
              ...args,
              now,
            } as never,
          );
        }
        if ("sourceId" in args && "status" in args) {
          return await recordGitHubSkillSourceSyncAttemptHandler(
            { db } as never,
            {
              ...args,
              now,
            } as never,
          );
        }
        throw new Error(`unexpected lifecycle mutation args: ${JSON.stringify(args)}`);
      }),
      storage: {
        store: vi.fn(async () => {
          storedFile += 1;
          return `storage:${storedFile}`;
        }),
        delete: vi.fn(),
      },
      auth: { getUserIdentity: vi.fn() },
    };

    try {
      const configured = await configurePublicGitHubSkillSourceHandler(
        actionCtx as never,
        {
          ownerPublisherId: "publishers:openclaw" as never,
          repo: fakeGitHub.repo,
        },
        fakeGitHub.fetcher as never,
        { userId: "users:owner" as never },
      );

      expect(configured.stats).toMatchObject({ discovered: 1, inserted: 1 });
      expect(tables.githubSkillSources[0]).toMatchObject({
        repo: fakeGitHub.repo,
        ownerPublisherId: "publishers:openclaw",
        defaultBranch: "main",
        displayManifestStatus: "ok",
      });
      expect(tables.githubSkillSources[0]?.displayManifest).toMatchObject({
        groupings: [expect.objectContaining({ title: "Review", skills: ["demo-source"] })],
      });
      expect(tables.githubSkillContents[0]).toMatchObject({
        skillMarkdown: expect.stringContaining("# Demo Source A"),
        githubCommit: "a".repeat(40),
      });
      const metadataSyncCalls = actionCtx.runMutation.mock.calls.filter(
        ([, args]) => args && typeof args === "object" && "snapshot" in args,
      );
      expect(metadataSyncCalls).toHaveLength(1);
      expect(metadataSyncCalls[0]?.[1]).toMatchObject({
        snapshot: {
          skills: [
            expect.not.objectContaining({
              skillMarkdown: expect.any(String),
              skillCardMarkdown: expect.any(String),
            }),
          ],
        },
      });
      const contentSyncCalls = actionCtx.runMutation.mock.calls.filter(
        ([, args]) => args && typeof args === "object" && "discovered" in args,
      );
      expect(contentSyncCalls).toHaveLength(1);
      expect(contentSyncCalls[0]?.[1]).toMatchObject({
        discovered: { skillMarkdown: expect.stringContaining("# Demo Source A") },
      });

      let skill = getSkill(tables, "demo-source");
      expect(skill).toMatchObject({
        installKind: "github",
        githubPath: "skills/demo-source",
        githubCurrentCommit: "a".repeat(40),
        githubCurrentStatus: "present",
        githubScanStatus: "pending",
        moderationStatus: "active",
      });
      expect(resolveInstallFromTables(tables, "demo-source")).toMatchObject({
        ok: false,
        reason: "github_verification_pending",
        status: 423,
      });
      expect(scheduler.runAfter).toHaveBeenLastCalledWith(0, expect.anything(), {
        skillId: skill._id,
        contentHash: skill.githubCurrentContentHash,
      });

      now = 110;
      await expect(
        verifyGitHubSkillHandler(
          actionCtx as never,
          {
            skillId: skill._id as never,
            contentHash: skill.githubCurrentContentHash as string,
          },
          fakeGitHub.fetcher as never,
        ),
      ).resolves.toMatchObject({ ok: true, queued: true });
      expect(resolveInstallFromTables(tables, "demo-source")).toMatchObject({
        ok: false,
        reason: "github_verification_pending",
        status: 423,
      });
      await applyGitHubSkillVerificationResultHandler({ db } as never, {
        skillId: skill._id as never,
        contentHash: skill.githubCurrentContentHash as string,
        scanStatus: "clean",
        now,
      });
      expect(resolveInstallFromTables(tables, "demo-source")).toMatchObject({
        ok: true,
        installKind: "github",
        github: {
          repo: fakeGitHub.repo,
          path: "skills/demo-source",
          commit: "a".repeat(40),
          contentHash: skill.githubCurrentContentHash,
        },
      });
      const commitAContentHash = skill.githubCurrentContentHash;

      fakeGitHub.setSnapshot({
        commit: "b".repeat(40),
        entries: githubRepoEntriesForSkill(`---
name: Demo Source
description: Install from a GitHub-backed source.
---

# Demo Source B
`),
      });
      now = 200;
      const synced = await syncGitHubSkillSourcesHandler(
        actionCtx as never,
        {},
        fakeGitHub.fetcher as never,
      );

      expect(synced).toMatchObject({
        ok: true,
        synced: 1,
        errors: 0,
        results: [expect.objectContaining({ commit: "b".repeat(40) })],
      });
      skill = getSkill(tables, "demo-source");
      expect(skill).toMatchObject({
        githubCurrentCommit: "b".repeat(40),
        githubCurrentStatus: "present",
        githubScanStatus: "pending",
        moderationStatus: "active",
      });
      expect(skill.githubCurrentContentHash).not.toBe(commitAContentHash);
      expect(tables.githubSkillContents[0]).toMatchObject({
        skillMarkdown: expect.stringContaining("# Demo Source B"),
        githubCommit: "b".repeat(40),
      });
      expect(resolveInstallFromTables(tables, "demo-source")).toMatchObject({
        ok: false,
        reason: "github_verification_pending",
        status: 423,
      });

      now = 210;
      await expect(
        verifyGitHubSkillHandler(
          actionCtx as never,
          {
            skillId: skill._id as never,
            contentHash: skill.githubCurrentContentHash as string,
          },
          fakeGitHub.fetcher as never,
        ),
      ).resolves.toMatchObject({ ok: true, queued: true });
      expect(resolveInstallFromTables(tables, "demo-source")).toMatchObject({
        ok: false,
        reason: "github_verification_pending",
        status: 423,
      });
      await applyGitHubSkillVerificationResultHandler({ db } as never, {
        skillId: skill._id as never,
        contentHash: skill.githubCurrentContentHash as string,
        scanStatus: "clean",
        now,
      });
      expect(resolveInstallFromTables(tables, "demo-source")).toMatchObject({
        ok: true,
        installKind: "github",
        github: {
          repo: fakeGitHub.repo,
          path: "skills/demo-source",
          commit: "b".repeat(40),
          contentHash: skill.githubCurrentContentHash,
        },
      });

      fakeGitHub.setSnapshot({
        commit: "c".repeat(40),
        entries: {
          "skills.sh.json": JSON.stringify({
            groupings: [{ title: "Review", skills: ["demo-source"] }],
          }),
          "README.md": "# No skills here\n",
        },
      });
      now = 300;
      await syncGitHubSkillSourcesHandler(actionCtx as never, {}, fakeGitHub.fetcher as never);

      skill = getSkill(tables, "demo-source");
      expect(skill).toMatchObject({
        githubCurrentCommit: "c".repeat(40),
        githubCurrentStatus: "missing",
        githubRemovedAt: 300,
        softDeletedAt: 300,
        moderationStatus: "hidden",
        moderationReason: "github.upstream.removed",
      });
      expect(resolveInstallFromTables(tables, "demo-source")).toMatchObject({
        ok: false,
        reason: "github_upstream_removed",
        status: 410,
      });
    } finally {
      consoleLog.mockRestore();
    }
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
  it("queues a full scan and blocks legacy clean GitHub skills without a durable result", async () => {
    const snapshot = await buildGitHubSkillSourceSnapshot({
      repo: "NVIDIA/skills",
      defaultBranch: "main",
      commit: "2".repeat(40),
      entries: {
        "skills/aiq-deploy/SKILL.md": new TextEncoder().encode("# AIQ Deploy\n"),
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
          githubCurrentCommit: "1".repeat(40),
          githubCurrentContentHash: contentHash,
          githubCurrentStatus: "present",
          githubScanStatus: "clean",
          moderationStatus: "active",
          moderationVerdict: "clean",
          tags: {},
          stats: { downloads: 0, stars: 0, installsCurrent: 0, installsAllTime: 0, versions: 0 },
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

    expect(tables.skills[0]).toMatchObject({
      githubScanStatus: "pending",
      moderationStatus: "active",
      moderationReason: "pending.scan",
    });
    expect(tables.skills[0]).not.toHaveProperty("moderationVerdict");
    expect(scheduler.runAfter).toHaveBeenCalledWith(0, expect.anything(), {
      skillId: "skills:aiq-deploy",
      contentHash,
    });
  });

  it("applies a trusted fetched snapshot without blocking unrelated slug owners", async () => {
    const snapshot = await buildGitHubSkillSourceSnapshot({
      repo: "NVIDIA/skills",
      defaultBranch: "main",
      commit: "2".repeat(40),
      entries: {
        "skills/aiq-deploy/SKILL.md": new TextEncoder().encode("# AIQ Deploy v2\n"),
        "skills/aiq-deploy/skill-card.md": new TextEncoder().encode("# AIQ Card v2\n"),
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
      publishers: [
        {
          _id: "publishers:someone-else",
          kind: "user",
          handle: "jonathanjing",
          displayName: "Jonathan Jing",
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
          githubCurrentStatus: "present",
          githubCurrentContentHash: "old-hash",
          githubScanStatus: "clean",
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
      inserted: 1,
      conflicts: 0,
    });
    expect(tables.githubSkillSources[0]).toMatchObject({
      ownerPublisherId: "publishers:nvidia",
      displayManifestStatus: "ok",
      displayManifestCommit: "2".repeat(40),
      lastSyncIssues: [],
    });
    expect(tables.skills.find((skill) => skill._id === "skills:aiq-deploy")).toMatchObject({
      githubCurrentCommit: "2".repeat(40),
      githubScanStatus: "pending",
      moderationStatus: "active",
    });
    expect(tables.githubSkillContents).toEqual(
      expect.arrayContaining([
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
        expect.objectContaining({
          skillId: "skills:new-1",
          githubSourceId: "githubSkillSources:nvidia",
          githubPath: "skills/vision-helper",
          skillMarkdownPath: "skills/vision-helper/SKILL.md",
          skillMarkdown: "# Vision Helper\n",
          githubCommit: "2".repeat(40),
          githubContentHash: snapshot.skills.find((skill) => skill.slug === "vision-helper")
            ?.contentHash,
          fetchedAt: 123,
        }),
      ]),
    );
    expect(tables.globalStats[0]).toMatchObject({
      activeSkillsCount: 11,
      updatedAt: 123,
    });
    const conflict = tables.skills.find((skill) => skill._id === "skills:vision-helper-conflict");
    expect(conflict).toMatchObject({
      displayName: "Existing Direct Skill",
    });
    expect(conflict).not.toHaveProperty("installKind");
    expect(tables.skills).toHaveLength(3);
    expect(tables.skills.find((skill) => skill._id === "skills:new-1")).toMatchObject({
      slug: "vision-helper",
      displayName: "Vision Helper",
      ownerUserId: "users:nvidia",
      ownerPublisherId: "publishers:nvidia",
      installKind: "github",
      githubSourceId: "githubSkillSources:nvidia",
      githubPath: "skills/vision-helper",
      githubCurrentCommit: "2".repeat(40),
      githubCurrentStatus: "present",
      githubScanStatus: "pending",
      moderationStatus: "active",
    });
  });

  it("preserves an existing soft delete timestamp when upstream remains missing", async () => {
    const snapshot = await buildGitHubSkillSourceSnapshot({
      repo: "NVIDIA/skills",
      defaultBranch: "main",
      commit: "2".repeat(40),
      entries: {},
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
          githubCurrentStatus: "missing",
          githubRemovedAt: 60,
          softDeletedAt: 40,
          githubScanStatus: "clean",
          tags: {},
          stats: { downloads: 0, stars: 0, installsCurrent: 0, installsAllTime: 0, versions: 0 },
          createdAt: 1,
          updatedAt: 60,
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

    expect(tables.skills[0]).toMatchObject({
      githubCurrentStatus: "missing",
      githubRemovedAt: 60,
      softDeletedAt: 40,
    });
  });

  it("stores GitHub content for newly inserted source-backed skills without creating versions", async () => {
    const snapshot = await buildGitHubSkillSourceSnapshot({
      repo: "NVIDIA/skills",
      defaultBranch: "main",
      commit: "2".repeat(40),
      entries: {
        "skills/aiq-deploy/SKILL.md": new TextEncoder().encode("# AIQ Deploy\n"),
        "skills/aiq-deploy/skill-card.md": new TextEncoder().encode("# AIQ Card\n"),
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

  it("revives soft-deleted GitHub skills from the same publisher when a repo is re-added", async () => {
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
          _id: "githubSkillSources:new-nvidia",
          repo: "NVIDIA/skills",
          ownerPublisherId: "publishers:nvidia",
          createdAt: 50,
          updatedAt: 50,
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
          displayName: "AIQ Deploy old",
          ownerUserId: "users:nvidia",
          ownerPublisherId: "publishers:nvidia",
          installKind: "github",
          githubSourceId: "githubSkillSources:deleted-nvidia",
          githubPath: "skills/aiq-deploy",
          githubCurrentStatus: "missing",
          githubCurrentContentHash: "old-hash",
          githubScanStatus: "clean",
          githubRemovedAt: 60,
          softDeletedAt: 60,
          moderationStatus: "hidden",
          moderationReason: "github.upstream.removed",
          tags: {},
          statsDownloads: 7,
          statsStars: 3,
          statsInstallsCurrent: 2,
          statsInstallsAllTime: 5,
          stats: { downloads: 7, stars: 3, installsCurrent: 2, installsAllTime: 5, versions: 0 },
          createdAt: 1,
          updatedAt: 60,
        },
      ],
    });
    const scheduler = { runAfter: vi.fn(async () => undefined) };

    const result = await applyGitHubSkillSourceSyncHandler({ db, scheduler } as never, {
      sourceId: "githubSkillSources:new-nvidia" as never,
      repo: "NVIDIA/skills",
      ownerUserId: "users:nvidia" as never,
      ownerPublisherId: "publishers:nvidia" as never,
      snapshot,
      now: 123,
    });

    expect(result.stats).toMatchObject({
      discovered: 1,
      inserted: 0,
      revived: 1,
      conflicts: 0,
    });
    expect(tables.skills).toHaveLength(1);
    expect(tables.skills[0]).toMatchObject({
      _id: "skills:aiq-deploy",
      displayName: "AIQ Deploy",
      githubSourceId: "githubSkillSources:new-nvidia",
      githubCurrentCommit: "2".repeat(40),
      githubCurrentStatus: "present",
      githubCurrentContentHash: snapshot.skills[0]?.contentHash,
      githubScanStatus: "pending",
      moderationStatus: "active",
      moderationReason: "pending.scan",
      statsDownloads: 7,
      statsStars: 3,
    });
    expect(tables.skills[0]).not.toHaveProperty("githubRemovedAt");
    expect(tables.skills[0]).not.toHaveProperty("softDeletedAt");
    expect(tables.githubSkillContents).toEqual([
      expect.objectContaining({
        skillId: "skills:aiq-deploy",
        githubSourceId: "githubSkillSources:new-nvidia",
        githubPath: "skills/aiq-deploy",
        skillMarkdown: "# AIQ Deploy\n",
        githubCommit: "2".repeat(40),
        githubContentHash: snapshot.skills[0]?.contentHash,
      }),
    ]);
    expect(scheduler.runAfter).toHaveBeenCalledWith(0, expect.anything(), {
      skillId: "skills:aiq-deploy",
      contentHash: snapshot.skills[0]?.contentHash,
    });
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

  it("queues scanning for newly inserted pending source-backed skills", async () => {
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
    const scheduler = {
      runAfter: vi.fn(
        async (_delayMs: number, _functionRef: unknown, _args: Record<string, unknown>) =>
          undefined,
      ),
    };

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
    expect(Object.values(tables.githubSkillScans?.[0] ?? {})).not.toContain(undefined);
    const scheduledFunction = scheduler.runAfter.mock.calls[0]?.[1];
    expect(getFunctionName(scheduledFunction as Parameters<typeof getFunctionName>[0])).toBe(
      "githubSkillSyncNode:verifyGitHubSkillInternal",
    );
  });

  it("does not requeue heavy verification while the current content scan job is active", async () => {
    const snapshot = await buildGitHubSkillSourceSnapshot({
      repo: "NVIDIA/skills",
      defaultBranch: "main",
      commit: "2".repeat(40),
      entries: {
        "skills/aiq-deploy/SKILL.md": new TextEncoder().encode("# AIQ Deploy\n"),
      },
    });
    const contentHash = snapshot.skills[0]?.contentHash;
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
          githubCurrentCommit: "1".repeat(40),
          githubCurrentContentHash: contentHash,
          githubCurrentStatus: "present",
          githubScanStatus: "pending",
          tags: {},
          stats: { downloads: 0, stars: 0, installsCurrent: 0, installsAllTime: 0, versions: 0 },
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      githubSkillScans: [
        {
          _id: "githubSkillScans:aiq-deploy",
          skillId: "skills:aiq-deploy",
          githubSourceId: "githubSkillSources:nvidia",
          contentHash,
          status: "pending",
          skillScanRequestId: "skillScanRequests:aiq-deploy",
        },
      ],
      skillScanRequests: [
        {
          _id: "skillScanRequests:aiq-deploy",
          securityScanJobId: "securityScanJobs:aiq-deploy",
        },
      ],
      securityScanJobs: [
        {
          _id: "securityScanJobs:aiq-deploy",
          status: "queued",
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

    expect(scheduler.runAfter).toHaveBeenCalledTimes(0);
  });

  it("does not requeue heavy verification while a recent verification action is pending", async () => {
    const snapshot = await buildGitHubSkillSourceSnapshot({
      repo: "NVIDIA/skills",
      defaultBranch: "main",
      commit: "2".repeat(40),
      entries: {
        "skills/aiq-deploy/SKILL.md": new TextEncoder().encode("# AIQ Deploy\n"),
      },
    });
    const contentHash = snapshot.skills[0]?.contentHash;
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
          githubCurrentCommit: "1".repeat(40),
          githubCurrentContentHash: contentHash,
          githubCurrentStatus: "present",
          githubScanStatus: "pending",
          tags: {},
          stats: { downloads: 0, stars: 0, installsCurrent: 0, installsAllTime: 0, versions: 0 },
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      githubSkillScans: [
        {
          _id: "githubSkillScans:aiq-deploy",
          skillId: "skills:aiq-deploy",
          githubSourceId: "githubSkillSources:nvidia",
          contentHash,
          commit: "1".repeat(40),
          path: "skills/aiq-deploy",
          status: "pending",
          skillScanRequestId: "skillScanRequests:aiq-deploy",
          createdAt: 1,
          updatedAt: 123,
        },
      ],
      skillScanRequests: [
        {
          _id: "skillScanRequests:aiq-deploy",
          sourceKind: "github",
          createdAt: 123,
          updatedAt: 123,
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

    expect(scheduler.runAfter).toHaveBeenCalledTimes(0);
  });

  it("refreshes cached GitHub content metadata when bytes are unchanged at a new commit", async () => {
    const snapshot = await buildGitHubSkillSourceSnapshot({
      repo: "NVIDIA/skills",
      defaultBranch: "main",
      commit: "2".repeat(40),
      entries: {
        "skills/aiq-deploy/SKILL.md": new TextEncoder().encode("# AIQ Deploy\n"),
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
          githubCurrentCommit: "1".repeat(40),
          githubCurrentContentHash: contentHash,
          githubCurrentStatus: "present",
          githubScanStatus: "clean",
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
          githubCurrentStatus: "present",
          githubCurrentContentHash: "old-hash",
          githubScanStatus: "clean",
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
  it("applies scan results only to the exact current content hash", async () => {
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
          githubCurrentCommit: "2".repeat(40),
          githubCurrentContentHash: "new-hash",
          githubCurrentStatus: "present",
          githubScanStatus: "pending",
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
      now: 122,
    });

    expect(stale).toEqual({
      ok: true,
      skipped: "stale-current-hash",
      currentContentHash: "new-hash",
    });
    expect(tables.skills[0]).toMatchObject({
      githubScanStatus: "pending",
    });

    const promoted = await applyGitHubSkillVerificationResultHandler({ db } as never, {
      skillId: "skills:aiq-deploy" as never,
      contentHash: "new-hash",
      scanStatus: "clean",
      now: 123,
    });

    expect(promoted).toEqual({ ok: true, promoted: true });
    expect(tables.skills[0]).toMatchObject({
      githubScanStatus: "clean",
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
  it("scans the exact current GitHub content hash", async () => {
    const commit = "3".repeat(40);
    const zip = zipSync({
      "skills-main/skills/aiq-deploy/SKILL.md": new TextEncoder().encode("# AIQ Deploy\n"),
      "skills-main/skills/aiq-deploy/scripts/deploy.sh": new TextEncoder().encode(
        "#!/bin/sh\necho deploy\n",
      ),
    });
    const snapshot = await buildGitHubSkillSourceSnapshot({
      repo: "NVIDIA/skills",
      defaultBranch: "main",
      commit,
      entries: stripGitHubZipRoot(__test.unzipToEntries(zip)),
    });
    const contentHash = snapshot.skills[0]?.contentHash;
    if (!contentHash) throw new Error("missing fixture hash");

    const events: string[] = [];
    let storedFile = 0;
    const store = vi.fn(async (_blob: Blob) => {
      events.push("store");
      storedFile += 1;
      return `storage:${storedFile}`;
    });
    const runMutation = vi.fn(async (mutation: unknown, _args: Record<string, unknown>) => {
      const name = getFunctionName(mutation as Parameters<typeof getFunctionName>[0]);
      if (name === "securityScan:prepareGitHubSkillScanRequestInternal") {
        events.push("prepare");
        return {
          ok: true,
          prepared: true,
          scanId: "githubSkillScans:1",
          requestId: "skillScanRequests:1",
        };
      }
      if (name === "securityScan:appendGitHubSkillScanRequestFilesInternal") {
        events.push("append");
        return { ok: true, appended: true };
      }
      if (name === "securityScan:finalizeGitHubSkillScanRequestInternal") {
        events.push("finalize");
        return {
          ok: true,
          queued: true,
          scanId: "githubSkillScans:1",
          requestId: "skillScanRequests:1",
          jobId: "securityScanJobs:1",
        };
      }
      throw new Error(`unexpected mutation: ${name}`);
    });
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
      storage: { store, delete: vi.fn() },
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

    expect(result).toMatchObject({ ok: true, queued: true });
    expect(store).toHaveBeenCalledTimes(2);
    expect((store.mock.calls[0]?.[0] as Blob | undefined)?.type).toBe("application/octet-stream");
    expect(runMutation).toHaveBeenCalledTimes(3);
    expect(events).toEqual(["prepare", "store", "store", "append", "finalize"]);
    const [prepareMutation, prepareArgs] = runMutation.mock.calls[0] ?? [];
    expect(getFunctionName(prepareMutation as Parameters<typeof getFunctionName>[0])).toBe(
      "securityScan:prepareGitHubSkillScanRequestInternal",
    );
    expect(prepareArgs).toEqual(
      expect.objectContaining({
        skillId: "skills:aiq-deploy",
        contentHash,
        commit,
        staticScan: expect.objectContaining({ status: "clean" }),
      }),
    );
    expect(prepareArgs).not.toHaveProperty("files");
    expect(Object.values(prepareArgs ?? {})).not.toContain(undefined);
    const [appendMutation, appendArgs] = runMutation.mock.calls[1] ?? [];
    expect(getFunctionName(appendMutation as Parameters<typeof getFunctionName>[0])).toBe(
      "securityScan:appendGitHubSkillScanRequestFilesInternal",
    );
    expect(appendArgs).toEqual(
      expect.objectContaining({
        requestId: "skillScanRequests:1",
        chunkIndex: 0,
        files: expect.arrayContaining([
          expect.objectContaining({ path: "SKILL.md" }),
          expect.objectContaining({ path: "scripts/deploy.sh" }),
        ]),
      }),
    );
    const [finalizeMutation, finalizeArgs] = runMutation.mock.calls[2] ?? [];
    expect(getFunctionName(finalizeMutation as Parameters<typeof getFunctionName>[0])).toBe(
      "securityScan:finalizeGitHubSkillScanRequestInternal",
    );
    expect(finalizeArgs).toEqual({ requestId: "skillScanRequests:1" });
  });

  it("does not store GitHub skill files when the durable content-hash scan can be reused", async () => {
    const commit = "4".repeat(40);
    const zip = zipSync({
      "skills-main/skills/aiq-deploy/SKILL.md": new TextEncoder().encode("# AIQ Deploy\n"),
    });
    const snapshot = await buildGitHubSkillSourceSnapshot({
      repo: "NVIDIA/skills",
      defaultBranch: "main",
      commit,
      entries: stripGitHubZipRoot(__test.unzipToEntries(zip)),
    });
    const contentHash = snapshot.skills[0]?.contentHash;
    if (!contentHash) throw new Error("missing fixture hash");

    const store = vi.fn();
    const runMutation = vi.fn(async (mutation: unknown) => {
      const name = getFunctionName(mutation as Parameters<typeof getFunctionName>[0]);
      if (name === "securityScan:prepareGitHubSkillScanRequestInternal") {
        return {
          ok: true,
          reused: true,
          scanId: "githubSkillScans:1",
          scanStatus: "clean",
        };
      }
      if (name === "githubSkillSync:applyGitHubSkillVerificationResultInternal") {
        return { ok: true, promoted: true };
      }
      throw new Error(`unexpected mutation: ${name}`);
    });
    const ctx = {
      runQuery: vi.fn(async () => ({
        skill: {
          _id: "skills:aiq-deploy",
          slug: "aiq-deploy",
          displayName: "AIQ Deploy",
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
      storage: { store, delete: vi.fn() },
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

    await expect(
      verifyGitHubSkillHandler(
        ctx as never,
        { skillId: "skills:aiq-deploy" as never, contentHash },
        fetcher as unknown as typeof fetch,
      ),
    ).resolves.toMatchObject({ ok: true, reused: true, scanStatus: "clean" });

    expect(store).not.toHaveBeenCalled();
  });

  it("deletes the newly stored boundary file when appending the previous chunk fails", async () => {
    const commit = "5".repeat(40);
    const zipEntries: Record<string, Uint8Array> = {
      "skills-main/skills/aiq-deploy/SKILL.md": new TextEncoder().encode("# AIQ Deploy\n"),
    };
    for (let index = 0; index < 100; index += 1) {
      zipEntries[
        `skills-main/skills/aiq-deploy/scripts/file-${String(index).padStart(3, "0")}.txt`
      ] = new TextEncoder().encode(`file ${index}\n`);
    }
    const zip = zipSync(zipEntries);
    const snapshot = await buildGitHubSkillSourceSnapshot({
      repo: "NVIDIA/skills",
      defaultBranch: "main",
      commit,
      entries: stripGitHubZipRoot(__test.unzipToEntries(zip)),
    });
    const contentHash = snapshot.skills[0]?.contentHash;
    if (!contentHash) throw new Error("missing fixture hash");

    let storedFile = 0;
    const store = vi.fn(async () => {
      storedFile += 1;
      return `storage:${storedFile}`;
    });
    const deleteFile = vi.fn(async () => undefined);
    const runMutation = vi.fn(async (mutation: unknown) => {
      const name = getFunctionName(mutation as Parameters<typeof getFunctionName>[0]);
      if (name === "securityScan:prepareGitHubSkillScanRequestInternal") {
        return {
          ok: true,
          prepared: true,
          scanId: "githubSkillScans:1",
          requestId: "skillScanRequests:1",
        };
      }
      if (name === "securityScan:appendGitHubSkillScanRequestFilesInternal") {
        throw new Error("append failed");
      }
      throw new Error(`unexpected mutation: ${name}`);
    });
    const ctx = {
      runQuery: vi.fn(async () => ({
        skill: {
          _id: "skills:aiq-deploy",
          slug: "aiq-deploy",
          displayName: "AIQ Deploy",
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
      storage: { store, delete: deleteFile },
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

    await expect(
      verifyGitHubSkillHandler(
        ctx as never,
        { skillId: "skills:aiq-deploy" as never, contentHash },
        fetcher as unknown as typeof fetch,
      ),
    ).rejects.toThrow("append failed");

    expect(store).toHaveBeenCalledTimes(101);
    expect(deleteFile).toHaveBeenCalledTimes(101);
    expect(deleteFile).toHaveBeenCalledWith("storage:101");
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
