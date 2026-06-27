import { describe, expect, it } from "vitest";
import {
  combineMetricSeries,
  downloadMetricQuerySelection,
  metricSeries,
  parseDownloadInsight,
  rangeLabels,
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
    updatedAt: 0,
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
    updatedAt: 0,
    stats: { downloads: 40, installs: 0, stars: 0, versions: 1 },
    latestRelease: null,
    ...overrides,
  };
}

describe("download insight selection", () => {
  it("parses skill and plugin keys", () => {
    expect(parseDownloadInsight("skill:alpha")).toEqual({ scope: "skill", slug: "alpha" });
    expect(parseDownloadInsight("plugin:beta")).toEqual({ scope: "plugin", name: "beta" });
    expect(parseDownloadInsight(undefined)).toEqual({ scope: "all" });
    expect(parseDownloadInsight("invalid")).toEqual({ scope: "all" });
  });

  it("maps the selected catalog item to the metrics query", () => {
    expect(downloadMetricQuerySelection("skill:alpha")).toEqual({ kind: "skill", slug: "alpha" });
    expect(downloadMetricQuerySelection("plugin:beta")).toEqual({ kind: "plugin", name: "beta" });
    expect(downloadMetricQuerySelection(undefined)).toBeUndefined();
  });

  it("resolves matching and missing catalog items", () => {
    const skills = [makeSkill()];
    const packages = [makePackage()];
    expect(
      resolveDownloadInsight({ scope: "skill", slug: "demo-skill" }, skills, packages),
    ).toMatchObject({
      missing: false,
      skills: [skills[0]],
      packages: [],
    });
    expect(
      resolveDownloadInsight({ scope: "plugin", name: "missing" }, skills, packages),
    ).toMatchObject({
      missing: true,
      packages: [],
    });
  });
});

describe("download metric series", () => {
  const points = Array.from({ length: 30 }, (_, index) => ({ day: index + 1, value: index + 1 }));

  it("uses the daily points returned by the backend for each range", () => {
    expect(metricSeries(points, "1w")).toEqual([24, 25, 26, 27, 28, 29, 30]);
    expect(metricSeries(points, "1m")).toEqual(points.map((point) => point.value));
    expect(metricSeries(points, "all")).toEqual(points.map((point) => point.value));
  });

  it("combines skill and plugin points by day", () => {
    expect(combineMetricSeries([2, 4, 6], [1, 3, 5])).toEqual([3, 7, 11]);
  });

  it("labels points from the backend end day", () => {
    const labels = rangeLabels("1w", 20_000);
    expect(labels).toHaveLength(7);
    expect(labels.at(-1)).toBe("Oct 4");
  });
});
