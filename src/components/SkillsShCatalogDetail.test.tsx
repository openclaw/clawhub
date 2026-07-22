/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SkillsShCatalogDetail } from "../lib/skillsShCatalog";
import { SkillsShCatalogDetailPage } from "./SkillsShCatalogDetail";

describe("SkillsShCatalogDetailPage", () => {
  it("shows the external trust boundary, upstream checks, provenance, and freshness", () => {
    render(<SkillsShCatalogDetailPage entry={makeEntry()} />);

    expect(screen.getByText("Not scanned by ClawHub")).toBeTruthy();
    expect(screen.getByText("Gen Agent Trust Hub")).toBeTruthy();
    expect(screen.getByText("Socket")).toBeTruthy();
    expect(screen.getByText("Snyk")).toBeTruthy();
    expect(screen.getByText("pass")).toBeTruthy();
    expect(screen.getByRole("link", { name: "View result" }).getAttribute("href")).toBe(
      "https://www.skills.sh/patrick-erichsen/skills/html/security/socket",
    );
    expect(screen.getByText("Upstream checks are separate from ClawHub scanning.")).toBeTruthy();
    expect(screen.getByText("Observed 1m ago")).toBeTruthy();
    expect(screen.getByRole("link", { name: /View on skills\.sh/i }).getAttribute("href")).toBe(
      "https://skills.sh/patrick-erichsen/skills/html",
    );
  });

  it("shows both supported colon-form install commands", () => {
    render(<SkillsShCatalogDetailPage entry={makeEntry()} />);

    expect(
      screen.getByText("openclaw skills install skills-sh:patrick-erichsen/skills/html", {
        exact: true,
      }),
    ).toBeTruthy();
    expect(
      screen.getByText("clawhub install skills-sh:patrick-erichsen/skills/html", {
        exact: true,
      }),
    ).toBeTruthy();
  });

  it("renders only the stored bounded source content and no file explorer", () => {
    render(<SkillsShCatalogDetailPage entry={makeEntry()} />);

    expect(screen.getByRole("heading", { name: "Stored SKILL.md" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Use this skill" })).toBeTruthy();
    expect(screen.queryByText("Files")).toBeNull();
    expect(screen.queryByText("File explorer")).toBeNull();
    expect(screen.getByText("Content is truncated to the stored 64 KiB snapshot.")).toBeTruthy();
  });
});

function makeEntry(): SkillsShCatalogDetail {
  return {
    source: "skills.sh",
    externalId: "patrick-erichsen/skills/html",
    route: "/skills-sh/patrick-erichsen/skills/html",
    reference: "skills-sh:patrick-erichsen/skills/html",
    owner: "patrick-erichsen",
    repo: "skills",
    slug: "html",
    displayName: "HTML Artifact Chooser",
    sourceUrl: "https://skills.sh/patrick-erichsen/skills/html",
    canonicalRepoUrl: "https://github.com/patrick-erichsen/skills",
    githubPath: "skills/html",
    githubCommit: "050daba89f6b6636470add5cb300aac46a412cf8",
    sourceContentHash: "content-hash",
    upstreamInstalls: 100,
    lastObservedAt: Date.now() - 60_000,
    upstreamChecks: [
      { scanner: "Gen Agent Trust Hub", status: "unavailable", sourceStatus: "unavailable" },
      {
        scanner: "Socket",
        status: "passed",
        sourceStatus: "pass",
        checkedAt: Date.now() - 60_000,
        url: "https://www.skills.sh/patrick-erichsen/skills/html/security/socket",
      },
      { scanner: "Snyk", status: "warning", sourceStatus: "warning" },
    ],
    content: {
      kind: "skill-md",
      path: "skills/html/SKILL.md",
      markdown: "# Use this skill\n\nBuild a useful artifact.",
      bytes: 65_536,
      truncated: true,
    },
  };
}
