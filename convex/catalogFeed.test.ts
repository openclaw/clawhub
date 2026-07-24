import { CATALOG_FEED_ID, CATALOG_SKILLS_FEED_ID, type CatalogFeedEntry } from "clawhub-schema";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __test,
  acquireCatalogFeedPublicationLease,
  listChanges,
  listOfficialEntries,
  listOfficialSkillEntries,
  pruneCatalogFeedHistoryInternal,
  publish,
  storePublication,
} from "./catalogFeed";

vi.mock("./lib/publishers", () => ({
  getOwnerPublisher: vi.fn().mockResolvedValue({ handle: "openclaw" }),
}));
vi.mock("./lib/officialPublishers", () => ({
  isOfficialPublisher: vi.fn().mockResolvedValue(true),
}));

type WrappedHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const listOfficialEntriesHandler = (
  listOfficialEntries as unknown as WrappedHandler<
    { family: "code-plugin" | "bundle-plugin" },
    unknown[]
  >
)._handler;
const listOfficialSkillEntriesHandler = (
  listOfficialSkillEntries as unknown as WrappedHandler<
    { publisherId: string; cursor: string | null },
    unknown
  >
)._handler;
const publishHandler = (
  publish as unknown as WrappedHandler<{ expiresAt: string }, Array<{ feedId: string }>>
)._handler;
const storePublicationHandler = (
  storePublication as unknown as WrappedHandler<
    {
      feedId: typeof CATALOG_FEED_ID | typeof CATALOG_SKILLS_FEED_ID;
      description: string;
      generatedAt: string;
      expiresAt: string;
      entries: unknown[];
    },
    { sequence: number; entryCount: number }
  >
)._handler;
const acquirePublicationLeaseHandler = (
  acquireCatalogFeedPublicationLease as unknown as WrappedHandler<{ leaseToken: string }, void>
)._handler;
const listChangesHandler = (
  listChanges as unknown as WrappedHandler<
    {
      feedId: typeof CATALOG_FEED_ID;
      fromSequence: number;
      toSequence: number;
      paginationOpts: { cursor: string | null; numItems: number; maximumRowsRead?: number };
    },
    {
      resetRequired: boolean;
      page?: Array<{ sequence: number; ordinal: number; payload: string }>;
    }
  >
)._handler;
const pruneCatalogFeedHistoryHandler = (
  pruneCatalogFeedHistoryInternal as unknown as WrappedHandler<
    { batchSize?: number },
    { deleted: number; hasMore: boolean }
  >
)._handler;

function makePackage(overrides: Record<string, unknown> = {}) {
  return {
    _id: "packages:1",
    name: "@openclaw/demo",
    normalizedName: "@openclaw/demo",
    displayName: "Demo",
    ownerUserId: "users:1",
    family: "code-plugin",
    channel: "official",
    isOfficial: true,
    latestReleaseId: "packageReleases:1",
    softDeletedAt: undefined,
    ...overrides,
  };
}

function makeRelease(overrides: Record<string, unknown> = {}) {
  return {
    packageId: "packages:1",
    version: "1.2.3",
    integritySha256: "ignored",
    artifactKind: "legacy-zip",
    sha256hash: "artifact-hash",
    verification: { scanStatus: "clean" },
    manualModeration: undefined,
    softDeletedAt: undefined,
    ...overrides,
  };
}

function makeSkill(overrides: Record<string, unknown> = {}) {
  return {
    _id: "skills:1",
    slug: "demo",
    displayName: "Demo skill",
    ownerUserId: "users:1",
    ownerPublisherId: "publishers:1",
    latestVersionId: "skillVersions:1",
    softDeletedAt: undefined,
    moderationStatus: "active",
    ...overrides,
  };
}

function makeGitHubSkill(overrides: Record<string, unknown> = {}) {
  return makeSkill({
    installKind: "github",
    githubSourceId: "githubSkillSources:1",
    githubPath: "skills/aiq-deploy",
    githubCurrentCommit: "1".repeat(40),
    githubCurrentContentHash: "hash-aiq-deploy",
    githubCurrentStatus: "present",
    githubScanStatus: "clean",
    latestVersionId: undefined,
    latestVersionSummary: undefined,
    ...overrides,
  });
}

