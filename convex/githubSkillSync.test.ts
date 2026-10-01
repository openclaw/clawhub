import { generateKeyPairSync } from "node:crypto";
import { getFunctionName } from "convex/server";
import { ConvexError } from "convex/values";
import { zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __test,
  applyGitHubSkillSourceSyncHandler,
  applyGitHubSkillVerificationResultHandler,
  configurePublicGitHubSkillSourceHandler,
  getArchiveScanBySkillAndContentHashHandler,
  listSourcesForSyncHandler,
  recordGitHubSkillSourceSyncAttemptHandler,
  revokeGitHubSkillSourceAuthorizationHandler,
  rollbackGitHubSkillCandidateHandler,
  resolveOwnerUserIdForPublisherHandler,
  syncGitHubSkillSourcesHandler,
  upsertGitHubSkillCandidateContentHandler,
  upsertGitHubSkillContentHandler,
  verifyGitHubSkillHandler,
} from "./githubSkillSync";
import { stripGitHubZipRoot } from "./lib/githubImport";
import { buildGitHubSkillSourceSnapshot } from "./lib/githubSkillSync";
import { buildSkillInstallResolution } from "./lib/installResolver";
import { Events } from "./lib/observabilityEvents";

beforeEach(() => {
  vi.stubEnv("CONVEX_DEPLOYMENT", "local:clawhub");
  vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
  vi.stubEnv("CLAWHUB_GITHUB_SKILL_SYNC_ROLLOUT_MODE", "test");
  vi.stubEnv("CLAWHUB_SKILLS_SH_ROLLOUT_MODE", "test");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

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
    delete: async (id: string) => {
      const table = id.split(":")[0] ?? "";
      const index = list(table).findIndex((candidate) => candidate._id === id);
      if (index >= 0) list(table).splice(index, 1);
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
          id: 100,
          full_name: repo,
          owner: { id: 200 },
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
      return new Response(zip, {
        headers: { "content-length": String(zip.byteLength) },
      });
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
  it("uses public API auth without sending OAuth app credentials to codeload", async () => {
    const previousEnv = {
      token: process.env.GITHUB_TOKEN,
      appId: process.env.GITHUB_APP_ID,
      installationId: process.env.GITHUB_APP_INSTALLATION_ID,
      privateKey: process.env.GITHUB_APP_PRIVATE_KEY,
      oauthClientId: process.env.AUTH_GITHUB_ID,
      oauthClientSecret: process.env.AUTH_GITHUB_SECRET,
    };
    delete process.env.GITHUB_TOKEN;
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs1", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    process.env.GITHUB_APP_ID = "3536245";
    process.env.GITHUB_APP_INSTALLATION_ID = "987654";
    process.env.GITHUB_APP_PRIVATE_KEY = privateKey;
    process.env.AUTH_GITHUB_ID = "oauth-client-id";
    process.env.AUTH_GITHUB_SECRET = "oauth-client-secret";
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
      if (previousEnv.oauthClientId === undefined) delete process.env.AUTH_GITHUB_ID;
      else process.env.AUTH_GITHUB_ID = previousEnv.oauthClientId;
      if (previousEnv.oauthClientSecret === undefined) delete process.env.AUTH_GITHUB_SECRET;
      else process.env.AUTH_GITHUB_SECRET = previousEnv.oauthClientSecret;
    }

    const calls = fetcher.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit?]>;
    expect(calls).toHaveLength(3);
    const firstHeaders = calls[0]?.[1]?.headers as Headers;
    const secondHeaders = calls[1]?.[1]?.headers as Headers;
    const thirdInit = calls[2]?.[1];
    expect(firstHeaders.get("Authorization")).toBe(
      `Basic ${btoa("oauth-client-id:oauth-client-secret")}`,
    );
    expect(firstHeaders.get("Accept")).toBe("application/vnd.github+json");
    expect(secondHeaders.get("Authorization")).toBeNull();
    expect(secondHeaders.get("User-Agent")).toBe("clawhub/github-skill-source");
    expect(thirdInit).toBeUndefined();
  });
});

