/* @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import { tokenize } from "./lib/searchText";
import { __test, hydrateResults, lexicalFallbackSkills, searchSkills } from "./search";

const { generateEmbeddingMock } = vi.hoisted(() => ({
  generateEmbeddingMock: vi.fn(),
}));

vi.mock("./lib/embeddings", () => ({
  generateEmbedding: generateEmbeddingMock,
}));

vi.mock("./lib/badges", () => ({
  isSkillHighlighted: (skill: { badges?: Record<string, unknown> }) =>
    Boolean(skill.badges?.highlighted),
}));

type WrappedHandler = {
  _handler: (
    ctx: unknown,
    args: unknown,
  ) => Promise<Array<{ skill: { slug: string; _id: string } }>>;
};

const searchSkillsHandler = (searchSkills as unknown as WrappedHandler)._handler;
const lexicalFallbackSkillsHandler = (lexicalFallbackSkills as unknown as WrappedHandler)._handler;
const hydrateResultsHandler = (
  hydrateResults as unknown as {
    _handler: (
      ctx: unknown,
      args: unknown,
    ) => Promise<Array<{ skill: { slug: string; _id: string }; ownerHandle: string | null }>>;
  }
)._handler;

describe("search helpers", () => {
  it("returns fallback results when vector candidates are empty", async () => {
    generateEmbeddingMock.mockResolvedValueOnce([0, 1, 2]);
    const fallback = [
      {
        skill: makePublicSkill({ id: "skills:orf", slug: "orf", displayName: "ORF" }),
        version: null,
        ownerHandle: "steipete",
        owner: null,
      },
    ];
    // With incremental hydration, empty vector results skip the hydrate call entirely.
    const runQuery = vi.fn().mockResolvedValueOnce(fallback); // lexicalFallbackSkills (only call)

    const result = await searchSkillsHandler(
      {
        vectorSearch: vi.fn().mockResolvedValue([]),
        runQuery,
      },
      { query: "orf", limit: 10 },
    );

    expect(result).toHaveLength(1);
    expect(result[0].skill.slug).toBe("orf");
    expect(runQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ query: "orf", queryTokens: ["orf"] }),
    );
  });

  it("applies highlightedOnly filtering in lexical fallback", async () => {
    const highlighted = {
      ...makeSkillDoc({
        id: "skills:hl",
        slug: "orf-highlighted",
        displayName: "ORF Highlighted",
      }),
      badges: { highlighted: { byUserId: "users:mod", at: 1 } },
    };
    const plain = makeSkillDoc({ id: "skills:plain", slug: "orf-plain", displayName: "ORF Plain" });

    const result = await lexicalFallbackSkillsHandler(
      makeLexicalCtx({
        exactSlugSkill: null,
        recentSkills: [highlighted, plain],
      }),
      { query: "orf", queryTokens: ["orf"], highlightedOnly: true, limit: 10 },
    );

    expect(result).toHaveLength(1);
    expect(result[0].skill.slug).toBe("orf-highlighted");
  });

  it("applies nonSuspiciousOnly filtering in lexical fallback", async () => {
    const suspicious = makeSkillDoc({
      id: "skills:suspicious",
      slug: "orf-suspicious",
      displayName: "ORF Suspicious",
      moderationFlags: ["flagged.suspicious"],
    });
    const clean = makeSkillDoc({ id: "skills:clean", slug: "orf-clean", displayName: "ORF Clean" });

    const result = await lexicalFallbackSkillsHandler(
      makeLexicalCtx({
        exactSlugSkill: null,
        recentSkills: [suspicious, clean],
      }),
      { query: "orf", queryTokens: ["orf"], nonSuspiciousOnly: true, limit: 10 },
    );

    expect(result).toHaveLength(1);
    expect(result[0].skill.slug).toBe("orf-clean");
  });

  it("includes exact slug match from by_slug even when recent scan is empty", async () => {
    const exactSlugSkill = makeSkillDoc({ id: "skills:orf", slug: "orf", displayName: "ORF" });
    const ctx = makeLexicalCtx({
      exactSlugSkill,
      recentSkills: [],
    });

    const result = await lexicalFallbackSkillsHandler(ctx, {
      query: "orf",
      queryTokens: ["orf"],
      limit: 10,
    });

    expect(result).toHaveLength(1);
    expect(result[0].skill.slug).toBe("orf");
    expect(ctx.db.query).toHaveBeenCalledWith("skills");
    expect(ctx.db.query).toHaveBeenCalledWith("skillSearchDigest");
  });

  it("dedupes overlap and enforces rank + limit across vector and fallback", async () => {
    generateEmbeddingMock.mockResolvedValueOnce([0, 1, 2]);
    const vectorEntries = [
      {
        embeddingId: "skillEmbeddings:a",
        skill: makePublicSkill({
          id: "skills:a",
          slug: "foo-a",
          displayName: "Foo Alpha",
          downloads: 10,
        }),
        version: null,
        ownerHandle: "one",
        owner: null,
      },
      {
        embeddingId: "skillEmbeddings:b",
        skill: makePublicSkill({
          id: "skills:b",
          slug: "foo-b",
          displayName: "Foo Beta",
          downloads: 2,
        }),
        version: null,
        ownerHandle: "two",
        owner: null,
      },
    ];
    const fallbackEntries = [
      {
        skill: makePublicSkill({
          id: "skills:a",
          slug: "foo-a",
          displayName: "Foo Alpha",
          downloads: 10,
        }),
        version: null,
        ownerHandle: "one",
        owner: null,
      },
      {
        skill: makePublicSkill({
          id: "skills:c",
          slug: "foo-c",
          displayName: "Foo Classic",
          downloads: 1,
        }),
        version: null,
        ownerHandle: "three",
        owner: null,
      },
    ];

    const runQuery = vi
      .fn()
      .mockResolvedValueOnce(vectorEntries) // hydrateResults
      .mockResolvedValueOnce(fallbackEntries); // lexicalFallbackSkills

    const result = await searchSkillsHandler(
      {
        vectorSearch: vi.fn().mockResolvedValue([
          { _id: "skillEmbeddings:a", _score: 0.4 },
          { _id: "skillEmbeddings:b", _score: 0.9 },
        ]),
        runQuery,
      },
      { query: "foo", limit: 2 },
    );

    expect(result).toHaveLength(2);
    expect(result[0].skill.slug).toBe("foo-b");
    expect(new Set(result.map((entry: { skill: { _id: string } }) => entry.skill._id)).size).toBe(
      2,
    );
  });

  it("filters suspicious vector results in hydrateResults when requested", async () => {
    const result = await hydrateResultsHandler(
      {
        db: {
          get: vi.fn(async (id: string) => {
            if (id === "skillEmbeddings:1") {
              return {
                _id: "skillEmbeddings:1",
                skillId: "skills:1",
                versionId: "skillVersions:1",
              };
            }
            if (id === "skills:1") {
              return makeSkillDoc({
                id: "skills:1",
                slug: "suspicious",
                displayName: "Suspicious",
                moderationFlags: ["flagged.suspicious"],
              });
            }
            if (id === "users:owner") return { _id: "users:owner", handle: "owner" };
            if (id === "skillVersions:1") return { _id: "skillVersions:1", version: "1.0.0" };
            return null;
          }),
          query: vi.fn(() => ({
            withIndex: () => ({ unique: vi.fn().mockResolvedValue(null) }),
          })),
        },
      },
      { embeddingIds: ["skillEmbeddings:1"], nonSuspiciousOnly: true },
    );

    expect(result).toHaveLength(0);
  });

  it("excludes soft-deleted skills from vector search results (#29)", async () => {
    const result = await hydrateResultsHandler(
      {
        db: {
          get: vi.fn(async (id: string) => {
            if (id === "skillEmbeddings:1") {
              return {
                _id: "skillEmbeddings:1",
                skillId: "skills:1",
                versionId: "skillVersions:1",
              };
            }
            if (id === "skillEmbeddings:2") {
              return {
                _id: "skillEmbeddings:2",
                skillId: "skills:2",
                versionId: "skillVersions:2",
              };
            }
            if (id === "skills:1") {
              return {
                ...makeSkillDoc({ id: "skills:1", slug: "active-skill", displayName: "Active" }),
                softDeletedAt: undefined,
              };
            }
            if (id === "skills:2") {
              return {
                ...makeSkillDoc({ id: "skills:2", slug: "deleted-skill", displayName: "Deleted" }),
                softDeletedAt: 1700000000000,
              };
            }
            if (id === "users:owner") return { _id: "users:owner", handle: "owner" };
            if (id.startsWith("skillVersions:")) return { _id: id, version: "1.0.0" };
            return null;
          }),
          query: vi.fn(() => ({
            withIndex: () => ({ unique: vi.fn().mockResolvedValue(null) }),
          })),
        },
      },
      { embeddingIds: ["skillEmbeddings:1", "skillEmbeddings:2"] },
    );

    expect(result).toHaveLength(1);
    expect(result[0].skill.slug).toBe("active-skill");
  });

  it("excludes skills whose owners are deleted or banned from vector search results", async () => {
    const result = await hydrateResultsHandler(
      {
        db: {
          get: vi.fn(async (id: string) => {
            if (id === "skillEmbeddings:1") {
              return {
                _id: "skillEmbeddings:1",
                skillId: "skills:1",
                versionId: "skillVersions:1",
              };
            }
            if (id === "skills:1") {
              return {
                ...makeSkillDoc({
                  id: "skills:1",
                  slug: "ownerless-skill",
                  displayName: "Ownerless",
                }),
                softDeletedAt: undefined,
              };
            }
            if (id === "users:owner") {
              return { _id: "users:owner", handle: "owner", deletedAt: 1700000000000 };
            }
            if (id === "skillVersions:1") return { _id: "skillVersions:1", version: "1.0.0" };
            return null;
          }),
          query: vi.fn(() => ({
            withIndex: () => ({ unique: vi.fn().mockResolvedValue(null) }),
          })),
        },
      },
      { embeddingIds: ["skillEmbeddings:1"] },
    );

    expect(result).toHaveLength(0);
  });

  it("excludes soft-deleted exact slug match from lexical fallback (#29)", async () => {
    const deletedSkill = makeSkillDoc({
      id: "skills:deleted",
      slug: "orf",
      displayName: "ORF",
      softDeletedAt: 1700000000000,
    });
    const ctx = makeLexicalCtx({
      exactSlugSkill: deletedSkill,
      recentSkills: [],
    });

    const result = await lexicalFallbackSkillsHandler(ctx, {
      query: "orf",
      queryTokens: ["orf"],
      limit: 10,
    });

    expect(result).toHaveLength(0);
  });

  it("advances candidate limit until max", () => {
    expect(__test.getNextCandidateLimit(50, 1000)).toBe(100);
    expect(__test.getNextCandidateLimit(800, 1000)).toBe(1000);
    expect(__test.getNextCandidateLimit(1000, 1000)).toBeNull();
  });

  it("boosts exact slug/name matches over loose matches", () => {
    const queryTokens = tokenize("notion");
    const exactScore = __test.scoreSkillResult(queryTokens, 0.4, "Notion Sync", "notion-sync", 5);
    const looseScore = __test.scoreSkillResult(queryTokens, 0.6, "Notes Sync", "notes-sync", 500);
    expect(exactScore).toBeGreaterThan(looseScore);
  });

  it("adds a popularity prior for equally relevant matches", () => {
    const queryTokens = tokenize("notion");
    const lowDownloads = __test.scoreSkillResult(
      queryTokens,
      0.5,
      "Notion Helper",
      "notion-helper",
      0,
    );
    const highDownloads = __test.scoreSkillResult(
      queryTokens,
      0.5,
      "Notion Helper",
      "notion-helper",
      1000,
    );
    expect(highDownloads).toBeGreaterThan(lowDownloads);
  });

  it("uses digest doc instead of full skill doc in hydrateResults but revalidates the owner", async () => {
    // Derive digest from makeSkillDoc so it stays in sync with schema changes.
    const skillDoc = makeSkillDoc({
      id: "skills:1",
      slug: "digest-skill",
      displayName: "Digest Skill",
    });
    const digestDoc = {
      _id: "skillSearchDigest:d1",
      _creationTime: 1,
      skillId: skillDoc._id,
      slug: skillDoc.slug,
      displayName: skillDoc.displayName,
      summary: skillDoc.summary,
      ownerUserId: skillDoc.ownerUserId,
      ownerHandle: "owner",
      ownerName: "Owner",
      ownerDisplayName: "Owner",
      ownerImage: undefined,
      canonicalSkillId: skillDoc.canonicalSkillId,
      forkOf: skillDoc.forkOf,
      latestVersionId: skillDoc.latestVersionId,
      tags: skillDoc.tags,
      badges: skillDoc.badges,
      stats: skillDoc.stats,
      statsDownloads: skillDoc.stats.downloads,
      statsStars: skillDoc.stats.stars,
      statsInstallsCurrent: skillDoc.stats.installsCurrent,
      statsInstallsAllTime: skillDoc.stats.installsAllTime,
      softDeletedAt: skillDoc.softDeletedAt,
      moderationStatus: skillDoc.moderationStatus,
      moderationFlags: skillDoc.moderationFlags,
      moderationReason: skillDoc.moderationReason,
      isSuspicious: false,
      createdAt: skillDoc.createdAt,
      updatedAt: skillDoc.updatedAt,
    };

    const getMock = vi.fn(async (id: string) => {
      // Should NOT be called for skills:1 when digest exists
      if (id === "skills:1") throw new Error("Should not read full skill doc");
      if (id === "users:owner") {
        return {
          _id: "users:owner",
          _creationTime: 1,
          handle: "owner",
          name: "Owner",
          displayName: "Owner",
          image: undefined,
          bio: undefined,
          deletedAt: undefined,
          deactivatedAt: undefined,
        };
      }
      return null;
    });
    const result = await hydrateResultsHandler(
      {
        db: {
          get: getMock,
          query: vi.fn((table: string) => ({
            withIndex: (index: string) => ({
              unique: vi.fn(async () => {
                if (table === "embeddingSkillMap" && index === "by_embedding") {
                  return { embeddingId: "skillEmbeddings:1", skillId: "skills:1" };
                }
                if (table === "skillSearchDigest" && index === "by_skill") {
                  return digestDoc;
                }
                return null;
              }),
            }),
          })),
        },
      },
      { embeddingIds: ["skillEmbeddings:1"] },
    );

    expect(result).toHaveLength(1);
    expect(result[0].skill.slug).toBe("digest-skill");
    expect(result[0].skill._id).toBe("skills:1");
    expect(result[0].ownerHandle).toBe("owner");
    // Owner resolved from digest — users table should NOT be read
    expect(getMock).not.toHaveBeenCalledWith("users:owner");
  });

  it("falls back to full skill doc when digest is missing", async () => {
    const result = await hydrateResultsHandler(
      {
        db: {
          get: vi.fn(async (id: string) => {
            if (id === "users:owner") return { _id: "users:owner", handle: "owner" };
            if (id === "skills:1") {
              return makeSkillDoc({
                id: "skills:1",
                slug: "fallback-skill",
                displayName: "Fallback Skill",
              });
            }
            return null;
          }),
          query: vi.fn((table: string) => ({
            withIndex: (index: string) => ({
              unique: vi.fn(async () => {
                if (table === "embeddingSkillMap" && index === "by_embedding") {
                  return { embeddingId: "skillEmbeddings:1", skillId: "skills:1" };
                }
                // No digest exists — return null
                return null;
              }),
            }),
          })),
        },
      },
      { embeddingIds: ["skillEmbeddings:1"] },
    );

    expect(result).toHaveLength(1);
    expect(result[0].skill.slug).toBe("fallback-skill");
  });

  it("only hydrates new embedding IDs on subsequent iterations (incremental)", async () => {
    generateEmbeddingMock.mockResolvedValueOnce([0, 1, 2]);

    // limit=10 → candidateLimit starts at 50, maxCandidate=200.
    // First iteration must return exactly candidateLimit (50) to trigger expansion.
    const firstBatch = Array.from({ length: 50 }, (_, i) => ({
      _id: `skillEmbeddings:e${i}`,
      _score: 0.5 - i * 0.001,
    }));
    // Second iteration returns 60 results (50 old + 10 new).
    // 60 < next candidateLimit (100), so the loop breaks.
    const secondBatch = [
      ...firstBatch,
      ...Array.from({ length: 10 }, (_, i) => ({
        _id: `skillEmbeddings:n${i}`,
        _score: 0.3 - i * 0.001,
      })),
    ];

    const vectorSearchMock = vi
      .fn()
      .mockResolvedValueOnce(firstBatch)
      .mockResolvedValueOnce(secondBatch);

    const hydrateCalls: string[][] = [];
    const runQuery = vi.fn(
      async (_ref: unknown, args: { embeddingIds?: string[]; query?: string }) => {
        if (args.embeddingIds) {
          hydrateCalls.push(args.embeddingIds);
          return args.embeddingIds.map((embeddingId: string) => ({
            embeddingId,
            skill: makePublicSkill({
              id: `skills:${embeddingId.split(":")[1]}`,
              slug: `skill-${embeddingId.split(":")[1]}`,
              displayName: `Skill ${embeddingId.split(":")[1]}`,
            }),
            version: null,
            ownerHandle: "owner",
            owner: null,
          }));
        }
        return []; // lexicalFallbackSkills
      },
    );

    await searchSkillsHandler(
      { vectorSearch: vectorSearchMock, runQuery },
      { query: "test", limit: 10 },
    );

    // Should have been called twice, but second call should only have new IDs
    expect(hydrateCalls).toHaveLength(2);
    expect(hydrateCalls[0]).toHaveLength(50);
    expect(hydrateCalls[1]).toHaveLength(10);
    // Verify no overlap between the two hydrate calls
    const firstSet = new Set(hydrateCalls[0]);
    const overlap = hydrateCalls[1].filter((id) => firstSet.has(id));
    expect(overlap).toHaveLength(0);
  });

  it("merges fallback matches without duplicate skill ids", () => {
    const primary = [
      {
        embeddingId: "skillEmbeddings:1",
        skill: { _id: "skills:1" },
      },
    ] as unknown as Parameters<typeof __test.mergeUniqueBySkillId>[0];
    const fallback = [
      {
        skill: { _id: "skills:1" },
      },
      {
        skill: { _id: "skills:2" },
      },
    ] as unknown as Parameters<typeof __test.mergeUniqueBySkillId>[1];

    const merged = __test.mergeUniqueBySkillId(primary, fallback);
    expect(merged).toHaveLength(2);
    expect(merged.map((entry) => entry.skill._id)).toEqual(["skills:1", "skills:2"]);
  });
});

function makePublicSkill(params: {
  id: string;
  slug: string;
  displayName: string;
  downloads?: number;
}) {
  return {
    _id: params.id,
    _creationTime: 1,
    slug: params.slug,
    displayName: params.displayName,
    summary: `${params.displayName} summary`,
    ownerUserId: "users:owner",
    canonicalSkillId: undefined,
    forkOf: undefined,
    latestVersionId: "skillVersions:1",
    tags: {},
    badges: {},
    stats: {
      downloads: params.downloads ?? 0,
      installsCurrent: 0,
      installsAllTime: 0,
      stars: 0,
      versions: 1,
      comments: 0,
    },
    createdAt: 1,
    updatedAt: 1,
  };
}

function makeSkillDoc(params: {
  id: string;
  slug: string;
  displayName: string;
  moderationFlags?: string[];
  moderationReason?: string;
  softDeletedAt?: number;
}) {
  return {
    ...makePublicSkill(params),
    _creationTime: 1,
    moderationStatus: "active",
    moderationFlags: params.moderationFlags ?? [],
    moderationReason: params.moderationReason,
    softDeletedAt: params.softDeletedAt as number | undefined,
  };
}

function makeLexicalCtx(params: {
  exactSlugSkill: ReturnType<typeof makeSkillDoc> | null;
  recentSkills: Array<ReturnType<typeof makeSkillDoc>>;
}) {
  // Convert skill docs to digest-shaped rows (add skillId + owner fields).
  const digestRows = params.recentSkills.map((skill) => ({
    ...skill,
    skillId: skill._id,
    ownerHandle: "owner",
    ownerName: "Owner",
    ownerDisplayName: "Owner",
    ownerImage: undefined,
  }));
  return {
    db: {
      query: vi.fn((table: string) => {
        if (table === "skills") {
          return {
            withIndex: (index: string) => {
              if (index === "by_slug") {
                return {
                  unique: vi.fn().mockResolvedValue(params.exactSlugSkill),
                };
              }
              throw new Error(`Unexpected skills index ${index}`);
            },
          };
        }
        if (table === "skillSearchDigest") {
          return {
            withIndex: (index: string) => {
              if (index === "by_active_updated") {
                return {
                  order: () => ({
                    take: vi.fn().mockResolvedValue(digestRows),
                  }),
                };
              }
              throw new Error(`Unexpected digest index ${index}`);
            },
          };
        }
        throw new Error(`Unexpected table ${table}`);
      }),
      get: vi.fn(async (id: string) => {
        if (id.startsWith("users:")) return { _id: id, handle: "owner" };
        if (id.startsWith("skillVersions:")) return { _id: id, version: "1.0.0" };
        return null;
      }),
    },
  };
}
