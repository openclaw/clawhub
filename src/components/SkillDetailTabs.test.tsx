/* @vitest-environment jsdom */

import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Doc } from "../../convex/_generated/dataModel";
import { SkillDetailTabs } from "./SkillDetailTabs";

vi.mock("./SkillVersionsPanel", () => ({
  SkillVersionsPanel: () => <div />,
}));

const skill = {
  _creationTime: 0,
  _id: "skills:1",
  badges: {},
  createdAt: 0,
  displayName: "Demo",
  ownerUserId: "users:1",
  slug: "demo-skill",
  stats: {},
  tags: {},
  updatedAt: 0,
} as unknown as Doc<"skills">;

function renderReadme(readmeContent: string) {
  return render(
    <SkillDetailTabs
      activeTab="readme"
      diffVersions={undefined}
      latestFiles={[]}
      latestVersionId={null}
      nixPlugin={false}
      onCompareIntent={() => undefined}
      readmeContent={readmeContent}
      readmeError={null}
      scanResultsSuppressedMessage={null}
      setActiveTab={() => undefined}
      skill={skill}
      suppressVersionScanResults={false}
      versions={undefined}
    />,
  ).container;
}

describe("SkillDetailTabs README markdown links", () => {
  it("rewrites relative README links and images to skill file URLs", () => {
    const container = renderReadme("[Usage](docs/usage.md) ![Logo](img/logo.png)");
    const link = container.querySelector("a");
    const image = container.querySelector("img");

    expect(link?.getAttribute("href")).toBe(
      "/api/v1/skills/demo-skill/file?path=docs%2Fusage.md",
    );
    expect(image?.getAttribute("src")).toBe(
      "/api/v1/skills/demo-skill/file?path=img%2Flogo.png",
    );
  });

  it("preserves safe non-file references and sanitizes traversal", () => {
    const container = renderReadme(
      [
        "[External](https://example.com)",
        "[Mail](mailto:security@example.com)",
        "[Phone](tel:+15555550100)",
        "[Anchor](#usage)",
        "[Secret](../secret.md)",
      ].join(" "),
    );
    const links = Array.from(container.querySelectorAll("a"));

    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "https://example.com",
      "mailto:security@example.com",
      "tel:+15555550100",
      "#usage",
      "",
    ]);
  });
});
