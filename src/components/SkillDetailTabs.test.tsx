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
      readmeContent={readmeContent}
      readmeError={null}
      latestFiles={[]}
      latestVersionId={null}
      skill={{ slug: "api-gateway" } as Doc<"skills">}
    />,
  );
}

describe("SkillDetailTabs README links", () => {
  it("uses the simplified detail tab order", () => {
    renderReadme("# API Gateway");

    expect(screen.getByRole("button", { name: "SKILL.md" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Files" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Settings" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Versions" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Compare" })).toBeNull();
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
});
