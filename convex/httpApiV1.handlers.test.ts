/* @vitest-environment node */
import { unzipSync } from "fflate";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import { RATE_LIMITS } from "./lib/httpRateLimit";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
}));

vi.mock("./lib/apiTokenAuth", () => ({
  requireApiTokenUser: vi.fn(),
  getOptionalApiTokenUserId: vi.fn(),
  requirePackagePublishAuth: vi.fn(),
}));

vi.mock("./lib/githubActionsOidc", () => ({
  fetchGitHubRepositoryIdentity: vi.fn(),
  verifyGitHubActionsTrustedPublishJwt: vi.fn(),
}));

vi.mock("./skills", () => ({
  publishVersionForUser: vi.fn(),
}));

const { getAuthUserId } = await import("@convex-dev/auth/server");
const { getOptionalApiTokenUserId, requireApiTokenUser, requirePackagePublishAuth } = await import(
  "./lib/apiTokenAuth"
);
const { fetchGitHubRepositoryIdentity, verifyGitHubActionsTrustedPublishJwt } = await import(
  "./lib/githubActionsOidc"
);
const { publishVersionForUser } = await import("./skills");
const { __handlers } = await import("./httpApiV1");

type ActionCtx = import("./_generated/server").ActionCtx;

type RateLimitArgs = { key: string; limit: number; windowMs: number };

function isRateLimitArgs(args: unknown): args is RateLimitArgs {
  if (!args || typeof args !== "object") return false;
  const value = args as Record<string, unknown>;
  return (
    typeof value.key === "string" &&
    typeof value.limit === "number" &&
    typeof value.windowMs === "number"
  );
}

function hasSlugArgs(args: unknown): args is { slug: string } {
  if (!args || typeof args !== "object") return false;
  const value = args as Record<string, unknown>;
  return typeof value.slug === "string";
}

function findRateLimitCallArgs(mock: ReturnType<typeof vi.fn>) {
  return mock.mock.calls.map(([, args]) => args).find(isRateLimitArgs);
}

function makeCtx(partial: Record<string, unknown>) {
  const partialRunQuery =
    typeof partial.runQuery === "function"
      ? (partial.runQuery as (query: unknown, args: Record<string, unknown>) => unknown)
      : null;
  const runQuery = vi.fn(async (query: unknown, args: Record<string, unknown>) => {
    if (isRateLimitArgs(args)) return okRate();
    return partialRunQuery ? await partialRunQuery(query, args) : null;
  });
  const runMutation =
    typeof partial.runMutation === "function"
      ? partial.runMutation
      : vi.fn().mockResolvedValue(okRate());

  return { ...partial, runQuery, runMutation } as unknown as ActionCtx;
}

const okRate = () => ({
  allowed: true,
  remaining: 10,
  limit: 100,
  resetAt: Date.now() + 60_000,
});

const blockedRate = () => ({
  allowed: false,
  remaining: 0,
  limit: 100,
  resetAt: Date.now() + 60_000,
});

beforeEach(() => {
  vi.mocked(getAuthUserId).mockReset();
  vi.mocked(getAuthUserId).mockResolvedValue(null);
  vi.mocked(getOptionalApiTokenUserId).mockReset();
  vi.mocked(getOptionalApiTokenUserId).mockResolvedValue(null);
  vi.mocked(requireApiTokenUser).mockReset();
  vi.mocked(requirePackagePublishAuth).mockReset();
  vi.mocked(fetchGitHubRepositoryIdentity).mockReset();
  vi.mocked(verifyGitHubActionsTrustedPublishJwt).mockReset();
  vi.mocked(publishVersionForUser).mockReset();
});

