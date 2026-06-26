/* @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import {
  computeRecommendationScore,
  RECOMMENDATION_SCORE_VERSION,
} from "./lib/recommendationScore";
import schema from "./schema";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
  authTables: {},
}));

const { __test, listPublicPageV4 } = await import("./skills");

const listPublicPageV4Handler = (
  listPublicPageV4 as unknown as {
    _handler: (
      ctx: unknown,
      args: unknown,
    ) => Promise<{ page: Array<{ skill: { slug: string } }> }>;
  }
)._handler;

describe("skills.listPublicPageV4", () => {
  it("defines recommended indexes in contract order", () => {
    expect(getSkillSearchDigestIndexFields("by_active_recommended_rank")).toEqual([
      "softDeletedAt",
      "statsStars",
      "statsDownloads",
      "updatedAt",
    ]);
    expect(getSkillSearchDigestIndexFields("by_active_recommended_score")).toEqual([
      "softDeletedAt",
      "recommendedScore",
      "updatedAt",
    ]);
    expect(getSkillSearchDigestIndexFields("by_active_recommended_score_version")).toEqual([
      "softDeletedAt",
      "recommendedScoreVersion",
    ]);
    expect(getSkillSearchDigestIndexFields("by_nonsuspicious_recommended_rank")).toEqual([
      "softDeletedAt",
      "isSuspicious",
      "statsStars",
      "statsDownloads",
      "updatedAt",
    ]);
    expect(getSkillSearchDigestIndexFields("by_nonsuspicious_recommended_score")).toEqual([
      "softDeletedAt",
      "isSuspicious",
      "recommendedScore",
      "updatedAt",
    ]);
    expect(getSkillSearchDigestIndexFields("by_nonsuspicious_recommended_score_version")).toEqual([
      "softDeletedAt",
      "isSuspicious",
      "recommendedScoreVersion",
    ]);
  });

  it("forces Recommended ranking to descending for stale URLs", () => {
    expect(__test.resolvePublicListDir("recommended", "asc")).toBe("desc");
    expect(__test.resolvePublicListDir("default", "asc")).toBe("desc");
  });

  it("keeps explicit non-default sort directions", () => {
    expect(__test.resolvePublicListDir("name", undefined)).toBe("asc");
    expect(__test.resolvePublicListDir("downloads", "asc")).toBe("asc");
  });

  it("uses the score index after recommendation scores are backfilled", () => {
    expect(
      __test.resolveRecommendedPublicListQuery({
        scoreIndexName: "by_active_recommended_score",
        rankIndexName: "by_active_recommended_rank",
        updatedIndexName: "by_active_updated",
        scoreCursor: null,
        rankCursor: null,
        updatedCursor: null,
        hasMissingScores: false,
      }),
    ).toEqual({
      sort: "recommended",
      indexName: "by_active_recommended_score",
      decodedCursor: null,
    });
  });

  it("falls back to the recommended rank index while recommendation scores are missing", () => {
    expect(
      __test.resolveRecommendedPublicListQuery({
        scoreIndexName: "by_active_recommended_score",
        rankIndexName: "by_active_recommended_rank",
        updatedIndexName: "by_active_updated",
        scoreCursor: null,
        rankCursor: null,
        updatedCursor: null,
        hasMissingScores: true,
      }),
    ).toEqual({
      sort: "recommended",
      indexName: "by_active_recommended_rank",
      decodedCursor: null,
    });
  });

  it("sorts highlighted recommended results by weighted score, then updatedAt", async () => {
    const result = await listPublicPageV4Handler(
      makeHighlightedCtx([
        makeDigest({
          id: "updated",
          slug: "updated-skill",
          stars: 2,
          installsAllTime: 10,
          downloads: 10,
          updatedAt: 400,
        }),
        makeDigest({
          id: "downloads",
          slug: "downloads-skill",
          stars: 2,
          installsAllTime: 10,
          downloads: 50,
          updatedAt: 100,
        }),
        makeDigest({
          id: "installs",
          slug: "installs-skill",
          stars: 2,
          installsAllTime: 20,
          downloads: 0,
          updatedAt: 100,
        }),
        makeDigest({
          id: "stars",
          slug: "stars-skill",
          stars: 3,
          installsAllTime: 0,
          downloads: 0,
          updatedAt: 100,
        }),
      ]),
      { highlightedOnly: true, numItems: 10 },
    );

    expect(result.page.map((entry) => entry.skill.slug)).toEqual([
      "downloads-skill",
      "installs-skill",
      "updated-skill",
      "stars-skill",
    ]);
  });

  it("recomputes highlighted recommended scores when the stored score is stale", async () => {
    const result = await listPublicPageV4Handler(
      makeHighlightedCtx([
        makeDigest({
          id: "old-download-score",
          slug: "old-download-score",
          stars: 0,
          installsAllTime: 2,
          downloads: 43_080,
          updatedAt: 100,
          recommendedScore: computeRecommendationScore({
            downloads: 43_080,
            installs: 2,
            stars: 0,
          }),
          recommendedScoreVersion: RECOMMENDATION_SCORE_VERSION,
        }),
        makeDigest({
          id: "stale-install-score",
          slug: "stale-install-score",
          stars: 0,
          installsAllTime: 74,
          downloads: 393,
          updatedAt: 100,
          recommendedScore: 1,
          recommendedScoreVersion: RECOMMENDATION_SCORE_VERSION - 1,
        }),
      ]),
      { highlightedOnly: true, numItems: 10 },
    );

    expect(result.page.map((entry) => entry.skill.slug)).toEqual([
      "old-download-score",
      "stale-install-score",
    ]);
  });
});

function getSkillSearchDigestIndexFields(indexDescriptor: string) {
  const index = schema.tables.skillSearchDigest[" indexes"]().find(
    (candidate) => candidate.indexDescriptor === indexDescriptor,
  );
  if (!index) throw new Error(`Missing skillSearchDigest index ${indexDescriptor}`);
  return index.fields;
}

type EqBuilder = {
  eq: (field: string, value: unknown) => EqBuilder;
  getLastValue: () => unknown;
};

function makeEqBuilder(): EqBuilder {
  let lastValue: unknown;
  const builder: EqBuilder = {
    eq: (_field, value) => {
      lastValue = value;
      return builder;
    },
    getLastValue: () => lastValue,
  };
  return builder;
}

function makeHighlightedCtx(digests: Array<ReturnType<typeof makeDigest>>) {
  const digestBySkillId = new Map(digests.map((digest) => [digest.skillId, digest]));
  return {
    db: {
      query: vi.fn((table: string) => {
        if (table === "skillBadges") {
          return {
            withIndex: vi.fn((_indexName: string, build: (q: EqBuilder) => unknown) => {
              build(makeEqBuilder());
              return {
                order: vi.fn(() => ({
                  take: vi.fn().mockResolvedValue(
                    digests.map((digest) => ({
                      _id: `skillBadges:${digest.skillId}`,
                      skillId: digest.skillId,
                      kind: "highlighted",
                      awardedAt: digest.updatedAt,
                    })),
                  ),
                })),
              };
            }),
          };
        }
        if (table === "skillSearchDigest") {
          return {
            withIndex: vi.fn((_indexName: string, build: (q: EqBuilder) => unknown) => {
              const eqBuilder = makeEqBuilder();
              build(eqBuilder);
              const skillId = eqBuilder.getLastValue();
              return {
                unique: vi
                  .fn()
                  .mockResolvedValue(
                    typeof skillId === "string" ? (digestBySkillId.get(skillId) ?? null) : null,
                  ),
              };
            }),
          };
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    },
  };
}

function makeDigest(params: {
  id: string;
  slug: string;
  stars: number;
  installsAllTime: number;
  downloads: number;
  updatedAt: number;
  recommendedScore?: number;
  recommendedScoreVersion?: number;
}) {
  return {
    _id: `skillSearchDigest:${params.id}`,
    _creationTime: params.updatedAt,
    skillId: `skills:${params.id}`,
    slug: params.slug,
    displayName: params.slug,
    summary: `${params.slug} summary`,
    ownerUserId: "users:owner",
    ownerPublisherId: undefined,
    ownerHandle: "owner",
    ownerKind: "user",
    ownerName: "owner",
    ownerDisplayName: "Owner",
    ownerImage: undefined,
    canonicalSkillId: undefined,
    forkOf: undefined,
    latestVersionId: undefined,
    latestVersionSummary: undefined,
    tags: {},
    capabilityTags: [],
    badges: undefined,
    stats: {
      downloads: params.downloads,
      installsCurrent: 0,
      installsAllTime: params.installsAllTime,
      stars: params.stars,
      versions: 1,
      comments: 0,
    },
    statsDownloads: params.downloads,
    statsStars: params.stars,
    statsInstallsCurrent: 0,
    statsInstallsAllTime: params.installsAllTime,
    recommendedScore: params.recommendedScore,
    recommendedScoreVersion: params.recommendedScoreVersion,
    softDeletedAt: undefined,
    moderationStatus: "active",
    moderationFlags: [],
    moderationReason: undefined,
    isSuspicious: false,
    createdAt: 1,
    updatedAt: params.updatedAt,
  };
}
