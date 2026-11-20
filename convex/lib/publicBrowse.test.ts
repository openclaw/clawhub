/* @vitest-environment node */
import { describe, expect, it } from "vitest";
import {
  hostedSkillMayHavePriorApprovedVersion,
  isHostedSkillPendingFirstPublicRelease,
  isPubliclyListableSkillVersion,
  isSkillPendingPublicReview,
  resolvePublicBrowseVersionState,
  resolvePublicBrowseVersionForSkill,
  shouldExcludeSkillFromPublicBrowse,
} from "./publicBrowse";
import {
  getPublicSkillFileAccessBlock,
  getSkillFileModerationInfoFromSkill,
} from "./skillFileAccess";

const emptyStats = {
  versions: 1,
  downloads: 0,
  stars: 0,
  installsCurrent: 0,
  installsAllTime: 0,
  comments: 0,
};

const browseFields = {
  softDeletedAt: undefined,
  moderationStatus: "active" as const,
  moderationFlags: undefined,
  moderationVerdict: "clean" as const,
  moderationSourceVersionId: undefined,
  latestVersionId: "skillVersions:1" as never,
  githubScanStatus: "clean" as const,
  stats: emptyStats,
};

describe("publicBrowse", () => {
  it.each(["pending", "blocked"] as const)(
    "excludes a benign %s publication",
    (publicationStatus) => {
      expect(
        isPubliclyListableSkillVersion({
          _id: "skillVersions:withheld" as never,
          skillId: "skills:1" as never,
          publicationStatus,
          version: "2.0.0",
          createdAt: 1,
          changelog: "withheld",
          parsed: { frontmatter: {} },
          llmAnalysis: { status: "clean", checkedAt: 1 },
        }),
      ).toBe(false);
    },
  );

  it("keeps review-only guidance publicly browsable", () => {
    expect(
      isSkillPendingPublicReview({
        moderationStatus: "active",
        moderationReason: "scanner.llm.review",
        moderationFlags: ["flagged.review"],
      }),
    ).toBe(false);
    expect(
      shouldExcludeSkillFromPublicBrowse({
        ...browseFields,
        moderationReason: "scanner.llm.review",
        moderationFlags: ["flagged.review"],
      }),
    ).toBe(false);
  });

  it.each([
    "pending.scan",
    "pending.scan.stale",
    "scanner.vt.pending",
    "scanner.llm.pending",
    "  PENDING.SCAN  ",
    "\tSCANNER.VT.PENDING\n",
  ])("keeps %s pending in browse and file-access policy", (moderationReason) => {
    const skill = {
      moderationStatus: "active" as const,
      moderationReason,
      moderationFlags: undefined,
    };
    expect(isSkillPendingPublicReview(skill)).toBe(true);

    const moderationInfo = getSkillFileModerationInfoFromSkill({
      ...skill,
      moderationStatus: "hidden",
    });
    expect(moderationInfo.isPendingScan).toBe(true);
    expect(getPublicSkillFileAccessBlock(moderationInfo)?.status).toBe(423);
  });

  it("excludes first-publish pending review skills from public browse", () => {
    expect(
      shouldExcludeSkillFromPublicBrowse({
        ...browseFields,
        moderationReason: "pending.scan",
      }),
    ).toBe(true);
    expect(
      isHostedSkillPendingFirstPublicRelease({
        installKind: undefined,
        moderationStatus: "active",
        moderationReason: "pending.scan",
        moderationFlags: undefined,
        stats: emptyStats,
      }),
    ).toBe(true);
  });

  it("keeps GitHub-backed pending verification visible in public browse", () => {
    expect(
      shouldExcludeSkillFromPublicBrowse({
        ...browseFields,
        installKind: "github",
        moderationReason: "pending.scan",
        githubScanStatus: "pending",
      }),
    ).toBe(false);
  });

  it("keeps previously approved hosted skills visible while a newer version is pending review", () => {
    expect(
      hostedSkillMayHavePriorApprovedVersion({
        installKind: undefined,
        stats: { ...emptyStats, versions: 2 },
      }),
    ).toBe(true);
    expect(
      shouldExcludeSkillFromPublicBrowse({
        ...browseFields,
        moderationReason: "pending.scan",
        moderationSourceVersionId: "skillVersions:2" as never,
        latestVersionId: "skillVersions:2" as never,
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
        llmAnalysis: { status: "pending", checkedAt: 1 },
      }),
    ).toBe(false);
  });

  it("ignores retired VirusTotal and static scan results when listing versions", () => {
    const version = {
      _id: "skillVersions:legacy" as never,
      skillId: "skills:1" as never,
      softDeletedAt: undefined,
      version: "1.0.0",
      createdAt: 1,
      changelog: "c",
      changelogSource: "user" as const,
      parsed: { frontmatter: {}, license: "MIT-0" as const },
      llmAnalysis: { status: "clean", checkedAt: 1 },
      // Historical rows may still carry retired scanner results.
      vtAnalysis: { status: "pending", checkedAt: 1 },
      staticScan: { status: "malicious" },
    };
    expect(isPubliclyListableSkillVersion(version as never)).toBe(true);
    expect(
      isPubliclyListableSkillVersion({
        ...version,
        llmAnalysis: { status: "malicious", checkedAt: 1 },
      } as never),
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
      llmAnalysis: { status: "clean" as const, checkedAt: 1 },
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
      llmAnalysis: { status: "pending" as const, checkedAt: 2 },
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
                take: async (limit: number) => {
                  expect(limit).toBe(2);
                  return [pendingVersion, approvedVersion];
                },
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

  it("projects the exact approved fallback version for digest readers", async () => {
    const pendingVersion = {
      _id: "skillVersions:pending" as never,
      skillId: "skills:1" as never,
      softDeletedAt: undefined,
      version: "2.0.0",
      createdAt: 2,
      changelog: "pending",
      changelogSource: "user" as const,
      parsed: { frontmatter: {}, license: "MIT-0" as const },
      llmAnalysis: { status: "pending" as const, checkedAt: 2 },
    };
    const approvedVersion = {
      ...pendingVersion,
      _id: "skillVersions:approved" as never,
      version: "1.0.0",
      createdAt: 1,
      llmAnalysis: { status: "clean" as const, checkedAt: 1 },
    };

    const state = await resolvePublicBrowseVersionState(
      {
        db: {
          get: async () => pendingVersion,
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
        latestVersionId: pendingVersion._id,
        moderationSourceVersionId: pendingVersion._id,
        moderationStatus: "active",
        moderationReason: "pending.scan",
        moderationFlags: undefined,
        stats: { ...emptyStats, versions: 2 },
        softDeletedAt: undefined,
        moderationVerdict: "clean",
        githubScanStatus: "clean",
      },
      { latestVersion: pendingVersion as never },
    );

    expect(state).toEqual({
      status: "available",
      versionId: "skillVersions:approved",
    });
  });

  it("projects an explicit unavailable state for hidden skills", async () => {
    const get = async () => {
      throw new Error("hidden skills must not read versions");
    };

    const state = await resolvePublicBrowseVersionState({ db: { get } } as never, {
      ...browseFields,
      _id: "skills:1" as never,
      moderationStatus: "hidden",
    });

    expect(state).toEqual({ status: "unavailable" });
  });

  it("does not skip past multiple pending hosted versions", async () => {
    const pendingV2 = {
      _id: "skillVersions:pending-2" as never,
      skillId: "skills:1" as never,
      softDeletedAt: undefined,
      version: "2.0.0",
      createdAt: 2,
      changelog: "pending",
      changelogSource: "user" as const,
      parsed: { frontmatter: {}, license: "MIT-0" as const },
      llmAnalysis: { status: "pending" as const, checkedAt: 2 },
    };
    const pendingV1 = {
      ...pendingV2,
      _id: "skillVersions:pending-1" as never,
      version: "1.0.0",
      createdAt: 1,
    };
    const olderApproved = {
      ...pendingV2,
      _id: "skillVersions:approved" as never,
      version: "0.9.0",
      createdAt: 0,
      llmAnalysis: { status: "clean" as const, checkedAt: 0 },
    };

    const version = await resolvePublicBrowseVersionForSkill(
      {
        db: {
          get: async () => null,
          query: () => ({
            withIndex: () => ({
              order: () => ({
                take: async (limit: number) =>
                  [pendingV2, pendingV1, olderApproved].slice(0, limit),
              }),
            }),
          }),
        },
      } as never,
      {
        _id: "skills:1" as never,
        latestVersionId: "skillVersions:pending-2" as never,
        moderationSourceVersionId: "skillVersions:pending-2" as never,
        moderationStatus: "active",
        moderationReason: "pending.scan",
        moderationFlags: undefined,
        stats: { ...emptyStats, versions: 2 },
        softDeletedAt: undefined,
        moderationVerdict: "clean",
        githubScanStatus: "clean",
      },
    );

    expect(version).toBeNull();
  });
});