describe("configurePublicGitHubSkillSourceHandler", () => {
  it("fails closed before authentication, database, or GitHub work when rollout is off", async () => {
    vi.stubEnv("CLAWHUB_GITHUB_SKILL_SYNC_ROLLOUT_MODE", "off");
    const runQuery = vi.fn();
    const runMutation = vi.fn();
    const fetchMock = vi.fn();

    await expect(
      configurePublicGitHubSkillSourceHandler(
        { runQuery, runMutation, auth: { getUserIdentity: vi.fn() } } as never,
        {
          ownerPublisherId: "publishers:local" as never,
          repo: "someoneelse/public-skills",
        },
        fetchMock as never,
      ),
    ).rejects.toThrow(/rollout is disabled/i);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(runQuery).not.toHaveBeenCalled();
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("uses Test OAuth app auth and stores a canonical lowercase repo identity", async () => {
    vi.stubEnv("GITHUB_TOKEN", "");
    vi.stubEnv("GITHUB_APP_ID", "");
    vi.stubEnv("GITHUB_APP_INSTALLATION_ID", "");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "");
    vi.stubEnv("AUTH_GITHUB_ID", "oauth-client-id");
    vi.stubEnv("AUTH_GITHUB_SECRET", "oauth-client-secret");
    const zip = zipSync({
      "skills-main/skills/aiq-deploy/SKILL.md": new TextEncoder().encode("# AIQ Deploy\n"),
    });
    const runQuery = vi.fn(async () => {
      return {
        ownerUserId: "users:publisher-owner",
        existingSource: null,
      };
    });
    const runMutation = vi.fn(async () => ({
      ok: true,
      stats: { discovered: 1 },
    }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 101,
          full_name: "SomeoneElse/public-skills",
          owner: { id: 201 },
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
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 101,
          full_name: "SomeoneElse/public-skills",
          owner: { id: 201 },
          private: false,
          visibility: "public",
          default_branch: "main",
          disabled: false,
        }),
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
    const calls = fetchMock.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit?]>;
    const expectedAuthorization = `Basic ${btoa("oauth-client-id:oauth-client-secret")}`;
    expect(new Headers(calls[0]?.[1]?.headers).get("Authorization")).toBe(expectedAuthorization);
    expect(new Headers(calls[1]?.[1]?.headers).get("Authorization")).toBe(expectedAuthorization);
    expect(new Headers(calls[2]?.[1]?.headers).get("Authorization")).toBeNull();
    expect(new Headers(calls[3]?.[1]?.headers).get("Authorization")).toBe(expectedAuthorization);
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        repo: "someoneelse/public-skills",
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

  it("rejects a changed skills.sh selection before applying repository writes", async () => {
    const zip = zipSync({
      "skills-main/skills/html/SKILL.md": new TextEncoder().encode("# HTML\n"),
    });
    const runQuery = vi.fn(async () => ({
      ownerUserId: "users:publisher-owner",
      existingSource: null,
    }));
    const runMutation = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 101,
          full_name: "patrick-erichsen/skills",
          owner: { id: 201 },
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
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 101,
          full_name: "patrick-erichsen/skills",
          owner: { id: 201 },
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
          repo: "patrick-erichsen/skills",
          expectedSkillsShSource: {
            repo: "patrick-erichsen/skills",
            externalId: "patrick-erichsen/skills/html",
            path: "skills/html",
            commit: "2".repeat(40),
            contentHash: "3".repeat(64),
          },
        },
        fetchMock as never,
        { userId: "users:actor" as never },
      ),
    ).rejects.toThrow(/changed since this skills\.sh listing was observed/i);

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("keeps production skills.sh claiming disabled before repository reads or writes", async () => {
    vi.stubEnv("CONVEX_DEPLOYMENT", "prod:wry-manatee-359");
    vi.stubEnv("CLAWHUB_ENV", "production");
    vi.stubEnv("CLAWHUB_DEPLOYMENT_NAME", "wry-manatee-359");
    vi.stubEnv("CLAWHUB_SKILLS_SH_ROLLOUT_MODE", "production");
    vi.stubEnv("CONVEX_CLOUD_URL", "https://wry-manatee-359.convex.cloud");
    const runQuery = vi.fn();
    const runMutation = vi.fn();
    const fetchMock = vi.fn();

    await expect(
      configurePublicGitHubSkillSourceHandler(
        { runQuery, runMutation, auth: { getUserIdentity: vi.fn() } } as never,
        {
          ownerPublisherId: "publishers:local" as never,
          repo: "patrick-erichsen/skills",
          expectedSkillsShSource: {
            repo: "patrick-erichsen/skills",
            externalId: "patrick-erichsen/skills/html",
            path: "skills/html",
            commit: "2".repeat(40),
            contentHash: "3".repeat(64),
          },
        },
        fetchMock as never,
        { userId: "users:actor" as never },
      ),
    ).rejects.toThrow("skills.sh claiming is enabled only in local development and Test");
    expect(runQuery).not.toHaveBeenCalled();
    expect(runMutation).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("matches a skills.sh selection by exact slug, path, commit, and content hash", async () => {
    const snapshot = await buildGitHubSkillSourceSnapshot({
      repo: "patrick-erichsen/skills",
      defaultBranch: "main",
      commit: "1".repeat(40),
      entries: {
        "skills/html/SKILL.md": new TextEncoder().encode("---\nname: html\n---\n# HTML\n"),
      },
    });
    const contentHash = snapshot.skills[0]?.contentHash;
    if (!contentHash) throw new Error("missing fixture hash");
    const exact = {
      repo: "patrick-erichsen/skills",
      externalId: "patrick-erichsen/skills/html",
      path: "skills/html",
      commit: snapshot.commit,
      contentHash,
    };

    expect(() => __test.assertExactSkillsShSourceSelection(snapshot, exact)).not.toThrow();
    for (const changed of [
      { ...exact, repo: "openclaw/openclaw" },
      { ...exact, externalId: "patrick-erichsen/skills/other" },
      { ...exact, path: "skills/other" },
      { ...exact, commit: "2".repeat(40) },
      { ...exact, contentHash: "3".repeat(64) },
    ]) {
      expect(() => __test.assertExactSkillsShSourceSelection(snapshot, changed)).toThrow(
        /changed since this skills\.sh listing was observed/i,
      );
    }
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
    }));
    const runMutation = vi.fn(async () => ({
      ok: true,
      stats: { discovered: 1 },
    }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 102,
          full_name: "aws/agent-toolkit-for-aws",
          owner: { id: 202 },
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
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 102,
          full_name: "aws/agent-toolkit-for-aws",
          owner: { id: 202 },
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
    }));
    const runMutation = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 103,
          full_name: "aws/agent-toolkit-for-aws",
          owner: { id: 203 },
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

  it("rejects repositories that do not match the publisher's immutable GitHub owner", async () => {
    const runQuery = vi.fn(async () => {
      throw new ConvexError("Repository ownership does not match the selected publisher.");
    });
    const runMutation = vi.fn();
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 104,
        full_name: "SomeoneElse/public-skills",
        owner: { id: 204 },
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
    ).rejects.toThrow(/ownership does not match/i);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("rejects a repository transfer that occurs while the source snapshot is fetched", async () => {
    const zip = zipSync({
      "skills-main/skills/html/SKILL.md": new TextEncoder().encode("# HTML\n"),
    });
    const runQuery = vi.fn(async () => ({
      ownerUserId: "users:publisher-owner",
      existingSource: null,
    }));
    const runMutation = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 105,
          full_name: "patrick-erichsen/skills",
          owner: { id: 205 },
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
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 105,
          full_name: "someone-else/skills",
          owner: { id: 999 },
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
          repo: "patrick-erichsen/skills",
        },
        fetchMock as never,
        { userId: "users:actor" as never },
      ),
    ).rejects.toThrow(/authorization no longer matches/i);

    expect(fetchMock).toHaveBeenCalledTimes(4);
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
  it("does not enumerate or fetch generic sources while rollout is off", async () => {
    vi.stubEnv("CLAWHUB_GITHUB_SKILL_SYNC_ROLLOUT_MODE", "off");
    const runQuery = vi.fn(async (_ref, args: Record<string, unknown>) => {
      expect(args).toMatchObject({ legacyOnly: true });
      return { sources: [], continueCursor: null, isDone: true };
    });
    const runMutation = vi.fn();
    const fetchMock = vi.fn();

    await expect(
      syncGitHubSkillSourcesHandler({ runQuery, runMutation } as never, {}, fetchMock as never),
    ).resolves.toMatchObject({
      ok: true,
      synced: 0,
      skipped: 0,
      errors: 0,
      isDone: true,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("lists only the legacy NVIDIA source when generic rollout is off", async () => {
    vi.stubEnv("CLAWHUB_GITHUB_SKILL_SYNC_ROLLOUT_MODE", "off");
    const { db } = createDb({
      githubSkillSources: [
        {
          _id: "githubSkillSources:generic",
          repo: "openclaw/agent-skills",
          createdAt: 1,
          updatedAt: 1,
        },
        {
          _id: "githubSkillSources:nvidia",
          repo: "NVIDIA/skills",
          createdAt: 2,
          updatedAt: 2,
        },
      ],
    });

    await expect(
      listSourcesForSyncHandler({ db } as never, {
        batchSize: 20,
        legacyOnly: true,
      }),
    ).resolves.toEqual({
      sources: [
        expect.objectContaining({
          _id: "githubSkillSources:nvidia",
          repo: "NVIDIA/skills",
        }),
      ],
      continueCursor: null,
      isDone: true,
    });
  });

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
    const runQuery = vi.fn().mockResolvedValueOnce({
      sources: [],
      continueCursor: null,
      isDone: true,
    });
    const runMutation = vi.fn();

    try {
      const result = await syncGitHubSkillSourcesHandler(
        { runQuery, runMutation } as never,
        {},
        vi.fn() as never,
      );

      expect(result).toMatchObject({
        ok: true,
        synced: 0,
        skipped: 0,
        errors: 0,
      });
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
    const runQuery = vi.fn().mockResolvedValueOnce({
      sources: [],
      continueCursor: "next-page",
      isDone: false,
    });

    const result = await syncGitHubSkillSourcesHandler(
      { runQuery, runMutation: vi.fn(), scheduler } as never,
      {},
      vi.fn() as never,
    );

    expect(result).toMatchObject({
      scheduledNext: true,
      cursor: "next-page",
      isDone: false,
    });
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
    const runMutation = vi.fn(async (_ref: unknown, _args: Record<string, unknown>) => ({
      ok: true,
    }));
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

  it("revokes a generic source when GitHub reports the repository missing", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({
        sources: [
          {
            _id: "githubSkillSources:patrick",
            repo: "patrick-erichsen/skills",
            ownerPublisherId: "publishers:patrick",
            githubRepositoryId: "100",
            githubOwnerId: "200",
            defaultBranch: "main",
          },
        ],
        continueCursor: null,
        isDone: true,
      })
      .mockResolvedValueOnce("users:patrick");
    const runMutation = vi.fn(async (_ref: unknown, _args: Record<string, unknown>) => ({
      ok: true,
    }));
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
    });

    await expect(
      syncGitHubSkillSourcesHandler({ runQuery, runMutation } as never, {}, fetchMock as never),
    ).resolves.toMatchObject({ ok: true, synced: 0, errors: 1 });

    expect(getFunctionName(runMutation.mock.calls[0]?.[0] as never)).toBe(
      "githubSkillSync:revokeGitHubSkillSourceAuthorizationInternal",
    );
    expect(runMutation.mock.calls[0]?.[1]).toMatchObject({
      sourceId: "githubSkillSources:patrick",
      error: expect.stringMatching(/public GitHub repo/i),
    });
  });
});

describe("verifyGitHubSkillHandler rollout", () => {
  it("does not fetch or enqueue a generic GitHub skill while rollout is off", async () => {
    vi.stubEnv("CLAWHUB_GITHUB_SKILL_SYNC_ROLLOUT_MODE", "off");
    const runQuery = vi.fn(async () => ({
      skill: {
        _id: "skills:generic",
        slug: "generic",
        displayName: "Generic",
        summary: "Generic skill",
        githubPath: "skills/generic",
        githubCurrentCommit: "a".repeat(40),
        githubCurrentContentHash: "hash",
        githubCurrentStatus: "present",
      },
      source: {
        _id: "githubSkillSources:generic",
        repo: "openclaw/agent-skills",
        defaultBranch: "main",
      },
    }));
    const runMutation = vi.fn();
    const fetchMock = vi.fn();

    await expect(
      verifyGitHubSkillHandler(
        { runQuery, runMutation } as never,
        { skillId: "skills:generic" as never, contentHash: "hash" },
        fetchMock as never,
      ),
    ).resolves.toEqual({ ok: true, skipped: "rollout-disabled" });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(runMutation).not.toHaveBeenCalled();
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

    expect(result.stats).toMatchObject({
      discovered: 1,
      inserted: 0,
      invalid: 1,
    });
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
          const candidate =
            skill && typeof skill.githubPendingCandidateId === "string"
              ? tables.githubSkillCandidates?.find(
                  (row) => row._id === skill.githubPendingCandidateId,
                )
              : null;
          const source =
            skill && typeof (candidate?.githubSourceId ?? skill.githubSourceId) === "string"
              ? tables.githubSkillSources?.find(
                  (row) => row._id === (candidate?.githubSourceId ?? skill.githubSourceId),
                )
              : null;
          if (!skill || !source) return null;
          if (candidate && candidate.githubContentHash === args.contentHash) {
            return {
              skill: {
                ...skill,
                githubPath: candidate.githubPath,
                githubCurrentCommit: candidate.githubCommit,
                githubCurrentContentHash: candidate.githubContentHash,
                githubCurrentStatus: "present",
              },
              source,
              candidateId: candidate._id,
            };
          }
          return { skill, source };
        }
        if ("sourceId" in args) {
          const currentTargets = (tables.skills ?? []).flatMap((skill) => {
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
          const candidateTargets = (tables.githubSkillCandidates ?? [])
            .filter((candidate) => candidate.githubSourceId === args.sourceId)
            .map((candidate) => ({
              skillId: candidate.skillId,
              githubPath: candidate.githubPath,
              githubCurrentContentHash: candidate.githubContentHash,
              candidateId: candidate._id,
            }));
          return [...currentTargets, ...candidateTargets];
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
          if ("candidateId" in args) {
            const candidate = tables.githubSkillCandidates?.find(
              (row) => row._id === args.candidateId,
            );
            if (candidate) {
              Object.assign(candidate, {
                skillMarkdownPath: (args.discovered as Record<string, unknown>).skillMarkdownPath,
                skillMarkdown: (args.discovered as Record<string, unknown>).skillMarkdown,
                skillCardMarkdownPath: (args.discovered as Record<string, unknown>)
                  .skillCardMarkdownPath,
                skillCardMarkdown: (args.discovered as Record<string, unknown>).skillCardMarkdown,
                updatedAt: now,
              });
            }
            return { ok: true };
          }
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
        githubRepositoryId: "100",
        githubOwnerId: "200",
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
        discovered: {
          skillMarkdown: expect.stringContaining("# Demo Source A"),
        },
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
      Object.assign(skill, {
        statsDownloads: 41,
        statsStars: 7,
        statsInstallsCurrent: 3,
        statsInstallsAllTime: 13,
        statsSkillsShInstalls: 29,
        statsGithubStars: 701,
        stats: {
          downloads: 41,
          stars: 7,
          installsCurrent: 3,
          installsAllTime: 13,
          versions: 0,
        },
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
        githubCurrentCommit: "a".repeat(40),
        githubCurrentStatus: "present",
        githubScanStatus: "clean",
        moderationStatus: "active",
        statsDownloads: 41,
        statsStars: 7,
        statsInstallsCurrent: 3,
        statsInstallsAllTime: 13,
        statsSkillsShInstalls: 29,
        statsGithubStars: 701,
      });
      expect(skill.githubCurrentContentHash).toBe(commitAContentHash);
      expect(tables.githubSkillContents[0]).toMatchObject({
        skillMarkdown: expect.stringContaining("# Demo Source A"),
        githubCommit: "a".repeat(40),
      });
      const candidate = tables.githubSkillCandidates.find(
        (row) => row._id === skill.githubPendingCandidateId,
      );
      if (!candidate) throw new Error("expected pending GitHub candidate");
      expect(candidate).toMatchObject({
        skillId: skill._id,
        githubCommit: "b".repeat(40),
        skillMarkdown: expect.stringContaining("# Demo Source B"),
        scanStatus: "pending",
      });
      expect(resolveInstallFromTables(tables, "demo-source")).toMatchObject({
        ok: true,
        github: { commit: "a".repeat(40), contentHash: commitAContentHash },
      });

      now = 210;
      await expect(
        verifyGitHubSkillHandler(
          actionCtx as never,
          {
            skillId: skill._id as never,
            contentHash: candidate.githubContentHash as string,
          },
          fakeGitHub.fetcher as never,
        ),
      ).resolves.toMatchObject({ ok: true, queued: true });
      expect(resolveInstallFromTables(tables, "demo-source")).toMatchObject({
        ok: true,
        github: { commit: "a".repeat(40), contentHash: commitAContentHash },
      });
      const completedScan = tables.githubSkillScans.find(
        (row) => row._id === candidate.verdictSourceScanId,
      );
      Object.assign(completedScan ?? {}, { status: "clean" });
      await applyGitHubSkillVerificationResultHandler({ db } as never, {
        skillId: skill._id as never,
        contentHash: candidate.githubContentHash as string,
        githubSkillScanId: candidate.verdictSourceScanId as never,
        scanStatus: "clean",
        now,
      });
      skill = getSkill(tables, "demo-source");
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
      expect(skill).toMatchObject({
        statsDownloads: 41,
        statsStars: 7,
        statsInstallsCurrent: 3,
        statsInstallsAllTime: 13,
        statsSkillsShInstalls: 29,
        statsGithubStars: 701,
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
        githubCurrentCommit: "b".repeat(40),
        githubCurrentStatus: "missing",
        githubRemovedAt: 300,
        softDeletedAt: 300,
        moderationStatus: "hidden",
        moderationReason: "github.upstream.removed",
        statsDownloads: 41,
        statsStars: 7,
        statsInstallsCurrent: 3,
        statsInstallsAllTime: 13,
        statsSkillsShInstalls: 29,
        statsGithubStars: 701,
      });
      expect(resolveInstallFromTables(tables, "demo-source")).toMatchObject({
        ok: false,
        reason: "github_upstream_removed",
        status: 410,
      });

      fakeGitHub.setSnapshot({
        commit: "d".repeat(40),
        entries: githubRepoEntriesForSkill(`---
name: Demo Source
description: Install from a GitHub-backed source.
---

# Demo Source D
`),
      });
      now = 400;
      await syncGitHubSkillSourcesHandler(actionCtx as never, {}, fakeGitHub.fetcher as never);

      const reappeared = getSkill(tables, "demo-source");
      expect(reappeared).toMatchObject({
        _id: skill._id,
        githubCurrentCommit: "b".repeat(40),
        githubCurrentStatus: "missing",
        githubScanStatus: "clean",
        moderationStatus: "hidden",
        moderationReason: "github.upstream.removed",
        statsDownloads: 41,
        statsStars: 7,
        statsInstallsCurrent: 3,
        statsInstallsAllTime: 13,
        statsSkillsShInstalls: 29,
        statsGithubStars: 701,
      });
      const reappearanceCandidate = tables.githubSkillCandidates.find(
        (row) => row._id === reappeared.githubPendingCandidateId,
      );
      expect(reappearanceCandidate).toMatchObject({
        githubCommit: "d".repeat(40),
        lifecycleStatus: "pending",
      });
      expect(resolveInstallFromTables(tables, "demo-source")).toMatchObject({
        ok: false,
        reason: "github_upstream_removed",
        status: 410,
      });
      const completedReappearanceScan = tables.githubSkillScans.find(
        (row) => row._id === reappearanceCandidate?.verdictSourceScanId,
      );
      Object.assign(completedReappearanceScan ?? {}, { status: "clean" });
      await applyGitHubSkillVerificationResultHandler({ db } as never, {
        skillId: reappeared._id as never,
        contentHash: reappearanceCandidate?.githubContentHash as string,
        githubSkillScanId: reappearanceCandidate?.verdictSourceScanId as never,
        scanStatus: "clean",
        now: 410,
      });
      expect(getSkill(tables, "demo-source")).not.toHaveProperty("softDeletedAt");
      expect(resolveInstallFromTables(tables, "demo-source")).toMatchObject({
        ok: true,
        github: {
          commit: "d".repeat(40),
          contentHash: reappearanceCandidate?.githubContentHash,
        },
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
  it("preserves an intentional soft delete when source content changes", async () => {
    const snapshot = await buildGitHubSkillSourceSnapshot({
      repo: "patrick-erichsen/skills",
      defaultBranch: "main",
      commit: "4".repeat(40),
      entries: { "skills/html/SKILL.md": new TextEncoder().encode("# HTML\n") },
    });
    const { db, tables } = createDb({
      publishers: [
        {
          _id: "publishers:patrick",
          kind: "user",
          handle: "patrick",
          linkedUserId: "users:patrick",
        },
      ],
      githubSkillSources: [
        {
          _id: "githubSkillSources:patrick",
          repo: "patrick-erichsen/skills",
          ownerPublisherId: "publishers:patrick",
          githubRepositoryId: "100",
          githubOwnerId: "200",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      skills: [
        {
          _id: "skills:html",
          slug: "html",
          displayName: "HTML",
          ownerUserId: "users:patrick",
          ownerPublisherId: "publishers:patrick",
          installKind: "github",
          githubSourceId: "githubSkillSources:patrick",
          githubPath: "skills/html",
          githubCurrentCommit: "3".repeat(40),
          githubCurrentContentHash: "old-hash",
          githubCurrentStatus: "present",
          githubScanStatus: "clean",
          softDeletedAt: 50,
          moderationStatus: "hidden",
          moderationReason: "staff.hidden",
          tags: {},
          stats: {
            downloads: 0,
            stars: 0,
            installsCurrent: 0,
            installsAllTime: 0,
            versions: 0,
            comments: 0,
          },
          createdAt: 1,
          updatedAt: 50,
        },
      ],
    });

    await applyGitHubSkillSourceSyncHandler({ db } as never, {
      sourceId: "githubSkillSources:patrick" as never,
      repo: "patrick-erichsen/skills",
      ownerUserId: "users:patrick" as never,
      ownerPublisherId: "publishers:patrick" as never,
      githubRepositoryId: "100",
      githubOwnerId: "200",
      snapshot,
      now: 100,
    });

    expect(tables.skills[0]).toMatchObject({
      softDeletedAt: 50,
      moderationStatus: "hidden",
      moderationReason: "staff.hidden",
      githubCurrentCommit: "3".repeat(40),
      githubCurrentContentHash: "old-hash",
    });
    expect(tables.githubSkillCandidates ?? []).toEqual([]);

    await applyGitHubSkillSourceSyncHandler({ db } as never, {
      sourceId: "githubSkillSources:patrick" as never,
      repo: "patrick-erichsen/skills",
      ownerUserId: "users:patrick" as never,
      ownerPublisherId: "publishers:patrick" as never,
      githubRepositoryId: "100",
      githubOwnerId: "200",
      snapshot: { ...snapshot, skills: [] },
      now: 110,
    });
    expect(tables.skills[0]).toMatchObject({
      softDeletedAt: 50,
      githubRemovedAt: 110,
      githubCurrentStatus: "missing",
    });

    await applyGitHubSkillSourceSyncHandler({ db } as never, {
      sourceId: "githubSkillSources:patrick" as never,
      repo: "patrick-erichsen/skills",
      ownerUserId: "users:patrick" as never,
      ownerPublisherId: "publishers:patrick" as never,
      githubRepositoryId: "100",
      githubOwnerId: "200",
      snapshot,
      now: 120,
    });
    expect(tables.skills[0]).toMatchObject({
      softDeletedAt: 50,
      githubRemovedAt: 110,
      githubCurrentStatus: "missing",
      moderationStatus: "hidden",
    });
  });

  it("revokes transferred sources and cancels their pending candidates", async () => {
    const { db, tables } = createDb({
      githubSkillSources: [
        {
          _id: "githubSkillSources:patrick",
          repo: "patrick-erichsen/skills",
          authorizationStatus: "active",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      githubSkillCandidates: [
        {
          _id: "githubSkillCandidates:html",
          skillId: "skills:html",
          githubSourceId: "githubSkillSources:patrick",
          githubPath: "skills/html",
          githubCommit: "5".repeat(40),
          githubContentHash: "next-hash",
          scanStatus: "failed",
          lifecycleStatus: "failed",
          failedAt: 150,
        },
      ],
      skills: [
        {
          _id: "skills:html",
          slug: "html",
          displayName: "HTML",
          ownerUserId: "users:patrick",
          installKind: "github",
          githubSourceId: "githubSkillSources:patrick",
          githubPath: "skills/html",
          githubCurrentCommit: "4".repeat(40),
          githubCurrentContentHash: "current-hash",
          githubCurrentStatus: "present",
          githubScanStatus: "clean",
          githubPendingCandidateId: "githubSkillCandidates:html",
          moderationStatus: "active",
          moderationFlags: [],
          isSuspicious: false,
          tags: {},
          stats: {
            downloads: 0,
            stars: 0,
            installsCurrent: 0,
            installsAllTime: 0,
            versions: 0,
            comments: 0,
          },
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });

    await revokeGitHubSkillSourceAuthorizationHandler({ db } as never, {
      sourceId: "githubSkillSources:patrick" as never,
      error: "GitHub repository authorization no longer matches.",
      now: 200,
    });

    expect(tables.githubSkillCandidates).toEqual([
      expect.objectContaining({
        _id: "githubSkillCandidates:html",
        lifecycleStatus: "canceled",
        canceledAt: 200,
        cancellationReason: "github.authorization.revoked",
      }),
    ]);
    expect(tables.githubSkillSources[0]).toMatchObject({
      authorizationStatus: "revoked",
      authorizationCheckedAt: 200,
      lastSyncStatus: "failed",
    });
    expect(tables.skills[0]).toMatchObject({
      githubCurrentStatus: "missing",
      githubRemovedAt: 200,
      softDeletedAt: 200,
      moderationStatus: "hidden",
      moderationReason: "github.authorization.revoked",
    });
    expect(tables.skills[0]).not.toHaveProperty("githubPendingCandidateId");
  });

  it("promotes a candidate after caching content for an exact reusable clean scan", async () => {
    const snapshot = await buildGitHubSkillSourceSnapshot({
      repo: "patrick-erichsen/skills",
      defaultBranch: "main",
      commit: "3".repeat(40),
      entries: {
        "skills/html/SKILL.md": new TextEncoder().encode("# HTML reusable\n"),
      },
    });
    const contentHash = snapshot.skills[0]?.contentHash ?? "";
    const { db, tables } = createDb({
      publishers: [
        {
          _id: "publishers:patrick",
          kind: "user",
          handle: "patrick",
          displayName: "Patrick",
          linkedUserId: "users:patrick",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      skills: [
        {
          _id: "skills:html",
          slug: "html",
          displayName: "HTML Hosted",
          ownerUserId: "users:patrick",
          ownerPublisherId: "publishers:patrick",
          latestVersionId: "skillVersions:html-v1",
          tags: {},
          stats: {
            downloads: 0,
            stars: 0,
            installsCurrent: 0,
            installsAllTime: 0,
            versions: 1,
            comments: 0,
          },
          moderationStatus: "active",
          moderationFlags: [],
          isSuspicious: false,
          createdAt: 5,
          updatedAt: 10,
        },
      ],
      githubSkillScans: [
        {
          _id: "githubSkillScans:html",
          skillId: "skills:html",
          githubSourceId: "githubSkillSources:old",
          contentHash,
          commit: "1".repeat(40),
          path: "skills/html",
          status: "clean",
          createdAt: 20,
          updatedAt: 20,
        },
      ],
    });
    const scheduler = { runAfter: vi.fn(async () => undefined) };

    await applyGitHubSkillSourceSyncHandler({ db, scheduler } as never, {
      repo: "patrick-erichsen/skills",
      ownerUserId: "users:patrick" as never,
      ownerPublisherId: "publishers:patrick" as never,
      githubRepositoryId: "100",
      githubOwnerId: "200",
      snapshot,
      now: 100,
    });

    const candidate = tables.githubSkillCandidates[0];
    expect(candidate).toMatchObject({
      scanStatus: "clean",
      githubContentHash: contentHash,
    });
    expect(scheduler.runAfter).not.toHaveBeenCalled();

    await upsertGitHubSkillCandidateContentHandler({ db } as never, {
      candidateId: candidate?._id as never,
      discovered: snapshot.skills[0]!,
      commit: snapshot.commit,
      now: 110,
    });

    expect(tables.githubSkillCandidates).toEqual([
      expect.objectContaining({
        _id: candidate?._id,
        lifecycleStatus: "promoted",
        promotedAt: 110,
        verdictSourceScanId: "githubSkillScans:html",
      }),
    ]);
    expect(tables.skills[0]).toMatchObject({
      _id: "skills:html",
      installKind: "github",
      githubCurrentCommit: snapshot.commit,
      githubCurrentContentHash: contentHash,
      githubScanStatus: "clean",
      githubCurrentCandidateId: candidate?._id,
    });
  });

  it("records pointer-only GitHub changes as immutable candidates without rescanning", async () => {
    const snapshot = await buildGitHubSkillSourceSnapshot({
      repo: "patrick-erichsen/skills",
      defaultBranch: "main",
      commit: "b".repeat(40),
      entries: {
        "skills/html/SKILL.md": new TextEncoder().encode("# HTML\n"),
      },
    });
    const contentHash = snapshot.skills[0]?.contentHash ?? "";
    const { db, tables } = createDb({
      githubSkillSources: [
        {
          _id: "githubSkillSources:current",
          repo: "patrick-erichsen/skills",
          ownerPublisherId: "publishers:patrick",
          githubRepositoryId: "100",
          githubOwnerId: "200",
          authorizationStatus: "active",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      publishers: [
        {
          _id: "publishers:patrick",
          kind: "user",
          handle: "patrick",
          displayName: "Patrick",
          linkedUserId: "users:patrick",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      skills: [
        {
          _id: "skills:html",
          slug: "html",
          displayName: "HTML",
          ownerUserId: "users:patrick",
          ownerPublisherId: "publishers:patrick",
          installKind: "github",
          githubSourceId: "githubSkillSources:current",
          githubPath: "skills/html",
          githubCurrentCommit: "a".repeat(40),
          githubCurrentContentHash: contentHash,
          githubCurrentStatus: "present",
          githubScanStatus: "clean",
          tags: {},
          stats: { downloads: 0, stars: 0, versions: 0, comments: 0 },
          moderationStatus: "active",
          moderationFlags: [],
          isSuspicious: false,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      githubSkillScans: [
        {
          _id: "githubSkillScans:html",
          skillId: "skills:html",
          githubSourceId: "githubSkillSources:current",
          contentHash,
          commit: "a".repeat(40),
          path: "skills/html",
          status: "clean",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    const scheduler = { runAfter: vi.fn(async () => undefined) };

    await applyGitHubSkillSourceSyncHandler({ db, scheduler } as never, {
      sourceId: "githubSkillSources:current" as never,
      repo: "patrick-erichsen/skills",
      ownerUserId: "users:patrick" as never,
      ownerPublisherId: "publishers:patrick" as never,
      githubRepositoryId: "100",
      githubOwnerId: "200",
      snapshot,
      now: 2,
    });

    const candidate = tables.githubSkillCandidates.find(
      (row) => row._id === tables.skills[0]?.githubPendingCandidateId,
    );
    const retainedCurrent = tables.githubSkillCandidates.find(
      (row) => row.githubCommit === "a".repeat(40),
    );
    expect(tables.skills[0]).toMatchObject({
      githubCurrentCommit: "a".repeat(40),
      githubCurrentCandidateId: retainedCurrent?._id,
      githubPendingCandidateId: candidate?._id,
    });
    expect(retainedCurrent).toMatchObject({
      githubRepo: "patrick-erichsen/skills",
      githubPath: "skills/html",
      githubContentHash: contentHash,
      scanStatus: "clean",
      lifecycleStatus: "promoted",
      verdictSourceScanId: "githubSkillScans:html",
    });
    expect(candidate).toMatchObject({
      githubRepo: "patrick-erichsen/skills",
      githubCommit: "b".repeat(40),
      githubContentHash: contentHash,
      lifecycleStatus: "pending",
      verdictSourceScanId: "githubSkillScans:html",
    });
    expect(scheduler.runAfter).not.toHaveBeenCalled();

    await upsertGitHubSkillCandidateContentHandler({ db } as never, {
      candidateId: candidate?._id as never,
      discovered: snapshot.skills[0]!,
      commit: snapshot.commit,
      now: 3,
    });

    expect(tables.skills[0]).toMatchObject({
      githubCurrentCommit: "b".repeat(40),
      githubCurrentContentHash: contentHash,
      githubCurrentCandidateId: candidate?._id,
    });
    expect(candidate).toMatchObject({
      lifecycleStatus: "promoted",
      promotedAt: 3,
    });

    const snapshotA = { ...snapshot, commit: "a".repeat(40) };
    await applyGitHubSkillSourceSyncHandler({ db, scheduler } as never, {
      sourceId: "githubSkillSources:current" as never,
      repo: "patrick-erichsen/skills",
      ownerUserId: "users:patrick" as never,
      ownerPublisherId: "publishers:patrick" as never,
      githubRepositoryId: "100",
      githubOwnerId: "200",
      snapshot: snapshotA,
      now: 4,
    });
    const candidateA = tables.githubSkillCandidates.find(
      (row) => row._id === tables.skills[0]?.githubPendingCandidateId,
    );
    await upsertGitHubSkillCandidateContentHandler({ db } as never, {
      candidateId: candidateA?._id as never,
      discovered: snapshotA.skills[0]!,
      commit: snapshotA.commit,
      now: 5,
    });
    expect(tables.skills[0]).toMatchObject({
      githubCurrentCommit: "a".repeat(40),
      githubCurrentCandidateId: candidateA?._id,
    });

    await applyGitHubSkillSourceSyncHandler({ db, scheduler } as never, {
      sourceId: "githubSkillSources:current" as never,
      repo: "patrick-erichsen/skills",
      ownerUserId: "users:patrick" as never,
      ownerPublisherId: "publishers:patrick" as never,
      githubRepositoryId: "100",
      githubOwnerId: "200",
      snapshot,
      now: 6,
    });
    expect(tables.githubSkillCandidates).toHaveLength(2);
    expect(tables.skills[0]).toMatchObject({
      githubCurrentCommit: "b".repeat(40),
      githubCurrentCandidateId: candidate?._id,
    });

    const redirectedSnapshot = {
      ...snapshot,
      repo: "patrick-erichsen/renamed-skills",
    };
    await applyGitHubSkillSourceSyncHandler({ db, scheduler } as never, {
      sourceId: "githubSkillSources:current" as never,
      repo: "patrick-erichsen/renamed-skills",
      ownerUserId: "users:patrick" as never,
      ownerPublisherId: "publishers:patrick" as never,
      githubRepositoryId: "100",
      githubOwnerId: "200",
      snapshot: redirectedSnapshot,
      now: 7,
    });
    const redirectCandidate = tables.githubSkillCandidates.find(
      (row) => row._id === tables.skills[0]?.githubPendingCandidateId,
    );
    expect(resolveInstallFromTables(tables, "html")).toMatchObject({
      ok: true,
      github: { repo: "patrick-erichsen/skills" },
    });
    expect(redirectCandidate).toMatchObject({
      githubRepo: "patrick-erichsen/renamed-skills",
      lifecycleStatus: "pending",
    });
    await upsertGitHubSkillCandidateContentHandler({ db } as never, {
      candidateId: redirectCandidate?._id as never,
      discovered: redirectedSnapshot.skills[0]!,
      commit: redirectedSnapshot.commit,
      now: 8,
    });
    expect(resolveInstallFromTables(tables, "html")).toMatchObject({
      ok: true,
      github: { repo: "patrick-erichsen/renamed-skills" },
    });
  });

  it("rejects allowed candidate promotion without the candidate's bound scan identity", async () => {
    const { db, tables } = createDb({
      skills: [
        {
          _id: "skills:html",
          slug: "html",
          displayName: "HTML A",
          installKind: "github",
          githubSourceId: "githubSkillSources:current",
          githubPath: "skills/html",
          githubCurrentCommit: "a".repeat(40),
          githubCurrentContentHash: "a".repeat(64),
          githubCurrentStatus: "present",
          githubScanStatus: "clean",
          githubPendingCandidateId: "githubSkillCandidates:b",
        },
      ],
      githubSkillCandidates: [
        {
          _id: "githubSkillCandidates:b",
          skillId: "skills:html",
          githubSourceId: "githubSkillSources:current",
          githubRepo: "patrick-erichsen/skills",
          githubPath: "skills/html",
          githubHasSkillCard: false,
          githubCommit: "b".repeat(40),
          githubContentHash: "b".repeat(64),
          displayName: "HTML B",
          skillMarkdownPath: "skills/html/SKILL.md",
          skillMarkdown: "# HTML B\n",
          scanStatus: "clean",
          lifecycleStatus: "pending",
          verdictSourceScanId: "githubSkillScans:b",
          createdAt: 2,
          updatedAt: 2,
        },
      ],
      githubSkillScans: [
        {
          _id: "githubSkillScans:b",
          skillId: "skills:html",
          githubSourceId: "githubSkillSources:current",
          contentHash: "b".repeat(64),
          commit: "b".repeat(40),
          path: "skills/html",
          status: "clean",
          createdAt: 2,
          updatedAt: 2,
        },
      ],
    });

    await expect(
      applyGitHubSkillVerificationResultHandler({ db } as never, {
        skillId: "skills:html" as never,
        contentHash: "b".repeat(64),
        scanStatus: "clean",
        now: 3,
      }),
    ).resolves.toEqual({ ok: true, skipped: "stale-candidate-verdict" });
    expect(tables.skills[0]).toMatchObject({
      githubCurrentCommit: "a".repeat(40),
      githubPendingCandidateId: "githubSkillCandidates:b",
    });
  });

  it("rejects allowed promotion when a legacy candidate has no durable verdict", async () => {
    const { db, tables } = createDb({
      skills: [
        {
          _id: "skills:html",
          slug: "html",
          displayName: "HTML A",
          installKind: "github",
          githubSourceId: "githubSkillSources:current",
          githubPath: "skills/html",
          githubCurrentCommit: "a".repeat(40),
          githubCurrentContentHash: "a".repeat(64),
          githubCurrentStatus: "present",
          githubScanStatus: "clean",
          githubPendingCandidateId: "githubSkillCandidates:b",
        },
      ],
      githubSkillCandidates: [
        {
          _id: "githubSkillCandidates:b",
          skillId: "skills:html",
          githubSourceId: "githubSkillSources:current",
          githubRepo: "patrick-erichsen/skills",
          githubPath: "skills/html",
          githubHasSkillCard: false,
          githubCommit: "b".repeat(40),
          githubContentHash: "b".repeat(64),
          displayName: "HTML B",
          skillMarkdownPath: "skills/html/SKILL.md",
          skillMarkdown: "# HTML B\n",
          scanStatus: "clean",
          lifecycleStatus: "pending",
          createdAt: 2,
          updatedAt: 2,
        },
      ],
    });

    await expect(
      applyGitHubSkillVerificationResultHandler({ db } as never, {
        skillId: "skills:html" as never,
        contentHash: "b".repeat(64),
        scanStatus: "clean",
        now: 3,
      }),
    ).resolves.toEqual({ ok: true, skipped: "missing-candidate-verdict" });
    expect(tables.skills[0]).toMatchObject({
      githubCurrentCommit: "a".repeat(40),
      githubPendingCandidateId: "githubSkillCandidates:b",
    });
  });

  it("rejects late current-content persistence after a newer pointer wins", async () => {
    const staleSnapshot = await buildGitHubSkillSourceSnapshot({
      repo: "patrick-erichsen/skills",
      defaultBranch: "main",
      commit: "a".repeat(40),
      entries: {
        "skills/html/SKILL.md": new TextEncoder().encode("# HTML\n"),
      },
    });
    const discovered = staleSnapshot.skills[0]!;
    const { db, tables } = createDb({
      skills: [
        {
          _id: "skills:html",
          installKind: "github",
          githubSourceId: "githubSkillSources:current",
          githubPath: discovered.path,
          githubCurrentCommit: "b".repeat(40),
          githubCurrentContentHash: discovered.contentHash,
          githubCurrentStatus: "present",
        },
      ],
      githubSkillContents: [
        {
          _id: "githubSkillContents:html",
          skillId: "skills:html",
          githubSourceId: "githubSkillSources:current",
          githubPath: discovered.path,
          skillMarkdownPath: discovered.skillMarkdownPath,
          skillMarkdown: "# HTML newer pointer\n",
          githubCommit: "b".repeat(40),
          githubContentHash: discovered.contentHash,
          fetchedAt: 2,
          createdAt: 1,
          updatedAt: 2,
        },
      ],
    });

    await expect(
      upsertGitHubSkillContentHandler({ db } as never, {
        skillId: "skills:html" as never,
        sourceId: "githubSkillSources:current" as never,
        discovered,
        commit: staleSnapshot.commit,
        now: 3,
      }),
    ).resolves.toEqual({ ok: true, skipped: "stale-current-pointer" });
    expect(tables.githubSkillContents[0]).toMatchObject({
      skillMarkdown: "# HTML newer pointer\n",
      githubCommit: "b".repeat(40),
    });
  });

  it("resolves an archived candidate from its retained repository after a redirect", async () => {
    const { db } = createDb({
      githubSkillSources: [
        {
          _id: "githubSkillSources:current",
          repo: "patrick-erichsen/renamed-skills",
          authorizationStatus: "active",
          createdAt: 1,
          updatedAt: 3,
        },
      ],
      skills: [
        {
          _id: "skills:html",
          installKind: "github",
          githubSourceId: "githubSkillSources:current",
          githubCurrentRepo: "patrick-erichsen/renamed-skills",
          githubPath: "skills/html",
          githubCurrentCommit: "b".repeat(40),
          githubCurrentContentHash: "b".repeat(64),
          githubCurrentStatus: "present",
          githubScanStatus: "clean",
          githubCurrentCandidateId: "githubSkillCandidates:b",
        },
      ],
      githubSkillCandidates: [
        {
          _id: "githubSkillCandidates:a",
          skillId: "skills:html",
          githubSourceId: "githubSkillSources:current",
          githubRepo: "patrick-erichsen/skills",
          githubPath: "skills/html",
          githubHasSkillCard: false,
          githubCommit: "a".repeat(40),
          githubContentHash: "a".repeat(64),
          displayName: "HTML A",
          scanStatus: "clean",
          lifecycleStatus: "superseded",
          verdictSourceScanId: "githubSkillScans:a",
          createdAt: 1,
          updatedAt: 2,
        },
        {
          _id: "githubSkillCandidates:b",
          skillId: "skills:html",
          githubSourceId: "githubSkillSources:current",
          githubRepo: "patrick-erichsen/renamed-skills",
          githubPath: "skills/html",
          githubHasSkillCard: false,
          githubCommit: "b".repeat(40),
          githubContentHash: "b".repeat(64),
          displayName: "HTML B",
          scanStatus: "clean",
          lifecycleStatus: "promoted",
          verdictSourceScanId: "githubSkillScans:b",
          createdAt: 2,
          updatedAt: 3,
        },
      ],
      githubSkillScans: [
        {
          _id: "githubSkillScans:a",
          skillId: "skills:html",
          githubSourceId: "githubSkillSources:current",
          contentHash: "a".repeat(64),
          commit: "a".repeat(40),
          path: "skills/html",
          status: "clean",
          createdAt: 1,
          updatedAt: 1,
        },
        {
          _id: "githubSkillScans:b",
          skillId: "skills:html",
          githubSourceId: "githubSkillSources:current",
          contentHash: "b".repeat(64),
          commit: "b".repeat(40),
          path: "skills/html",
          status: "clean",
          createdAt: 2,
          updatedAt: 2,
        },
      ],
    });

    await expect(
      getArchiveScanBySkillAndContentHashHandler({ db } as never, {
        skillId: "skills:html" as never,
        commit: "a".repeat(40),
        contentHash: "a".repeat(64),
      }),
    ).resolves.toMatchObject({
      repo: "patrick-erichsen/skills",
      path: "skills/html",
      commit: "a".repeat(40),
      contentHash: "a".repeat(64),
      status: "clean",
    });
  });

  it("refuses a legacy current archive without a durable verdict row", async () => {
    const { db } = createDb({
      githubSkillSources: [
        {
          _id: "githubSkillSources:current",
          repo: "patrick-erichsen/skills",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      skills: [
        {
          _id: "skills:html",
          installKind: "github",
          githubSourceId: "githubSkillSources:current",
          githubPath: "skills/html",
          githubCurrentCommit: "a".repeat(40),
          githubCurrentContentHash: "a".repeat(64),
          githubCurrentStatus: "present",
          githubScanStatus: "clean",
        },
      ],
    });

    await expect(
      getArchiveScanBySkillAndContentHashHandler({ db } as never, {
        skillId: "skills:html" as never,
        commit: "a".repeat(40),
        contentHash: "a".repeat(64),
      }),
    ).resolves.toBeNull();
  });

  it("resolves a deterministic retained archive when redirects share a commit and content hash", async () => {
    const commit = "a".repeat(40);
    const contentHash = "a".repeat(64);
    const { db } = createDb({
      githubSkillSources: [
        {
          _id: "githubSkillSources:current",
          repo: "patrick-erichsen/current-skills",
          createdAt: 1,
          updatedAt: 4,
        },
      ],
      skills: [
        {
          _id: "skills:html",
          githubCurrentCandidateId: "githubSkillCandidates:current",
        },
      ],
      githubSkillCandidates: [
        {
          _id: "githubSkillCandidates:old",
          skillId: "skills:html",
          githubSourceId: "githubSkillSources:current",
          githubRepo: "patrick-erichsen/old-skills",
          githubPath: "skills/html",
          githubHasSkillCard: false,
          githubCommit: commit,
          githubContentHash: contentHash,
          displayName: "HTML old",
          scanStatus: "clean",
          lifecycleStatus: "superseded",
          verdictSourceScanId: "githubSkillScans:html",
          promotedAt: 1,
          createdAt: 1,
          updatedAt: 2,
        },
        {
          _id: "githubSkillCandidates:redirected",
          skillId: "skills:html",
          githubSourceId: "githubSkillSources:current",
          githubRepo: "patrick-erichsen/redirected-skills",
          githubPath: "skills/html",
          githubHasSkillCard: false,
          githubCommit: commit,
          githubContentHash: contentHash,
          displayName: "HTML redirected",
          scanStatus: "clean",
          lifecycleStatus: "superseded",
          verdictSourceScanId: "githubSkillScans:html",
          promotedAt: 3,
          createdAt: 2,
          updatedAt: 3,
        },
        {
          _id: "githubSkillCandidates:current",
          skillId: "skills:html",
          githubSourceId: "githubSkillSources:current",
          githubRepo: "patrick-erichsen/current-skills",
          githubPath: "skills/html",
          githubHasSkillCard: false,
          githubCommit: "b".repeat(40),
          githubContentHash: "b".repeat(64),
          displayName: "HTML current",
          scanStatus: "clean",
          lifecycleStatus: "promoted",
          verdictSourceScanId: "githubSkillScans:current",
          promotedAt: 4,
          createdAt: 3,
          updatedAt: 4,
        },
      ],
      githubSkillScans: [
        {
          _id: "githubSkillScans:html",
          skillId: "skills:html",
          githubSourceId: "githubSkillSources:current",
          contentHash,
          commit,
          path: "skills/html",
          status: "clean",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });

    await expect(
      getArchiveScanBySkillAndContentHashHandler({ db } as never, {
        skillId: "skills:html" as never,
        commit,
        contentHash,
      }),
    ).resolves.toMatchObject({
      repo: "patrick-erichsen/redirected-skills",
      commit,
      contentHash,
    });
  });

  it("keeps a missing skill hidden when it reappears through a repository redirect", async () => {
    const snapshot = await buildGitHubSkillSourceSnapshot({
      repo: "patrick-erichsen/renamed-skills",
      defaultBranch: "main",
      commit: "a".repeat(40),
      entries: {
        "skills/html/SKILL.md": new TextEncoder().encode("# HTML\n"),
      },
    });
    const contentHash = snapshot.skills[0]?.contentHash ?? "";
    const { db, tables } = createDb({
      githubSkillSources: [
        {
          _id: "githubSkillSources:current",
          repo: "patrick-erichsen/skills",
          ownerPublisherId: "publishers:patrick",
          githubRepositoryId: "100",
          githubOwnerId: "200",
          authorizationStatus: "active",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      publishers: [
        {
          _id: "publishers:patrick",
          kind: "user",
          handle: "patrick",
          linkedUserId: "users:patrick",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      skills: [
        {
          _id: "skills:html",
          slug: "html",
          displayName: "HTML",
          ownerUserId: "users:patrick",
          ownerPublisherId: "publishers:patrick",
          installKind: "github",
          githubSourceId: "githubSkillSources:current",
          githubCurrentRepo: "patrick-erichsen/skills",
          githubPath: "skills/html",
          githubCurrentCommit: snapshot.commit,
          githubCurrentContentHash: contentHash,
          githubCurrentStatus: "missing",
          githubScanStatus: "clean",
          githubRemovedAt: 2,
          softDeletedAt: 2,
          moderationStatus: "hidden",
          moderationReason: "github.upstream.removed",
          tags: {},
          stats: { downloads: 0, stars: 0, installsCurrent: 0, installsAllTime: 0, versions: 0 },
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      githubSkillScans: [
        {
          _id: "githubSkillScans:html",
          skillId: "skills:html",
          githubSourceId: "githubSkillSources:current",
          contentHash,
          commit: snapshot.commit,
          path: "skills/html",
          status: "clean",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    const scheduler = { runAfter: vi.fn(async () => undefined) };

    await applyGitHubSkillSourceSyncHandler({ db, scheduler } as never, {
      sourceId: "githubSkillSources:current" as never,
      repo: "patrick-erichsen/renamed-skills",
      ownerUserId: "users:patrick" as never,
      ownerPublisherId: "publishers:patrick" as never,
      githubRepositoryId: "100",
      githubOwnerId: "200",
      snapshot,
      now: 3,
    });

    expect(tables.skills[0]).toMatchObject({
      githubCurrentRepo: "patrick-erichsen/skills",
      githubCurrentStatus: "missing",
      moderationStatus: "hidden",
    });
    expect(tables.githubSkillCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          githubRepo: "patrick-erichsen/skills",
          githubCommit: snapshot.commit,
          githubContentHash: contentHash,
          lifecycleStatus: "promoted",
          verdictSourceScanId: "githubSkillScans:html",
        }),
        expect.objectContaining({
          githubRepo: "patrick-erichsen/renamed-skills",
          lifecycleStatus: "pending",
        }),
      ]),
    );
  });

  it("rejects stale source observations before they can replace a newer source state", async () => {
    const snapshot = await buildGitHubSkillSourceSnapshot({
      repo: "patrick-erichsen/skills",
      defaultBranch: "main",
      commit: "b".repeat(40),
      entries: {
        "skills/html/SKILL.md": new TextEncoder().encode("# stale HTML\n"),
      },
    });
    const { db, tables } = createDb({
      githubSkillSources: [
        {
          _id: "githubSkillSources:current",
          repo: "patrick-erichsen/skills",
          ownerPublisherId: "publishers:patrick",
          githubRepositoryId: "100",
          githubOwnerId: "200",
          authorizationStatus: "active",
          displayManifestCommit: "c".repeat(40),
          createdAt: 1,
          updatedAt: 20,
        },
      ],
    });

    await expect(
      applyGitHubSkillSourceSyncHandler({ db } as never, {
        sourceId: "githubSkillSources:current" as never,
        repo: "patrick-erichsen/skills",
        ownerUserId: "users:patrick" as never,
        ownerPublisherId: "publishers:patrick" as never,
        githubRepositoryId: "100",
        githubOwnerId: "200",
        expectedSourceUpdatedAt: 10,
        snapshot,
        now: 30,
      }),
    ).resolves.toMatchObject({ ok: true, skipped: "stale-source-observation" });
    expect(tables.githubSkillSources[0]).toMatchObject({
      displayManifestCommit: "c".repeat(40),
      updatedAt: 20,
    });
    expect(tables.githubSkillCandidates ?? []).toEqual([]);
  });

  it("rejects an observation that expected to create a source after another writer created it", async () => {
    const snapshot = await buildGitHubSkillSourceSnapshot({
      repo: "patrick-erichsen/skills",
      defaultBranch: "main",
      commit: "b".repeat(40),
      entries: {
        "skills/html/SKILL.md": new TextEncoder().encode("# stale HTML\n"),
      },
    });
    const { db, tables } = createDb({
      githubSkillSources: [
        {
          _id: "githubSkillSources:current",
          repo: "patrick-erichsen/skills",
          ownerPublisherId: "publishers:patrick",
          githubRepositoryId: "100",
          githubOwnerId: "200",
          authorizationStatus: "active",
          displayManifestCommit: "c".repeat(40),
          createdAt: 20,
          updatedAt: 20,
        },
      ],
    });

    await expect(
      applyGitHubSkillSourceSyncHandler({ db } as never, {
        repo: "patrick-erichsen/skills",
        ownerUserId: "users:patrick" as never,
        ownerPublisherId: "publishers:patrick" as never,
        githubRepositoryId: "100",
        githubOwnerId: "200",
        expectedSourceUpdatedAt: null,
        snapshot,
        now: 30,
      }),
    ).resolves.toMatchObject({ ok: true, skipped: "stale-source-observation" });
    expect(tables.githubSkillSources[0]).toMatchObject({
      displayManifestCommit: "c".repeat(40),
      updatedAt: 20,
    });
  });

  it("rejects reassignment of a disconnected source to a different publisher", async () => {
    const snapshot = await buildGitHubSkillSourceSnapshot({
      repo: "patrick-erichsen/skills",
      defaultBranch: "main",
      commit: "b".repeat(40),
      entries: {
        "skills/html/SKILL.md": new TextEncoder().encode("# HTML\n"),
      },
    });
    const { db, tables } = createDb({
      githubSkillSources: [
        {
          _id: "githubSkillSources:current",
          repo: "patrick-erichsen/skills",
          disconnectedOwnerPublisherId: "publishers:patrick",
          githubRepositoryId: "100",
          githubOwnerId: "200",
          authorizationStatus: "revoked",
          createdAt: 1,
          updatedAt: 2,
        },
      ],
    });

    await expect(
      applyGitHubSkillSourceSyncHandler({ db } as never, {
        sourceId: "githubSkillSources:current" as never,
        repo: "patrick-erichsen/skills",
        ownerUserId: "users:other" as never,
        ownerPublisherId: "publishers:other" as never,
        githubRepositoryId: "100",
        githubOwnerId: "200",
        expectedSourceUpdatedAt: 2,
        snapshot,
        now: 3,
      }),
    ).rejects.toThrow(/explicit ownership transfer/i);
    expect(tables.githubSkillSources[0]).toMatchObject({
      disconnectedOwnerPublisherId: "publishers:patrick",
      authorizationStatus: "revoked",
      updatedAt: 2,
    });
  });

  it("rejects a repository redirect that collides with a retained source row", async () => {
    const snapshot = await buildGitHubSkillSourceSnapshot({
      repo: "patrick-erichsen/retained-skills",
      defaultBranch: "main",
      commit: "b".repeat(40),
      entries: {},
    });
    const { db, tables } = createDb({
      githubSkillSources: [
        {
          _id: "githubSkillSources:current",
          repo: "patrick-erichsen/current-skills",
          ownerPublisherId: "publishers:patrick",
          githubRepositoryId: "100",
          githubOwnerId: "200",
          authorizationStatus: "active",
          createdAt: 1,
          updatedAt: 2,
        },
        {
          _id: "githubSkillSources:retained",
          repo: "patrick-erichsen/retained-skills",
          disconnectedOwnerPublisherId: "publishers:other",
          githubRepositoryId: "300",
          githubOwnerId: "400",
          authorizationStatus: "revoked",
          createdAt: 1,
          updatedAt: 2,
        },
      ],
    });

    await expect(
      applyGitHubSkillSourceSyncHandler({ db } as never, {
        sourceId: "githubSkillSources:current" as never,
        repo: "patrick-erichsen/retained-skills",
        ownerUserId: "users:patrick" as never,
        ownerPublisherId: "publishers:patrick" as never,
        githubRepositoryId: "100",
        githubOwnerId: "200",
        expectedSourceUpdatedAt: 2,
        snapshot,
        now: 3,
      }),
    ).rejects.toThrow(/retained by another source/i);
    expect(tables.githubSkillSources).toHaveLength(2);
    expect(tables.githubSkillSources[0]).toMatchObject({
      repo: "patrick-erichsen/current-skills",
      updatedAt: 2,
    });
  });

  it("rejects a stale same-hash callback from a superseded source pointer", async () => {
    const contentHash = "a".repeat(64);
    const { db, tables } = createDb({
      githubSkillSources: [
        {
          _id: "githubSkillSources:current",
          repo: "patrick-erichsen/skills",
          authorizationStatus: "active",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      skills: [
        {
          _id: "skills:html",
          slug: "html",
          displayName: "HTML A",
          ownerUserId: "users:patrick",
          ownerPublisherId: "publishers:patrick",
          installKind: "github",
          githubSourceId: "githubSkillSources:current",
          githubPath: "skills/html",
          githubCurrentCommit: "1".repeat(40),
          githubCurrentContentHash: "1".repeat(64),
          githubCurrentStatus: "present",
          githubScanStatus: "clean",
          githubPendingCandidateId: "githubSkillCandidates:return-a",
          tags: {},
          stats: { downloads: 0, stars: 0, versions: 0, comments: 0 },
          moderationStatus: "active",
          moderationFlags: [],
          isSuspicious: false,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      githubSkillCandidates: [
        {
          _id: "githubSkillCandidates:return-a",
          skillId: "skills:html",
          githubSourceId: "githubSkillSources:current",
          githubRepo: "patrick-erichsen/skills",
          githubPath: "skills/html-renamed",
          githubHasSkillCard: false,
          githubCommit: "3".repeat(40),
          githubContentHash: contentHash,
          displayName: "HTML A again",
          skillMarkdownPath: "skills/html-renamed/SKILL.md",
          skillMarkdown: "# HTML A again\n",
          scanStatus: "clean",
          lifecycleStatus: "pending",
          verdictSourceScanId: "githubSkillScans:return-a",
          createdAt: 3,
          updatedAt: 3,
        },
      ],
      githubSkillScans: [
        {
          _id: "githubSkillScans:stale-b",
          skillId: "skills:html",
          githubSourceId: "githubSkillSources:current",
          contentHash,
          commit: "2".repeat(40),
          path: "skills/html-old-pointer",
          status: "clean",
          createdAt: 2,
          updatedAt: 2,
        },
        {
          _id: "githubSkillScans:return-a",
          skillId: "skills:html",
          githubSourceId: "githubSkillSources:current",
          contentHash,
          commit: "3".repeat(40),
          path: "skills/html-renamed",
          status: "clean",
          createdAt: 3,
          updatedAt: 3,
        },
      ],
    });

    await expect(
      applyGitHubSkillVerificationResultHandler({ db } as never, {
        skillId: "skills:html" as never,
        contentHash,
        githubSkillScanId: "githubSkillScans:stale-b" as never,
        scanStatus: "clean",
        now: 10,
      }),
    ).resolves.toEqual({ ok: true, skipped: "stale-candidate-verdict" });
    expect(tables.skills[0]).toMatchObject({
      githubCurrentCommit: "1".repeat(40),
      githubPendingCandidateId: "githubSkillCandidates:return-a",
    });

    await expect(
      applyGitHubSkillVerificationResultHandler({ db } as never, {
        skillId: "skills:html" as never,
        contentHash,
        githubSkillScanId: "githubSkillScans:return-a" as never,
        scanStatus: "clean",
        now: 11,
      }),
    ).resolves.toMatchObject({ ok: true, promoted: true });
    expect(tables.skills[0]).toMatchObject({
      githubCurrentCommit: "3".repeat(40),
      githubPath: "skills/html-renamed",
      githubCurrentCandidateId: "githubSkillCandidates:return-a",
    });
  });

  it("retains a rejected candidate without replacing the allowed GitHub version", async () => {
    const { db, tables } = createDb({
      skills: [
        {
          _id: "skills:html",
          slug: "html",
          displayName: "HTML A",
          ownerUserId: "users:patrick",
          installKind: "github",
          githubSourceId: "githubSkillSources:current",
          githubPath: "skills/html",
          githubCurrentCommit: "a".repeat(40),
          githubCurrentContentHash: "a".repeat(64),
          githubCurrentStatus: "present",
          githubScanStatus: "clean",
          githubPendingCandidateId: "githubSkillCandidates:b",
          tags: {},
          stats: { downloads: 0, stars: 0, versions: 0, comments: 0 },
          moderationStatus: "active",
          moderationFlags: [],
          isSuspicious: false,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      githubSkillCandidates: [
        {
          _id: "githubSkillCandidates:b",
          skillId: "skills:html",
          githubSourceId: "githubSkillSources:current",
          githubRepo: "patrick-erichsen/skills",
          githubPath: "skills/html",
          githubHasSkillCard: false,
          githubCommit: "b".repeat(40),
          githubContentHash: "b".repeat(64),
          displayName: "HTML B",
          skillMarkdownPath: "skills/html/SKILL.md",
          skillMarkdown: "# HTML B\n",
          scanStatus: "pending",
          lifecycleStatus: "pending",
          verdictSourceScanId: "githubSkillScans:b",
          createdAt: 2,
          updatedAt: 2,
        },
      ],
      githubSkillScans: [
        {
          _id: "githubSkillScans:b",
          skillId: "skills:html",
          githubSourceId: "githubSkillSources:current",
          contentHash: "b".repeat(64),
          commit: "b".repeat(40),
          path: "skills/html",
          status: "malicious",
          createdAt: 2,
          updatedAt: 3,
        },
      ],
    });

    await expect(
      applyGitHubSkillVerificationResultHandler({ db } as never, {
        skillId: "skills:html" as never,
        contentHash: "b".repeat(64),
        githubSkillScanId: "githubSkillScans:b" as never,
        scanStatus: "malicious",
        now: 3,
      }),
    ).resolves.toEqual({ ok: true, promoted: false });

    expect(tables.skills[0]).toMatchObject({
      githubCurrentCommit: "a".repeat(40),
      githubCurrentContentHash: "a".repeat(64),
      githubScanStatus: "clean",
    });
    expect(tables.skills[0]).not.toHaveProperty("githubPendingCandidateId");
    expect(tables.githubSkillCandidates[0]).toMatchObject({
      lifecycleStatus: "rejected",
      rejectedAt: 3,
      scanStatus: "malicious",
    });
  });

  it("keeps a failed candidate addressable so the exact scan can be retried", async () => {
    const { db, tables } = createDb({
      skills: [
        {
          _id: "skills:html",
          slug: "html",
          displayName: "HTML A",
          ownerUserId: "users:patrick",
          installKind: "github",
          githubSourceId: "githubSkillSources:current",
          githubPath: "skills/html",
          githubCurrentCommit: "a".repeat(40),
          githubCurrentContentHash: "a".repeat(64),
          githubCurrentStatus: "present",
          githubScanStatus: "clean",
          githubPendingCandidateId: "githubSkillCandidates:b",
          tags: {},
          stats: { downloads: 0, stars: 0, versions: 0, comments: 0 },
          moderationStatus: "active",
          moderationFlags: [],
          isSuspicious: false,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      githubSkillCandidates: [
        {
          _id: "githubSkillCandidates:b",
          skillId: "skills:html",
          githubSourceId: "githubSkillSources:current",
          githubRepo: "patrick-erichsen/skills",
          githubPath: "skills/html",
          githubHasSkillCard: false,
          githubCommit: "b".repeat(40),
          githubContentHash: "b".repeat(64),
          displayName: "HTML B",
          skillMarkdownPath: "skills/html/SKILL.md",
          skillMarkdown: "# HTML B\n",
          scanStatus: "pending",
          lifecycleStatus: "pending",
          verdictSourceScanId: "githubSkillScans:b",
          createdAt: 2,
          updatedAt: 2,
        },
      ],
      githubSkillScans: [
        {
          _id: "githubSkillScans:b",
          skillId: "skills:html",
          githubSourceId: "githubSkillSources:current",
          contentHash: "b".repeat(64),
          commit: "b".repeat(40),
          path: "skills/html",
          status: "failed",
          createdAt: 2,
          updatedAt: 3,
        },
      ],
    });

    await applyGitHubSkillVerificationResultHandler({ db } as never, {
      skillId: "skills:html" as never,
      contentHash: "b".repeat(64),
      githubSkillScanId: "githubSkillScans:b" as never,
      scanStatus: "failed",
      now: 3,
    });
    expect(tables.skills[0]).toMatchObject({
      githubCurrentCommit: "a".repeat(40),
      githubPendingCandidateId: "githubSkillCandidates:b",
    });

    Object.assign(tables.githubSkillScans[0] ?? {}, { status: "pending" });
    await applyGitHubSkillVerificationResultHandler({ db } as never, {
      skillId: "skills:html" as never,
      contentHash: "b".repeat(64),
      githubSkillScanId: "githubSkillScans:b" as never,
      scanStatus: "pending",
      now: 4,
    });
    expect(tables.githubSkillCandidates[0]).toMatchObject({
      lifecycleStatus: "pending",
      scanStatus: "pending",
    });

    Object.assign(tables.githubSkillScans[0] ?? {}, { status: "clean" });
    await applyGitHubSkillVerificationResultHandler({ db } as never, {
      skillId: "skills:html" as never,
      contentHash: "b".repeat(64),
      githubSkillScanId: "githubSkillScans:b" as never,
      scanStatus: "clean",
      now: 5,
    });
    expect(tables.skills[0]).toMatchObject({
      githubCurrentCommit: "b".repeat(40),
      githubCurrentCandidateId: "githubSkillCandidates:b",
    });
  });

  it("retains a known-malicious replacement as rejected without making it pending", async () => {
    const snapshot = await buildGitHubSkillSourceSnapshot({
      repo: "patrick-erichsen/skills",
      defaultBranch: "main",
      commit: "b".repeat(40),
      entries: {
        "skills/html/SKILL.md": new TextEncoder().encode("# HTML B\n"),
      },
    });
    const contentHash = snapshot.skills[0]?.contentHash ?? "";
    const { db, tables } = createDb({
      githubSkillSources: [
        {
          _id: "githubSkillSources:current",
          repo: "patrick-erichsen/skills",
          ownerPublisherId: "publishers:patrick",
          githubRepositoryId: "100",
          githubOwnerId: "200",
          authorizationStatus: "active",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      publishers: [
        {
          _id: "publishers:patrick",
          kind: "user",
          handle: "patrick",
          displayName: "Patrick",
          linkedUserId: "users:patrick",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      skills: [
        {
          _id: "skills:html",
          slug: "html",
          displayName: "HTML A",
          ownerUserId: "users:patrick",
          ownerPublisherId: "publishers:patrick",
          installKind: "github",
          githubSourceId: "githubSkillSources:current",
          githubCurrentRepo: "patrick-erichsen/skills",
          githubPath: "skills/html",
          githubCurrentCommit: "a".repeat(40),
          githubCurrentContentHash: "a".repeat(64),
          githubCurrentStatus: "present",
          githubScanStatus: "clean",
          tags: {},
          stats: { downloads: 0, stars: 0, versions: 0, comments: 0 },
          moderationStatus: "active",
          moderationFlags: [],
          isSuspicious: false,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      githubSkillScans: [
        {
          _id: "githubSkillScans:b",
          skillId: "skills:html",
          githubSourceId: "githubSkillSources:current",
          contentHash,
          commit: "b".repeat(40),
          path: "skills/html",
          status: "malicious",
          createdAt: 2,
          updatedAt: 2,
        },
      ],
    });
    const scheduler = { runAfter: vi.fn(async () => undefined) };

    await applyGitHubSkillSourceSyncHandler({ db, scheduler } as never, {
      sourceId: "githubSkillSources:current" as never,
      repo: "patrick-erichsen/skills",
      ownerUserId: "users:patrick" as never,
      ownerPublisherId: "publishers:patrick" as never,
      githubRepositoryId: "100",
      githubOwnerId: "200",
      snapshot,
      now: 3,
    });

    expect(tables.skills[0]).toMatchObject({
      githubCurrentCommit: "a".repeat(40),
      githubCurrentContentHash: "a".repeat(64),
    });
    expect(tables.skills[0]).not.toHaveProperty("githubPendingCandidateId");
    expect(tables.githubSkillCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          githubCommit: "b".repeat(40),
          scanStatus: "malicious",
          lifecycleStatus: "rejected",
          rejectedAt: 3,
        }),
      ]),
    );
    expect(scheduler.runAfter).not.toHaveBeenCalled();
  });

  it("rolls back to a retained candidate with its own allowed verdict", async () => {
    const { db, tables } = createDb({
      githubSkillSources: [
        {
          _id: "githubSkillSources:current",
          repo: "patrick-erichsen/skills",
          authorizationStatus: "active",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      skills: [
        {
          _id: "skills:html",
          slug: "html",
          displayName: "HTML B",
          ownerUserId: "users:patrick",
          ownerPublisherId: "publishers:patrick",
          installKind: "github",
          githubSourceId: "githubSkillSources:current",
          githubPath: "skills/html",
          githubCurrentCommit: "b".repeat(40),
          githubCurrentContentHash: "b".repeat(64),
          githubCurrentStatus: "present",
          githubScanStatus: "clean",
          githubCurrentCandidateId: "githubSkillCandidates:b",
          githubPendingCandidateId: "githubSkillCandidates:c",
          tags: {},
          stats: { downloads: 0, stars: 0, versions: 0, comments: 0 },
          moderationStatus: "active",
          moderationFlags: [],
          isSuspicious: false,
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      githubSkillCandidates: [
        {
          _id: "githubSkillCandidates:a",
          skillId: "skills:html",
          githubSourceId: "githubSkillSources:current",
          githubRepo: "patrick-erichsen/skills",
          githubPath: "skills/html",
          githubHasSkillCard: false,
          githubCommit: "a".repeat(40),
          githubContentHash: "a".repeat(64),
          displayName: "HTML A",
          skillMarkdownPath: "skills/html/SKILL.md",
          skillMarkdown: "# HTML A\n",
          scanStatus: "clean",
          lifecycleStatus: "superseded",
          verdictSourceScanId: "githubSkillScans:a",
          promotedAt: 1,
          createdAt: 1,
          updatedAt: 2,
        },
        {
          _id: "githubSkillCandidates:b",
          skillId: "skills:html",
          githubSourceId: "githubSkillSources:current",
          githubRepo: "patrick-erichsen/skills",
          githubPath: "skills/html",
          githubHasSkillCard: false,
          githubCommit: "b".repeat(40),
          githubContentHash: "b".repeat(64),
          displayName: "HTML B",
          skillMarkdownPath: "skills/html/SKILL.md",
          skillMarkdown: "# HTML B\n",
          scanStatus: "clean",
          lifecycleStatus: "promoted",
          verdictSourceScanId: "githubSkillScans:b",
          previousCandidateId: "githubSkillCandidates:a",
          promotedAt: 2,
          createdAt: 2,
          updatedAt: 2,
        },
        {
          _id: "githubSkillCandidates:c",
          skillId: "skills:html",
          githubSourceId: "githubSkillSources:current",
          githubRepo: "patrick-erichsen/skills",
          githubPath: "skills/html",
          githubHasSkillCard: false,
          githubCommit: "c".repeat(40),
          githubContentHash: "c".repeat(64),
          displayName: "HTML C",
          scanStatus: "pending",
          lifecycleStatus: "pending",
          previousCandidateId: "githubSkillCandidates:b",
          createdAt: 3,
          updatedAt: 3,
        },
      ],
      githubSkillContents: [
        {
          _id: "githubSkillContents:html",
          skillId: "skills:html",
          githubSourceId: "githubSkillSources:current",
          githubPath: "skills/html",
          skillMarkdownPath: "skills/html/SKILL.md",
          skillMarkdown: "# HTML B\n",
          githubCommit: "b".repeat(40),
          githubContentHash: "b".repeat(64),
          fetchedAt: 2,
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      githubSkillScans: [
        {
          _id: "githubSkillScans:a",
          skillId: "skills:html",
          githubSourceId: "githubSkillSources:current",
          contentHash: "a".repeat(64),
          commit: "a".repeat(40),
          path: "skills/html",
          status: "clean",
          createdAt: 1,
          updatedAt: 1,
        },
        {
          _id: "githubSkillScans:b",
          skillId: "skills:html",
          githubSourceId: "githubSkillSources:current",
          contentHash: "b".repeat(64),
          commit: "b".repeat(40),
          path: "skills/html",
          status: "clean",
          createdAt: 2,
          updatedAt: 2,
        },
      ],
    });

    await expect(
      rollbackGitHubSkillCandidateHandler({ db } as never, {
        skillId: "skills:html" as never,
        targetCandidateId: "githubSkillCandidates:a" as never,
        confirm: "rollback-github-skill-candidate",
        now: 3,
      }),
    ).resolves.toMatchObject({ ok: true, rolledBack: true });

    expect(tables.skills[0]).toMatchObject({
      displayName: "HTML A",
      githubCurrentCommit: "a".repeat(40),
      githubCurrentContentHash: "a".repeat(64),
      githubCurrentCandidateId: "githubSkillCandidates:a",
    });
    expect(tables.githubSkillCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          _id: "githubSkillCandidates:a",
          lifecycleStatus: "promoted",
        }),
        expect.objectContaining({
          _id: "githubSkillCandidates:b",
          lifecycleStatus: "rolled_back",
          rolledBackAt: 3,
        }),
        expect.objectContaining({
          _id: "githubSkillCandidates:c",
          lifecycleStatus: "canceled",
          canceledAt: 3,
          cancellationReason: "github.rollback",
        }),
      ]),
    );
    expect(tables.githubSkillContents[0]).toMatchObject({
      skillMarkdown: "# HTML A\n",
      githubCommit: "a".repeat(40),
      githubContentHash: "a".repeat(64),
    });
  });

  it("promotes a Hosted Skill in place only after the exact GitHub candidate passes scanning", async () => {
    const snapshot = await buildGitHubSkillSourceSnapshot({
      repo: "patrick-erichsen/skills",
      defaultBranch: "main",
      commit: "2".repeat(40),
      entries: {
        "skills/html/SKILL.md": new TextEncoder().encode(`---
name: HTML
description: Build HTML artifacts.
---

# HTML
`),
      },
    });
    const { db, tables } = createDb({
      publishers: [
        {
          _id: "publishers:patrick",
          kind: "user",
          handle: "patrick",
          displayName: "Patrick",
          linkedUserId: "users:patrick",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      skills: [
        {
          _id: "skills:html",
          slug: "html",
          displayName: "HTML Hosted",
          ownerUserId: "users:patrick",
          ownerPublisherId: "publishers:patrick",
          latestVersionId: "skillVersions:html-v1",
          latestVersionSummary: { version: "1.0.0", createdAt: 10 },
          tags: { latest: "1.0.0" },
          statsDownloads: 37,
          statsStars: 11,
          statsInstallsCurrent: 5,
          statsInstallsAllTime: 23,
          statsSkillsShInstalls: 47,
          statsGithubStars: 901,
          stats: {
            downloads: 37,
            stars: 11,
            installsCurrent: 5,
            installsAllTime: 23,
            versions: 1,
            comments: 0,
          },
          moderationStatus: "active",
          moderationFlags: [],
          isSuspicious: false,
          createdAt: 5,
          updatedAt: 10,
        },
      ],
      skillVersions: [
        {
          _id: "skillVersions:html-v1",
          skillId: "skills:html",
          version: "1.0.0",
          createdAt: 10,
        },
      ],
      bookmarks: [
        {
          _id: "bookmarks:html",
          skillId: "skills:html",
          userId: "users:reader",
          createdAt: 20,
        },
      ],
      auditLogs: [
        {
          _id: "auditLogs:html",
          targetId: "skills:html",
          action: "skill.publish",
          createdAt: 10,
        },
      ],
      globalStats: [
        {
          _id: "globalStats:default",
          key: "default",
          activeSkillsCount: 1,
          updatedAt: 1,
        },
      ],
    });
    const scheduler = { runAfter: vi.fn(async () => undefined) };

    const applied = await applyGitHubSkillSourceSyncHandler({ db, scheduler } as never, {
      repo: "patrick-erichsen/skills",
      ownerUserId: "users:patrick" as never,
      ownerPublisherId: "publishers:patrick" as never,
      githubRepositoryId: "100",
      githubOwnerId: "200",
      snapshot,
      now: 100,
    });

    expect(applied.stats).toMatchObject({
      changed: 1,
      inserted: 0,
      conflicts: 0,
    });
    const pendingSkill = tables.skills[0];
    const candidate = tables.githubSkillCandidates[0];
    expect(pendingSkill).toMatchObject({
      _id: "skills:html",
      latestVersionId: "skillVersions:html-v1",
      statsDownloads: 37,
      statsStars: 11,
      statsInstallsCurrent: 5,
      statsInstallsAllTime: 23,
      statsSkillsShInstalls: 47,
      statsGithubStars: 901,
      githubPendingCandidateId: candidate?._id,
    });
    expect(pendingSkill).not.toHaveProperty("installKind");
    expect(candidate).toMatchObject({
      skillId: "skills:html",
      githubPath: "skills/html",
      githubCommit: "2".repeat(40),
      githubContentHash: snapshot.skills[0]?.contentHash,
      scanStatus: "pending",
    });

    Object.assign(candidate ?? {}, {
      skillMarkdownPath: snapshot.skills[0]?.skillMarkdownPath,
      skillMarkdown: snapshot.skills[0]?.skillMarkdown,
    });
    const completedScan = tables.githubSkillScans.find(
      (row) => row._id === candidate?.verdictSourceScanId,
    );
    Object.assign(completedScan ?? {}, { status: "clean" });
    Object.assign(pendingSkill ?? {}, {
      softDeletedAt: 105,
      moderationStatus: "hidden",
      moderationReason: "staff.hidden",
    });
    await expect(
      applyGitHubSkillVerificationResultHandler({ db } as never, {
        skillId: "skills:html" as never,
        contentHash: snapshot.skills[0]?.contentHash ?? "",
        githubSkillScanId: candidate?.verdictSourceScanId as never,
        scanStatus: "clean",
        now: 106,
      }),
    ).resolves.toMatchObject({ skipped: "skill-no-longer-eligible" });
    expect(tables.skills[0]).toMatchObject({
      latestVersionId: "skillVersions:html-v1",
      softDeletedAt: 105,
      moderationStatus: "hidden",
      moderationReason: "staff.hidden",
    });
    expect(tables.skills[0]).not.toHaveProperty("installKind");

    delete pendingSkill?.softDeletedAt;
    delete pendingSkill?.moderationReason;
    Object.assign(pendingSkill ?? {}, { moderationStatus: "active" });
    await applyGitHubSkillVerificationResultHandler({ db } as never, {
      skillId: "skills:html" as never,
      contentHash: snapshot.skills[0]?.contentHash ?? "",
      githubSkillScanId: candidate?.verdictSourceScanId as never,
      scanStatus: "clean",
      now: 110,
    });

    expect(tables.skills).toHaveLength(1);
    expect(tables.skills[0]).toMatchObject({
      _id: "skills:html",
      createdAt: 5,
      installKind: "github",
      githubPath: "skills/html",
      githubCurrentCommit: "2".repeat(40),
      githubScanStatus: "clean",
      statsDownloads: 37,
      statsStars: 11,
      statsInstallsCurrent: 5,
      statsInstallsAllTime: 23,
      statsSkillsShInstalls: 47,
      statsGithubStars: 901,
    });
    expect(tables.skills[0]).not.toHaveProperty("latestVersionId");
    expect(tables.skills[0]).not.toHaveProperty("githubPendingCandidateId");
    expect(tables.githubSkillCandidates).toEqual([
      expect.objectContaining({
        _id: candidate?._id,
        lifecycleStatus: "promoted",
        promotedAt: 110,
      }),
    ]);
    expect(tables.skillVersions).toEqual([
      expect.objectContaining({
        _id: "skillVersions:html-v1",
        skillId: "skills:html",
      }),
    ]);
    expect(tables.bookmarks).toEqual([
      expect.objectContaining({
        _id: "bookmarks:html",
        skillId: "skills:html",
      }),
    ]);
    expect(tables.auditLogs).toEqual([
      expect.objectContaining({
        _id: "auditLogs:html",
        targetId: "skills:html",
      }),
    ]);
    expect(tables.skillVersions).toHaveLength(1);
  });

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
          stats: {
            downloads: 0,
            stars: 0,
            installsCurrent: 0,
            installsAllTime: 0,
            versions: 0,
          },
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
          JSON.stringify({
            groupings: [{ title: "Agentic AI", skills: ["aiq-deploy"] }],
          }),
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
          stats: {
            downloads: 0,
            stars: 0,
            installsCurrent: 0,
            installsAllTime: 0,
            versions: 0,
          },
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
          stats: {
            downloads: 0,
            stars: 0,
            installsCurrent: 0,
            installsAllTime: 0,
            versions: 1,
          },
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
          stats: {
            downloads: 0,
            stars: 0,
            installsCurrent: 0,
            installsAllTime: 0,
            versions: 0,
          },
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

    expect(result.stats).toMatchObject({
      inserted: 1,
      conflicts: 0,
      invalid: 0,
    });
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
          statsSkillsShInstalls: 17,
          statsGithubStars: 321,
          stats: {
            downloads: 7,
            stars: 3,
            installsCurrent: 2,
            installsAllTime: 5,
            versions: 0,
          },
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
      statsInstallsCurrent: 2,
      statsInstallsAllTime: 5,
      statsSkillsShInstalls: 17,
      statsGithubStars: 321,
      stats: {
        downloads: 7,
        stars: 3,
        installsCurrent: 2,
        installsAllTime: 5,
      },
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

  it("keeps the exact permanent-Test skills.sh claim pending without scheduling verification", async () => {
    const snapshot = await buildGitHubSkillSourceSnapshot({
      repo: "patrick-erichsen/skills",
      defaultBranch: "main",
      commit: "2".repeat(40),
      entries: {
        "skills/html/SKILL.md": new TextEncoder().encode("# HTML\n"),
      },
    });
    const { db, tables } = createDb({
      publishers: [
        {
          _id: "publishers:patrick",
          kind: "org",
          handle: "patrick",
          displayName: "Patrick",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    const scheduler = { runAfter: vi.fn(async () => undefined) };

    await applyGitHubSkillSourceSyncHandler({ db, scheduler } as never, {
      repo: "patrick-erichsen/skills",
      ownerUserId: "users:patrick" as never,
      ownerPublisherId: "publishers:patrick" as never,
      githubRepositoryId: "100",
      githubOwnerId: "200",
      skillsShClaimPath: "skills/html",
      snapshot,
      now: 123,
    });

    expect(tables.skills).toEqual([
      expect.objectContaining({
        slug: "html",
        githubPath: "skills/html",
        githubScanStatus: "pending",
      }),
    ]);
    expect(tables.githubSkillScans ?? []).toHaveLength(0);
    expect(scheduler.runAfter).not.toHaveBeenCalled();
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
          statsDownloads: 7,
          statsStars: 3,
          statsInstallsCurrent: 2,
          statsInstallsAllTime: 5,
          statsSkillsShInstalls: 17,
          statsGithubStars: 321,
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
          stats: {
            downloads: 0,
            stars: 0,
            installsCurrent: 0,
            installsAllTime: 0,
            versions: 0,
          },
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
          stats: {
            downloads: 0,
            stars: 0,
            installsCurrent: 0,
            installsAllTime: 0,
            versions: 0,
          },
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
          stats: {
            downloads: 0,
            stars: 0,
            installsCurrent: 0,
            installsAllTime: 0,
            versions: 0,
          },
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
  it("queues NVIDIA evaluation after a suspicious current-version scan resolves", async () => {
    const { db, tables } = createDb({
      skills: [
        {
          _id: "skills:doca-dpa",
          slug: "doca-dpa",
          displayName: "DOCA DPA",
          ownerUserId: "users:nvidia",
          ownerPublisherId: "publishers:nvidia",
          installKind: "github",
          githubSourceId: "githubSkillSources:nvidia",
          githubCurrentRepo: "NVIDIA/skills",
          githubPath: "skills/doca-dpa",
          githubCurrentCommit: "2".repeat(40),
          githubCurrentContentHash: "current-hash",
          githubCurrentStatus: "present",
          githubScanStatus: "pending",
          tags: {},
          stats: { downloads: 0, stars: 0, versions: 0 },
          moderationStatus: "hidden",
          moderationReason: "pending.scan",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });

    const result = await applyGitHubSkillVerificationResultHandler({ db } as never, {
      skillId: "skills:doca-dpa" as never,
      contentHash: "current-hash",
      scanStatus: "suspicious",
      now: 123,
    });

    expect(result).toEqual({ ok: true, promoted: false });
    expect(tables.skillEvaluationRuns).toEqual([
      expect.objectContaining({
        skillId: "skills:doca-dpa",
        sourceRepo: "nvidia/skills",
        scanStatus: "suspicious",
        source: "sync",
        status: "queued",
      }),
    ]);
  });

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
          statsDownloads: 7,
          statsStars: 3,
          statsInstallsCurrent: 2,
          statsInstallsAllTime: 5,
          statsSkillsShInstalls: 17,
          statsGithubStars: 321,
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
      statsDownloads: 7,
      statsStars: 3,
      statsInstallsCurrent: 2,
      statsInstallsAllTime: 5,
      statsSkillsShInstalls: 17,
      statsGithubStars: 321,
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
      "skills-main/skills/aiq-deploy/agents/openai.yaml": new TextEncoder().encode(
        "interface:\n  display_name: AIQ Deploy Console\n  short_description: OpenAI-specific summary.\n",
      ),
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
        return new Response(zip, {
          headers: { "content-length": String(zip.byteLength) },
        });
      }
      return new Response("not found", { status: 404 });
    });

    const result = await verifyGitHubSkillHandler(
      ctx as never,
      { skillId: "skills:aiq-deploy" as never, contentHash },
      fetcher as unknown as typeof fetch,
    );

    expect(result).toMatchObject({ ok: true, queued: true });
    expect(store).toHaveBeenCalledTimes(3);
    expect((store.mock.calls[0]?.[0] as Blob | undefined)?.type).toBe("application/octet-stream");
    expect(runMutation).toHaveBeenCalledTimes(3);
    expect(events).toEqual(["prepare", "store", "store", "store", "append", "finalize"]);
    const [prepareMutation, prepareArgs] = runMutation.mock.calls[0] ?? [];
    expect(getFunctionName(prepareMutation as Parameters<typeof getFunctionName>[0])).toBe(
      "securityScan:prepareGitHubSkillScanRequestInternal",
    );
    expect(prepareArgs).toEqual(
      expect.objectContaining({
        skillId: "skills:aiq-deploy",
        contentHash,
        commit,
        parsed: {
          frontmatter: {},
          presentation: {
            displayName: "AIQ Deploy Console",
            summary: "OpenAI-specific summary.",
          },
        },
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
          expect.objectContaining({ path: "agents/openai.yaml" }),
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
        return new Response(zip, {
          headers: { "content-length": String(zip.byteLength) },
        });
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
        return new Response(zip, {
          headers: { "content-length": String(zip.byteLength) },
        });
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
