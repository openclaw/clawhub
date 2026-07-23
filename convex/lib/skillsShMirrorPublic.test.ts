import { describe, expect, it } from "vitest";
import {
  buildSkillsShMirrorCatalogDetail,
  buildSkillsShMirrorIdentity,
  buildSkillsShMirrorSearchResult,
  buildUnclaimedSkillsShInstallResolution,
  buildUnclaimedSkillsShVerifyResponse,
  SKILLS_SH_UNSCANNED_LABEL,
  type SkillsShMirrorDigest,
  type SkillsShMirrorDetail,
} from "./skillsShMirrorPublic";

const digest: SkillsShMirrorDigest = {
  externalId: "patrick-erichsen/skills/html",
  sourceType: "github",
  owner: "patrick-erichsen",
  repo: "skills",
  slug: "html",
  displayName: "HTML Artifact Chooser",
  sourceUrl: "https://skills.sh/patrick-erichsen/skills/html",
  canonicalRepoUrl: "https://github.com/patrick-erichsen/skills",
  githubPath: "skills/html",
  githubCommit: "050daba89f6b6636470add5cb300aac46a412cf8",
  sourceContentHash: "a47adb2c1ac33c088f664b5187971b63d2b958a7b9f01516d26005ca941a108f",
  upstreamInstalls: 100,
  upstreamScanners: {
    genAgentTrustHub: { status: "unavailable" },
    socket: {
      status: "pass",
      sourceCheckedAt: "2026-07-22T20:00:00.000Z",
      sourceUrl: "https://www.skills.sh/patrick-erichsen/skills/html/security/socket",
    },
    snyk: { status: "warning" },
  },
  inferredCategories: ["development"],
  inferredTopics: ["html"],
  inferredCategoryConfidence: "high",
  inferredTopicConfidence: "medium",
  inferredClassifierVersion: "taxonomy-prototype-v9",
  inferredTopicClassifierVersion: "topic-prototype-v1",
  inferredInputHash: "category-input",
  inferredTopicInputHash: "topic-input",
  inferredAt: 122,
  sourceFreshnessStatus: "observed-only",
  detailStatus: "available",
  active: true,
  publicVisible: false,
  installable: false,
  lastObservedAt: 123,
};

