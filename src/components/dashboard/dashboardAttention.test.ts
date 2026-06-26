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
      actionLabel: "Review →",
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
      actionLabel: "Review →",
      preview:
        "Package min host version drift. Fix: Bump openclaw.minHostVersion in package.json",
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
      actionLabel: "Review →",
      reason: "Blocked by security checks",
    });
  });
});
