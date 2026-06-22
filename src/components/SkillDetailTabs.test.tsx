/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import type { ClawdisSkillMetadata } from "clawhub-schema";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Doc } from "../../convex/_generated/dataModel";
import { SkillDetailTabs, type DetailTab } from "./SkillDetailTabs";

const useMutationMock = vi.fn();

vi.mock("convex/react", () => ({
  useMutation: (...args: unknown[]) => useMutationMock(...args),
}));

beforeEach(() => {
  useMutationMock.mockReset();
  useMutationMock.mockReturnValue(vi.fn());
});

function renderReadme(readmeContent: string) {
  return render(
    <SkillDetailTabs
      activeTab="readme"
      setActiveTab={vi.fn()}
      readmeContent={readmeContent}
      readmeError={null}
      skillCardContent={null}
      skillCardError={null}
      hasSkillCard={false}
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

function renderReadmeForOwner(readmeContent: string) {
  return render(
    <SkillDetailTabs
      activeTab="readme"
      setActiveTab={vi.fn()}
      readmeContent={readmeContent}
      readmeError={null}
      skillCardContent={null}
      skillCardError={null}
      hasSkillCard={false}
      latestFiles={[]}
      latestVersionId={null}
      skill={{ slug: "api-gateway" } as Doc<"skills">}
      ownerHandle="clawkit"
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
    expect(screen.queryByRole("tab", { name: "Diff" })).toBeNull();
  });

  it("hides archive-only tabs for source-backed skills", () => {
    render(
      <SkillDetailTabs
        activeTab="readme"
        setActiveTab={vi.fn()}
        readmeContent="# API Gateway"
        readmeError={null}
        skillCardContent="# Skill Card"
        skillCardError={null}
        hasSkillCard={true}
        latestFiles={[]}
        latestVersionId={null}
        skill={{ slug: "api-gateway", tags: {} } as Doc<"skills">}
        onCompareIntent={vi.fn()}
        diffVersions={undefined}
        versions={undefined}
        nixPlugin={false}
        showArchiveTabs={false}
        suppressVersionScanResults={false}
        scanResultsSuppressedMessage={null}
        clawdis={undefined}
        osLabels={[]}
      />,
    );

    expect(screen.getByRole("tab", { name: "SKILL.md" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Skill Card" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Files" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Versions" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Diff" })).toBeNull();
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

  it("keeps relative README links in the viewed owner namespace", () => {
    renderReadmeForOwner("[Usage](docs/Usage.md)");

    expect(screen.getByRole("link", { name: "Usage" }).getAttribute("href")).toBe(
      "/api/v1/skills/api-gateway/file?path=docs%2FUsage.md&ownerHandle=clawkit",
    );
  });

  it("keeps relative Skill Card links in the viewed owner namespace", () => {
    render(
      <SkillDetailTabs
        activeTab="skill-card"
        setActiveTab={vi.fn()}
        readmeContent="# API Gateway"
        readmeError={null}
        skillCardContent="[Evidence](reports/card.md)"
        skillCardError={null}
        hasSkillCard={true}
        latestFiles={[]}
        latestVersionId={null}
        skill={{ slug: "api-gateway", tags: {} } as Doc<"skills">}
        ownerHandle="clawkit"
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

    expect(screen.getByRole("link", { name: "Evidence" }).getAttribute("href")).toBe(
      "/api/v1/skills/api-gateway/file?path=reports%2Fcard.md&ownerHandle=clawkit",
    );
  });

  it("keeps version download links in the viewed owner namespace", () => {
    render(
      <SkillDetailTabs
        activeTab="versions"
        setActiveTab={vi.fn()}
        readmeContent="# API Gateway"
        readmeError={null}
        skillCardContent={null}
        skillCardError={null}
        hasSkillCard={false}
        latestFiles={[]}
        latestVersionId={null}
        skill={{ slug: "api-gateway", tags: {} } as Doc<"skills">}
        ownerHandle="clawkit"
        onCompareIntent={vi.fn()}
        diffVersions={undefined}
        versions={[
          {
            _id: "skillVersions:1",
            _creationTime: 1,
            skillId: "skills:1",
            version: "1.0.0",
            changelog: "Initial release",
            files: [],
            createdBy: "users:owner",
            createdAt: 1,
          } as unknown as Doc<"skillVersions">,
        ]}
        nixPlugin={false}
        suppressVersionScanResults={false}
        scanResultsSuppressedMessage={null}
        clawdis={undefined}
        osLabels={[]}
      />,
    );

    const href = screen
      .getByRole("link", { name: "Download .zip for v1.0.0" })
      .getAttribute("href");
    const url = new URL(href ?? "");
    expect(url.pathname).toBe("/api/v1/download");
    expect(url.searchParams.get("slug")).toBe("api-gateway");
    expect(url.searchParams.get("ownerHandle")).toBe("clawkit");
    expect(url.searchParams.get("version")).toBe("1.0.0");
  });

  it("uses a custom README link resolver when provided", () => {
    render(
      <SkillDetailTabs
        activeTab="readme"
        setActiveTab={vi.fn()}
        readmeContent="[Source doc](references/install.md)"
        readmeError={null}
        skillCardContent={null}
        skillCardError={null}
        hasSkillCard={false}
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
        readmeHrefResolver={(href) => `https://github.com/NVIDIA/skills/blob/abc/${href}`}
      />,
    );

    expect(screen.getByRole("link", { name: "Source doc" }).getAttribute("href")).toBe(
      "https://github.com/NVIDIA/skills/blob/abc/references/install.md",
    );
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
          skillCardContent={null}
          skillCardError={null}
          hasSkillCard={false}
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

    expect(screen.getByRole("tab", { name: "Requirements" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Dependencies" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Install" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Links" })).toBeTruthy();
    expect(screen.getByText("TODOIST_API_TOKEN")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Dependencies" }));

    expect(screen.getByText("ripgrep")).toBeTruthy();
    expect(screen.getByRole("link", { name: /example\.com\/rg/ })).toBeTruthy();
  });

  it("shows a Skill Card tab only when a generated card file exists", () => {
    render(
      <SkillDetailTabs
        activeTab="skill-card"
        setActiveTab={vi.fn()}
        readmeContent="# API Gateway"
        readmeError={null}
        skillCardContent={["# Skill Card", "", "Generated."].join("\n")}
        skillCardError={null}
        hasSkillCard={true}
        latestFiles={
          [
            {
              path: "skill-card.md",
              size: 24,
              storageId: "_storage:card",
              sha256: "a".repeat(64),
            },
          ] as Doc<"skillVersions">["files"]
        }
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

    expect(screen.getByRole("tab", { name: "Skill Card" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Skill Card" })).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "NVIDIA's trust-card pattern for agent skills" })
        .getAttribute("href"),
    ).toBe("https://docs.nvidia.com/skills/skill-cards");
  });

  it("renders safe raw HTML in generated Skill Cards", () => {
    render(
      <SkillDetailTabs
        activeTab="skill-card"
        setActiveTab={vi.fn()}
        readmeContent="# API Gateway"
        readmeError={null}
        skillCardContent={["## Description:<br/>", "", "line one<br/>line two"].join("\n")}
        skillCardError={null}
        hasSkillCard={true}
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

    expect(screen.getByText(/line one/)).toBeTruthy();
    expect(screen.getByText(/line two/)).toBeTruthy();
    expect(screen.queryByText(/<br/i)).toBeNull();
  });
});
