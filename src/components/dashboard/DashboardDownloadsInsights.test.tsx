/* @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { DashboardDownloadMetrics } from "./dashboardDownloadMetrics";
import { DashboardDownloadsInsights } from "./DashboardDownloadsInsights";
import type { DashboardPackage, DashboardSkill } from "./types";

const skill = {
  _id: "skill-1",
  _creationTime: 0,
  slug: "demo-skill",
  displayName: "Demo Skill",
  summary: "",
  ownerUserId: "user-1",
  ownerPath: "demo",
  updatedAt: Date.now() - 2 * 24 * 60 * 60 * 1000,
  stats: { downloads: 120, installsCurrent: 0, installsAllTime: 0, stars: 0, versions: 1 },
} as DashboardSkill;

const pkg = {
  _id: "pkg-1",
  name: "demo-plugin",
  displayName: "Demo Plugin",
  family: "code-plugin",
  channel: "community",
  isOfficial: false,
  updatedAt: Date.now() - 5 * 24 * 60 * 60 * 1000,
  stats: { downloads: 40, installs: 0, stars: 0, versions: 1 },
  latestRelease: null,
} as DashboardPackage;

const metrics: DashboardDownloadMetrics = {
  endDay: 30,
  allTimeDownloads: 160,
  skills: {
    allTimeDownloads: 120,
    points: Array.from({ length: 30 }, (_, index) => ({ day: index + 1, value: index })),
  },
  plugins: {
    allTimeDownloads: 40,
    points: Array.from({ length: 30 }, (_, index) => ({ day: index + 1, value: index % 3 })),
  },
};

describe("DashboardDownloadsInsights", () => {
  it("renders daily download metrics with interactive chart tooltips", () => {
    const { container } = render(
      <DashboardDownloadsInsights skills={[skill]} packages={[pkg]} metrics={metrics} />,
    );

    expect(screen.getByLabelText("Download metrics")).toBeTruthy();
    const hitZones = container.querySelectorAll(".dashboard-downloads-chart-hit");
    expect(hitZones.length).toBeGreaterThan(0);

    fireEvent.mouseEnter(hitZones[0]!);
    expect(container.querySelector(".dashboard-downloads-chart-tooltip")).toBeTruthy();

    fireEvent.mouseLeave(hitZones[0]!);
    fireEvent.mouseEnter(hitZones[1] ?? hitZones[0]!);
    expect(container.querySelector(".dashboard-downloads-chart-tooltip")).toBeTruthy();
  });

  it("uses date labels instead of internal bucket labels for compact stat tooltips", () => {
    const { container } = render(
      <DashboardDownloadsInsights skills={[skill]} packages={[pkg]} metrics={metrics} />,
    );

    const compactHitZone = container.querySelector(
      ".dashboard-downloads-compact-stat .dashboard-downloads-chart-hit",
    );
    expect(compactHitZone).toBeTruthy();

    fireEvent.mouseEnter(compactHitZone!);

    expect(container.querySelector(".dashboard-downloads-chart-tooltip")?.textContent).not.toMatch(
      /bucket/i,
    );
  });
});
