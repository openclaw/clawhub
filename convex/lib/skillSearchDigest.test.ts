/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import { extractDigestFields, digestToOwnerInfo } from "./skillSearchDigest";

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
    expect(digest.statsDownloads).toBe(42);
    expect(digest.statsStars).toBe(5);
    expect(digest.statsInstallsCurrent).toBe(10);
    expect(digest.statsInstallsAllTime).toBe(100);
    expect(digest.stats).toEqual({
      downloads: 42,
      installsCurrent: 10,
      installsAllTime: 100,
      stars: 5,
      versions: 3,
      comments: 1,
    });
    expect(digest.moderationFlags).toEqual(["flagged.test"]);
    expect(digest.isSuspicious).toBe(false);
    expect(digest.createdAt).toBe(1000);
    expect(digest.updatedAt).toBe(2000);
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