function makeSkillVersion(overrides: Record<string, unknown> = {}) {
  return {
    _id: "skillVersions:1",
    skillId: "skills:1",
    version: "1.2.3",
    softDeletedAt: undefined,
    files: [{ path: "SKILL.md", size: 1, storageId: "storage:1", sha256: "file-hash" }],
    sha256hash: "skill-hash",
    ...overrides,
  };
}

function makeGitHubSource(overrides: Record<string, unknown> = {}) {
  return {
    _id: "githubSkillSources:1",
    repo: "NVIDIA/skills",
    ownerPublisherId: "publishers:1",
    defaultBranch: "main",
    ...overrides,
  };
}

function makeFeedSkillEntry(index: number): CatalogFeedEntry {
  const id = `@openclaw/demo-${index.toString().padStart(3, "0")}`;
  return {
    type: "skill",
    id,
    title: `Demo ${index}`,
    version: "1.0.0",
    state: "available",
    publisher: { id: "openclaw", trust: "official" },
    install: {
      candidates: [
        {
          sourceRef: "public-clawhub",
          package: id,
          version: "1.0.0",
          integrity: `sha256:skill-${index}`,
        },
      ],
    },
  };
}

function makeFeedPluginEntry(index: number): CatalogFeedEntry {
  const id = `@openclaw/plugin-${index.toString().padStart(4, "0")}`;
  return {
    type: "plugin",
    id,
    title: `Plugin ${index}`,
    version: "1.0.0",
    state: "available",
    publisher: { id: "openclaw", trust: "official" },
    install: {
      candidates: [
        {
          sourceRef: "public-clawhub",
          package: id,
          version: "1.0.0",
          integrity: `sha256:plugin-${index}`,
        },
      ],
    },
  };
}

function makeCtx(
  packages: unknown[],
  records: Record<string, unknown>,
  options: { packageHighlightedAt?: number } = {},
) {
  return {
    db: {
      query: vi.fn((table: string) => {
        const query = {
          eq: vi.fn(() => query),
        };
        if (table === "packageBadges") {
          return {
            withIndex: vi.fn((_index: string, apply: (value: typeof query) => unknown) => {
              apply(query);
              return {
                unique: vi.fn(async () =>
                  options.packageHighlightedAt !== undefined
                    ? {
                        packageId: "packages:1",
                        kind: "highlighted",
                        byUserId: "users:moderator",
                        at: options.packageHighlightedAt,
                      }
                    : null,
                ),
              };
            }),
          };
        }
        return {
          withIndex: vi.fn((_index: string, apply: (value: typeof query) => unknown) => {
            apply(query);
            return {
              order: vi.fn(() => ({
                paginate: vi.fn(async () => ({
                  page: packages,
                  isDone: true,
                  continueCursor: "",
                })),
                take: vi.fn(async () => packages),
              })),
            };
          }),
          take: vi.fn(async () => [{ publisherId: "publishers:1" }]),
        };
      }),
      get: vi.fn(async (id: string) => records[id] ?? null),
    },
  };
}

