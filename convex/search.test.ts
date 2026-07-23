/* @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import { tokenize } from "./lib/searchText";
import {
  __test,
  directPrefixSkillMatches,
  getExactSkillSlugMatch,
  hydrateResults,
  lexicalFallbackSkills,
  listPrefixSkillSlugMatches,
  searchSkills,
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
const lexicalFallbackSkillsHandler = (lexicalFallbackSkills as unknown as WrappedHandler)._handler;
const directPrefixSkillMatchesHandler = (directPrefixSkillMatches as unknown as WrappedHandler)
  ._handler;
const listPrefixSkillSlugMatchesHandler = (listPrefixSkillSlugMatches as unknown as WrappedHandler)
  ._handler;
const getExactSkillSlugMatchHandler = (
  getExactSkillSlugMatch as unknown as {
    _handler: (
      ctx: unknown,
      args: unknown,
    ) => Promise<
      Array<{
        skill: { slug: string; _id: string };
        ownerHandle: string | null;
        owner: { official?: boolean } | null;
      }>
    >;
  }
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
      expect.objectContaining({ query: "orf", queryTokens: ["orf"], limit: 200 }),
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

  it("applies normalized author topics before slicing search results", async () => {
    generateEmbeddingMock.mockRejectedValueOnce(new Error("API unavailable"));
    const directMatches = [
      {
        skill: makePublicSkill({
          id: "skills:calendar",
          slug: "calendar-workflow",
          displayName: "Calendar Workflow",
          topics: ["google-calendar"],
        }),
        version: null,
        ownerHandle: "steipete",
        owner: null,
      },
      {
        skill: makePublicSkill({
          id: "skills:legacy",
          slug: "calendar-workflow-legacy",
          displayName: "Calendar Workflow Legacy",
          topics: ["legacy"],
        }),
        version: null,
        ownerHandle: "steipete",
        owner: null,
      },
    ];
    const runQuery = vi.fn().mockResolvedValueOnce(directMatches).mockResolvedValueOnce([]);

    const result = await searchSkillsHandler(
      {
        vectorSearch: vi.fn(),
        runQuery,
      },
      { query: "calendar workflow", topic: "Google Calendar", limit: 10 },
    );

    expect(result.map((entry) => entry.skill.slug)).toEqual(["calendar-workflow"]);
    expect(runQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ topic: "google-calendar" }),
    );
  });

  it("passes normalized selected categories through every skill recall path", async () => {
    generateEmbeddingMock.mockResolvedValueOnce([0, 1, 2]);
    const development = {
      embeddingId: "skillEmbeddings:development",
      skill: makePublicSkill({
        id: "skills:development",
        slug: "development-helper",
        displayName: "Development Helper",
        categories: ["development"],
      }),
      version: null,
      ownerHandle: "owner",
      owner: null,
    };
    const automation = {
      embeddingId: "skillEmbeddings:automation",
      skill: makePublicSkill({
        id: "skills:automation",
        slug: "automation-helper",
        displayName: "Automation Helper",
        categories: ["automation"],
      }),
      version: null,
      ownerHandle: "owner",
      owner: null,
    };
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce(null) // getExactSkillSlugMatch
      .mockResolvedValueOnce([development, automation]) // directPrefixSkillMatches
      .mockResolvedValueOnce([development, automation]) // hydrateResults
      .mockResolvedValueOnce([development, automation]); // lexicalFallbackSkills

    const result = await searchSkillsHandler(
      {
        vectorSearch: vi.fn().mockResolvedValue([
          { _id: "skillEmbeddings:development", _score: 0.8 },
          { _id: "skillEmbeddings:automation", _score: 0.9 },
        ]),
        runQuery,
      },
      { query: "helper", categorySlug: "Development", limit: 10 },
    );

    expect(result.map((entry) => entry.skill.slug)).toEqual(["development-helper"]);
    for (const [, args] of runQuery.mock.calls) {
      expect(args).toEqual(expect.objectContaining({ categorySlug: "development" }));
    }
  });

  it("uses stored categories as skill search evidence", async () => {
    generateEmbeddingMock.mockRejectedValueOnce(new Error("API unavailable"));
    const fallback = [
      {
        skill: makePublicSkill({
          id: "skills:category-match",
          slug: "focused-helper",
          displayName: "Focused Helper",
          summary: "Keeps projects tidy.",
          categories: ["development"],
        }),
        version: null,
        ownerHandle: "steipete",
        owner: null,
      },
    ];
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce(null) // getExactSkillSlugMatch
      .mockResolvedValueOnce([]) // directPrefixSkillMatches
      .mockResolvedValueOnce(fallback); // lexicalFallbackSkills

    const result = await searchSkillsHandler(
      {
        vectorSearch: vi.fn(),
        runQuery,
      },
      { query: "dev", limit: 10 },
    );

    expect(result.map((entry) => entry.skill.slug)).toEqual(["focused-helper"]);
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

  it("lists skill slug prefixes through the indexed list-style search path", async () => {
    const skills = [
      makeSkillDoc({
        id: "skills:aigroup-alpha",
        slug: "aigroup-alpha",
        displayName: "Aigroup Alpha",
      }),
      makeSkillDoc({
        id: "skills:aigroup-beta",
        slug: "aigroup-beta",
        displayName: "Aigroup Beta",
      }),
      makeSkillDoc({
        id: "skills:other",
        slug: "other",
        displayName: "Other",
      }),
    ];
    const ctx = makeDirectPrefixCtx(skills);

    const result = await listPrefixSkillSlugMatchesHandler(ctx, {
      prefix: "aigroup-",
      limit: 10,
    });

    expect(result.map((entry) => entry.skill.slug)).toEqual(["aigroup-alpha", "aigroup-beta"]);
    expect(ctx.usedIndexes).toContain("by_active_normalized_slug");
    expect(ctx.usedSearchIndexes).toEqual([]);
  });

  it("exact mode bypasses vector and fallback recall", async () => {
    const exactEntry = {
      skill: makePublicSkill({
        id: "skills:exact",
        slug: "exact-skill",
        displayName: "Exact Skill",
      }),
      version: null,
      ownerHandle: "owner",
      owner: null,
    };
    const runQuery = vi.fn().mockResolvedValueOnce([exactEntry]);
    const vectorSearch = vi.fn();

    const result = await searchSkillsHandler(
      {
        vectorSearch,
        runQuery,
      },
      { query: "exact-skill", mode: "exact", limit: 10 },
    );

    expect(result.map((entry) => entry.skill.slug)).toEqual(["exact-skill"]);
    expect(vectorSearch).not.toHaveBeenCalled();
    expect(runQuery).toHaveBeenCalledOnce();
    expect(runQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ slug: "exact-skill" }),
    );
  });

  it("prefix mode bypasses vector and semantic fallback recall", async () => {
    const prefixEntry = {
      skill: makePublicSkill({
        id: "skills:a",
        slug: "aigroup-alpha",
        displayName: "Aigroup Alpha",
      }),
      version: null,
      ownerHandle: "owner",
      owner: null,
    };
    const runQuery = vi.fn().mockResolvedValueOnce([prefixEntry]);
    const vectorSearch = vi.fn();

    const result = await searchSkillsHandler(
      {
        vectorSearch,
        runQuery,
      },
      { query: "aigroup-", mode: "prefix", limit: 10 },
    );

    expect(result.map((entry) => entry.skill.slug)).toEqual(["aigroup-alpha"]);
    expect(vectorSearch).not.toHaveBeenCalled();
    expect(runQuery).toHaveBeenCalledOnce();
    expect(runQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ prefix: "aigroup-", limit: 10 }),
    );
  });

  it("recalls non-first-token slug matches via the full-text search index (Bug 1)", async () => {
    // Repro of the original bug: searching "yijian" against a skill whose
    // slug is "baidu-yijian-vision" returned zero results because all four
    // prefix indexes only match the *first* token. The new search index
    // should match any token at any position.
    const skill = makeSkillDoc({
      id: "skills:baidu-yijian-vision",
      slug: "baidu-yijian-vision",
      displayName: "Baidu Yijian Vision",
    });
    const ctx = makeDirectPrefixCtx([skill]);

    const result = await directPrefixSkillMatchesHandler(ctx, {
      query: "yijian",
      limit: 10,
    });

    expect(result.map((entry) => entry.skill.slug)).toEqual(["baidu-yijian-vision"]);
    expect(ctx.usedSearchIndexes).toEqual(
      expect.arrayContaining(["search_by_display_name", "search_by_slug"]),
    );
  });

  it("recalls non-first-token displayName matches via the full-text search index", async () => {
    // Companion case to the slug repro above: a query that only matches
    // the displayName (not the slug) at a non-first position must still
    // surface the skill.
    const skill = makeSkillDoc({
      id: "skills:baidu-yijian-vision",
      slug: "baidu-yijian-vision",
      displayName: "Baidu Yijian Vision",
    });
    const ctx = makeDirectPrefixCtx([skill]);

    const result = await directPrefixSkillMatchesHandler(ctx, {
      query: "Vision",
      limit: 10,
    });

    expect(result.map((entry) => entry.skill.slug)).toEqual(["baidu-yijian-vision"]);
  });

  it("recalls exact author topics through the indexed topic digest", async () => {
    const skill = makeSkillDoc({
      id: "skills:gpu-helper",
      slug: "accelerated-helper",
      displayName: "Accelerated Helper",
      topics: ["GPU development"],
    });
    const ctx = makeDirectPrefixCtx([skill]);

    const result = await directPrefixSkillMatchesHandler(ctx, {
      query: "gpu development",
      limit: 10,
    });

    expect(result.map((entry) => entry.skill.slug)).toEqual(["accelerated-helper"]);
    expect(ctx.usedIndexes).toEqual(
      expect.arrayContaining(["by_active_topic_updated", "by_skill"]),
    );
  });

  it("recalls author topics by normalized prefix through the indexed topic digest", async () => {
    const skill = makeSkillDoc({
      id: "skills:gpu-helper",
      slug: "accelerated-helper",
      displayName: "Accelerated Helper",
      topics: ["GPU development"],
    });
    const ctx = makeDirectPrefixCtx([skill]);

    const result = await directPrefixSkillMatchesHandler(ctx, {
      query: "gpu",
      limit: 10,
    });

    expect(result.map((entry) => entry.skill.slug)).toEqual(["accelerated-helper"]);
    expect(ctx.usedIndexes).toEqual(
      expect.arrayContaining(["by_active_topic_updated", "by_skill"]),
    );
  });

  it("prioritizes exact author-topic recall ahead of prefix expansion", async () => {
    const prefixSkill = makeSkillDoc({
      id: "skills:react-native-helper",
      slug: "mobile-helper",
      displayName: "Mobile Helper",
      topics: ["React Native"],
    });
    const exactSkill = makeSkillDoc({
      id: "skills:react-helper",
      slug: "web-helper",
      displayName: "Web Helper",
      topics: ["React"],
    });
    const ctx = makeDirectPrefixCtx([prefixSkill, exactSkill]);

    const result = await directPrefixSkillMatchesHandler(ctx, {
      query: "react",
      limit: 10,
    });

    expect(result.map((entry) => entry.skill.slug)).toEqual(["web-helper", "mobile-helper"]);
  });

  it("recalls text matches from the selected topic digest", async () => {
    const skill = makeSkillDoc({
      id: "skills:calendar-helper",
      slug: "temporal-helper",
      displayName: "Temporal Helper",
      summary: "Coordinates calendar events.",
      topics: ["Scheduling"],
    });
    const ctx = makeDirectPrefixCtx([skill]);

    const result = await directPrefixSkillMatchesHandler(ctx, {
      query: "calendar",
      topic: "scheduling",
      limit: 10,
    });

    expect(result.map((entry) => entry.skill.slug)).toEqual(["temporal-helper"]);
    expect(ctx.usedIndexes).toEqual(
      expect.arrayContaining(["by_active_topic_updated", "by_skill"]),
    );
  });

  it("continues topic recall past globally capped rows before category filtering", async () => {
    const distractors = Array.from({ length: 100 }, (_, index) =>
      makeSkillDoc({
        id: `skills:scheduling-${index}`,
        slug: `temporal-${index}`,
        displayName: `Temporal ${index}`,
        summary: "Coordinates events.",
        categories: ["automation"],
        topics: ["scheduling"],
      }),
    );
    const development = makeSkillDoc({
      id: "skills:calendar-helper",
      slug: "temporal-helper",
      displayName: "Temporal Helper",
      summary: "Coordinates calendar events.",
      categories: ["development"],
      topics: ["scheduling"],
    });
    const ctx = makeDirectPrefixCtx([...distractors, development]);

    const result = await directPrefixSkillMatchesHandler(ctx, {
      query: "calendar",
      categorySlug: "development",
      topic: "scheduling",
      limit: 10,
    });

    expect(result.map((entry) => entry.skill.slug)).toEqual(["temporal-helper"]);
  });

  it("filters direct prefix matches by the selected category", async () => {
    const development = makeSkillDoc({
      id: "skills:development-helper",
      slug: "development-helper",
      displayName: "Development Helper",
      categories: ["development"],
    });
    const automation = makeSkillDoc({
      id: "skills:automation-helper",
      slug: "automation-helper",
      displayName: "Automation Helper",
      categories: ["automation"],
    });
    const ctx = makeDirectPrefixCtx([development, automation]);

    const result = await directPrefixSkillMatchesHandler(ctx, {
      query: "helper",
      categorySlug: "development",
      limit: 10,
    });

    expect(result.map((entry) => entry.skill.slug)).toEqual(["development-helper"]);
  });

  it("continues direct recall past globally capped matches for the selected category", async () => {
    const distractors = Array.from({ length: 150 }, (_, index) =>
      makeSkillDoc({
        id: `skills:automation-${index}`,
        slug: `helper-automation-${index}`,
        displayName: `Helper Automation ${index}`,
        categories: ["automation"],
      }),
    );
    const development = makeSkillDoc({
      id: "skills:development-helper",
      slug: "helper-development",
      displayName: "Helper Development",
      categories: ["development"],
    });
    const ctx = makeDirectPrefixCtx([...distractors, development]);

    const result = await directPrefixSkillMatchesHandler(ctx, {
      query: "helper",
      categorySlug: "development",
      limit: 10,
    });

    expect(result.map((entry) => entry.skill.slug)).toEqual(["helper-development"]);
    expect(ctx.paginateCalls).toBe(0);
    expect(Math.max(...ctx.takeLimits)).toBeLessThanOrEqual(250);
    expect(ctx.takeLimits.reduce((total, limit) => total + limit, 0)).toBeLessThanOrEqual(2_500);
  });

  it("does not let unhighlighted scoped matches consume featured recall", async () => {
    const distractors = Array.from({ length: 150 }, (_, index) =>
      makeSkillDoc({
        id: `skills:development-${index}`,
        slug: `helper-development-${index}`,
        displayName: `Helper Development ${index}`,
        categories: ["development"],
      }),
    );
    const highlighted = {
      ...makeSkillDoc({
        id: "skills:highlighted-development",
        slug: "helper-highlighted-development",
        displayName: "Helper Highlighted Development",
        categories: ["development"],
      }),
      badges: { highlighted: { byUserId: "users:mod", at: 1 } },
    };
    const ctx = makeDirectPrefixCtx([...distractors, highlighted]);

    const result = await directPrefixSkillMatchesHandler(ctx, {
      query: "helper",
      categorySlug: "development",
      highlightedOnly: true,
      limit: 10,
    });

    expect(result.map((entry) => entry.skill.slug)).toEqual(["helper-highlighted-development"]);
  });

  it("does not return suspicious skills via full-text search when nonSuspiciousOnly is set", async () => {
    // Even though the full-text search would token-match the suspicious
    // skill, the filterField `isSuspicious=false` plus the post-hydration
    // `isSkillSuspicious` guard must keep it out of the results.
    const clean = makeSkillDoc({
      id: "skills:clean",
      slug: "baidu-yijian-vision",
      displayName: "Baidu Yijian Vision",
    });
    const flagged = makeSkillDoc({
      id: "skills:flagged",
      slug: "shady-yijian-trick",
      displayName: "Shady Yijian Trick",
      moderationFlags: ["flagged.suspicious"],
    });
    const ctx = makeDirectPrefixCtx([clean, flagged]);

    const result = await directPrefixSkillMatchesHandler(ctx, {
      query: "yijian",
      nonSuspiciousOnly: true,
      limit: 10,
    });

    expect(result.map((entry) => entry.skill.slug)).toEqual(["baidu-yijian-vision"]);
  });

  it("does not return soft-deleted skills via full-text search", async () => {
    const active = makeSkillDoc({
      id: "skills:active",
      slug: "baidu-yijian-vision",
      displayName: "Baidu Yijian Vision",
    });
    const softDeleted = makeSkillDoc({
      id: "skills:deleted",
      slug: "deleted-yijian-tool",
      displayName: "Deleted Yijian Tool",
      softDeletedAt: 123,
    });
    const ctx = makeDirectPrefixCtx([active, softDeleted]);

    const result = await directPrefixSkillMatchesHandler(ctx, {
      query: "yijian",
      limit: 10,
    });

    expect(result.map((entry) => entry.skill.slug)).toEqual(["baidu-yijian-vision"]);
  });

  it("dedupes skills matched by both legacy prefix indexes and the new full-text index", async () => {
    // First-token queries hit *all six* recall paths (4 prefix + 2 full-text).
    // The skillId-based filter inside `directPrefixSkillMatches` must prevent
    // the same skill from being emitted multiple times in the final list.
    const skill = makeSkillDoc({
      id: "skills:baidu-yijian-vision",
      slug: "baidu-yijian-vision",
      displayName: "Baidu Yijian Vision",
    });
    const ctx = makeDirectPrefixCtx([skill]);

    const result = await directPrefixSkillMatchesHandler(ctx, {
      query: "baidu",
      limit: 10,
    });

    expect(result).toHaveLength(1);
    expect(result[0].skill.slug).toBe("baidu-yijian-vision");
    // Sanity: both legacy prefix indexes and the new full-text indexes were
    // queried, so the dedup is doing real work, not just a no-op pass-through.
    expect(ctx.usedIndexes.length).toBeGreaterThanOrEqual(4);
    expect(ctx.usedSearchIndexes.length).toBeGreaterThanOrEqual(2);
  });

  it("rejects multi-token full-text candidates when only some tokens match (AND semantics)", async () => {
    // Convex `withSearchIndex(...).search(field, q)` is OR-disjunctive over
    // tokens: a query like "yijian vision" can return rows that contain
    // *either* token. Without an application-layer AND gate, a `vision`-only
    // distractor would surface as a "direct prefix match" alongside the
    // genuine all-tokens hit. The handler must filter the full-text path
    // through `matchesExactTokens` so only skills whose text contains every
    // query token survive.
    const distractor = makeSkillDoc({
      id: "skills:cv-expert",
      slug: "computer-vision-expert",
      displayName: "Computer Vision Expert",
    });
    const target = makeSkillDoc({
      id: "skills:baidu-yijian-vision",
      slug: "baidu-yijian-vision",
      displayName: "Baidu Yijian Vision",
    });
    const ctx = makeDirectPrefixCtx([distractor, target]);

    const result = await directPrefixSkillMatchesHandler(ctx, {
      query: "yijian vision",
      limit: 10,
    });

    expect(result.map((entry) => entry.skill.slug)).toEqual(["baidu-yijian-vision"]);
  });

  it("returns nothing when no single skill contains all query tokens", async () => {
    // Each skill matches exactly one token of the multi-token query. The
    // disjunctive search index would yield both, but the AND gate must drop
    // them — no skill in the corpus contains *both* `yijian` and `vision`.
    const onlyVision = makeSkillDoc({
      id: "skills:cv-expert",
      slug: "computer-vision-expert",
      displayName: "Computer Vision Expert",
    });
    const onlyYijian = makeSkillDoc({
      id: "skills:yijian-misc",
      slug: "yijian-misc-tool",
      displayName: "Yijian Misc Tool",
    });
    const ctx = makeDirectPrefixCtx([onlyVision, onlyYijian]);

    const result = await directPrefixSkillMatchesHandler(ctx, {
      query: "yijian vision",
      limit: 10,
    });

    expect(result).toEqual([]);
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

  it("excludes suspicious lexical fallback results from public search", async () => {
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

    expect(result.map((entry) => entry.skill.slug)).toEqual(["orf-clean"]);
    expect(ctx.usedIndexes).toEqual(
      expect.arrayContaining(["by_active_updated", "by_active_created"]),
    );
  });

  it("uses the requested fallback limit as the digest scan budget", async () => {
    const ctx = makeLexicalCtx({
      exactSlugSkill: null,
      recentSkills: [
        makeSkillDoc({ id: "skills:updated", slug: "orf-updated", displayName: "ORF Updated" }),
      ],
      recentByCreated: [
        makeSkillDoc({ id: "skills:created", slug: "orf-created", displayName: "ORF Created" }),
      ],
    });

    await lexicalFallbackSkillsHandler(ctx, {
      query: "orf",
      queryTokens: ["orf"],
      limit: 25,
      skipExactSlugLookup: true,
    });

    expect(ctx.takeLimits).toEqual([25, 25]);
  });

  it("uses the digest public version without reading version history", async () => {
    const pending = makeSkillDoc({
      id: "skills:pending-update",
      slug: "pending-update",
      displayName: "Pending Update",
      moderationReason: "pending.scan",
      moderationSourceVersionId: "skillVersions:pending",
      latestVersionId: "skillVersions:pending",
      statsVersions: 2,
      publicVersion: {
        status: "available",
        versionId: "skillVersions:approved",
      },
    });
    const ctx = makeLexicalCtx({
      exactSlugSkill: null,
      recentSkills: [pending],
    });

    const result = await lexicalFallbackSkillsHandler(ctx, {
      query: "pending",
      queryTokens: ["pending"],
      limit: 10,
    });

    expect(result.map((entry) => entry.skill.slug)).toEqual(["pending-update"]);
    expect(ctx.db.query).not.toHaveBeenCalledWith("skillVersions");
  });

  it("fails closed from the digest without reading version history", async () => {
    const pending = makeSkillDoc({
      id: "skills:unavailable-update",
      slug: "unavailable-update",
      displayName: "Unavailable Update",
      moderationReason: "pending.scan",
      moderationSourceVersionId: "skillVersions:pending",
      latestVersionId: "skillVersions:pending",
      statsVersions: 2,
      publicVersion: { status: "unavailable" },
    });
    const ctx = makeLexicalCtx({
      exactSlugSkill: null,
      recentSkills: [pending],
    });

    const result = await lexicalFallbackSkillsHandler(ctx, {
      query: "unavailable",
      queryTokens: ["unavailable"],
      limit: 10,
    });

    expect(result).toEqual([]);
    expect(ctx.db.query).not.toHaveBeenCalledWith("skillVersions");
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

  it("includes review-only first-publish skills in exact slug search", async () => {
    const exactSlugSkill = makeSkillDoc({
      id: "skills:wechatpay",
      slug: "wechatpay-payment-integration",
      displayName: "WeChat Pay Integration",
      moderationFlags: ["flagged.review"],
      moderationReason: "scanner.llm.review",
    });
    const ctx = makeLexicalCtx({
      exactSlugSkill,
      recentSkills: [],
    });

    const result = await getExactSkillSlugMatchHandler(ctx, {
      slug: "wechatpay-payment-integration",
    });

    expect(result.map((entry) => entry.skill.slug)).toEqual(["wechatpay-payment-integration"]);
  });

  it("still excludes first-publish pending scan skills from exact slug search", async () => {
    const exactSlugSkill = makeSkillDoc({
      id: "skills:pending",
      slug: "pending-payment-integration",
      displayName: "Pending Payment Integration",
      moderationReason: "pending.scan",
    });
    const ctx = makeLexicalCtx({
      exactSlugSkill,
      recentSkills: [],
    });

    const result = await getExactSkillSlugMatchHandler(ctx, {
      slug: "pending-payment-integration",
    });

    expect(result).toEqual([]);
  });

  it("returns duplicate exact slug matches without requiring global slug uniqueness", async () => {
    const ctx = makeLexicalCtx({
      exactSlugSkills: [
        makeSkillDoc({
          id: "skills:alice-demo",
          slug: "demo",
          displayName: "Alice Demo",
          ownerPublisherId: "publishers:alice",
        }),
        makeSkillDoc({
          id: "skills:org-demo",
          slug: "demo",
          displayName: "Org Demo",
          ownerPublisherId: "publishers:org",
        }),
      ],
      recentSkills: [],
    });

    const result = await getExactSkillSlugMatchHandler(ctx, { slug: "demo" });

    expect(result.map((entry) => entry.skill._id)).toEqual([
      "skills:alice-demo",
      "skills:org-demo",
    ]);
    expect(result.map((entry) => entry.ownerHandle)).toEqual(["alice", "org"]);
  });

  it("includes official publisher status on skill search owners", async () => {
    const ctx = makeLexicalCtx({
      exactSlugSkills: [
        makeSkillDoc({
          id: "skills:org-demo",
          slug: "demo",
          displayName: "Org Demo",
          ownerPublisherId: "publishers:org",
        }),
      ],
      officialPublisherIds: ["publishers:org"],
      recentSkills: [],
    });

    const result = await getExactSkillSlugMatchHandler(ctx, { slug: "demo" });

    expect(result[0]?.ownerHandle).toBe("org");
    expect(result[0]?.owner?.official).toBe(true);
  });

  it("filters duplicate exact slug matches by topic", async () => {
    const ctx = makeLexicalCtx({
      exactSlugSkills: [
        makeSkillDoc({
          id: "skills:alice-demo",
          slug: "demo",
          displayName: "Alice Demo",
          ownerPublisherId: "publishers:alice",
          topics: ["scheduling", "Official"],
        }),
        makeSkillDoc({
          id: "skills:org-demo",
          slug: "demo",
          displayName: "Org Demo",
          ownerPublisherId: "publishers:org",
          topics: ["monitoring"],
        }),
      ],
      recentSkills: [],
    });

    const result = await getExactSkillSlugMatchHandler(ctx, {
      slug: "demo",
      topic: "Scheduling",
    });

    expect(result.map((entry) => entry.skill._id)).toEqual(["skills:alice-demo"]);
  });

  it("filters duplicate exact slug matches by category", async () => {
    const ctx = makeLexicalCtx({
      exactSlugSkills: [
        makeSkillDoc({
          id: "skills:development-demo",
          slug: "demo",
          displayName: "Development Demo",
          ownerPublisherId: "publishers:development",
          categories: ["development"],
        }),
        makeSkillDoc({
          id: "skills:automation-demo",
          slug: "demo",
          displayName: "Automation Demo",
          ownerPublisherId: "publishers:automation",
          categories: ["automation"],
        }),
      ],
      recentSkills: [],
    });

    const result = await getExactSkillSlugMatchHandler(ctx, {
      slug: "demo",
      categorySlug: "development",
    });

    expect(result.map((entry) => entry.skill._id)).toEqual(["skills:development-demo"]);
  });

  it("preserves resolved inferred categories on exact slug results", async () => {
    const ctx = makeLexicalCtx({
      exactSlugSkills: [
        makeSkillDoc({
          id: "skills:development-demo",
          slug: "demo",
          displayName: "Development Demo",
          inferredCategories: ["development"],
          inferredFromVersionId: "skillVersions:1",
        }),
      ],
      recentSkills: [],
    });

    const result = await getExactSkillSlugMatchHandler(ctx, {
      slug: "demo",
      categorySlug: "development",
    });

    const [entry] = result;
    if (!entry) throw new Error("Expected an exact slug result");
    expect((entry.skill as { categories?: string[] }).categories).toEqual(["development"]);
  });

  it("includes duplicate exact slug matches from by_slug when recent scan is empty", async () => {
    const ctx = makeLexicalCtx({
      exactSlugSkills: [
        makeSkillDoc({
          id: "skills:alice-demo",
          slug: "demo",
          displayName: "Alice Demo",
          ownerPublisherId: "publishers:alice",
        }),
        makeSkillDoc({
          id: "skills:org-demo",
          slug: "demo",
          displayName: "Org Demo",
          ownerPublisherId: "publishers:org",
        }),
      ],
      recentSkills: [],
    });

    const result = await lexicalFallbackSkillsHandler(ctx, {
      query: "demo",
      queryTokens: ["demo"],
      limit: 10,
    });

    expect(result.map((entry) => entry.skill._id)).toEqual([
      "skills:alice-demo",
      "skills:org-demo",
    ]);
  });

  it("filters duplicate exact slug fallback matches by topic", async () => {
    const ctx = makeLexicalCtx({
      exactSlugSkills: [
        makeSkillDoc({
          id: "skills:alice-demo",
          slug: "demo",
          displayName: "Alice Demo",
          ownerPublisherId: "publishers:alice",
          topics: ["scheduling"],
        }),
        makeSkillDoc({
          id: "skills:org-demo",
          slug: "demo",
          displayName: "Org Demo",
          ownerPublisherId: "publishers:org",
          topics: ["monitoring"],
        }),
      ],
      recentSkills: [],
    });

    const result = await lexicalFallbackSkillsHandler(ctx, {
      query: "demo",
      queryTokens: ["demo"],
      limit: 10,
      topic: "Scheduling",
    });

    expect(result.map((entry) => entry.skill._id)).toEqual(["skills:alice-demo"]);
  });

  it("filters lexical fallback matches by the selected category", async () => {
    const ctx = makeLexicalCtx({
      exactSlugSkill: null,
      recentSkills: [
        makeSkillDoc({
          id: "skills:development",
          slug: "development-helper",
          displayName: "Development Helper",
          categories: ["development"],
        }),
        makeSkillDoc({
          id: "skills:automation",
          slug: "automation-helper",
          displayName: "Automation Helper",
          categories: ["automation"],
        }),
      ],
    });

    const result = await lexicalFallbackSkillsHandler(ctx, {
      query: "helper",
      queryTokens: ["helper"],
      categorySlug: "development",
      limit: 10,
    });

    expect(result.map((entry) => entry.skill.slug)).toEqual(["development-helper"]);
  });

  it("continues fallback recall past global rows for the selected category", async () => {
    const distractors = Array.from({ length: 25 }, (_, index) =>
      makeSkillDoc({
        id: `skills:automation-${index}`,
        slug: `automation-${index}`,
        displayName: `Automation ${index}`,
        summary: "Helper workflow",
        categories: ["automation"],
      }),
    );
    const development = makeSkillDoc({
      id: "skills:development",
      slug: "development-tool",
      displayName: "Development Tool",
      summary: "Helper workflow",
      categories: ["development"],
    });
    const ctx = makeLexicalCtx({
      exactSlugSkill: null,
      recentSkills: [...distractors, development],
    });

    const result = await lexicalFallbackSkillsHandler(ctx, {
      query: "helper",
      queryTokens: ["helper"],
      categorySlug: "development",
      limit: 10,
    });

    expect(result.map((entry) => entry.skill.slug)).toEqual(["development-tool"]);
    expect(ctx.paginateCalls).toBe(0);
  });

  it("does not let unrelated scoped rows consume fallback recall", async () => {
    const distractors = Array.from({ length: 25 }, (_, index) =>
      makeSkillDoc({
        id: `skills:development-${index}`,
        slug: `development-${index}`,
        displayName: `Development ${index}`,
        summary: "Unrelated workflow",
        categories: ["development"],
      }),
    );
    const target = makeSkillDoc({
      id: "skills:development-target",
      slug: "development-target",
      displayName: "Development Target",
      summary: "Helper workflow",
      categories: ["development"],
    });
    const ctx = makeLexicalCtx({
      exactSlugSkill: null,
      recentSkills: [...distractors, target],
    });

    const result = await lexicalFallbackSkillsHandler(ctx, {
      query: "helper",
      queryTokens: ["helper"],
      categorySlug: "development",
      limit: 10,
    });

    expect(result.map((entry) => entry.skill.slug)).toEqual(["development-target"]);
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
          installs: 1_000,
          stars: 100,
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
            _score: 0.05 - index * 0.001,
          })),
        ),
        runQuery,
      },
      { query: "image", limit: 25 },
    );

    expect(runQuery).toHaveBeenCalledTimes(4);
    expect(runQuery.mock.calls.at(-1)?.[1]).toEqual(
      expect.objectContaining({ query: "image", limit: 200 }),
    );
    expect(result).toHaveLength(25);
    expect(result.some((entry) => entry.skill.slug === "antigravity-image-generator")).toBe(true);
  });

  it("orders lexical name matches above summary-only matches before popularity", async () => {
    generateEmbeddingMock.mockResolvedValueOnce([0, 1, 2]);
    const exactName = {
      skill: makePublicSkill({
        id: "skills:postgres",
        slug: "postgres",
        displayName: "Postgres",
        downloads: 0,
      }),
      version: null,
      ownerHandle: "owner",
      owner: null,
    };
    const summaryOnly = {
      skill: {
        ...makePublicSkill({
          id: "skills:database-tools",
          slug: "database-tools",
          displayName: "Database Tools",
          downloads: 1_000_000_000,
        }),
        summary: "Postgres database helper.",
      },
      version: null,
      ownerHandle: "owner",
      owner: null,
    };
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce(null) // getExactSkillSlugMatch
      .mockResolvedValueOnce([]) // directPrefixSkillMatches
      .mockResolvedValueOnce([summaryOnly, exactName]); // lexicalFallbackSkills

    const result = await searchSkillsHandler(
      {
        vectorSearch: vi.fn().mockResolvedValue([]),
        runQuery,
      },
      { query: "postgres", limit: 2 },
    );

    expect(result.map((entry) => entry.skill.slug)).toEqual(["postgres", "database-tools"]);
    expect(result[0]).not.toHaveProperty("rankTier");
    expect(result[0]).not.toHaveProperty("matchReason");
  });

  it("does not let vector recall make short summary-only skills eligible", async () => {
    generateEmbeddingMock.mockResolvedValueOnce([0, 1, 2]);
    const summaryOnly = {
      embeddingId: "skillEmbeddings:ai",
      skill: {
        ...makePublicSkill({
          id: "skills:ai-summary",
          slug: "general-helper",
          displayName: "General Helper",
          downloads: 1_000,
        }),
        summary: "AI helper for teams.",
      },
      version: null,
      ownerHandle: "owner",
      owner: null,
    };
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce(null) // getExactSkillSlugMatch
      .mockResolvedValueOnce([]) // directPrefixSkillMatches
      .mockResolvedValueOnce([summaryOnly]) // hydrateResults
      .mockResolvedValueOnce([]); // lexicalFallbackSkills

    const result = await searchSkillsHandler(
      {
        vectorSearch: vi.fn().mockResolvedValue([{ _id: "skillEmbeddings:ai", _score: 0.99 }]),
        runQuery,
      },
      { query: "ai", limit: 10 },
    );

    expect(result).toEqual([]);
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

  it("filters vector results by the selected category", async () => {
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
                slug: "automation-helper",
                displayName: "Automation Helper",
                categories: ["automation"],
              });
            }
            if (id === "users:owner") return { _id: "users:owner", handle: "owner" };
            return null;
          }),
          query: vi.fn(() => ({
            withIndex: () => ({ unique: vi.fn().mockResolvedValue(null) }),
          })),
        },
      },
      { embeddingIds: ["skillEmbeddings:1"], categorySlug: "development" },
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
    const exactScore = __test.scoreSkillResult(queryTokens, 0.4, "Notion Sync", "notion-sync", {
      installsAllTime: 0,
      stars: 0,
    });
    const looseScore = __test.scoreSkillResult(queryTokens, 0.6, "Notes Sync", "notes-sync", {
      installsAllTime: 100,
      stars: 20,
    });
    expect(exactScore).toBeGreaterThan(looseScore);
  });

  it("boosts exact full slug over a longer slug containing all query tokens", () => {
    const queryTokens = tokenize("self-improving-agent");
    const exactScore = __test.scoreSkillResult(
      queryTokens,
      0.5,
      "Self Improving Agent",
      "self-improving-agent",
      { installsAllTime: 0, stars: 0 },
    );
    const containingScore = __test.scoreSkillResult(
      queryTokens,
      0.6,
      "Self Improving Agent",
      "xiucheng-self-improving-agent",
      { installsAllTime: 50, stars: 10 },
    );
    expect(exactScore).toBeGreaterThan(containingScore);
  });

  it("keeps extreme popularity below direct lexical relevance", () => {
    const queryTokens = tokenize("needle");
    const exactScore = __test.scoreSkillResult(queryTokens, 0, "Unrelated Name", "needle", {
      installsAllTime: 0,
      stars: 0,
    });
    const popularLooseScore = __test.scoreSkillResult(
      queryTokens,
      0.9,
      "Different Tool",
      "different-tool",
      { installsAllTime: 25_000, stars: 25_000 },
    );
    expect(exactScore).toBeGreaterThan(popularLooseScore);
  });

  it("keeps popularity from flipping a strong name match", () => {
    const queryTokens = tokenize("notion");
    const nameMatchScore = __test.scoreSkillResult(queryTokens, 0, "Notion Helper", "helper", {
      installsAllTime: 0,
      stars: 0,
    });
    const popularVectorScore = __test.scoreSkillResult(
      queryTokens,
      1,
      "Different Tool",
      "different-tool",
      { installsAllTime: 25_000, stars: 25_000 },
    );
    expect(nameMatchScore).toBeGreaterThan(popularVectorScore);
  });

  it("adds stars and installs popularity for equally relevant matches", () => {
    const queryTokens = tokenize("notion");
    const noPopularity = __test.scoreSkillResult(
      queryTokens,
      0.5,
      "Notion Helper",
      "notion-helper",
      { installsAllTime: 0, stars: 0 },
    );
    const highInstallsOnly = __test.scoreSkillResult(
      queryTokens,
      0.5,
      "Notion Helper",
      "notion-helper",
      { installsAllTime: 1000, stars: 0 },
    );
    expect(highInstallsOnly).toBeGreaterThan(noPopularity);
  });

  it("uses installs popularity in live skill search scoring", async () => {
    generateEmbeddingMock.mockResolvedValueOnce([0, 1, 2]);
    const installed = {
      embeddingId: "skillEmbeddings:installed",
      skill: makePublicSkill({
        id: "skills:installed",
        slug: "tool-installed",
        displayName: "Tool",
        downloads: 0,
        installs: 1_000,
        stars: 0,
      }),
      version: null,
      ownerHandle: "owner",
      owner: null,
    };
    const downloaded = {
      embeddingId: "skillEmbeddings:downloaded",
      skill: makePublicSkill({
        id: "skills:downloaded",
        slug: "tool-downloaded",
        displayName: "Tool",
        downloads: 1_000_000_000,
        installs: 0,
        stars: 0,
      }),
      version: null,
      ownerHandle: "owner",
      owner: null,
    };
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce(null) // getExactSkillSlugMatch
      .mockResolvedValueOnce([]) // directPrefixSkillMatches
      .mockResolvedValueOnce([installed, downloaded]) // hydrateResults
      .mockResolvedValueOnce([]); // lexicalFallbackSkills

    const result = await searchSkillsHandler(
      {
        vectorSearch: vi.fn().mockResolvedValue([
          { _id: "skillEmbeddings:installed", _score: 0.5 },
          { _id: "skillEmbeddings:downloaded", _score: 0.52 },
        ]),
        runQuery,
      },
      { query: "tool", limit: 2 },
    );

    expect(result.map((entry) => entry.skill.slug)).toEqual(["tool-installed", "tool-downloaded"]);
  });

  it("breaks capped popularity ties by stars and installs before downloads", async () => {
    generateEmbeddingMock.mockResolvedValueOnce([0, 1, 2]);
    const installedOnly = {
      skill: makePublicSkill({
        id: "skills:installed",
        slug: "tool-installed",
        displayName: "Tool",
        downloads: 0,
        installs: 1_000,
        stars: 1_000,
      }),
      version: null,
      ownerHandle: "owner",
      owner: null,
    };
    const downloadedOnly = {
      skill: makePublicSkill({
        id: "skills:downloaded",
        slug: "tool-downloaded",
        displayName: "Tool",
        downloads: 1_000_000_000,
        installs: 0,
        stars: 1_000,
      }),
      version: null,
      ownerHandle: "owner",
      owner: null,
    };
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce(null) // getExactSkillSlugMatch
      .mockResolvedValueOnce([]) // directPrefixSkillMatches
      .mockResolvedValueOnce([installedOnly, downloadedOnly]); // lexicalFallbackSkills

    const result = await searchSkillsHandler(
      {
        vectorSearch: vi.fn().mockResolvedValue([]),
        runQuery,
      },
      { query: "tool", limit: 2 },
    );

    expect(result.map((entry) => entry.skill.slug)).toEqual(["tool-installed", "tool-downloaded"]);
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
      statsInstallsCurrent: skillDoc.stats.installsCurrent ?? 0,
      statsInstallsAllTime: skillDoc.stats.installsAllTime ?? 0,
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

  it("hydrates a bounded vector window for ordinary load-more searches", async () => {
    generateEmbeddingMock.mockResolvedValueOnce([0, 1, 2]);

    const batch = Array.from({ length: 128 }, (_, i) => ({
      _id: `skillEmbeddings:e${i}`,
      _score: 0.5 - i * 0.001,
    }));

    const vectorSearchMock = vi.fn(
      async (_table: unknown, _index: unknown, opts: { limit: number }) =>
        batch.slice(0, opts.limit),
    );

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

    expect(vectorSearchMock).toHaveBeenCalledTimes(2);
    expect(hydrateCalls).toHaveLength(2);
    expect(hydrateCalls[0]).toHaveLength(100);
    expect(hydrateCalls[1]).toHaveLength(28);
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

  it("preserves vector scores when a direct lexical match shadows the hydrated candidate", async () => {
    generateEmbeddingMock.mockResolvedValueOnce([0, 1, 2]);

    const lexicalEntry = {
      skill: makePublicSkill({
        id: "skills:the-news",
        slug: "the-news",
        displayName: "The News",
      }),
      version: null,
      ownerHandle: "owner",
      owner: null,
    };
    const vectorEntry = {
      ...lexicalEntry,
      embeddingId: "skillEmbeddings:the-news",
    };

    const runQuery = vi
      .fn()
      .mockResolvedValueOnce(null) // getExactSkillSlugMatch
      .mockResolvedValueOnce([lexicalEntry]) // directPrefixSkillMatches
      .mockResolvedValueOnce([vectorEntry]) // hydrateResults
      .mockResolvedValueOnce([]); // lexicalFallbackSkills

    const result = await searchSkillsHandler(
      {
        vectorSearch: vi
          .fn()
          .mockResolvedValueOnce([{ _id: "skillEmbeddings:the-news", _score: 0.33 }]),
        runQuery,
      },
      { query: "news", limit: 10 },
    );

    expect(result).toHaveLength(1);
    expect(result[0].skill.slug).toBe("the-news");
    expect(result[0].score).toBeGreaterThan(2.8);
  });

  it("filters pending scans before applying the search result limit", async () => {
    generateEmbeddingMock.mockRejectedValueOnce(new Error("embedding unavailable"));
    const pending = {
      skill: makePublicSkill({
        id: "skills:pending",
        slug: "search-term-pending",
        displayName: "Search Term Pending",
        githubScanStatus: "pending",
      }),
      version: null,
      ownerHandle: "owner",
      owner: null,
    };
    const clean = {
      skill: makePublicSkill({
        id: "skills:clean",
        slug: "search-term-clean",
        displayName: "Search Term Clean",
        githubScanStatus: "clean",
      }),
      version: null,
      ownerHandle: "owner",
      owner: null,
    };
    const runQuery = vi.fn().mockResolvedValueOnce([pending, clean]).mockResolvedValueOnce([]);

    const result = await searchSkillsHandler(
      { vectorSearch: vi.fn(), runQuery },
      { query: "search term", limit: 1, excludePendingScan: true },
    );

    expect(result.map((entry) => entry.skill.slug)).toEqual(["search-term-clean"]);
  });
});

function makePublicSkill(params: {
  id: string;
  slug: string;
  displayName: string;
  summary?: string;
  downloads?: number;
  ownerPublisherId?: string;
  installs?: number;
  stars?: number;
  categories?: string[];
  topics?: string[];
  githubScanStatus?: "pending" | "clean" | "suspicious" | "malicious" | "not-run";
}) {
  return {
    _id: params.id,
    _creationTime: 1,
    slug: params.slug,
    displayName: params.displayName,
    summary: params.summary ?? `${params.displayName} summary`,
    ownerUserId: "users:owner",
    ownerPublisherId: params.ownerPublisherId,
    canonicalSkillId: undefined,
    forkOf: undefined,
    latestVersionId: "skillVersions:1",
    tags: {},
    categories: params.categories,
    topics: params.topics,
    githubScanStatus: params.githubScanStatus,
    badges: {},
    stats: {
      downloads: params.downloads ?? 0,
      installs: params.installs ?? 0,
      stars: params.stars ?? 0,
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
  summary?: string;
  ownerPublisherId?: string;
  moderationFlags?: string[];
  moderationReason?: string;
  softDeletedAt?: number;
  downloads?: number;
  installs?: number;
  stars?: number;
  categories?: string[];
  topics?: string[];
  inferredCategories?: string[];
  inferredFromVersionId?: string;
  latestVersionId?: string;
  moderationSourceVersionId?: string;
  statsVersions?: number;
  publicVersion?: { status: "available"; versionId: string } | { status: "unavailable" };
}) {
  return {
    ...makePublicSkill(params),
    latestVersionId: params.latestVersionId ?? "skillVersions:1",
    stats: {
      downloads: params.downloads ?? 0,
      installsCurrent: 0,
      installsAllTime: params.installs ?? 0,
      stars: params.stars ?? 0,
      versions: params.statsVersions ?? 1,
      comments: 0,
    },
    _creationTime: 1,
    moderationStatus: "active",
    moderationFlags: params.moderationFlags ?? [],
    moderationReason: params.moderationReason,
    moderationSourceVersionId: params.moderationSourceVersionId,
    softDeletedAt: params.softDeletedAt as number | undefined,
    inferredCategories: params.inferredCategories,
    inferredFromVersionId: params.inferredFromVersionId,
    publicVersion: params.publicVersion,
  };
}

function makePaginatedRows<T>(rows: T[], onPaginate?: () => void) {
  return vi.fn(async ({ cursor, numItems }: { cursor: string | null; numItems: number }) => {
    onPaginate?.();
    const start = cursor ? Number(cursor) : 0;
    const page = rows.slice(start, start + numItems);
    const next = start + page.length;
    return {
      page,
      isDone: next >= rows.length,
      continueCursor: String(next),
    };
  });
}

function makeLexicalCtx(params: {
  exactSlugSkill?: ReturnType<typeof makeSkillDoc> | null;
  exactSlugSkills?: Array<ReturnType<typeof makeSkillDoc>>;
  officialPublisherIds?: string[];
  recentSkills: Array<ReturnType<typeof makeSkillDoc>>;
  recentByCreated?: Array<ReturnType<typeof makeSkillDoc>>;
}) {
  const exactSlugSkills =
    params.exactSlugSkills ?? (params.exactSlugSkill ? [params.exactSlugSkill] : []);
  const officialPublisherIds = new Set(params.officialPublisherIds ?? []);
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
  const takeLimits: number[] = [];
  let paginateCalls = 0;
  return {
    usedIndexes,
    takeLimits,
    get paginateCalls() {
      return paginateCalls;
    },
    db: {
      query: vi.fn((table: string) => {
        if (table === "officialPublishers") {
          return {
            withIndex: (
              index: string,
              builder: (q: { eq: (field: string, value: unknown) => unknown }) => unknown,
            ) => {
              usedIndexes.push(index);
              let publisherId = "";
              const q = {
                eq: (field: string, value: unknown) => {
                  if (field === "publisherId") publisherId = String(value);
                  return q;
                },
              };
              builder(q);
              return {
                unique: vi.fn(async () =>
                  officialPublisherIds.has(publisherId) ? { publisherId } : null,
                ),
              };
            },
          };
        }
        if (table === "skills") {
          return {
            withIndex: (index: string) => {
              usedIndexes.push(index);
              if (index === "by_slug") {
                return {
                  unique: vi.fn(async () => {
                    if (exactSlugSkills.length > 1) {
                      throw new Error("unique should not be used for duplicate exact slug matches");
                    }
                    return exactSlugSkills[0] ?? null;
                  }),
                  take: vi.fn(async (limit: number) => exactSlugSkills.slice(0, limit)),
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
                    take: vi.fn((limit: number) => {
                      takeLimits.push(limit);
                      return Promise.resolve(digestByUpdated);
                    }),
                    paginate: makePaginatedRows(digestByUpdated, () => {
                      paginateCalls += 1;
                    }),
                  }),
                };
              }
              if (index === "by_active_created" || index === "by_nonsuspicious_created") {
                return {
                  order: () => ({
                    take: vi.fn((limit: number) => {
                      takeLimits.push(limit);
                      return Promise.resolve(digestByCreated);
                    }),
                    paginate: makePaginatedRows(digestByCreated, () => {
                      paginateCalls += 1;
                    }),
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
        if (id.startsWith("publishers:")) {
          const handle = id.split(":")[1] ?? "owner";
          return {
            _id: id,
            _creationTime: 1,
            kind: "org",
            handle,
            displayName: handle,
            image: undefined,
            bio: undefined,
            linkedUserId: undefined,
            createdAt: 1,
            updatedAt: 1,
          };
        }
        if (id.startsWith("users:")) return { _id: id, handle: "owner" };
        if (id.startsWith("skillVersions:")) return { _id: id, version: "1.0.0" };
        return null;
      }),
    },
  };
}

function makeDirectPrefixCtx(skills: Array<ReturnType<typeof makeSkillDoc>>) {
  const firstToken = (value: string) => value.toLowerCase().match(/[a-z0-9]+/)?.[0];
  // Token-level splitter that mirrors Convex full-text inverted index behavior:
  // any alphanumeric run of length >= 1 becomes a token, regardless of position.
  const tokensOf = (value: string): string[] =>
    (value.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(Boolean);
  const digestRows = skills.map((skill) => ({
    ...skill,
    skillId: skill._id,
    normalizedSlug: skill.slug.toLowerCase(),
    normalizedSlugFirstToken: firstToken(skill.slug),
    normalizedDisplayName: skill.displayName.toLowerCase(),
    normalizedDisplayNameFirstToken: firstToken(skill.displayName),
    isSuspicious: (skill.moderationFlags ?? []).includes("flagged.suspicious"),
    ownerHandle: "owner",
    ownerName: "Owner",
    ownerDisplayName: "Owner",
    ownerImage: undefined,
  }));
  const usedIndexes: string[] = [];
  const usedSearchIndexes: string[] = [];
  const takeLimits: number[] = [];
  let paginateCalls = 0;
  return {
    usedIndexes,
    usedSearchIndexes,
    takeLimits,
    get paginateCalls() {
      return paginateCalls;
    },
    db: {
      query: vi.fn((table: string) => {
        if (table === "skillTopicSearchDigest") {
          return {
            withIndex: (
              index: string,
              builder: (q: {
                eq: (field: string, value: unknown) => unknown;
                gte: (field: string, value: unknown) => unknown;
                lt: (field: string, value: unknown) => unknown;
              }) => unknown,
            ) => {
              usedIndexes.push(index);
              let topic = "";
              let topicPrefix = "";
              const q = {
                eq: (field: string, value: unknown) => {
                  if (field === "topic") topic = String(value);
                  return q;
                },
                gte: (field: string, value: unknown) => {
                  if (field === "topic") topicPrefix = String(value);
                  return q;
                },
                lt: () => q,
              };
              builder(q);
              const rows = digestRows
                .filter((digest) =>
                  digest.topics?.some((value) => {
                    const topicSlug = tokenize(value).join("-");
                    return topic ? topicSlug === topic : topicSlug.startsWith(topicPrefix);
                  }),
                )
                .map((digest) => ({
                  skillId: digest.skillId,
                  topic: topic || topicPrefix,
                }));
              return {
                order: () => ({
                  take: vi.fn(async (limit: number) => {
                    takeLimits.push(limit);
                    return rows.slice(0, limit);
                  }),
                  paginate: makePaginatedRows(rows, () => {
                    paginateCalls += 1;
                  }),
                }),
              };
            },
          };
        }
        if (table === "officialPublishers") {
          return {
            withIndex: () => ({
              unique: vi.fn(async () => null),
            }),
          };
        }
        if (table !== "skillSearchDigest") throw new Error(`Unexpected table ${table}`);
        return {
          withIndex: (index: string, builder: (q: unknown) => unknown) => {
            usedIndexes.push(index);
            const range: Record<string, string> = {};
            const equality: Record<string, unknown> = {};
            const q = {
              eq: (field: string, value: unknown) => {
                equality[field] = value;
                return q;
              },
              gte: (field: string, value: string) => {
                range[field] = value;
                return q;
              },
              lt: () => q,
            };
            builder(q);
            if (index === "by_skill") {
              return {
                unique: vi.fn(
                  async () =>
                    digestRows.find((digest) => digest.skillId === equality.skillId) ?? null,
                ),
              };
            }
            const rows = digestRows.filter((digest) => {
              const field = index.includes("first_token")
                ? index.includes("slug")
                  ? "normalizedSlugFirstToken"
                  : "normalizedDisplayNameFirstToken"
                : index.includes("slug")
                  ? "normalizedSlug"
                  : "normalizedDisplayName";
              const prefix = range[field] ?? "";
              return (digest[field] ?? "").startsWith(prefix);
            });
            return {
              take: vi.fn(async (limit: number) => {
                takeLimits.push(limit);
                return rows.slice(0, limit);
              }),
              paginate: makePaginatedRows(rows, () => {
                paginateCalls += 1;
              }),
            };
          },
          // Mock for the new `searchIndex`-backed full-text queries added to
          // `directPrefixSkillMatches`. Mirrors Convex's documented semantics:
          // tokenize on alphanumeric runs (case-insensitive) and match a row
          // when *any* token in the search field equals *any* token of the
          // user query — i.e. position-independent, unlike `withIndex` which
          // only does string-prefix matches against a normalized field.
          withSearchIndex: (
            indexName: string,
            builder: (q: {
              search: (field: string, query: string) => unknown;
              eq: (field: string, value: unknown) => unknown;
            }) => unknown,
          ) => {
            usedSearchIndexes.push(indexName);
            let searchField = "";
            let searchQuery = "";
            const filters: Array<{ field: string; value: unknown }> = [];
            const q = {
              search: (field: string, query: string) => {
                searchField = field;
                searchQuery = query;
                return q;
              },
              eq: (field: string, value: unknown) => {
                filters.push({ field, value });
                return q;
              },
            };
            builder(q);
            const queryTokens = new Set(tokensOf(searchQuery));
            const rows =
              queryTokens.size === 0
                ? []
                : digestRows.filter((digest) => {
                    for (const filter of filters) {
                      if ((digest as Record<string, unknown>)[filter.field] !== filter.value) {
                        return false;
                      }
                    }
                    const fieldValue =
                      (digest as unknown as Record<string, string | undefined>)[searchField] ?? "";
                    const fieldTokens = new Set(tokensOf(fieldValue));
                    for (const token of queryTokens) {
                      if (fieldTokens.has(token)) return true;
                    }
                    return false;
                  });
            return {
              take: vi.fn(async (limit: number) => {
                takeLimits.push(limit);
                return rows.slice(0, limit);
              }),
              paginate: makePaginatedRows(rows, () => {
                paginateCalls += 1;
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