describe("skills.sh mirror public contract", () => {
  it("normalizes the exact colon reference without changing repository identity", () => {
    expect(buildSkillsShMirrorIdentity(digest)).toEqual({
      owner: "patrick-erichsen",
      repo: "skills",
      slug: "html",
      externalId: "patrick-erichsen/skills/html",
      route: "/skills-sh/patrick-erichsen/skills/html",
      reference: "skills-sh:patrick-erichsen/skills/html",
    });
  });

  it("builds an immutable unscanned GitHub install resolution", () => {
    expect(buildUnclaimedSkillsShInstallResolution(digest)).toEqual({
      ok: true,
      slug: "skills-sh:patrick-erichsen/skills/html",
      installKind: "github",
      github: {
        repo: "patrick-erichsen/skills",
        path: "skills/html",
        commit: "050daba89f6b6636470add5cb300aac46a412cf8",
        contentHash: "a47adb2c1ac33c088f664b5187971b63d2b958a7b9f01516d26005ca941a108f",
        sourceUrl:
          "https://github.com/patrick-erichsen/skills/tree/050daba89f6b6636470add5cb300aac46a412cf8/skills/html",
      },
      provenance: {
        source: "skills.sh",
        reference: "skills-sh:patrick-erichsen/skills/html",
      },
      trust: {
        clawhubScan: "unscanned",
        label: SKILLS_SH_UNSCANNED_LABEL,
      },
      canonicalRef: null,
    });
  });

  it("maps only stored mirror digest and bounded detail fields", () => {
    const detail: SkillsShMirrorDetail = {
      externalId: digest.externalId,
      contentKind: "skill-md",
      path: "skills/html/SKILL.md",
      content: "# HTML",
      contentBytes: 6,
      sourceBytes: 6,
      sourceFileCount: 1,
      truncated: false,
      sourceContentHash: digest.sourceContentHash,
      updatedAt: 123,
    };

    expect(buildSkillsShMirrorSearchResult(digest)).toEqual({
      source: "skills.sh",
      externalId: "patrick-erichsen/skills/html",
      route: "/skills-sh/patrick-erichsen/skills/html",
      reference: "skills-sh:patrick-erichsen/skills/html",
      owner: "patrick-erichsen",
      repo: "skills",
      slug: "html",
      displayName: "HTML Artifact Chooser",
      categories: ["development"],
      topics: ["html"],
      upstreamInstalls: 100,
      lastObservedAt: 123,
    });
    expect(buildSkillsShMirrorCatalogDetail({ digest, detail })).toMatchObject({
      sourceUrl: "https://skills.sh/patrick-erichsen/skills/html",
      upstreamChecks: [
        {
          scanner: "Gen Agent Trust Hub",
          status: "unavailable",
          sourceStatus: "unavailable",
        },
        {
          scanner: "Socket",
          status: "passed",
          sourceStatus: "pass",
          checkedAt: Date.parse("2026-07-22T20:00:00.000Z"),
          url: "https://www.skills.sh/patrick-erichsen/skills/html/security/socket",
        },
        { scanner: "Snyk", status: "warning", sourceStatus: "warning" },
      ],
      content: {
        kind: "skill-md",
        path: "skills/html/SKILL.md",
        markdown: "# HTML",
        bytes: 6,
        truncated: false,
      },
    });
    expect(
      buildSkillsShMirrorCatalogDetail({
        digest,
        detail: { ...detail, sourceContentHash: "0".repeat(64) },
      }),
    ).toMatchObject({ content: null });
    expect(
      buildSkillsShMirrorCatalogDetail({
        digest,
        detail: { ...detail, sourceContentHash: undefined },
      }),
    ).toMatchObject({ content: null });
    expect(
      buildSkillsShMirrorCatalogDetail({
        digest: { ...digest, sourceContentHash: undefined },
        detail,
      }),
    ).toMatchObject({ content: null });
  });

  it("fails verification instead of presenting an unscanned listing as passed", () => {
    const result = buildUnclaimedSkillsShVerifyResponse({
      digest,
      origin: "https://clawhub.ai/",
    });

    expect(result).toMatchObject({
      ok: false,
      decision: "fail",
      reasons: [SKILLS_SH_UNSCANNED_LABEL],
      slug: "skills-sh:patrick-erichsen/skills/html",
      pageUrl: "https://clawhub.ai/skills-sh/patrick-erichsen/skills/html",
      provenance: {
        source: "skills.sh",
        reference: "skills-sh:patrick-erichsen/skills/html",
      },
      security: {
        passed: false,
        clawhubScan: "unscanned",
        label: SKILLS_SH_UNSCANNED_LABEL,
      },
    });
  });

  it("refuses incomplete, inactive, mismatched, and non-GitHub rows", () => {
    expect(buildUnclaimedSkillsShInstallResolution({ ...digest, active: false })).toBeNull();
    expect(
      buildUnclaimedSkillsShInstallResolution({
        ...digest,
        upstreamScanners: {
          ...digest.upstreamScanners,
          socket: { status: "failed" },
        },
      }),
    ).not.toBeNull();
    expect(
      buildUnclaimedSkillsShInstallResolution({ ...digest, sourceContentHash: undefined }),
    ).toBeNull();
    expect(
      buildUnclaimedSkillsShInstallResolution({ ...digest, externalId: "other/repo/html" }),
    ).toBeNull();
    expect(
      buildUnclaimedSkillsShInstallResolution({
        ...digest,
        sourceType: "well-known",
        owner: undefined,
        repo: undefined,
        sourceHost: "example.com",
        externalId: "example.com/html",
      }),
    ).toBeNull();
  });

  it("rejects misleading GitHub paths and encodes valid path segments", () => {
    for (const githubPath of [
      "../other",
      "skills/../other",
      "skills\\other",
      "skills//other",
      "skills/./other",
      "skills/other?tab=readme",
      "skills/other#readme",
      "skills/\nother",
    ]) {
      expect(buildUnclaimedSkillsShInstallResolution({ ...digest, githubPath })).toBeNull();
    }

    expect(
      buildUnclaimedSkillsShInstallResolution({
        ...digest,
        githubPath: "skills/demo name",
      }),
    ).toMatchObject({
      github: {
        path: "skills/demo name",
        sourceUrl:
          "https://github.com/patrick-erichsen/skills/tree/050daba89f6b6636470add5cb300aac46a412cf8/skills/demo%20name",
      },
    });
  });
});
