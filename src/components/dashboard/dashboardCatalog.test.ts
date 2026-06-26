import { describe, expect, it } from "vitest";
import {
  computeDashboardStats,
  excludeAttentionItems,
  filterByAttention,
  filterByKind,
  mergeDashboardItems,
  searchDashboardItems,
  sortDashboardItems,
} from "./dashboardCatalog";
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

describe("dashboardCatalog", () => {
  it("merges skills and plugins with aggregate stats", () => {
    const skills = [createSkill()];
    const packages = [createPackage()];

    expect(mergeDashboardItems(skills, packages)).toHaveLength(2);
    expect(computeDashboardStats(skills, packages)).toEqual({
      skillsCount: 1,
      pluginsCount: 1,
      totalInstalls: 32,
      totalDownloads: 60,
      needsAttentionCount: 0,
    });
  });

  it("filters, searches, and sorts catalog items", () => {
    const items = mergeDashboardItems(
      [createSkill({ updatedAt: 100 })],
      [
        createPackage({
          updatedAt: 200,
          stats: { downloads: 0, installs: 50, stars: 0, versions: 1 },
        }),
      ],
    );

    expect(filterByKind(items, "plugin")).toHaveLength(1);

    expect(searchDashboardItems(items, "beta")).toHaveLength(1);
    expect(searchDashboardItems(items, "beta")[0]?.kind).toBe("plugin");
    expect(searchDashboardItems(items, "")).toHaveLength(2);
    expect(searchDashboardItems(items, "nope")).toHaveLength(0);

    expect(sortDashboardItems(items, "updated", "desc")[0]?.kind).toBe("plugin");
    expect(sortDashboardItems(items, "installs", "desc")[0]?.kind).toBe("plugin");
    expect(sortDashboardItems(items, "installs", "asc")[0]?.kind).toBe("skill");
    expect(sortDashboardItems(items, "name", "asc")[0]?.name).toBe("Alpha");
    expect(sortDashboardItems(items, "name", "desc")[0]?.name).toBe("Beta Plugin");
  });

  it("filters catalog items that need attention", () => {
    const skills = [
      createSkill({
        moderationVerdict: "suspicious",
        isSuspicious: true,
        moderationFlags: ["flagged.suspicious"],
        latestVersion: {
          version: "1.0.0",
          createdAt: 1,
          vtStatus: "suspicious",
          llmStatus: "suspicious",
          staticScanStatus: "suspicious",
        },
      }),
      createSkill({
        _id: "skills:clean",
        slug: "clean",
        displayName: "Clean Skill",
      }),
    ];
    const packages = [
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
    ];
    const items = mergeDashboardItems(skills, packages);
    const attention = collectAttentionItems(skills, packages, "local");

    expect(filterByAttention(items, attention)).toHaveLength(2);
    expect(filterByAttention(items, attention).map((item) => item.name)).toEqual(
      expect.arrayContaining(["Alpha", "Beta Plugin"]),
    );
  });

  it("excludes attention items from the catalog list", () => {
    const skills = [
      createSkill({
        moderationVerdict: "suspicious",
        isSuspicious: true,
        moderationFlags: ["flagged.suspicious"],
        latestVersion: {
          version: "1.0.0",
          createdAt: 1,
          vtStatus: "suspicious",
          llmStatus: "suspicious",
          staticScanStatus: "suspicious",
        },
      }),
      createSkill({
        _id: "skills:clean",
        slug: "clean",
        displayName: "Clean Skill",
      }),
    ];
    const packages = [
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
    ];
    const items = mergeDashboardItems(skills, packages);
    const attention = collectAttentionItems(skills, packages, "local");

    expect(excludeAttentionItems(items, attention)).toHaveLength(1);
    expect(excludeAttentionItems(items, attention)[0]?.name).toBe("Clean Skill");
  });
});
