import { describe, expect, it } from "vitest";
import {
  artifactDownloads,
  buildDownloadSeries,
  parseDownloadInsight,
  resolveDownloadInsight,
} from "./dashboardDownloadMetrics";
import type { DashboardPackage, DashboardSkill } from "./types";

function makeSkill(overrides: Partial<DashboardSkill> = {}): DashboardSkill {
  return {
    _id: "skill-1" as DashboardSkill["_id"],
    _creationTime: 0,
    slug: "demo-skill",
    displayName: "Demo Skill",
    summary: "",
    ownerUserId: "user-1" as DashboardSkill["ownerUserId"],
    ownerPath: "demo",
    updatedAt: Date.now() - 2 * 24 * 60 * 60 * 1000,
    stats: { downloads: 120, installsCurrent: 0, installsAllTime: 0, stars: 0, versions: 1 },
    ...overrides,
  } as DashboardSkill;
}

function makePackage(overrides: Partial<DashboardPackage> = {}): DashboardPackage {
  return {
    _id: "pkg-1",
    name: "demo-plugin",
    displayName: "Demo Plugin",
    family: "code-plugin",
    channel: "community",
    isOfficial: false,
    updatedAt: Date.now() - 5 * 24 * 60 * 60 * 1000,
    stats: { downloads: 40, installs: 0, stars: 0, versions: 1 },
    latestRelease: null,
    ...overrides,
  };
}

describe("parseDownloadInsight", () => {
  it("parses skill and plugin keys", () => {
    expect(parseDownloadInsight("skill:alpha")).toEqual({ scope: "skill", slug: "alpha" });
    expect(parseDownloadInsight("plugin:beta")).toEqual({ scope: "plugin", name: "beta" });
    expect(parseDownloadInsight(undefined)).toEqual({ scope: "all" });
    expect(parseDownloadInsight("all")).toEqual({ scope: "all" });
    expect(parseDownloadInsight("invalid")).toEqual({ scope: "all" });
  });
});

describe("resolveDownloadInsight", () => {
  const skills = [makeSkill()];
  const packages = [makePackage()];

  it("resolves a matching skill", () => {
    const result = resolveDownloadInsight({ scope: "skill", slug: "demo-skill" }, skills, packages);
    expect(result.missing).toBe(false);
    expect(result.skills).toHaveLength(1);
    expect(result.packages).toHaveLength(0);
  });

  it("flags missing catalog items", () => {
    const result = resolveDownloadInsight({ scope: "plugin", name: "missing" }, skills, packages);
    expect(result.missing).toBe(true);
    expect(result.packages).toHaveLength(0);
  });
});

describe("buildDownloadSeries", () => {
  it("builds a non-empty proxy series for a single artifact", () => {
    const series = buildDownloadSeries([makeSkill()], [], "1w");
    expect(series).toHaveLength(7);
    expect(sumSeries(series)).toBeGreaterThan(0);
  });

  it("builds distinct graceful mock shapes in the 200–300 range", () => {
    const day = 24 * 60 * 60 * 1000;
    const skills = [makeSkill({ slug: "alpha-skill", updatedAt: Date.now() - 2 * day })];
    const packages = [makePackage({ name: "beta-plugin", updatedAt: Date.now() - 2 * day })];
    const skillSeries = buildDownloadSeries(skills, [], "1w");
    const pluginSeries = buildDownloadSeries([], packages, "1w");
    const totalSeries = buildDownloadSeries(skills, packages, "1w");

    expect(skillSeries).not.toEqual(pluginSeries);
    expect(totalSeries).not.toEqual(skillSeries);
    expect(totalSeries).not.toEqual(pluginSeries);
    expect(sumSeries(skillSeries)).toBeGreaterThanOrEqual(200);
    expect(sumSeries(skillSeries)).toBeLessThan(340);
    expect(sumSeries(pluginSeries)).toBeGreaterThanOrEqual(200);
    expect(sumSeries(pluginSeries)).toBeLessThan(340);
    expect(sumSeries(totalSeries)).toBeGreaterThan(400);
  });

  it("returns artifact download totals", () => {
    expect(
      artifactDownloads([makeSkill({ stats: { downloads: 77 } } as Partial<DashboardSkill>)], []),
    ).toBe(77);
  });
});

function sumSeries(series: number[]) {
  return series.reduce((sum, value) => sum + value, 0);
}
