/* @vitest-environment node */
import { describe, expect, it } from "vitest";
import {
  hasPriorApprovedPublicSkillVersion,
  isPubliclyListableSkillVersion,
  isSkillPendingPublicReview,
  resolvePublicBrowseVersionForSkill,
  shouldExcludeSkillFromPublicBrowse,
} from "./publicBrowse";

const emptyStats = {
  versions: 1,
  downloads: 0,
  stars: 0,
  installsCurrent: 0,
  installsAllTime: 0,
  comments: 0,
};

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
        latestVersionId: "skillVersions:1" as never,
        githubScanStatus: "clean",
        stats: emptyStats,
      }),
    ).toBe(true);
  });

  it("keeps previously approved skills visible while a newer version is pending review", () => {
    expect(
      hasPriorApprovedPublicSkillVersion({
        stats: { ...emptyStats, versions: 2 },
      }),
    ).toBe(true);
    expect(
      shouldExcludeSkillFromPublicBrowse({
        softDeletedAt: undefined,
        moderationStatus: "active",
        moderationReason: "pending.scan",
        moderationFlags: undefined,
        moderationVerdict: "clean",
        moderationSourceVersionId: "skillVersions:2" as never,
        latestVersionId: "skillVersions:2" as never,
        githubScanStatus: "clean",
        stats: { ...emptyStats, versions: 2 },
      }),
    ).toBe(false);
  });

  it("rejects pending-review skill versions from public listing", () => {
    expect(
      isPubliclyListableSkillVersion({
        _id: "skillVersions:pending" as never,
        skillId: "skills:1" as never,
        softDeletedAt: undefined,
        version: "2.0.0",
        createdAt: 1,
        changelog: "c",
        changelogSource: "user",
        parsed: { frontmatter: {}, license: "MIT-0" },
        vtAnalysis: { status: "pending", checkedAt: 1 },
        llmAnalysis: undefined,
        staticScan: undefined,
      }),
    ).toBe(false);
  });

  it("resolves the last approved version while a newer version is pending review", async () => {
    const approvedVersion = {
      _id: "skillVersions:approved" as never,
      skillId: "skills:1" as never,
      softDeletedAt: undefined,
      version: "1.0.0",
      createdAt: 1,
      changelog: "approved",
      changelogSource: "user" as const,
      parsed: { frontmatter: {}, license: "MIT-0" as const },
      vtAnalysis: { status: "clean" as const, checkedAt: 1 },
      llmAnalysis: { status: "clean" as const, checkedAt: 1 },
      staticScan: {
        status: "clean" as const,
        reasonCodes: [],
        findings: [],
        summary: "",
        engineVersion: "v1",
        checkedAt: 1,
      },
    };
    const pendingVersion = {
      _id: "skillVersions:pending" as never,
      skillId: "skills:1" as never,
      softDeletedAt: undefined,
      version: "2.0.0",
      createdAt: 2,
      changelog: "pending",
      changelogSource: "user" as const,
      parsed: { frontmatter: {}, license: "MIT-0" as const },
      vtAnalysis: { status: "pending" as const, checkedAt: 2 },
    };

    const version = await resolvePublicBrowseVersionForSkill(
      {
        db: {
          get: async (id: string) => {
            if (id === "skills:1") {
              return {
                _id: "skills:1" as never,
                latestVersionId: "skillVersions:pending" as never,
                moderationSourceVersionId: "skillVersions:pending" as never,
                moderationStatus: "active",
                moderationReason: "pending.scan",
                moderationFlags: undefined,
                stats: { ...emptyStats, versions: 2 },
              };
            }
            if (id === "skillVersions:pending") return pendingVersion;
            return null;
          },
          query: () => ({
            withIndex: () => ({
              order: () => ({
                take: async () => [pendingVersion, approvedVersion],
              }),
            }),
          }),
        },
      } as never,
      {
        _id: "skills:1" as never,
        latestVersionId: "skillVersions:pending" as never,
        moderationSourceVersionId: "skillVersions:pending" as never,
        moderationStatus: "active",
        moderationReason: "pending.scan",
        moderationFlags: undefined,
        stats: { ...emptyStats, versions: 2 },
        softDeletedAt: undefined,
        moderationVerdict: "clean",
        githubScanStatus: "clean",
      },
    );

    expect(version?._id).toBe("skillVersions:approved");
    expect(version?.version).toBe("1.0.0");
  });
});
