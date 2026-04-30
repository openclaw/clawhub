/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Doc } from "../../convex/_generated/dataModel";
import { SkillDetailTabs } from "./SkillDetailTabs";

function renderReadme(readmeContent: string) {
  return render(
    <SkillDetailTabs
      activeTab="readme"
      setActiveTab={vi.fn()}
      onCompareIntent={vi.fn()}
      readmeContent={readmeContent}
      readmeError={null}
      latestFiles={[]}
      latestVersionId={null}
      skill={{ slug: "api-gateway" } as Doc<"skills">}
      diffVersions={[]}
      versions={[]}
      nixPlugin={false}
      suppressVersionScanResults={false}
      scanResultsSuppressedMessage={null}
    />,
  );
}

describe("SkillDetailTabs README links", () => {
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
});
