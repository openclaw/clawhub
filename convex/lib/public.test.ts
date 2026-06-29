import { describe, expect, it } from "vitest";
import type { Doc } from "../_generated/dataModel";
import { toPublicPublisher, toPublicSkill } from "./public";

function makeSkill(overrides: Partial<Doc<"skills">> = {}): Doc<"skills"> {
  return {
    _id: "skills:1" as Doc<"skills">["_id"],
    _creationTime: 1,
    slug: "demo",
    displayName: "Demo",
    summary: "Demo summary",
    ownerUserId: "users:1" as Doc<"skills">["ownerUserId"],
    canonicalSkillId: undefined,
    forkOf: undefined,
    latestVersionId: undefined,
    tags: {},
    badges: {},
    moderationStatus: "active",
    moderationReason: undefined,
    moderationNotes: undefined,
    moderationFlags: undefined,
    hiddenAt: undefined,
    lastReviewedAt: undefined,
    softDeletedAt: undefined,
    reportCount: 0,
    lastReportedAt: undefined,
    quality: undefined,
    statsDownloads: 0,
    statsStars: 0,
    statsInstallsCurrent: 0,
    statsInstallsAllTime: 0,
    stats: {
      downloads: 0,
      installsCurrent: 0,
      installsAllTime: 0,
      stars: 0,
      versions: 0,
      comments: 0,
    },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as Doc<"skills">;
}

describe("public skill mapping", () => {
  it("normalizes stats when legacy skill record is missing stats object", () => {
    const legacySkill = makeSkill({
      stats: undefined as unknown as Doc<"skills">["stats"],
      statsDownloads: 12,
      statsStars: 3,
      statsInstallsCurrent: 5,
      statsInstallsAllTime: 7,
    });

    const mapped = toPublicSkill(legacySkill);

    expect(mapped).not.toBeNull();
    expect(mapped?.stats).toEqual({
      downloads: 12,
      stars: 3,
      installs: 7,
      versions: 0,
      comments: 0,
    });
  });

  it("exposes GitHub-backed skill source fields", () => {
    const mapped = toPublicSkill(
      makeSkill({
        installKind: "github",
        githubPath: "skills/demo",
        githubCurrentCommit: "a".repeat(40),
      }),
    );

    expect(mapped).toMatchObject({
      installKind: "github",
      githubPath: "skills/demo",
      githubCurrentCommit: "a".repeat(40),
    });
  });

  it("returns skill when moderationStatus is active", () => {
    const skill = makeSkill({ moderationStatus: "active" });
    expect(toPublicSkill(skill)).not.toBeNull();
  });

  it("filters out skill when moderationStatus is hidden", () => {
    const skill = makeSkill({ moderationStatus: "hidden" });
    expect(toPublicSkill(skill)).toBeNull();
  });

  it("returns skill when moderationStatus is undefined (legacy)", () => {
    const skill = makeSkill({ moderationStatus: undefined });
    expect(toPublicSkill(skill)).not.toBeNull();
  });

  it("filters out soft-deleted skills", () => {
    const skill = makeSkill({ softDeletedAt: Date.now() });
    expect(toPublicSkill(skill)).toBeNull();
  });

  it("filters out skills with blocked.malware flag", () => {
    const skill = makeSkill({
      moderationStatus: "active",
      moderationFlags: ["blocked.malware"],
    });
    expect(toPublicSkill(skill)).toBeNull();
  });

  it("filters out skills with a malicious moderation verdict", () => {
    const skill = makeSkill({
      moderationStatus: "active",
      moderationVerdict: "malicious",
    });
    expect(toPublicSkill(skill)).toBeNull();
  });
});

describe("public publisher mapping", () => {
  it("exposes official publisher status only when supplied by the caller", () => {
    const publisher = {
      _id: "publishers:openclaw",
      _creationTime: 1,
      kind: "org",
      handle: "openclaw",
      displayName: "OpenClaw",
      createdAt: 1,
      updatedAt: 1,
    } as Doc<"publishers">;

    expect(toPublicPublisher(publisher)).not.toHaveProperty("official");
    expect(toPublicPublisher(publisher, { official: true })?.official).toBe(true);
  });
});
