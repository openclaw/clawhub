/* @vitest-environment node */
import { describe, expect, it } from "vitest";
import {
  hasPriorApprovedPublicSkillVersion,
  isPubliclyListableSkillVersion,
  isSkillPendingPublicReview,
  shouldExcludeSkillFromPublicBrowse,
} from "./publicBrowse";

describe("publicBrowse", () => {
  it("treats scanner review flags as pending public review", () => {
    expect(
      isSkillPendingPublicReview({
        moderationStatus: "active",
        moderationReason: "scanner.llm.review",
        moderationFlags: ["flagged.review"],
      }),
    ).toBe(true);
  });

  it("treats active pending.scan skills as pending public review", () => {
    expect(
      isSkillPendingPublicReview({
        moderationStatus: "active",
        moderationReason: "pending.scan",
        moderationFlags: undefined,
      }),
    ).toBe(true);
  });

  it("excludes first-publish pending review skills from public browse", () => {
    expect(
      shouldExcludeSkillFromPublicBrowse({
        softDeletedAt: undefined,
        moderationStatus: "active",
        moderationReason: "pending.scan",
        moderationFlags: undefined,
        moderationVerdict: "clean",
        moderationSourceVersionId: undefined,
        latestVersionId: "skillVersions:1",
        githubScanStatus: "clean",
        stats: {
          versions: 1,
          downloads: 0,
          stars: 0,
          installsCurrent: 0,
          installsAllTime: 0,
          comments: 0,
        },
      }),
    ).toBe(true);
  });

  it("keeps previously approved skills visible while a newer version is pending review", () => {
    expect(
      hasPriorApprovedPublicSkillVersion({
        stats: {
          versions: 2,
          downloads: 0,
          stars: 0,
          installsCurrent: 0,
          installsAllTime: 0,
          comments: 0,
        },
      }),
    ).toBe(true);
    expect(
      shouldExcludeSkillFromPublicBrowse({
        softDeletedAt: undefined,
        moderationStatus: "active",
        moderationReason: "pending.scan",
        moderationFlags: undefined,
        moderationVerdict: "clean",
        moderationSourceVersionId: "skillVersions:2",
        latestVersionId: "skillVersions:2",
        githubScanStatus: "clean",
        stats: {
          versions: 2,
          downloads: 0,
          stars: 0,
          installsCurrent: 0,
          installsAllTime: 0,
          comments: 0,
        },
      }),
    ).toBe(false);
  });

  it("rejects pending-review skill versions from public listing", () => {
    expect(
      isPubliclyListableSkillVersion({
        _id: "skillVersions:pending",
        skillId: "skills:1",
        softDeletedAt: undefined,
        version: "2.0.0",
        createdAt: 1,
        changelog: "c",
        changelogSource: "user",
        parsed: { frontmatter: {}, license: "MIT" },
        vtAnalysis: { status: "pending", checkedAt: 1 },
        llmAnalysis: undefined,
        staticScan: undefined,
      }),
    ).toBe(false);
  });
});
