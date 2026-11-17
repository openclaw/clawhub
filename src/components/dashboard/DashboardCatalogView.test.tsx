/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeDashboardPackage } from "../../__tests__/helpers/dashboard";
import { mergeDashboardItems } from "./dashboardCatalog";
import { DashboardCatalogView } from "./DashboardCatalogView";
import type { DashboardCatalogItem, DashboardSkill } from "./types";

const skill = {
  _id: "skills:demo",
  _creationTime: 1,
  slug: "demo",
  displayName: "Demo",
  ownerUserId: "users:owner",
  ownerPath: "owner",
  tags: {},
  badges: {},
  stats: {
    downloads: 12,
    installsCurrent: 3,
    installsAllTime: 7,
    stars: 4,
    versions: 1,
  },
  metricSources: {
    clawHubDownloads: 12,
    skillsShInstalls: 8,
    openClawInstallsCurrent: 3,
    openClawInstallsAllTime: 7,
    githubStars: 99,
    bookmarks: 4,
  },
  latestVersion: null,
  createdAt: 1,
  updatedAt: 1,
} as DashboardSkill;

const item: DashboardCatalogItem = {
  kind: "skill",
  id: skill._id,
  name: skill.displayName,
  searchText: "demo",
  data: skill,
  updatedAt: skill.updatedAt,
  installs: 7,
  downloads: 12,
};

describe("DashboardCatalogView", () => {
  it.each(["list", "grid"] as const)("labels and links templates correctly in %s view", (view) => {
    const items = mergeDashboardItems(
      [],
      [makeDashboardPackage({ family: "template", name: "@owner/hopper", displayName: "Hopper" })],
    );
    render(
      <DashboardCatalogView items={items} view={view} ownerHandle="owner" canManage={false} />,
    );
    expect(screen.getByText("Template")).toBeTruthy();
    expect(screen.queryByText("Plugin")).toBeNull();
    expect(screen.getByRole("link").getAttribute("href")).toBe("/owner/templates/hopper");
  });
  it("lets publishers inspect independently attributed metric sources", () => {
    render(
      <DashboardCatalogView items={[item]} view="list" ownerHandle="owner" canManage={true} />,
    );

    expect(
      screen.getByTitle(
        "12 ClawHub downloads. 8 skills.sh lifetime installs; 99 GitHub stars. 7 OpenClaw installs; 4 bookmarks.",
      ),
    ).toBeTruthy();
  });

  it("distinguishes unavailable external metrics from zero", () => {
    render(
      <DashboardCatalogView
        items={[
          {
            ...item,
            data: {
              ...skill,
              metricSources: {
                ...skill.metricSources!,
                skillsShInstalls: null,
                githubStars: null,
              },
            },
          },
        ]}
        view="list"
        ownerHandle="owner"
        canManage={true}
      />,
    );

    expect(
      screen.getByTitle(
        "12 ClawHub downloads. skills.sh lifetime installs unavailable; GitHub stars unavailable. 7 OpenClaw installs; 4 bookmarks.",
      ),
    ).toBeTruthy();
  });
});
