import { describe, expect, it } from "vitest";
import { collectAttentionItems } from "./dashboardAttention";
import type { DashboardPackage, DashboardSkill } from "./types";

function createSkill(overrides?: Partial<DashboardSkill>): DashboardSkill {
  return {
    _id: "skills:a",
    _creationTime: 1,
    slug: "alpha",
    displayName: "Alpha",
    summary: "Alpha skill",
    ownerUserId: "users:local",
    ownerPublisherId: "publishers:local",
    canonicalSkillId: null,
    forkOf: null,
    latestVersionId: null,
    tags: {},
    badges: {},
    stats: {
      downloads: 10,
      installsCurrent: 4,
      installsAllTime: 12,
      stars: 0,
      versions: 1,
    },
    moderationStatus: "active",
    moderationReason: null,
    moderationVerdict: null,
    moderationFlags: [],
    isSuspicious: false,
    createdAt: 1,
    updatedAt: 100,
    ownerPath: "local",
    latestVersion: {
      version: "1.0.0",
      createdAt: 1,
      vtStatus: "clean",
      llmStatus: "clean",
      staticScanStatus: "clean",
    },
    ...overrides,
  } as DashboardSkill;
}

function createPackage(overrides?: Partial<DashboardPackage>): DashboardPackage {
  return {
    _id: "packages:b",
    name: "beta-plugin",
    displayName: "Beta Plugin",
    family: "code-plugin",
    channel: "community",
    isOfficial: false,
    updatedAt: 200,
    stats: { downloads: 50, installs: 20, stars: 0, versions: 1 },
    latestRelease: {
      version: "1.0.0",
      createdAt: 1,
      vtStatus: "clean",
      llmStatus: "clean",
      staticScanStatus: "clean",
    },
    ...overrides,
  };
}

describe("collectAttentionItems", () => {
  it("links skill security attention to the security audit page with moderation preview", () => {
    const items = collectAttentionItems(
      [
        createSkill({
          isSuspicious: true,
          moderationFlags: ["flagged.suspicious"],
          moderationVerdict: "suspicious",
          moderationSummary: "Suspicious: prompt injection pattern in SKILL.md",
          latestVersion: {
            version: "1.0.0",
            createdAt: 1,
            vtStatus: "suspicious",
            llmStatus: "suspicious",
            staticScanStatus: "suspicious",
          },
        }),
      ],
      [],
      "local",
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      href: "/local/skills/alpha/security-audit",
      actionLabel: "Review security →",
      issueType: "security",
      preview: "Suspicious: prompt injection pattern in SKILL.md",
      reason: "Needs security review",
    });
  });

  it("links plugin validation attention to the validation tab with finding preview", () => {
    const items = collectAttentionItems(
      [],
      [
        createPackage({
          inspectorWarningCount: 2,
          topInspectorFinding: {
            message: "package min host version drift",
            remediation: "Bump openclaw.minHostVersion in package.json",
          },
        }),
      ],
      "local",
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      href: "/plugins/beta-plugin#validation",
      actionLabel: "View validation →",
      issueType: "validation",
      preview: "Package min host version drift. Fix: Bump openclaw.minHostVersion in package.json",
      reason: "2 validation warnings",
    });
  });

  it("links blocked plugins to the security audit page", () => {
    const items = collectAttentionItems(
      [],
      [
        createPackage({
          scanStatus: "malicious",
          latestRelease: {
            version: "1.0.0",
            createdAt: 1,
            vtStatus: "malicious",
            llmStatus: "malicious",
            staticScanStatus: "malicious",
          },
        }),
      ],
      "local",
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      href: "/local/plugins/beta-plugin/security-audit",
      actionLabel: "Review security →",
      issueType: "security",
      reason: "Blocked by security checks",
    });
  });

  it("keeps validation and security issues distinct for the same plugin", () => {
    const items = collectAttentionItems(
      [],
      [
        createPackage({
          inspectorWarningCount: 1,
          topInspectorFinding: {
            message: "deprecated hook",
            remediation: "Replace the deprecated hook",
          },
          scanStatus: "suspicious",
          latestRelease: {
            version: "1.0.0",
            createdAt: 1,
            vtStatus: "suspicious",
            llmStatus: "suspicious",
            staticScanStatus: "suspicious",
          },
        }),
      ],
      "local",
    );

    expect(items).toHaveLength(2);
    expect(
      items.map(({ issueType, actionLabel, href }) => ({ issueType, actionLabel, href })),
    ).toEqual([
      {
        issueType: "validation",
        actionLabel: "View validation →",
        href: "/plugins/beta-plugin#validation",
      },
      {
        issueType: "security",
        actionLabel: "Review security →",
        href: "/local/plugins/beta-plugin/security-audit",
      },
    ]);
  });

  it("keeps remediation visible when a validation finding is long", () => {
    const items = collectAttentionItems(
      [],
      [
        createPackage({
          inspectorWarningCount: 1,
          topInspectorFinding: {
            message:
              "legacy before_agent_start hook is deprecated for the current OpenClaw plugin API and will stop working in a future release",
            remediation: "Replace the legacy before_agent_start hook with current prompt hooks",
          },
        }),
      ],
      "local",
    );

    expect(items[0]?.preview).toBe(
      "Deprecated before_agent_start hook. Fix: Replace with current prompt hooks.",
    );
    expect(items[0]?.preview?.length).toBeLessThanOrEqual(140);
  });

  it("hides internal scanner identifiers from the attention preview", () => {
    const items = collectAttentionItems(
      [
        createSkill({
          moderationVerdict: "malicious",
          moderationSummary: "Malicious: malicious.llm_malicious",
          latestVersion: {
            version: "1.0.0",
            createdAt: 1,
            vtStatus: "malicious",
            llmStatus: "malicious",
            staticScanStatus: "malicious",
          },
        }),
      ],
      [],
      "local",
    );

    expect(items[0]?.preview).toBe("Security scan classified this version as malicious.");
  });
});
