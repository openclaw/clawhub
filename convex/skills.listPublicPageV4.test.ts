/* @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
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
  it("defines recommended rank indexes in contract order", () => {
    expect(getSkillSearchDigestIndexFields("by_active_recommended_rank")).toEqual([
      "softDeletedAt",
      "statsStars",
      "statsDownloads",
      "updatedAt",
    ]);
    expect(getSkillSearchDigestIndexFields("by_nonsuspicious_recommended_rank")).toEqual([
      "softDeletedAt",
      "isSuspicious",
      "statsStars",
      "statsDownloads",
      "updatedAt",
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

  it("keeps recommended-rank cursors on the index that created them", () => {
    expect(
      __test.resolveRecommendedPublicListSort({
        decodedCursor: null,
        hasMissingRankStats: false,
      }),
    ).toBe("recommended");
    expect(
      __test.resolveRecommendedPublicListSort({
        decodedCursor: null,
        hasMissingRankStats: true,
      }),
    ).toBe("updated");
    expect(
      __test.resolveRecommendedPublicListSort({
        decodedCursor: [undefined, 123, 456, "skillSearchDigest:updated"],
        hasMissingRankStats: false,
      }),
    ).toBe("updated");
    expect(
      __test.resolveRecommendedPublicListSort({
        decodedCursor: [undefined, false, 123, 456, "skillSearchDigest:nonsuspicious-updated"],
        hasMissingRankStats: false,
      }),
    ).toBe("updated");
    expect(
      __test.resolveRecommendedPublicListSort({
        decodedCursor: [undefined, 10, 20, 123, 456, "skillSearchDigest:recommended"],
        hasMissingRankStats: true,
      }),
    ).toBe("recommended");
    expect(
      __test.resolveRecommendedPublicListSort({
        decodedCursor: [
          undefined,
          false,
          10,
          20,
          123,
          456,
          "skillSearchDigest:nonsuspicious-recommended",
        ],
        hasMissingRankStats: true,
      }),
    ).toBe("recommended");
  });

  it("sorts highlighted recommended results by stars, downloads, then updatedAt", async () => {
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
      "stars-skill",
      "downloads-skill",
      "updated-skill",
      "installs-skill",
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
    softDeletedAt: undefined,
    moderationStatus: "active",
    moderationFlags: [],
    moderationReason: undefined,
    isSuspicious: false,
    createdAt: 1,
    updatedAt: params.updatedAt,
  };
}
