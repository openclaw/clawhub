/* @vitest-environment node */
import { gzipSync, unzipSync } from "fflate";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import { RATE_LIMITS } from "./lib/httpRateLimit";
import { MAX_PUBLISH_FILE_BYTES } from "./lib/publishLimits";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
}));

vi.mock("./lib/apiTokenAuth", () => ({
  requireApiTokenUser: vi.fn(),
  getOptionalApiTokenUser: vi.fn(),
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
const {
  getOptionalApiTokenUser,
  getOptionalApiTokenUserId,
  requireApiTokenUser,
  requirePackagePublishAuth,
} = await import("./lib/apiTokenAuth");
const { fetchGitHubRepositoryIdentity, verifyGitHubActionsTrustedPublishJwt } =
  await import("./lib/githubActionsOidc");
const { buildBundleFingerprint } = await import("./lib/skillCards");
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

function hasPackageNameArgs(args: unknown): args is { name: string } {
  if (!args || typeof args !== "object") return false;
  const value = args as Record<string, unknown>;
  return typeof value.name === "string";
}

function hasPackageDownloadMetricTarget(args: unknown, packageId: string) {
  if (!args || typeof args !== "object") return false;
  const value = args as Record<string, unknown>;
  const target = value.target;
  if (!target || typeof target !== "object") return false;
  const targetValue = target as Record<string, unknown>;
  return targetValue.kind === "package" && targetValue.id === packageId;
}

function findRateLimitCallArgs(mock: ReturnType<typeof vi.fn>) {
  return mock.mock.calls.map(([, args]) => args).find(isRateLimitArgs);
}

function makeInstallResolverRunQuery({
  skill,
  source = null,
  publicVisible = true,
}: {
  skill: Record<string, unknown> | null;
  source?: Record<string, unknown> | null;
  publicVisible?: boolean;
}) {
  let slugQueryCount = 0;
  return vi.fn(async (query: unknown, args: Record<string, unknown>) => {
    void query;
    if ("sourceId" in args) return source;
    if ("slug" in args) {
      slugQueryCount += 1;
      if (slugQueryCount === 1) {
        return skill;
      }
      if (slugQueryCount === 2) {
        return publicVisible && skill
          ? {
              skill: {
                _id: skill._id,
                slug: skill.slug,
                displayName: skill.displayName,
              },
            }
          : null;
      }
    }
    throw new Error(`unexpected query ${JSON.stringify(args)}`);
  });
}

function makeCatalogItem(
  name: string,
  options: {
    family: "code-plugin" | "bundle-plugin" | "skill";
    updatedAt: number;
    score?: number;
  },
) {
  return {
    name,
    displayName: name,
    family: options.family,
    channel: "community",
    isOfficial: false,
    createdAt: options.updatedAt,
    updatedAt: options.updatedAt,
    ...(typeof options.score === "number" ? { score: options.score } : {}),
  };
}

const TAR_BLOCK_SIZE = 512;

function tarOctal(value: number, width: number) {
  return value.toString(8).padStart(width - 1, "0") + "\0";
}

function writeTarString(target: Uint8Array, offset: number, width: number, value: string) {
  const encoded = new TextEncoder().encode(value);
  target.set(encoded.subarray(0, width), offset);
}

function tarFile(path: string, content: string | Uint8Array) {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  const header = new Uint8Array(TAR_BLOCK_SIZE);
  writeTarString(header, 0, 100, path);
  writeTarString(header, 100, 8, tarOctal(0o644, 8));
  writeTarString(header, 108, 8, tarOctal(0, 8));
  writeTarString(header, 116, 8, tarOctal(0, 8));
  writeTarString(header, 124, 12, tarOctal(bytes.byteLength, 12));
  writeTarString(header, 136, 12, tarOctal(0, 12));
  header.fill(0x20, 148, 156);
  header[156] = "0".charCodeAt(0);
  writeTarString(header, 257, 6, "ustar");
  writeTarString(header, 263, 2, "00");

  let checksum = 0;
  for (const byte of header) checksum += byte;
  writeTarString(header, 148, 8, tarOctal(checksum, 8));

  const paddedSize = Math.ceil(bytes.byteLength / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE;
  const body = new Uint8Array(paddedSize);
  body.set(bytes);
  return [header, body];
}

function npmPackFixture(files: Record<string, string | Uint8Array>) {
  const parts: Uint8Array[] = [];
  for (const [path, content] of Object.entries(files)) {
    parts.push(...tarFile(path, content));
  }
  parts.push(new Uint8Array(TAR_BLOCK_SIZE), new Uint8Array(TAR_BLOCK_SIZE));
  const size = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const tar = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    tar.set(part, offset);
    offset += part.byteLength;
  }
  return gzipSync(tar);
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function packagePublishMetadata(overrides: Record<string, unknown> = {}) {
  return {
    name: "demo-plugin",
    family: "bundle-plugin",
    version: "1.0.0",
    changelog: "init",
    ...overrides,
  };
}

function packagePublishForm(payload: Record<string, unknown>) {
  const form = new FormData();
  form.set("payload", JSON.stringify(payload));
  return form;
}

function makeCtx(partial: Record<string, unknown>) {
  const rateLimitStatus =
    typeof partial.rateLimitStatus === "function"
      ? (partial.rateLimitStatus as (args: RateLimitArgs) => unknown)
      : null;
  const partialRunQuery =
    typeof partial.runQuery === "function"
      ? (partial.runQuery as (query: unknown, args: Record<string, unknown>) => unknown)
      : null;
  const runQuery = vi.fn(async (query: unknown, args: Record<string, unknown>) => {
    if (isRateLimitArgs(args)) {
      return rateLimitStatus?.(args) ?? { ...okRate(), limit: args.limit };
    }
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
  vi.unstubAllEnvs();
  vi.mocked(getAuthUserId).mockReset();
  vi.mocked(getAuthUserId).mockResolvedValue(null);
  vi.mocked(getOptionalApiTokenUser).mockReset();
  vi.mocked(getOptionalApiTokenUser).mockResolvedValue(null);
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

  it("skills export allows authenticated non-admin users at the key rate limit", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:actor",
      user: { _id: "users:actor", role: "user" },
    } as never);
    vi.mocked(getOptionalApiTokenUser).mockResolvedValue({
      userId: "users:actor",
      user: { _id: "users:actor", role: "user" },
    } as never);

    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return { ...okRate(), limit: args.limit };
      return { ok: true };
    });
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("startDate" in args) return { page: [], nextCursor: null, hasMore: false };
      return null;
    });

    const response = await __handlers.exportSkillsV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/skills/export?startDate=1&endDate=2", {
        headers: { authorization: "Bearer user-token" },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("X-RateLimit-Limit")).toBe(String(RATE_LIMITS.export.key));
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        key: "user:users:actor:export",
        limit: RATE_LIMITS.export.key,
      }),
    );
  });

  it("skills export defaults to the proven 250 item page limit", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:actor",
      user: { _id: "users:actor", role: "user" },
    } as never);
    vi.mocked(getOptionalApiTokenUser).mockResolvedValue({
      userId: "users:actor",
      user: { _id: "users:actor", role: "user" },
    } as never);

    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("startDate" in args) return { page: [], nextCursor: null, hasMore: false };
      return null;
    });

    const response = await __handlers.exportSkillsV1Handler(
      makeCtx({ runQuery }),
      new Request("https://example.com/api/v1/skills/export?startDate=1&endDate=2", {
        headers: { authorization: "Bearer user-token" },
      }),
    );

    expect(response.status).toBe(200);
    const listCall = runQuery.mock.calls.find(([, args]) => "startDate" in args);
    expect(listCall?.[1]).toMatchObject({ numItems: 250 });
  });

  it("skills export rejects pages above 250 items", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:actor",
      user: { _id: "users:actor", role: "user" },
    } as never);
    vi.mocked(getOptionalApiTokenUser).mockResolvedValue({
      userId: "users:actor",
      user: { _id: "users:actor", role: "user" },
    } as never);

    const runQuery = vi.fn();
    const response = await __handlers.exportSkillsV1Handler(
      makeCtx({ runQuery }),
      new Request("https://example.com/api/v1/skills/export?startDate=1&endDate=2&limit=251", {
        headers: { authorization: "Bearer user-token" },
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toBe("limit must be <= 250");
    expect(runQuery).not.toHaveBeenCalledWith(
      (internal as unknown as { skills: Record<string, unknown> }).skills.listByDateRange,
      expect.anything(),
    );
  });

  it("skills export rejects unauthenticated requests", async () => {
    vi.mocked(requireApiTokenUser).mockRejectedValue(new Error("Unauthorized"));

    const runQuery = vi.fn();
    const response = await __handlers.exportSkillsV1Handler(
      makeCtx({ runQuery }),
      new Request("https://example.com/api/v1/skills/export?startDate=1&endDate=2"),
    );

    expect(response.status).toBe(401);
    expect(runQuery).not.toHaveBeenCalledWith(
      (internal as unknown as { skills: Record<string, unknown> }).skills.listByDateRange,
      expect.anything(),
    );
  });

  it("skills export preserves pagination headers for empty filtered pages", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:actor",
      user: { _id: "users:actor", role: "user" },
    } as never);
    vi.mocked(getOptionalApiTokenUser).mockResolvedValue({
      userId: "users:actor",
      user: { _id: "users:actor", role: "user" },
    } as never);

    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("startDate" in args) return { page: [], nextCursor: "next-page", hasMore: true };
      return null;
    });

    const response = await __handlers.exportSkillsV1Handler(
      makeCtx({ runQuery }),
      new Request("https://example.com/api/v1/skills/export?startDate=1&endDate=2", {
        headers: { authorization: "Bearer user-token" },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Next-Cursor")).toBe("next-page");
    expect(response.headers.get("X-Has-More")).toBe("true");
  });

  it("skills export namespaces files by publisher and slug", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:actor",
      user: { _id: "users:actor", role: "user" },
    } as never);
    vi.mocked(getOptionalApiTokenUser).mockResolvedValue({
      userId: "users:actor",
      user: { _id: "users:actor", role: "user" },
    } as never);

    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("startDate" in args) {
        return {
          page: [
            {
              skillId: "skills:alice",
              slug: "demo",
              displayName: "Alice Demo",
              latestVersionId: "skillVersions:alice",
              createdAt: 1,
              updatedAt: 2,
              stats: {},
              ownerUserId: "users:alice",
              ownerHandle: "alice",
              ownerDisplayName: "Alice",
            },
            {
              skillId: "skills:bob",
              slug: "demo",
              displayName: "Bob Demo",
              latestVersionId: "skillVersions:bob",
              createdAt: 1,
              updatedAt: 3,
              stats: {},
              ownerUserId: "users:bob",
              ownerHandle: "bob",
              ownerDisplayName: "Bob",
            },
          ],
          nextCursor: null,
          hasMore: false,
        };
      }
      if (args.versionId === "skillVersions:alice") {
        return {
          skillId: "skills:alice",
          version: "1.0.0",
          files: [{ storageId: "storage:alice", path: "SKILL.md" }],
        };
      }
      if (args.versionId === "skillVersions:bob") {
        return {
          skillId: "skills:bob",
          version: "1.0.0",
          files: [{ storageId: "storage:bob", path: "SKILL.md" }],
        };
      }
      return null;
    });

    const response = await __handlers.exportSkillsV1Handler(
      makeCtx({
        runQuery,
        storage: {
          get: vi.fn(
            async (storageId: string) =>
              new Blob([storageId === "storage:alice" ? "alice" : "bob"]),
          ),
        },
      }),
      new Request("https://example.com/api/v1/skills/export?startDate=1&endDate=5", {
        headers: { authorization: "Bearer user-token" },
      }),
    );

    if (response.status !== 200) throw new Error(await response.text());
    const zipEntries = unzipSync(new Uint8Array(await response.arrayBuffer()));
    expect(Object.keys(zipEntries).sort()).toEqual([
      "_manifest.json",
      "alice/demo/SKILL.md",
      "alice/demo/_export_skill_meta.json",
      "bob/demo/SKILL.md",
      "bob/demo/_export_skill_meta.json",
    ]);
  });

  it("skills export skips stale latest versions before reading blobs", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:actor",
      user: { _id: "users:actor", role: "user" },
    } as never);
    vi.mocked(getOptionalApiTokenUser).mockResolvedValue({
      userId: "users:actor",
      user: { _id: "users:actor", role: "user" },
    } as never);

    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("startDate" in args) {
        return {
          page: [
            {
              skillId: "skills:demo",
              slug: "demo",
              displayName: "Demo",
              latestVersionId: "skillVersions:other",
              createdAt: 1,
              updatedAt: 2,
              stats: {},
              ownerUserId: "users:alice",
              ownerHandle: "alice",
              ownerDisplayName: "Alice",
            },
            {
              skillId: "skills:deleted",
              slug: "deleted",
              displayName: "Deleted",
              latestVersionId: "skillVersions:deleted",
              createdAt: 1,
              updatedAt: 3,
              stats: {},
              ownerUserId: "users:bob",
              ownerHandle: "bob",
              ownerDisplayName: "Bob",
            },
          ],
          nextCursor: null,
          hasMore: false,
        };
      }
      if (args.versionId === "skillVersions:other") {
        return {
          skillId: "skills:other",
          version: "9.9.9",
          files: [{ storageId: "storage:other", path: "SKILL.md" }],
          softDeletedAt: undefined,
        };
      }
      if (args.versionId === "skillVersions:deleted") {
        return {
          skillId: "skills:deleted",
          version: "1.0.0",
          files: [{ storageId: "storage:deleted", path: "SKILL.md" }],
          softDeletedAt: 123,
        };
      }
      return null;
    });
    const storageGet = vi.fn();

    const response = await __handlers.exportSkillsV1Handler(
      makeCtx({ runQuery, storage: { get: storageGet } }),
      new Request("https://example.com/api/v1/skills/export?startDate=1&endDate=5", {
        headers: { authorization: "Bearer user-token" },
      }),
    );

    if (response.status !== 200) throw new Error(await response.text());
    expect(response.headers.get("X-Export-Errors")).toBe("2");
    expect(response.headers.get("X-Total-Returned")).toBe("0");
    expect(storageGet).not.toHaveBeenCalled();

    const zipEntries = unzipSync(new Uint8Array(await response.arrayBuffer()));
    const errors = JSON.parse(new TextDecoder().decode(zipEntries["_errors.json"]));
    expect(errors).toEqual([
      {
        slug: "demo",
        error: "version not found (latestVersionId: skillVersions:other)",
      },
      {
        slug: "deleted",
        error: "version not available (latestVersionId: skillVersions:deleted)",
      },
    ]);
    expect(Object.keys(zipEntries).some((path) => path.endsWith("/SKILL.md"))).toBe(false);
  });

  it("skills export logs generation failure context", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:actor",
      user: { _id: "users:actor", role: "user" },
    } as never);
    vi.mocked(getOptionalApiTokenUser).mockResolvedValue({
      userId: "users:actor",
      user: { _id: "users:actor", role: "user" },
    } as never);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("startDate" in args) {
        return {
          page: [
            {
              skillId: "skills:demo",
              slug: "demo",
              displayName: "Demo",
              latestVersionId: "skillVersions:demo",
              createdAt: 1,
              updatedAt: 2,
              stats: {},
              ownerUserId: "users:alice",
              ownerHandle: "alice",
              ownerDisplayName: "Alice",
            },
          ],
          nextCursor: null,
          hasMore: false,
        };
      }
      if (args.versionId === "skillVersions:demo") {
        return {
          skillId: "skills:demo",
          version: "1.0.0",
          files: [
            { storageId: "storage:one", path: "SKILL.md" },
            { storageId: "storage:two", path: "SKILL.md" },
          ],
        };
      }
      return null;
    });

    try {
      await expect(
        __handlers.exportSkillsV1Handler(
          makeCtx({
            runQuery,
            storage: { get: vi.fn(async () => new Blob(["content"])) },
          }),
          new Request("https://example.com/api/v1/skills/export?startDate=1&endDate=5", {
            headers: { authorization: "Bearer user-token" },
          }),
        ),
      ).rejects.toThrow(/Duplicate ZIP path/);

      expect(consoleError).toHaveBeenCalledWith(
        "skills_export_failed",
        expect.objectContaining({
          phase: "build_zip",
          startDate: 1,
          endDate: 5,
          limit: 250,
          cursorPresent: false,
          pageLength: 1,
          versionCount: 1,
          blobTaskCount: 2,
          blobCount: 2,
          zipEntryCount: 3,
          manifestCount: 1,
          exportErrorCount: 0,
          totalExportBytes: 14,
          errorName: "Error",
        }),
      );
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain("user-token");
    } finally {
      consoleError.mockRestore();
    }
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

  it("users/reserve forbids non-admin api tokens", async () => {
    const runQuery = vi.fn();
    const runAction = vi.fn();
    const runMutation = vi.fn().mockResolvedValue(okRate());
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:actor",
      user: { _id: "users:actor", role: "user" },
    } as never);

    const response = await __handlers.usersPostRouterV1Handler(
      makeCtx({ runQuery, runAction, runMutation }),
      new Request("https://example.com/api/v1/users/reserve", {
        method: "POST",
        body: JSON.stringify({ handle: "target", slugs: ["a"] }),
      }),
    );
    expect(response.status).toBe(403);
    expect(runQuery).not.toHaveBeenCalled();
  });

  it("users/reserve reserves slugs and package names for admin", async () => {
    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate();
      return { ok: true, action: "reserved" };
    });
    let handleLookupCount = 0;
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if (args.handle === "target" && handleLookupCount === 0) {
        handleLookupCount += 1;
        return { _id: "users:target" };
      }
      if (args.handle === "target") {
        return { _id: "publishers:target", handle: "target" };
      }
      return null;
    });
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:admin",
      user: { _id: "users:admin", role: "admin" },
    } as never);

    const response = await __handlers.usersPostRouterV1Handler(
      makeCtx({ runQuery, runAction: vi.fn(), runMutation }),
      new Request("https://example.com/api/v1/users/reserve", {
        method: "POST",
        body: JSON.stringify({
          handle: "Target",
          slugs: [" A "],
          packageNames: [" @openclaw/a "],
          reason: "r",
        }),
      }),
    );
    if (response.status !== 200) throw new Error(await response.text());

    const slugCalls = runMutation.mock.calls.filter(([, args]) => hasSlugArgs(args));
    const packageCalls = runMutation.mock.calls.filter(([, args]) => hasPackageNameArgs(args));
    expect(slugCalls).toHaveLength(1);
    expect(slugCalls[0]?.[1]).toMatchObject({
      actorUserId: "users:admin",
      slug: "a",
      rightfulOwnerUserId: "users:target",
      reason: "r",
    });
    expect(packageCalls).toHaveLength(1);
    expect(packageCalls[0]?.[1]).toMatchObject({
      actorUserId: "users:admin",
      ownerUserId: "users:target",
      ownerPublisherId: "publishers:target",
      name: "@openclaw/a",
      reason: "r",
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

  it("users/publisher-member removes an org publisher member for admin", async () => {
    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate();
      return {
        ok: true,
        publisherId: "publishers:opik",
        handle: "opik",
        removed: true,
        member: {
          userId: "users:patrick",
          handle: "patrick-erichsen-2",
          role: "owner",
        },
      };
    });
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:admin",
      user: { _id: "users:admin", role: "admin" },
    } as never);

    const response = await __handlers.usersPostRouterV1Handler(
      makeCtx({ runQuery: vi.fn(), runAction: vi.fn(), runMutation }),
      new Request("https://example.com/api/v1/users/publisher-member", {
        method: "POST",
        body: JSON.stringify({ handle: "Opik", memberHandle: "@patrick-erichsen-2" }),
      }),
    );
    if (response.status !== 200) throw new Error(await response.text());

    expect(await response.json()).toMatchObject({
      ok: true,
      handle: "opik",
      removed: true,
    });
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorUserId: "users:admin",
        handle: "opik",
        memberHandle: "@patrick-erichsen-2",
      }),
    );
  });

  it("users/publisher-official lists official publishers for admin", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:admin",
      user: { _id: "users:admin", role: "admin" },
    } as never);
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate();
      return {
        ok: true,
        items: [
          {
            officialPublisherId: "officialPublishers:openclaw",
            publisherId: "publishers:openclaw",
            handle: "openclaw",
            displayName: "OpenClaw",
            kind: "org",
            active: true,
            reason: "platform-owned publisher",
            createdByUserId: "users:admin",
            createdByHandle: "patrick-erichsen-2",
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      };
    });
    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate();
      return null;
    });

    const response = await __handlers.usersGetRouterV1Handler(
      makeCtx({ runQuery, runAction: vi.fn(), runMutation }),
      new Request("https://example.com/api/v1/users/publisher-official", {
        headers: { Authorization: "Bearer clh_test" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      items: [{ handle: "openclaw" }],
    });
    expect(runQuery).toHaveBeenCalledWith(internal.publishers.listOfficialPublishersInternal, {
      actorUserId: "users:admin",
    });
  });

  it("users/publisher-official adds official org publishers for admin", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:admin",
      user: { _id: "users:admin", role: "admin" },
    } as never);
    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate();
      return {
        ok: true,
        publisherId: "publishers:nvidia",
        handle: "nvidia",
        added: true,
        officialPublisherId: "officialPublishers:nvidia",
      };
    });

    const response = await __handlers.usersPostRouterV1Handler(
      makeCtx({ runQuery: vi.fn(), runAction: vi.fn(), runMutation }),
      new Request("https://example.com/api/v1/users/publisher-official", {
        method: "POST",
        headers: { Authorization: "Bearer clh_test" },
        body: JSON.stringify({
          action: "add",
          handle: "NVIDIA",
          reason: "NVIDIA source-backed catalog",
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, added: true });
    expect(runMutation).toHaveBeenCalledWith(internal.publishers.addOfficialPublisherInternal, {
      actorUserId: "users:admin",
      handle: "nvidia",
      reason: "NVIDIA source-backed catalog",
    });
  });

  it("users/publisher-official removes official org publishers for admin", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:admin",
      user: { _id: "users:admin", role: "admin" },
    } as never);
    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate();
      return {
        ok: true,
        publisherId: "publishers:nvidia",
        handle: "nvidia",
        removed: true,
        officialPublisherId: "officialPublishers:nvidia",
      };
    });

    const response = await __handlers.usersPostRouterV1Handler(
      makeCtx({ runQuery: vi.fn(), runAction: vi.fn(), runMutation }),
      new Request("https://example.com/api/v1/users/publisher-official", {
        method: "POST",
        headers: { Authorization: "Bearer clh_test" },
        body: JSON.stringify({
          action: "remove",
          handle: "NVIDIA",
          reason: "requested by publisher",
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, removed: true });
    expect(runMutation).toHaveBeenCalledWith(internal.publishers.removeOfficialPublisherInternal, {
      actorUserId: "users:admin",
      handle: "nvidia",
      reason: "requested by publisher",
    });
  });

  it("publishers creates a self-serve org publisher for the authenticated user", async () => {
    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate();
      return {
        ok: true,
        publisherId: "publishers:opik",
        handle: "opik",
        created: true,
        trusted: false,
      };
    });
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:vincent",
      user: { _id: "users:vincent", role: "user" },
    } as never);

    const response = await __handlers.createPublisherV1Handler(
      makeCtx({ runQuery: vi.fn(), runAction: vi.fn(), runMutation }),
      new Request("https://example.com/api/v1/publishers", {
        method: "POST",
        body: JSON.stringify({ handle: "Opik", displayName: "Opik" }),
      }),
    );
    if (response.status !== 201) throw new Error(await response.text());

    expect(await response.json()).toMatchObject({
      ok: true,
      publisherId: "publishers:opik",
      handle: "opik",
      created: true,
      trusted: false,
    });
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorUserId: "users:vincent",
        handle: "opik",
        displayName: "Opik",
      }),
    );
  });

  it("publishers returns conflict when the org already exists", async () => {
    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate();
      throw new Error('Publisher "@opik" already exists');
    });
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:vincent",
      user: { _id: "users:vincent", role: "user" },
    } as never);

    const response = await __handlers.createPublisherV1Handler(
      makeCtx({ runQuery: vi.fn(), runAction: vi.fn(), runMutation }),
      new Request("https://example.com/api/v1/publishers", {
        method: "POST",
        body: JSON.stringify({ handle: "opik" }),
      }),
    );

    expect(response.status).toBe(409);
    expect(await response.text()).toBe('Publisher "@opik" already exists');
  });

  it("publishers returns a controlled error when JSON is not an object", async () => {
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.createPublisherV1Handler(
      makeCtx({ runQuery: vi.fn(), runAction: vi.fn(), runMutation }),
      new Request("https://example.com/api/v1/publishers", {
        method: "POST",
        body: "null",
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toBe("JSON body must be an object");
    expect(requireApiTokenUser).not.toHaveBeenCalled();
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

  it("search includes public owner metadata without publisher bio", async () => {
    const runAction = vi.fn().mockResolvedValue([
      {
        score: 1,
        skill: { slug: "demo", displayName: "Demo", summary: "Summary", updatedAt: 1 },
        version: { version: "1.0.0" },
        ownerHandle: "openclaw",
        owner: {
          handle: "openclaw",
          displayName: "OpenClaw",
          image: "https://example.com/avatar.png",
          bio: "private-ish profile text",
        },
      },
    ]);
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.searchSkillsV1Handler(
      makeCtx({ runAction, runMutation }),
      new Request("https://example.com/api/v1/search?q=demo"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      results: [
        {
          score: 1,
          slug: "demo",
          displayName: "Demo",
          summary: "Summary",
          version: "1.0.0",
          updatedAt: 1,
          ownerHandle: "openclaw",
          owner: {
            handle: "openclaw",
            displayName: "OpenClaw",
            image: "https://example.com/avatar.png",
          },
        },
      ],
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
      if ("cursor" in args || "numItems" in args) {
        return {
          page: [
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
        return [
          { _id: "versions:1", skillId: "skills:1", version: "1.0.0", softDeletedAt: undefined },
        ];
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

  it("lists skills keeps the v1 no-sort default on updated ranking", async () => {
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("cursor" in args || "numItems" in args) {
        expect(args.sort).toBe("updated");
        return { page: [], nextCursor: null };
      }
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const response = await __handlers.listSkillsV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/skills"),
    );

    expect(response.status).toBe(200);
  });

  it("batches tag resolution across multiple skills into single query", async () => {
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("cursor" in args || "numItems" in args) {
        return {
          page: [
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
          { _id: "versions:1", skillId: "skills:1", version: "2.0.0", softDeletedAt: undefined },
          { _id: "versions:2", skillId: "skills:1", version: "1.0.0", softDeletedAt: undefined },
          { _id: "versions:3", skillId: "skills:2", version: "1.0.0", softDeletedAt: undefined },
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
    const checks: Array<[string, string | null]> = [
      ["default", "recommended"],
      ["recommended", "recommended"],
      ["createdAt", "newest"],
      ["created-at", "newest"],
      ["newest", "newest"],
      ["rating", "stars"],
      ["installs", "installs"],
      ["installs-all-time", "installs"],
      ["trending", null],
    ];

    for (const [input, expected] of checks) {
      const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
        if ("sort" in args || "cursor" in args || "numItems" in args || "limit" in args) {
          if (expected === null) {
            expect(args).not.toHaveProperty("sort");
          } else {
            expect(args.sort).toBe(expected);
          }
          return expected === null
            ? { items: [], nextCursor: null }
            : { page: [], nextCursor: null };
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

  it("lists skills rejects invalid sort", async () => {
    const runQuery = vi.fn();
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const response = await __handlers.listSkillsV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/skills?sort=unknown"),
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Invalid sort query parameter");
    expect(runQuery).not.toHaveBeenCalled();
  });

  it("lists skills rejects empty sort", async () => {
    const runQuery = vi.fn();
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const response = await __handlers.listSkillsV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/skills?sort="),
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Invalid sort query parameter");
    expect(runQuery).not.toHaveBeenCalled();
  });

  it("lists skills forwards nonSuspiciousOnly", async () => {
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("sort" in args || "cursor" in args || "numItems" in args) {
        expect(args.nonSuspiciousOnly).toBe(true);
        return { page: [], nextCursor: null };
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
      if ("sort" in args || "cursor" in args || "numItems" in args) {
        expect(args.nonSuspiciousOnly).toBe(true);
        return { page: [], nextCursor: null };
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
      if ("sort" in args || "cursor" in args || "numItems" in args) {
        expect(args.nonSuspiciousOnly).toBeUndefined();
        return { page: [], nextCursor: null };
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

  it("skill install resolver returns archive descriptor for hosted direct uploads", async () => {
    const runQuery = makeInstallResolverRunQuery({
      skill: {
        _id: "skills:demo",
        slug: "demo",
        displayName: "Demo Skill",
        latestVersionSummary: { version: "1.0.0" },
      },
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.skillsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/skills/demo/install"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      slug: "demo",
      installKind: "archive",
      archive: {
        version: "1.0.0",
        downloadUrl: "https://example.com/api/v1/download?slug=demo&version=1.0.0",
      },
    });
  });

  it("skill install resolver returns a pinned GitHub descriptor for scan-clean source-backed skills", async () => {
    const runQuery = makeInstallResolverRunQuery({
      skill: {
        _id: "skills:aiq-deploy",
        slug: "aiq-deploy",
        displayName: "AIQ Deploy",
        installKind: "github",
        githubSourceId: "githubSkillSources:nvidia",
        githubPath: "skills/aiq-deploy",
        githubCurrentCommit: "1".repeat(40),
        githubCurrentContentHash: "hash-aiq-deploy",
        githubCurrentStatus: "present",
        githubScanStatus: "clean",
      },
      source: {
        _id: "githubSkillSources:nvidia",
        repo: "NVIDIA/skills",
        defaultBranch: "main",
      },
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.skillsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/skills/aiq-deploy/install"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      slug: "aiq-deploy",
      installKind: "github",
      github: {
        repo: "NVIDIA/skills",
        path: "skills/aiq-deploy",
        commit: "1".repeat(40),
        contentHash: "hash-aiq-deploy",
      },
    });
  });

  it.each([
    {
      name: "hosted direct uploads",
      slug: "hidden-direct",
      skill: {
        _id: "skills:hidden-direct",
        slug: "hidden-direct",
        displayName: "Hidden Direct",
        moderationStatus: "hidden",
        latestVersionSummary: { version: "1.0.0" },
      },
    },
    {
      name: "GitHub-backed skills",
      slug: "hidden-github",
      skill: {
        _id: "skills:hidden-github",
        slug: "hidden-github",
        displayName: "Hidden GitHub",
        moderationStatus: "hidden",
        installKind: "github",
        githubSourceId: "githubSkillSources:nvidia",
        githubPath: "skills/hidden-github",
        githubCurrentCommit: "1".repeat(40),
        githubCurrentContentHash: "hash-hidden-github",
        githubCurrentStatus: "present",
        githubScanStatus: "clean",
      },
    },
  ])("skill install resolver hides moderated $name", async ({ slug, skill }) => {
    const runQuery = makeInstallResolverRunQuery({
      skill,
      publicVisible: false,
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.skillsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request(`https://example.com/api/v1/skills/${slug}/install`),
    );

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("Skill not found");
  });

  it("skill install resolver hides skills absent from the public skill detail path", async () => {
    const runQuery = makeInstallResolverRunQuery({
      publicVisible: false,
      skill: {
        _id: "skills:orphaned-github",
        slug: "orphaned-github",
        displayName: "Orphaned GitHub",
        installKind: "github",
        githubSourceId: "githubSkillSources:nvidia",
        githubPath: "skills/orphaned-github",
        githubCurrentCommit: "1".repeat(40),
        githubCurrentContentHash: "hash-orphaned-github",
        githubCurrentStatus: "present",
        githubScanStatus: "clean",
      },
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.skillsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/skills/orphaned-github/install"),
    );

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("Skill not found");
  });

  it("skill install resolver installs the current GitHub hash after it is clean", async () => {
    const runQuery = makeInstallResolverRunQuery({
      skill: {
        _id: "skills:aiq-deploy",
        slug: "aiq-deploy",
        displayName: "AIQ Deploy",
        installKind: "github",
        githubSourceId: "githubSkillSources:nvidia",
        githubPath: "skills/aiq-deploy",
        githubCurrentCommit: "2".repeat(40),
        githubCurrentContentHash: "hash-aiq-deploy-v2",
        githubCurrentStatus: "present",
        githubScanStatus: "clean",
      },
      source: { repo: "NVIDIA/skills" },
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.skillsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/skills/aiq-deploy/install"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      installKind: "github",
      github: {
        commit: "2".repeat(40),
        contentHash: "hash-aiq-deploy-v2",
      },
    });
  });

  it("skill install resolver returns structured GitHub blocks for pending source-backed skills", async () => {
    const runQuery = makeInstallResolverRunQuery({
      skill: {
        _id: "skills:aiq-deploy",
        slug: "aiq-deploy",
        displayName: "AIQ Deploy",
        moderationStatus: "active",
        moderationReason: "pending.scan",
        installKind: "github",
        githubSourceId: "githubSkillSources:nvidia",
        githubPath: "skills/aiq-deploy",
        githubCurrentCommit: "2".repeat(40),
        githubCurrentContentHash: "hash-aiq-deploy-v2",
        githubCurrentStatus: "present",
        githubScanStatus: "pending",
      },
      source: { repo: "NVIDIA/skills" },
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.skillsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/skills/aiq-deploy/install"),
    );

    expect(response.status).toBe(423);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      reason: "github_verification_pending",
    });
  });

  it("skill install resolver force-installs pending GitHub-backed skills", async () => {
    const runQuery = makeInstallResolverRunQuery({
      skill: {
        _id: "skills:aiq-deploy",
        slug: "aiq-deploy",
        displayName: "AIQ Deploy",
        moderationStatus: "active",
        moderationReason: "pending.scan",
        installKind: "github",
        githubSourceId: "githubSkillSources:nvidia",
        githubPath: "skills/aiq-deploy",
        githubCurrentCommit: "2".repeat(40),
        githubCurrentContentHash: "hash-aiq-deploy-v2",
        githubCurrentStatus: "present",
        githubScanStatus: "pending",
      },
      source: { repo: "NVIDIA/skills" },
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.skillsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/skills/aiq-deploy/install?forceInstall=1"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      installKind: "github",
      github: {
        commit: "2".repeat(40),
        contentHash: "hash-aiq-deploy-v2",
      },
    });
  });

  it("skill install resolver blocks GitHub-backed skills with failed scans", async () => {
    const runQuery = makeInstallResolverRunQuery({
      skill: {
        _id: "skills:bad-source",
        slug: "bad-source",
        displayName: "Bad Source",
        installKind: "github",
        githubSourceId: "githubSkillSources:nvidia",
        githubPath: "skills/bad-source",
        githubCurrentCommit: "1".repeat(40),
        githubCurrentContentHash: "hash-bad-source",
        githubCurrentStatus: "present",
        githubScanStatus: "failed",
      },
      source: { repo: "NVIDIA/skills" },
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.skillsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/skills/bad-source/install"),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      reason: "github_scan_failed",
    });
  });

  it.each([
    {
      name: "pending scan",
      patch: { githubScanStatus: "pending" },
      status: 423,
      reason: "github_verification_pending",
    },
    {
      name: "missing upstream path",
      patch: { githubCurrentStatus: "missing" },
      status: 410,
      reason: "github_upstream_missing",
    },
  ])(
    "skill install resolver blocks GitHub-backed skills with $name",
    async ({ patch, status, reason }) => {
      const runQuery = makeInstallResolverRunQuery({
        skill: {
          _id: "skills:blocked-source",
          slug: "blocked-source",
          displayName: "Blocked Source",
          installKind: "github",
          githubSourceId: "githubSkillSources:nvidia",
          githubPath: "skills/blocked-source",
          githubCurrentCommit: "1".repeat(40),
          githubCurrentContentHash: "hash-blocked-source",
          githubCurrentStatus: "present",
          githubScanStatus: "clean",
          ...patch,
        },
        source: { repo: "NVIDIA/skills" },
      });
      const runMutation = vi.fn().mockResolvedValue(okRate());

      const response = await __handlers.skillsGetRouterV1Handler(
        makeCtx({ runQuery, runMutation }),
        new Request("https://example.com/api/v1/skills/blocked-source/install"),
      );

      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        reason,
      });
    },
  );

  it("get skill treats reports as a valid slug", async () => {
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("slug" in args) {
        return {
          skill: {
            _id: "skills:1",
            slug: "reports",
            displayName: "Reports",
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
      if ("versionIds" in args) {
        return [{ _id: "versions:1", version: "1.0.0", softDeletedAt: undefined }];
      }
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const response = await __handlers.skillsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/skills/reports"),
    );
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.skill.slug).toBe("reports");
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

  it("skill reports lists moderator intake", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:moderator",
      user: { _id: "users:moderator", role: "moderator" },
    } as never);
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate();
      return {
        items: [
          {
            reportId: "skillReports:1",
            skillId: "skills:1",
            skillVersionId: "skillVersions:1",
            slug: "demo",
            displayName: "Demo",
            version: "1.0.0",
            reason: "suspicious",
            status: "open",
            createdAt: 123,
            reporter: { userId: "users:reporter", handle: "reporter", displayName: "Reporter" },
            triagedAt: null,
            triagedBy: null,
            triageNote: null,
          },
        ],
        nextCursor: null,
        done: true,
      };
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.skillsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/skills/-/reports?status=open&limit=10", {
        headers: { Authorization: "Bearer clh_test" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      items: [{ reportId: "skillReports:1", slug: "demo" }],
    });
    expect(runQuery).toHaveBeenCalledWith(
      (internal as unknown as { skills: Record<string, unknown> }).skills.listSkillReportsInternal,
      {
        actorUserId: "users:moderator",
        cursor: null,
        limit: 10,
        status: "open",
      },
    );
  });

  it("skill report posts user reports", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:reporter",
      user: { _id: "users:reporter", role: "user" },
    } as never);
    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate();
      return {
        ok: true,
        reported: true,
        alreadyReported: false,
        reportId: "skillReports:1",
        skillId: "skills:1",
        reportCount: 1,
      };
    });

    const response = await __handlers.skillsPostRouterV1Handler(
      makeCtx({ runMutation }),
      new Request("https://example.com/api/v1/skills/demo/report", {
        method: "POST",
        headers: { Authorization: "Bearer clh_test" },
        body: JSON.stringify({ version: "1.0.0", reason: "suspicious files" }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      reported: true,
      reportId: "skillReports:1",
    });
    expect(runMutation).toHaveBeenCalledWith(
      (internal as unknown as { skills: Record<string, unknown> }).skills
        .reportSkillForUserInternal,
      {
        actorUserId: "users:reporter",
        slug: "demo",
        version: "1.0.0",
        reason: "suspicious files",
      },
    );
  });

  it("skill report triage posts moderator decisions", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:moderator",
      user: { _id: "users:moderator", role: "moderator" },
    } as never);
    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate();
      return {
        ok: true,
        reportId: "skillReports:1",
        skillId: "skills:1",
        status: "confirmed",
        reportCount: 0,
      };
    });

    const response = await __handlers.skillsPostRouterV1Handler(
      makeCtx({ runMutation }),
      new Request("https://example.com/api/v1/skills/-/reports/skillReports%3A1/triage", {
        method: "POST",
        headers: { Authorization: "Bearer clh_test" },
        body: JSON.stringify({ status: "confirmed", note: "handled", finalAction: "hide" }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "confirmed" });
    expect(runMutation).toHaveBeenCalledWith(
      (internal as unknown as { skills: Record<string, unknown> }).skills
        .triageSkillReportForUserInternal,
      {
        actorUserId: "users:moderator",
        reportId: "skillReports:1",
        status: "confirmed",
        note: "handled",
        finalAction: "hide",
      },
    );
  });

  it("skill appeal posts owner appeal requests", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:owner",
      user: { _id: "users:owner", role: "user" },
    } as never);
    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate();
      return {
        ok: true,
        submitted: true,
        alreadyOpen: false,
        appealId: "skillAppeals:1",
        skillId: "skills:1",
        status: "open",
      };
    });

    const response = await __handlers.skillsPostRouterV1Handler(
      makeCtx({ runMutation }),
      new Request("https://example.com/api/v1/skills/demo/appeal", {
        method: "POST",
        headers: { Authorization: "Bearer clh_test" },
        body: JSON.stringify({ version: "1.0.0", message: "please review" }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      submitted: true,
      appealId: "skillAppeals:1",
    });
    expect(runMutation).toHaveBeenCalledWith(
      (internal as unknown as { skills: Record<string, unknown> }).skills
        .submitSkillAppealForUserInternal,
      {
        actorUserId: "users:owner",
        slug: "demo",
        version: "1.0.0",
        message: "please review",
      },
    );
  });

  it("skill appeals lists moderator intake", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:moderator",
      user: { _id: "users:moderator", role: "moderator" },
    } as never);
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate();
      return {
        items: [
          {
            appealId: "skillAppeals:1",
            skillId: "skills:1",
            skillVersionId: "skillVersions:1",
            slug: "demo",
            displayName: "Demo",
            version: "1.0.0",
            message: "please review",
            status: "open",
            createdAt: 123,
            submitter: { userId: "users:owner", handle: "owner", displayName: "Owner" },
            resolvedAt: null,
            resolvedBy: null,
            resolutionNote: null,
          },
        ],
        nextCursor: null,
        done: true,
      };
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.skillsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/skills/-/appeals?status=open&limit=10", {
        headers: { Authorization: "Bearer clh_test" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      items: [{ appealId: "skillAppeals:1", slug: "demo" }],
    });
    expect(runQuery).toHaveBeenCalledWith(
      (internal as unknown as { skills: Record<string, unknown> }).skills.listSkillAppealsInternal,
      {
        actorUserId: "users:moderator",
        cursor: null,
        limit: 10,
        status: "open",
      },
    );
  });

  it("skill appeal resolve posts moderator decisions", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:moderator",
      user: { _id: "users:moderator", role: "moderator" },
    } as never);
    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate();
      return {
        ok: true,
        appealId: "skillAppeals:1",
        skillId: "skills:1",
        status: "accepted",
        actionTaken: "restore",
      };
    });

    const response = await __handlers.skillsPostRouterV1Handler(
      makeCtx({ runMutation }),
      new Request("https://example.com/api/v1/skills/-/appeals/skillAppeals%3A1/resolve", {
        method: "POST",
        headers: { Authorization: "Bearer clh_test" },
        body: JSON.stringify({
          status: "accepted",
          note: "scanner finding cleared",
          finalAction: "restore",
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "accepted",
      actionTaken: "restore",
    });
    expect(runMutation).toHaveBeenCalledWith(
      (internal as unknown as { skills: Record<string, unknown> }).skills
        .resolveSkillAppealForUserInternal,
      {
        actorUserId: "users:moderator",
        appealId: "skillAppeals:1",
        status: "accepted",
        note: "scanner finding cleared",
        finalAction: "restore",
      },
    );
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
            source: "legacy-ai",
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
    expect(json.version.security.status).toBe("pending");
    expect(json.version.security.scanners.vt.normalizedStatus).toBe("suspicious");
    expect(json.version.security.virustotalUrl).toContain("virustotal.com/gui/file/");
  });

  it("keeps static-scan suspicious status out of version security snapshot verdicts", async () => {
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
          staticScan: {
            status: "suspicious",
            reasonCodes: ["suspicious.dangerous_exec"],
            summary: "Detected: suspicious.dangerous_exec",
            engineVersion: "v2.4.0",
            checkedAt: 555,
          },
          vtAnalysis: {
            status: "clean",
            verdict: "benign",
            checkedAt: 111,
          },
          llmAnalysis: {
            status: "completed",
            verdict: "benign",
            checkedAt: 222,
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
    expect(json.version.security.hasWarnings).toBe(false);
    expect(json.version.security.hasScanResult).toBe(true);
    expect(json.version.security.scanners.static).toBeUndefined();
    expect(json.version.security.scanners.vt.normalizedStatus).toBe("clean");
    expect(json.version.security.scanners.llm.normalizedStatus).toBe("clean");
  });

  it("keeps static-scan malicious status advisory when ClawScan is benign", async () => {
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
          staticScan: {
            status: "malicious",
            reasonCodes: ["malicious.credential_harvest"],
            summary: "Detected: malicious.credential_harvest",
            engineVersion: "v2.4.0",
            checkedAt: 555,
          },
          vtAnalysis: {
            status: "clean",
            verdict: "benign",
            checkedAt: 111,
          },
          llmAnalysis: {
            status: "completed",
            verdict: "benign",
            checkedAt: 222,
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
    expect(json.version.security.hasWarnings).toBe(false);
    expect(json.version.security.hasScanResult).toBe(true);
    expect(json.version.security.checkedAt).toBe(222);
    expect(json.version.security.scanners.static).toBeUndefined();
  });

  it("omits version security when only static scan evidence exists", async () => {
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
          staticScan: {
            status: "clean",
            reasonCodes: [],
            summary: "No issues found",
            engineVersion: "v2.4.0",
            checkedAt: 555,
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
    expect(json.version.security).toBeUndefined();
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
            _id: "skillVersions:1",
            skillId: "skills:1",
            version: "1.0.0",
            createdAt: 1,
            changelog: "c",
            changelogSource: "auto",
            sha256hash: "b".repeat(64),
            capabilityTags: ["crypto", "requires-wallet", "can-make-purchases"],
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
    expect(json.security.capabilityTags).toEqual([
      "crypto",
      "requires-wallet",
      "can-make-purchases",
    ]);
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
            _id: "skillVersions:1",
            skillId: "skills:1",
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

  it("returns capability tags even when no scanner result exists yet", async () => {
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
            _id: "skillVersions:1",
            skillId: "skills:1",
            version: "1.0.0",
            createdAt: 1,
            changelog: "c",
            changelogSource: "auto",
            capabilityTags: ["posts-externally", "requires-oauth-token"],
            files: [],
          },
          owner: { _id: "users:1", handle: "owner", displayName: "Owner" },
          moderationInfo: {
            isPendingScan: true,
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
    expect(json.security.capabilityTags).toEqual(["posts-externally", "requires-oauth-token"]);
    expect(json.security.hasScanResult).toBe(false);
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
            skillId: "skills:1",
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
    expect(json.security.hasScanResult).toBe(false);
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
            skillId: "skills:1",
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
          skillId: "skills:1",
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
            skillId: "skills:1",
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
          skillId: "skills:1",
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
    expect(json.security.status).toBe("pending");
    expect(json.moderation.sourceVersion).toEqual({
      version: "2.0.0",
      createdAt: 2,
    });
    expect(json.moderation.matchesRequestedVersion).toBe(false);
  });

  it("does not resolve scan tags to another skill's version", async () => {
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("slug" in args) {
        return {
          skill: {
            _id: "skills:1",
            slug: "demo",
            displayName: "Demo",
            summary: "s",
            tags: { old: "skillVersions:other" },
            stats: {},
            createdAt: 1,
            updatedAt: 2,
          },
          latestVersion: null,
          owner: null,
          moderationInfo: null,
        };
      }
      if ("versionId" in args) {
        return {
          _id: "skillVersions:other",
          skillId: "skills:other",
          version: "9.9.9",
          createdAt: 9,
          changelog: "other",
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

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Version not found");
  });

  it("returns raw file content", async () => {
    const internalVersion = {
      skillId: "skills:1",
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

  it("blocks raw file reads for malware-blocked skills", async () => {
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
          latestVersion: null,
          owner: null,
          moderationInfo: {
            isMalwareBlocked: true,
            isPendingScan: false,
            isHiddenByMod: false,
            isRemoved: false,
          },
        };
      }
      throw new Error("unexpected version lookup");
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const storage = { get: vi.fn() };

    const response = await __handlers.skillsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation, storage }),
      new Request("https://example.com/api/v1/skills/demo/file?path=SKILL.md"),
    );

    expect(response.status).toBe(403);
    expect(await response.text()).toContain("flagged as malicious");
    expect(storage.get).not.toHaveBeenCalled();
  });

  it("does not serve raw files from another skill's tagged version", async () => {
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("slug" in args) {
        return {
          skill: {
            _id: "skills:1",
            slug: "demo",
            displayName: "Demo",
            summary: "s",
            tags: { old: "skillVersions:other" },
            stats: {},
            createdAt: 1,
            updatedAt: 2,
            latestVersionId: "skillVersions:1",
          },
          latestVersion: null,
          owner: null,
          moderationInfo: null,
        };
      }
      if (args.versionId === "skillVersions:1") {
        return { _id: "skillVersions:1", skillId: "skills:1", version: "1.0.0", files: [] };
      }
      if (args.versionId === "skillVersions:other") {
        return {
          _id: "skillVersions:other",
          skillId: "skills:other",
          version: "9.9.9",
          files: [{ path: "SKILL.md", size: 5, storageId: "storage:other", sha256: "other" }],
          softDeletedAt: undefined,
        };
      }
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const storage = { get: vi.fn() };

    const response = await __handlers.skillsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation, storage }),
      new Request("https://example.com/api/v1/skills/demo/file?path=SKILL.md&tag=old"),
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Version not found");
    expect(storage.get).not.toHaveBeenCalled();
  });

  it("returns stored Skill Card markdown", async () => {
    const internalVersion = {
      _id: "skillVersions:1",
      skillId: "skills:1",
      version: "1.0.0",
      createdAt: 1,
      changelog: "c",
      files: [
        {
          path: "skill-card.md",
          size: 12,
          storageId: "storage:card",
          sha256: "card-sha",
          contentType: "text/markdown",
        },
      ],
      softDeletedAt: undefined,
    };
    const generatedBundleFingerprint = await buildBundleFingerprint(internalVersion.files);
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("slug" in args) {
        return {
          skill: {
            _id: "skills:1",
            slug: "demo",
            displayName: "Demo",
            summary: "s",
            tags: { stable: "skillVersions:1" },
            stats: {},
            createdAt: 1,
            updatedAt: 2,
            latestVersionId: "skillVersions:1",
          },
          latestVersion: { _id: "skillVersions:1", version: "1.0.0" },
          owner: null,
        };
      }
      if ("skillVersionId" in args) {
        return [
          { fingerprint: generatedBundleFingerprint, kind: "generated-bundle", createdAt: 2 },
        ];
      }
      if ("versionId" in args) return internalVersion;
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const storage = {
      get: vi.fn().mockResolvedValue(new Blob(["# Skill Card"], { type: "text/markdown" })),
    };

    const response = await __handlers.skillsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation, storage }),
      new Request("https://example.com/api/v1/skills/demo/card?tag=stable"),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("# Skill Card");
    expect(response.headers.get("X-Content-SHA256")).toBe("card-sha");
  });

  it("blocks Skill Card reads for malware-blocked skills", async () => {
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
          latestVersion: null,
          owner: null,
          moderationInfo: {
            isMalwareBlocked: true,
            isPendingScan: false,
            isHiddenByMod: false,
            isRemoved: false,
          },
        };
      }
      throw new Error("unexpected version lookup");
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const storage = { get: vi.fn() };

    const response = await __handlers.skillsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation, storage }),
      new Request("https://example.com/api/v1/skills/demo/card"),
    );

    expect(response.status).toBe(403);
    expect(await response.text()).toContain("flagged as malicious");
    expect(storage.get).not.toHaveBeenCalled();
  });

  it("does not serve Skill Cards from another skill's tagged version", async () => {
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("slug" in args) {
        return {
          skill: {
            _id: "skills:1",
            slug: "demo",
            displayName: "Demo",
            summary: "s",
            tags: { old: "skillVersions:other" },
            stats: {},
            createdAt: 1,
            updatedAt: 2,
            latestVersionId: "skillVersions:1",
          },
          latestVersion: null,
          owner: null,
          moderationInfo: null,
        };
      }
      if (args.versionId === "skillVersions:other") {
        return {
          _id: "skillVersions:other",
          skillId: "skills:other",
          version: "9.9.9",
          files: [
            {
              path: "skill-card.md",
              size: 12,
              storageId: "storage:other",
              sha256: "other",
            },
          ],
          softDeletedAt: undefined,
        };
      }
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const storage = { get: vi.fn() };

    const response = await __handlers.skillsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation, storage }),
      new Request("https://example.com/api/v1/skills/demo/card?tag=old"),
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Version not found");
    expect(storage.get).not.toHaveBeenCalled();
  });

  it("does not verify another skill's tagged version", async () => {
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("slug" in args) {
        return {
          skill: {
            _id: "skills:1",
            slug: "demo",
            displayName: "Demo",
            summary: "s",
            tags: { old: "skillVersions:other" },
            stats: {},
            createdAt: 1,
            updatedAt: 2,
            latestVersionId: "skillVersions:1",
          },
          latestVersion: null,
          owner: null,
          moderationInfo: null,
        };
      }
      if (args.versionId === "skillVersions:other") {
        return {
          _id: "skillVersions:other",
          skillId: "skills:other",
          version: "9.9.9",
          files: [],
          softDeletedAt: undefined,
        };
      }
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.skillsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/skills/demo/verify?tag=old"),
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Version not found");
  });

  it("returns 404 when a Skill Card is missing", async () => {
    const internalVersion = {
      skillId: "skills:1",
      version: "1.0.0",
      createdAt: 1,
      changelog: "c",
      files: [{ path: "SKILL.md", size: 5, storageId: "storage:1", sha256: "abcd" }],
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
      if ("skillVersionId" in args) return [];
      if ("versionId" in args) return internalVersion;
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.skillsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation, storage: { get: vi.fn() } }),
      new Request("https://example.com/api/v1/skills/demo/card"),
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Skill Card not found");
  });

  it("does not return publisher-supplied skill-card.md from the Skill Card endpoint", async () => {
    const internalVersion = {
      _id: "skillVersions:1",
      skillId: "skills:1",
      version: "1.0.0",
      createdAt: 1,
      changelog: "c",
      files: [
        { path: "SKILL.md", size: 5, storageId: "storage:1", sha256: "source-sha" },
        { path: "skill-card.md", size: 12, storageId: "storage:card", sha256: "card-sha" },
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
      if ("skillVersionId" in args) {
        return [{ fingerprint: "source-fingerprint", kind: "source", createdAt: 4 }];
      }
      if ("versionId" in args) return internalVersion;
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.skillsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation, storage: { get: vi.fn() } }),
      new Request("https://example.com/api/v1/skills/demo/card"),
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Skill Card not found");
  });

  it("returns bulk skill security verdicts without card data", async () => {
    const version = {
      _id: "skillVersions:1",
      skillId: "skills:1",
      version: "1.0.0",
      createdAt: 1,
      changelog: "c",
      files: [{ path: "SKILL.md", size: 5, storageId: "storage:1", sha256: "source-sha" }],
      staticScan: {
        status: "clean",
        reasonCodes: [],
        findings: [],
        summary: "Static scan clean.",
        engineVersion: "static-v1",
        checkedAt: 2,
      },
      llmAnalysis: {
        status: "clean",
        verdict: "clean",
        confidence: "high",
        summary: "ClawScan clean.",
        checkedAt: 3,
        model: "gpt-test",
      },
      depRegistryAnalysis: {
        status: "clean",
        results: [],
        notFoundPackages: [],
        unresolvedPackages: [],
        summary: "No dependency issues.",
        checkedAt: 4,
      },
      capabilityTags: ["dev-tools"],
      softDeletedAt: undefined,
    };
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("slug" in args) {
        return {
          skill: {
            _id: "skills:1",
            slug: "demo",
            displayName: "Demo",
          },
          owner: { _id: "users:1", handle: "acme", displayName: "Acme" },
          moderationInfo: {
            isPendingScan: false,
            isMalwareBlocked: false,
            isSuspicious: false,
            isHiddenByMod: false,
            isRemoved: false,
          },
          version,
        };
      }
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.skillSecurityVerdictsV1Handler(
      makeCtx({ runQuery, runMutation, storage: { get: vi.fn() } }),
      new Request("https://example.com/api/v1/skills/-/security-verdicts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: [{ slug: "demo", version: "1.0.0" }] }),
      }),
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toMatchObject({
      schema: "clawhub.skill.security-verdicts.v1",
      items: [
        {
          ok: true,
          decision: "pass",
          reasons: [],
          slug: "demo",
          requestedSlug: "demo",
          displayName: "Demo",
          publisherHandle: "acme",
          publisherDisplayName: "Acme",
          requestedVersion: "1.0.0",
          version: "1.0.0",
          createdAt: 1,
          checkedAt: 4,
          skillUrl: "https://example.com/acme/demo",
          securityAuditUrl: "https://example.com/acme/demo/security-audit?version=1.0.0",
          security: {
            status: "clean",
            passed: true,
            rawStatus: "clean",
            verdict: "clean",
            signals: {
              staticScan: { status: "clean", rawStatus: "clean" },
              dependencyRegistry: { status: "clean", rawStatus: "clean" },
            },
          },
        },
      ],
    });
    expect(json.items[0].card).toBeUndefined();
    expect(json.items[0].artifact).toBeUndefined();
    expect(json.items[0].security.signals.staticScan.findings).toBeUndefined();
    expect(json.items[0].security.signals.dependencyRegistry.notFoundPackages).toBeUndefined();
    expect(runQuery.mock.calls.map(([, args]) => args)).toContainEqual({
      slug: "demo",
      version: "1.0.0",
    });
    expect(runQuery.mock.calls.some(([, args]) => "skillId" in args)).toBe(false);
  });

  it("uses the public site origin for production bulk verdict links", async () => {
    vi.stubEnv("CONVEX_DEPLOYMENT", "prod:wry-manatee-359");
    const runQuery = vi.fn(async () => ({
      skill: { _id: "skills:1", slug: "demo", displayName: "Demo" },
      owner: { _id: "users:1", handle: "acme", displayName: "Acme" },
      moderationInfo: {
        isPendingScan: false,
        isMalwareBlocked: false,
        isSuspicious: false,
        isHiddenByMod: false,
        isRemoved: false,
      },
      version: {
        _id: "skillVersions:1",
        version: "1.0.0",
        createdAt: 1,
        llmAnalysis: { status: "clean", verdict: "clean", checkedAt: 2 },
      },
    }));
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.skillSecurityVerdictsV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://wry-manatee-359.convex.site/api/v1/skills/-/security-verdicts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: [{ slug: "demo", version: "1.0.0" }] }),
      }),
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.items[0]).toMatchObject({
      skillUrl: "https://clawhub.ai/acme/demo",
      securityAuditUrl: "https://clawhub.ai/acme/demo/security-audit?version=1.0.0",
    });
  });

  it("honors staff-cleared bulk security verdicts", async () => {
    const runQuery = vi.fn(async () => ({
      skill: { _id: "skills:1", slug: "demo", displayName: "Demo" },
      owner: { _id: "users:1", handle: "acme", displayName: "Acme" },
      moderationInfo: {
        isPendingScan: false,
        isMalwareBlocked: false,
        isSuspicious: false,
        isHiddenByMod: false,
        isRemoved: false,
        overrideActive: true,
        verdict: "clean",
        summary: "Security findings were reviewed by moderators and cleared for public use.",
        updatedAt: 20,
      },
      version: {
        _id: "skillVersions:1",
        version: "1.0.0",
        createdAt: 1,
        llmAnalysis: {
          status: "completed",
          verdict: "suspicious",
          summary: "Scanner found review-worthy behavior.",
          checkedAt: 10,
        },
      },
    }));
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.skillSecurityVerdictsV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/skills/-/security-verdicts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: [{ slug: "demo", version: "1.0.0" }] }),
      }),
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.items[0]).toMatchObject({
      ok: true,
      decision: "pass",
      reasons: [],
      checkedAt: 20,
      security: {
        status: "clean",
        passed: true,
        verdict: "clean",
        summary: "Security findings were reviewed by moderators and cleared for public use.",
        checkedAt: 20,
      },
    });
  });

  it("keeps bulk verdict item failures local to each requested skill", async () => {
    const softDeletedVersion = {
      _id: "skillVersions:deleted",
      skillId: "skills:soft",
      version: "2.0.0",
      createdAt: 2,
      changelog: "c",
      files: [],
      llmAnalysis: { status: "clean", verdict: "clean", checkedAt: 3 },
      softDeletedAt: 5,
    };
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if (args.slug === "missing") return null;
      if (args.slug === "no-version") {
        return {
          skill: {
            _id: "skills:no-version",
            slug: "no-version",
            displayName: "No Version",
          },
          owner: null,
          moderationInfo: null,
          version: null,
        };
      }
      if (args.slug === "soft") {
        return {
          skill: {
            _id: "skills:soft",
            slug: "soft",
            displayName: "Soft",
          },
          owner: null,
          moderationInfo: null,
          version: softDeletedVersion,
        };
      }
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.skillSecurityVerdictsV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/skills/-/security-verdicts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items: [
            { slug: "missing", version: "1.0.0" },
            { slug: "no-version", version: "1.0.0" },
            { slug: "soft", version: "2.0.0" },
          ],
        }),
      }),
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.items).toHaveLength(3);
    expect(json.items.map((item: { ok: boolean }) => item.ok)).toEqual([false, false, false]);
    expect(json.items[0]).toMatchObject({
      requestedSlug: "missing",
      requestedVersion: "1.0.0",
      decision: "fail",
      reasons: ["skill.not_found"],
      error: { code: "skill_not_found", message: "Skill not found" },
    });
    expect(json.items[1]).toMatchObject({
      requestedSlug: "no-version",
      requestedVersion: "1.0.0",
      decision: "fail",
      reasons: ["version.not_found"],
      error: { code: "version_not_found", message: "Version not found" },
    });
    expect(json.items[2]).toMatchObject({
      requestedSlug: "soft",
      requestedVersion: "2.0.0",
      decision: "fail",
      reasons: ["version.unavailable"],
      error: { code: "version_unavailable", message: "Version not available" },
    });
  });

  it.each([
    {
      label: "suspicious",
      analysis: { status: "completed", verdict: "suspicious", checkedAt: 10 },
      reasons: ["security.status_not_clean"],
      security: { status: "suspicious", passed: false },
    },
    {
      label: "malicious",
      analysis: { status: "completed", verdict: "malicious", checkedAt: 10 },
      reasons: ["security.status_not_clean"],
      security: { status: "malicious", passed: false },
    },
    {
      label: "pending",
      analysis: { status: "completed", checkedAt: 11 },
      reasons: ["security.status_not_clean", "security.pending"],
      security: { status: "pending", passed: false },
    },
    {
      label: "error",
      analysis: { status: "failed", checkedAt: 12 },
      reasons: ["security.status_not_clean", "security.error"],
      security: { status: "error", passed: false },
    },
  ])("reports $label bulk security verdicts", async ({ analysis, reasons, security }) => {
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("slug" in args) {
        return {
          skill: {
            _id: "skills:1",
            slug: "demo",
            displayName: "Demo",
          },
          owner: null,
          moderationInfo: null,
          version: {
            _id: "skillVersions:1",
            skillId: "skills:1",
            version: "1.0.0",
            createdAt: 1,
            changelog: "c",
            files: [],
            llmAnalysis: analysis,
            softDeletedAt: undefined,
          },
        };
      }
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.skillSecurityVerdictsV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/skills/-/security-verdicts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: [{ slug: "demo", version: "1.0.0" }] }),
      }),
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.items[0]).toMatchObject({
      ok: false,
      decision: "fail",
      reasons,
      security,
    });
  });

  it("rejects malformed bulk security verdict request bodies", async () => {
    const runQuery = vi.fn();
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const nullBody = await __handlers.skillSecurityVerdictsV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/skills/-/security-verdicts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "null",
      }),
    );
    expect(nullBody.status).toBe(400);
    expect(await nullBody.text()).toBe("JSON body must be an object");

    const scalarBody = await __handlers.skillSecurityVerdictsV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/skills/-/security-verdicts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify("nope"),
      }),
    );
    expect(scalarBody.status).toBe(400);
    expect(await scalarBody.text()).toBe("JSON body must be an object");

    const missingItems = await __handlers.skillSecurityVerdictsV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/skills/-/security-verdicts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: [] }),
      }),
    );
    expect(missingItems.status).toBe(400);
    expect(await missingItems.text()).toBe("items must contain 1 to 100 entries");

    const duplicate = await __handlers.skillSecurityVerdictsV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/skills/-/security-verdicts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items: [
            { slug: "demo", version: "1.0.0" },
            { slug: "demo", version: "1.0.0" },
          ],
        }),
      }),
    );
    expect(duplicate.status).toBe(400);
    expect(await duplicate.text()).toBe("Duplicate item: demo@1.0.0");

    const ambiguous = await __handlers.skillSecurityVerdictsV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/skills/-/security-verdicts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: [{ slug: "demo", version: "1.0.0", tag: "latest" }] }),
      }),
    );
    expect(ambiguous.status).toBe(400);
    expect(await ambiguous.text()).toBe("items[0] uses version only; tag is not supported");

    expect(runQuery).not.toHaveBeenCalled();
  });

  it("returns a skill verification envelope with card and security metadata", async () => {
    const internalVersion = {
      _id: "skillVersions:1",
      skillId: "skills:1",
      version: "1.0.0",
      createdAt: 1,
      changelog: "c",
      fingerprint: "source-fingerprint",
      files: [
        {
          path: "SKILL.md",
          size: 5,
          storageId: "storage:1",
          sha256: "source-sha",
          contentType: "text/markdown",
        },
        {
          path: "skill-card.md",
          size: 12,
          storageId: "storage:card",
          sha256: "card-sha",
          contentType: "text/markdown",
        },
      ],
      parsed: { license: "MIT-0", clawdis: { requires: { env: ["TOKEN"] } } },
      sourceProvenance: {
        kind: "github",
        url: "https://github.com/acme/demo/tree/main/skills/demo",
        repo: "acme/demo",
        ref: "main",
        commit: "abc123",
        path: "skills/demo",
        importedAt: 10,
      },
      staticScan: {
        status: "clean",
        reasonCodes: [],
        findings: [],
        summary: "Static scan clean.",
        engineVersion: "static-v1",
        checkedAt: 2,
      },
      llmAnalysis: {
        status: "clean",
        verdict: "clean",
        confidence: "high",
        summary: "ClawScan clean.",
        checkedAt: 3,
        model: "gpt-test",
      },
      vtAnalysis: {
        status: "clean",
        verdict: "clean",
        analysis: "VirusTotal clean.",
        source: "engines",
        checkedAt: 4,
      },
      skillSpectorAnalysis: {
        status: "clean",
        score: 0,
        severity: "LOW",
        recommendation: "INSTALL",
        issueCount: 0,
        issues: [],
        scannerVersion: "skillspector-test",
        summary: "SkillSpector clean.",
        checkedAt: 5,
      },
      depRegistryAnalysis: {
        status: "clean",
        results: [],
        notFoundPackages: [],
        unresolvedPackages: [],
        summary: "No dependency issues.",
        checkedAt: 6,
      },
      capabilityTags: ["dev-tools"],
      softDeletedAt: undefined,
    };
    const generatedBundleFingerprint = await buildBundleFingerprint(internalVersion.files);
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("slug" in args) {
        return {
          skill: {
            _id: "skills:1",
            slug: "demo",
            displayName: "Demo",
            summary: "s",
            tags: { stable: "skillVersions:1" },
            stats: {},
            createdAt: 1,
            updatedAt: 2,
            latestVersionId: "skillVersions:1",
          },
          latestVersion: { _id: "skillVersions:1", version: "1.0.0" },
          owner: { _id: "users:1", handle: "acme", displayName: "Acme" },
        };
      }
      if ("skillVersionId" in args) {
        return [
          { fingerprint: generatedBundleFingerprint, kind: "generated-bundle", createdAt: 5 },
        ];
      }
      if ("versionId" in args) return internalVersion;
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.skillsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation, storage: { get: vi.fn() } }),
      new Request("https://example.com/api/v1/skills/demo/verify?tag=stable"),
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toMatchObject({
      schema: "clawhub.skill.verify.v1",
      ok: true,
      decision: "pass",
      reasons: [],
      slug: "demo",
      displayName: "Demo",
      pageUrl: "https://clawhub.ai/acme/demo",
      publisherHandle: "acme",
      publisherDisplayName: "Acme",
      publisherProfileUrl: "https://clawhub.ai/user/acme",
      version: "1.0.0",
      resolvedFrom: "tag",
      tag: "stable",
      createdAt: 1,
      card: {
        available: true,
        path: "skill-card.md",
        url: "https://example.com/api/v1/skills/demo/card?version=1.0.0",
        sha256: "card-sha",
        size: 12,
      },
      artifact: {
        sourceFingerprint: "source-fingerprint",
        bundleFingerprints: [generatedBundleFingerprint],
        files: [{ path: "SKILL.md", sha256: "source-sha", size: 5 }],
      },
      provenance: {
        source: "server-resolved-github-import",
        repo: "acme/demo",
        commit: "abc123",
        path: "skills/demo",
      },
      security: {
        status: "clean",
        passed: true,
        rawStatus: "clean",
        verdict: "clean",
        confidence: "high",
        summary: "ClawScan clean.",
        model: "gpt-test",
        checkedAt: 3,
        signals: {
          staticScan: { status: "clean", rawStatus: "clean", reasonCodes: [] },
          virusTotal: {
            status: "clean",
            rawStatus: "clean",
            verdict: "clean",
            source: "engines",
          },
          skillSpector: {
            status: "clean",
            rawStatus: "clean",
            score: 0,
            recommendation: "INSTALL",
            issueCount: 0,
          },
          dependencyRegistry: { status: "clean" },
        },
      },
      signature: { status: "unsigned" },
    });
    expect(json.skill).toBeUndefined();
    expect(json.publisher).toBeUndefined();
  });

  it("does not let publisher-supplied skill-card.md satisfy verification", async () => {
    const internalVersion = {
      _id: "skillVersions:1",
      skillId: "skills:1",
      version: "1.0.0",
      createdAt: 1,
      changelog: "c",
      fingerprint: "source-fingerprint",
      files: [
        { path: "SKILL.md", size: 5, storageId: "storage:1", sha256: "source-sha" },
        { path: "skill-card.md", size: 12, storageId: "storage:card", sha256: "card-sha" },
      ],
      parsed: {},
      staticScan: {
        status: "clean",
        reasonCodes: [],
        findings: [],
        summary: "Static scan clean.",
        checkedAt: 2,
      },
      llmAnalysis: {
        status: "clean",
        verdict: "clean",
        summary: "ClawScan clean.",
        checkedAt: 3,
      },
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
      if ("skillVersionId" in args) {
        return [{ fingerprint: "source-fingerprint", kind: "source", createdAt: 4 }];
      }
      if ("versionId" in args) return internalVersion;
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.skillsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation, storage: { get: vi.fn() } }),
      new Request("https://example.com/api/v1/skills/demo/verify"),
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.ok).toBe(false);
    expect(json.decision).toBe("fail");
    expect(json.reasons).toEqual(["card.missing"]);
    expect(json.card).toMatchObject({
      available: false,
      path: "skill-card.md",
      sha256: null,
      size: null,
    });
    expect(json.artifact.bundleFingerprints).toEqual([]);
  });

  it("fails verification when the skill is malware-blocked by moderation", async () => {
    const internalVersion = {
      _id: "skillVersions:1",
      skillId: "skills:1",
      version: "1.0.0",
      createdAt: 1,
      changelog: "c",
      fingerprint: "source-fingerprint",
      files: [
        { path: "SKILL.md", size: 5, storageId: "storage:1", sha256: "source-sha" },
        { path: "skill-card.md", size: 12, storageId: "storage:card", sha256: "card-sha" },
      ],
      parsed: {},
      staticScan: {
        status: "clean",
        reasonCodes: [],
        findings: [],
        summary: "Static scan clean.",
        checkedAt: 2,
      },
      llmAnalysis: {
        status: "clean",
        verdict: "clean",
        summary: "ClawScan clean.",
        checkedAt: 3,
      },
      softDeletedAt: undefined,
    };
    const generatedBundleFingerprint = await buildBundleFingerprint(internalVersion.files);
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
          moderationInfo: {
            isPendingScan: false,
            isMalwareBlocked: true,
            isSuspicious: false,
            isHiddenByMod: false,
            isRemoved: false,
          },
        };
      }
      if ("skillVersionId" in args) {
        return [
          { fingerprint: generatedBundleFingerprint, kind: "generated-bundle", createdAt: 4 },
        ];
      }
      if ("versionId" in args) return internalVersion;
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.skillsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation, storage: { get: vi.fn() } }),
      new Request("https://example.com/api/v1/skills/demo/verify"),
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.ok).toBe(false);
    expect(json.decision).toBe("fail");
    expect(json.reasons).toEqual(["moderation.malware_blocked"]);
    expect(json.security).toMatchObject({ status: "clean", passed: true });
  });

  it("passes verification when static and dependency findings are advisory but ClawScan is clean", async () => {
    const internalVersion = {
      _id: "skillVersions:1",
      skillId: "skills:1",
      version: "1.0.0",
      createdAt: 1,
      changelog: "c",
      fingerprint: "source-fingerprint",
      files: [
        { path: "SKILL.md", size: 5, storageId: "storage:1", sha256: "source-sha" },
        { path: "skill-card.md", size: 12, storageId: "storage:card", sha256: "card-sha" },
      ],
      parsed: {},
      staticScan: {
        status: "malicious",
        reasonCodes: ["suspicious.external_api"],
        findings: [],
        summary: "Static advisory warning.",
        engineVersion: "static-v1",
        checkedAt: 2,
      },
      llmAnalysis: {
        status: "clean",
        verdict: "benign",
        summary: "ClawScan clean.",
        checkedAt: 3,
      },
      depRegistryAnalysis: {
        status: "malicious",
        results: [],
        notFoundPackages: ["left-pad"],
        unresolvedPackages: [],
        summary: "Dependency advisory warning.",
        checkedAt: 4,
      },
      softDeletedAt: undefined,
    };
    const generatedBundleFingerprint = await buildBundleFingerprint(internalVersion.files);
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
      if ("skillVersionId" in args) {
        return [
          { fingerprint: generatedBundleFingerprint, kind: "generated-bundle", createdAt: 4 },
        ];
      }
      if ("versionId" in args) return internalVersion;
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.skillsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation, storage: { get: vi.fn() } }),
      new Request("https://example.com/api/v1/skills/demo/verify"),
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.ok).toBe(true);
    expect(json.decision).toBe("pass");
    expect(json.reasons).toEqual([]);
    expect(json.security).toMatchObject({
      status: "clean",
      passed: true,
      rawStatus: "clean",
      verdict: "benign",
      signals: {
        staticScan: { status: "malicious", rawStatus: "malicious" },
        dependencyRegistry: { status: "malicious", rawStatus: "malicious" },
      },
    });
  });

  it("returns ok false when verification has no card or clean scan result", async () => {
    const internalVersion = {
      _id: "skillVersions:1",
      skillId: "skills:1",
      version: "1.0.0",
      createdAt: 1,
      changelog: "c",
      fingerprint: "source-fingerprint",
      files: [{ path: "SKILL.md", size: 5, storageId: "storage:1", sha256: "source-sha" }],
      parsed: {},
      staticScan: {
        status: "clean",
        reasonCodes: [],
        findings: [],
        summary: "Static scan clean.",
        engineVersion: "static-v1",
        checkedAt: 2,
      },
      llmAnalysis: {
        status: "completed",
        verdict: "suspicious",
        summary: "Review risky behavior.",
        checkedAt: 3,
      },
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
      if ("skillVersionId" in args) return [];
      if ("versionId" in args) return internalVersion;
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.skillsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation, storage: { get: vi.fn() } }),
      new Request("https://example.com/api/v1/skills/demo/verify"),
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.ok).toBe(false);
    expect(json.decision).toBe("fail");
    expect(json.reasons).toEqual(["card.missing", "security.status_not_clean"]);
    expect(json.card.available).toBe(false);
    expect(json.security).toMatchObject({ status: "suspicious", passed: false });
  });

  it("returns 410 for soft-deleted Skill Card versions", async () => {
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
      if ("versionId" in args) return { skillId: "skills:1", softDeletedAt: 123, files: [] };
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.skillsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation, storage: { get: vi.fn() } }),
      new Request("https://example.com/api/v1/skills/demo/card"),
    );

    expect(response.status).toBe(410);
  });

  it("returns 413 when raw file too large", async () => {
    const internalVersion = {
      skillId: "skills:1",
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

  it("keeps client-declared publish source out of trusted provenance options", async () => {
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
    const source = {
      kind: "github",
      url: "https://github.com/spoofed/repo",
      repo: "spoofed/repo",
      ref: "main",
      commit: "f".repeat(40),
      path: "skills/demo",
      importedAt: 123,
    };
    const body = JSON.stringify({
      slug: "demo",
      displayName: "Demo",
      version: "1.0.0",
      changelog: "c",
      acceptLicenseTerms: true,
      source,
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
    expect(publishVersionForUser).toHaveBeenCalledWith(
      expect.anything(),
      "users:1",
      expect.objectContaining({ source }),
    );
    expect(vi.mocked(publishVersionForUser).mock.calls[0]?.[3]).toBeUndefined();
  });

  it("publish json resolves requested owner publisher", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValueOnce({
      userId: "users:1",
      user: { handle: "p" },
    } as never);
    vi.mocked(publishVersionForUser).mockResolvedValueOnce({
      skillId: "s",
      versionId: "v",
      embeddingId: "e",
    } as never);
    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate();
      if (args.ownerHandle === "openclaw") return { publisherId: "publishers:openclaw" };
      return okRate();
    });
    const body = JSON.stringify({
      slug: "demo",
      displayName: "Demo",
      ownerHandle: "@openclaw",
      migrateOwner: true,
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
    expect(runMutation).toHaveBeenCalledWith(
      internal.publishers.resolvePublishTargetForUserInternal,
      {
        actorUserId: "users:1",
        ownerHandle: "openclaw",
        minimumRole: "publisher",
      },
    );
    expect(publishVersionForUser).toHaveBeenCalledWith(
      expect.anything(),
      "users:1",
      expect.not.objectContaining({ ownerHandle: expect.anything() }),
      { ownerPublisherId: "publishers:openclaw", migrateOwner: true },
    );
  });

  it("publish json returns owner resolution errors", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValueOnce({
      userId: "users:1",
      user: { handle: "p" },
    } as never);
    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate();
      throw new Error("Publisher not found");
    });
    const body = JSON.stringify({
      slug: "demo",
      displayName: "Demo",
      ownerHandle: "@missing",
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
    expect(response.status).toBe(400);
    expect(await response.text()).toMatch(/publisher not found/i);
    expect(publishVersionForUser).not.toHaveBeenCalled();
  });

  it("publish json rejects omitted license terms", async () => {
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
    expect(publishVersionForUser).not.toHaveBeenCalled();
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

  it("publish multipart resolves requested owner publisher", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValueOnce({
      userId: "users:1",
      user: { handle: "p" },
    } as never);
    vi.mocked(publishVersionForUser).mockResolvedValueOnce({
      skillId: "s",
      versionId: "v",
      embeddingId: "e",
    } as never);
    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate();
      if (args.ownerHandle === "openclaw") return { publisherId: "publishers:openclaw" };
      return okRate();
    });
    const form = new FormData();
    form.set(
      "payload",
      JSON.stringify({
        slug: "demo",
        displayName: "Demo",
        ownerHandle: "@openclaw",
        migrateOwner: true,
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
    expect(response.status).toBe(200);
    expect(publishVersionForUser).toHaveBeenCalledWith(
      expect.anything(),
      "users:1",
      expect.not.objectContaining({ ownerHandle: expect.anything() }),
      { ownerPublisherId: "publishers:openclaw", migrateOwner: true },
    );
  });

  it("publish multipart rejects omitted license terms", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValueOnce({
      userId: "users:1",
      user: { handle: "p" },
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
    expect(response.status).toBe(400);
    expect(await response.text()).toMatch(/license terms must be accepted/i);
    expect(publishVersionForUser).not.toHaveBeenCalled();
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
    expect(json.user.role).toBeNull();
  });

  it("delete and undelete require auth", async () => {
    vi.mocked(requireApiTokenUser).mockRejectedValueOnce(
      new Error("Unauthorized: API token is invalid or revoked. Run `clawhub login` again."),
    );
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const response = await __handlers.skillsDeleteRouterV1Handler(
      makeCtx({ runMutation }),
      new Request("https://example.com/api/v1/skills/demo", { method: "DELETE" }),
    );
    expect(response.status).toBe(401);
    expect(await response.text()).toBe(
      "Unauthorized: API token is invalid or revoked. Run `clawhub login` again.",
    );

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
      return args.deleted ? { ok: true, slugReservedUntil: 123 } : { ok: true };
    });

    const response = await __handlers.skillsDeleteRouterV1Handler(
      makeCtx({ runMutation }),
      new Request("https://example.com/api/v1/skills/demo", {
        method: "DELETE",
        headers: { Authorization: "Bearer clh_test" },
        body: JSON.stringify({ reason: "legal hold" }),
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, slugReservedUntil: 123 });
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "users:1",
        slug: "demo",
        deleted: true,
        reason: "legal hold",
      }),
    );

    const response2 = await __handlers.skillsPostRouterV1Handler(
      makeCtx({ runMutation }),
      new Request("https://example.com/api/v1/skills/demo/undelete", {
        method: "POST",
        headers: { Authorization: "Bearer clh_test" },
        body: JSON.stringify({ reason: "reviewed" }),
      }),
    );
    expect(response2.status).toBe(200);
    expect(await response2.json()).toEqual({ ok: true });
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "users:1",
        slug: "demo",
        deleted: false,
        reason: "reviewed",
      }),
    );
  });

  it("skill rescan enqueues owner-authorized ClawScan jobs", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:moderator",
      user: { _id: "users:moderator", role: "moderator" },
    } as never);
    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate();
      return {
        ok: true,
        slug: "demo",
        version: "1.0.0",
        skillId: "skills:1",
        skillVersionId: "skillVersions:1",
        jobId: "securityScanJobs:1",
        alreadyQueued: false,
      };
    });

    const response = await __handlers.skillsPostRouterV1Handler(
      makeCtx({ runMutation }),
      new Request("https://example.com/api/v1/skills/demo/rescan", {
        method: "POST",
        headers: { Authorization: "Bearer clh_test" },
        body: JSON.stringify({ version: "1.0.0" }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      slug: "demo",
      version: "1.0.0",
      jobId: "securityScanJobs:1",
    });
    expect(runMutation).toHaveBeenCalledWith(
      (internal as unknown as { securityScan: Record<string, unknown> }).securityScan
        .requestSkillRescanForUserInternal,
      {
        actorUserId: "users:moderator",
        slug: "demo",
        version: "1.0.0",
      },
    );
  });

  it("skill rescan rejects malformed JSON", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:moderator",
      user: { _id: "users:moderator", role: "moderator" },
    } as never);
    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate();
      throw new Error("should not enqueue");
    });

    const response = await __handlers.skillsPostRouterV1Handler(
      makeCtx({ runMutation }),
      new Request("https://example.com/api/v1/skills/demo/rescan", {
        method: "POST",
        headers: { Authorization: "Bearer clh_test" },
        body: "{",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe("Invalid JSON");
    expect(runMutation).toHaveBeenCalledTimes(1);
  });

  it("bulk skill rescan batch requires admin role", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:moderator",
      user: { _id: "users:moderator", role: "moderator" },
    } as never);
    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate();
      throw new Error("should not enqueue");
    });

    const response = await __handlers.skillsPostRouterV1Handler(
      makeCtx({ runMutation }),
      new Request("https://example.com/api/v1/skills/-/rescan-batch", {
        method: "POST",
        headers: { Authorization: "Bearer clh_test" },
        body: JSON.stringify({ batchSize: 25 }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.text()).resolves.toBe("Admin role required.");
    expect(runMutation).toHaveBeenCalledTimes(1);
  });

  it("bulk skill rescan batch enqueues via admin API", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:admin",
      user: { _id: "users:admin", role: "admin" },
    } as never);
    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate();
      return {
        ok: true,
        mode: "all-active-latest",
        queued: 2,
        alreadyQueued: 1,
        skipped: 0,
        jobIds: ["securityScanJobs:1", "securityScanJobs:2", "securityScanJobs:3"],
        nextCursor: "cursor-2",
        done: false,
        sampleSlugs: ["demo"],
      };
    });

    const response = await __handlers.skillsPostRouterV1Handler(
      makeCtx({ runMutation }),
      new Request("https://example.com/api/v1/skills/-/rescan-batch", {
        method: "POST",
        headers: { Authorization: "Bearer clh_test" },
        body: JSON.stringify({ batchSize: 25, cursor: null, dryRun: false }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      queued: 2,
      alreadyQueued: 1,
      nextCursor: "cursor-2",
    });
    expect(runMutation).toHaveBeenCalledWith(
      (internal as unknown as { securityScan: Record<string, unknown> }).securityScan
        .enqueueBulkSkillRescanBatchForAdminInternal,
      {
        actorUserId: "users:admin",
        cursor: null,
        batchSize: 25,
        dryRun: false,
      },
    );
  });

  it("bulk skill rescan status aggregates via admin API", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:admin",
      user: { _id: "users:admin", role: "admin" },
    } as never);
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate();
      return {
        ok: true,
        total: 2,
        queued: 0,
        running: 1,
        succeeded: 1,
        failed: 0,
        missing: 0,
        terminal: 1,
        done: false,
        failedJobIds: [],
      };
    });

    const response = await __handlers.skillsPostRouterV1Handler(
      makeCtx({ runQuery }),
      new Request("https://example.com/api/v1/skills/-/rescan-batch/status", {
        method: "POST",
        headers: { Authorization: "Bearer clh_test" },
        body: JSON.stringify({ jobIds: ["securityScanJobs:1", "securityScanJobs:2"] }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      total: 2,
      running: 1,
      done: false,
    });
    expect(runQuery).toHaveBeenCalledWith(
      (internal as unknown as { securityScan: Record<string, unknown> }).securityScan
        .getBulkSkillRescanBatchStatusForAdminInternal,
      {
        actorUserId: "users:admin",
        jobIds: ["securityScanJobs:1", "securityScanJobs:2"],
      },
    );
  });

  it("VT pending repair requires admin role", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:moderator",
      user: { _id: "users:moderator", role: "moderator" },
    } as never);
    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate();
      throw new Error("should not repair");
    });

    const response = await __handlers.skillsPostRouterV1Handler(
      makeCtx({ runMutation }),
      new Request("https://example.com/api/v1/skills/-/repair-vt-pending", {
        method: "POST",
        headers: { Authorization: "Bearer clh_test" },
        body: JSON.stringify({ batchSize: 25, dryRun: true }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.text()).resolves.toBe("Admin role required.");
    expect(runMutation).toHaveBeenCalledTimes(1);
  });

  it("VT pending repair invokes the internal repair action via admin API", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:admin",
      user: { _id: "users:admin", role: "admin" },
    } as never);
    const runAction = vi.fn(async () => ({
      dryRun: true,
      total: 2,
      wouldUpdate: 2,
      updated: 0,
      noResults: 0,
      noDecisiveStats: 0,
      errors: 0,
      done: false,
      cursor: "cursor-2",
      statusCounts: { clean: 2 },
      sampleUpdated: [{ slug: "demo", status: "clean" }],
    }));

    const response = await __handlers.skillsPostRouterV1Handler(
      makeCtx({ runAction }),
      new Request("https://example.com/api/v1/skills/-/repair-vt-pending", {
        method: "POST",
        headers: { Authorization: "Bearer clh_test" },
        body: JSON.stringify({ batchSize: 25, cursor: null, dryRun: true }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      dryRun: true,
      wouldUpdate: 2,
      cursor: "cursor-2",
    });
    expect(runAction).toHaveBeenCalledWith(
      (internal as unknown as { vt: Record<string, unknown> }).vt.repairPendingSkillVtAnalysis,
      {
        dryRun: true,
        cursor: null,
        batchSize: 25,
      },
    );
  });

  it("package rescan enqueues owner-authorized ClawScan jobs", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:1",
      user: { handle: "p" },
    } as never);
    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate();
      return {
        ok: true,
        name: "@scope/demo",
        version: "1.2.3",
        packageId: "packages:1",
        packageReleaseId: "packageReleases:1",
        jobId: "securityScanJobs:1",
        alreadyQueued: false,
      };
    });

    const response = await __handlers.packagesPostRouterV1Handler(
      makeCtx({ runMutation }),
      new Request("https://example.com/api/v1/packages/%40scope%2Fdemo/rescan", {
        method: "POST",
        headers: { Authorization: "Bearer clh_test" },
        body: JSON.stringify({ version: "1.2.3" }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      name: "@scope/demo",
      version: "1.2.3",
      jobId: "securityScanJobs:1",
    });
    expect(runMutation).toHaveBeenCalledWith(
      (internal as unknown as { securityScan: Record<string, unknown> }).securityScan
        .requestPackageRescanForUserInternal,
      {
        actorUserId: "users:1",
        name: "@scope/demo",
        version: "1.2.3",
      },
    );
  });

  it("package rescan rejects malformed JSON", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:1",
      user: { handle: "p" },
    } as never);
    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate();
      throw new Error("should not enqueue");
    });

    const response = await __handlers.packagesPostRouterV1Handler(
      makeCtx({ runMutation }),
      new Request("https://example.com/api/v1/packages/%40scope%2Fdemo/rescan", {
        method: "POST",
        headers: { Authorization: "Bearer clh_test" },
        body: "{",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe("Invalid JSON");
    expect(runMutation).toHaveBeenCalledTimes(1);
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

  it("skill transfer maps ownership denials to 403", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:stranger",
      user: { handle: "stranger" },
    } as never);

    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("slug" in args) return { _id: "skills:1", slug: "demo" };
      return null;
    });
    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if ("key" in args) return okRate();
      throw new Error("Forbidden: Only owners can transfer this skill.");
    });

    const response = await __handlers.skillsPostRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/skills/demo/transfer", {
        method: "POST",
        headers: { Authorization: "Bearer clh_test", "content-type": "application/json" },
        body: JSON.stringify({ toUserHandle: "alice" }),
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.text()).toBe("Forbidden: Only owners can transfer this skill.");
  });

  it("transfers a skill directly to an org publisher when the target handle is an org", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:1",
      user: { handle: "p" },
    } as never);

    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("slug" in args) return { _id: "skills:1", slug: "demo" };
      if ("handle" in args) return { _id: "publishers:org", kind: "org", handle: "team" };
      return null;
    });
    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if ("key" in args) return okRate();
      return {
        ok: true,
        transferred: true,
        skillSlug: "demo",
        toPublisherHandle: "team",
      };
    });

    const response = await __handlers.skillsPostRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/skills/demo/transfer", {
        method: "POST",
        headers: { Authorization: "Bearer clh_test", "content-type": "application/json" },
        body: JSON.stringify({ toUserHandle: "@team" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      transferred: true,
      toPublisherHandle: "team",
    });
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorUserId: "users:1",
        slug: "demo",
        toOwner: "@team",
      }),
    );
  });

  it("transfers a skill directly to the actor's personal publisher", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:1",
      user: { handle: "p" },
    } as never);

    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("slug" in args) return { _id: "skills:1", slug: "demo" };
      if ("handle" in args) {
        return {
          _id: "publishers:self",
          kind: "user",
          handle: "steipete",
          linkedUserId: "users:1",
        };
      }
      return null;
    });
    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if ("key" in args) return okRate();
      return {
        ok: true,
        transferred: true,
        skillSlug: "demo",
        toPublisherHandle: "steipete",
      };
    });

    const response = await __handlers.skillsPostRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/skills/demo/transfer", {
        method: "POST",
        headers: { Authorization: "Bearer clh_test", "content-type": "application/json" },
        body: JSON.stringify({ toUserHandle: "@steipete" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      transferred: true,
      toPublisherHandle: "steipete",
    });
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorUserId: "users:1",
        slug: "demo",
        toOwner: "@steipete",
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

  it("transfer accept maps committed cancellation failures to an error response", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:1",
      user: { handle: "p" },
    } as never);

    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("slug" in args) return { _id: "skills:1", slug: "demo" };
      if ("toUserId" in args) {
        return {
          _id: "skillOwnershipTransfers:1",
          skillId: "skills:1",
          toUserId: "users:1",
          status: "pending",
        };
      }
      return null;
    });
    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if ("key" in args) return okRate();
      return { ok: false, error: "Skill is under moderation" };
    });

    const response = await __handlers.skillsPostRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/skills/demo/transfer/accept", {
        method: "POST",
        headers: { Authorization: "Bearer clh_test" },
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Skill is under moderation");
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

  it("unban user requires auth", async () => {
    vi.mocked(requireApiTokenUser).mockRejectedValueOnce(new Error("Unauthorized"));
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const response = await __handlers.usersPostRouterV1Handler(
      makeCtx({ runMutation }),
      new Request("https://example.com/api/v1/users/unban", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: "demo" }),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("unban user succeeds with handle", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:1",
      user: { handle: "p" },
    } as never);
    const runQuery = vi.fn().mockResolvedValue({ _id: "users:2" });
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce(okRate())
      .mockResolvedValueOnce({ ok: true, alreadyUnbanned: false, restoredSkills: 2 });
    const response = await __handlers.usersPostRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/users/unban", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: "demo" }),
      }),
    );
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.restoredSkills).toBe(2);
  });

  it("unban user forwards reason", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:1",
      user: { handle: "p" },
    } as never);
    const runQuery = vi.fn().mockResolvedValue({ _id: "users:2" });
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce(okRate())
      .mockResolvedValueOnce({ ok: true, alreadyUnbanned: false, restoredSkills: 0 });
    await __handlers.usersPostRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/users/unban", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: "demo", reason: "appeal accepted" }),
      }),
    );
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorUserId: "users:1",
        targetUserId: "users:2",
        reason: "appeal accepted",
      }),
    );
  });

  it("remediate autobans requires admin", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:actor",
      user: { _id: "users:actor", role: "user" },
    } as never);
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const response = await __handlers.usersPostRouterV1Handler(
      makeCtx({ runMutation }),
      new Request("https://example.com/api/v1/users/remediate-autobans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dryRun: true }),
      }),
    );
    expect(response.status).toBe(403);
  });

  it("remediate autobans forwards admin payload", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:admin",
      user: { _id: "users:admin", role: "admin" },
    } as never);
    const runMutation = vi.fn().mockResolvedValueOnce(okRate()).mockResolvedValueOnce({
      ok: true,
      dryRun: false,
      scanned: 1,
      wouldUnban: 0,
      unbanned: 1,
      skipped: 0,
      restoredSkills: 12,
      restoredPackages: 0,
      items: [],
      nextCursor: null,
      done: true,
    });
    const response = await __handlers.usersPostRouterV1Handler(
      makeCtx({ runMutation }),
      new Request("https://example.com/api/v1/users/remediate-autobans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dryRun: false,
          userId: "users:target",
          reason: "appeal accepted",
          since: "2026-05-12",
          cursor: "cursor-1",
          limit: 5,
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorUserId: "users:admin",
        targetUserId: "users:target",
        dryRun: false,
        reason: "appeal accepted",
        since: "2026-05-12",
        cursor: "cursor-1",
        limit: 5,
      }),
    );
  });

  it("reclassify ban requires admin", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:actor",
      user: { _id: "users:actor", role: "user" },
    } as never);
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const response = await __handlers.usersPostRouterV1Handler(
      makeCtx({ runMutation }),
      new Request("https://example.com/api/v1/users/reclassify-ban", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle: "demo", reason: "bulk publishing spam" }),
      }),
    );
    expect(response.status).toBe(403);
  });

  it("reclassify ban forwards admin payload", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:admin",
      user: { _id: "users:admin", role: "admin" },
    } as never);
    const runMutation = vi.fn().mockResolvedValueOnce(okRate()).mockResolvedValueOnce({
      ok: true,
      dryRun: false,
      userId: "users:target",
      handle: "demo",
      previousReason: "malware auto-ban",
      nextReason: "bulk publishing spam",
      changed: true,
    });
    const response = await __handlers.usersPostRouterV1Handler(
      makeCtx({ runMutation }),
      new Request("https://example.com/api/v1/users/reclassify-ban", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dryRun: false,
          userId: "users:target",
          reason: "bulk publishing spam",
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorUserId: "users:admin",
        targetUserId: "users:target",
        dryRun: false,
        reason: "bulk publishing spam",
      }),
    );
  });

  it("reclassify ban resolves banned users by handle", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:admin",
      user: { _id: "users:admin", role: "admin" },
    } as never);
    const runQuery = vi.fn().mockResolvedValue({ _id: "users:target", deletedAt: 123 });
    const runMutation = vi.fn().mockResolvedValueOnce(okRate()).mockResolvedValueOnce({
      ok: true,
      dryRun: true,
      userId: "users:target",
      handle: "demo",
      previousReason: "malware auto-ban",
      nextReason: "bulk publishing spam",
      changed: true,
    });
    const response = await __handlers.usersPostRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/users/reclassify-ban", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          handle: "demo",
          reason: "bulk publishing spam",
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(runQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ handle: "demo" }),
    );
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        targetUserId: "users:target",
        dryRun: true,
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
    const runQuery = vi.fn((_, args: Record<string, unknown>) => {
      if ("query" in args) return [];
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const response = await __handlers.packagesGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request(
        "https://example.com/api/v1/packages/search?q=test&executesCode=true&capabilityTag=tools&limit=5",
      ),
    );
    if (response.status !== 200) throw new Error(await response.text());
    expect(runQuery.mock.calls.map(([, args]) => args)).toContainEqual(
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

  it("packages search maps environment filters to capability tags", async () => {
    const runQuery = vi.fn((_, args: Record<string, unknown>) => {
      if ("query" in args) return [];
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const response = await __handlers.packagesGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/packages/search?q=test&requiresBrowser=true"),
    );
    if (response.status !== 200) throw new Error(await response.text());
    expect(runQuery.mock.calls.map(([, args]) => args)).toContainEqual(
      expect.objectContaining({
        capabilityTag: "requires:browser",
      }),
    );
  });

  it("packages search maps artifact filters to capability tags", async () => {
    const runQuery = vi.fn((_, args: Record<string, unknown>) => {
      if ("query" in args) return [];
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const response = await __handlers.packagesGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/packages/search?q=test&artifactKind=npm-pack"),
    );
    if (response.status !== 200) throw new Error(await response.text());
    expect(runQuery.mock.calls.map(([, args]) => args)).toContainEqual(
      expect.objectContaining({
        capabilityTag: "artifact:npm-pack",
      }),
    );
  });

  it("packages search rejects invalid known filters", async () => {
    const runQuery = vi.fn();
    const runMutation = vi.fn().mockResolvedValue(okRate());

    for (const [param, message] of [
      ["family=bad", "Invalid family query parameter"],
      ["channel=bad", "Invalid channel query parameter"],
      ["isOfficial=maybe", "Invalid isOfficial query parameter"],
      ["executesCode=maybe", "Invalid executesCode query parameter"],
      ["featured=maybe", "Invalid featured query parameter"],
      ["artifactKind=bad", "Invalid artifactKind query parameter"],
      ["requiresBrowser=maybe", "Invalid requiresBrowser query parameter"],
    ]) {
      const response = await __handlers.packagesGetRouterV1Handler(
        makeCtx({ runQuery, runMutation }),
        new Request(`https://example.com/api/v1/packages/search?q=test&${param}`),
      );
      expect(response.status).toBe(400);
      expect(await response.text()).toBe(message);
    }

    expect(runQuery).not.toHaveBeenCalled();
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

  it("packages list rejects invalid known filters but ignores unknown params", async () => {
    const runQuery = vi.fn().mockResolvedValue({ page: [], isDone: true, continueCursor: "" });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const invalid = await __handlers.listPackagesV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/packages?family=bad"),
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.text()).toBe("Invalid family query parameter");

    const unknown = await __handlers.listPackagesV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/packages?unknown=bad&limit=7"),
    );
    expect(unknown.status).toBe(200);
    expect(runQuery).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        paginationOpts: { cursor: null, numItems: 7 },
      }),
    );
  });

  it("packages list supports category when scoped to a plugin family", async () => {
    const runQuery = vi.fn().mockResolvedValue({ page: [], isDone: true, continueCursor: "" });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.listPackagesV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/packages?family=code-plugin&category=data&limit=7"),
    );

    expect(response.status).toBe(200);
    expect(runQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        family: "code-plugin",
        category: "data",
        paginationOpts: { cursor: null, numItems: 7 },
      }),
    );
  });

  it("plugins list defaults to plugin package families", async () => {
    const codePlugin = {
      name: "code-plugin",
      displayName: "Code Plugin",
      family: "code-plugin",
      channel: "community",
      isOfficial: false,
      createdAt: 20,
      updatedAt: 200,
    };
    const bundlePlugin = {
      name: "bundle-plugin",
      displayName: "Bundle Plugin",
      family: "bundle-plugin",
      channel: "community",
      isOfficial: false,
      createdAt: 10,
      updatedAt: 100,
    };
    const runQuery = vi.fn((_, args: Record<string, unknown>) => {
      if (args.family === "code-plugin") {
        return { page: [codePlugin], isDone: true, continueCursor: "" };
      }
      if (args.family === "bundle-plugin") {
        return { page: [bundlePlugin], isDone: true, continueCursor: "" };
      }
      throw new Error(`unexpected family ${String(args.family)}`);
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.listPluginsV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/plugins?limit=7"),
    );

    expect(response.status).toBe(200);
    expect((await response.json()).items.map((entry: { name: string }) => entry.name)).toEqual([
      "code-plugin",
      "bundle-plugin",
    ]);
    const families = runQuery.mock.calls.map(([, args]) => (args as { family?: string }).family);
    expect(families).toEqual(["code-plugin", "bundle-plugin"]);
    for (const [, args] of runQuery.mock.calls) {
      expect(args).toEqual(
        expect.objectContaining({
          category: undefined,
          paginationOpts: { cursor: null, numItems: 7 },
        }),
      );
    }
  });

  it("plugins list forwards category to both plugin families", async () => {
    const runQuery = vi.fn().mockResolvedValue({ page: [], isDone: true, continueCursor: "" });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.listPluginsV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/plugins?category=data&limit=7"),
    );

    expect(response.status).toBe(200);
    for (const [, args] of runQuery.mock.calls) {
      expect(args).toEqual(
        expect.objectContaining({
          category: "data",
          paginationOpts: { cursor: null, numItems: 7 },
        }),
      );
    }
  });

  it("plugins list rejects invalid categories", async () => {
    const runQuery = vi.fn();
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.listPluginsV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/plugins?category=other"),
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Invalid plugin category");
    expect(runQuery).not.toHaveBeenCalled();
  });

  it("plugins list paginates with separate plugin family cursors", async () => {
    const codeNewest = makeCatalogItem("code-newest", {
      family: "code-plugin",
      updatedAt: 300,
    });
    const codeOlder = makeCatalogItem("code-older", {
      family: "code-plugin",
      updatedAt: 100,
    });
    const bundleMiddle = makeCatalogItem("bundle-middle", {
      family: "bundle-plugin",
      updatedAt: 200,
    });
    const runQuery = vi.fn((_, args: Record<string, unknown>) => {
      const pagination = args.paginationOpts as { cursor: string | null };
      if (args.family === "code-plugin" && pagination.cursor === null) {
        return { page: [codeNewest], isDone: false, continueCursor: "code-cursor" };
      }
      if (args.family === "code-plugin" && pagination.cursor === "code-cursor") {
        return { page: [codeOlder], isDone: true, continueCursor: "" };
      }
      if (args.family === "bundle-plugin" && pagination.cursor === null) {
        return { page: [bundleMiddle], isDone: true, continueCursor: "" };
      }
      throw new Error(`unexpected args ${JSON.stringify(args)}`);
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const firstResponse = await __handlers.listPluginsV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/plugins?limit=1"),
    );
    expect(firstResponse.status).toBe(200);
    const firstJson = await firstResponse.json();
    expect(firstJson.items.map((entry: { name: string }) => entry.name)).toEqual(["code-newest"]);
    expect(firstJson.nextCursor).toMatch(/^pkgplugins:/);

    const secondUrl = new URL("https://example.com/api/v1/plugins");
    secondUrl.searchParams.set("limit", "1");
    secondUrl.searchParams.set("cursor", firstJson.nextCursor);
    const secondResponse = await __handlers.listPluginsV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request(secondUrl),
    );
    expect(secondResponse.status).toBe(200);
    const secondJson = await secondResponse.json();
    expect(secondJson.items.map((entry: { name: string }) => entry.name)).toEqual([
      "bundle-middle",
    ]);

    const packageCalls = runQuery.mock.calls
      .map(([, args]) => args as { family?: string; paginationOpts?: { cursor: string | null } })
      .filter((args) => args.family === "code-plugin" || args.family === "bundle-plugin");
    expect(
      packageCalls.map((args) => ({
        family: args.family,
        cursor: args.paginationOpts?.cursor ?? null,
      })),
    ).toEqual([
      { family: "code-plugin", cursor: null },
      { family: "bundle-plugin", cursor: null },
      { family: "code-plugin", cursor: "code-cursor" },
      { family: "bundle-plugin", cursor: null },
    ]);
  });

  it("plugins list ignores stale plugin search cursors", async () => {
    const runQuery = vi.fn().mockResolvedValue({ page: [], isDone: true, continueCursor: "" });
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const staleSearchCursor = `pkgpluginsearch:${JSON.stringify({
      codePlugins: { cursor: "code-search", offset: 0, pageSize: 2, done: false },
      bundlePlugins: { cursor: null, offset: 0, pageSize: 2, done: true },
    })}`;

    const response = await __handlers.listPluginsV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request(
        `https://example.com/api/v1/plugins?limit=7&cursor=${encodeURIComponent(staleSearchCursor)}`,
      ),
    );

    expect(response.status).toBe(200);
    const packageCalls = runQuery.mock.calls
      .map(([, args]) => args as { family?: string; paginationOpts?: { cursor: string | null } })
      .filter((args) => args.family === "code-plugin" || args.family === "bundle-plugin");
    expect(packageCalls.map((args) => args.paginationOpts?.cursor ?? null)).toEqual([null, null]);
  });

  it("package and plugin lists ignore stale skill cursors", async () => {
    const runQuery = vi.fn().mockResolvedValue({ page: [], isDone: true, continueCursor: "" });
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const staleSkillCursor = `skillcat:${JSON.stringify({
      cursor: "skill-cursor",
      offset: 0,
      pageSize: 20,
      done: false,
    })}`;

    const packagesResponse = await __handlers.listPackagesV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request(
        `https://example.com/api/v1/packages?limit=7&cursor=${encodeURIComponent(staleSkillCursor)}`,
      ),
    );
    const pluginsResponse = await __handlers.listPluginsV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request(
        `https://example.com/api/v1/plugins?limit=7&cursor=${encodeURIComponent(staleSkillCursor)}`,
      ),
    );

    expect(packagesResponse.status).toBe(200);
    expect(pluginsResponse.status).toBe(200);
    const cursors = runQuery.mock.calls
      .map(([, args]) => (args as { paginationOpts?: { cursor: string | null } }).paginationOpts)
      .filter(Boolean)
      .map((pagination) => pagination?.cursor ?? null);
    expect(cursors).toEqual(cursors.map(() => null));
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

  it("packages search supports category when scoped to a plugin family", async () => {
    const runQuery = vi.fn().mockResolvedValue([]);
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.packagesGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request(
        "https://example.com/api/v1/packages/search?q=api&family=code-plugin&category=data",
      ),
    );

    expect(response.status).toBe(200);
    expect(runQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        query: "api",
        family: "code-plugin",
        category: "data",
      }),
    );
  });

  it("plugins search defaults to plugin package families", async () => {
    const runQuery = vi.fn((_, args: Record<string, unknown>) => {
      if (args.family === "code-plugin") {
        return [
          {
            score: 10,
            package: {
              name: "weather-code",
              displayName: "Weather Code",
              family: "code-plugin",
              channel: "community",
              isOfficial: false,
              createdAt: 10,
              updatedAt: 100,
            },
          },
        ];
      }
      if (args.family === "bundle-plugin") {
        return [
          {
            score: 10,
            package: {
              name: "weather-bundle",
              displayName: "Weather Bundle",
              family: "bundle-plugin",
              channel: "community",
              isOfficial: false,
              createdAt: 20,
              updatedAt: 200,
            },
          },
        ];
      }
      throw new Error(`unexpected family ${String(args.family)}`);
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.pluginsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/plugins/search?q=weather&category=data&limit=7"),
    );

    expect(response.status).toBe(200);
    expect(
      (await response.json()).results.map(
        (entry: { package: { name: string } }) => entry.package.name,
      ),
    ).toEqual(["weather-bundle", "weather-code"]);
    const families = runQuery.mock.calls.map(([, args]) => (args as { family?: string }).family);
    expect(families).toEqual(["code-plugin", "bundle-plugin"]);
    for (const [, args] of runQuery.mock.calls) {
      expect(args).toEqual(
        expect.objectContaining({
          query: "weather",
          category: "data",
          limit: 7,
        }),
      );
    }
  });

  it("plugins search dedupes and sorts results from both plugin families", async () => {
    const runQuery = vi.fn((_, args: Record<string, unknown>) => {
      if (args.family === "code-plugin") {
        return [
          {
            score: 10,
            package: makeCatalogItem("shared-plugin", { family: "code-plugin", updatedAt: 100 }),
          },
          {
            score: 50,
            package: makeCatalogItem("plugin-code", { family: "code-plugin", updatedAt: 50 }),
          },
        ];
      }
      if (args.family === "bundle-plugin") {
        return [
          {
            score: 70,
            package: makeCatalogItem("plugin-bundle", { family: "bundle-plugin", updatedAt: 80 }),
          },
          {
            score: 10,
            package: makeCatalogItem("shared-plugin", {
              family: "bundle-plugin",
              updatedAt: 60,
            }),
          },
        ];
      }
      throw new Error(`unexpected family ${String(args.family)}`);
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.pluginsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/plugins/search?q=plugin&limit=3"),
    );

    expect(response.status).toBe(200);
    expect(
      (await response.json()).results.map(
        (entry: { score: number; package: { family: string; name: string } }) => ({
          family: entry.package.family,
          name: entry.package.name,
        }),
      ),
    ).toEqual([
      { family: "bundle-plugin", name: "plugin-bundle" },
      { family: "code-plugin", name: "plugin-code" },
      { family: "code-plugin", name: "shared-plugin" },
    ]);
  });

  it("plugins search ignores client-only sort and cursor params", async () => {
    const runQuery = vi.fn((_, args: Record<string, unknown>) => {
      expect(args).not.toHaveProperty("sort");
      expect(args).not.toHaveProperty("cursor");
      return [];
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const url = new URL("https://example.com/api/v1/plugins/search");
    url.searchParams.set("q", "plugin");
    url.searchParams.set("sort", "name");
    url.searchParams.set("limit", "2");
    url.searchParams.set("cursor", "pkgplugins:stale");

    const response = await __handlers.pluginsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request(url),
    );

    expect(response.status).toBe(200);
    expect((await response.json()).results).toEqual([]);
  });

  it("plugins search rejects invalid categories", async () => {
    const runQuery = vi.fn();
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.pluginsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/plugins/search?q=plugin&category=other"),
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Invalid plugin category");
    expect(runQuery).not.toHaveBeenCalled();
  });

  it("plugins search sorts by rank tier before score without exposing rank metadata", async () => {
    const runQuery = vi.fn((_, args: Record<string, unknown>) => {
      if (args.family === "code-plugin") {
        return [
          {
            score: 20,
            rankTier: 3,
            package: makeCatalogItem("summary-plugin", { family: "code-plugin", updatedAt: 100 }),
          },
        ];
      }
      if (args.family === "bundle-plugin") {
        return [
          {
            score: 10,
            rankTier: 1,
            package: makeCatalogItem("name-plugin", { family: "bundle-plugin", updatedAt: 50 }),
          },
        ];
      }
      throw new Error(`unexpected family ${String(args.family)}`);
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.pluginsGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/plugins/search?q=plugin&limit=2"),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.results.map((entry: { package: { name: string } }) => entry.package.name)).toEqual([
      "name-plugin",
      "summary-plugin",
    ]);
    expect(body.results[0]).not.toHaveProperty("rankTier");
    expect(body.results[0]).not.toHaveProperty("matchReason");
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
    const runQuery = vi.fn((_, args: Record<string, unknown>) => {
      if ("userId" in args) return { _id: args.userId };
      if ("query" in args) return [];
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.packagesGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/packages/search?q=secret&channel=private"),
    );

    expect(response.status).toBe(200);
    expect(runQuery.mock.calls.map(([, args]) => args)).toContainEqual(
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

  it("packages search falls back to anonymous when cookie auth resolves to an invalid user", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:broken" as never);
    const runQuery = vi.fn(async (query: unknown, args: Record<string, unknown>) => {
      if (query === internal.users.getByIdInternal) {
        throw new Error("Table mismatch");
      }
      if ("query" in args) return [];
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.packagesGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/packages/search?q=secret&channel=community"),
    );

    expect(response.status).toBe(200);
    expect(runQuery).toHaveBeenCalledWith(
      internal.users.getByIdInternal,
      expect.objectContaining({ userId: "users:broken" }),
    );
    expect(runQuery.mock.calls.map(([, args]) => args)).toContainEqual(
      expect.objectContaining({
        query: "secret",
        channel: "community",
        viewerUserId: undefined,
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

  it("packages detail returns not found for invalid package lookup names", async () => {
    const runQuery = vi.fn(async () => {
      throw new Error("unexpected package lookup");
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.packagesGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/packages/openclaw%2Fdiscord"),
    );

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("Package not found");
    expect(runQuery).not.toHaveBeenCalled();
  });

  it("packages detail returns stats for plugins", async () => {
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("name" in args) {
        return {
          package: {
            _id: "packages:demo-plugin",
            name: "demo-plugin",
            displayName: "Demo Plugin",
            family: "code-plugin",
            tags: {},
            latestReleaseId: "packageReleases:1",
            channel: "community",
            isOfficial: false,
            summary: "Plugin summary",
            latestVersion: "1.2.3",
            stats: { downloads: 7, installs: 3, stars: 2, versions: 4 },
            createdAt: 1,
            updatedAt: 2,
          },
          latestRelease: null,
          owner: { _id: "users:owner", handle: "owner", displayName: "Owner" },
        };
      }
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.packagesGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/packages/demo-plugin"),
    );

    if (response.status !== 200) throw new Error(await response.text());
    await expect(response.json()).resolves.toMatchObject({
      package: {
        name: "demo-plugin",
        latestVersion: "1.2.3",
        stats: { downloads: 7, installs: 3, stars: 2, versions: 4 },
      },
      owner: {
        handle: "owner",
      },
    });
  });

  it("packages detail accepts double-encoded scoped package names", async () => {
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("name" in args) {
        expect(args.name).toBe("@openclaw/demo-plugin");
        return {
          package: {
            _id: "packages:demo-plugin",
            name: "@openclaw/demo-plugin",
            displayName: "Demo Plugin",
            family: "code-plugin",
            tags: {},
            latestReleaseId: "packageReleases:1",
            channel: "community",
            isOfficial: false,
            summary: "Plugin summary",
            latestVersion: "1.2.3",
            stats: { downloads: 7, installs: 3, stars: 2, versions: 4 },
            createdAt: 1,
            updatedAt: 2,
          },
          latestRelease: null,
          owner: { _id: "users:owner", handle: "owner", displayName: "Owner" },
        };
      }
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.packagesGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/packages/%2540openclaw%2Fdemo-plugin"),
    );

    if (response.status !== 200) throw new Error(await response.text());
    await expect(response.json()).resolves.toMatchObject({
      package: {
        name: "@openclaw/demo-plugin",
        latestVersion: "1.2.3",
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

  it("packages file blocks skill compatibility files for malware-blocked skills", async () => {
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
          moderationInfo: {
            isMalwareBlocked: true,
            isPendingScan: false,
            isHiddenByMod: false,
            isRemoved: false,
          },
        };
      }
      throw new Error("unexpected version lookup");
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const storage = { get: vi.fn() };

    const response = await __handlers.packagesGetRouterV1Handler(
      makeCtx({ runQuery, runMutation, storage }),
      new Request("https://example.com/api/v1/packages/demo/file?path=README.md"),
    );

    expect(response.status).toBe(403);
    expect(await response.text()).toContain("flagged as malicious");
    expect(storage.get).not.toHaveBeenCalled();
  });

  it("packages file does not serve skill tags pointing at another skill's version", async () => {
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
            tags: { latest: "skillVersions:demo-1", old: "skillVersions:other" },
            badges: {},
            createdAt: 1,
            updatedAt: 2,
          },
          latestVersion: null,
          owner: { handle: "steipete" },
          moderationInfo: null,
        };
      }
      if (args.versionId === "skillVersions:other") {
        return {
          _id: "skillVersions:other",
          skillId: "skills:other",
          version: "9.9.9",
          createdAt: 9,
          changelog: "other",
          files: [
            {
              path: "SKILL.md",
              size: 11,
              sha256: "abc",
              storageId: "storage:other",
              contentType: "text/markdown",
            },
          ],
        };
      }
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const storage = { get: vi.fn() };

    const response = await __handlers.packagesGetRouterV1Handler(
      makeCtx({ runQuery, runMutation, storage }),
      new Request("https://example.com/api/v1/packages/demo/file?path=README.md&tag=old"),
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Version not found");
    expect(storage.get).not.toHaveBeenCalled();
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
            reportCount: 7,
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
              scanStatus: "malicious",
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
              status: "malicious",
              reasonCodes: ["malicious.static_fixture"],
              findings: [],
              summary: "Static fixture only.",
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
        verification: {
          scanStatus: "clean",
        },
        staticScan: {
          status: "malicious",
          summary: "Static fixture only.",
        },
      },
    });
  });

  it("packages version detail returns ClawPack artifact metadata", async () => {
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
            files: [],
            artifactKind: "npm-pack",
            clawpackStorageId: "storage:clawpack",
            clawpackSha256: "c".repeat(64),
            clawpackSize: 123,
            clawpackFormat: "tgz",
            npmIntegrity: "sha512-demo",
            npmShasum: "d".repeat(40),
            npmTarballName: "demo-plugin-1.0.0.tgz",
            npmUnpackedSize: 456,
            npmFileCount: 3,
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

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.package).not.toHaveProperty("reportCount");
    expect(json).toMatchObject({
      version: {
        artifact: {
          kind: "npm-pack",
          sha256: "c".repeat(64),
          npmIntegrity: "sha512-demo",
          npmShasum: "d".repeat(40),
          npmTarballName: "demo-plugin-1.0.0.tgz",
        },
      },
    });
  });

  it("package artifact endpoint exposes ClawPack resolver URLs", async () => {
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
            reportCount: 7,
          },
          version: {
            _id: "packageReleases:1",
            packageId: "packages:demo-plugin",
            version: "1.0.0",
            createdAt: 1,
            changelog: "Initial release",
            distTags: ["latest"],
            files: [],
            artifactKind: "npm-pack",
            clawpackStorageId: "storage:clawpack",
            clawpackSha256: "c".repeat(64),
            clawpackSize: 123,
            clawpackFormat: "tgz",
            npmIntegrity: "sha512-demo",
            npmShasum: "d".repeat(40),
            npmTarballName: "demo-plugin-1.0.0.tgz",
          },
        };
      }
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.packagesGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/packages/demo-plugin/versions/1.0.0/artifact"),
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.package).not.toHaveProperty("reportCount");
    expect(json).toMatchObject({
      artifact: {
        kind: "npm-pack",
        tarballUrl: "https://example.com/api/npm/demo-plugin/-/demo-plugin-1.0.0.tgz",
        legacyDownloadUrl: "https://example.com/api/v1/packages/demo-plugin/download?version=1.0.0",
      },
    });
  });

  it("package artifact endpoint exposes legacy zip resolver compatibility aliases", async () => {
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
            files: [],
            artifactKind: "legacy-zip",
            integritySha256: "a".repeat(64),
            sha256hash: "b".repeat(64),
          },
        };
      }
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.packagesGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/packages/demo-plugin/versions/1.0.0/artifact"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      package: { name: "demo-plugin" },
      version: "1.0.0",
      artifact: {
        kind: "legacy-zip",
        sha256: "b".repeat(64),
        format: "zip",
        source: "clawhub",
        artifactKind: "legacy-zip",
        artifactSha256: "b".repeat(64),
        packageName: "demo-plugin",
        version: "1.0.0",
        downloadUrl: "https://example.com/api/v1/packages/demo-plugin/download?version=1.0.0",
        legacyDownloadUrl: "https://example.com/api/v1/packages/demo-plugin/download?version=1.0.0",
      },
    });
  });

  it("package security endpoint returns exact release trust and blocked reasons", async () => {
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
            channel: "community",
            isOfficial: false,
          },
          version: {
            _id: "packageReleases:1",
            packageId: "packages:demo-plugin",
            version: "1.0.0",
            createdAt: 1,
            changelog: "Initial release",
            distTags: ["latest"],
            files: [],
            artifactKind: "npm-pack",
            sha256hash: "c".repeat(64),
            clawpackSha256: "e".repeat(64),
            clawpackSize: 123,
            clawpackFormat: "tgz",
            npmIntegrity: "sha512-demo",
            npmShasum: "d".repeat(40),
            npmTarballName: "demo-plugin-1.0.0.tgz",
            verification: { scanStatus: "malicious" },
            manualModeration: { state: "quarantined", reason: "private reviewer note" },
          },
        };
      }
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.packagesGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/packages/demo-plugin/versions/1.0.0/security"),
    );

    expect(response.status).toBe(200);
    const packageLookupArgs = runQuery.mock.calls
      .map(([, args]) => args)
      .filter(hasPackageNameArgs);
    expect(packageLookupArgs).toContainEqual(
      expect.objectContaining({ name: "demo-plugin", version: "1.0.0" }),
    );
    expect(packageLookupArgs.some((args) => !("version" in args))).toBe(false);
    const json = await response.json();
    expect(json.trust).not.toHaveProperty("moderationReason");
    expect(json).toEqual({
      package: {
        name: "demo-plugin",
        displayName: "Demo Plugin",
        family: "code-plugin",
      },
      release: {
        releaseId: "packageReleases:1",
        version: "1.0.0",
        artifactKind: "npm-pack",
        artifactSha256: "c".repeat(64),
        npmIntegrity: "sha512-demo",
        npmShasum: "d".repeat(40),
        npmTarballName: "demo-plugin-1.0.0.tgz",
        createdAt: 1,
      },
      trust: {
        scanStatus: "malicious",
        moderationState: "quarantined",
        blockedFromDownload: true,
        reasons: ["manual:quarantined", "scan:malicious"],
        pending: false,
        stale: false,
      },
    });
  });

  it("package security endpoint includes package-level public download blocks", async () => {
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("name" in args && "version" in args) {
        return {
          package: {
            _id: "packages:demo-plugin",
            name: "demo-plugin",
            displayName: "Demo Plugin",
            family: "code-plugin",
            channel: "community",
            isOfficial: false,
            scanStatus: "malicious",
            publicDownloadBlocked: true,
          },
          version: {
            _id: "packageReleases:1",
            packageId: "packages:demo-plugin",
            version: "1.0.0",
            createdAt: 1,
            changelog: "Initial release",
            distTags: ["latest"],
            files: [],
            artifactKind: "npm-pack",
            sha256hash: "c".repeat(64),
            verification: { scanStatus: "clean" },
          },
        };
      }
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.packagesGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/packages/demo-plugin/versions/1.0.0/security"),
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.trust).toMatchObject({
      scanStatus: "clean",
      blockedFromDownload: true,
      reasons: ["package:malicious"],
      pending: false,
      stale: false,
    });
  });

  it("package security endpoint does not use file-set integrity as npm artifact hash", async () => {
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("name" in args && "version" in args) {
        return {
          package: {
            _id: "packages:demo-plugin",
            name: "demo-plugin",
            displayName: "Demo Plugin",
            family: "code-plugin",
            channel: "community",
            isOfficial: false,
          },
          version: {
            _id: "packageReleases:1",
            packageId: "packages:demo-plugin",
            version: "1.0.0",
            createdAt: 1,
            changelog: "Initial release",
            distTags: ["latest"],
            files: [],
            artifactKind: "npm-pack",
            integritySha256: "a".repeat(64),
            npmIntegrity: "sha512-demo",
            npmShasum: "d".repeat(40),
            npmTarballName: "demo-plugin-1.0.0.tgz",
            verification: { scanStatus: "clean" },
          },
        };
      }
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.packagesGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/packages/demo-plugin/versions/1.0.0/security"),
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.release).not.toHaveProperty("artifactSha256");
    expect(json.release).toMatchObject({
      artifactKind: "npm-pack",
      npmIntegrity: "sha512-demo",
      npmShasum: "d".repeat(40),
      npmTarballName: "demo-plugin-1.0.0.tgz",
    });
  });

  it("package security endpoint does not use file-set integrity as legacy artifact hash", async () => {
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("name" in args && "version" in args) {
        return {
          package: {
            _id: "packages:demo-plugin",
            name: "demo-plugin",
            displayName: "Demo Plugin",
            family: "code-plugin",
            channel: "community",
            isOfficial: false,
          },
          version: {
            _id: "packageReleases:1",
            packageId: "packages:demo-plugin",
            version: "1.0.0",
            createdAt: 1,
            changelog: "Initial release",
            distTags: ["latest"],
            files: [],
            artifactKind: "legacy-zip",
            integritySha256: "a".repeat(64),
            verification: { scanStatus: "clean" },
          },
        };
      }
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.packagesGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/packages/demo-plugin/versions/1.0.0/security"),
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.release).not.toHaveProperty("artifactSha256");
    expect(json.release).toMatchObject({
      artifactKind: "legacy-zip",
      version: "1.0.0",
    });
  });

  it.each([
    {
      name: "clean",
      release: { verification: { scanStatus: "clean" } },
      expected: { scanStatus: "clean", blockedFromDownload: false, reasons: [], pending: false },
    },
    {
      name: "pending",
      release: { sha256hash: "b".repeat(64) },
      expected: {
        scanStatus: "pending",
        blockedFromDownload: false,
        reasons: ["scan:pending"],
        pending: true,
      },
    },
    {
      name: "stale",
      release: { sha256hash: "b".repeat(64), vtAnalysis: { status: "stale", checkedAt: 123 } },
      expected: {
        scanStatus: "pending",
        blockedFromDownload: false,
        reasons: ["scan:pending"],
        pending: true,
        stale: true,
      },
    },
    {
      name: "suspicious",
      release: {
        vtAnalysis: {
          status: "suspicious",
          source: "engines",
          engineStats: { suspicious: 1 },
          checkedAt: 123,
        },
      },
      expected: {
        scanStatus: "pending",
        blockedFromDownload: false,
        reasons: ["scan:pending"],
        pending: true,
      },
    },
    {
      name: "malicious",
      release: {
        llmAnalysis: {
          status: "malicious",
          verdict: "malicious",
          summary: "ClawScan found malicious behavior.",
          checkedAt: 123,
        },
      },
      expected: {
        scanStatus: "malicious",
        blockedFromDownload: true,
        reasons: ["scan:malicious"],
        pending: false,
      },
    },
    {
      name: "static-only",
      release: {
        sha256hash: "b".repeat(64),
        staticScan: {
          status: "malicious",
          reasonCodes: ["malicious.test"],
          findings: [],
          summary: "Detected: malicious.test",
          engineVersion: "v1",
          checkedAt: 123,
        },
      },
      expected: {
        scanStatus: "pending",
        blockedFromDownload: false,
        reasons: ["scan:pending"],
        pending: true,
      },
    },
    {
      name: "quarantined",
      release: {
        verification: { scanStatus: "clean" },
        manualModeration: { state: "quarantined", reason: "private reviewer note" },
      },
      expected: {
        scanStatus: "malicious",
        moderationState: "quarantined",
        blockedFromDownload: true,
        reasons: ["manual:quarantined", "scan:malicious"],
        pending: false,
      },
    },
    {
      name: "revoked",
      release: {
        verification: { scanStatus: "clean" },
        manualModeration: { state: "revoked", reason: "unsafe artifact" },
      },
      expected: {
        scanStatus: "malicious",
        moderationState: "revoked",
        blockedFromDownload: true,
        reasons: ["manual:revoked", "scan:malicious"],
        pending: false,
      },
    },
  ])("package security endpoint reports $name trust state", async ({ release, expected }) => {
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
            channel: "community",
            isOfficial: false,
          },
          version: {
            _id: "packageReleases:1",
            packageId: "packages:demo-plugin",
            version: "1.0.0",
            createdAt: 1,
            changelog: "Initial release",
            distTags: ["latest"],
            files: [],
            artifactKind: "legacy-zip",
            sha256hash: "b".repeat(64),
            ...release,
          },
        };
      }
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.packagesGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/packages/demo-plugin/versions/1.0.0/security"),
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.release).toMatchObject({
      releaseId: "packageReleases:1",
      version: "1.0.0",
      artifactKind: "legacy-zip",
      artifactSha256: "b".repeat(64),
      createdAt: 1,
    });
    expect(json.trust).toMatchObject({
      moderationState: null,
      stale: false,
      ...expected,
    });
    expect(json.trust).not.toHaveProperty("moderationReason");
  });

  it("package artifact endpoint omits legacy zip archive aliases when archive hash is missing", async () => {
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
            files: [],
            artifactKind: "legacy-zip",
            integritySha256: "a".repeat(64),
          },
        };
      }
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.packagesGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/packages/demo-plugin/versions/1.0.0/artifact"),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      artifact: {
        kind: "legacy-zip",
        format: "zip",
        source: "clawhub",
        artifactKind: "legacy-zip",
        packageName: "demo-plugin",
        version: "1.0.0",
      },
    });
    expect(body.artifact).not.toHaveProperty("sha256");
    expect(body.artifact).not.toHaveProperty("artifactSha256");
  });

  it("package artifact endpoint accepts split scoped package paths", async () => {
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("name" in args && !("version" in args)) {
        return {
          package: {
            _id: "packages:demo-plugin",
            name: "@scope/demo-plugin",
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
            name: "@scope/demo-plugin",
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
            files: [],
            artifactKind: "npm-pack",
            clawpackStorageId: "storage:clawpack",
            clawpackSha256: "c".repeat(64),
            clawpackSize: 123,
            clawpackFormat: "tgz",
            npmIntegrity: "sha512-demo",
            npmShasum: "d".repeat(40),
            npmTarballName: "scope-demo-plugin-1.0.0.tgz",
          },
        };
      }
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.packagesGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/packages/@scope/demo-plugin/versions/1.0.0/artifact"),
    );

    expect(response.status).toBe(200);
    expect(runQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: "@scope/demo-plugin", version: "1.0.0" }),
    );
    await expect(response.json()).resolves.toMatchObject({
      package: { name: "@scope/demo-plugin" },
      artifact: {
        kind: "npm-pack",
        tarballUrl: "https://example.com/api/npm/@scope/demo-plugin/-/scope-demo-plugin-1.0.0.tgz",
      },
    });
  });

  it("package readiness reports official OpenClaw blockers", async () => {
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("name" in args) {
        return {
          package: {
            _id: "packages:demo-plugin",
            name: "demo-plugin",
            displayName: "Demo Plugin",
            family: "code-plugin",
            tags: { latest: "packageReleases:1" },
            latestReleaseId: "packageReleases:1",
            latestVersion: "1.0.0",
            channel: "community",
            isOfficial: false,
            compatibility: {
              pluginApiRange: "^1.0.0",
              builtWithOpenClawVersion: "2026.3.14",
            },
            capabilities: {
              executesCode: true,
              hostTargets: ["darwin-arm64"],
              capabilityTags: ["environment:declared"],
            },
            verification: {
              tier: "source-linked",
              scope: "artifact-only",
              sourceRepo: "openclaw/demo-plugin",
              sourceCommit: "abc123",
              scanStatus: "clean",
            },
            artifact: {
              kind: "legacy-zip",
              sha256: "a".repeat(64),
              format: "zip",
            },
            createdAt: 1,
            updatedAt: 1,
          },
          latestRelease: null,
          owner: { _id: "publishers:demo", handle: "demo" },
        };
      }
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.packagesGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/packages/demo-plugin/readiness"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ready: false,
      blockers: ["official", "clawpack"],
      checks: expect.arrayContaining([
        expect.objectContaining({ id: "official", status: "fail" }),
        expect.objectContaining({ id: "clawpack", status: "fail" }),
        expect.objectContaining({ id: "host-targets", status: "pass" }),
        expect.objectContaining({ id: "environment", status: "pass" }),
      ]),
    });
  });

  it("package release moderation posts state changes", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:moderator",
      user: { _id: "users:moderator", role: "moderator" },
    } as never);
    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate();
      return {
        ok: true,
        packageId: "packages:demo-plugin",
        releaseId: "packageReleases:1",
        state: "quarantined",
        scanStatus: "malicious",
      };
    });

    const response = await __handlers.packagesPostRouterV1Handler(
      makeCtx({ runMutation }),
      new Request("https://example.com/api/v1/packages/demo-plugin/versions/1.0.0/moderation", {
        method: "POST",
        headers: { Authorization: "Bearer clh_test" },
        body: JSON.stringify({
          state: "quarantined",
          reason: "manual review",
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      state: "quarantined",
      scanStatus: "malicious",
    });
    expect(runMutation).toHaveBeenCalledWith(
      internal.packages.moderatePackageReleaseForUserInternal,
      {
        actorUserId: "users:moderator",
        name: "demo-plugin",
        version: "1.0.0",
        state: "quarantined",
        reason: "manual review",
      },
    );
  });

  it("package moderation queue lists releases for moderators", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:moderator",
      user: { _id: "users:moderator", role: "moderator" },
    } as never);
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate();
      return {
        items: [
          {
            packageId: "packages:demo-plugin",
            releaseId: "packageReleases:1",
            name: "demo-plugin",
            displayName: "Demo Plugin",
            family: "code-plugin",
            channel: "community",
            isOfficial: false,
            version: "1.0.0",
            createdAt: 1,
            artifactKind: "npm-pack",
            scanStatus: "malicious",
            moderationState: "quarantined",
            moderationReason: "manual review",
            sourceRepo: "openclaw/demo-plugin",
            sourceCommit: "abc123",
            reportCount: 0,
            lastReportedAt: null,
            reasons: ["manual:quarantined", "scan:malicious"],
          },
        ],
        nextCursor: "cursor-1",
        done: false,
      };
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.packagesGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/packages/moderation/queue?status=blocked&limit=20", {
        headers: { Authorization: "Bearer clh_test" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      items: [
        {
          name: "demo-plugin",
          version: "1.0.0",
          scanStatus: "malicious",
          moderationState: "quarantined",
        },
      ],
      nextCursor: "cursor-1",
      done: false,
    });
    expect(runQuery).toHaveBeenCalledWith(internal.packages.listPackageModerationQueueInternal, {
      actorUserId: "users:moderator",
      cursor: null,
      limit: 20,
      status: "blocked",
    });
  });

  it("package report posts authenticated reports", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:reporter",
      user: { _id: "users:reporter", role: "user" },
    } as never);
    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate();
      return {
        ok: true,
        reported: true,
        alreadyReported: false,
        packageId: "packages:1",
        releaseId: "packageReleases:1",
        reportCount: 1,
      };
    });

    const response = await __handlers.packagesPostRouterV1Handler(
      makeCtx({ runMutation }),
      new Request("https://example.com/api/v1/packages/%40scope%2Fdemo/report", {
        method: "POST",
        headers: { Authorization: "Bearer clh_test" },
        body: JSON.stringify({
          reason: "suspicious native payload",
          version: "1.2.3",
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      reported: true,
      reportCount: 1,
    });
    expect(runMutation).toHaveBeenCalledWith(internal.packages.reportPackageForUserInternal, {
      actorUserId: "users:reporter",
      name: "@scope/demo",
      reason: "suspicious native payload",
      version: "1.2.3",
    });
  });

  it("package reports lists moderator report intake", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:moderator",
      user: { _id: "users:moderator", role: "moderator" },
    } as never);
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate();
      return {
        items: [
          {
            reportId: "packageReports:1",
            packageId: "packages:1",
            releaseId: "packageReleases:1",
            name: "@scope/demo",
            displayName: "Demo",
            family: "code-plugin",
            version: "1.2.3",
            reason: "suspicious",
            status: "open",
            createdAt: 123,
            reporter: { userId: "users:reporter", handle: "reporter", displayName: "Reporter" },
            triagedAt: null,
            triagedBy: null,
            triageNote: null,
          },
        ],
        nextCursor: null,
        done: true,
      };
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.packagesGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/packages/reports?status=open&limit=10", {
        headers: { Authorization: "Bearer clh_test" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      items: [{ reportId: "packageReports:1", name: "@scope/demo" }],
    });
    expect(runQuery).toHaveBeenCalledWith(internal.packages.listPackageReportsInternal, {
      actorUserId: "users:moderator",
      cursor: null,
      limit: 10,
      status: "open",
    });
  });

  it("package migrations lists official migration rows", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:moderator",
      user: { _id: "users:moderator", role: "moderator" },
    } as never);
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate();
      return {
        items: [
          {
            migrationId: "officialPluginMigrations:1",
            bundledPluginId: "core.search",
            packageName: "@scope/demo",
            packageId: "packages:1",
            owner: "platform",
            sourceRepo: "openclaw/openclaw",
            sourcePath: "plugins/search",
            sourceCommit: "abc123",
            phase: "ready-for-openclaw",
            blockers: [],
            hostTargetsComplete: true,
            scanClean: true,
            moderationApproved: true,
            runtimeBundlesReady: false,
            notes: null,
            createdAt: 100,
            updatedAt: 200,
          },
        ],
        nextCursor: null,
        done: true,
      };
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.packagesGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/packages/migrations?phase=all&limit=10", {
        headers: { Authorization: "Bearer clh_test" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      items: [{ bundledPluginId: "core.search", phase: "ready-for-openclaw" }],
    });
    expect(runQuery).toHaveBeenCalledWith(internal.packages.listOfficialPluginMigrationsInternal, {
      actorUserId: "users:moderator",
      cursor: null,
      limit: 10,
      phase: "all",
    });
  });

  it("package migrations upserts official migration rows", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:admin",
      user: { _id: "users:admin", role: "admin" },
    } as never);
    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate();
      return {
        ok: true,
        migration: {
          migrationId: "officialPluginMigrations:1",
          bundledPluginId: "core.search",
          packageName: "@scope/demo",
          packageId: "packages:1",
          owner: "platform",
          sourceRepo: "openclaw/openclaw",
          sourcePath: "plugins/search",
          sourceCommit: null,
          phase: "blocked",
          blockers: ["missing ClawPack"],
          hostTargetsComplete: true,
          scanClean: false,
          moderationApproved: false,
          runtimeBundlesReady: false,
          notes: null,
          createdAt: 100,
          updatedAt: 200,
        },
      };
    });

    const response = await __handlers.packagesPostRouterV1Handler(
      makeCtx({ runMutation }),
      new Request("https://example.com/api/v1/packages/migrations", {
        method: "POST",
        headers: { Authorization: "Bearer clh_test" },
        body: JSON.stringify({
          bundledPluginId: "core.search",
          packageName: "@scope/demo",
          owner: "platform",
          sourceRepo: "openclaw/openclaw",
          sourcePath: "plugins/search",
          phase: "blocked",
          blockers: ["missing ClawPack"],
          hostTargetsComplete: true,
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      migration: { bundledPluginId: "core.search", phase: "blocked" },
    });
    expect(runMutation).toHaveBeenCalledWith(
      internal.packages.upsertOfficialPluginMigrationForUserInternal,
      expect.objectContaining({
        actorUserId: "users:admin",
        bundledPluginId: "core.search",
        packageName: "@scope/demo",
      }),
    );
  });

  it("package report triage posts moderator decisions", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:moderator",
      user: { _id: "users:moderator", role: "moderator" },
    } as never);
    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate();
      return {
        ok: true,
        reportId: "packageReports:1",
        packageId: "packages:1",
        status: "confirmed",
        reportCount: 0,
      };
    });

    const response = await __handlers.packagesPostRouterV1Handler(
      makeCtx({ runMutation }),
      new Request("https://example.com/api/v1/packages/reports/packageReports%3A1/triage", {
        method: "POST",
        headers: { Authorization: "Bearer clh_test" },
        body: JSON.stringify({ status: "confirmed", note: "handled", finalAction: "quarantine" }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "confirmed" });
    expect(runMutation).toHaveBeenCalledWith(internal.packages.triagePackageReportForUserInternal, {
      actorUserId: "users:moderator",
      reportId: "packageReports:1",
      status: "confirmed",
      note: "handled",
      finalAction: "quarantine",
    });
  });

  it("package moderation status returns owner diagnostics", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:owner",
      user: { _id: "users:owner", role: "user" },
    } as never);
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate();
      return {
        package: {
          packageId: "packages:1",
          name: "@scope/demo",
          displayName: "Demo",
          family: "code-plugin",
          channel: "community",
          isOfficial: false,
          reportCount: 2,
          lastReportedAt: 456,
          scanStatus: "malicious",
        },
        latestRelease: {
          releaseId: "packageReleases:1",
          version: "1.2.3",
          artifactKind: "npm-pack",
          scanStatus: "malicious",
          moderationState: "quarantined",
          moderationReason: "manual review",
          blockedFromDownload: true,
          reasons: ["manual:quarantined", "scan:malicious", "reports:2"],
          createdAt: 123,
        },
      };
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.packagesGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/packages/%40scope%2Fdemo/moderation", {
        headers: { Authorization: "Bearer clh_test" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      package: { name: "@scope/demo", reportCount: 2 },
      latestRelease: { blockedFromDownload: true },
    });
    expect(runQuery).toHaveBeenCalledWith(
      internal.packages.getPackageModerationStatusForUserInternal,
      {
        actorUserId: "users:owner",
        name: "@scope/demo",
      },
    );
  });

  it("package appeal posts owner appeal requests", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:owner",
      user: { _id: "users:owner", role: "user" },
    } as never);
    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate();
      return {
        ok: true,
        submitted: true,
        alreadyOpen: false,
        appealId: "packageAppeals:1",
        packageId: "packages:1",
        releaseId: "packageReleases:1",
        status: "open",
      };
    });

    const response = await __handlers.packagesPostRouterV1Handler(
      makeCtx({ runMutation }),
      new Request("https://example.com/api/v1/packages/%40scope%2Fdemo/appeal", {
        method: "POST",
        headers: { Authorization: "Bearer clh_test" },
        body: JSON.stringify({ version: "1.2.3", message: "please review" }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      submitted: true,
      appealId: "packageAppeals:1",
    });
    expect(runMutation).toHaveBeenCalledWith(internal.packages.submitPackageAppealForUserInternal, {
      actorUserId: "users:owner",
      name: "@scope/demo",
      version: "1.2.3",
      message: "please review",
    });
  });

  it("package appeals lists moderator appeal intake", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:moderator",
      user: { _id: "users:moderator", role: "moderator" },
    } as never);
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate();
      return {
        items: [
          {
            appealId: "packageAppeals:1",
            packageId: "packages:1",
            releaseId: "packageReleases:1",
            name: "@scope/demo",
            displayName: "Demo",
            family: "code-plugin",
            version: "1.2.3",
            message: "please review",
            status: "open",
            createdAt: 123,
            submitter: { userId: "users:owner", handle: "owner", displayName: "Owner" },
            resolvedAt: null,
            resolvedBy: null,
            resolutionNote: null,
          },
        ],
        nextCursor: null,
        done: true,
      };
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.packagesGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/packages/appeals?status=open&limit=10", {
        headers: { Authorization: "Bearer clh_test" },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      items: [{ appealId: "packageAppeals:1", name: "@scope/demo" }],
    });
    expect(runQuery).toHaveBeenCalledWith(internal.packages.listPackageAppealsInternal, {
      actorUserId: "users:moderator",
      cursor: null,
      limit: 10,
      status: "open",
    });
  });

  it("package appeal resolve posts moderator decisions", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:moderator",
      user: { _id: "users:moderator", role: "moderator" },
    } as never);
    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate();
      return {
        ok: true,
        appealId: "packageAppeals:1",
        packageId: "packages:1",
        releaseId: "packageReleases:1",
        status: "accepted",
        actionTaken: "approve",
      };
    });

    const response = await __handlers.packagesPostRouterV1Handler(
      makeCtx({ runMutation }),
      new Request("https://example.com/api/v1/packages/appeals/packageAppeals%3A1/resolve", {
        method: "POST",
        headers: { Authorization: "Bearer clh_test" },
        body: JSON.stringify({
          status: "accepted",
          note: "scanner finding cleared",
          finalAction: "approve",
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "accepted",
      actionTaken: "approve",
    });
    expect(runMutation).toHaveBeenCalledWith(
      internal.packages.resolvePackageAppealForUserInternal,
      {
        actorUserId: "users:moderator",
        appealId: "packageAppeals:1",
        status: "accepted",
        note: "scanner finding cleared",
        finalAction: "approve",
      },
    );
  });

  it("package artifact backfill posts admin dry-run requests", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:admin",
      user: { _id: "users:admin", role: "admin" },
    } as never);
    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if (isRateLimitArgs(args)) return okRate();
      return {
        ok: true,
        scanned: 50,
        updated: 7,
        nextCursor: "cursor-1",
        done: false,
        dryRun: true,
      };
    });

    const response = await __handlers.packagesPostRouterV1Handler(
      makeCtx({ runMutation }),
      new Request("https://example.com/api/v1/packages/backfill/artifacts", {
        method: "POST",
        headers: { Authorization: "Bearer clh_test" },
        body: JSON.stringify({
          cursor: "cursor-0",
          batchSize: 50,
          dryRun: true,
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      scanned: 50,
      updated: 7,
      dryRun: true,
    });
    expect(runMutation).toHaveBeenCalledWith(
      internal.packages.backfillPackageArtifactKindsInternal,
      {
        actorUserId: "users:admin",
        cursor: "cursor-0",
        batchSize: 50,
        dryRun: true,
      },
    );
  });

  it("npm mirror packument lists only ClawPack-backed releases", async () => {
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("name" in args && !("paginationOpts" in args)) {
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
            summary: "Demo package",
            createdAt: 1,
            updatedAt: 1,
          },
          latestRelease: null,
          owner: null,
        };
      }
      if ("paginationOpts" in args) {
        return {
          page: [
            {
              _id: "packageReleases:1",
              packageId: "packages:demo-plugin",
              version: "1.0.0",
              createdAt: 1,
              changelog: "Initial release",
              distTags: ["latest"],
              files: [],
              artifactKind: "npm-pack",
              clawpackStorageId: "storage:clawpack",
              npmIntegrity: "sha512-demo",
              npmShasum: "d".repeat(40),
              npmTarballName: "demo-plugin-1.0.0.tgz",
              extractedPackageJson: { dependencies: { semver: "^7.0.0" } },
            },
            {
              _id: "packageReleases:legacy",
              packageId: "packages:demo-plugin",
              version: "0.9.0",
              createdAt: 1,
              changelog: "Legacy",
              distTags: [],
              files: [],
              artifactKind: "legacy-zip",
            },
          ],
          isDone: true,
          continueCursor: null,
        };
      }
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.npmMirrorGetHandler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/npm/demo-plugin"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      name: "demo-plugin",
      "dist-tags": { latest: "1.0.0" },
      versions: {
        "1.0.0": {
          dist: {
            tarball: "https://example.com/api/npm/demo-plugin/-/demo-plugin-1.0.0.tgz",
            integrity: "sha512-demo",
            shasum: "d".repeat(40),
          },
          dependencies: { semver: "^7.0.0" },
        },
      },
    });
  });

  it("npm mirror uses the public host when requests arrive through Convex rewrites", async () => {
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("name" in args && !("paginationOpts" in args)) {
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
            summary: "Demo package",
            createdAt: 1,
            updatedAt: 1,
          },
          latestRelease: null,
          owner: null,
        };
      }
      if ("paginationOpts" in args) {
        return {
          page: [
            {
              _id: "packageReleases:1",
              packageId: "packages:demo-plugin",
              version: "1.0.0",
              createdAt: 1,
              changelog: "Initial release",
              distTags: ["latest"],
              files: [],
              artifactKind: "npm-pack",
              clawpackStorageId: "storage:clawpack",
              npmIntegrity: "sha512-demo",
              npmShasum: "d".repeat(40),
              npmTarballName: "demo-plugin-1.0.0.tgz",
            },
          ],
          isDone: true,
          continueCursor: null,
        };
      }
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.npmMirrorGetHandler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://wry-manatee-359.convex.site/api/npm/demo-plugin", {
        headers: {
          "x-forwarded-host": "clawhub.ai",
          "x-forwarded-proto": "https",
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      versions: {
        "1.0.0": {
          dist: {
            tarball: "https://clawhub.ai/api/npm/demo-plugin/-/demo-plugin-1.0.0.tgz",
          },
        },
      },
    });
  });

  it("npm mirror falls back to clawhub.ai for production Convex artifact URLs", async () => {
    vi.stubEnv("CONVEX_DEPLOYMENT", "prod:wry-manatee-359");
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("name" in args && !("paginationOpts" in args)) {
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
            summary: "Demo package",
            createdAt: 1,
            updatedAt: 1,
          },
          latestRelease: null,
          owner: null,
        };
      }
      if ("paginationOpts" in args) {
        return {
          page: [
            {
              _id: "packageReleases:1",
              packageId: "packages:demo-plugin",
              version: "1.0.0",
              createdAt: 1,
              changelog: "Initial release",
              distTags: ["latest"],
              files: [],
              artifactKind: "npm-pack",
              clawpackStorageId: "storage:clawpack",
              npmIntegrity: "sha512-demo",
              npmShasum: "d".repeat(40),
              npmTarballName: "demo-plugin-1.0.0.tgz",
            },
          ],
          isDone: true,
          continueCursor: null,
        };
      }
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.npmMirrorGetHandler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://wry-manatee-359.convex.site/api/npm/demo-plugin"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      versions: {
        "1.0.0": {
          dist: {
            tarball: "https://clawhub.ai/api/npm/demo-plugin/-/demo-plugin-1.0.0.tgz",
          },
        },
      },
    });
  });

  it("npm mirror tarball downloads record package installs and download metrics", async () => {
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("name" in args && !("paginationOpts" in args)) {
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
            summary: "Demo package",
            createdAt: 1,
            updatedAt: 1,
          },
          latestRelease: null,
          owner: null,
        };
      }
      if ("paginationOpts" in args) {
        return {
          page: [
            {
              _id: "packageReleases:1",
              packageId: "packages:demo-plugin",
              version: "1.0.0",
              createdAt: 1,
              changelog: "Initial release",
              distTags: ["latest"],
              files: [],
              artifactKind: "npm-pack",
              clawpackStorageId: "storage:clawpack",
              npmIntegrity: "sha512-demo",
              npmShasum: "d".repeat(40),
              npmTarballName: "demo-plugin-1.0.0.tgz",
            },
          ],
          isDone: true,
          continueCursor: null,
        };
      }
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.npmMirrorGetHandler(
      makeCtx({
        runQuery,
        runMutation,
        storage: {
          get: vi.fn(async () => new Blob(["tarball"], { type: "application/octet-stream" })),
        },
      }),
      new Request("https://example.com/api/npm/demo-plugin/-/demo-plugin-1.0.0.tgz", {
        headers: { "cf-connecting-ip": "203.0.113.10" },
      }),
    );

    expect(response.status).toBe(200);
    expect(runMutation).toHaveBeenCalledWith(internal.packages.recordPackageInstallInternal, {
      packageId: "packages:demo-plugin",
    });
    expect(runMutation).toHaveBeenCalledWith(
      internal.downloadMetrics.recordDownloadMetricInternal,
      expect.objectContaining({
        target: { kind: "package", id: "packages:demo-plugin" },
        identityKind: "ip",
        identityHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        dayStart: expect.any(Number),
        occurredAt: expect.any(Number),
      }),
    );
  });

  it("npm mirror returns not found for invalid package lookup names", async () => {
    const runQuery = vi.fn(async () => {
      throw new Error("unexpected package lookup");
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.npmMirrorGetHandler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/npm/openclaw%2Fdiscord"),
    );

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("Package not found");
    expect(runQuery).not.toHaveBeenCalled();
  });

  it("npm mirror accepts encoded scoped package packument paths", async () => {
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("name" in args && !("paginationOpts" in args)) {
        expect(args.name).toBe("@scope/demo-plugin");
        return {
          package: {
            _id: "packages:demo-plugin",
            name: "@scope/demo-plugin",
            displayName: "Demo Plugin",
            family: "code-plugin",
            tags: { latest: "packageReleases:1" },
            latestReleaseId: "packageReleases:1",
            channel: "community",
            isOfficial: false,
            summary: "Demo package",
            createdAt: 1,
            updatedAt: 1,
          },
          latestRelease: null,
          owner: null,
        };
      }
      if ("paginationOpts" in args) {
        expect(args.name).toBe("@scope/demo-plugin");
        return {
          page: [
            {
              _id: "packageReleases:1",
              packageId: "packages:demo-plugin",
              version: "1.0.0",
              createdAt: 1,
              changelog: "Initial release",
              distTags: ["latest"],
              files: [],
              artifactKind: "npm-pack",
              clawpackStorageId: "storage:clawpack",
              npmIntegrity: "sha512-demo",
              npmShasum: "d".repeat(40),
              npmTarballName: "scope-demo-plugin-1.0.0.tgz",
            },
          ],
          isDone: true,
          continueCursor: null,
        };
      }
      return null;
    });
    const runMutation = vi.fn().mockResolvedValue(okRate());

    const response = await __handlers.npmMirrorGetHandler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/npm/@scope%2Fdemo-plugin"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      name: "@scope/demo-plugin",
      "dist-tags": { latest: "1.0.0" },
      versions: {
        "1.0.0": {
          dist: {
            tarball: "https://example.com/api/npm/@scope/demo-plugin/-/scope-demo-plugin-1.0.0.tgz",
          },
        },
      },
    });
  });

  it("returns 400 for /packages/search without q", async () => {
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const runQuery = vi.fn();

    const response = await __handlers.packagesGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/packages/search"),
    );

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe("Missing q query parameter");
    expect(runQuery).not.toHaveBeenCalled();
  });

  it("returns 400 for /packages/search with blank q", async () => {
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const runQuery = vi.fn();

    const response = await __handlers.packagesGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/packages/search?q=%20%20"),
    );

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe("Missing q query parameter");
    expect(runQuery).not.toHaveBeenCalled();
  });

  it("routes /packages/search with q to catalog search only", async () => {
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const runQuery = vi.fn(async () => []);

    const response = await __handlers.packagesGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/packages/search?q=demo"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ results: [] });
    expect(runQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        query: "demo",
      }),
    );
    expect(runQuery).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        name: "search",
      }),
    );
  });

  it("does not treat nested /packages/search paths as catalog search", async () => {
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("name" in args) return null;
      return [];
    });

    const response = await __handlers.packagesGetRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/packages/search/extra?q=demo"),
    );

    expect(response.status).toBe(404);
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
      new Request("https://example.com/api/v1/packages/demo-plugin/download", {
        headers: { "cf-connecting-ip": "203.0.113.20" },
      }),
    );

    const zipEntries = unzipSync(new Uint8Array(await response.arrayBuffer()));
    expect(Object.keys(zipEntries).sort()).toEqual([
      "package/dist/index.js",
      "package/package.json",
    ]);
    expect(zipEntries["_meta.json"]).toBeUndefined();
    expect(runMutation).toHaveBeenCalledWith(
      internal.downloadMetrics.recordDownloadMetricInternal,
      {
        target: { kind: "package", id: "packages:1" },
        identityKind: "ip",
        identityHash: expect.any(String),
        dayStart: expect.any(Number),
        occurredAt: expect.any(Number),
      },
    );
  });

  it("package download metrics prefer API token user identity over IP", async () => {
    vi.mocked(getOptionalApiTokenUserId).mockResolvedValue("users:viewer" as never);

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
      new Request("https://example.com/api/v1/packages/demo-plugin/download", {
        headers: {
          authorization: "Bearer clh_test",
          "cf-connecting-ip": "203.0.113.20",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(runMutation).toHaveBeenCalledWith(
      internal.downloadMetrics.recordDownloadMetricInternal,
      expect.objectContaining({
        target: { kind: "package", id: "packages:1" },
        identityKind: "user",
        identityHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
  });

  it("package downloads succeed and record download metrics", async () => {
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
      new Request("https://example.com/api/v1/packages/demo-plugin/download", {
        headers: { "cf-connecting-ip": "203.0.113.20" },
      }),
    );

    expect(response.status).toBe(200);
    const mutationArgs = runMutation.mock.calls.map(([, args]) => args);
    expect(
      mutationArgs.filter((args) => hasPackageDownloadMetricTarget(args, "packages:1")),
    ).toHaveLength(1);
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
      new Request(
        "https://example.com/api/v1/packages/demo-plugin/file?version=1.0.0&path=README.md",
      ),
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
    vi.mocked(getOptionalApiTokenUser).mockResolvedValue({
      userId: "users:1",
      user: { _id: "users:1", handle: "p" },
    } as never);
    vi.mocked(getOptionalApiTokenUserId).mockResolvedValue("users:1" as never);
    vi.mocked(requirePackagePublishAuth).mockResolvedValue({
      kind: "user",
      userId: "users:1",
      user: { _id: "users:1", handle: "p" },
    } as never);
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const runAction = vi
      .fn()
      .mockResolvedValue({ ok: true, packageId: "pkg:1", releaseId: "rel:1" });
    const form = packagePublishForm(
      packagePublishMetadata({
        ownerHandle: "openclaw",
        bundle: { hostTargets: ["desktop"] },
      }),
    );
    form.append("files", new File(["{}"], "openclaw.plugin.json", { type: "application/json" }));

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
    expect(response.headers.get("RateLimit-Limit")).toBeTruthy();
    expect(findRateLimitCallArgs(runMutation)).toMatchObject({
      key: "user:users:1:write",
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

  it("package publish returns retryable status for transient Convex contention", async () => {
    vi.mocked(getOptionalApiTokenUser).mockResolvedValue({
      userId: "users:1",
      user: { _id: "users:1", handle: "p" },
    } as never);
    vi.mocked(getOptionalApiTokenUserId).mockResolvedValue("users:1" as never);
    vi.mocked(requirePackagePublishAuth).mockResolvedValue({
      kind: "user",
      userId: "users:1",
      user: { _id: "users:1", handle: "p" },
    } as never);
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const runAction = vi
      .fn()
      .mockRejectedValue(
        new Error(
          'Documents read from or written to the "publishers" table changed while this mutation was being run and on every subsequent retry.',
        ),
      );
    const form = packagePublishForm(
      packagePublishMetadata({
        ownerHandle: "openclaw",
        bundle: { hostTargets: ["desktop"] },
      }),
    );
    const pack = npmPackFixture({
      "package/package.json": JSON.stringify({ name: "demo-plugin", version: "1.0.0" }),
      "package/openclaw.plugin.json": JSON.stringify({ id: "demo.plugin" }),
      "package/dist/index.js": "export const demo = true;\n",
    });
    form.append(
      "clawpack",
      new File([bytesToArrayBuffer(pack)], "demo-plugin-1.0.0.tgz", {
        type: "application/octet-stream",
      }),
    );

    const response = await __handlers.publishPackageV1Handler(
      makeCtx({
        runAction,
        runMutation,
        storage: { store: vi.fn(async (_entry: Blob) => "storage:1") },
      }),
      new Request("https://example.com/api/v1/packages", {
        method: "POST",
        headers: {
          Authorization: "Bearer clh_test",
        },
        body: form,
      }),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("1");
    await expect(response.text()).resolves.toContain("Transient ClawHub write contention");
  });

  it("package publish rejects JSON request bodies before publish actions run", async () => {
    vi.mocked(getOptionalApiTokenUserId).mockResolvedValue("users:1" as never);
    vi.mocked(requirePackagePublishAuth).mockResolvedValue({
      kind: "user",
      userId: "users:1",
      user: { _id: "users:1", handle: "p" },
    } as never);
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const runAction = vi.fn();

    const response = await __handlers.publishPackageV1Handler(
      makeCtx({ runAction, runMutation }),
      new Request("https://example.com/api/v1/packages", {
        method: "POST",
        headers: {
          Authorization: "Bearer clh_test",
          "content-type": "application/json",
        },
        body: JSON.stringify(packagePublishMetadata()),
      }),
    );

    expect(response.status).toBe(415);
    expect(await response.text()).toBe("Package publish requires multipart/form-data");
    expect(runAction).not.toHaveBeenCalled();
  });

  it("package publish rejects browser session auth when token auth is not an API token", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:session" as never);
    vi.mocked(requirePackagePublishAuth).mockRejectedValue(new Error("Unauthorized"));
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const runAction = vi.fn();
    const form = packagePublishForm(packagePublishMetadata());
    form.append("files", new File(["{}"], "openclaw.plugin.json", { type: "application/json" }));

    const response = await __handlers.publishPackageV1Handler(
      makeCtx({
        runAction,
        runMutation,
        storage: { store: vi.fn(async () => "storage:plugin") },
      }),
      new Request("https://example.com/api/v1/packages", {
        method: "POST",
        headers: { Authorization: "Bearer convex-session-token" },
        body: form,
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.text()).toBe("Unauthorized");
    expect(runAction).not.toHaveBeenCalled();
  });

  it("multipart package publish ignores macOS junk files", async () => {
    vi.mocked(getOptionalApiTokenUserId).mockResolvedValue("users:1" as never);
    vi.mocked(requirePackagePublishAuth).mockResolvedValue({
      kind: "user",
      userId: "users:1",
      user: { _id: "users:1", handle: "p" },
    } as never);
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const runAction = vi
      .fn()
      .mockResolvedValue({ ok: true, packageId: "pkg:1", releaseId: "rel:1" });
    const storageStore = vi.fn(async () => "storage:plugin");
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
    form.append("files", new File(["{}"], "openclaw.plugin.json", { type: "application/json" }));

    const response = await __handlers.publishPackageV1Handler(
      makeCtx({
        runAction,
        runMutation,
        storage: { store: storageStore },
      }),
      new Request("https://example.com/api/v1/packages", {
        method: "POST",
        headers: { Authorization: "Bearer clh_test" },
        body: form,
      }),
    );

    expect(response.status).toBe(200);
    expect(storageStore).toHaveBeenCalledTimes(1);
    expect(runAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        payload: expect.objectContaining({
          files: [
            {
              path: "openclaw.plugin.json",
              size: 2,
              storageId: "storage:plugin",
              sha256: "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
              contentType: "application/json",
            },
          ],
        }),
      }),
    );
    const actionCall = runAction.mock.calls[0];
    expect(actionCall).toBeTruthy();
    expect(actionCall[1]).toEqual(
      expect.objectContaining({
        payload: expect.not.objectContaining({ artifact: expect.anything() }),
      }),
    );
  });

  it("multipart ClawPack publish stores the tarball and extracted file metadata", async () => {
    vi.mocked(getOptionalApiTokenUserId).mockResolvedValue("users:1" as never);
    vi.mocked(requirePackagePublishAuth).mockResolvedValue({
      kind: "user",
      userId: "users:1",
      user: { _id: "users:1", handle: "p" },
    } as never);
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const runAction = vi
      .fn()
      .mockResolvedValue({ ok: true, packageId: "pkg:1", releaseId: "rel:1" });
    const storageStore = vi.fn(async (_entry: Blob) => `storage:${storageStore.mock.calls.length}`);
    const pack = npmPackFixture({
      "package/package.json": JSON.stringify({ name: "demo-plugin", version: "1.0.0" }),
      "package/openclaw.plugin.json": JSON.stringify({ id: "demo.plugin" }),
      "package/dist/index.js": "export const demo = true;\n",
      "package/assets/viewer-runtime.js": "x".repeat(MAX_PUBLISH_FILE_BYTES + 1),
    });
    const form = new FormData();
    form.set(
      "payload",
      JSON.stringify({
        name: "demo-plugin",
        family: "code-plugin",
        version: "1.0.0",
        changelog: "init",
      }),
    );
    form.append(
      "clawpack",
      new File([bytesToArrayBuffer(pack)], "demo-plugin-1.0.0.tgz", {
        type: "application/octet-stream",
      }),
    );

    const response = await __handlers.publishPackageV1Handler(
      makeCtx({
        runAction,
        runMutation,
        storage: { store: storageStore },
      }),
      new Request("https://example.com/api/v1/packages", {
        method: "POST",
        headers: { Authorization: "Bearer clh_test" },
        body: form,
      }),
    );

    expect(response.status).toBe(200);
    expect(storageStore).toHaveBeenCalledTimes(5);
    expect(runAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        payload: expect.objectContaining({
          artifact: expect.objectContaining({
            kind: "npm-pack",
            storageId: "storage:1",
            size: pack.byteLength,
            npmFileCount: 4,
          }),
          files: [
            expect.objectContaining({ path: "package.json", storageId: "storage:2" }),
            expect.objectContaining({ path: "openclaw.plugin.json", storageId: "storage:3" }),
            expect.objectContaining({ path: "dist/index.js", storageId: "storage:4" }),
            expect.objectContaining({
              path: "assets/viewer-runtime.js",
              storageId: "storage:5",
              size: MAX_PUBLISH_FILE_BYTES + 1,
            }),
          ],
        }),
      }),
    );
    const actionCall = runAction.mock.calls[0];
    expect(actionCall).toBeTruthy();
    const payload = (actionCall[1] as { payload?: { files?: Array<{ path: string }> } }).payload;
    expect(payload?.files?.map((file) => file.path)).toContain("dist/index.js");
  });

  it("staged ClawPack publish derives artifact metadata from stored bytes", async () => {
    vi.mocked(getOptionalApiTokenUserId).mockResolvedValue("users:1" as never);
    vi.mocked(requirePackagePublishAuth).mockResolvedValue({
      kind: "user",
      userId: "users:1",
      user: { _id: "users:1", handle: "p" },
    } as never);
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const runAction = vi
      .fn()
      .mockResolvedValue({ ok: true, packageId: "pkg:1", releaseId: "rel:1" });
    const pack = npmPackFixture({
      "package/package.json": JSON.stringify({ name: "demo-plugin", version: "1.0.0" }),
      "package/openclaw.plugin.json": JSON.stringify({ id: "demo.plugin" }),
      "package/dist/index.js": "export const demo = true;\n",
    });
    const storageGet = vi.fn(async (storageId: string) =>
      storageId === "storage:clawpack"
        ? new Blob([bytesToArrayBuffer(pack)], { type: "application/octet-stream" })
        : null,
    );
    const storageStore = vi.fn(async (_entry: Blob) => `storage:${storageStore.mock.calls.length}`);
    const form = packagePublishForm(
      packagePublishMetadata({
        family: "code-plugin",
      }),
    );
    form.set("clawpack", "storage:clawpack");
    form.set("clawpackUploadTicket", "packagePublishUploadTickets:1");

    const response = await __handlers.publishPackageV1Handler(
      makeCtx({
        runAction,
        runMutation,
        storage: { get: storageGet, store: storageStore },
      }),
      new Request("https://example.com/api/v1/packages", {
        method: "POST",
        headers: { Authorization: "Bearer clh_test" },
        body: form,
      }),
    );

    expect(response.status).toBe(200);
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        uploadTicket: "packagePublishUploadTickets:1",
        storageId: "storage:clawpack",
        auth: { kind: "user", userId: "users:1" },
      }),
    );
    expect(storageGet).toHaveBeenCalledWith("storage:clawpack");
    expect(storageStore).toHaveBeenCalledTimes(3);
    expect(runAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        payload: expect.objectContaining({
          artifact: expect.objectContaining({
            kind: "npm-pack",
            storageId: "storage:clawpack",
            size: pack.byteLength,
            npmFileCount: 3,
          }),
          files: [
            expect.objectContaining({ path: "package.json", storageId: "storage:1" }),
            expect.objectContaining({ path: "openclaw.plugin.json", storageId: "storage:2" }),
            expect.objectContaining({ path: "dist/index.js", storageId: "storage:3" }),
          ],
        }),
      }),
    );
  });

  it("staged ClawPack publish rejects storage ids without upload tickets", async () => {
    vi.mocked(getOptionalApiTokenUserId).mockResolvedValue("users:1" as never);
    vi.mocked(requirePackagePublishAuth).mockResolvedValue({
      kind: "user",
      userId: "users:1",
      user: { _id: "users:1", handle: "p" },
    } as never);
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const runAction = vi.fn();
    const storageGet = vi.fn();
    const form = packagePublishForm(packagePublishMetadata({ family: "code-plugin" }));
    form.set("clawpack", "storage:clawpack");

    const response = await __handlers.publishPackageV1Handler(
      makeCtx({
        runAction,
        runMutation,
        storage: { get: storageGet, store: vi.fn() },
      }),
      new Request("https://example.com/api/v1/packages", {
        method: "POST",
        headers: { Authorization: "Bearer clh_test" },
        body: form,
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Package tarball upload ticket required");
    expect(storageGet).not.toHaveBeenCalled();
    expect(runAction).not.toHaveBeenCalled();
  });

  it("multipart package publish rejects files and tarball together", async () => {
    vi.mocked(getOptionalApiTokenUserId).mockResolvedValue("users:1" as never);
    vi.mocked(requirePackagePublishAuth).mockResolvedValue({
      kind: "user",
      userId: "users:1",
      user: { _id: "users:1", handle: "p" },
    } as never);
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const runAction = vi.fn();
    const pack = npmPackFixture({
      "package/package.json": JSON.stringify({ name: "demo-plugin", version: "1.0.0" }),
      "package/openclaw.plugin.json": JSON.stringify({ id: "demo.plugin" }),
    });
    const form = packagePublishForm(packagePublishMetadata({ family: "code-plugin" }));
    form.append("files", new File(["{}"], "openclaw.plugin.json", { type: "application/json" }));
    form.append(
      "clawpack",
      new File([bytesToArrayBuffer(pack)], "demo-plugin-1.0.0.tgz", {
        type: "application/octet-stream",
      }),
    );

    const response = await __handlers.publishPackageV1Handler(
      makeCtx({ runAction, runMutation, storage: { store: vi.fn() } }),
      new Request("https://example.com/api/v1/packages", {
        method: "POST",
        headers: { Authorization: "Bearer clh_test" },
        body: form,
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toBe(
      "Upload either a package tarball or individual files, not both",
    );
    expect(runAction).not.toHaveBeenCalled();
  });

  it.each(["files[]", "tarball", "artifact", "extraMetadata"])(
    "multipart package publish rejects unsupported field %s",
    async (field) => {
      vi.mocked(getOptionalApiTokenUserId).mockResolvedValue("users:1" as never);
      vi.mocked(requirePackagePublishAuth).mockResolvedValue({
        kind: "user",
        userId: "users:1",
        user: { _id: "users:1", handle: "p" },
      } as never);
      const runMutation = vi.fn().mockResolvedValue(okRate());
      const runAction = vi.fn();
      const form = packagePublishForm(packagePublishMetadata());
      form.append("files", new File(["{}"], "openclaw.plugin.json", { type: "application/json" }));
      form.append(field, new File(["{}"], "ignored.json", { type: "application/json" }));

      const response = await __handlers.publishPackageV1Handler(
        makeCtx({ runAction, runMutation, storage: { store: vi.fn() } }),
        new Request("https://example.com/api/v1/packages", {
          method: "POST",
          headers: { Authorization: "Bearer clh_test" },
          body: form,
        }),
      );

      expect(response.status).toBe(400);
      expect(await response.text()).toBe(`Unsupported package publish form field: ${field}`);
      expect(runAction).not.toHaveBeenCalled();
    },
  );

  it.each(["files", "artifact"])(
    "multipart package publish rejects caller-supplied %s metadata",
    async (field) => {
      vi.mocked(getOptionalApiTokenUserId).mockResolvedValue("users:1" as never);
      vi.mocked(requirePackagePublishAuth).mockResolvedValue({
        kind: "user",
        userId: "users:1",
        user: { _id: "users:1", handle: "p" },
      } as never);
      const runMutation = vi.fn().mockResolvedValue(okRate());
      const runAction = vi.fn();
      const form = packagePublishForm(
        packagePublishMetadata({
          [field]:
            field === "files"
              ? [
                  {
                    path: "openclaw.plugin.json",
                    size: 2,
                    storageId: "storage:attacker",
                    sha256: "a".repeat(64),
                  },
                ]
              : {
                  kind: "npm-pack",
                  storageId: "storage:attacker",
                  sha256: "a".repeat(64),
                  size: 2,
                  format: "tgz",
                  npmIntegrity: "sha512-attacker",
                  npmShasum: "a".repeat(40),
                  npmTarballName: "demo-plugin-1.0.0.tgz",
                  npmUnpackedSize: 2,
                  npmFileCount: 1,
                },
        }),
      );
      form.append("files", new File(["{}"], "openclaw.plugin.json", { type: "application/json" }));

      const response = await __handlers.publishPackageV1Handler(
        makeCtx({ runAction, runMutation, storage: { store: vi.fn() } }),
        new Request("https://example.com/api/v1/packages", {
          method: "POST",
          headers: { Authorization: "Bearer clh_test" },
          body: form,
        }),
      );

      expect(response.status).toBe(400);
      expect(await response.text()).toContain(`Package publish payload: ${field}`);
      expect(runAction).not.toHaveBeenCalled();
    },
  );

  it("package publish routes GitHub Actions auth through the trusted publisher action", async () => {
    vi.mocked(getOptionalApiTokenUserId).mockResolvedValue("users:1" as never);
    vi.mocked(requirePackagePublishAuth).mockResolvedValue({
      kind: "github-actions",
      publishToken: { _id: "packagePublishTokens:1" },
    } as never);
    const runMutation = vi.fn().mockResolvedValue(okRate());
    const runAction = vi
      .fn()
      .mockResolvedValue({ ok: true, packageId: "pkg:1", releaseId: "rel:1" });
    const form = packagePublishForm(
      packagePublishMetadata({
        bundle: { hostTargets: ["desktop"] },
      }),
    );
    const pack = npmPackFixture({
      "package/package.json": JSON.stringify({ name: "demo-plugin", version: "1.0.0" }),
      "package/openclaw.plugin.json": JSON.stringify({ id: "demo.plugin" }),
      "package/dist/index.js": "export const demo = true;\n",
    });
    form.append(
      "clawpack",
      new File([bytesToArrayBuffer(pack)], "demo-plugin-1.0.0.tgz", {
        type: "application/octet-stream",
      }),
    );

    const response = await __handlers.publishPackageV1Handler(
      makeCtx({
        runAction,
        runMutation,
        storage: { store: vi.fn(async (_entry: Blob) => "storage:1") },
      }),
      new Request("https://example.com/api/v1/packages", {
        method: "POST",
        headers: {
          Authorization: "Bearer clh_publish",
        },
        body: form,
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
        key: "ip:unknown:trustedPublish",
        limit: RATE_LIMITS.trustedPublish.ip,
      }),
    );
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
      ([, args]) =>
        typeof args === "object" && args !== null && "packageId" in args && "tokenHash" in args,
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
    expect(fetchGitHubRepositoryIdentity).toHaveBeenCalledWith(
      "https://github.com/openclaw/openclaw",
    );
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

  it("transfers a package through the public package transfer endpoint", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:vincent",
      user: { _id: "users:vincent", handle: "vincentkoc" },
    } as never);
    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if ("key" in args) return okRate();
      return {
        ok: true,
        packageId: "packages:opik",
        name: "@opik/opik-openclaw",
        ownerUserId: "users:vincent",
        ownerPublisherId: "publishers:opik",
        channel: "community",
        isOfficial: false,
      };
    });

    const response = await __handlers.packagesPostRouterV1Handler(
      makeCtx({ runMutation }),
      new Request("https://example.com/api/v1/packages/%40opik%2Fopik-openclaw/transfer", {
        method: "POST",
        headers: {
          Authorization: "Bearer clh_test",
          "content-type": "application/json",
        },
        body: JSON.stringify({ toOwner: "opik" }),
      }),
    );

    if (response.status !== 200) throw new Error(await response.text());
    expect(await response.json()).toEqual({
      ok: true,
      packageId: "packages:opik",
      name: "@opik/opik-openclaw",
      ownerUserId: "users:vincent",
      ownerPublisherId: "publishers:opik",
      channel: "community",
      isOfficial: false,
    });
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorUserId: "users:vincent",
        name: "@opik/opik-openclaw",
        toOwner: "opik",
      }),
    );
  });

  it("dry-runs package name repair without mutating packages", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-15T12:00:00Z"));
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:admin",
      user: { _id: "users:admin", role: "admin", handle: "patrick" },
    } as never);
    const sourcePackage = {
      _id: "packages:source",
      name: "@openclaw/openviking",
      normalizedName: "@openclaw/openviking",
      runtimeId: "openviking",
      ownerUserId: "users:lin",
      ownerPublisherId: "publishers:lin",
      channel: "community",
      softDeletedAt: undefined,
    };
    const targetPackage = {
      _id: "packages:target",
      name: "@openviking/openclaw-plugin",
      normalizedName: "@openviking/openclaw-plugin",
      runtimeId: "openviking-openclaw-plugin-placeholder",
      ownerUserId: "users:openviking",
      ownerPublisherId: "publishers:openviking",
      channel: "private",
      softDeletedAt: undefined,
    };
    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if ("key" in args) return okRate();
      return { ok: true };
    });
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("key" in args) return okRate();
      if (args.name === "@openclaw/openviking") return sourcePackage;
      if (args.name === "@openviking/openclaw-plugin") return targetPackage;
      if (args.name === "@openviking/openclaw-plugin-retired-20260515") return null;
      return null;
    });

    const response = await __handlers.packagesPostRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/packages/%40openclaw%2Fopenviking/repair-name", {
        method: "POST",
        headers: {
          Authorization: "Bearer clh_test",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          nextName: "@openviking/openclaw-plugin",
          retireTarget: true,
          reason: "Admin repair for openclaw/clawhub#2133",
          dryRun: true,
        }),
      }),
    );

    if (response.status !== 200) throw new Error(await response.text());
    expect(await response.json()).toMatchObject({
      ok: true,
      dryRun: true,
      source: { packageId: "packages:source", name: "@openclaw/openviking" },
      target: { packageId: "packages:target", name: "@openviking/openclaw-plugin" },
      retiredName: "@openviking/openclaw-plugin-retired-20260515",
      operations: [
        {
          action: "retire-target",
          from: "@openviking/openclaw-plugin",
          to: "@openviking/openclaw-plugin-retired-20260515",
        },
        {
          action: "rename-source",
          from: "@openclaw/openviking",
          to: "@openviking/openclaw-plugin",
        },
      ],
    });
    expect(runMutation).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: "@openviking/openclaw-plugin" }),
    );
    vi.useRealTimers();
  });

  it("applies package name repair by retiring the occupied target first", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-15T12:00:00Z"));
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:admin",
      user: { _id: "users:admin", role: "admin", handle: "patrick" },
    } as never);
    const sourcePackage = {
      _id: "packages:source",
      name: "@openclaw/openviking",
      normalizedName: "@openclaw/openviking",
      runtimeId: "openviking",
      ownerUserId: "users:lin",
      ownerPublisherId: "publishers:lin",
      channel: "community",
      softDeletedAt: undefined,
    };
    const targetPackage = {
      _id: "packages:target",
      name: "@openviking/openclaw-plugin",
      normalizedName: "@openviking/openclaw-plugin",
      runtimeId: "openviking-openclaw-plugin-placeholder",
      ownerUserId: "users:openviking",
      ownerPublisherId: "publishers:openviking",
      channel: "private",
      softDeletedAt: undefined,
    };
    const ownerPublisher = {
      _id: "publishers:openviking",
      handle: "openviking",
      kind: "org",
      deletedAt: undefined,
    };
    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if ("key" in args) return okRate();
      return { ok: true, packageId: "packages:source" };
    });
    const runQuery = vi.fn(async (_query: unknown, args: Record<string, unknown>) => {
      if ("key" in args) return okRate();
      if (args.name === "@openclaw/openviking") return sourcePackage;
      if (args.name === "@openviking/openclaw-plugin") return targetPackage;
      if (args.name === "@openviking/openclaw-plugin-retired-20260515") return null;
      if (args.handle === "openviking") return ownerPublisher;
      return null;
    });

    const response = await __handlers.packagesPostRouterV1Handler(
      makeCtx({ runQuery, runMutation }),
      new Request("https://example.com/api/v1/packages/%40openclaw%2Fopenviking/repair-name", {
        method: "POST",
        headers: {
          Authorization: "Bearer clh_test",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          nextName: "@openviking/openclaw-plugin",
          retireTarget: true,
          owner: "openviking",
          reason: "Admin repair for openclaw/clawhub#2133",
          dryRun: false,
        }),
      }),
    );

    if (response.status !== 200) throw new Error(await response.text());
    expect(runMutation).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        actorUserId: "users:admin",
        name: "@openviking/openclaw-plugin",
        nextName: "@openviking/openclaw-plugin-retired-20260515",
      }),
    );
    expect(runMutation).toHaveBeenNthCalledWith(
      3,
      expect.anything(),
      expect.objectContaining({
        userId: "users:admin",
        name: "@openviking/openclaw-plugin-retired-20260515",
      }),
    );
    expect(runMutation).toHaveBeenNthCalledWith(
      4,
      expect.anything(),
      expect.objectContaining({
        actorUserId: "users:admin",
        name: "@openclaw/openviking",
        nextName: "@openviking/openclaw-plugin",
      }),
    );
    expect(runMutation).toHaveBeenNthCalledWith(
      5,
      expect.anything(),
      expect.objectContaining({
        actorUserId: "users:admin",
        name: "@openviking/openclaw-plugin",
        ownerUserId: "users:lin",
        ownerPublisherId: "publishers:openviking",
        channel: "community",
      }),
    );
    vi.useRealTimers();
  });

  it("package transfer maps ownership denials to 403", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:stranger",
      user: { _id: "users:stranger", handle: "stranger" },
    } as never);
    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if ("key" in args) return okRate();
      throw new Error("Forbidden: Only owners can transfer this package.");
    });

    const response = await __handlers.packagesPostRouterV1Handler(
      makeCtx({ runMutation }),
      new Request("https://example.com/api/v1/packages/%40opik%2Fopik-openclaw/transfer", {
        method: "POST",
        headers: {
          Authorization: "Bearer clh_test",
          "content-type": "application/json",
        },
        body: JSON.stringify({ toOwner: "opik" }),
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.text()).toBe("Forbidden: Only owners can transfer this package.");
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
    expect(fetchGitHubRepositoryIdentity).toHaveBeenCalledWith(
      "https://github.com/openclaw/openclaw",
    );
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
      ([, args]) =>
        typeof args === "object" && args !== null && "packageName" in args && "actorUserId" in args,
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

  it("deletes a package", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:1",
      user: { _id: "users:1", handle: "p" },
    } as never);
    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if ("key" in args) return okRate();
      return { ok: true };
    });

    const response = await __handlers.packagesDeleteRouterV1Handler(
      makeCtx({ runMutation }),
      new Request("https://example.com/api/v1/packages/%40openclaw%2Fdemo-plugin", {
        method: "DELETE",
        headers: { Authorization: "Bearer clh_test" },
      }),
    );

    expect(response.status).toBe(200);
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "users:1",
        name: "@openclaw/demo-plugin",
      }),
    );
  });

  it("undeletes a package", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:1",
      user: { _id: "users:1", handle: "p" },
    } as never);
    const runMutation = vi.fn(async (_mutation: unknown, args: Record<string, unknown>) => {
      if ("key" in args) return okRate();
      return { ok: true };
    });

    const response = await __handlers.packagesPostRouterV1Handler(
      makeCtx({ runMutation }),
      new Request("https://example.com/api/v1/packages/%40openclaw%2Fdemo-plugin/undelete", {
        method: "POST",
        headers: { Authorization: "Bearer clh_test" },
      }),
    );

    expect(response.status).toBe(200);
    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "users:1",
        name: "@openclaw/demo-plugin",
      }),
    );
  });

  it("package delete and undelete map ownership denials to 403", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:stranger",
      user: { _id: "users:stranger", handle: "stranger" },
    } as never);
    const runMutationForbidden = vi.fn(
      async (_mutation: unknown, args: Record<string, unknown>) => {
        if ("key" in args) return okRate();
        throw new Error("Forbidden: This package belongs to another owner.");
      },
    );

    const deleteResponse = await __handlers.packagesDeleteRouterV1Handler(
      makeCtx({ runMutation: runMutationForbidden }),
      new Request("https://example.com/api/v1/packages/%40openclaw%2Fdemo-plugin", {
        method: "DELETE",
        headers: { Authorization: "Bearer clh_test" },
      }),
    );
    expect(deleteResponse.status).toBe(403);
    expect(await deleteResponse.text()).toBe("Forbidden: This package belongs to another owner.");

    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:stranger",
      user: { _id: "users:stranger", handle: "stranger" },
    } as never);
    const undeleteResponse = await __handlers.packagesPostRouterV1Handler(
      makeCtx({ runMutation: runMutationForbidden }),
      new Request("https://example.com/api/v1/packages/%40openclaw%2Fdemo-plugin/undelete", {
        method: "POST",
        headers: { Authorization: "Bearer clh_test" },
      }),
    );
    expect(undeleteResponse.status).toBe(403);
    expect(await undeleteResponse.text()).toBe("Forbidden: This package belongs to another owner.");
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

  // Regression: owner undelete gate throws a ConvexError prefixed with
  // "Forbidden:" so the HTTP layer returns a deterministic 403 and surfaces
  // the actionable reason ("hidden by moderation") instead of falling through
  // to a generic 500.
  it("owner undelete denial returns 403 with moderation reason in body", async () => {
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:owner",
      user: { handle: "p" },
    } as never);

    const moderationMessage =
      "Forbidden: This skill was hidden by moderation and cannot be restored by the owner. Please contact a moderator.";
    const runMutationModerationDenied = vi.fn(
      async (_query: unknown, args: Record<string, unknown>) => {
        if ("key" in args) return okRate();
        // Mirror ConvexError shape: Error subclass whose message carries the
        // "Forbidden:" sentinel so softDeleteErrorToResponse routes to 403.
        throw new Error(moderationMessage);
      },
    );

    const response = await __handlers.skillsPostRouterV1Handler(
      makeCtx({ runMutation: runMutationModerationDenied }),
      new Request("https://example.com/api/v1/skills/demo/undelete", {
        method: "POST",
        headers: { Authorization: "Bearer clh_test" },
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.text()).toBe(moderationMessage);
  });
});
