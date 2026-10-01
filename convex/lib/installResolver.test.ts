import { describe, expect, it } from "vitest";
import { buildSkillInstallResolution } from "./installResolver";

const baseSkill = {
  slug: "aiq-deploy",
  displayName: "AIQ Deploy",
  latestVersionSummary: null,
  installKind: "github" as const,
  githubPath: "skills/aiq-deploy",
  githubCurrentCommit: "1".repeat(40),
  githubCurrentContentHash: "hash-aiq-deploy",
  githubCurrentStatus: "present" as const,
  githubScanStatus: "clean" as const,
  githubRemovedAt: undefined,
};

const source = {
  repo: "NVIDIA/skills",
  defaultBranch: "main",
};

describe("buildSkillInstallResolution", () => {
  it("returns an archive descriptor for hosted direct uploads", () => {
    const resolution = buildSkillInstallResolution({
      origin: "https://clawhub.ai",
      skill: {
        slug: "direct-skill",
        displayName: "Direct Skill",
        latestVersionSummary: { version: "1.2.3" },
      },
      source: null,
    });

    expect(resolution).toEqual({
      ok: true,
      slug: "direct-skill",
      installKind: "archive",
      archive: {
        version: "1.2.3",
        downloadUrl: "https://clawhub.ai/api/v1/download?slug=direct-skill&version=1.2.3",
      },
    });
  });

  it("keeps ownerHandle in archive download URLs for scoped installs", () => {
    const resolution = buildSkillInstallResolution({
      origin: "https://clawhub.ai",
      skill: {
        slug: "direct-skill",
        displayName: "Direct Skill",
        latestVersionSummary: { version: "1.2.3" },
      },
      source: null,
      ownerHandle: "acme",
    });

    expect(resolution).toEqual({
      ok: true,
      slug: "direct-skill",
      installKind: "archive",
      archive: {
        version: "1.2.3",
        downloadUrl:
          "https://clawhub.ai/api/v1/download?slug=direct-skill&ownerHandle=acme&version=1.2.3",
      },
    });
  });

  it("returns a pinned GitHub descriptor when current upstream state is scan-clean", () => {
    const resolution = buildSkillInstallResolution({
      origin: "https://clawhub.ai",
      skill: baseSkill,
      source,
    });

    expect(resolution).toEqual({
      ok: true,
      slug: "aiq-deploy",
      installKind: "github",
      github: {
        repo: "NVIDIA/skills",
        path: "skills/aiq-deploy",
        commit: "1".repeat(40),
        contentHash: "hash-aiq-deploy",
        sourceUrl: `https://github.com/NVIDIA/skills/tree/${"1".repeat(40)}/skills/aiq-deploy`,
      },
    });
  });

  it("returns a pinned GitHub descriptor when current upstream state is scan-suspicious", () => {
    const resolution = buildSkillInstallResolution({
      origin: "https://clawhub.ai",
      skill: { ...baseSkill, githubScanStatus: "suspicious" },
      source,
    });

    expect(resolution).toMatchObject({
      ok: true,
      installKind: "github",
      github: {
        commit: "1".repeat(40),
        contentHash: "hash-aiq-deploy",
      },
    });
  });

  it("allows GitHub-backed installs when upstream content changed and the current hash is clean", () => {
    const resolution = buildSkillInstallResolution({
      origin: "https://clawhub.ai",
      skill: {
        ...baseSkill,
        githubCurrentCommit: "2".repeat(40),
        githubCurrentContentHash: "hash-aiq-deploy-v2",
      },
      source,
    });

    expect(resolution).toMatchObject({
      ok: true,
      installKind: "github",
      github: {
        commit: "2".repeat(40),
        contentHash: "hash-aiq-deploy-v2",
        sourceUrl: `https://github.com/NVIDIA/skills/tree/${"2".repeat(40)}/skills/aiq-deploy`,
      },
    });
  });

  it("allows GitHub-backed installs when only unrelated repository content changed", () => {
    const resolution = buildSkillInstallResolution({
      origin: "https://clawhub.ai",
      skill: {
        ...baseSkill,
        githubCurrentCommit: "2".repeat(40),
        githubCurrentContentHash: baseSkill.githubCurrentContentHash,
      },
      source,
    });

    expect(resolution).toMatchObject({
      ok: true,
      installKind: "github",
      github: {
        commit: "2".repeat(40),
        contentHash: "hash-aiq-deploy",
        sourceUrl: `https://github.com/NVIDIA/skills/tree/${"2".repeat(40)}/skills/aiq-deploy`,
      },
    });
  });

  it.each([
    {
      name: "upstream path is missing",
      patch: { githubCurrentStatus: "missing" as const },
      reason: "github_upstream_missing",
      status: 410,
    },
    {
      name: "skill was pulled upstream",
      patch: { githubRemovedAt: 456 },
      reason: "github_upstream_removed",
      status: 410,
    },
    {
      name: "scan is pending",
      patch: { githubScanStatus: "pending" as const },
      reason: "github_verification_pending",
      status: 423,
    },
    {
      name: "scan failed",
      patch: { githubScanStatus: "failed" as const },
      reason: "github_scan_failed",
      status: 403,
    },
    {
      name: "scan is malicious",
      patch: { githubScanStatus: "malicious" as const },
      reason: "github_scan_failed",
      status: 403,
    },
  ])("blocks GitHub-backed installs when $name", ({ patch, reason, status }) => {
    const resolution = buildSkillInstallResolution({
      origin: "https://clawhub.ai",
      skill: { ...baseSkill, ...patch },
      source,
    });

    expect(resolution).toMatchObject({
      ok: false,
      slug: "aiq-deploy",
      reason,
      status,
    });
  });

  it("explains pending GitHub-backed verification clearly", () => {
    const resolution = buildSkillInstallResolution({
      origin: "https://clawhub.ai",
      skill: {
        ...baseSkill,
        githubScanStatus: "pending",
      },
      source,
    });

    expect(resolution).toMatchObject({
      ok: false,
      slug: "aiq-deploy",
      reason: "github_verification_pending",
      status: 423,
      message:
        "GitHub-backed skill security scan is in progress. Try again shortly, or rerun with --force-install to install the unverified upstream commit.",
    });
  });

  it("allows force-install for pending GitHub-backed verification", () => {
    const resolution = buildSkillInstallResolution({
      origin: "https://clawhub.ai",
      skill: {
        ...baseSkill,
        githubScanStatus: "pending",
      },
      source,
      forceInstall: true,
    });

    expect(resolution).toMatchObject({
      ok: true,
      installKind: "github",
      github: {
        commit: "1".repeat(40),
        contentHash: "hash-aiq-deploy",
      },
    });
  });

  it("does not force-install failed GitHub-backed scans", () => {
    const resolution = buildSkillInstallResolution({
      origin: "https://clawhub.ai",
      skill: {
        ...baseSkill,
        githubScanStatus: "failed",
      },
      source,
      forceInstall: true,
    });

    expect(resolution).toMatchObject({
      ok: false,
      reason: "github_scan_failed",
      status: 403,
    });
  });
});
