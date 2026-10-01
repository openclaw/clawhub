import { describe, expect, it } from "vitest";
import type { Doc } from "../_generated/dataModel";
import {
  ACTIVATE_SKILLS_SH_PUBLIC_PRODUCTION_CONFIRM,
  ACTIVATE_SKILLS_SH_PUBLIC_TEST_CONFIRM,
  assertSkillsShPublicVisibilityMutationAllowed,
  isSkillsShMirrorDigestEligible,
  skillsShMirrorFreshObservationFlags,
  skillsShMirrorPublicationFlags,
} from "./skillsShPublicVisibility";

function testEnv(environment: "test" | "production") {
  return {
    CLAWHUB_DEPLOYMENT_NAME: environment === "test" ? "academic-chihuahua-392" : "wry-manatee-359",
    CLAWHUB_ENV: environment,
    CLAWHUB_SKILLS_SH_ROLLOUT_MODE: environment,
  };
}

function digest(
  overrides: Partial<Doc<"skillsShMirrorDigests">> = {},
): Doc<"skillsShMirrorDigests"> {
  return {
    _id: "digest-id" as Doc<"skillsShMirrorDigests">["_id"],
    _creationTime: 1,
    externalId: "patrick-erichsen/skills/html",
    sourceType: "github",
    owner: "patrick-erichsen",
    repo: "skills",
    slug: "html",
    normalizedSlug: "html",
    normalizedSlugFirstToken: "html",
    displayName: "HTML",
    normalizedDisplayName: "html",
    normalizedDisplayNameFirstToken: "html",
    searchText: "html",
    sourceUrl: "https://www.skills.sh/patrick-erichsen/skills/html",
    canonicalRepoUrl: "https://github.com/patrick-erichsen/skills",
    githubPath: "skills/html",
    githubCommit: "050daba89f6b6636470add5cb300aac46a412cf8",
    sourceContentHash: "a47adb2c1ac33c088f664b5187971b63d2b958a7b9f01516d26005ca941a108f",
    upstreamInstalls: 1,
    upstreamScanners: {
      genAgentTrustHub: { status: "pass" },
      socket: { status: "pass" },
      snyk: { status: "pass" },
    },
    sourceFreshnessStatus: "observed-only",
    detailStatus: "available",
    observationFingerprint: "{}",
    sourceSnapshotId: "snapshot",
    lastObservedRunId: "run-id" as Doc<"skillsShMirrorRuns">["_id"],
    active: true,
    publicVisible: false,
    installable: false,
    firstObservedAt: 1,
    lastObservedAt: 1,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("skills.sh public visibility policy", () => {
  it("allows the same activation path in Test and production rollout modes", () => {
    expect(
      assertSkillsShPublicVisibilityMutationAllowed({
        activate: true,
        confirm: ACTIVATE_SKILLS_SH_PUBLIC_TEST_CONFIRM,
        env: testEnv("test"),
      }),
    ).toBe("test");
    expect(
      assertSkillsShPublicVisibilityMutationAllowed({
        activate: true,
        confirm: ACTIVATE_SKILLS_SH_PUBLIC_PRODUCTION_CONFIRM,
        env: testEnv("production"),
      }),
    ).toBe("production");
  });

  it("rejects production while the production rollout is off", () => {
    expect(() =>
      assertSkillsShPublicVisibilityMutationAllowed({
        activate: true,
        confirm: ACTIVATE_SKILLS_SH_PUBLIC_PRODUCTION_CONFIRM,
        env: {
          ...testEnv("production"),
          CLAWHUB_SKILLS_SH_ROLLOUT_MODE: "off",
        },
      }),
    ).toThrow("skills.sh catalog rollout is disabled");
  });

  it("requires the environment-specific confirmation phrase", () => {
    expect(() =>
      assertSkillsShPublicVisibilityMutationAllowed({
        activate: true,
        confirm: ACTIVATE_SKILLS_SH_PUBLIC_PRODUCTION_CONFIRM,
        env: testEnv("test"),
      }),
    ).toThrow("confirmation is invalid");
  });
});

describe("skills.sh public visibility eligibility", () => {
  it("accepts an active exact pinned GitHub source", () => {
    expect(isSkillsShMirrorDigestEligible(digest())).toBe(true);
    expect(skillsShMirrorPublicationFlags(digest())).toEqual({
      publicVisible: true,
      installable: true,
    });
  });

  it.each([
    { active: false },
    { sourceFreshnessStatus: "stale" as const },
    { tombstonedAt: 1 },
    { githubPath: undefined },
    { githubCommit: undefined },
    { sourceContentHash: undefined },
  ])("rejects an unsafe or incomplete source: %o", (overrides) => {
    expect(isSkillsShMirrorDigestEligible(digest(overrides))).toBe(false);
  });

  it("keeps only the first pending claim visible", () => {
    expect(
      skillsShMirrorPublicationFlags(digest({ claimStatus: "pending", claimAttempt: 1 } as never)),
    ).toEqual({ publicVisible: true, installable: true });
    expect(
      skillsShMirrorPublicationFlags(digest({ claimStatus: "pending", claimAttempt: 2 } as never)),
    ).toEqual({ publicVisible: false, installable: false });
  });

  it.each(["failed", "promoted"] as const)(
    "keeps a %s claim out of the mirror catalog",
    (claimStatus) => {
      expect(
        skillsShMirrorPublicationFlags(digest({ claimStatus, claimAttempt: 1 } as never)),
      ).toEqual({ publicVisible: false, installable: false });
    },
  );

  it("does not reactivate failed, retrying, or promoted mirrors during import refresh", () => {
    expect(skillsShMirrorFreshObservationFlags(digest())).toEqual({
      active: true,
      publicVisible: true,
      installable: true,
    });
    for (const claim of [
      { claimStatus: "pending", claimAttempt: 2 },
      { claimStatus: "failed", claimAttempt: 1 },
      { claimStatus: "promoted", claimAttempt: 1 },
    ] as const) {
      expect(skillsShMirrorFreshObservationFlags(digest(claim as never))).toEqual({
        active: false,
        publicVisible: false,
        installable: false,
      });
    }
  });
});