describe("catalog feed projection", () => {
  it("rejects an overlapping publication while its lease is active", async () => {
    const ctx = {
      db: {
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            unique: vi.fn(async () => ({
              _id: "catalogFeedPublicationLeases:1",
              leaseToken: crypto.randomUUID(),
              expirationTime: Date.now() + 60_000,
            })),
          })),
        })),
        insert: vi.fn(),
        patch: vi.fn(),
        replace: vi.fn(),
        delete: vi.fn(),
        get: vi.fn(),
        normalizeId: vi.fn(),
        system: { get: vi.fn(), query: vi.fn() },
      },
    };

    await expect(
      acquirePublicationLeaseHandler(ctx, { leaseToken: crypto.randomUUID() }),
    ).rejects.toThrow("already running");
    expect(ctx.db.insert).not.toHaveBeenCalled();
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds deterministic complete revision changes", () => {
    const previous = makeFeedSkillEntry(1);
    const replacement = { ...previous, title: "Updated" };
    const removed = makeFeedSkillEntry(2);
    expect(
      __test.buildCatalogFeedChanges({
        sequence: 7,
        previousEntries: [removed, previous],
        nextEntries: [replacement],
        previousDescription: "Official",
        nextDescription: "Official",
      }),
    ).toEqual([
      { sequence: 7, operation: "remove", entryType: "skill", entryId: removed.id },
      { sequence: 7, operation: "upsert", entry: replacement },
    ]);
    expect(
      __test.buildCatalogFeedChanges({
        sequence: 8,
        previousEntries: [replacement],
        nextEntries: [replacement],
        previousDescription: "Official",
        nextDescription: "Official",
      }),
    ).toEqual([{ sequence: 8, operation: "metadata", metadata: { description: "Official" } }]);
  });

  it("stores a revision and its journal rows with the current publication", async () => {
    const insert = vi.fn(async (table: string, _value: Record<string, unknown>) => `${table}:1`);
    const patch = vi.fn();
    const eq = vi.fn().mockReturnThis();
    const ctx = {
      db: {
        query: vi.fn((table: string) => ({
          withIndex: vi.fn((_index: string, apply: (q: { eq: typeof eq }) => unknown) => {
            apply({ eq });
            if (table === "catalogFeedRevisions") {
              return {
                order: vi.fn(() => ({
                  first: vi.fn(async () => ({
                    sequence: 4,
                    changeCount: 0,
                    cumulativeChangeCount: 7,
                    resetRequired: true,
                  })),
                })),
              };
            }
            if (table === "catalogFeedShardPublications") {
              return { order: vi.fn(() => ({ first: vi.fn(async () => ({ sequence: 4 })) })) };
            }
            return { unique: vi.fn(async () => null) };
          }),
        })),
        insert,
        patch,
        replace: vi.fn(),
        delete: vi.fn(),
        get: vi.fn(),
        normalizeId: vi.fn(),
        system: { get: vi.fn(), query: vi.fn() },
      },
    };
    const result = await storePublicationHandler(ctx, {
      feedId: CATALOG_SKILLS_FEED_ID,
      description: "Official",
      generatedAt: "2026-07-16T00:00:00.000Z",
      expiresAt: "2026-07-16T01:00:00.000Z",
      entries: [makeFeedSkillEntry(1)],
    });

    expect(result).toMatchObject({ sequence: 5, entryCount: 1 });
    expect(insert).toHaveBeenCalledWith(
      "catalogFeedRevisions",
      expect.objectContaining({
        feedId: CATALOG_SKILLS_FEED_ID,
        sequence: 5,
        indexedEntryCount: 0,
        changeCount: 2,
        cumulativeChangeCount: 9,
        resetRequired: true,
      }),
    );
    const journalRows = insert.mock.calls.filter(([table]) => table === "catalogFeedChanges");
    expect(journalRows).toHaveLength(2);
    expect(journalRows.map(([, row]) => JSON.parse(String(row.payload)).operation)).toEqual([
      "upsert",
      "metadata",
    ]);
    expect(patch).not.toHaveBeenCalled();
  });

  it("reads only the requested bounded change range", async () => {
    const builder = {
      eq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      lte: vi.fn().mockReturnThis(),
    };
    const paginate = vi.fn(async () => ({
      page: [
        {
          sequence: 4,
          ordinal: 0,
          payload: '{"operation":"metadata"}',
          expirationTime: 1,
        },
      ],
      isDone: true,
      continueCursor: "",
    }));
    const query = vi.fn((table: string) => {
      if (table === "catalogFeedRevisions") {
        return {
          withIndex: vi.fn((_index: string, apply?: (q: typeof builder) => unknown) => {
            apply?.(builder);
            const ordered = {
              order: vi.fn((direction: "asc" | "desc") => ({
                first: vi.fn(async () =>
                  direction === "asc"
                    ? { sequence: 4, changeCount: 2, cumulativeChangeCount: 2 }
                    : { sequence: 5, changeCount: 1, cumulativeChangeCount: 3 },
                ),
              })),
            };
            return {
              filter: vi.fn(() => ({ ...ordered, first: vi.fn(async () => null) })),
              unique: vi.fn(async () => ({
                sequence: 4,
                changeCount: 2,
                cumulativeChangeCount: 2,
              })),
            };
          }),
        };
      }
      return {
        withIndex: vi.fn((_index: string, apply: (q: typeof builder) => unknown) => {
          apply(builder);
          return { paginate };
        }),
      };
    });
    const result = await listChangesHandler(
      {
        db: { query },
      },
      {
        feedId: CATALOG_FEED_ID,
        fromSequence: 3,
        toSequence: 4,
        paginationOpts: { cursor: null, numItems: 100 },
      },
    );

    expect(builder.gt).toHaveBeenCalledWith("sequence", 3);
    expect(builder.lte).toHaveBeenCalledWith("sequence", 4);
    expect(paginate).toHaveBeenCalledWith({
      cursor: null,
      numItems: 100,
      maximumRowsRead: 100,
    });

    await listChangesHandler(
      { db: { query } },
      {
        feedId: CATALOG_FEED_ID,
        fromSequence: 3,
        toSequence: 4,
        paginationOpts: { cursor: null, numItems: 100, maximumRowsRead: 25 },
      },
    );
    expect(paginate).toHaveBeenLastCalledWith({
      cursor: null,
      numItems: 100,
      maximumRowsRead: 25,
    });
    expect(result).toMatchObject({
      resetRequired: false,
      retainedFromSequence: 3,
      currentSequence: 5,
      changeCount: 2,
      page: [{ sequence: 4, ordinal: 0, payload: '{"operation":"metadata"}' }],
    });

    const laterRange = await listChangesHandler(
      { db: { query } },
      {
        feedId: CATALOG_FEED_ID,
        fromSequence: 4,
        toSequence: 5,
        paginationOpts: { cursor: null, numItems: 100 },
      },
    );
    expect(laterRange).toMatchObject({ resetRequired: false, changeCount: 1 });

    const reset = await listChangesHandler(
      { db: { query } },
      {
        feedId: CATALOG_FEED_ID,
        fromSequence: 2,
        toSequence: 4,
        paginationOpts: { cursor: null, numItems: 100 },
      },
    );
    expect(reset).toEqual({
      resetRequired: true,
      retainedFromSequence: 3,
      currentSequence: 5,
    });
    expect(paginate).toHaveBeenCalledTimes(3);
  });

  it("prunes catalog history in bounded continuation batches", async () => {
    const expiredRevisions = [{ _id: "catalogFeedRevisions:1" }, { _id: "catalogFeedRevisions:2" }];
    const take = vi.fn(async () => expiredRevisions);
    const delete_ = vi.fn();
    const runAfter = vi.fn();
    const result = await pruneCatalogFeedHistoryHandler(
      {
        db: {
          query: vi.fn(() => ({
            withIndex: vi.fn(
              (_index: string, apply: (q: { lt: ReturnType<typeof vi.fn> }) => unknown) => {
                const q = { lt: vi.fn().mockReturnThis() };
                apply(q);
                return { take };
              },
            ),
          })),
          insert: vi.fn(),
          patch: vi.fn(),
          replace: vi.fn(),
          delete: delete_,
          get: vi.fn(),
          normalizeId: vi.fn(),
          system: { get: vi.fn(), query: vi.fn() },
        },
        scheduler: { runAfter },
      },
      { batchSize: 2 },
    );

    expect(result).toEqual({ deleted: 2, hasMore: true });
    expect(delete_).toHaveBeenCalledTimes(2);
    expect(runAfter).toHaveBeenCalledWith(0, expect.anything(), { batchSize: 2 });
  });

  it("projects official releases into ClawHub install candidates", async () => {
    const result = await listOfficialEntriesHandler(
      makeCtx(
        [
          makePackage({
            summary: "Search flights, stays, and travel options.",
            icon: "https://cdn.example.test/expedia.png",
          }),
        ],
        {
          "packageReleases:1": makeRelease(),
        },
      ),
      { family: "code-plugin" },
    );

    expect(result).toEqual([
      {
        type: "plugin",
        id: "@openclaw/demo",
        title: "Demo",
        description: "Search flights, stays, and travel options.",
        icon: "https://cdn.example.test/expedia.png",
        version: "1.2.3",
        state: "available",
        featured: false,
        publisher: { id: "openclaw", trust: "official" },
        install: {
          candidates: [
            {
              sourceRef: "public-clawhub",
              package: "@openclaw/demo",
              version: "1.2.3",
              integrity: "sha256:artifact-hash",
            },
          ],
        },
      },
    ]);
  });

  it("projects highlighted official packages as featured install candidates", async () => {
    const result = await listOfficialEntriesHandler(
      makeCtx(
        [makePackage()],
        {
          "packageReleases:1": makeRelease(),
        },
        { packageHighlightedAt: 1_784_280_000_000 },
      ),
      { family: "code-plugin" },
    );

    expect(result).toEqual([
      expect.objectContaining({
        id: "@openclaw/demo",
        state: "available",
        featured: true,
        featuredAt: 1_784_280_000_000,
        install: {
          candidates: [
            expect.objectContaining({
              package: "@openclaw/demo",
            }),
          ],
        },
      }),
    ]);
  });

  it("excludes non-official, blocked, deleted, and undigested releases", async () => {
    const result = await listOfficialEntriesHandler(
      makeCtx(
        [
          makePackage({ name: "@openclaw/community", channel: "community" }),
          makePackage({ name: "@openclaw/deleted", softDeletedAt: 1 }),
          makePackage({ name: "@openclaw/malicious", latestReleaseId: "packageReleases:2" }),
          makePackage({ name: "@openclaw/no-hash", latestReleaseId: "packageReleases:3" }),
        ],
        {
          "packageReleases:1": makeRelease(),
          "packageReleases:2": makeRelease({ manualModeration: { state: "quarantined" } }),
          "packageReleases:3": makeRelease({ sha256hash: undefined }),
        },
      ),
      { family: "code-plugin" },
    );

    expect(result).toEqual([]);
  });

  it("re-checks the live official publisher record", async () => {
    const { isOfficialPublisher } = await import("./lib/officialPublishers");
    vi.mocked(isOfficialPublisher).mockResolvedValueOnce(false);

    const result = await listOfficialEntriesHandler(
      makeCtx([makePackage()], {
        "packageReleases:1": makeRelease(),
      }),
      { family: "code-plugin" },
    );

    expect(result).toEqual([]);
  });

  it("rejects a latest-release pointer for another package", async () => {
    const result = await listOfficialEntriesHandler(
      makeCtx([makePackage({ _id: "packages:2" })], {
        "packageReleases:1": makeRelease(),
      }),
      { family: "code-plugin" },
    );

    expect(result).toEqual([]);
  });

  it("projects only published skills from verified organization publishers", async () => {
    const result = (await listOfficialSkillEntriesHandler(
      makeCtx([makeSkill({ summary: "Deploy AIQ services.", icon: "lucide:rocket" })], {
        "publishers:1": { _id: "publishers:1", kind: "org", handle: "openclaw" },
        "skillVersions:1": makeSkillVersion(),
      }),
      { publisherId: "publishers:1", cursor: null },
    )) as { entries: unknown[]; isDone: boolean };

    expect(result).toMatchObject({
      entries: [
        {
          type: "skill",
          id: "@openclaw/demo",
          title: "Demo skill",
          description: "Deploy AIQ services.",
          icon: "lucide:rocket",
          version: "1.2.3",
          state: "available",
          featured: false,
          publisher: { id: "openclaw", trust: "official" },
          install: {
            candidates: [
              {
                sourceRef: "public-clawhub",
                package: "@openclaw/demo",
                version: "1.2.3",
                integrity: "sha256:skill-hash",
              },
            ],
          },
        },
      ],
      isDone: true,
    });
  });

  it("projects highlighted official skills as featured install candidates", async () => {
    const result = (await listOfficialSkillEntriesHandler(
      makeCtx(
        [
          makeSkill({
            badges: {
              highlighted: { byUserId: "users:moderator", at: 1_784_280_000_000 },
            },
          }),
        ],
        {
          "publishers:1": { _id: "publishers:1", kind: "org", handle: "openclaw" },
          "skillVersions:1": makeSkillVersion(),
        },
      ),
      { publisherId: "publishers:1", cursor: null },
    )) as { entries: unknown[]; isDone: boolean };

    expect(result.entries).toEqual([
      expect.objectContaining({
        id: "@openclaw/demo",
        state: "available",
        featured: true,
        featuredAt: 1_784_280_000_000,
      }),
    ]);
  });

  it("keeps suspicious hosted skills in hosted ClawHub install candidates", async () => {
    const result = (await listOfficialSkillEntriesHandler(
      makeCtx([makeSkill()], {
        "publishers:1": { _id: "publishers:1", kind: "org", handle: "openclaw" },
        "skillVersions:1": makeSkillVersion({
          llmAnalysis: { status: "complete", verdict: "suspicious" },
        }),
      }),
      { publisherId: "publishers:1", cursor: null },
    )) as { entries: unknown[]; isDone: boolean };

    expect(result.entries).toMatchObject([
      {
        id: "@openclaw/demo",
        state: "available",
        install: {
          candidates: [
            {
              sourceRef: "public-clawhub",
              package: "@openclaw/demo",
            },
          ],
        },
      },
    ]);
  });

  it("projects current GitHub-backed skills into public GitHub install candidates", async () => {
    const result = (await listOfficialSkillEntriesHandler(
      makeCtx([makeGitHubSkill({ slug: "aiq-deploy", displayName: "AIQ Deploy" })], {
        "publishers:1": { _id: "publishers:1", kind: "org", handle: "nvidia" },
        "githubSkillSources:1": makeGitHubSource(),
      }),
      { publisherId: "publishers:1", cursor: null },
    )) as { entries: unknown[]; isDone: boolean };

    expect(result).toMatchObject({
      entries: [
        {
          type: "skill",
          id: "@nvidia/aiq-deploy",
          title: "AIQ Deploy",
          version: "1111111111111111111111111111111111111111",
          state: "available",
          featured: false,
          publisher: { id: "nvidia", trust: "official" },
          install: {
            candidates: [
              {
                sourceRef: "public-github",
                package: "@nvidia/aiq-deploy",
                version: "1111111111111111111111111111111111111111",
                integrity: "sha256:hash-aiq-deploy",
                github: {
                  repo: "NVIDIA/skills",
                  path: "skills/aiq-deploy",
                  commit: "1111111111111111111111111111111111111111",
                  contentHash: "hash-aiq-deploy",
                },
              },
            ],
          },
        },
      ],
      isDone: true,
    });
  });

  it("publishes every eligible skill through complete shards beyond the legacy atomic limit", async () => {
    const skillEntries = Array.from({ length: 1001 }, (_, index) => makeFeedSkillEntry(index));
    const runMutation = vi.fn(async (_ref: unknown, args: Record<string, unknown>) => {
      if ("description" in args && "entries" in args) {
        return {
          feedId: args.feedId,
          sequence: 1,
          entryCount: (args.entries as unknown[]).length,
        };
      }
      if ("description" in args) {
        return {
          publicationId: `${String(args.feedId)}:shards`,
          sequence: 1,
          publishedAt: 1,
        };
      }
      if (
        typeof args.publicationId === "string" &&
        !("expectedShardCount" in args) &&
        !("payload" in args)
      ) {
        return {
          sequence: 1,
          publishedAt: 1,
          entryCount: args.publicationId.startsWith(CATALOG_SKILLS_FEED_ID) ? 1001 : 0,
        };
      }
      return {};
    });
    const runQuery = vi.fn(async (_ref: unknown, args: Record<string, unknown>) => {
      if ("family" in args) return { entries: [], isDone: true, continueCursor: "" };
      if ("publisherId" in args) {
        return { entries: skillEntries, isDone: true, continueCursor: "" };
      }
      return {
        publishers: [{ _id: "publishers:1" }],
        isDone: true,
        continueCursor: "",
      };
    });

    const result = await publishHandler(
      { runQuery, runMutation },
      { expiresAt: "2026-06-30T00:00:00.000Z" },
    );

    expect(runMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ feedId: CATALOG_FEED_ID, entries: [] }),
    );
    expect(
      vi
        .mocked(runMutation)
        .mock.calls.find(
          ([, args]) =>
            args.feedId === CATALOG_SKILLS_FEED_ID && "description" in args && !("entries" in args),
        )?.[1],
    ).toMatchObject({ entryCount: 1001 });
    expect(
      vi
        .mocked(runMutation)
        .mock.calls.some(
          ([, args]) =>
            args.feedId === CATALOG_SKILLS_FEED_ID && "description" in args && "entries" in args,
        ),
    ).toBe(false);
    expect(
      vi
        .mocked(runMutation)
        .mock.calls.filter(([, args]) => "startOrdinal" in args)
        .map(([, args]) => [args.startOrdinal, (args.entries as unknown[]).length]),
    ).toEqual([
      [0, 250],
      [250, 250],
      [500, 250],
      [750, 250],
      [1000, 1],
    ]);
    const skillShardPayloads = vi
      .mocked(runMutation)
      .mock.calls.filter(
        ([, args]) =>
          args.publicationId === `${CATALOG_SKILLS_FEED_ID}:shards` && "payload" in args,
      )
      .map(([, args]) => JSON.parse(args.payload as string) as { entries: unknown[] });
    expect(skillShardPayloads).toHaveLength(5);
    expect(skillShardPayloads.flatMap((shard) => shard.entries)).toHaveLength(1001);
    expect(result).toEqual([
      { feedId: CATALOG_FEED_ID, sequence: 1, entryCount: 0 },
      {
        publicationId: `${CATALOG_SKILLS_FEED_ID}:shards`,
        feedId: CATALOG_SKILLS_FEED_ID,
        sequence: 1,
        publishedAt: 1,
        entryCount: 1001,
      },
    ]);
  });

  it("publishes plugins through shards beyond the legacy atomic limit", async () => {
    const pluginEntries = Array.from({ length: 1001 }, (_, index) => makeFeedPluginEntry(index));
    const runMutation = vi.fn(async (_ref: unknown, args: Record<string, unknown>) => {
      if ("description" in args && "entries" in args) {
        return {
          feedId: args.feedId,
          sequence: 1,
          entryCount: (args.entries as unknown[]).length,
        };
      }
      if ("description" in args) {
        return {
          publicationId: `${String(args.feedId)}:shards`,
          sequence: 1,
          publishedAt: 1,
        };
      }
      if (
        typeof args.publicationId === "string" &&
        !("expectedShardCount" in args) &&
        !("payload" in args)
      ) {
        return {
          sequence: 1,
          publishedAt: 1,
          entryCount: args.publicationId.startsWith(CATALOG_FEED_ID) ? 1001 : 0,
        };
      }
      return {};
    });
    const runQuery = vi.fn(async (_ref: unknown, args: Record<string, unknown>) => {
      if (args.family === "code-plugin") {
        return args.cursor === null
          ? { entries: pluginEntries.slice(0, 600), isDone: false, continueCursor: "plugins-2" }
          : { entries: pluginEntries.slice(600), isDone: true, continueCursor: "" };
      }
      if ("family" in args) return { entries: [], isDone: true, continueCursor: "" };
      return { publishers: [], isDone: true, continueCursor: "" };
    });

    const result = await publishHandler(
      { runQuery, runMutation },
      { expiresAt: "2026-06-30T00:00:00.000Z" },
    );

    expect(
      vi
        .mocked(runMutation)
        .mock.calls.some(
          ([, args]) =>
            args.feedId === CATALOG_FEED_ID && "description" in args && "entries" in args,
        ),
    ).toBe(false);
    expect(
      vi
        .mocked(runMutation)
        .mock.calls.filter(([, args]) => "startOrdinal" in args)
        .map(([, args]) => [args.startOrdinal, (args.entries as unknown[]).length]),
    ).toEqual([
      [0, 250],
      [250, 250],
      [500, 250],
      [750, 250],
      [1000, 1],
    ]);
    const pluginShardPayloads = vi
      .mocked(runMutation)
      .mock.calls.filter(
        ([, args]) => args.publicationId === `${CATALOG_FEED_ID}:shards` && "payload" in args,
      )
      .map(([, args]) => JSON.parse(args.payload as string) as { entries: unknown[] });
    expect(pluginShardPayloads.flatMap((shard) => shard.entries)).toHaveLength(1001);
    expect(runQuery).toHaveBeenCalledWith(expect.anything(), {
      family: "code-plugin",
      cursor: "plugins-2",
    });
    expect(result[0]).toMatchObject({
      feedId: CATALOG_FEED_ID,
      sequence: 1,
      entryCount: 1001,
    });
  });

  it("projects suspicious current GitHub-backed skills into public GitHub install candidates", async () => {
    const result = (await listOfficialSkillEntriesHandler(
      makeCtx(
        [
          makeGitHubSkill({
            slug: "aiq-suspicious",
            displayName: "AIQ Suspicious",
            githubScanStatus: "suspicious",
          }),
        ],
        {
          "publishers:1": { _id: "publishers:1", kind: "org", handle: "nvidia" },
          "githubSkillSources:1": makeGitHubSource(),
        },
      ),
      { publisherId: "publishers:1", cursor: null },
    )) as { entries: unknown[]; isDone: boolean };

    expect(result.entries).toMatchObject([
      {
        id: "@nvidia/aiq-suspicious",
        state: "available",
        install: {
          candidates: [
            {
              sourceRef: "public-github",
              github: {
                repo: "NVIDIA/skills",
                path: "skills/aiq-deploy",
                commit: "1111111111111111111111111111111111111111",
                contentHash: "hash-aiq-deploy",
              },
            },
          ],
        },
      },
    ]);
  });

  it("includes skills from verified personal publishers", async () => {
    const result = (await listOfficialSkillEntriesHandler(
      makeCtx([makeSkill({ ownerPublisherId: "publishers:steipete" })], {
        "publishers:steipete": { _id: "publishers:steipete", kind: "user", handle: "steipete" },
        "skillVersions:1": makeSkillVersion(),
      }),
      { publisherId: "publishers:steipete", cursor: null },
    )) as { entries: unknown[]; isDone: boolean };

    expect(result.entries).toMatchObject([
      {
        type: "skill",
        id: "@steipete/demo",
        publisher: { id: "steipete", trust: "official" },
      },
    ]);
  });

  it("excludes a latest version blocked by the download safety gate", async () => {
    const result = (await listOfficialSkillEntriesHandler(
      makeCtx([makeSkill()], {
        "publishers:1": { _id: "publishers:1", kind: "org", handle: "openclaw" },
        "skillVersions:1": makeSkillVersion({
          llmAnalysis: { status: "complete", verdict: "malicious" },
        }),
      }),
      { publisherId: "publishers:1", cursor: null },
    )) as { entries: unknown[]; isDone: boolean };

    expect(result.entries).toEqual([]);
  });

  it("excludes unavailable GitHub-backed skills from public GitHub candidates", async () => {
    const blockedStates = [
      makeGitHubSkill({ slug: "pending-scan", githubScanStatus: "pending" }),
      makeGitHubSkill({ slug: "failed-scan", githubScanStatus: "failed" }),
      makeGitHubSkill({ slug: "malicious-scan", githubScanStatus: "malicious" }),
      makeGitHubSkill({ slug: "missing-upstream", githubCurrentStatus: "missing" }),
      makeGitHubSkill({ slug: "removed-upstream", githubRemovedAt: 1 }),
      makeGitHubSkill({ slug: "hidden", moderationStatus: "hidden" }),
      makeGitHubSkill({ slug: "missing-source", githubSourceId: undefined }),
      makeGitHubSkill({ slug: "missing-path", githubPath: undefined }),
      makeGitHubSkill({ slug: "missing-commit", githubCurrentCommit: undefined }),
      makeGitHubSkill({ slug: "missing-hash", githubCurrentContentHash: undefined }),
    ];

    const result = (await listOfficialSkillEntriesHandler(
      makeCtx(blockedStates, {
        "publishers:1": { _id: "publishers:1", kind: "org", handle: "nvidia" },
        "githubSkillSources:1": makeGitHubSource(),
      }),
      { publisherId: "publishers:1", cursor: null },
    )) as { entries: unknown[] };

    expect(result.entries).toEqual([]);
  });

  it("excludes GitHub-backed skills from non-official publishers", async () => {
    vi.mocked((await import("./lib/officialPublishers")).isOfficialPublisher).mockResolvedValue(
      false,
    );

    const result = (await listOfficialSkillEntriesHandler(
      makeCtx([makeGitHubSkill({ slug: "community-source" })], {
        "publishers:community": {
          _id: "publishers:community",
          kind: "org",
          handle: "community",
        },
        "githubSkillSources:1": makeGitHubSource({ ownerPublisherId: "publishers:community" }),
      }),
      { publisherId: "publishers:community", cursor: null },
    )) as { entries: unknown[] };

    expect(result.entries).toEqual([]);
  });

  it("excludes unverified, unpublished, and un-hashed skills", async () => {
    vi.mocked((await import("./lib/officialPublishers")).isOfficialPublisher).mockImplementation(
      async (_ctx, publisher) => publisher?._id === "publishers:1",
    );

    const unverified = (await listOfficialSkillEntriesHandler(
      makeCtx([makeSkill({ ownerPublisherId: "publishers:unverified" })], {
        "publishers:unverified": { _id: "publishers:unverified", kind: "org", handle: "vendor" },
        "skillVersions:1": makeSkillVersion(),
      }),
      { publisherId: "publishers:unverified", cursor: null },
    )) as { entries: unknown[] };
    const unpublishedOrUnhashed = (await listOfficialSkillEntriesHandler(
      makeCtx(
        [
          makeSkill({ latestVersionId: undefined }),
          makeSkill({ _id: "skills:no-hash", latestVersionId: "skillVersions:no-hash" }),
        ],
        {
          "publishers:1": { _id: "publishers:1", kind: "org", handle: "openclaw" },
          "skillVersions:no-hash": makeSkillVersion({ sha256hash: undefined }),
        },
      ),
      { publisherId: "publishers:1", cursor: null },
    )) as { entries: unknown[] };

    expect(unverified.entries).toEqual([]);
    expect(unpublishedOrUnhashed.entries).toEqual([]);
  });
});
