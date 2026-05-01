/* @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import { tokenize } from "./lib/searchText";
import {
  __test,
  directPrefixSkillMatches,
  hydrateResults,
  lexicalFallbackSouls,
  lexicalFallbackSkills,
  searchSkills,
  searchSouls,
} from "./search";

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

type WrappedHandler<Result = { skill: { slug: string; _id: string } }> = {
  _handler: (ctx: unknown, args: unknown) => Promise<Array<Result>>;
};

const searchSkillsHandler = (
  searchSkills as unknown as WrappedHandler<{
    skill: { slug: string; _id: string };
    score: number;
  }>
)._handler;
const searchSoulsHandler = (
  searchSouls as unknown as WrappedHandler<{
    soul: { slug: string; _id: string };
    score: number;
  }>
)._handler;
const lexicalFallbackSkillsHandler = (lexicalFallbackSkills as unknown as WrappedHandler)._handler;
const directPrefixSkillMatchesHandler = (directPrefixSkillMatches as unknown as WrappedHandler)
  ._handler;
const lexicalFallbackSoulsHandler = (
  lexicalFallbackSouls as unknown as WrappedHandler<{ soul: { slug: string; _id: string } }>
)._handler;
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
    // Slug-like queries now do an indexed exact-slug lookup before lexical fallback.
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce(null) // getExactSkillSlugMatch
      .mockResolvedValueOnce([]) // directPrefixSkillMatches
      .mockResolvedValueOnce(fallback); // lexicalFallbackSkills

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

  it("falls back to lexical skill search when embedding generation fails", async () => {
    generateEmbeddingMock.mockRejectedValueOnce(new Error("API unavailable"));
    const fallback = [
      {
        skill: makePublicSkill({ id: "skills:orf", slug: "orf", displayName: "ORF" }),
        version: null,
        ownerHandle: "steipete",
        owner: null,
      },
    ];
    const vectorSearch = vi.fn().mockRejectedValue(new Error("should not be called"));
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce(null) // getExactSkillSlugMatch
      .mockResolvedValueOnce([]) // directPrefixSkillMatches
      .mockResolvedValueOnce(fallback); // lexicalFallbackSkills

    const result = await searchSkillsHandler(
      {
        vectorSearch,
        runQuery,
      },
      { query: "orf", limit: 10 },
    );

    expect(vectorSearch).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0].skill.slug).toBe("orf");
    expect(runQuery).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ query: "orf", queryTokens: ["orf"] }),
    );
  });

  it("uses normalized prefix matches so lowercase name queries do not depend on vector recall", async () => {
    const scienceClawSkills = [
      "ScienceClaw: Query (Dry Run)",
      "ScienceClaw: Multi-Agent Investigation",
      "ScienceClaw: Agent Status",
      "ScienceClaw: Local File Investigation",
      "ScienceClaw: Post to Infinite",
      "ScienceClaw: Watch (Live Collaboration)",
    ].map((displayName, index) =>
      makeSkillDoc({
        id: `skills:scienceclaw-${index}`,
        slug: displayName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, ""),
        displayName,
      }),
    );
    const ctx = makeDirectPrefixCtx(scienceClawSkills);

    const result = await directPrefixSkillMatchesHandler(ctx, {
      query: "scienceclaw",
      limit: 10,
    });

    expect(result.map((entry) => entry.skill.slug)).toEqual(
      scienceClawSkills.map((skill) => skill.slug),
    );
    expect(ctx.usedIndexes).toEqual(
      expect.arrayContaining([
        "by_active_normalized_slug",
        "by_active_normalized_display_name",
        "by_active_normalized_slug_first_token",
        "by_active_normalized_display_name_first_token",
      ]),
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

    const ctx = makeLexicalCtx({
      exactSlugSkill: null,
      recentSkills: [suspicious, clean],
    });

    const result = await lexicalFallbackSkillsHandler(ctx, {
      query: "orf",
      queryTokens: ["orf"],
      nonSuspiciousOnly: true,
      limit: 10,
    });

    expect(result).toHaveLength(1);
    expect(result[0].skill.slug).toBe("orf-clean");
    expect(ctx.usedIndexes).toEqual(
      expect.arrayContaining(["by_nonsuspicious_updated", "by_nonsuspicious_created"]),
    );
  });

  it("preserves suspicious lexical fallback results when nonSuspiciousOnly is unset", async () => {
    const clean = makeSkillDoc({ id: "skills:clean", slug: "orf-clean", displayName: "ORF Clean" });
    const suspicious = makeSkillDoc({
      id: "skills:suspicious",
      slug: "orf-suspicious",
      displayName: "ORF Suspicious",
      moderationFlags: ["flagged.suspicious"],
    });
    const ctx = makeLexicalCtx({
      exactSlugSkill: null,
      recentSkills: [clean, suspicious],
    });

    const result = await lexicalFallbackSkillsHandler(ctx, {
      query: "orf",
      queryTokens: ["orf"],
      limit: 10,
    });

    expect(result.map((entry) => entry.skill.slug)).toEqual(["orf-clean", "orf-suspicious"]);
    expect(ctx.usedIndexes).toEqual(
      expect.arrayContaining(["by_active_updated", "by_active_created"]),
    );
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
      .mockResolvedValueOnce(null) // getExactSkillSlugMatch
      .mockResolvedValueOnce([]) // directPrefixSkillMatches
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

  it("uses a stable recall pool before slicing first-page search results (#1756)", async () => {
    generateEmbeddingMock.mockResolvedValueOnce([0, 1, 2]);

    const vectorEntries = Array.from({ length: 25 }, (_, index) => ({
      embeddingId: `skillEmbeddings:${index}`,
      skill: makePublicSkill({
        id: `skills:${index}`,
        slug: `image-vector-${index}`,
        displayName: `Image Vector ${index}`,
        downloads: 10,
      }),
      version: null,
      ownerHandle: "owner",
      owner: null,
    }));
    const fallbackEntries = [
      {
        skill: makePublicSkill({
          id: "skills:fallback",
          slug: "antigravity-image-generator",
          displayName: "Antigravity Image Generator",
          downloads: 1_000_000_000,
        }),
        version: null,
        ownerHandle: "owner",
        owner: null,
      },
    ];

    const runQuery = vi
      .fn()
      .mockResolvedValueOnce(null) // getExactSkillSlugMatch
      .mockResolvedValueOnce([]) // directPrefixSkillMatches
      .mockResolvedValueOnce(vectorEntries) // hydrateResults
      .mockResolvedValueOnce(fallbackEntries); // lexicalFallbackSkills

    const result = await searchSkillsHandler(
      {
        vectorSearch: vi.fn().mockResolvedValue(
          vectorEntries.map((entry, index) => ({
            _id: entry.embeddingId,
            _score: 0.5 - index * 0.001,
          })),
        ),
        runQuery,
      },
      { query: "image", limit: 25 },
    );

    expect(runQuery).toHaveBeenCalledTimes(4);
    expect(runQuery).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ query: "image", limit: 400 }),
    );
    expect(result).toHaveLength(25);
    expect(result.some((entry) => entry.skill.slug === "antigravity-image-generator")).toBe(true);
  });

  it("always includes an exact slug match even when vector exact matches already fill the limit", async () => {
    generateEmbeddingMock.mockResolvedValueOnce([0, 1, 2]);

    const vectorEntries = Array.from({ length: 10 }, (_, index) => ({
      embeddingId: `skillEmbeddings:${index}`,
      skill: makePublicSkill({
        id: `skills:${index}`,
        slug: `downloader-${index}`,
        displayName: `Skill Downloader ${index}`,
        downloads: 100 - index,
      }),
      version: null,
      ownerHandle: "owner",
      owner: null,
    }));

    const exactSlugEntry = {
      skill: makePublicSkill({
        id: "skills:exact",
        slug: "skill-downloader",
        displayName: "Skill Downloader",
        downloads: 1,
      }),
      version: null,
      ownerHandle: "yyang100",
      owner: null,
    };

    const runQuery = vi
      .fn()
      .mockResolvedValueOnce(exactSlugEntry)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(vectorEntries)
      .mockResolvedValueOnce([]);

    const result = await searchSkillsHandler(
      {
        vectorSearch: vi.fn().mockResolvedValue(
          vectorEntries.map((entry, index) => ({
            _id: entry.embeddingId,
            _score: 0.9 - index * 0.01,
          })),
        ),
        runQuery,
      },
      { query: "skill-downloader", limit: 10 },
    );

    expect(result).toHaveLength(10);
    expect(result[0].skill.slug).toBe("skill-downloader");
    expect(runQuery).toHaveBeenCalledTimes(4);
  });

  it("omits exact slug injection when nonSuspiciousOnly excludes it", async () => {
    generateEmbeddingMock.mockResolvedValueOnce([0, 1, 2]);

    const vectorEntries = [
      {
        embeddingId: "skillEmbeddings:1",
        skill: makePublicSkill({
          id: "skills:1",
          slug: "downloader-1",
          displayName: "Skill Downloader 1",
          downloads: 50,
        }),
        version: null,
        ownerHandle: "owner",
        owner: null,
      },
    ];

    const runQuery = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(vectorEntries)
      .mockResolvedValueOnce([]);

    const result = await searchSkillsHandler(
      {
        vectorSearch: vi.fn().mockResolvedValue([{ _id: "skillEmbeddings:1", _score: 0.9 }]),
        runQuery,
      },
      { query: "skill-downloader", limit: 10, nonSuspiciousOnly: true },
    );

    expect(result).toHaveLength(1);
    expect(result[0].skill.slug).toBe("downloader-1");
  });

  it("omits exact slug injection when highlightedOnly excludes it", async () => {
    generateEmbeddingMock.mockResolvedValueOnce([0, 1, 2]);

    const exactSlugEntry = {
      skill: makePublicSkill({
        id: "skills:exact",
        slug: "skill-downloader",
        displayName: "Skill Downloader",
        downloads: 1,
      }),
      version: null,
      ownerHandle: "yyang100",
      owner: null,
    };

    const vectorEntries = [
      {
        embeddingId: "skillEmbeddings:1",
        skill: {
          ...makePublicSkill({
            id: "skills:1",
            slug: "downloader-1",
            displayName: "Skill Downloader 1",
            downloads: 50,
          }),
          badges: { highlighted: { byUserId: "users:mod", at: 1 } },
        },
        version: null,
        ownerHandle: "owner",
        owner: null,
      },
    ];

    const runQuery = vi
      .fn()
      .mockResolvedValueOnce(exactSlugEntry)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(vectorEntries)
      .mockResolvedValueOnce([]);

    const result = await searchSkillsHandler(
      {
        vectorSearch: vi.fn().mockResolvedValue([{ _id: "skillEmbeddings:1", _score: 0.9 }]),
        runQuery,
      },
      { query: "skill-downloader", limit: 10, highlightedOnly: true },
    );

    expect(result).toHaveLength(1);
    expect(result[0].skill.slug).toBe("downloader-1");
  });

  it("filters vector search results by capability tag", async () => {
    generateEmbeddingMock.mockResolvedValueOnce([0, 1, 2]);

    const runQuery = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          embeddingId: "skillEmbeddings:crypto",
          skill: makePublicSkill({
            id: "skills:crypto",
            slug: "wallet-helper",
            displayName: "Wallet Helper",
            capabilityTags: ["crypto", "requires-wallet"],
          }),
          version: null,
          ownerHandle: "owner",
          owner: null,
        },
        {
          embeddingId: "skillEmbeddings:oauth",
          skill: makePublicSkill({
            id: "skills:oauth",
            slug: "x-poster",
            displayName: "X Poster",
            capabilityTags: ["requires-oauth-token", "posts-externally"],
          }),
          version: null,
          ownerHandle: "owner",
          owner: null,
        },
      ])
      .mockResolvedValueOnce([]);

    const result = await searchSkillsHandler(
      {
        vectorSearch: vi.fn().mockResolvedValue([
          { _id: "skillEmbeddings:crypto", _score: 0.9 },
          { _id: "skillEmbeddings:oauth", _score: 0.8 },
        ]),
        runQuery,
      },
      { query: "helper", limit: 10, capabilityTag: "crypto" },
    );

    expect(result).toHaveLength(1);
    expect(result[0].skill.slug).toBe("wallet-helper");
  });

  it("deduplicates exact slug injection against vector exact matches", async () => {
    generateEmbeddingMock.mockResolvedValueOnce([0, 1, 2]);

    const sharedSkill = makePublicSkill({
      id: "skills:exact",
      slug: "skill-downloader",
      displayName: "Skill Downloader",
      downloads: 100,
    });
    const exactSlugEntry = {
      skill: sharedSkill,
      version: null,
      ownerHandle: "yyang100",
      owner: null,
    };
    const vectorEntries = [
      {
        embeddingId: "skillEmbeddings:exact",
        skill: sharedSkill,
        version: null,
        ownerHandle: "yyang100",
        owner: null,
      },
      {
        embeddingId: "skillEmbeddings:other",
        skill: makePublicSkill({
          id: "skills:other",
          slug: "downloader-2",
          displayName: "Skill Downloader 2",
          downloads: 50,
        }),
        version: null,
        ownerHandle: "owner",
        owner: null,
      },
    ];

    const runQuery = vi
      .fn()
      .mockResolvedValueOnce(exactSlugEntry)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(vectorEntries)
      .mockResolvedValueOnce([]);

    const result = await searchSkillsHandler(
      {
        vectorSearch: vi.fn().mockResolvedValue([
          { _id: "skillEmbeddings:exact", _score: 0.95 },
          { _id: "skillEmbeddings:other", _score: 0.8 },
        ]),
        runQuery,
      },
      { query: "skill-downloader", limit: 10 },
    );

    expect(result).toHaveLength(2);
    expect(result.filter((entry) => entry.skill._id === "skills:exact")).toHaveLength(1);
  });

  it("skips duplicate slug lookup inside lexical fallback when search action already did it", async () => {
    generateEmbeddingMock.mockResolvedValueOnce([0, 1, 2]);

    const fallbackEntries = [
      {
        skill: makePublicSkill({
          id: "skills:orf",
          slug: "orf",
          displayName: "ORF",
        }),
        version: null,
        ownerHandle: "steipete",
        owner: null,
      },
    ];

    const runQuery = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce([])
      .mockImplementationOnce(async (_ref: unknown, args: { skipExactSlugLookup?: boolean }) => {
        expect(args.skipExactSlugLookup).toBe(true);
        return fallbackEntries;
      });

    const result = await searchSkillsHandler(
      {
        vectorSearch: vi.fn().mockResolvedValue([]),
        runQuery,
      },
      { query: "orf", limit: 10 },
    );

    expect(result).toHaveLength(1);
    expect(result[0].skill.slug).toBe("orf");
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

  it("finds recently created skills missed by the updatedAt fallback scan (#1185)", async () => {
    const newSkill = makeSkillDoc({
      id: "skills:new",
      slug: "ai-clipping",
      displayName: "AI Clipping",
    });
    const ctx = makeLexicalCtx({
      exactSlugSkill: null,
      recentSkills: [],
      recentByCreated: [newSkill],
    });

    const result = await lexicalFallbackSkillsHandler(ctx, {
      query: "clipping",
      queryTokens: ["clipping"],
      limit: 10,
    });

    expect(result).toHaveLength(1);
    expect(result[0].skill.slug).toBe("ai-clipping");
  });

  it("deduplicates skills found by both fallback scan windows", async () => {
    const skill = makeSkillDoc({
      id: "skills:dup",
      slug: "orf-dup",
      displayName: "ORF Dup",
    });
    const ctx = makeLexicalCtx({
      exactSlugSkill: null,
      recentSkills: [skill],
      recentByCreated: [skill],
    });

    const result = await lexicalFallbackSkillsHandler(ctx, {
      query: "orf",
      queryTokens: ["orf"],
      limit: 10,
    });

    expect(result).toHaveLength(1);
    expect(result[0].skill.slug).toBe("orf-dup");
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

  it("boosts exact full slug over a longer slug containing all query tokens", () => {
    const queryTokens = tokenize("self-improving-agent");
    const exactScore = __test.scoreSkillResult(
      queryTokens,
      0.5,
      "Self Improving Agent",
      "self-improving-agent",
      10,
    );
    const containingScore = __test.scoreSkillResult(
      queryTokens,
      0.6,
      "Self Improving Agent",
      "xiucheng-self-improving-agent",
      100,
    );
    expect(exactScore).toBeGreaterThan(containingScore);
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

  it("hydrates the stable max vector window for ordinary load-more searches", async () => {
    generateEmbeddingMock.mockResolvedValueOnce([0, 1, 2]);

    // Ordinary first-page and load-more searches use a stable recall floor, so
    // candidateLimit starts at the Convex vector maximum.
    const batch = Array.from({ length: 256 }, (_, i) => ({
      _id: `skillEmbeddings:e${i}`,
      _score: 0.5 - i * 0.001,
    }));

    const vectorSearchMock = vi.fn().mockResolvedValueOnce(batch);

    const hydrateCalls: string[][] = [];
    const runQuery = vi.fn(
      async (_ref: unknown, args: { embeddingIds?: string[]; query?: string; slug?: string }) => {
        if (args.slug) {
          return null; // getExactSkillSlugMatch
        }
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
      { query: "test", limit: 50 },
    );

    expect(vectorSearchMock).toHaveBeenCalledTimes(1);
    expect(hydrateCalls).toHaveLength(1);
    expect(hydrateCalls[0]).toHaveLength(256);
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

  it("preserves vector scores for hydrated candidates", async () => {
    generateEmbeddingMock.mockResolvedValueOnce([0, 1, 2]);

    const skillA = makePublicSkill({
      id: "skills:a",
      slug: "baidu-yijian-vision",
      displayName: "Baidu Yijian Vision",
      downloads: 100,
    });
    const skillB = makePublicSkill({
      id: "skills:b",
      slug: "baidu-yijian-test",
      displayName: "Baidu Yijian Test",
      downloads: 50,
    });

    const vectorResults = [
      { _id: "skillEmbeddings:a", _score: 0.95 },
      { _id: "skillEmbeddings:b", _score: 0.5 },
    ];

    const runQuery = vi
      .fn()
      .mockResolvedValueOnce([]) // directPrefixSkillMatches
      .mockResolvedValueOnce([
        {
          embeddingId: "skillEmbeddings:a",
          skill: skillA,
          version: null,
          ownerHandle: "owner",
          owner: null,
        },
        {
          embeddingId: "skillEmbeddings:b",
          skill: skillB,
          version: null,
          ownerHandle: "owner",
          owner: null,
        },
      ])
      // lexicalFallbackSkills (exactMatches < limit after loop exits)
      .mockResolvedValueOnce([]);

    const result = await searchSkillsHandler(
      {
        vectorSearch: vi.fn().mockResolvedValueOnce(vectorResults),
        runQuery,
      },
      { query: "baidu yijian", limit: 50 },
    );

    const resultA = result.find(
      (r: { skill: { slug: string } }) => r.skill.slug === "baidu-yijian-vision",
    );
    expect(resultA).toBeDefined();
    expect(resultA!.score).toBeGreaterThan(1.0);
  });
});

describe("soul search", () => {
  it("falls back to lexical soul search when embedding generation fails", async () => {
    generateEmbeddingMock.mockRejectedValueOnce(new Error("API unavailable"));
    const fallback = [
      {
        soul: makePublicSoul({ id: "souls:orf", slug: "orf", displayName: "ORF" }),
        version: null,
      },
    ];
    const vectorSearch = vi.fn().mockRejectedValue(new Error("should not be called"));
    const runQuery = vi.fn().mockResolvedValueOnce(fallback);

    const result = await searchSoulsHandler(
      {
        vectorSearch,
        runQuery,
      },
      { query: "orf", limit: 10 },
    );

    expect(vectorSearch).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0].soul.slug).toBe("orf");
    expect(runQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ query: "orf", queryTokens: ["orf"] }),
    );
  });

  it("uses the active souls index for lexical fallback", async () => {
    const activeSoul = makeSoulDoc({
      id: "souls:active",
      slug: "orf-active",
      displayName: "ORF Active",
    });
    const ctx = makeSoulLexicalCtx({
      exactSlugSoul: null,
      recentSouls: [activeSoul],
    });

    const result = await lexicalFallbackSoulsHandler(ctx, {
      query: "orf",
      queryTokens: ["orf"],
      limit: 10,
    });

    expect(result).toHaveLength(1);
    expect(result[0].soul.slug).toBe("orf-active");
    expect(ctx.usedIndexes).toContain("by_active_updated");
  });

  it("hydrates only new soul embedding ids across vector iterations", async () => {
    generateEmbeddingMock.mockResolvedValueOnce([0, 1, 2]);
    const firstBatch = Array.from({ length: 200 }, (_, i) => ({
      _id: i === 0 ? "soulEmbeddings:a" : `soulEmbeddings:filler${i}`,
      _score: i === 0 ? 0.9 : 0.1,
    }));
    const secondBatch = [...firstBatch, { _id: "soulEmbeddings:b", _score: 0.4 }];
    const hydrateCalls: string[][] = [];
    const runQuery = vi.fn(
      async (_ref: unknown, args: { embeddingIds?: string[]; query?: string }) => {
        if (args.embeddingIds) {
          hydrateCalls.push(args.embeddingIds);
          return args.embeddingIds
            .filter((id) => id === "soulEmbeddings:a" || id === "soulEmbeddings:b")
            .map((embeddingId) => ({
              embeddingId,
              soul: makePublicSoul({
                id: `souls:${embeddingId.split(":").at(-1)}`,
                slug: `soul-${embeddingId.split(":").at(-1)}`,
                displayName: `Soul ${embeddingId.split(":").at(-1)}`,
              }),
              version: null,
            }));
        }
        return [];
      },
    );

    await searchSoulsHandler(
      {
        vectorSearch: vi.fn().mockResolvedValueOnce(firstBatch).mockResolvedValueOnce(secondBatch),
        runQuery,
      },
      { query: "soul", limit: 50 },
    );

    expect(hydrateCalls).toHaveLength(2);
    expect(hydrateCalls[1]).toEqual(["soulEmbeddings:b"]);
  });
});

function makePublicSkill(params: {
  id: string;
  slug: string;
  displayName: string;
  downloads?: number;
  capabilityTags?: string[];
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
    capabilityTags: params.capabilityTags,
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

function makePublicSoul(params: {
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
    ownerPublisherId: undefined,
    latestVersionId: "soulVersions:1",
    tags: {},
    stats: {
      downloads: params.downloads ?? 0,
      stars: 0,
      versions: 1,
      comments: 0,
    },
    createdAt: 1,
    updatedAt: 1,
  };
}

function makeSoulDoc(params: {
  id: string;
  slug: string;
  displayName: string;
  softDeletedAt?: number;
}) {
  return {
    ...makePublicSoul(params),
    softDeletedAt: params.softDeletedAt as number | undefined,
  };
}

function makeLexicalCtx(params: {
  exactSlugSkill: ReturnType<typeof makeSkillDoc> | null;
  recentSkills: Array<ReturnType<typeof makeSkillDoc>>;
  recentByCreated?: Array<ReturnType<typeof makeSkillDoc>>;
}) {
  // Convert skill docs to digest-shaped rows (add skillId + owner fields).
  const toDigestRows = (skills: Array<ReturnType<typeof makeSkillDoc>>) =>
    skills.map((skill) => ({
      ...skill,
      skillId: skill._id,
      ownerHandle: "owner",
      ownerName: "Owner",
      ownerDisplayName: "Owner",
      ownerImage: undefined,
    }));
  const digestByUpdated = toDigestRows(params.recentSkills);
  const digestByCreated = toDigestRows(params.recentByCreated ?? []);
  const usedIndexes: string[] = [];
  return {
    usedIndexes,
    db: {
      query: vi.fn((table: string) => {
        if (table === "skills") {
          return {
            withIndex: (index: string) => {
              usedIndexes.push(index);
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
              usedIndexes.push(index);
              if (index === "by_active_updated" || index === "by_nonsuspicious_updated") {
                return {
                  order: () => ({
                    take: vi.fn().mockResolvedValue(digestByUpdated),
                  }),
                };
              }
              if (index === "by_active_created" || index === "by_nonsuspicious_created") {
                return {
                  order: () => ({
                    take: vi.fn().mockResolvedValue(digestByCreated),
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

function makeDirectPrefixCtx(skills: Array<ReturnType<typeof makeSkillDoc>>) {
  const firstToken = (value: string) => value.toLowerCase().match(/[a-z0-9]+/)?.[0];
  const digestRows = skills.map((skill) => ({
    ...skill,
    skillId: skill._id,
    normalizedSlug: skill.slug.toLowerCase(),
    normalizedSlugFirstToken: firstToken(skill.slug),
    normalizedDisplayName: skill.displayName.toLowerCase(),
    normalizedDisplayNameFirstToken: firstToken(skill.displayName),
    ownerHandle: "owner",
    ownerName: "Owner",
    ownerDisplayName: "Owner",
    ownerImage: undefined,
  }));
  const usedIndexes: string[] = [];
  return {
    usedIndexes,
    db: {
      query: vi.fn((table: string) => {
        if (table !== "skillSearchDigest") throw new Error(`Unexpected table ${table}`);
        return {
          withIndex: (index: string, builder: (q: unknown) => unknown) => {
            usedIndexes.push(index);
            const range: Record<string, string> = {};
            const q = {
              eq: () => q,
              gte: (field: string, value: string) => {
                range[field] = value;
                return q;
              },
              lt: () => q,
            };
            builder(q);
            return {
              take: vi.fn(async () => {
                const field = index.includes("first_token")
                  ? index.includes("slug")
                    ? "normalizedSlugFirstToken"
                    : "normalizedDisplayNameFirstToken"
                  : index.includes("slug")
                    ? "normalizedSlug"
                    : "normalizedDisplayName";
                const prefix = range[field] ?? "";
                return digestRows.filter((digest) => (digest[field] ?? "").startsWith(prefix));
              }),
            };
          },
        };
      }),
      get: vi.fn(async (id: string) => {
        if (id.startsWith("users:")) return { _id: id, handle: "owner" };
        if (id.startsWith("skillVersions:")) return { _id: id, version: "1.0.0" };
        return null;
      }),
    },
  };
}

function makeSoulLexicalCtx(params: {
  exactSlugSoul: ReturnType<typeof makeSoulDoc> | null;
  recentSouls: Array<ReturnType<typeof makeSoulDoc>>;
}) {
  const usedIndexes: string[] = [];
  return {
    usedIndexes,
    db: {
      query: vi.fn((table: string) => {
        if (table !== "souls") throw new Error(`Unexpected table ${table}`);
        return {
          withIndex: (index: string) => {
            usedIndexes.push(index);
            if (index === "by_slug") {
              return {
                unique: vi.fn().mockResolvedValue(params.exactSlugSoul),
              };
            }
            if (index === "by_active_updated") {
              return {
                order: () => ({
                  take: vi.fn().mockResolvedValue(params.recentSouls),
                }),
              };
            }
            throw new Error(`Unexpected souls index ${index}`);
          },
        };
      }),
    },
  };
}
