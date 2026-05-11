/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import type { ClawdisSkillMetadata } from "clawhub-schema";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Doc } from "../../convex/_generated/dataModel";
import { SkillDetailTabs, type DetailTab } from "./SkillDetailTabs";

function renderReadme(readmeContent: string) {
  return render(
    <SkillDetailTabs
      activeTab="readme"
      setActiveTab={vi.fn()}
      readmeContent={readmeContent}
      readmeError={null}
      latestFiles={[]}
      latestVersionId={null}
      skill={{ slug: "api-gateway" } as Doc<"skills">}
      onCompareIntent={vi.fn()}
      diffVersions={undefined}
      versions={undefined}
      nixPlugin={false}
      suppressVersionScanResults={false}
      scanResultsSuppressedMessage={null}
      clawdis={undefined}
      osLabels={[]}
    />,
  );
}

describe("SkillDetailTabs README links", () => {
  it("renders files and version history tabs before install metadata tabs", () => {
    renderReadme("# API Gateway");

    expect(screen.getByRole("tab", { name: "SKILL.md" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Files" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Versions" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Settings" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Compare" })).toBeNull();
  });

  it("keeps relative skill README links inside the viewed skill", () => {
    const { container } = renderReadme(
      [
        "[Google Mail](references/google-mail/README.md)",
        "[External](https://example.com/docs)",
        "[Usage](#usage)",
        "[Traversal](../references/README.md)",
      ].join("\n\n"),
    );

    expect(screen.getByRole("link", { name: "Google Mail" }).getAttribute("href")).toBe(
      "/api/v1/skills/api-gateway/file?path=references%2Fgoogle-mail%2FREADME.md",
    );
    expect(screen.getByRole("link", { name: "External" }).getAttribute("href")).toBe(
      "https://example.com/docs",
    );
    expect(screen.getByRole("link", { name: "Usage" }).getAttribute("href")).toBe("#usage");
    const traversal = Array.from(container.querySelectorAll("a")).find(
      (link) => link.textContent === "Traversal",
    );
    expect(traversal?.getAttribute("href")).toBe("");
  });

  it("adds Clawdis metadata to the existing skill detail tabs", () => {
    function TestSkillDetailTabs() {
      const [activeTab, setActiveTab] = useState<DetailTab>("runtime");
      return (
        <SkillDetailTabs
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          readmeContent="# API Gateway"
          readmeError={null}
          latestFiles={[]}
          latestVersionId={null}
          skill={{ slug: "api-gateway" } as Doc<"skills">}
          onCompareIntent={vi.fn()}
          diffVersions={undefined}
          versions={undefined}
          nixPlugin={false}
          suppressVersionScanResults={false}
          scanResultsSuppressedMessage={null}
          osLabels={["macOS"]}
          clawdis={
            {
              requires: { env: ["TODOIST_API_TOKEN"] },
              install: [{ kind: "brew", formula: "ripgrep", bins: ["rg"] }],
              dependencies: [{ name: "ripgrep", type: "brew", url: "https://example.com/rg" }],
              links: { homepage: "https://example.com" },
            } as ClawdisSkillMetadata
          }
        />
      );
    }

    render(<TestSkillDetailTabs />);

    expect(screen.getByRole("tab", { name: "Runtime" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Dependencies" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Install" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Links" })).toBeTruthy();
    expect(screen.getByText("TODOIST_API_TOKEN")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Dependencies" }));

    expect(screen.getByText("ripgrep")).toBeTruthy();
    expect(screen.getByRole("link", { name: "https://example.com/rg" })).toBeTruthy();
  });
});
