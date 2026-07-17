/* @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
  authTables: {},
}));

vi.mock("./lib/badges", () => ({
  getSkillBadgeMap: vi.fn(),
  getSkillBadgeMaps: vi.fn(),
  isSkillHighlighted: vi.fn(),
}));

const { getAuthUserId } = await import("@convex-dev/auth/server");
const { getSkillBadgeMap, getSkillBadgeMaps } = await import("./lib/badges");
const {
  getBySlug,
  getVersionById,
  getVersionBySkillAndVersion,
  listHighlightedPublic,
  listVersions,
  listVersionsPage,
  listWithLatest,
} = await import("./skills");

type WrappedHandler<TArgs, TResult = unknown> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const getBySlugHandler = (
  getBySlug as unknown as WrappedHandler<{
    slug: string;
  }>
)._handler;

const getVersionByIdHandler = (
  getVersionById as unknown as WrappedHandler<{
    versionId: string;
  }>
)._handler;

const getVersionBySkillAndVersionHandler = (
  getVersionBySkillAndVersion as unknown as WrappedHandler<{
    skillId: string;
    version: string;
  }>
)._handler;

const listVersionsHandler = (
  listVersions as unknown as WrappedHandler<{
    skillId: string;
    limit?: number;
  }>
)._handler;

const listVersionsPageHandler = (
  listVersionsPage as unknown as WrappedHandler<{
    skillId: string;
    cursor?: string;
    limit?: number;
  }>
)._handler;

const listWithLatestHandler = (
  listWithLatest as unknown as WrappedHandler<{
    limit?: number;
  }>
)._handler;
const listHighlightedPublicHandler = (
  listHighlightedPublic as unknown as WrappedHandler<{
    limit?: number;
  }>
)._handler;

function makeVersion() {
  return {
    _id: "skillVersions:1",
    _creationTime: 1,
    skillId: "skills:1",
    version: "1.0.0",
    fingerprint: "fp",
    changelog: "Initial release",
    changelogSource: "auto",
    files: [
      {
        path: "SKILL.md",
        size: 10,
        storageId: "_storage:1",
        sha256: "abc123",
        contentType: "text/markdown",
      },
    ],
    parsed: {
      frontmatter: { description: "Full uploaded description", secret: "value" },
      metadata: { hidden: true },
      clawdis: { os: ["macos"] },
      moltbot: { prompt: "hidden" },
      license: "MIT-0",
    },
    createdBy: "users:1",
    createdAt: 100,
    softDeletedAt: undefined,
    sha256hash: "deadbeef",
    vtAnalysis: {
      status: "clean",
      verdict: "clean",
      analysis: "safe",
      source: "legacy-ai",
      checkedAt: 1,
    },
    llmAnalysis: {
      status: "clean",
      verdict: "benign",
      confidence: "high",
      summary: "Looks safe",
      dimensions: [],
      guidance: "ok",
      findings: "none",
      model: "gpt",
      checkedAt: 1,
    },
    staticScan: {
      status: "suspicious",
      reasonCodes: ["scanner.example"],
      findings: [
        {
          code: "scanner.example",
          severity: "warn",
          file: "SKILL.md",
          line: 1,
          message: "Example finding",
          evidence: "SECRET_SNIPPET",
        },
      ],
      summary: "Something matched",
      engineVersion: "1",
      checkedAt: 1,
    },
  };
}

function makePaginatedSkillVersionQuery(versions: Array<Record<string, unknown>>) {
  const filters = new Map<string, unknown>();
  const indexNames: string[] = [];
  const paginate = vi.fn(
    async ({ cursor, numItems }: { cursor: string | null; numItems: number }) => {
      const start = cursor ? Number(cursor) : 0;
      const filtered = versions.filter((candidate) =>
        [...filters].every(([field, value]) => candidate[field] === value),
      );
      const page = filtered.slice(start, start + numItems);
      const next = start + page.length;
      return {
        page,
        isDone: next >= filtered.length,
        continueCursor: String(next),
      };
    },
  );
  const withIndex = vi.fn(
    (
      index: string,
      buildQuery?: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
    ) => {
      indexNames.push(index);
      const query = {
        eq(field: string, value: unknown) {
          filters.set(field, value);
          return query;
        },
      };
      buildQuery?.(query);
      return { order: vi.fn(() => ({ paginate })) };
    },
  );
  return { withIndex, paginate, filters, indexNames };
}

describe("public skill version queries", () => {
  beforeEach(() => {
    vi.mocked(getAuthUserId).mockReset();
    vi.mocked(getSkillBadgeMap).mockReset();
    vi.mocked(getSkillBadgeMaps).mockReset();
    vi.mocked(getAuthUserId).mockResolvedValue(null as never);
    vi.mocked(getSkillBadgeMap).mockResolvedValue({} as never);
    vi.mocked(getSkillBadgeMaps).mockResolvedValue(new Map() as never);
  });

  it("sanitizes latestVersion returned by getBySlug", async () => {
    const version = makeVersion();
    const ctx = {
      db: {
        query: vi.fn((table: string) => {
          if (table === "skillSlugAliases") {
            return {
              withIndex: vi.fn(() => ({
                take: vi.fn().mockResolvedValue([]),
              })),
            };
          }
          if (table !== "skills") throw new Error(`Unexpected table ${table}`);
          return {
            withIndex: vi.fn(() => ({
              unique: vi.fn().mockResolvedValue({
                _id: "skills:1",
                _creationTime: 1,
                slug: "demo",
                displayName: "Demo",
                summary: "Summary",
                ownerUserId: "users:1",
                canonicalSkillId: undefined,
                forkOf: undefined,
                latestVersionId: version._id,
                tags: {},
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
                moderationStatus: "active",
                moderationFlags: undefined,
                moderationReason: undefined,
                softDeletedAt: undefined,
              }),
            })),
          };
        }),
        get: vi.fn(async (id: string) => {
          if (id === version._id) return version;
          if (id === "users:1") {
            return {
              _id: "users:1",
              _creationTime: 1,
              handle: "demo",
              name: "demo",
              displayName: "Demo",
              image: null,
              bio: null,
            };
          }
          return null;
        }),
      },
    } as never;

    const result = (await getBySlugHandler(ctx, { slug: "demo" } as never)) as {
      latestVersion?: {
        files: Array<Record<string, unknown>>;
        parsed?: Record<string, unknown>;
        staticScan?: { findings?: Array<{ evidence?: string }> };
      } | null;
    } | null;

    expect(result?.latestVersion?.files[0]).not.toHaveProperty("storageId");
    expect(result?.latestVersion?.parsed).toEqual({
      clawdis: { os: ["macos"] },
      description: "Full uploaded description",
      license: "MIT-0",
    });
    expect(result?.latestVersion?.staticScan?.findings?.[0]?.evidence).toBe("");
  });

  it("sanitizes direct public version queries", async () => {
    const version = makeVersion();
    const unique = vi.fn().mockResolvedValue(version);
    const paginated = makePaginatedSkillVersionQuery([version]);
    const ctx = {
      db: {
        get: vi.fn().mockResolvedValue(version),
        query: vi.fn((table: string) => {
          if (table !== "skillVersions") throw new Error(`Unexpected table ${table}`);
          return {
            withIndex: vi.fn((index: string, buildQuery?: unknown) =>
              index === "by_skill_active_created"
                ? paginated.withIndex(index, buildQuery as never)
                : { unique },
            ),
          };
        }),
      },
    } as never;

    const byId = (await getVersionByIdHandler(ctx, {
      versionId: version._id,
    } as never)) as {
      files: Array<Record<string, unknown>>;
      parsed?: Record<string, unknown>;
      staticScan?: { findings?: Array<{ evidence?: string }> };
    } | null;
    const byVersion = (await getVersionBySkillAndVersionHandler(ctx, {
      skillId: "skills:1",
      version: "1.0.0",
    } as never)) as {
      files: Array<Record<string, unknown>>;
      parsed?: Record<string, unknown>;
      staticScan?: { findings?: Array<{ evidence?: string }> };
    } | null;
    const list = (await listVersionsHandler(ctx, {
      skillId: "skills:1",
      limit: 5,
    } as never)) as Array<{
      files: Array<Record<string, unknown>>;
      parsed?: Record<string, unknown>;
      staticScan?: { findings?: Array<{ evidence?: string }> };
    }>;

    for (const result of [byId, byVersion, list[0]]) {
      expect(result?.files[0]).not.toHaveProperty("storageId");
      expect(result?.parsed).not.toHaveProperty("frontmatter");
      expect(result?.parsed).not.toHaveProperty("metadata");
      expect(result?.parsed).not.toHaveProperty("moltbot");
      expect(result?.parsed?.description).toBe("Full uploaded description");
      expect(result?.staticScan?.findings?.[0]?.evidence).toBe("");
    }
  });

  it("hides soft-deleted or owner-deleted versions from direct public queries", async () => {
    for (const version of [
      { ...makeVersion(), softDeletedAt: 123 },
      { ...makeVersion(), ownerDeletedAt: 123 },
    ]) {
      const ctx = {
        db: {
          get: vi.fn().mockResolvedValue(version),
          query: vi.fn((table: string) => {
            if (table !== "skillVersions") throw new Error(`Unexpected table ${table}`);
            return {
              withIndex: vi.fn(() => ({
                unique: vi.fn().mockResolvedValue(version),
              })),
            };
          }),
        },
      } as never;

      await expect(
        getVersionByIdHandler(ctx, { versionId: version._id } as never),
      ).resolves.toBeNull();
      await expect(
        getVersionBySkillAndVersionHandler(ctx, {
          skillId: version.skillId,
          version: version.version,
        } as never),
      ).resolves.toBeNull();
    }
  });

  it("hides pending publication versions while keeping legacy status-less versions public", async () => {
    for (const version of [
      { ...makeVersion(), publicationStatus: "pending" },
      { ...makeVersion(), publicationStatus: "blocked" },
    ]) {
      const ctx = {
        db: {
          get: vi.fn().mockResolvedValue(version),
          query: vi.fn((table: string) => {
            if (table !== "skillVersions") throw new Error(`Unexpected table ${table}`);
            return {
              withIndex: vi.fn(() => ({
                unique: vi.fn().mockResolvedValue(version),
              })),
            };
          }),
        },
      } as never;

      await expect(
        getVersionByIdHandler(ctx, { versionId: version._id } as never),
      ).resolves.toBeNull();
      await expect(
        getVersionBySkillAndVersionHandler(ctx, {
          skillId: version.skillId,
          version: version.version,
        } as never),
      ).resolves.toBeNull();
    }

    const legacyVersion = makeVersion();
    const legacyCtx = {
      db: {
        get: vi.fn().mockResolvedValue(legacyVersion),
        query: vi.fn((table: string) => {
          if (table !== "skillVersions") throw new Error(`Unexpected table ${table}`);
          return {
            withIndex: vi.fn(() => ({
              unique: vi.fn().mockResolvedValue(legacyVersion),
            })),
          };
        }),
      },
    } as never;

    await expect(
      getVersionByIdHandler(legacyCtx, { versionId: legacyVersion._id } as never),
    ).resolves.toMatchObject({ _id: legacyVersion._id });
  });

  it("applies public version limits after skipping pending publication versions", async () => {
    const version = makeVersion();
    const pendingVersion = {
      ...makeVersion(),
      _id: "skillVersions:pending",
      version: "2.0.0",
      publicationStatus: "pending",
    };
    const paginated = makePaginatedSkillVersionQuery([pendingVersion, version]);
    const ctx = {
      db: {
        get: vi.fn().mockResolvedValue(null),
        query: vi.fn((table: string) => {
          if (table !== "skillVersions") throw new Error(`Unexpected table ${table}`);
          return { withIndex: paginated.withIndex };
        }),
      },
    } as never;

    const result = (await listVersionsHandler(ctx, {
      skillId: "skills:1",
      limit: 1,
    } as never)) as Array<{ version: string }>;

    expect(result.map((item) => item.version)).toEqual(["1.0.0"]);
    expect(paginated.indexNames).toEqual(["by_skill_active_created"]);
    expect(paginated.filters).toEqual(
      new Map<string, unknown>([
        ["skillId", "skills:1"],
        ["softDeletedAt", undefined],
      ]),
    );
    expect(paginated.paginate).toHaveBeenCalledOnce();
    expect(paginated.paginate).toHaveBeenCalledWith({ cursor: null, numItems: 12 });
  });

  it("bounds public version pagination over hidden pending versions", async () => {
    const pendingVersions = Array.from({ length: 13 }, (_, index) => ({
      ...makeVersion(),
      _id: `skillVersions:pending-${index}`,
      version: `2.0.${index}`,
      publicationStatus: "pending",
    }));
    const publishedVersion = {
      ...makeVersion(),
      _id: "skillVersions:published-after-backlog",
      version: "1.0.0",
    };
    const paginated = makePaginatedSkillVersionQuery([...pendingVersions, publishedVersion]);
    const ctx = {
      db: {
        query: vi.fn((table: string) => {
          if (table !== "skillVersions") throw new Error(`Unexpected table ${table}`);
          return { withIndex: paginated.withIndex };
        }),
      },
    } as never;

    const result = (await listVersionsPageHandler(ctx, {
      skillId: "skills:1",
      limit: 1,
    } as never)) as { items: Array<{ version: string }>; nextCursor: string | null };

    expect(result).toEqual({ items: [], nextCursor: "12" });
    expect(paginated.paginate).toHaveBeenCalledOnce();
    expect(paginated.paginate).toHaveBeenCalledWith({ cursor: null, numItems: 12 });
  });

  it.each(["admin", "moderator"] as const)(
    "shows soft-deleted version history to %s staff through the bounded skill index",
    async (role) => {
      const version = makeVersion();
      const deletedVersion = {
        ...makeVersion(),
        _id: "skillVersions:deleted",
        version: "2.0.0",
        softDeletedAt: 123,
      };
      const indexNames: string[] = [];
      const filters = new Map<string, unknown>();
      const take = vi.fn(async (limit: number) => [deletedVersion, version].slice(0, limit));
      vi.mocked(getAuthUserId).mockResolvedValue("users:staff" as never);
      const ctx = {
        db: {
          get: vi.fn(async (id: string) => (id === "users:staff" ? { _id: id, role } : null)),
          query: vi.fn((table: string) => {
            if (table !== "skillVersions") throw new Error(`Unexpected table ${table}`);
            return {
              withIndex: vi.fn(
                (
                  index: string,
                  buildQuery?: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
                ) => {
                  indexNames.push(index);
                  const query = {
                    eq(field: string, value: unknown) {
                      filters.set(field, value);
                      return query;
                    },
                  };
                  buildQuery?.(query);
                  return { order: vi.fn(() => ({ take })) };
                },
              ),
            };
          }),
        },
      } as never;

      const result = (await listVersionsHandler(ctx, {
        skillId: "skills:1",
        limit: 500,
      } as never)) as Array<{ version: string; softDeletedAt?: number }>;

      expect(result.map((item) => item.version)).toEqual(["2.0.0", "1.0.0"]);
      expect(result[0]?.softDeletedAt).toBe(123);
      expect(indexNames).toEqual(["by_skill"]);
      expect(filters).toEqual(new Map<string, unknown>([["skillId", "skills:1"]]));
      expect(take).toHaveBeenCalledWith(200);
    },
  );

  it("shows active pending version history to owners through the bounded active index", async () => {
    const version = makeVersion();
    const pendingVersion = {
      ...makeVersion(),
      _id: "skillVersions:pending",
      version: "2.0.0",
      publicationStatus: "pending",
    };
    const indexNames: string[] = [];
    const filters = new Map<string, unknown>();
    const take = vi.fn(async (limit: number) => [pendingVersion, version].slice(0, limit));
    vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:owner") return { _id: id, role: "user" };
          if (id === "skills:1") {
            return {
              _id: id,
              ownerUserId: "users:owner",
              ownerPublisherId: undefined,
            };
          }
          return null;
        }),
        query: vi.fn((table: string) => {
          if (table !== "skillVersions") throw new Error(`Unexpected table ${table}`);
          return {
            withIndex: vi.fn(
              (
                index: string,
                buildQuery?: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
              ) => {
                indexNames.push(index);
                const query = {
                  eq(field: string, value: unknown) {
                    filters.set(field, value);
                    return query;
                  },
                };
                buildQuery?.(query);
                return { order: vi.fn(() => ({ take })) };
              },
            ),
          };
        }),
      },
    } as never;

    const result = (await listVersionsHandler(ctx, {
      skillId: "skills:1",
      limit: 50,
    } as never)) as Array<{ version: string }>;

    expect(result.map((item) => item.version)).toEqual(["2.0.0", "1.0.0"]);
    expect(indexNames).toEqual(["by_skill_active_created"]);
    expect(filters).toEqual(
      new Map<string, unknown>([
        ["skillId", "skills:1"],
        ["softDeletedAt", undefined],
      ]),
    );
    expect(take).toHaveBeenCalledWith(50);
  });

  it("keeps soft-deleted versions from consuming an ordinary viewer's limit", async () => {
    const version = makeVersion();
    const deletedVersion = {
      ...makeVersion(),
      _id: "skillVersions:deleted",
      version: "2.0.0",
      softDeletedAt: 123,
    };
    const paginated = makePaginatedSkillVersionQuery([deletedVersion, version]);
    vi.mocked(getAuthUserId).mockResolvedValue("users:viewer" as never);
    const ctx = {
      db: {
        get: vi.fn(async (id: string) =>
          id === "users:viewer" ? { _id: id, role: "user" } : null,
        ),
        query: vi.fn((table: string) => {
          if (table !== "skillVersions") throw new Error(`Unexpected table ${table}`);
          return { withIndex: paginated.withIndex };
        }),
      },
    } as never;

    const result = (await listVersionsHandler(ctx, {
      skillId: "skills:1",
      limit: 1,
    } as never)) as Array<{ version: string }>;

    expect(result.map((item) => item.version)).toEqual(["1.0.0"]);
    expect(paginated.indexNames).toEqual(["by_skill_active_created"]);
    expect(paginated.filters).toEqual(
      new Map<string, unknown>([
        ["skillId", "skills:1"],
        ["softDeletedAt", undefined],
      ]),
    );
    expect(paginated.paginate).toHaveBeenCalledWith({ cursor: null, numItems: 12 });
  });

  it("paginates public version history over active skill versions", async () => {
    const version = makeVersion();
    const deletedVersion = {
      ...makeVersion(),
      _id: "skillVersions:deleted",
      version: "2.0.0",
      softDeletedAt: 123,
    };
    const indexNames: string[] = [];
    const filters = new Map<string, unknown>();
    const paginate = vi.fn(async ({ numItems }: { numItems: number }) => ({
      page: [deletedVersion, version]
        .filter((candidate) =>
          [...filters].every(
            ([field, value]) => candidate[field as keyof typeof candidate] === value,
          ),
        )
        .slice(0, numItems),
      isDone: false,
      continueCursor: "next-active-page",
    }));
    const ctx = {
      db: {
        query: vi.fn((table: string) => {
          if (table !== "skillVersions") throw new Error(`Unexpected table ${table}`);
          return {
            withIndex: vi.fn(
              (
                index: string,
                buildQuery?: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
              ) => {
                indexNames.push(index);
                const query = {
                  eq(field: string, value: unknown) {
                    filters.set(field, value);
                    return query;
                  },
                };
                buildQuery?.(query);
                return { order: vi.fn(() => ({ paginate })) };
              },
            ),
          };
        }),
      },
    } as never;

    const result = (await listVersionsPageHandler(ctx, {
      skillId: "skills:1",
      cursor: "active-page",
      limit: 1,
    } as never)) as { items: Array<{ version: string }>; nextCursor: string | null };

    expect(result.items.map((item) => item.version)).toEqual(["1.0.0"]);
    expect(result.nextCursor).toBe("next-active-page");
    expect(indexNames).toEqual(["by_skill_active_created"]);
    expect(filters).toEqual(
      new Map<string, unknown>([
        ["skillId", "skills:1"],
        ["softDeletedAt", undefined],
      ]),
    );
    expect(paginate).toHaveBeenCalledWith({ cursor: "active-page", numItems: 12 });
  });

  it("recovers public version pagination from stale pre-active-index cursors", async () => {
    const paginate = vi.fn(async ({ cursor }: { cursor: string | null }) => {
      if (cursor === "legacy-by-skill-cursor") {
        throw new Error("cursor is from a different query");
      }
      throw new Error("stale cursor recovery should not retry old skill version pages");
    });
    const ctx = {
      db: {
        query: vi.fn((table: string) => {
          if (table !== "skillVersions") throw new Error(`Unexpected table ${table}`);
          return {
            withIndex: vi.fn(() => ({
              order: vi.fn(() => ({ paginate })),
            })),
          };
        }),
      },
    } as never;

    const result = (await listVersionsPageHandler(ctx, {
      skillId: "skills:1",
      cursor: "legacy-by-skill-cursor",
      limit: 1,
    } as never)) as { items: Array<{ version: string }>; nextCursor: string | null };

    expect(result).toEqual({ items: [], nextCursor: null });
    expect(paginate).toHaveBeenCalledTimes(1);
    expect(paginate).toHaveBeenCalledWith({ cursor: "legacy-by-skill-cursor", numItems: 12 });
  });

  it("sanitizes latestVersion in listWithLatest", async () => {
    const version = makeVersion();
    const ctx = {
      db: {
        query: vi.fn((table: string) => {
          if (table !== "skills") throw new Error(`Unexpected table ${table}`);
          return {
            order: vi.fn(() => ({
              take: vi.fn().mockResolvedValue([
                {
                  _id: "skills:1",
                  _creationTime: 1,
                  slug: "demo",
                  displayName: "Demo",
                  summary: "Summary",
                  ownerUserId: "users:1",
                  canonicalSkillId: undefined,
                  forkOf: undefined,
                  latestVersionId: version._id,
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
                  moderationFlags: undefined,
                  moderationReason: undefined,
                },
              ]),
            })),
          };
        }),
        get: vi.fn().mockResolvedValue(version),
      },
    } as never;

    const result = (await listWithLatestHandler(ctx, { limit: 1 } as never)) as Array<{
      latestVersion?: {
        files: Array<Record<string, unknown>>;
        parsed?: Record<string, unknown>;
      } | null;
    }>;
    expect(result[0]?.latestVersion?.files[0]).not.toHaveProperty("storageId");
    expect(result[0]?.latestVersion?.parsed).not.toHaveProperty("frontmatter");
  });

  it("drops cross-skill latestVersion in listWithLatest", async () => {
    const version = { ...makeVersion(), _id: "skillVersions:other", skillId: "skills:other" };
    const ctx = {
      db: {
        query: vi.fn((table: string) => {
          if (table !== "skills") throw new Error(`Unexpected table ${table}`);
          return {
            order: vi.fn(() => ({
              take: vi.fn().mockResolvedValue([
                {
                  _id: "skills:1",
                  _creationTime: 1,
                  slug: "demo",
                  displayName: "Demo",
                  summary: "Summary",
                  ownerUserId: "users:1",
                  canonicalSkillId: undefined,
                  forkOf: undefined,
                  latestVersionId: version._id,
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
                  moderationFlags: undefined,
                  moderationReason: undefined,
                },
              ]),
            })),
          };
        }),
        get: vi.fn(async (id: string) => {
          if (id === "users:1") return { _id: id };
          if (id === version._id) return version;
          return null;
        }),
      },
    } as never;

    const result = (await listWithLatestHandler(ctx, { limit: 1 } as never)) as Array<{
      latestVersion?: { version: string } | null;
    }>;

    expect(result[0]?.latestVersion).toBeNull();
  });

  it("drops cross-skill latestVersion summaries in highlighted public list", async () => {
    const version = { ...makeVersion(), _id: "skillVersions:other", skillId: "skills:other" };
    const skill = {
      _id: "skills:1",
      _creationTime: 1,
      slug: "demo",
      displayName: "Demo",
      summary: "Summary",
      ownerUserId: "users:1",
      canonicalSkillId: undefined,
      forkOf: undefined,
      latestVersionId: version._id,
      latestVersionSummary: {
        version: "9.9.9",
        createdAt: 9,
        changelog: "stale",
        changelogSource: "user",
        clawdis: undefined,
      },
      tags: {},
      badges: { highlighted: { byUserId: "users:moderator", at: 3 } },
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
      moderationFlags: undefined,
      moderationReason: undefined,
    };
    const ctx = {
      db: {
        query: vi.fn((table: string) => {
          if (table === "officialPublishers") {
            return {
              withIndex: vi.fn(() => ({
                unique: vi.fn().mockResolvedValue(null),
              })),
            };
          }
          if (table !== "skillBadges") throw new Error(`Unexpected table ${table}`);
          return {
            withIndex: vi.fn(() => ({
              order: vi.fn(() => ({
                take: vi.fn().mockResolvedValue([{ skillId: skill._id }]),
              })),
            })),
          };
        }),
        get: vi.fn(async (id: string) => {
          if (id === skill._id) return skill;
          if (id === version._id) return version;
          if (id === "users:1") {
            return {
              _id: "users:1",
              _creationTime: 1,
              handle: "demo",
              displayName: "Demo",
              image: null,
              bio: null,
            };
          }
          return null;
        }),
      },
    } as never;

    const result = (await listHighlightedPublicHandler(ctx, { limit: 1 } as never)) as Array<{
      latestVersion?: { version: string } | null;
    }>;

    expect(result).toHaveLength(1);
    expect(result[0]?.latestVersion).toBeNull();
  });
});
