import { describe, expect, it } from "vitest";
import {
  makeDashboardPackage as createPackage,
  makeDashboardSkill as createSkill,
} from "../../__tests__/helpers/dashboard";
import { collectAttentionItems } from "./dashboardAttention";

describe("collectAttentionItems", () => {
  it.each([
    ["malicious", "blocked", "Blocked by security checks", "destructive", "Review security →"],
    ["pending", "pending-scan", "Waiting for security checks", "pending", "View progress →"],
    ["suspicious", "review", "Needs security review", "warning", "Review security →"],
  ] as const)(
    "preserves complete skill records for %s security and hidden visibility",
    (status, suffix, reason, severity, actionLabel) => {
      const skill = createSkill({
        moderationStatus: "hidden",
        moderationReason: status === "pending" ? "pending.scan" : undefined,
        moderationSummary: "Review this skill.",
        latestVersion: { version: "2.0.0-beta.1", createdAt: 3, llmStatus: status },
      });
      const items = collectAttentionItems([skill], [], "publisher");

      expect(items).toStrictEqual([
        {
          id: `skill:skills:a:${suffix}`,
          kind: "skill",
          slug: "alpha",
          ownerHandle: "publisher",
          version: "2.0.0-beta.1",
          updatedAt: 100,
          issueType: "security",
          title: "Alpha",
          reason,
          preview: "Review this skill.",
          severity,
          href: "/publisher/skills/alpha/security-audit",
          actionLabel,
        },
        {
          id: "skill:skills:a:visibility",
          kind: "skill",
          slug: "alpha",
          ownerHandle: "publisher",
          version: "2.0.0-beta.1",
          updatedAt: 100,
          issueType: "visibility",
          title: "Alpha",
          reason: "Hidden",
          severity: "warning",
          href: "/publisher/skills/alpha",
          actionLabel: "Open details →",
        },
      ]);
      expect(items[0]).not.toBe(items[1]);
      expect(items[1]).not.toHaveProperty("preview");
    },
  );

  it.each([
    ["malicious", "blocked", "Blocked by security checks", "destructive", "Review security →"],
    ["pending", "pending-scan", "Waiting for security checks", "pending", "View progress →"],
    ["suspicious", "review", "Needs security review", "warning", "Review security →"],
  ] as const)(
    "preserves complete package records and retirement/validation/security order for %s",
    (scanStatus, suffix, reason, severity, actionLabel) => {
      const apiRetirements = [
        { deprecatedApi: "oldApi", replacement: "newApi", removeAfter: "2026-12-31" },
      ];
      const pkg = createPackage({
        family: "template",
        name: "@publisher/hopper",
        displayName: "Hopper",
        scanStatus,
        latestRelease: { version: "0.2.0-beta.1", createdAt: 3, llmStatus: scanStatus },
        inspectorWarningCount: 1,
        apiRetirements,
      });
      const items = collectAttentionItems([], [pkg], "publisher");

      expect(items).toStrictEqual([
        {
          id: "plugin:packages:b:retirement",
          kind: "plugin",
          packageFamily: "template",
          packageName: "@publisher/hopper",
          ownerHandle: "publisher",
          version: "0.2.0-beta.1",
          updatedAt: 200,
          issueType: "retirement",
          apiRetirements,
          title: "Hopper",
          reason: "OpenClaw API update",
          preview: "Review replacement APIs and retirement dates.",
          severity: "info",
          href: "/publisher/plugins/hopper",
          actionLabel: "View API updates →",
        },
        {
          id: "plugin:packages:b:validation",
          kind: "plugin",
          packageFamily: "template",
          packageName: "@publisher/hopper",
          ownerHandle: "publisher",
          version: "0.2.0-beta.1",
          updatedAt: 200,
          issueType: "validation",
          title: "Hopper",
          reason: "1 validation warning",
          preview: undefined,
          severity: "warning",
          href: "/publisher/plugins/hopper#validation",
          actionLabel: "View validation →",
        },
        {
          id: `plugin:packages:b:${suffix}`,
          kind: "plugin",
          packageFamily: "template",
          packageName: "@publisher/hopper",
          ownerHandle: "publisher",
          version: "0.2.0-beta.1",
          updatedAt: 200,
          issueType: "security",
          title: "Hopper",
          reason,
          severity,
          href: "/publisher/templates/hopper/security-audit?version=0.2.0-beta.1",
          actionLabel,
        },
      ]);
      expect(items[0]?.apiRetirements).toBe(apiRetirements);
      expect(items[0]).not.toBe(items[1]);
      expect(items[1]).not.toBe(items[2]);
      expect(items[1]).not.toHaveProperty("apiRetirements");
      expect(items[2]).not.toHaveProperty("preview");
    },
  );

  it("retains missing versions and skill-before-package order without mutating input", () => {
    const skill = createSkill({
      latestVersion: null,
      moderationStatus: "removed",
      detailHref: "/original-owner/alpha",
    });
    const pkg = createPackage({ latestRelease: null, inspectorWarningCount: 1 });
    const before = structuredClone({ skill, pkg });
    const items = collectAttentionItems([skill], [pkg], "publisher");

    expect(items.map((item) => item.id)).toEqual([
      "skill:skills:a:visibility",
      "plugin:packages:b:validation",
    ]);
    expect(items[0]).toStrictEqual({
      id: "skill:skills:a:visibility",
      kind: "skill",
      slug: "alpha",
      ownerHandle: "publisher",
      version: undefined,
      updatedAt: 100,
      issueType: "visibility",
      title: "Alpha",
      reason: "Removed",
      severity: "destructive",
      href: "/original-owner/alpha",
      actionLabel: "Open details →",
    });
    expect(items[1]).toHaveProperty("version", undefined);
    expect(items[0]).not.toHaveProperty("packageFamily");
    expect(items[1]).not.toHaveProperty("slug");
    expect({ skill, pkg }).toStrictEqual(before);
  });

  it("does not reopen a release with a resolved clean scan for attention", () => {
    const pkg = createPackage({
      scanStatus: "clean",
      latestRelease: { version: "0.1.0-beta.3", createdAt: 1, llmStatus: "suspicious" },
    });
    expect(collectAttentionItems([], [pkg], "local")).toEqual([]);
  });

  it("routes template security review to the template audit page", () => {
    const items = collectAttentionItems(
      [],
      [createPackage({ family: "template", name: "@local/hopper", scanStatus: "malicious" })],
      "local",
    );
    expect(items[0]?.href).toBe("/local/templates/hopper/security-audit?version=1.0.0");
  });
  it("offers a separate informational API nudge without warning counts", () => {
    const apiRetirements = [
      { deprecatedApi: "oldApi", replacement: "newApi", removeAfter: "2026-12-31" },
    ];
    const items = collectAttentionItems([], [createPackage({ apiRetirements })], "local");
    expect(items).toEqual([
      expect.objectContaining({
        issueType: "retirement",
        severity: "info",
        apiRetirements,
        reason: "OpenClaw API update",
        href: "/plugins/beta-plugin",
      }),
    ]);
    const mixed = collectAttentionItems(
      [],
      [createPackage({ apiRetirements, inspectorWarningCount: 2 })],
      "local",
    );
    expect(mixed.find((item) => item.issueType === "validation")?.reason).toBe(
      "2 validation warnings",
    );
  });
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
            llmStatus: "suspicious",
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

  it("links blocked prereleases to their exact security audit", () => {
    const items = collectAttentionItems(
      [],
      [
        createPackage({
          scanStatus: "malicious",
          latestRelease: {
            version: "0.1.0-beta.3",
            createdAt: 1,
            llmStatus: "malicious",
          },
        }),
      ],
      "local",
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      version: "0.1.0-beta.3",
      href: "/local/plugins/beta-plugin/security-audit?version=0.1.0-beta.3",
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
            llmStatus: "suspicious",
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
        href: "/local/plugins/beta-plugin/security-audit?version=1.0.0",
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
            llmStatus: "malicious",
          },
        }),
      ],
      [],
      "local",
    );

    expect(items[0]?.preview).toBe("Security scan classified this version as malicious.");
  });
});
