import { describe, expect, it } from "vitest";
import {
  buildSkillsShMirrorCatalogDetail,
  buildSkillsShCanonicalGitHubRepo,
  buildSkillsShMirrorIdentity,
  buildUnclaimedSkillsShInstallResolution,
  buildUnclaimedSkillsShVerifyResponse,
  SKILLS_SH_UNSCANNED_LABEL,
  SKILLS_SH_UNSCANNED_STATE,
  type SkillsShMirrorDetail,
  type SkillsShMirrorDigest,
} from "./skillsShMirrorPublic";

const digest: SkillsShMirrorDigest = {
  externalId: "patrick-erichsen/skills/html",
  sourceType: "github",
  owner: "patrick-erichsen",
  repo: "skills",
  slug: "html",
  displayName: "HTML Artifact Chooser",
  searchSummary: "Choose and build HTML artifacts.",
  sourceUrl: "https://skills.sh/patrick-erichsen/skills/html",
  canonicalRepoUrl: "https://github.com/patrick-erichsen/skills",
  githubPath: "skills/html",
  githubCommit: "050daba89f6b6636470add5cb300aac46a412cf8",
  sourceContentHash: "a47adb2c1ac33c088f664b5187971b63d2b958a7b9f01516d26005ca941a108f",
  upstreamInstalls: 100,
  upstreamScanners: {
    genAgentTrustHub: { status: "unavailable" },
    socket: { status: "pass", sourceCheckedAt: "2026-07-22T20:00:00.000Z" },
    snyk: { status: "warning" },
  },
  inferredCategories: ["development"],
  inferredTopics: ["html"],
  sourceFreshnessStatus: "observed-only",
  detailStatus: "available",
  active: true,
  publicVisible: true,
  installable: true,
  lastObservedAt: 123,
};

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

describe("skills.sh mirror public contract", () => {
  it("normalizes the exact colon reference", () => {
    expect(buildSkillsShMirrorIdentity(digest)?.reference).toBe(
      "skills-sh:patrick-erichsen/skills/html",
    );
  });

  it("builds an immutable unscanned GitHub install resolution", () => {
    expect(buildUnclaimedSkillsShInstallResolution(digest)).toEqual({
      ok: true,
      slug: "skills-sh:patrick-erichsen/skills/html",
      installKind: "github",
      github: {
        repo: "patrick-erichsen/skills",
        path: "skills/html",
        commit: digest.githubCommit,
        contentHash: digest.sourceContentHash,
        sourceUrl:
          "https://github.com/patrick-erichsen/skills/tree/050daba89f6b6636470add5cb300aac46a412cf8/skills/html",
      },
      provenance: {
        source: "skills.sh",
        reference: "skills-sh:patrick-erichsen/skills/html",
      },
      trust: {
        state: SKILLS_SH_UNSCANNED_STATE,
        clawhubScan: "unscanned",
        label: SKILLS_SH_UNSCANNED_LABEL,
      },
      canonicalRef: null,
    });
  });

  it("uses the canonical GitHub repository after an upstream redirect", () => {
    const redirected = {
      ...digest,
      canonicalRepoUrl: "https://github.com/openclaw/openclaw",
    };

    expect(buildSkillsShCanonicalGitHubRepo(redirected)).toBe("openclaw/openclaw");
    expect(buildUnclaimedSkillsShInstallResolution(redirected)).toMatchObject({
      github: { repo: "openclaw/openclaw" },
    });
    expect(buildSkillsShMirrorCatalogDetail({ digest: redirected, detail })).toMatchObject({
      canonicalGitHubRepo: "openclaw/openclaw",
      githubContentHash: digest.sourceContentHash,
    });
  });

  it("rejects non-GitHub canonical repository URLs", () => {
    expect(
      buildSkillsShCanonicalGitHubRepo({
        ...digest,
        canonicalRepoUrl: "https://example.com/openclaw/openclaw",
      }),
    ).toBeNull();
  });

  it("renders only content whose stored hash matches the digest", () => {
    expect(buildSkillsShMirrorCatalogDetail({ digest, detail })).toMatchObject({
      summary: "Choose and build HTML artifacts.",
      content: { path: "skills/html/SKILL.md", markdown: "# HTML" },
    });
    expect(
      buildSkillsShMirrorCatalogDetail({
        digest,
        detail: { ...detail, sourceContentHash: "0".repeat(64) },
      }),
    ).toMatchObject({ content: null });
  });

  it("fails verification explicitly for unscanned sources", () => {
    expect(
      buildUnclaimedSkillsShVerifyResponse({ digest, origin: "https://clawhub.ai/" }),
    ).toMatchObject({
      ok: false,
      decision: "fail",
      reasons: [SKILLS_SH_UNSCANNED_LABEL],
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

  it("refuses rows that are not activated, fresh, or complete", () => {
    expect(buildUnclaimedSkillsShInstallResolution({ ...digest, publicVisible: false })).toBeNull();
    expect(buildUnclaimedSkillsShInstallResolution({ ...digest, installable: false })).toBeNull();
    expect(
      buildUnclaimedSkillsShInstallResolution({ ...digest, sourceFreshnessStatus: "stale" }),
    ).toBeNull();
    expect(buildUnclaimedSkillsShInstallResolution({ ...digest, tombstonedAt: 1 })).toBeNull();
    expect(
      buildUnclaimedSkillsShInstallResolution({ ...digest, sourceContentHash: undefined }),
    ).toBeNull();
  });
});
