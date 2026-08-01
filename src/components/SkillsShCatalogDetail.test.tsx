/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { SkillsShCatalogDetail } from "../lib/skillsShCatalog";
import { SkillsShCatalogDetailPage } from "./SkillsShCatalogDetail";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    search,
  }: {
    children?: ReactNode;
    to?: string;
    search?: Record<string, string>;
  }) => <a href={`${to}?${new URLSearchParams(search).toString()}`}>{children}</a>,
}));

vi.mock("../lib/useHeroCreatorPublisher", () => ({
  useHeroCreatorPublisher: ({ owner }: { owner?: unknown }) => owner,
}));

describe("SkillsShCatalogDetailPage", () => {
  it("shows the external trust boundary, upstream checks, provenance, and freshness", () => {
    const { container } = render(<SkillsShCatalogDetailPage entry={makeEntry()} />);

    expect(screen.getAllByText("Not scanned by ClawHub").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Gen Agent Trust Hub").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Socket").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Snyk").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Separate from ClawHub scanning.").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Observed").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1m ago").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /View on skills\.sh/i }).getAttribute("href")).toBe(
      "https://skills.sh/patrick-erichsen/skills/html",
    );
    expect(screen.getAllByText("100").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Upstream installs").length).toBeGreaterThan(0);
    expect(screen.getByText("HTML Artifact Chooser Build useful artifacts.")).toBeTruthy();
    expect(container.querySelector(".skill-hero-layout.has-sidebar")).toBeTruthy();
    expect(container.querySelector(".skill-hero-sidebar")?.textContent).toContain(
      "Upstream checks",
    );
  });

  it("shows colon-form install commands and a preselected GitHub Skill Sync claim", () => {
    render(<SkillsShCatalogDetailPage entry={makeEntry()} />);

    expect(screen.getByText("openclaw skills install")).toBeTruthy();
    expect(screen.getByText("skills-sh:patrick-erichsen/skills/html")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "ClawHub" }));
    expect(
      screen.getByText("clawhub install skills-sh:patrick-erichsen/skills/html", { exact: true }),
    ).toBeTruthy();
    const claimUrl = new URL(
      screen.getByRole("link", { name: "Claim" }).getAttribute("href") ?? "",
      "https://clawhub.test",
    );
    expect(claimUrl.pathname).toBe("/settings");
    expect(Object.fromEntries(claimUrl.searchParams)).toEqual({
      view: "githubSources",
      ownerHandle: "openclaw",
      repo: "openclaw/openclaw",
      sourceRepo: "openclaw/openclaw",
      sourceExternalId: "patrick-erichsen/skills/html",
      sourcePath: "skills/html",
      sourceCommit: "050daba89f6b6636470add5cb300aac46a412cf8",
      sourceContentHash: "a".repeat(64),
    });
  });

  it("renders only stored bounded content and no file explorer", () => {
    render(<SkillsShCatalogDetailPage entry={makeEntry()} />);

    const detailTabs = screen.getByRole("tablist", { name: "Skill detail tabs" });
    expect(detailTabs).toBeTruthy();
    expect(detailTabs.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(
      "SKILL.md",
    );
    expect(screen.getByRole("heading", { name: "Use this skill" })).toBeTruthy();
    expect(screen.queryByText("Files")).toBeNull();
    expect(screen.queryByText("File explorer")).toBeNull();
    expect(screen.getByText("Content is truncated to the stored 64 KiB snapshot.")).toBeTruthy();
  });

  it("uses the normal skill install card with the exact skills.sh reference", () => {
    const { container } = render(<SkillsShCatalogDetailPage entry={makeEntry()} />);

    expect(container.querySelector(".skill-install-command-card")).toBeTruthy();
    expect(screen.getByText("openclaw skills install")).toBeTruthy();
    expect(screen.getByText("skills-sh:patrick-erichsen/skills/html")).toBeTruthy();
    expect(screen.getAllByText("skills.sh").length).toBeGreaterThan(0);
  });

  it("uses the shared skill detail shell for content and stats", () => {
    render(<SkillsShCatalogDetailPage entry={makeEntry()} />);

    const sectionTabs = screen.getByRole("tablist", { name: "Skill mobile sections" });
    expect(sectionTabs).toBeTruthy();
    expect(sectionTabs.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe(
      "SKILL.md",
    );
    expect(screen.getByRole("link", { name: "html", current: "page" }).getAttribute("href")).toBe(
      "/skills-sh/patrick-erichsen/skills/html",
    );
    const breadcrumbs = screen.getByRole("navigation", { name: "Skill breadcrumbs" });
    expect(breadcrumbs.querySelector("a[href*='skills.sh']")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Stats & details" }));

    expect(screen.getByRole("tab", { name: "Stats & details" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getAllByText("Upstream checks").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Bookmark skill" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Report" })).toBeNull();
  });

  it("hides install commands without a commit-pinned GitHub folder", () => {
    const entry = makeEntry();
    delete entry.githubCommit;
    render(<SkillsShCatalogDetailPage entry={entry} />);

    expect(screen.queryByText(/^openclaw skills install /)).toBeNull();
    expect(screen.queryByText(/^clawhub install /)).toBeNull();
  });

  it("keeps ownerless upstream entries labeled as skills.sh", () => {
    const entry = makeEntry();
    delete entry.owner;
    render(<SkillsShCatalogDetailPage entry={entry} />);

    const breadcrumbs = screen.getByRole("navigation", { name: "Skill breadcrumbs" });
    expect(breadcrumbs.textContent).toContain("skills.sh");
    expect(breadcrumbs.textContent).not.toContain("patrick-erichsen/skills");
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
    summary: "# HTML Artifact Chooser **Build useful artifacts.**",
    categories: ["development"],
    topics: [],
    sourceUrl: "https://skills.sh/patrick-erichsen/skills/html",
    canonicalRepoUrl: "https://github.com/patrick-erichsen/skills",
    canonicalGitHubRepo: "openclaw/openclaw",
    githubPath: "skills/html",
    githubCommit: "050daba89f6b6636470add5cb300aac46a412cf8",
    githubContentHash: "a".repeat(64),
    sourceContentHash: "b".repeat(64),
    upstreamInstalls: 100,
    lastObservedAt: Date.now() - 60000,
    upstreamChecks: [
      { scanner: "Gen Agent Trust Hub", status: "unavailable", sourceStatus: "unavailable" },
      { scanner: "Socket", status: "passed", sourceStatus: "pass" },
      { scanner: "Snyk", status: "warning", sourceStatus: "warning" },
    ],
    content: {
      kind: "skill-md",
      path: "skills/html/SKILL.md",
      markdown: "# Use this skill\n\nBuild a useful artifact.",
      bytes: 65536,
      truncated: true,
    },
  };
}
