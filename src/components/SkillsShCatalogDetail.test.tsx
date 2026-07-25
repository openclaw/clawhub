/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
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

describe("SkillsShCatalogDetailPage", () => {
  it("shows the external trust boundary, upstream checks, provenance, and freshness", () => {
    render(<SkillsShCatalogDetailPage entry={makeEntry()} />);

    expect(screen.getAllByText("Not scanned by ClawHub").length).toBeGreaterThan(0);
    expect(screen.getByText("Gen Agent Trust Hub")).toBeTruthy();
    expect(screen.getByText("Socket")).toBeTruthy();
    expect(screen.getByText("Snyk")).toBeTruthy();
    expect(screen.getByText("Upstream checks are separate from ClawHub scanning.")).toBeTruthy();
    expect(screen.getAllByText("Observed 1m ago").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /View on skills\.sh/i }).getAttribute("href")).toBe(
      "https://skills.sh/patrick-erichsen/skills/html",
    );
  });

  it("shows colon-form install commands and a preselected GitHub Skill Sync claim", () => {
    render(<SkillsShCatalogDetailPage entry={makeEntry()} />);

    expect(
      screen.getByText("openclaw skills install skills-sh:patrick-erichsen/skills/html", {
        exact: true,
      }),
    ).toBeTruthy();
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

    expect(screen.getByRole("heading", { name: "Stored SKILL.md" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Use this skill" })).toBeTruthy();
    expect(screen.queryByText("Files")).toBeNull();
    expect(screen.queryByText("File explorer")).toBeNull();
    expect(screen.getByText("Content is truncated to the stored 64 KiB snapshot.")).toBeTruthy();
  });

  it("hides install commands without a commit-pinned GitHub folder", () => {
    const entry = makeEntry();
    delete entry.githubCommit;
    render(<SkillsShCatalogDetailPage entry={entry} />);

    expect(screen.queryByText(/^openclaw skills install /)).toBeNull();
    expect(screen.queryByText(/^clawhub install /)).toBeNull();
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
