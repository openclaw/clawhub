/* @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import { toPublicSkill } from "./public";
import { computeRecommendationScore, RECOMMENDATION_SCORE_VERSION } from "./recommendationScore";
import {
  digestToHydratableSkill,
  extractDigestFields,
  extractValidatedDigestFields,
  digestToOwnerInfo,
  upsertSkillSearchDigest,
} from "./skillSearchDigest";

function makeSkillDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: "skills:abc" as never,
    _creationTime: 1000,
    slug: "test-skill",
    displayName: "Test Skill",
    summary: "A test skill summary",
    resourceId: "res123",
    ownerUserId: "users:owner" as never,
    canonicalSkillId: undefined,
    forkOf: undefined,
    latestVersionId: "skillVersions:v1" as never,
    latestVersionSummary: {
      version: "1.0.0",
      createdAt: 1000,
      changelog: "Initial release",
    },
    tags: {} as Record<string, never>,
    categories: ["operations"],
    topics: ["supply-chain", "vetting"],
    softDeletedAt: undefined,
    badges: undefined,
    moderationStatus: "active" as const,
    moderationNotes: undefined,
    moderationReason: undefined,
    moderationVerdict: undefined,
    moderationReasonCodes: undefined,
    moderationEvidence: undefined,
    moderationSummary: undefined,
    moderationEngineVersion: undefined,
    moderationEvaluatedAt: undefined,
    moderationSourceVersionId: undefined,
    quality: undefined,
    isSuspicious: false,
    moderationFlags: ["flagged.test"],
    lastReviewedAt: undefined,
    scanLastCheckedAt: undefined,
    scanCheckCount: undefined,
    hiddenAt: undefined,
    hiddenBy: undefined,
    reportCount: 0,
    lastReportedAt: undefined,
    batch: undefined,
    statsDownloads: 42,
    statsStars: 5,
    statsInstallsCurrent: 10,
    statsInstallsAllTime: 100,
    stats: {
      downloads: 42,
      installsCurrent: 10,
      installsAllTime: 100,
      stars: 5,
      versions: 3,
      comments: 1,
    },
    createdAt: 1000,
    updatedAt: 2000,
    ...overrides,
  };
}

describe("extractDigestFields", () => {
  it("extracts the correct subset of fields", () => {
    const skill = makeSkillDoc();
    const digest = extractDigestFields(skill as never);

    expect(digest.skillId).toBe("skills:abc");
    expect(digest.slug).toBe("test-skill");
    expect(digest.displayName).toBe("Test Skill");
    expect(digest.summary).toBe("A test skill summary");
    expect(digest.ownerUserId).toBe("users:owner");
    expect(digest.categories).toEqual(["operations"]);
    expect(digest.topics).toEqual(["supply-chain", "vetting"]);
    expect(digest.statsDownloads).toBe(42);
    expect(digest.statsStars).toBe(5);
    expect(digest.statsInstallsCurrent).toBe(10);
    expect(digest.statsInstallsAllTime).toBe(100);
    expect(digest.recommendedScore).toBe(
      computeRecommendationScore({ downloads: 42, installs: 100, stars: 5 }),
    );
    expect(digest.recommendedScoreVersion).toBe(RECOMMENDATION_SCORE_VERSION);
    expect(digest.stats).toEqual({
      downloads: 42,
      installsCurrent: 10,
      installsAllTime: 100,
      stars: 5,
      versions: 3,
      comments: 1,
    });
    expect(digest.moderationFlags).toEqual(["flagged.test"]);
    expect(digest.moderationVerdict).toBeUndefined();
    expect(digest.isSuspicious).toBe(false);
    expect(digest.createdAt).toBe(1000);
    expect(digest.updatedAt).toBe(2000);
  });

  it("fills digest rank stats from legacy nested stats", () => {
    const skill = makeSkillDoc({
      statsDownloads: undefined,
      statsStars: undefined,
      statsInstallsCurrent: undefined,
      statsInstallsAllTime: undefined,
      stats: {
        downloads: 42,
        installsCurrent: 10,
        installsAllTime: 100,
        stars: 5,
        versions: 3,
        comments: 1,
      },
    });
    const digest = extractDigestFields(skill as never);

    expect(digest.statsDownloads).toBe(42);
    expect(digest.statsStars).toBe(5);
    expect(digest.statsInstallsCurrent).toBe(10);
    expect(digest.statsInstallsAllTime).toBe(100);
    expect(digest.recommendedScore).toBe(
      computeRecommendationScore({ downloads: 42, installs: 100, stars: 5 }),
    );
    expect(digest.recommendedScoreVersion).toBe(RECOMMENDATION_SCORE_VERSION);
  });

  it("projects current inferred catalog metadata when author metadata is omitted", () => {
    const digest = extractDigestFields(
      makeSkillDoc({
        categories: undefined,
        topics: undefined,
        inferredCategories: ["development"],
        inferredTopics: ["TypeScript", "Code Review"],
        inferredFromVersionId: "skillVersions:v1",
      }) as never,
    );

    expect(digest.categories).toEqual(["development"]);
    expect(digest.topics).toEqual(["TypeScript", "Code Review"]);
  });

  it("does not project stale inferred catalog metadata", () => {
    const digest = extractDigestFields(
      makeSkillDoc({
        latestVersionId: "skillVersions:v2",
        categories: undefined,
        topics: undefined,
        inferredCategories: ["development"],
        inferredTopics: ["TypeScript"],
        inferredFromVersionId: "skillVersions:v1",
      }) as never,
    );

    expect(digest.categories).toEqual(["other"]);
    expect(digest.topics).toEqual([]);
  });

  it("omits large fields not needed for search", () => {
    const skill = makeSkillDoc({
      moderationEvidence: [
        { code: "test", severity: "info", file: "a.ts", line: 1, message: "m", evidence: "e" },
      ],
      quality: {
        score: 80,
        decision: "pass",
        trustTier: "medium",
        similarRecentCount: 0,
        reason: "ok",
        signals: {},
        evaluatedAt: 1000,
      },
      latestVersionSummary: { version: "1.0.0", createdAt: 1000, changelog: "big text" },
      moderationNotes: "some notes",
      moderationSummary: "summary text",
    });
    const digest = extractDigestFields(skill as never);

    expect(digest).not.toHaveProperty("moderationEvidence");
    expect(digest).not.toHaveProperty("quality");
    expect(digest).toHaveProperty("latestVersionSummary");
    expect(digest).not.toHaveProperty("moderationNotes");
    expect(digest).not.toHaveProperty("moderationSummary");
    expect(digest).not.toHaveProperty("resourceId");
  });

  it("extractDigestFields does not include owner profile fields", () => {
    const skill = makeSkillDoc();
    const digest = extractDigestFields(skill as never);
    expect(digest).not.toHaveProperty("ownerHandle");
    expect(digest).not.toHaveProperty("ownerName");
    expect(digest).not.toHaveProperty("ownerDisplayName");
    expect(digest).not.toHaveProperty("ownerImage");
  });

  it("produces a digest that works with toPublicSkill when shaped as Doc<skills>", () => {
    const skill = makeSkillDoc();
    const digest = extractDigestFields(skill as never);
    // Simulate what hydrateResults does: spread digest with _id and _creationTime
    const fakeDoc = { ...digest, _id: digest.skillId, _creationTime: digest.createdAt };

    // toPublicSkill expects specific fields — verify the shape matches
    expect(fakeDoc._id).toBe("skills:abc");
    expect(fakeDoc._creationTime).toBe(1000);
    expect(fakeDoc.slug).toBe("test-skill");
    expect(fakeDoc.displayName).toBe("Test Skill");
    expect(fakeDoc.ownerUserId).toBe("users:owner");
    expect(fakeDoc.tags).toEqual({});
    expect(fakeDoc.stats).toBeDefined();
  });

  it("preserves suspicious state through digest hydration", () => {
    const digest = extractDigestFields(makeSkillDoc({ isSuspicious: true }) as never);
    const hydratable = digestToHydratableSkill(digest as never);

    expect(hydratable.isSuspicious).toBe(true);
  });

  it("preserves catalog metadata through public hydration", () => {
    const digest = extractDigestFields(makeSkillDoc() as never);
    const publicSkill = toPublicSkill(digestToHydratableSkill(digest as never));

    expect(publicSkill?.categories).toEqual(["operations"]);
    expect(publicSkill?.topics).toEqual(["supply-chain", "vetting"]);
  });

  it("preserves malicious moderation verdicts through digest hydration", () => {
    const digest = extractDigestFields(makeSkillDoc({ moderationVerdict: "malicious" }) as never);
    const hydratable = digestToHydratableSkill(digest as never);

    expect(hydratable.moderationVerdict).toBe("malicious");
    expect(toPublicSkill(hydratable)).toBeNull();
  });
});

describe("extractValidatedDigestFields", () => {
  it("records latest-version ownership when the version belongs to the skill", async () => {
    const digest = await extractValidatedDigestFields(
      {
        db: {
          get: async () => ({
            _id: "skillVersions:v1",
            skillId: "skills:abc",
            softDeletedAt: undefined,
          }),
        },
      } as never,
      makeSkillDoc() as never,
    );

    expect(digest.latestVersionId).toBe("skillVersions:v1");
    expect(digest.latestVersionSkillId).toBe("skills:abc");
    expect(digest.latestVersionSummary).toMatchObject({ version: "1.0.0" });
    expect(digest.publicVersion).toEqual({
      status: "available",
      versionId: "skillVersions:v1",
    });
  });

  it("clears stale latest-version metadata when the version belongs to another skill", async () => {
    const digest = await extractValidatedDigestFields(
      {
        db: {
          get: async () => ({ skillId: "skills:other", softDeletedAt: undefined }),
        },
      } as never,
      makeSkillDoc() as never,
    );

    expect(digest.latestVersionId).toBeUndefined();
    expect(digest.latestVersionSkillId).toBeUndefined();
    expect(digest.latestVersionSummary).toBeUndefined();
    expect(digest.publicVersion).toEqual({ status: "unavailable" });
  });
});

describe("upsertSkillSearchDigest", () => {
  it("syncs one indexed topic row per valid stored topic", async () => {
    const insert = vi.fn(async (table: string) => `${table}:inserted`);
    const fields = extractDigestFields(
      makeSkillDoc({ topics: ["supply-chain", "Official", "vetting"] }) as never,
    );
    const query = vi.fn((_table: string) => ({
      withIndex: vi.fn(() => ({
        unique: vi.fn(async () => null),
        collect: vi.fn(async () => []),
      })),
    }));

    await upsertSkillSearchDigest({ db: { query, insert } } as never, fields);

    expect(insert).toHaveBeenCalledWith("skillSearchDigest", fields);
    expect(insert).toHaveBeenCalledWith(
      "skillTopicSearchDigest",
      expect.objectContaining({
        skillId: "skills:abc",
        topic: "supply-chain",
        normalizedDisplayName: "test skill",
        recommendedScore: expect.any(Number),
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "skillTopicSearchDigest",
      expect.objectContaining({ skillId: "skills:abc", topic: "vetting" }),
    );
  });

  it("removes indexed topic rows when topics are cleared", async () => {
    const fields = extractDigestFields(makeSkillDoc({ topics: undefined }) as never);
    const deleteRow = vi.fn(async () => {});
    const query = vi.fn((table: string) => ({
      withIndex: vi.fn(() => ({
        unique: vi.fn(async () =>
          table === "skillSearchDigest"
            ? {
                ...fields,
                _id: "skillSearchDigest:abc",
                _creationTime: 1,
                topics: ["supply-chain"],
              }
            : null,
        ),
        collect: vi.fn(async () =>
          table === "skillTopicSearchDigest"
            ? [
                {
                  _id: "skillTopicSearchDigest:supply-chain",
                  skillId: fields.skillId,
                  topic: "supply-chain",
                },
              ]
            : [],
        ),
      })),
    }));

    await upsertSkillSearchDigest(
      {
        db: {
          query,
          insert: vi.fn(),
          patch: vi.fn(),
          delete: deleteRow,
        },
      } as never,
      fields,
    );

    expect(deleteRow).toHaveBeenCalledWith("skillTopicSearchDigest:supply-chain");
  });

  it("syncs a compact curated projection for official or highlighted skills", async () => {
    const fields = extractDigestFields(
      makeSkillDoc({ badges: { official: { byUserId: "users:admin", at: 3 } } }) as never,
    );
    const insert = vi.fn(async (table: string) => `${table}:inserted`);
    const query = vi.fn(() => ({
      withIndex: vi.fn(() => ({
        unique: vi.fn(async () => null),
        collect: vi.fn(async () => []),
      })),
    }));

    await upsertSkillSearchDigest({ db: { query, insert } } as never, fields);

    expect(insert).toHaveBeenCalledWith(
      "curatedSkillSearchDigest",
      expect.objectContaining({
        skillId: "skills:abc",
        categories: ["operations"],
        topics: ["supply-chain", "vetting"],
        statsDownloads: 42,
      }),
    );
  });

  it("removes the curated projection when the last curated badge is cleared", async () => {
    const fields = extractDigestFields(makeSkillDoc({ badges: {} }) as never);
    const deleteRow = vi.fn(async () => {});
    const query = vi.fn((table: string) => ({
      withIndex: vi.fn(() => ({
        unique: vi.fn(async () => {
          if (table === "skillSearchDigest") {
            return {
              ...fields,
              badges: { official: { byUserId: "users:admin", at: 3 } },
              _id: "skillSearchDigest:abc",
            };
          }
          if (table === "curatedSkillSearchDigest") {
            return { skillId: fields.skillId, _id: "curatedSkillSearchDigest:abc" };
          }
          return null;
        }),
        collect: vi.fn(async () => []),
      })),
    }));

    await upsertSkillSearchDigest(
      {
        db: {
          query,
          insert: vi.fn(),
          patch: vi.fn(),
          delete: deleteRow,
        },
      } as never,
      fields,
    );

    expect(deleteRow).toHaveBeenCalledWith("curatedSkillSearchDigest:abc");
  });
});

describe("digestToOwnerInfo", () => {
  it("returns owner info when ownerHandle is present", () => {
    const digest = {
      ownerUserId: "users:owner" as never,
      ownerHandle: "jdoe",
      ownerName: "John",
      ownerDisplayName: "John Doe",
      ownerImage: "https://example.com/avatar.png",
    };
    const result = digestToOwnerInfo(digest);
    expect(result).not.toBeNull();
    expect(result!.ownerHandle).toBe("jdoe");
    expect(result!.owner).toEqual({
      _id: "publishers:missing",
      _creationTime: 0,
      kind: "user",
      handle: "jdoe",
      displayName: "John Doe",
      image: "https://example.com/avatar.png",
      bio: undefined,
      linkedUserId: "users:owner",
    });
  });

  it("returns null when ownerHandle is undefined (pre-backfill)", () => {
    const digest = {
      ownerUserId: "users:owner" as never,
      ownerHandle: undefined,
      ownerName: undefined,
      ownerDisplayName: undefined,
      ownerImage: undefined,
    };
    expect(digestToOwnerInfo(digest)).toBeNull();
  });

  it("uses userId as fallback handle when ownerHandle is empty string", () => {
    const digest = {
      ownerUserId: "users:owner" as never,
      ownerHandle: "",
      ownerName: "No Handle User",
      ownerDisplayName: "No Handle",
      ownerImage: "https://example.com/avatar.png",
    };
    const result = digestToOwnerInfo(digest);
    expect(result).not.toBeNull();
    expect(result!.ownerHandle).toBe("users:owner");
    expect(result!.owner).toEqual({
      _id: "publishers:missing",
      _creationTime: 0,
      kind: "user",
      handle: "users:owner",
      displayName: "No Handle",
      image: "https://example.com/avatar.png",
      bio: undefined,
      linkedUserId: "users:owner",
    });
  });

  it("returns null owner for deactivated user (empty handle, no profile data)", () => {
    const digest = {
      ownerUserId: "users:deactivated" as never,
      ownerHandle: "",
      ownerName: undefined,
      ownerDisplayName: undefined,
      ownerImage: undefined,
    };
    const result = digestToOwnerInfo(digest);
    expect(result).not.toBeNull();
    expect(result!.ownerHandle).toBe("users:deactivated");
    expect(result!.owner).toBeNull();
  });
});
