/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { SkillsShSearchResult } from "../lib/skillsShCatalog";
import { SkillsShListItem } from "./SkillsShListItem";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children?: ReactNode; to?: string }) => <a href={to}>{children}</a>,
}));

describe("SkillsShListItem", () => {
  it("renders the repository identity and explicit external trust boundary", () => {
    render(<SkillsShListItem result={makeResult()} />);

    expect(screen.getByRole("link").getAttribute("href")).toBe(
      "/skills-sh/patrick-erichsen/skills/html",
    );
    expect(screen.getByText("HTML Artifact Chooser")).toBeTruthy();
    expect(screen.getByText("patrick-erichsen/skills")).toBeTruthy();
    expect(screen.getByText("Not scanned by ClawHub")).toBeTruthy();
    expect(screen.queryByText("@patrick-erichsen")).toBeNull();
  });

  it("shows only attributable skills.sh popularity and freshness", () => {
    render(<SkillsShListItem result={makeResult()} />);

    expect(screen.getByText("12.5k")).toBeTruthy();
    expect(screen.getByText("Observed 1m ago")).toBeTruthy();
  });
});

function makeResult(): SkillsShSearchResult {
  return {
    source: "skills.sh",
    externalId: "patrick-erichsen/skills/html",
    route: "/skills-sh/patrick-erichsen/skills/html",
    reference: "skills-sh:patrick-erichsen/skills/html",
    owner: "patrick-erichsen",
    repo: "skills",
    slug: "html",
    displayName: "HTML Artifact Chooser",
    upstreamInstalls: 12500,
    lastObservedAt: Date.now() - 60000,
  };
}