describe("httpApiV1 handlers", () => {
  it("search returns empty results for blank query", async () => {
    const runAction = vi.fn();
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const response = await __handlers.searchSkillsV1Handler(
      makeCtx({ runAction, runMutation }),
      new Request("https://example.com/api/v1/search?q=%20%20"),
    );
    if (response.status !== 200) {
      throw new Error(await response.text());
    }
    expect(await response.json()).toEqual({ results: [] });
    expect(runAction).not.toHaveBeenCalled();
  });

  it("users/restore forbids non-admin api tokens", async () => {
    const runQuery = vi.fn();
    const runAction = vi.fn();
    const runMutation = vi.fn().mockResolvedValue(okRate());
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:actor",
      user: { _id: "users:actor", role: "user" },
    } as never);

    const response = await __handlers.usersPostRouterV1Handler(
      makeCtx({ runQuery, runAction, runMutation }),
      new Request("https://example.com/api/v1/users/restore", {
        method: "POST",
        body: JSON.stringify({ handle: "target", slugs: ["a"] }),
      }),
    );
    expect(response.status).toBe(403);
    expect(runQuery).not.toHaveBeenCalled();
    expect(runAction).not.toHaveBeenCalled();
  });

  it("users/restore calls restore action for admin", async () => {
    const runAction = vi.fn().mockResolvedValue({ ok: true, totalRestored: 1, results: [] });
    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate();
      return { ok: true };
    });
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("handle" in args) return { _id: "users:target" };
      return null;
    });
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:admin",
      user: { _id: "users:admin", role: "admin" },
    } as never);

    const response = await __handlers.usersPostRouterV1Handler(
      makeCtx({ runQuery, runAction, runMutation }),
      new Request("https://example.com/api/v1/users/restore", {
        method: "POST",
        body: JSON.stringify({
          handle: "Target",
          slugs: ["a", "b"],
          forceOverwriteSquatter: true,
        }),
      }),
    );
    if (response.status !== 200) throw new Error(await response.text());
    expect(runAction).toHaveBeenCalledWith(expect.anything(), {
      actorUserId: "users:admin",
      ownerHandle: "target",
      ownerUserId: "users:target",
      slugs: ["a", "b"],
      forceOverwriteSquatter: true,
    });
  });

  it("users/reclaim forbids non-admin api tokens", async () => {
    const runQuery = vi.fn();
    const runAction = vi.fn();
    const runMutation = vi.fn().mockResolvedValue(okRate());
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:actor",
      user: { _id: "users:actor", role: "user" },
    } as never);

    const response = await __handlers.usersPostRouterV1Handler(
      makeCtx({ runQuery, runAction, runMutation }),
      new Request("https://example.com/api/v1/users/reclaim", {
        method: "POST",
        body: JSON.stringify({ handle: "target", slugs: ["a"] }),
      }),
    );
    expect(response.status).toBe(403);
    expect(runQuery).not.toHaveBeenCalled();
  });

  it("users/reclaim calls reclaim mutation for admin", async () => {
    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate();
      return { ok: true, action: "ownership_transferred" };
    });
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("handle" in args) return { _id: "users:target" };
      return null;
    });
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:admin",
      user: { _id: "users:admin", role: "admin" },
    } as never);

    const response = await __handlers.usersPostRouterV1Handler(
      makeCtx({ runQuery, runAction: vi.fn(), runMutation }),
      new Request("https://example.com/api/v1/users/reclaim", {
        method: "POST",
        body: JSON.stringify({ handle: "Target", slugs: [" A ", "b"], reason: "r" }),
      }),
    );
    if (response.status !== 200) throw new Error(await response.text());

    const reclaimCalls = runMutation.mock.calls.filter(([, args]) => hasSlugArgs(args));
    expect(reclaimCalls).toHaveLength(2);
    expect(reclaimCalls[0]?.[1]).toMatchObject({
      actorUserId: "users:admin",
      slug: "a",
      rightfulOwnerUserId: "users:target",
      reason: "r",
      transferRootSlugOnly: true,
    });
    expect(reclaimCalls[1]?.[1]).toMatchObject({
      actorUserId: "users:admin",
      slug: "b",
      rightfulOwnerUserId: "users:target",
      reason: "r",
      transferRootSlugOnly: true,
    });
  });

  it("users/publisher ensures an org publisher handle for admin", async () => {
    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate();
      return {
        ok: true,
        publisherId: "publishers:openclaw",
        handle: "openclaw",
        created: true,
        migrated: false,
        trusted: true,
      };
    });
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:admin",
      user: { _id: "users:admin", role: "admin" },
    } as never);

    const response = await __handlers.usersPostRouterV1Handler(
      makeCtx({ runQuery: vi.fn(), runAction: vi.fn(), runMutation }),
      new Request("https://example.com/api/v1/users/publisher", {
        method: "POST",
        body: JSON.stringify({ handle: "OpenClaw", displayName: "OpenClaw", trusted: true }),
      }),
    );
    if (response.status !== 200) throw new Error(await response.text());

    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorUserId: "users:admin",
        handle: "openclaw",
        displayName: "OpenClaw",
        trusted: true,
      }),
    );
  });

  it("search forwards limit and highlightedOnly", async () => {
    const runAction = vi.fn().mockResolvedValue([
      {
        score: 1,
        skill: { slug: "a", displayName: "A", summary: null, updatedAt: 1 },
        version: { version: "1.0.0" },
      },
    ]);
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const response = await __handlers.searchSkillsV1Handler(
      makeCtx({ runAction, runMutation }),
      new Request("https://example.com/api/v1/search?q=test&limit=5&highlightedOnly=true"),
    );
    if (response.status !== 200) {
      throw new Error(await response.text());
    }
    expect(runAction).toHaveBeenCalledWith(expect.anything(), {
      query: "test",
      limit: 5,
      highlightedOnly: true,
      nonSuspiciousOnly: undefined,
    });
  });

  it("search forwards nonSuspiciousOnly", async () => {
    const runAction = vi.fn().mockResolvedValue([]);
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const response = await __handlers.searchSkillsV1Handler(
      makeCtx({ runAction, runMutation }),
      new Request("https://example.com/api/v1/search?q=test&nonSuspiciousOnly=1"),
    );
    if (response.status !== 200) {
      throw new Error(await response.text());
    }
    expect(runAction).toHaveBeenCalledWith(expect.anything(), {
      query: "test",
      limit: undefined,
      highlightedOnly: undefined,
      nonSuspiciousOnly: true,
    });
  });

  it("search forwards legacy nonSuspicious alias", async () => {
    const runAction = vi.fn().mockResolvedValue([]);
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const response = await __handlers.searchSkillsV1Handler(
      makeCtx({ runAction, runMutation }),
      new Request("https://example.com/api/v1/search?q=test&nonSuspicious=1"),
    );
    if (response.status !== 200) {
      throw new Error(await response.text());
    }
    expect(runAction).toHaveBeenCalledWith(expect.anything(), {
      query: "test",
      limit: undefined,
      highlightedOnly: undefined,
      nonSuspiciousOnly: true,
    });
  });

  it("search prefers canonical nonSuspiciousOnly over legacy alias", async () => {
    const runAction = vi.fn().mockResolvedValue([]);
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const response = await __handlers.searchSkillsV1Handler(
      makeCtx({ runAction, runMutation }),
      new Request(
        "https://example.com/api/v1/search?q=test&nonSuspiciousOnly=false&nonSuspicious=1",
      ),
    );
    if (response.status !== 200) {
      throw new Error(await response.text());
    }
    expect(runAction).toHaveBeenCalledWith(expect.anything(), {
      query: "test",
      limit: undefined,
      highlightedOnly: undefined,
      nonSuspiciousOnly: undefined,
    });
  });

  it("search rate limits", async () => {
    const runMutation = vi.fn().mockResolvedValue(blockedRate());
    const response = await __handlers.searchSkillsV1Handler(
      makeCtx({ runAction: vi.fn(), runMutation }),
      new Request("https://example.com/api/v1/search?q=test"),
    );
    expect(response.status).toBe(429);
  });

  it("429 Retry-After is a relative delay, not an absolute epoch", async () => {
    const runMutation = vi.fn().mockResolvedValue(blockedRate());
    const response = await __handlers.searchSkillsV1Handler(
      makeCtx({ runAction: vi.fn(), runMutation }),
      new Request("https://example.com/api/v1/search?q=test"),
    );
    expect(response.status).toBe(429);
    const retryAfter = Number(response.headers.get("Retry-After"));
    // Retry-After must be a small relative delay (seconds), not a Unix epoch
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(120);
  });

  it("resolve validates hash", async () => {
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const response = await __handlers.resolveSkillVersionV1Handler(
      makeCtx({ runQuery: vi.fn(), runMutation }),
      new Request("https://example.com/api/v1/resolve?slug=demo&hash=bad"),
    );
    expect(response.status).toBe(400);
  });

  it("resolve returns 404 when missing", async () => {
    const runQuery = vi.fn().mockResolvedValue(null);
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const response = await __handlers.resolveSkillVersionV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request(
        "https://example.com/api/v1/resolve?slug=demo&hash=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ),
    );
    expect(response.status).toBe(404);
  });

  it("resolve returns match and latestVersion", async () => {
    const runQuery = vi.fn().mockResolvedValue({
      match: { version: "1.0.0" },
      latestVersion: { version: "2.0.0" },
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const response = await __handlers.resolveSkillVersionV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request(
        "https://example.com/api/v1/resolve?slug=demo&hash=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ),
    );
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.match.version).toBe("1.0.0");
  });

  it("lists skills with resolved tags using batch query", async () => {
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("cursor" in args || "limit" in args) {
        return {
          items: [
            {
              skill: {
                _id: "skills:1",
                slug: "demo",
                displayName: "Demo",
                summary: "s",
                tags: { latest: "versions:1" },
                stats: { downloads: 0, stars: 0, versions: 1, comments: 0 },
                createdAt: 1,
                updatedAt: 2,
              },
              latestVersion: { version: "1.0.0", createdAt: 3, changelog: "c" },
            },
          ],
          nextCursor: null,
        };
      }
      // Batch query: versionIds (plural)
      if ("versionIds" in args) {
        return [{ _id: "versions:1", version: "1.0.0", softDeletedAt: undefined }];
      }
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const response = await __handlers.listSkillsV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/skills?limit=1"),
    );
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.items[0].tags.latest).toBe("1.0.0");
  });

  it("batches tag resolution across multiple skills into single query", async () => {
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("cursor" in args || "limit" in args) {
        return {
          items: [
            {
              skill: {
                _id: "skills:1",
                slug: "skill-a",
                displayName: "Skill A",
                summary: "s",
                tags: { latest: "versions:1", stable: "versions:2" },
                stats: { downloads: 0, stars: 0, versions: 2, comments: 0 },
                createdAt: 1,
                updatedAt: 2,
              },
              latestVersion: { version: "2.0.0", createdAt: 3, changelog: "c" },
            },
            {
              skill: {
                _id: "skills:2",
                slug: "skill-b",
                displayName: "Skill B",
                summary: "s",
                tags: { latest: "versions:3" },
                stats: { downloads: 0, stars: 0, versions: 1, comments: 0 },
                createdAt: 1,
                updatedAt: 2,
              },
              latestVersion: { version: "1.0.0", createdAt: 3, changelog: "c" },
            },
          ],
          nextCursor: null,
        };
      }
      // Batch query should receive all version IDs from all skills
      if ("versionIds" in args) {
        const ids = args.versionIds as string[];
        expect(ids).toHaveLength(3);
        expect(ids).toContain("versions:1");
        expect(ids).toContain("versions:2");
        expect(ids).toContain("versions:3");
        return [
          { _id: "versions:1", version: "2.0.0", softDeletedAt: undefined },
          { _id: "versions:2", version: "1.0.0", softDeletedAt: undefined },
          { _id: "versions:3", version: "1.0.0", softDeletedAt: undefined },
        ];
      }
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const response = await __handlers.listSkillsV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/skills"),
    );
    expect(response.status).toBe(200);
    const json = await response.json();
    // Verify tags are correctly resolved for each skill
    expect(json.items[0].tags.latest).toBe("2.0.0");
    expect(json.items[0].tags.stable).toBe("1.0.0");
    expect(json.items[1].tags.latest).toBe("1.0.0");
    // Verify batch query was called exactly once (not per-tag)
    const batchCalls = runQuery.mock.calls.filter(
      ([, args]) => args && "versionIds" in (args as Record<string, unknown>),
    );
    expect(batchCalls).toHaveLength(1);
  });

  it("lists souls with resolved tags using batch query", async () => {
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("cursor" in args || "limit" in args) {
        return {
          items: [
            {
              soul: {
                _id: "souls:1",
                slug: "demo-soul",
                displayName: "Demo Soul",
                summary: "s",
                tags: { latest: "soulVersions:1" },
                stats: { downloads: 0, stars: 0, versions: 1, comments: 0 },
                createdAt: 1,
                updatedAt: 2,
              },
              latestVersion: { version: "1.0.0", createdAt: 3, changelog: "c" },
            },
          ],
          nextCursor: null,
        };
      }
      if ("versionIds" in args) {
        return [{ _id: "soulVersions:1", version: "1.0.0", softDeletedAt: undefined }];
      }
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const response = await __handlers.listSoulsV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/souls?limit=1"),
    );
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.items[0].tags.latest).toBe("1.0.0");
  });

  it("batches tag resolution across multiple souls into single query", async () => {
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("cursor" in args || "limit" in args) {
        return {
          items: [
            {
              soul: {
                _id: "souls:1",
                slug: "soul-a",
                displayName: "Soul A",
                summary: "s",
                tags: { latest: "soulVersions:1", stable: "soulVersions:2" },
                stats: { downloads: 0, stars: 0, versions: 2, comments: 0 },
                createdAt: 1,
                updatedAt: 2,
              },
              latestVersion: { version: "2.0.0", createdAt: 3, changelog: "c" },
            },
            {
              soul: {
                _id: "souls:2",
                slug: "soul-b",
                displayName: "Soul B",
                summary: "s",
                tags: { latest: "soulVersions:3" },
                stats: { downloads: 0, stars: 0, versions: 1, comments: 0 },
                createdAt: 1,
                updatedAt: 2,
              },
              latestVersion: { version: "1.0.0", createdAt: 3, changelog: "c" },
            },
          ],
          nextCursor: null,
        };
      }
      if ("versionIds" in args) {
        const ids = args.versionIds as string[];
        expect(ids).toHaveLength(3);
        expect(ids).toContain("soulVersions:1");
        expect(ids).toContain("soulVersions:2");
        expect(ids).toContain("soulVersions:3");
        return [
          { _id: "soulVersions:1", version: "2.0.0", softDeletedAt: undefined },
          { _id: "soulVersions:2", version: "1.0.0", softDeletedAt: undefined },
          { _id: "soulVersions:3", version: "1.0.0", softDeletedAt: undefined },
        ];
      }
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const response = await __handlers.listSoulsV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/souls"),
    );
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.items[0].tags.latest).toBe("2.0.0");
    expect(json.items[0].tags.stable).toBe("1.0.0");
    expect(json.items[1].tags.latest).toBe("1.0.0");
    const batchCalls = runQuery.mock.calls.filter(
      ([, args]) => args && "versionIds" in (args as Record<string, unknown>),
    );
    expect(batchCalls).toHaveLength(1);
  });

  it("souls get resolves tags using batch query", async () => {
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("slug" in args) {
        return {
          soul: {
            _id: "souls:1",
            slug: "demo-soul",
            displayName: "Demo Soul",
            summary: "s",
            tags: { latest: "soulVersions:1" },
            stats: { downloads: 0, stars: 0, versions: 1, comments: 0 },
            createdAt: 1,
            updatedAt: 2,
          },
          latestVersion: { version: "1.0.0", createdAt: 3, changelog: "c" },
          owner: null,
        };
      }
      if ("versionIds" in args) {
        return [{ _id: "soulVersions:1", version: "1.0.0", softDeletedAt: undefined }];
      }
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const response = await __handlers.soulsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/souls/demo-soul"),
    );
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.soul.tags.latest).toBe("1.0.0");
  });

  it("souls file download loads storage from internal version docs", async () => {
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("slug" in args) {
        return {
          _id: "souls:1",
          slug: "demo-soul",
          displayName: "Demo Soul",
          tags: { latest: "soulVersions:1" },
          latestVersionId: "soulVersions:1",
          softDeletedAt: undefined,
        };
      }
      if ("versionId" in args) {
        return {
          _id: "soulVersions:1",
          version: "1.0.0",
          createdAt: 3,
          changelog: "c",
          files: [
            {
              path: "SOUL.md",
              size: 5,
              storageId: "_storage:1",
              sha256: "abc123",
              contentType: "text/markdown",
            },
          ],
          softDeletedAt: undefined,
        };
      }
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const storageGet = vi.fn().mockResolvedValue({
      text: vi.fn().mockResolvedValue("hello"),
    });
    const response = await __handlers.soulsGetRouterV1Handler(
      makeCtx({
        runQuery,
        runMutation,
        storage: { get: storageGet },
      }),
      new Request("https://example.com/api/v1/souls/demo-soul/file?path=SOUL.md"),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("hello");
    expect(storageGet).toHaveBeenCalledWith("_storage:1");
    expect(runMutation).toHaveBeenCalledWith(internal.soulDownloads.incrementInternal, {
      soulId: "souls:1",
    });
  });

  it("lists skills supports sort aliases", async () => {
    const checks: Array<[string, string]> = [
      ["rating", "stars"],
      ["installs", "installsCurrent"],
      ["installs-all-time", "installsAllTime"],
      ["trending", "trending"],
    ];

    for (const [input, expected] of checks) {
      const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
        if ("sort" in args || "cursor" in args || "limit" in args) {
          expect(args.sort).toBe(expected);
          return { items: [], nextCursor: null };
        }
        return null;
      });
      const runMutation = vi.fn().mockResolvedValue(okRate());
      const response = await __handlers.listSkillsV1Handler(
        makeCtx({ runQuery, runMutation }),
        new Request(`https://example.com/api/v1/skills?sort=${input}`),
      );
      expect(response.status).toBe(200);
    }
  });

  it("lists skills forwards nonSuspiciousOnly", async () => {
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("sort" in args || "cursor" in args || "limit" in args) {
        expect(args.nonSuspiciousOnly).toBe(true);
        return { items: [], nextCursor: null };
      }
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const response = await __handlers.listSkillsV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/skills?nonSuspiciousOnly=true"),
    );
    expect(response.status).toBe(200);
  });

  it("lists skills forwards legacy nonSuspicious alias", async () => {
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("sort" in args || "cursor" in args || "limit" in args) {
        expect(args.nonSuspiciousOnly).toBe(true);
        return { items: [], nextCursor: null };
      }
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const response = await __handlers.listSkillsV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/skills?nonSuspicious=1"),
    );
    expect(response.status).toBe(200);
  });

  it("lists skills prefers canonical nonSuspiciousOnly over legacy alias", async () => {
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("sort" in args || "cursor" in args || "limit" in args) {
        expect(args.nonSuspiciousOnly).toBeUndefined();
        return { items: [], nextCursor: null };
      }
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const response = await __handlers.listSkillsV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/skills?nonSuspiciousOnly=false&nonSuspicious=1"),
    );
    expect(response.status).toBe(200);
  });

  it("get skill returns 404 when missing", async () => {
    const runQuery = vi.fn().mockResolvedValue(null);
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const response = await __handlers.skillsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/skills/missing"),
    );
    expect(response.status).toBe(404);
  });

  it("get skill returns pending-scan message for owner api token", async () => {
    vi.mocked(getOptionalApiTokenUserId).mockResolvedValue("users:1" as never);
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("slug" in args) {
        return {
          _id: "skills:1",
          slug: "demo",
          ownerUserId: "users:1",
          moderationStatus: "hidden",
          moderationReason: "pending.scan",
        };
      }
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const response = await __handlers.skillsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/skills/demo"),
    );
    expect(response.status).toBe(423);
    expect(await response.text()).toContain("security scan is pending");
  });

  it("get skill returns undelete hint for owner soft-deleted skill", async () => {
    vi.mocked(getOptionalApiTokenUserId).mockResolvedValue("users:1" as never);
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("slug" in args) {
        return {
          _id: "skills:1",
          slug: "demo",
          ownerUserId: "users:1",
          softDeletedAt: 1,
          moderationStatus: "hidden",
        };
      }
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const response = await __handlers.skillsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/skills/demo"),
    );
    expect(response.status).toBe(410);
    expect(await response.text()).toContain("clawhub undelete demo");
  });

  it("get skill returns payload", async () => {
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("slug" in args) {
        return {
          skill: {
            _id: "skills:1",
            slug: "demo",
            displayName: "Demo",
            summary: "s",
            tags: { latest: "versions:1" },
            stats: { downloads: 0, stars: 0, versions: 1, comments: 0 },
            createdAt: 1,
            updatedAt: 2,
          },
          latestVersion: {
            version: "1.0.0",
            createdAt: 3,
            changelog: "c",
            files: [],
          },
          owner: { handle: "p", displayName: "Peter", image: null },
          moderationInfo: {
            isSuspicious: true,
            isMalwareBlocked: false,
            verdict: "suspicious",
            reasonCodes: ["suspicious.dynamic_code_execution"],
            summary: "Detected: suspicious.dynamic_code_execution",
            engineVersion: "v2.0.0",
            updatedAt: 4,
          },
        };
      }
      // Batch query for tag resolution
      if ("versionIds" in args) {
        return [{ _id: "versions:1", version: "1.0.0", softDeletedAt: undefined }];
      }
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const response = await __handlers.skillsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/skills/demo"),
    );
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.skill.slug).toBe("demo");
    expect(json.latestVersion.version).toBe("1.0.0");
    expect(json.moderation).toEqual({
      isSuspicious: true,
      isMalwareBlocked: false,
      verdict: "suspicious",
      reasonCodes: ["suspicious.dynamic_code_execution"],
      summary: "Detected: suspicious.dynamic_code_execution",
      engineVersion: "v2.0.0",
      updatedAt: 4,
    });
  });

  it("get moderation returns redacted evidence for public flagged skill", async () => {
    let slugCalls = 0;
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("slug" in args) {
        slugCalls += 1;
        if (slugCalls === 1) {
          return {
            _id: "skills:1",
            slug: "demo",
            ownerUserId: "users:owner",
            moderationFlags: ["flagged.suspicious"],
            moderationVerdict: "suspicious",
            moderationReasonCodes: ["suspicious.dynamic_code_execution"],
            moderationSummary: "Detected: suspicious.dynamic_code_execution",
            moderationEngineVersion: "v2.0.0",
            moderationEvaluatedAt: 5,
            moderationReason: "scanner.llm.suspicious",
            moderationEvidence: [
              {
                code: "suspicious.dynamic_code_execution",
                severity: "critical",
                file: "index.ts",
                line: 3,
                message: "Dynamic code execution detected.",
                evidence: "eval(payload)",
              },
            ],
          };
        }

        return {
          skill: {
            _id: "skills:1",
            slug: "demo",
            displayName: "Demo",
            summary: "s",
            ownerUserId: "users:owner",
            tags: { latest: "versions:1" },
            stats: { downloads: 0, stars: 0, versions: 1, comments: 0 },
            createdAt: 1,
            updatedAt: 2,
          },
          latestVersion: null,
          owner: null,
          moderationInfo: {
            isSuspicious: true,
            isMalwareBlocked: false,
            verdict: "suspicious",
            reasonCodes: ["suspicious.dynamic_code_execution"],
            summary: "Detected: suspicious.dynamic_code_execution",
            engineVersion: "v2.0.0",
            updatedAt: 5,
          },
        };
      }
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.skillsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/skills/demo/moderation"),
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.moderation.legacyReason).toBeNull();
    expect(json.moderation.evidence[0].evidence).toBe("");
  });

  it("get moderation returns full evidence for owner hidden skill", async () => {
    vi.mocked(getOptionalApiTokenUserId).mockResolvedValue("users:owner" as never);
    let slugCalls = 0;
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("userId" in args) {
        return { _id: "users:owner", role: "user" };
      }
      if ("slug" in args) {
        slugCalls += 1;
        if (slugCalls === 1) {
          return {
            _id: "skills:1",
            slug: "demo",
            ownerUserId: "users:owner",
            moderationStatus: "hidden",
            moderationReason: "quality.low",
            moderationFlags: ["flagged.suspicious"],
            moderationVerdict: "suspicious",
            moderationReasonCodes: ["suspicious.dynamic_code_execution"],
            moderationSummary: "Detected: suspicious.dynamic_code_execution",
            moderationEngineVersion: "v2.0.0",
            moderationEvaluatedAt: 5,
            moderationEvidence: [
              {
                code: "suspicious.dynamic_code_execution",
                severity: "critical",
                file: "index.ts",
                line: 3,
                message: "Dynamic code execution detected.",
                evidence: "eval(payload)",
              },
            ],
          };
        }

        return null;
      }
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.skillsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/skills/demo/moderation"),
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.moderation.legacyReason).toBe("quality.low");
    expect(json.moderation.evidence[0].evidence).toBe("eval(payload)");
  });

  it("get moderation returns 404 for clean public skill", async () => {
    let slugCalls = 0;
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("slug" in args) {
        slugCalls += 1;
        if (slugCalls === 1) {
          return {
            _id: "skills:1",
            slug: "demo",
            ownerUserId: "users:owner",
            moderationVerdict: "clean",
            moderationReasonCodes: [],
            moderationEvidence: [],
          };
        }

        return {
          skill: {
            _id: "skills:1",
            slug: "demo",
            displayName: "Demo",
            summary: "s",
            ownerUserId: "users:owner",
            tags: { latest: "versions:1" },
            stats: { downloads: 0, stars: 0, versions: 1, comments: 0 },
            createdAt: 1,
            updatedAt: 2,
          },
          latestVersion: null,
          owner: null,
          moderationInfo: {
            isSuspicious: false,
            isMalwareBlocked: false,
            verdict: "clean",
            reasonCodes: [],
            summary: null,
            engineVersion: null,
            updatedAt: null,
          },
        };
      }
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.skillsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/skills/demo/moderation"),
    );

    expect(response.status).toBe(404);
  });

  it("lists versions", async () => {
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("slug" in args) {
        return {
          skill: { _id: "skills:1", slug: "demo", displayName: "Demo" },
          latestVersion: null,
          owner: { handle: "owner", displayName: "Owner", image: null },
        };
      }
      if ("skillId" in args && "cursor" in args) {
        return {
          items: [
            {
              version: "1.0.0",
              createdAt: 1,
              changelog: "c",
              changelogSource: "user",
              files: [],
            },
          ],
          nextCursor: null,
        };
      }
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const response = await __handlers.skillsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/skills/demo/versions?limit=1"),
    );
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.items[0].version).toBe("1.0.0");
  });

  it("returns 404 for versions when the owner is banned", async () => {
    const runQuery = vi.fn(async () => null);
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const response = await __handlers.skillsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/skills/demo/versions?limit=1"),
    );
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Skill not found");
  });

  it("returns version detail", async () => {
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("slug" in args) {
        return {
          skill: { _id: "skills:1", slug: "demo", displayName: "Demo" },
          latestVersion: null,
          owner: { handle: "owner", displayName: "Owner", image: null },
        };
      }
      if ("skillId" in args && "version" in args) {
        return {
          version: "1.0.0",
          createdAt: 1,
          changelog: "c",
          changelogSource: "auto",
          files: [
            {
              path: "SKILL.md",
              size: 1,
              storageId: "storage:1",
              sha256: "abc",
              contentType: "text/plain",
            },
          ],
        };
      }
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const response = await __handlers.skillsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/skills/demo/versions/1.0.0"),
    );
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.version.files[0].path).toBe("SKILL.md");
  });

  it("returns 404 for version detail when the owner is banned", async () => {
    const runQuery = vi.fn(async () => null);
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const response = await __handlers.skillsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/skills/demo/versions/1.0.0"),
    );
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Skill not found");
  });

  it("returns version detail security from vt analysis", async () => {
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("slug" in args) {
        return {
          skill: { _id: "skills:1", slug: "demo", displayName: "Demo" },
          latestVersion: null,
          owner: { handle: "owner", displayName: "Owner", image: null },
        };
      }
      if ("skillId" in args && "version" in args) {
        return {
          version: "1.0.0",
          createdAt: 1,
          changelog: "c",
          changelogSource: "auto",
          sha256hash: "a".repeat(64),
          vtAnalysis: {
            status: "suspicious",
            source: "code_insight",
            checkedAt: 123,
          },
          files: [],
        };
      }
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const response = await __handlers.skillsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/skills/demo/versions/1.0.0"),
    );
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.version.security.status).toBe("suspicious");
    expect(json.version.security.scanners.vt.normalizedStatus).toBe("suspicious");
    expect(json.version.security.virustotalUrl).toContain("virustotal.com/gui/file/");
  });

  it("keeps hasWarnings true when llm dimensions include non-ok ratings", async () => {
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("slug" in args) {
        return {
          skill: { _id: "skills:1", slug: "demo", displayName: "Demo" },
          latestVersion: null,
          owner: { handle: "owner", displayName: "Owner", image: null },
        };
      }
      if ("skillId" in args && "version" in args) {
        return {
          version: "1.0.0",
          createdAt: 1,
          changelog: "c",
          changelogSource: "auto",
          sha256hash: "a".repeat(64),
          llmAnalysis: {
            status: "completed",
            verdict: "benign",
            checkedAt: 123,
            dimensions: [
              {
                name: "scope_alignment",
                rating: "warn",
                rationale: "broad install footprint",
                evidence: "",
              },
            ],
          },
          files: [],
        };
      }
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const response = await __handlers.skillsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/skills/demo/versions/1.0.0"),
    );
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.version.security.status).toBe("clean");
    expect(json.version.security.hasWarnings).toBe(true);
  });

  it("returns scan payload for latest version", async () => {
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("slug" in args) {
        return {
          skill: {
            _id: "skills:1",
            slug: "demo",
            displayName: "Demo",
            summary: "s",
            tags: { latest: "versions:1" },
            stats: {},
            createdAt: 1,
            updatedAt: 2,
          },
          latestVersion: {
            version: "1.0.0",
            createdAt: 1,
            changelog: "c",
            changelogSource: "auto",
            sha256hash: "b".repeat(64),
            vtAnalysis: {
              status: "clean",
              checkedAt: 111,
            },
            llmAnalysis: {
              status: "completed",
              verdict: "suspicious",
              confidence: "high",
              summary: "s",
              checkedAt: 222,
            },
            files: [],
          },
          owner: { _id: "users:1", handle: "owner", displayName: "Owner" },
          moderationInfo: {
            isPendingScan: false,
            isMalwareBlocked: false,
            isSuspicious: true,
            isHiddenByMod: false,
            isRemoved: false,
          },
        };
      }
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const response = await __handlers.skillsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/skills/demo/scan"),
    );
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.security.status).toBe("suspicious");
    expect(json.security.hasScanResult).toBe(true);
    expect(json.security.scanners.llm.verdict).toBe("suspicious");
    expect(json.moderation.scope).toBe("skill");
    expect(json.moderation.sourceVersion).toEqual({
      version: "1.0.0",
      createdAt: 1,
    });
    expect(json.moderation.matchesRequestedVersion).toBe(true);
    expect(json.moderation.isSuspicious).toBe(true);
  });

  it("treats completed llm analysis without verdict as error", async () => {
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("slug" in args) {
        return {
          skill: {
            _id: "skills:1",
            slug: "demo",
            displayName: "Demo",
            summary: "s",
            tags: { latest: "versions:1" },
            stats: {},
            createdAt: 1,
            updatedAt: 2,
          },
          latestVersion: {
            version: "1.0.0",
            createdAt: 1,
            changelog: "c",
            changelogSource: "auto",
            sha256hash: "c".repeat(64),
            llmAnalysis: {
              status: "completed",
              summary: "missing verdict",
              checkedAt: 222,
            },
            files: [],
          },
          owner: { _id: "users:1", handle: "owner", displayName: "Owner" },
          moderationInfo: {
            isPendingScan: false,
            isMalwareBlocked: false,
            isSuspicious: false,
            isHiddenByMod: false,
            isRemoved: false,
          },
        };
      }
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const response = await __handlers.skillsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/skills/demo/scan"),
    );
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.security.status).toBe("error");
    expect(json.security.hasScanResult).toBe(false);
    expect(json.security.scanners.llm.normalizedStatus).toBe("error");
  });

  it("keeps hasScanResult true when one scanner returns a definitive verdict", async () => {
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("slug" in args) {
        return {
          skill: {
            _id: "skills:1",
            slug: "demo",
            displayName: "Demo",
            summary: "s",
            tags: { latest: "versions:2" },
            stats: {},
            createdAt: 1,
            updatedAt: 2,
          },
          latestVersion: {
            _id: "skillVersions:2",
            version: "2.0.0",
            createdAt: 2,
            changelog: "c",
            changelogSource: "auto",
            sha256hash: "d".repeat(64),
            vtAnalysis: {
              status: "clean",
              checkedAt: 111,
            },
            llmAnalysis: {
              status: "error",
              summary: "scanner failed",
              checkedAt: 222,
            },
            files: [],
          },
          owner: { _id: "users:1", handle: "owner", displayName: "Owner" },
          moderationInfo: {
            isPendingScan: false,
            isMalwareBlocked: false,
            isSuspicious: false,
            isHiddenByMod: false,
            isRemoved: false,
          },
        };
      }
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const response = await __handlers.skillsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/skills/demo/scan"),
    );
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.security.status).toBe("error");
    expect(json.security.hasScanResult).toBe(true);
    expect(json.security.scanners.vt.normalizedStatus).toBe("clean");
    expect(json.security.scanners.llm.normalizedStatus).toBe("error");
  });

  it("marks moderation as a latest-version snapshot when querying a historical version", async () => {
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("slug" in args) {
        return {
          skill: {
            _id: "skills:1",
            slug: "demo",
            displayName: "Demo",
            summary: "s",
            tags: { latest: "skillVersions:2", old: "skillVersions:1" },
            stats: {},
            createdAt: 1,
            updatedAt: 2,
          },
          latestVersion: {
            _id: "skillVersions:2",
            version: "2.0.0",
            createdAt: 2,
            changelog: "c2",
            changelogSource: "auto",
            sha256hash: "e".repeat(64),
            vtAnalysis: {
              status: "clean",
              checkedAt: 222,
            },
            files: [],
          },
          owner: { _id: "users:1", handle: "owner", displayName: "Owner" },
          moderationInfo: {
            isPendingScan: false,
            isMalwareBlocked: false,
            isSuspicious: false,
            isHiddenByMod: false,
            isRemoved: false,
          },
        };
      }
      if ("skillId" in args && "version" in args) {
        return {
          _id: "skillVersions:1",
          version: "1.0.0",
          createdAt: 1,
          changelog: "c1",
          changelogSource: "auto",
          sha256hash: "f".repeat(64),
          llmAnalysis: {
            status: "completed",
            verdict: "suspicious",
            checkedAt: 123,
          },
          files: [],
        };
      }
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const response = await __handlers.skillsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/skills/demo/scan?version=1.0.0"),
    );
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.version.version).toBe("1.0.0");
    expect(json.security.status).toBe("suspicious");
    expect(json.moderation.scope).toBe("skill");
    expect(json.moderation.sourceVersion).toEqual({
      version: "2.0.0",
      createdAt: 2,
    });
    expect(json.moderation.matchesRequestedVersion).toBe(false);
    expect(json.moderation.isSuspicious).toBe(false);
  });

  it("resolves scan by tag and reports moderation context against latest version", async () => {
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("slug" in args) {
        return {
          skill: {
            _id: "skills:1",
            slug: "demo",
            displayName: "Demo",
            summary: "s",
            tags: { latest: "skillVersions:2", old: "skillVersions:1" },
            stats: {},
            createdAt: 1,
            updatedAt: 2,
          },
          latestVersion: {
            _id: "skillVersions:2",
            version: "2.0.0",
            createdAt: 2,
            changelog: "c2",
            changelogSource: "auto",
            sha256hash: "1".repeat(64),
            vtAnalysis: {
              status: "clean",
              checkedAt: 222,
            },
            files: [],
          },
          owner: { _id: "users:1", handle: "owner", displayName: "Owner" },
          moderationInfo: {
            isPendingScan: false,
            isMalwareBlocked: false,
            isSuspicious: false,
            isHiddenByMod: false,
            isRemoved: false,
          },
        };
      }
      if ("versionId" in args) {
        return {
          _id: "skillVersions:1",
          version: "1.0.0",
          createdAt: 1,
          changelog: "c1",
          changelogSource: "auto",
          sha256hash: "2".repeat(64),
          vtAnalysis: {
            status: "malicious",
            checkedAt: 123,
          },
          files: [],
        };
      }
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const response = await __handlers.skillsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/skills/demo/scan?tag=old"),
    );
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.version.version).toBe("1.0.0");
    expect(json.security.status).toBe("malicious");
    expect(json.moderation.sourceVersion).toEqual({
      version: "2.0.0",
      createdAt: 2,
    });
    expect(json.moderation.matchesRequestedVersion).toBe(false);
  });

  it("returns raw file content", async () => {
    const internalVersion = {
      version: "1.0.0",
      createdAt: 1,
      changelog: "c",
      files: [
        {
          path: "SKILL.md",
          size: 5,
          storageId: "storage:1",
          sha256: "abcd",
          contentType: "text/plain",
        },
      ],
      softDeletedAt: undefined,
    };
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("slug" in args) {
        return {
          skill: {
            _id: "skills:1",
            slug: "demo",
            displayName: "Demo",
            summary: "s",
            tags: {},
            stats: {},
            createdAt: 1,
            updatedAt: 2,
            latestVersionId: "skillVersions:1",
          },
          latestVersion: { _id: "skillVersions:1", version: "1.0.0" },
          owner: null,
        };
      }
      if ("versionId" in args) {
        return internalVersion;
      }
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const storage = {
      get: vi.fn().mockResolvedValue(new Blob(["hello"], { type: "text/plain" })),
    };
    const response = await __handlers.skillsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation, storage }),
      new Request("https://example.com/api/v1/skills/demo/file?path=SKILL.md"),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("hello");
    expect(response.headers.get("X-Content-SHA256")).toBe("abcd");
  });

  it("returns 413 when raw file too large", async () => {
    const internalVersion = {
      version: "1.0.0",
      createdAt: 1,
      changelog: "c",
      files: [
        {
          path: "SKILL.md",
          size: 210 * 1024,
          storageId: "storage:1",
          sha256: "abcd",
          contentType: "text/plain",
        },
      ],
      softDeletedAt: undefined,
    };
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("slug" in args) {
        return {
          skill: {
            _id: "skills:1",
            slug: "demo",
            displayName: "Demo",
            summary: "s",
            tags: {},
            stats: {},
            createdAt: 1,
            updatedAt: 2,
            latestVersionId: "skillVersions:1",
          },
          latestVersion: { _id: "skillVersions:1", version: "1.0.0" },
          owner: null,
        };
      }
      if ("versionId" in args) {
        return internalVersion;
      }
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const response = await __handlers.skillsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation, storage: { get: vi.fn() } }),
      new Request("https://example.com/api/v1/skills/demo/file?path=SKILL.md"),
    );
    expect(response.status).toBe(413);
  });

  it("publish json succeeds", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValueOnce({
      userId: "users:1",
      user: { handle: "p" },
    } as never);
    vi.mocked(publishVersionForUser).mockResolvedValueOnce({
      skillId: "s",
      versionId: "v",
      embeddingId: "e",
    } as never);
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const body = JSON.stringify({
      slug: "demo",
      displayName: "Demo",
      version: "1.0.0",
      changelog: "c",
      acceptLicenseTerms: true,
      files: [
        {
          path: "SKILL.md",
          size: 1,
          storageId: "storage:1",
          sha256: "abc",
          contentType: "text/plain",
        },
      ],
    });
    const response = await __handlers.publishSkillV1Handler(
      makeCtx({ runMutation }),
      new Request("https://example.com/api/v1/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer clh_test" },
        body,
      }),
    );
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.ok).toBe(true);
    expect(publishVersionForUser).toHaveBeenCalled();
  });

  it("publish json accepts legacy clients that omit license terms", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValueOnce({
      userId: "users:1",
      user: { handle: "p" },
    } as never);
    vi.mocked(publishVersionForUser).mockResolvedValueOnce({
      skillId: "s",
      versionId: "v",
      embeddingId: "e",
    } as never);
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const body = JSON.stringify({
      slug: "demo",
      displayName: "Demo",
      version: "1.0.0",
      changelog: "c",
      files: [
        {
          path: "SKILL.md",
          size: 1,
          storageId: "storage:1",
          sha256: "abc",
          contentType: "text/plain",
        },
      ],
    });
    const response = await __handlers.publishSkillV1Handler(
      makeCtx({ runMutation }),
      new Request("https://example.com/api/v1/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer clh_test" },
        body,
      }),
    );
    expect(response.status).toBe(200);
  });

  it("publish multipart succeeds", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValueOnce({
      userId: "users:1",
      user: { handle: "p" },
    } as never);
    vi.mocked(publishVersionForUser).mockResolvedValueOnce({
      skillId: "s",
      versionId: "v",
      embeddingId: "e",
    } as never);
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const form = new FormData();
    form.set(
      "payload",
      JSON.stringify({
        slug: "demo",
        displayName: "Demo",
        version: "1.0.0",
        changelog: "",
        acceptLicenseTerms: true,
        tags: ["latest"],
      }),
    );
    form.append("files", new Blob(["hello"], { type: "text/plain" }), "SKILL.md");
    const response = await __handlers.publishSkillV1Handler(
      makeCtx({ runMutation, storage: { store: vi.fn().mockResolvedValue("storage:1") } }),
      new Request("https://example.com/api/v1/skills", {
        method: "POST",
        headers: { Authorization: "Bearer clh_test" },
        body: form,
      }),
    );
    if (response.status !== 200) {
      throw new Error(await response.text());
    }
  });

  it("publish multipart accepts legacy clients that omit license terms", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValueOnce({
      userId: "users:1",
      user: { handle: "p" },
    } as never);
    vi.mocked(publishVersionForUser).mockResolvedValueOnce({
      skillId: "s",
      versionId: "v",
      embeddingId: "e",
    } as never);
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const form = new FormData();
    form.set(
      "payload",
      JSON.stringify({
        slug: "demo",
        displayName: "Demo",
        version: "1.0.0",
        changelog: "",
        tags: ["latest"],
      }),
    );
    form.append("files", new Blob(["hello"], { type: "text/plain" }), "SKILL.md");
    const response = await __handlers.publishSkillV1Handler(
      makeCtx({ runMutation, storage: { store: vi.fn().mockResolvedValue("storage:1") } }),
      new Request("https://example.com/api/v1/skills", {
        method: "POST",
        headers: { Authorization: "Bearer clh_test" },
        body: form,
      }),
    );
    expect(response.status).toBe(200);
  });

  it("publish rejects explicit license refusal", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValueOnce({
      userId: "users:1",
      user: { handle: "p" },
    } as never);
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const body = JSON.stringify({
      slug: "demo",
      displayName: "Demo",
      version: "1.0.0",
      changelog: "c",
      acceptLicenseTerms: false,
      files: [
        {
          path: "SKILL.md",
          size: 1,
          storageId: "storage:1",
          sha256: "abc",
          contentType: "text/plain",
        },
      ],
    });
    const response = await __handlers.publishSkillV1Handler(
      makeCtx({ runMutation }),
      new Request("https://example.com/api/v1/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer clh_test" },
        body,
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toMatch(/license terms must be accepted/i);
  });

  it("publish multipart ignores mac junk files", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValueOnce({
      userId: "users:1",
      user: { handle: "p" },
    } as never);
    vi.mocked(publishVersionForUser).mockResolvedValueOnce({
      skillId: "s",
      versionId: "v",
      embeddingId: "e",
    } as never);
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const store = vi.fn().mockResolvedValue("storage:1");
    const form = new FormData();
    form.set(
      "payload",
      JSON.stringify({
        slug: "demo",
        displayName: "Demo",
        version: "1.0.0",
        changelog: "",
        acceptLicenseTerms: true,
        tags: ["latest"],
      }),
    );
    form.append("files", new Blob(["hello"], { type: "text/plain" }), "SKILL.md");
    form.append("files", new Blob(["junk"], { type: "application/octet-stream" }), ".DS_Store");
    const response = await __handlers.publishSkillV1Handler(
      makeCtx({ runMutation, storage: { store } }),
      new Request("https://example.com/api/v1/skills", {
        method: "POST",
        headers: { Authorization: "Bearer clh_test" },
        body: form,
      }),
    );
    if (response.status !== 200) {
      throw new Error(await response.text());
    }

    expect(store).toHaveBeenCalledTimes(1);
    const publishArgs = vi.mocked(publishVersionForUser).mock.calls[0]?.[2] as
      | { files?: Array<{ path: string }> }
      | undefined;
    expect(publishArgs?.files?.map((file) => file.path)).toEqual(["SKILL.md"]);
  });

  it("publish rejects missing token", async () => {
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const response = await __handlers.publishSkillV1Handler(
      makeCtx({ runMutation }),
      new Request("https://example.com/api/v1/skills", { method: "POST" }),
    );
    expect(response.status).toBe(401);
  });

  it("whoami returns user payload", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValueOnce({
      userId: "users:1",
      user: { handle: "p", displayName: "Peter", image: null },
    } as never);
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const response = await __handlers.whoamiV1Handler(
      makeCtx({ runMutation }),
      new Request("https://example.com/api/v1/whoami", {
        headers: { Authorization: "Bearer clh_test" },
      }),
    );
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.user.handle).toBe("p");
  });

  it("delete and undelete require auth", async () => {
    vi.mocked(requireApiTokenUser).mockRejectedValueOnce(new Error("Unauthorized"));
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const response = await __handlers.skillsDeleteRouterV1Handler(
      makeCtx({ runMutation }),
      new Request("https://example.com/api/v1/skills/demo", { method: "DELETE" }),
    );
    expect(response.status).toBe(401);

    vi.mocked(requireApiTokenUser).mockRejectedValueOnce(new Error("Unauthorized"));
    const response2 = await __handlers.skillsPostRouterV1Handler(
      makeCtx({ runMutation }),
      new Request("https://example.com/api/v1/skills/demo/undelete", { method: "POST" }),
    );
    expect(response2.status).toBe(401);
  });

  it("delete and undelete succeed", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:1",
      user: { handle: "p" },
    } as never);
    const runMutation = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("key" in args) return okRate();
      return { ok: true };
    });

    const response = await __handlers.skillsDeleteRouterV1Handler(
      makeCtx({ runMutation }),
      new Request("https://example.com/api/v1/skills/demo", {
        method: "DELETE",
        headers: { Authorization: "Bearer clh_test" },
      }),
    );
    expect(response.status).toBe(200);

    const response2 = await __handlers.skillsPostRouterV1Handler(
      makeCtx({ runMutation }),
      new Request("https://example.com/api/v1/skills/demo/undelete", {
        method: "POST",
        headers: { Authorization: "Bearer clh_test" },
      }),
    );
    expect(response2.status).toBe(200);
  });

  it("transfer request requires auth", async () => {
    vi.mocked(requireApiTokenUser).mockRejectedValueOnce(new Error("Unauthorized"));
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const response = await __handlers.skillsPostRouterV1Handler(
      makeCtx({ runMutation }),
      new Request("https://example.com/api/v1/skills/demo/transfer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ toUserHandle: "alice" }),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("transfer request succeeds", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:1",
      user: { handle: "p" },
    } as never);

    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("slug" in args) return { _id: "skills:1", slug: "demo" };
      return null;
    });
    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if ("key" in args) return okRate();
      return {
        ok: true,
        transferId: "skillOwnershipTransfers:1",
        toUserHandle: "alice",
        expiresAt: 123,
      };
    });

    const response = await __handlers.skillsPostRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/skills/demo/transfer", {
        method: "POST",
        headers: { Authorization: "Bearer clh_test", "content-type": "application/json" },
        body: JSON.stringify({ toUserHandle: "@Alice" }),
      }),
    );
    expect(response.status).toBe(200);
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorUserId: "users:1",
        skillId: "skills:1",
        toUserHandle: "@Alice",
      }),
    );
  });

  it("transfer accept returns 404 when no pending request exists", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:1",
      user: { handle: "p" },
    } as never);

    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("slug" in args) return { _id: "skills:1", slug: "demo" };
      return null;
    });
    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if ("key" in args) return okRate();
      return { ok: true };
    });

    const response = await __handlers.skillsPostRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/skills/demo/transfer/accept", {
        method: "POST",
        headers: { Authorization: "Bearer clh_test" },
      }),
    );
    expect(response.status).toBe(404);
  });

  it("rename endpoint forwards to renameOwnedSkillInternal", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:1",
      user: { handle: "p" },
    } as never);

    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if ("key" in args) return okRate();
      return { ok: true, slug: "demo-new", previousSlug: "demo" };
    });

    const response = await __handlers.skillsPostRouterV1Handler(
      makeCtx({ runMutation }),
      new Request("https://example.com/api/v1/skills/demo/rename", {
        method: "POST",
        headers: { Authorization: "Bearer clh_test", "content-type": "application/json" },
        body: JSON.stringify({ newSlug: "demo-new" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorUserId: "users:1",
        slug: "demo",
        newSlug: "demo-new",
      }),
    );
  });

  it("merge endpoint forwards to mergeOwnedSkillIntoCanonicalInternal", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:1",
      user: { handle: "p" },
    } as never);

    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if ("key" in args) return okRate();
      return { ok: true, sourceSlug: "demo-old", targetSlug: "demo" };
    });

    const response = await __handlers.skillsPostRouterV1Handler(
      makeCtx({ runMutation }),
      new Request("https://example.com/api/v1/skills/demo-old/merge", {
        method: "POST",
        headers: { Authorization: "Bearer clh_test", "content-type": "application/json" },
        body: JSON.stringify({ targetSlug: "demo" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorUserId: "users:1",
        sourceSlug: "demo-old",
        targetSlug: "demo",
      }),
    );
  });

  it("transfer list returns incoming transfers", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:1",
      user: { handle: "p" },
    } as never);

    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate();
      if ("userId" in args) {
        return [
          {
            _id: "skillOwnershipTransfers:1",
            skill: { _id: "skills:1", slug: "demo", displayName: "Demo" },
            fromUser: { _id: "users:2", handle: "alice", displayName: "Alice" },
            requestedAt: 100,
            expiresAt: 200,
          },
        ];
      }
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.transfersGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/transfers/incoming", {
        method: "GET",
        headers: { Authorization: "Bearer clh_test" },
      }),
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.transfers).toHaveLength(1);
    expect(payload.transfers[0]?.skill?.slug).toBe("demo");
  });

  it("ban user requires auth", async () => {
    vi.mocked(requireApiTokenUser).mockRejectedValueOnce(new Error("Unauthorized"));
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const response = await __handlers.usersPostRouterV1Handler(
      makeCtx({ runMutation }),
      new Request("https://example.com/api/v1/users/ban", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: "demo" }),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("ban user succeeds with handle", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:1",
      user: { handle: "p" },
    } as never);
    const runQuery = vi.fn().mockResolvedValue({ _id: "users:2" });
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce(okRate())
      .mockResolvedValueOnce({ ok: true, alreadyBanned: false, deletedSkills: 2 });
    const response = await __handlers.usersPostRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/users/ban", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: "demo" }),
      }),
    );
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.deletedSkills).toBe(2);
  });

  it("ban user forwards reason", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:1",
      user: { handle: "p" },
    } as never);
    const runQuery = vi.fn().mockResolvedValue({ _id: "users:2" });
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce(okRate())
      .mockResolvedValueOnce({ ok: true, alreadyBanned: false, deletedSkills: 0 });
    await __handlers.usersPostRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/users/ban", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: "demo", reason: "malware" }),
      }),
    );
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorUserId: "users:1",
        targetUserId: "users:2",
        reason: "malware",
      }),
    );
  });

  it("set role requires auth", async () => {
    vi.mocked(requireApiTokenUser).mockRejectedValueOnce(new Error("Unauthorized"));
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const response = await __handlers.usersPostRouterV1Handler(
      makeCtx({ runMutation }),
      new Request("https://example.com/api/v1/users/role", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: "demo", role: "moderator" }),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("set role succeeds with handle", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:1",
      user: { handle: "p" },
    } as never);
    const runQuery = vi.fn().mockResolvedValue({ _id: "users:2" });
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce(okRate())
      .mockResolvedValueOnce({ ok: true, role: "moderator" });
    const response = await __handlers.usersPostRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/users/role", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: "demo", role: "moderator" }),
      }),
    );
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.role).toBe("moderator");
  });

  it("stars require auth", async () => {
    vi.mocked(requireApiTokenUser).mockRejectedValueOnce(new Error("Unauthorized"));
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const response = await __handlers.starsPostRouterV1Handler(
      makeCtx({ runMutation }),
      new Request("https://example.com/api/v1/stars/demo", { method: "POST" }),
    );
    expect(response.status).toBe(401);
  });

  it("stars add succeeds", async () => {
    vi.mocked(getOptionalApiTokenUserId).mockResolvedValue("users:1" as never);
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:1",
      user: { handle: "p" },
    } as never);
    const runQuery = vi.fn().mockResolvedValue({ _id: "skills:1" });
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce(okRate())
      .mockResolvedValueOnce({ ok: true, starred: true, alreadyStarred: false });
    const response = await __handlers.starsPostRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/stars/demo", {
        method: "POST",
        headers: { Authorization: "Bearer clh_test" },
      }),
    );
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.ok).toBe(true);
    expect(json.starred).toBe(true);
  });

  it("stars delete succeeds", async () => {
    vi.mocked(getOptionalApiTokenUserId).mockResolvedValue("users:1" as never);
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:1",
      user: { handle: "p" },
    } as never);
    const runQuery = vi.fn().mockResolvedValue({ _id: "skills:1" });
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce(okRate())
      .mockResolvedValueOnce({ ok: true, unstarred: true, alreadyUnstarred: false });
    const response = await __handlers.starsDeleteRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/stars/demo", {
        method: "DELETE",
        headers: { Authorization: "Bearer clh_test" },
      }),
    );
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.ok).toBe(true);
    expect(json.unstarred).toBe(true);
  });

  it("packages search forwards executesCode and capabilityTag", async () => {
    const runQuery = vi.fn().mockResolvedValue([]);
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const response = await __handlers.packagesGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request(
        "https://example.com/api/v1/packages/search?q=test&executesCode=true&capabilityTag=tools&limit=5",
      ),
    );
    if (response.status !== 200) throw new Error(await response.text());
    expect(runQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        query: "test",
        limit: 5,
        executesCode: true,
        capabilityTag: "tools",
      }),
    );
    expect(findRateLimitCallArgs(runMutation)).toMatchObject({
      key: expect.stringMatching(/^ip:/),
      limit: RATE_LIMITS.read.ip,
    });
    expect(response.headers.get("RateLimit-Limit")).toBeTruthy();
  });

  it("packages list supports family=skill on the generic route", async () => {
    const runQuery = vi.fn().mockResolvedValue({ page: [], isDone: true, continueCursor: "" });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.listPackagesV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/packages?family=skill&limit=7"),
    );

    expect(response.status).toBe(200);
    expect(runQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        paginationOpts: { cursor: null, numItems: 7 },
      }),
    );
  });

  it("packages search supports family=skill on the generic route", async () => {
    const runQuery = vi.fn().mockResolvedValue([]);
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.packagesGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/packages/search?q=demo&family=skill"),
    );

    expect(response.status).toBe(200);
    expect(runQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        query: "demo",
      }),
    );
  });

  it("packages list forwards viewerUserId for authenticated private package browsing", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);
    const runQuery = vi.fn().mockResolvedValue({ page: [], isDone: true, continueCursor: "" });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.listPackagesV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/packages?channel=private&limit=7"),
    );

    expect(response.status).toBe(200);
    expect(runQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        channel: "private",
        viewerUserId: "users:owner",
        paginationOpts: { cursor: null, numItems: 7 },
      }),
    );
  });

  it("packages search forwards viewerUserId for authenticated private package search", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);
    const runQuery = vi.fn().mockResolvedValue([]);
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.packagesGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/packages/search?q=secret&channel=private"),
    );

    expect(response.status).toBe(200);
    expect(runQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        query: "secret",
        channel: "private",
        viewerUserId: "users:owner",
      }),
    );
  });

  it("packages list falls back to anonymous when cookie auth resolution fails", async () => {
    vi.mocked(getAuthUserId).mockRejectedValue(new Error("stale session"));
    const runQuery = vi.fn().mockResolvedValue({ page: [], isDone: true, continueCursor: "" });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.listPackagesV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/packages?isOfficial=true&limit=7"),
    );

    expect(response.status).toBe(200);
    expect(runQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        isOfficial: true,
        viewerUserId: undefined,
        paginationOpts: { cursor: null, numItems: 7 },
      }),
    );
  });

  it("packages detail falls back to public skills", async () => {
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("name" in args) return null;
      if ("slug" in args) {
        return {
          skill: {
            _id: "skills:demo",
            slug: "demo",
            displayName: "Demo Skill",
            summary: "Skill summary",
            latestVersionId: "skillVersions:demo-1",
            tags: { latest: "skillVersions:demo-1" },
            badges: {},
            createdAt: 1,
            updatedAt: 2,
          },
          latestVersion: {
            _id: "skillVersions:demo-1",
            skillId: "skills:demo",
            version: "1.0.0",
            createdAt: 3,
            changelog: "init",
            files: [],
          },
          owner: { handle: "steipete", displayName: "Peter" },
        };
      }
      if ("versionIds" in args) {
        return [{ _id: "skillVersions:demo-1", version: "1.0.0" }];
      }
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.packagesGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/packages/demo"),
    );

    if (response.status !== 200) throw new Error(await response.text());
    await expect(response.json()).resolves.toMatchObject({
      package: {
        name: "demo",
        family: "skill",
        latestVersion: "1.0.0",
        channel: "community",
      },
      owner: {
        handle: "steipete",
      },
    });
  });

  it("packages file serves SKILL.md for skill README requests", async () => {
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("name" in args) return null;
      if ("slug" in args) {
        return {
          skill: {
            _id: "skills:demo",
            slug: "demo",
            displayName: "Demo Skill",
            summary: "Skill summary",
            latestVersionId: "skillVersions:demo-1",
            tags: { latest: "skillVersions:demo-1" },
            badges: {},
            createdAt: 1,
            updatedAt: 2,
          },
          latestVersion: null,
          owner: { handle: "steipete" },
        };
      }
      if ("versionId" in args) {
        return {
          _id: "skillVersions:demo-1",
          skillId: "skills:demo",
          version: "1.0.0",
          createdAt: 3,
          changelog: "init",
          files: [
            {
              path: "SKILL.md",
              size: 11,
              sha256: "abc",
              storageId: "storage:skill",
              contentType: "text/markdown",
            },
          ],
        };
      }
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const storage = {
      get: vi.fn().mockResolvedValue(new Blob(["# Demo skill"])),
    };

    const response = await __handlers.packagesGetRouterV1Handler(
      makeCtx({ runQuery, runMutation, storage }),
      new Request("https://example.com/api/v1/packages/demo/file?path=README.md"),
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("# Demo skill");
    expect(storage.get).toHaveBeenCalledWith("storage:skill");
  });

  it("packages download redirects skills to the skill download endpoint", async () => {
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("name" in args) return null;
      if ("slug" in args) {
        return {
          skill: {
            _id: "skills:demo",
            slug: "demo",
            displayName: "Demo Skill",
            summary: "Skill summary",
            latestVersionId: "skillVersions:demo-1",
            tags: { latest: "skillVersions:demo-1" },
            badges: {},
            createdAt: 1,
            updatedAt: 2,
          },
          latestVersion: null,
          owner: { handle: "steipete" },
        };
      }
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.packagesGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/packages/demo/download?version=1.0.0"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("Location")).toBe(
      "https://example.com/api/v1/download?slug=demo&version=1.0.0",
    );
  });

  it("packages detail hides private packages from anonymous requests", async () => {
    vi.mocked(getOptionalApiTokenUserId).mockResolvedValue(null);
    const runQuery = vi.fn().mockResolvedValue(null);
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.packagesGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/packages/private-plugin"),
    );

    expect(response.status).toBe(404);
    expect(runQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        name: "private-plugin",
        viewerUserId: undefined,
      }),
    );
  });

  it("packages detail allows private packages for browser-session owners", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);
    const runQuery = vi.fn().mockResolvedValue({
      package: {
        _id: "packages:private",
        name: "private-plugin",
        displayName: "Private Plugin",
        family: "code-plugin",
        tags: {},
        latestReleaseId: "packageReleases:1",
        channel: "private",
        isOfficial: false,
        createdAt: 1,
        updatedAt: 1,
      },
      latestRelease: null,
      owner: { _id: "users:owner", handle: "owner" },
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.packagesGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/packages/private-plugin"),
    );

    expect(response.status).toBe(200);
    expect(runQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        name: "private-plugin",
        viewerUserId: "users:owner",
      }),
    );
  });

  it("packages version detail returns security scan fields for plugins", async () => {
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("name" in args && !("version" in args)) {
        return {
          package: {
            _id: "packages:demo-plugin",
            name: "demo-plugin",
            displayName: "Demo Plugin",
            family: "code-plugin",
            tags: { latest: "packageReleases:1" },
            latestReleaseId: "packageReleases:1",
            channel: "community",
            isOfficial: false,
            createdAt: 1,
            updatedAt: 1,
          },
          latestRelease: null,
          owner: { _id: "publishers:demo", handle: "demo" },
        };
      }
      if ("name" in args && "version" in args) {
        return {
          package: {
            _id: "packages:demo-plugin",
            name: "demo-plugin",
            displayName: "Demo Plugin",
            family: "code-plugin",
          },
          version: {
            _id: "packageReleases:1",
            packageId: "packages:demo-plugin",
            version: "1.0.0",
            createdAt: 1,
            changelog: "Initial release",
            distTags: ["latest"],
            files: [
              {
                path: "README.md",
                size: 10,
                sha256: "file-sha",
                storageId: "storage:1",
                contentType: "text/markdown",
              },
            ],
            verification: {
              tier: "source-linked",
              scope: "artifact-only",
              scanStatus: "clean",
            },
            sha256hash: "a".repeat(64),
            vtAnalysis: {
              status: "clean",
              verdict: "benign",
              checkedAt: 1,
            },
            llmAnalysis: {
              status: "clean",
              verdict: "clean",
              summary: "Looks safe.",
              checkedAt: 1,
            },
            staticScan: {
              status: "clean",
              reasonCodes: [],
              findings: [],
              summary: "No issues",
              engineVersion: "1",
              checkedAt: 1,
            },
          },
        };
      }
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.packagesGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/packages/demo-plugin/versions/1.0.0"),
    );

    if (response.status !== 200) throw new Error(await response.text());
    await expect(response.json()).resolves.toMatchObject({
      package: {
        name: "demo-plugin",
        family: "code-plugin",
      },
      version: {
        version: "1.0.0",
        sha256hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        vtAnalysis: {
          status: "clean",
          verdict: "benign",
        },
        llmAnalysis: {
          status: "clean",
          verdict: "clean",
        },
        staticScan: {
          status: "clean",
          summary: "No issues",
        },
      },
    });
  });

  it("treats /packages/search without q as a package detail route", async () => {
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("name" in args) {
        return {
          package: {
            _id: "packages:search",
            name: "search",
            displayName: "Search Package",
            family: "code-plugin",
            tags: {},
            latestReleaseId: null,
            channel: "community",
            isOfficial: false,
            createdAt: 1,
            updatedAt: 1,
          },
          latestRelease: null,
          owner: null,
        };
      }
      return [];
    });

    const response = await __handlers.packagesGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/packages/search"),
    );

    expect(response.status).toBe(200);
    expect(runQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        name: "search",
      }),
    );
    expect(runQuery).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        query: expect.any(String),
      }),
    );
  });

  it("package download uses download rate limiting", async () => {
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("name" in args) {
        return {
          package: {
            _id: "packages:1",
            name: "demo-plugin",
            displayName: "Demo Plugin",
            family: "code-plugin",
            tags: {},
            latestReleaseId: "packageReleases:1",
            channel: "community",
            isOfficial: false,
            createdAt: 1,
            updatedAt: 1,
          },
          latestRelease: null,
          owner: null,
        };
      }
      if ("releaseId" in args) {
        return {
          _id: "packageReleases:1",
          version: "1.0.0",
          createdAt: 1,
          changelog: "init",
          files: [
            {
              path: "package.json",
              size: 2,
              sha256: "a".repeat(64),
              storageId: "storage:1",
              contentType: "application/json",
            },
          ],
        };
      }
      return null;
    });

    const response = await __handlers.packagesGetRouterV1Handler(
      makeCtx({
        runQuery,
        runMutation,
        storage: {
          get: vi.fn().mockResolvedValue(new Blob(["{}"], { type: "application/json" })),
        },
      }),
      new Request("https://example.com/api/v1/packages/demo-plugin/download"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("RateLimit-Limit")).toBeTruthy();
    expect(findRateLimitCallArgs(runMutation)).toMatchObject({
      key: expect.stringMatching(/^ip:/),
      limit: RATE_LIMITS.download.ip,
    });
  });

  it("package file uses read rate limiting", async () => {
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("name" in args) {
        return {
          package: {
            _id: "packages:1",
            name: "demo-plugin",
            displayName: "Demo Plugin",
            family: "code-plugin",
            tags: {},
            latestReleaseId: "packageReleases:1",
            channel: "community",
            isOfficial: false,
            createdAt: 1,
            updatedAt: 1,
          },
          latestRelease: null,
          owner: null,
        };
      }
      if ("releaseId" in args) {
        return {
          _id: "packageReleases:1",
          version: "1.0.0",
          createdAt: 1,
          changelog: "init",
          files: [
            {
              path: "README.md",
              size: 5,
              sha256: "a".repeat(64),
              storageId: "storage:1",
              contentType: "text/markdown",
            },
          ],
        };
      }
      return null;
    });

    const response = await __handlers.packagesGetRouterV1Handler(
      makeCtx({
        runQuery,
        runMutation,
        storage: {
          get: vi.fn().mockResolvedValue(new Blob(["hello"], { type: "text/markdown" })),
        },
      }),
      new Request("https://example.com/api/v1/packages/demo-plugin/file?path=README.md"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("RateLimit-Limit")).toBeTruthy();
    expect(findRateLimitCallArgs(runMutation)).toMatchObject({
      key: expect.stringMatching(/^ip:/),
      limit: RATE_LIMITS.read.ip,
    });
  });

  it("package file resolves lowercase readme variants from the canonical request path", async () => {
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("name" in args) {
        return {
          package: {
            _id: "packages:1",
            name: "demo-plugin",
            displayName: "Demo Plugin",
            family: "code-plugin",
            tags: {},
            latestReleaseId: "packageReleases:1",
            channel: "community",
            isOfficial: false,
            createdAt: 1,
            updatedAt: 1,
          },
          latestRelease: null,
          owner: null,
        };
      }
      if ("releaseId" in args) {
        return {
          _id: "packageReleases:1",
          version: "1.0.0",
          createdAt: 1,
          changelog: "init",
          files: [
            {
              path: "readme.md",
              size: 5,
              sha256: "a".repeat(64),
              storageId: "storage:1",
              contentType: "text/markdown",
            },
          ],
        };
      }
      return null;
    });

    const response = await __handlers.packagesGetRouterV1Handler(
      makeCtx({
        runQuery,
        runMutation,
        storage: {
          get: vi.fn().mockResolvedValue(new Blob(["hello"], { type: "text/markdown" })),
        },
      }),
      new Request("https://example.com/api/v1/packages/demo-plugin/file?path=README.md"),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("hello");
  });

  it("package download uses a package/ root without registry metadata", async () => {
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("name" in args) {
        return {
          package: {
            _id: "packages:1",
            name: "demo-plugin",
            displayName: "Demo Plugin",
            family: "code-plugin",
            tags: {},
            latestReleaseId: "packageReleases:1",
            channel: "community",
            isOfficial: false,
            createdAt: 1,
            updatedAt: 1,
          },
          latestRelease: null,
          owner: { _id: "users:owner", handle: "owner" },
        };
      }
      if ("releaseId" in args) {
        return {
          _id: "packageReleases:1",
          version: "1.0.0",
          createdAt: 1,
          changelog: "init",
          files: [
            {
              path: "package.json",
              size: 2,
              sha256: "a".repeat(64),
              storageId: "storage:1",
              contentType: "application/json",
            },
            {
              path: "dist/index.js",
              size: 17,
              sha256: "b".repeat(64),
              storageId: "storage:2",
              contentType: "text/javascript",
            },
          ],
        };
      }
      return null;
    });

    const response = await __handlers.packagesGetRouterV1Handler(
      makeCtx({
        runQuery,
        runMutation,
        storage: {
          get: vi.fn(async (storageId: string) => {
            if (storageId === "storage:1") {
              return new Blob(["{}"], { type: "application/json" });
            }
            return new Blob(["export default {}"], { type: "text/javascript" });
          }),
        },
      }),
      new Request("https://example.com/api/v1/packages/demo-plugin/download"),
    );

    const zipEntries = unzipSync(new Uint8Array(await response.arrayBuffer()));
    expect(Object.keys(zipEntries).sort()).toEqual(["package/dist/index.js", "package/package.json"]);
    expect(zipEntries["_meta.json"]).toBeUndefined();
  });

  it("package download fails when any stored file is missing", async () => {
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("name" in args) {
        return {
          package: {
            _id: "packages:1",
            name: "demo-plugin",
            displayName: "Demo Plugin",
            family: "code-plugin",
            tags: {},
            latestReleaseId: "packageReleases:1",
            channel: "community",
            isOfficial: false,
            createdAt: 1,
            updatedAt: 1,
          },
          latestRelease: null,
          owner: { _id: "users:owner", handle: "owner" },
        };
      }
      if ("releaseId" in args) {
        return {
          _id: "packageReleases:1",
          version: "1.0.0",
          createdAt: 1,
          changelog: "init",
          files: [
            {
              path: "package.json",
              size: 2,
              sha256: "a".repeat(64),
              storageId: "storage:1",
              contentType: "application/json",
            },
            {
              path: "dist/index.js",
              size: 2,
              sha256: "b".repeat(64),
              storageId: "storage:missing",
              contentType: "text/javascript",
            },
          ],
        };
      }
      return null;
    });
    const storageGet = vi.fn(async (storageId: string) => {
      if (storageId === "storage:1") return new Blob(["{}"], { type: "application/json" });
      return null;
    });

    const response = await __handlers.packagesGetRouterV1Handler(
      makeCtx({
        runQuery,
        runMutation,
        storage: { get: storageGet },
      }),
      new Request("https://example.com/api/v1/packages/demo-plugin/download"),
    );

    expect(response.status).toBe(500);
    expect(await response.text()).toBe("Missing stored file: dist/index.js");
  });

  it("allows package downloads while VT scan is pending", async () => {
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("name" in args) {
        return {
          package: {
            _id: "packages:1",
            name: "demo-plugin",
            displayName: "Demo Plugin",
            family: "code-plugin",
            tags: {},
            latestReleaseId: "packageReleases:1",
            channel: "community",
            isOfficial: false,
            createdAt: 1,
            updatedAt: 1,
          },
          latestRelease: null,
          owner: null,
        };
      }
      if ("releaseId" in args) {
        return {
          _id: "packageReleases:1",
          version: "1.0.0",
          createdAt: 1,
          changelog: "init",
          sha256hash: "a".repeat(64),
          files: [
            {
              path: "package.json",
              size: 2,
              sha256: "a".repeat(64),
              storageId: "storage:1",
              contentType: "application/json",
            },
          ],
        };
      }
      return null;
    });
    const storageGet = vi.fn(async () => new Blob(['{"name":"demo-plugin"}']));

    const response = await __handlers.packagesGetRouterV1Handler(
      makeCtx({ runQuery, runMutation, storage: { get: storageGet } }),
      new Request("https://example.com/api/v1/packages/demo-plugin/download"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/zip");
    expect(storageGet).toHaveBeenCalledWith("storage:1");
  });

  it("allows package downloads when verification is clean even without cached vtAnalysis", async () => {
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("name" in args) {
        return {
          package: {
            _id: "packages:1",
            name: "demo-plugin",
            displayName: "Demo Plugin",
            family: "code-plugin",
            tags: {},
            latestReleaseId: "packageReleases:1",
            channel: "community",
            isOfficial: false,
            createdAt: 1,
            updatedAt: 1,
          },
          latestRelease: null,
          owner: null,
        };
      }
      if ("releaseId" in args) {
        return {
          _id: "packageReleases:1",
          version: "1.0.0",
          createdAt: 1,
          changelog: "init",
          sha256hash: "a".repeat(64),
          verification: { scanStatus: "clean" },
          files: [
            {
              path: "package.json",
              size: 2,
              sha256: "a".repeat(64),
              storageId: "storage:1",
              contentType: "application/json",
            },
          ],
        };
      }
      return null;
    });

    const response = await __handlers.packagesGetRouterV1Handler(
      makeCtx({
        runQuery,
        runMutation,
        storage: {
          get: vi.fn(async () => new Blob(["{}"], { type: "application/json" })),
        },
      }),
      new Request("https://example.com/api/v1/packages/demo-plugin/download"),
    );

    expect(response.status).toBe(200);
  });

  it("blocks package file access when release is malicious", async () => {
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("name" in args) {
        return {
          package: {
            _id: "packages:1",
            name: "demo-plugin",
            displayName: "Demo Plugin",
            family: "code-plugin",
            tags: {},
            latestReleaseId: "packageReleases:1",
            channel: "community",
            isOfficial: false,
            createdAt: 1,
            updatedAt: 1,
          },
          latestRelease: null,
          owner: null,
        };
      }
      if ("releaseId" in args) {
        return {
          _id: "packageReleases:1",
          version: "1.0.0",
          createdAt: 1,
          changelog: "init",
          verification: { scanStatus: "malicious" },
          files: [
            {
              path: "README.md",
              size: 2,
              sha256: "a".repeat(64),
              storageId: "storage:1",
              contentType: "text/markdown",
            },
          ],
        };
      }
      return null;
    });

    const response = await __handlers.packagesGetRouterV1Handler(
      makeCtx({ runQuery, runMutation, storage: { get: vi.fn() } }),
      new Request("https://example.com/api/v1/packages/demo-plugin/file?path=README.md"),
    );

    expect(response.status).toBe(403);
    expect(await response.text()).toContain("flagged as malicious");
  });

  it("blocks file and download access to soft-deleted package releases", async () => {
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("name" in args) {
        return {
          package: {
            _id: "packages:1",
            name: "demo-plugin",
            displayName: "Demo Plugin",
            family: "code-plugin",
            tags: { latest: "packageReleases:deleted" },
            latestReleaseId: "packageReleases:deleted",
            channel: "community",
            isOfficial: false,
            createdAt: 1,
            updatedAt: 1,
          },
          latestRelease: null,
          owner: null,
        };
      }
      if ("releaseId" in args || "version" in args) {
        return {
          _id: "packageReleases:deleted",
          version: "1.0.0",
          createdAt: 1,
          changelog: "init",
          distTags: ["latest"],
          softDeletedAt: 10,
          files: [
            {
              path: "README.md",
              size: 2,
              sha256: "a".repeat(64),
              storageId: "storage:1",
              contentType: "text/markdown",
            },
          ],
        };
      }
      return null;
    });

    const fileResponse = await __handlers.packagesGetRouterV1Handler(
      makeCtx({ runQuery, runMutation, storage: { get: vi.fn() } }),
      new Request("https://example.com/api/v1/packages/demo-plugin/file?version=1.0.0&path=README.md"),
    );
    const downloadResponse = await __handlers.packagesGetRouterV1Handler(
      makeCtx({ runQuery, runMutation, storage: { get: vi.fn() } }),
      new Request("https://example.com/api/v1/packages/demo-plugin/download?tag=latest"),
    );

    expect(fileResponse.status).toBe(404);
    expect(await fileResponse.text()).toBe("Version not found");
    expect(downloadResponse.status).toBe(404);
    expect(await downloadResponse.text()).toBe("Version not found");
  });

  it("package publish uses write rate limiting", async () => {
    vi.mocked(getOptionalApiTokenUserId).mockResolvedValue("users:1" as never);
    vi.mocked(requirePackagePublishAuth).mockResolvedValue({
      kind: "user",
      userId: "users:1",
      user: { _id: "users:1", handle: "p" },
    } as never);
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const runAction = vi.fn().mockResolvedValue({ ok: true, packageId: "pkg:1", releaseId: "rel:1" });

    const response = await __handlers.publishPackageV1Handler(
      makeCtx({ runAction, runMutation }),
      new Request("https://example.com/api/v1/packages", {
        method: "POST",
        headers: {
          Authorization: "Bearer clh_test",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "demo-plugin",
          ownerHandle: "openclaw",
          family: "bundle-plugin",
          version: "1.0.0",
          changelog: "init",
          bundle: { hostTargets: ["desktop"] },
          files: [
            {
              path: "openclaw.bundle.json",
              size: 2,
              storageId: "storage:1",
              sha256: "a".repeat(64),
            },
          ],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("RateLimit-Limit")).toBeTruthy();
    expect(findRateLimitCallArgs(runMutation)).toMatchObject({
      key: "user:users:1",
      limit: RATE_LIMITS.write.key,
    });
    expect(runAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorUserId: "users:1",
        payload: expect.objectContaining({ ownerHandle: "openclaw" }),
      }),
    );
  });

  it("multipart package publish ignores macOS junk files", async () => {
    vi.mocked(getOptionalApiTokenUserId).mockResolvedValue("users:1" as never);
    vi.mocked(requirePackagePublishAuth).mockResolvedValue({
      kind: "user",
      userId: "users:1",
      user: { _id: "users:1", handle: "p" },
    } as never);
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const runAction = vi.fn().mockResolvedValue({ ok: true, packageId: "pkg:1", releaseId: "rel:1" });
    const form = new FormData();
    form.set(
      "payload",
      JSON.stringify({
        name: "demo-plugin",
        family: "bundle-plugin",
        version: "1.0.0",
        changelog: "init",
        bundle: { hostTargets: ["desktop"] },
      }),
    );
    form.append("files", new File(["{}"], ".DS_Store", { type: "application/octet-stream" }));
    form.append(
      "files",
      new File(["{}"], "openclaw.bundle.json", { type: "application/json" }),
    );

    const response = await __handlers.publishPackageV1Handler(
      makeCtx({
        runAction,
        runMutation,
        storage: {
          store: vi.fn(async (entry: File) => `storage:${entry.name}`),
        },
      }),
      new Request("https://example.com/api/v1/packages", {
        method: "POST",
        headers: { Authorization: "Bearer clh_test" },
        body: form,
      }),
    );

    expect(response.status).toBe(200);
    expect(runAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        payload: expect.objectContaining({
          files: [
            expect.objectContaining({
              path: "openclaw.bundle.json",
            }),
          ],
        }),
      }),
    );
  });

  it("package publish routes GitHub Actions auth through the trusted publisher action", async () => {
    vi.mocked(getOptionalApiTokenUserId).mockResolvedValue("users:1" as never);
    vi.mocked(requirePackagePublishAuth).mockResolvedValue({
      kind: "github-actions",
      publishToken: { _id: "packagePublishTokens:1" },
    } as never);
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const runAction = vi.fn().mockResolvedValue({ ok: true, packageId: "pkg:1", releaseId: "rel:1" });

    const response = await __handlers.publishPackageV1Handler(
      makeCtx({ runAction, runMutation }),
      new Request("https://example.com/api/v1/packages", {
        method: "POST",
        headers: {
          Authorization: "Bearer clh_publish",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "demo-plugin",
          family: "bundle-plugin",
          version: "1.0.0",
          changelog: "init",
          bundle: { hostTargets: ["desktop"] },
          files: [
            {
              path: "openclaw.bundle.json",
              size: 2,
              storageId: "storage:1",
              sha256: "a".repeat(64),
            },
          ],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(runAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        publishTokenId: "packagePublishTokens:1",
      }),
    );
  });

  it("returns trusted publisher config for a package", async () => {
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("name" in args) {
        return {
          package: {
            _id: "packages:1",
            name: "@openclaw/demo-plugin",
            displayName: "Demo Plugin",
            family: "code-plugin",
            tags: {},
            channel: "community",
            isOfficial: false,
            createdAt: 1,
            updatedAt: 1,
          },
          latestRelease: null,
          owner: null,
        };
      }
      if ("packageId" in args) {
        return {
          _id: "packageTrustedPublishers:1",
          packageId: "packages:1",
          provider: "github-actions",
          repository: "openclaw/openclaw",
          repositoryId: "1",
          repositoryOwner: "openclaw",
          repositoryOwnerId: "2",
          workflowFilename: "plugin-clawhub-release.yml",
          environment: "clawhub-release",
          createdAt: 1,
          updatedAt: 1,
        };
      }
      return null;
    });

    const response = await __handlers.packagesGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request(
        "https://example.com/api/v1/packages/%40openclaw%2Fdemo-plugin/trusted-publisher",
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      trustedPublisher: {
        provider: "github-actions",
        repository: "openclaw/openclaw",
        repositoryId: "1",
        repositoryOwner: "openclaw",
        repositoryOwnerId: "2",
        workflowFilename: "plugin-clawhub-release.yml",
        environment: "clawhub-release",
      },
    });
  });

  it("mints a short-lived publish token after verifying GitHub OIDC", async () => {
    vi.mocked(verifyGitHubActionsTrustedPublishJwt).mockResolvedValue({
      repository: "openclaw/openclaw",
      repositoryId: "1",
      repositoryOwner: "openclaw",
      repositoryOwnerId: "2",
      workflowFilename: "plugin-clawhub-release.yml",
      environment: "clawhub-release",
      runId: "101",
      runAttempt: "1",
      sha: "abc123",
      ref: "refs/heads/main",
      refType: "branch",
      actor: "onur",
      actorId: "42",
    } as never);
    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if ("key" in args) return okRate();
      return "mutation:ok";
    });
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("name" in args) {
        return {
          _id: "packages:1",
          name: "@openclaw/demo-plugin",
          ownerUserId: "users:owner",
        };
      }
      if ("packageId" in args) {
        return {
          _id: "packageTrustedPublishers:1",
          packageId: "packages:1",
          provider: "github-actions",
          repository: "openclaw/openclaw",
          repositoryId: "1",
          repositoryOwner: "openclaw",
          repositoryOwnerId: "2",
          workflowFilename: "plugin-clawhub-release.yml",
          environment: "clawhub-release",
        };
      }
      return null;
    });

    const response = await __handlers.mintPublishTokenV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/publish/token/mint", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          packageName: "@openclaw/demo-plugin",
          version: "1.0.0",
          githubOidcToken: "gh.jwt",
        }),
      }),
    );

    if (response.status !== 200) throw new Error(await response.text());
    const body = await response.json();
    expect(body.token).toEqual(expect.any(String));
    expect(body.expiresAt).toEqual(expect.any(Number));
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        packageId: "packages:1",
        version: "1.0.0",
        repository: "openclaw/openclaw",
        workflowFilename: "plugin-clawhub-release.yml",
        environment: "clawhub-release",
        runId: "101",
        sha: "abc123",
      }),
    );
  });

  it("mints a short-lived publish token without environment when none is pinned", async () => {
    vi.mocked(verifyGitHubActionsTrustedPublishJwt).mockResolvedValue({
      repository: "openclaw/openclaw",
      repositoryId: "1",
      repositoryOwner: "openclaw",
      repositoryOwnerId: "2",
      workflowFilename: "plugin-clawhub-release.yml",
      environment: "clawhub-release",
      runId: "101",
      runAttempt: "1",
      sha: "abc123",
      ref: "refs/heads/main",
      refType: "branch",
      actor: "onur",
      actorId: "42",
    } as never);
    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if ("key" in args) return okRate();
      return "mutation:ok";
    });
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("name" in args) {
        return {
          _id: "packages:1",
          name: "@openclaw/demo-plugin",
          ownerUserId: "users:owner",
        };
      }
      if ("packageId" in args) {
        return {
          _id: "packageTrustedPublishers:1",
          packageId: "packages:1",
          provider: "github-actions",
          repository: "openclaw/openclaw",
          repositoryId: "1",
          repositoryOwner: "openclaw",
          repositoryOwnerId: "2",
          workflowFilename: "plugin-clawhub-release.yml",
        };
      }
      return null;
    });

    const response = await __handlers.mintPublishTokenV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/publish/token/mint", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          packageName: "@openclaw/demo-plugin",
          version: "1.0.0",
          githubOidcToken: "gh.jwt",
        }),
      }),
    );

    if (response.status !== 200) throw new Error(await response.text());
    const body = await response.json();
    expect(body.token).toEqual(expect.any(String));
    expect(body.expiresAt).toEqual(expect.any(Number));
    const createCall = runMutation.mock.calls.find(
      ([, args]) => typeof args === "object" && args !== null && "packageId" in args && "tokenHash" in args,
    );
    expect(createCall?.[1]).toEqual(
      expect.objectContaining({
        packageId: "packages:1",
        version: "1.0.0",
        repository: "openclaw/openclaw",
        workflowFilename: "plugin-clawhub-release.yml",
        runId: "101",
        sha: "abc123",
      }),
    );
    expect(createCall?.[1]).not.toHaveProperty("environment");
  });

  it("sets trusted publisher config for a package", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:1",
      user: { _id: "users:1", handle: "p" },
    } as never);
    vi.mocked(fetchGitHubRepositoryIdentity).mockResolvedValue({
      repository: "openclaw/openclaw",
      repositoryId: "1",
      repositoryOwner: "openclaw",
      repositoryOwnerId: "2",
    } as never);
    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if ("key" in args) return okRate();
      return {
        _id: "packageTrustedPublishers:1",
        packageId: "packages:1",
        provider: "github-actions",
        repository: "openclaw/openclaw",
        repositoryId: "1",
        repositoryOwner: "openclaw",
        repositoryOwnerId: "2",
        workflowFilename: "plugin-clawhub-release.yml",
        environment: "clawhub-release",
      };
    });

    const response = await __handlers.packagesPostRouterV1Handler(
      makeCtx({ runMutation }),
      new Request(
        "https://example.com/api/v1/packages/%40openclaw%2Fdemo-plugin/trusted-publisher",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer clh_test",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            repository: "https://github.com/openclaw/openclaw",
            workflowFilename: "plugin-clawhub-release.yml",
            environment: "clawhub-release",
          }),
        },
      ),
    );

    if (response.status !== 200) throw new Error(await response.text());
    expect(fetchGitHubRepositoryIdentity).toHaveBeenCalledWith("https://github.com/openclaw/openclaw");
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorUserId: "users:1",
        packageName: "@openclaw/demo-plugin",
        repository: "openclaw/openclaw",
        workflowFilename: "plugin-clawhub-release.yml",
        environment: "clawhub-release",
      }),
    );
  });

  it("sets trusted publisher config for a package without environment", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:1",
      user: { _id: "users:1", handle: "p" },
    } as never);
    vi.mocked(fetchGitHubRepositoryIdentity).mockResolvedValue({
      repository: "openclaw/openclaw",
      repositoryId: "1",
      repositoryOwner: "openclaw",
      repositoryOwnerId: "2",
    } as never);
    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if ("key" in args) return okRate();
      return {
        _id: "packageTrustedPublishers:1",
        packageId: "packages:1",
        provider: "github-actions",
        repository: "openclaw/openclaw",
        repositoryId: "1",
        repositoryOwner: "openclaw",
        repositoryOwnerId: "2",
        workflowFilename: "plugin-clawhub-release.yml",
      };
    });

    const response = await __handlers.packagesPostRouterV1Handler(
      makeCtx({ runMutation }),
      new Request(
        "https://example.com/api/v1/packages/%40openclaw%2Fdemo-plugin/trusted-publisher",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer clh_test",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            repository: "https://github.com/openclaw/openclaw",
            workflowFilename: "plugin-clawhub-release.yml",
          }),
        },
      ),
    );

    if (response.status !== 200) throw new Error(await response.text());
    expect(fetchGitHubRepositoryIdentity).toHaveBeenCalledWith("https://github.com/openclaw/openclaw");
    expect(await response.json()).toEqual({
      trustedPublisher: {
        provider: "github-actions",
        repository: "openclaw/openclaw",
        repositoryId: "1",
        repositoryOwner: "openclaw",
        repositoryOwnerId: "2",
        workflowFilename: "plugin-clawhub-release.yml",
      },
    });
    const setCall = runMutation.mock.calls.find(
      ([, args]) => typeof args === "object" && args !== null && "packageName" in args && "actorUserId" in args,
    );
    expect(setCall?.[1]).toEqual(
      expect.objectContaining({
        actorUserId: "users:1",
        packageName: "@openclaw/demo-plugin",
        repository: "openclaw/openclaw",
        workflowFilename: "plugin-clawhub-release.yml",
      }),
    );
    expect(setCall?.[1]).not.toHaveProperty("environment");
  });

  it("deletes trusted publisher config for a package", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:1",
      user: { _id: "users:1", handle: "p" },
    } as never);
    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if ("key" in args) return okRate();
      return { deleted: true };
    });

    const response = await __handlers.packagesDeleteRouterV1Handler(
      makeCtx({ runMutation }),
      new Request(
        "https://example.com/api/v1/packages/%40openclaw%2Fdemo-plugin/trusted-publisher",
        {
          method: "DELETE",
          headers: { Authorization: "Bearer clh_test" },
        },
      ),
    );

    expect(response.status).toBe(200);
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorUserId: "users:1",
        packageName: "@openclaw/demo-plugin",
      }),
    );
  });

  it("delete/undelete map forbidden/not-found/unknown to 403/404/500", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:1",
      user: { handle: "p" },
    } as never);

    const runMutationForbidden = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("key" in args) return okRate();
      throw new Error("Forbidden");
    });
    const forbidden = await __handlers.skillsDeleteRouterV1Handler(
      makeCtx({ runMutation: runMutationForbidden }),
      new Request("https://example.com/api/v1/skills/demo", {
        method: "DELETE",
        headers: { Authorization: "Bearer clh_test" },
      }),
    );
    expect(forbidden.status).toBe(403);
    expect(await forbidden.text()).toBe("Forbidden");

    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:1",
      user: { handle: "p" },
    } as never);
    const runMutationNotFound = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("key" in args) return okRate();
      throw new Error("Skill not found");
    });
    const notFound = await __handlers.skillsPostRouterV1Handler(
      makeCtx({ runMutation: runMutationNotFound }),
      new Request("https://example.com/api/v1/skills/demo/undelete", {
        method: "POST",
        headers: { Authorization: "Bearer clh_test" },
      }),
    );
    expect(notFound.status).toBe(404);
    expect(await notFound.text()).toBe("Skill not found");

    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:1",
      user: { handle: "p" },
    } as never);
    const runMutationUnknown = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("key" in args) return okRate();
      throw new Error("boom");
    });
    const unknown = await __handlers.soulsDeleteRouterV1Handler(
      makeCtx({ runMutation: runMutationUnknown }),
      new Request("https://example.com/api/v1/souls/demo-soul", {
        method: "DELETE",
        headers: { Authorization: "Bearer clh_test" },
      }),
    );
    expect(unknown.status).toBe(500);
    expect(await unknown.text()).toBe("Internal Server Error");
  });
});
