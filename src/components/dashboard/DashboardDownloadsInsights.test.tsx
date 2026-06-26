/* @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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

describe("DashboardDownloadsInsights", () => {
  it("renders without PROXY_NOTE and shows interactive chart tooltips on hover", () => {
    const { container } = render(
      <DashboardDownloadsInsights
        skills={[skill]}
        packages={[pkg]}
        skillDownloadsTotal={120}
        pluginDownloadsTotal={40}
      />,
    );

    expect(screen.getByLabelText("Download metrics")).toBeTruthy();
    expect(container.textContent).not.toContain("PROXY_NOTE");

    const hitZones = container.querySelectorAll(".dashboard-downloads-chart-hit");
    expect(hitZones.length).toBeGreaterThan(0);

    fireEvent.mouseEnter(hitZones[0]!);
    expect(container.querySelector(".dashboard-downloads-chart-tooltip")).toBeTruthy();

    fireEvent.mouseLeave(hitZones[0]!);
    fireEvent.mouseEnter(hitZones[1] ?? hitZones[0]!);
    expect(container.querySelector(".dashboard-downloads-chart-tooltip")).toBeTruthy();
  });
});
