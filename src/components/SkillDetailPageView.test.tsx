/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SkillDetailPageView, type SkillDetailPageViewProps } from "./SkillDetailPageView";
import { TooltipProvider } from "./ui/tooltip";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children?: ReactNode; to?: string }) => (
    <a href={to ?? "#"}>{children}</a>
  ),
}));

vi.mock("../lib/useHeroCreatorPublisher", () => ({
  useHeroCreatorPublisher: () => null,
}));

describe("SkillDetailPageView", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      media: "",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  it("owns the whole shared detail page while rendering source-specific slots", () => {
    const props: SkillDetailPageViewProps = {
      skill: {
        slug: "demo",
        displayName: "Demo Skill",
        summary: "Shared detail page",
        stats: { downloads: 12, stars: 0 },
        updatedAt: 1,
      },
      owner: null,
      ownerHandle: "publisher",
      latestVersion: null,
      modInfo: null,
      canManage: false,
      isAuthenticated: false,
      isStaff: false,
      isStarred: false,
      onToggleStar: vi.fn(),
      onOpenReport: vi.fn(),
      onRequireSignIn: vi.fn(),
      forkOf: null,
      forkOfLabel: "fork of",
      forkOfHref: null,
      forkOfOwnerHandle: null,
      canonical: null,
      canonicalHref: null,
      canonicalOwnerHandle: null,
      staffVisibilityTag: null,
      isAutoHidden: false,
      isRemoved: false,
      nixPlugin: undefined,
      hasPluginBundle: false,
      configRequirements: undefined,
      cliHelp: undefined,
      clawdis: undefined,
      installContent: <div>Source install</div>,
      renderSidebarContent: () => <div>Source provenance</div>,
      children: <div>Source tabs</div>,
    };

    render(
      <TooltipProvider>
        <SkillDetailPageView {...props} />
      </TooltipProvider>,
    );

    expect(screen.getByRole("main").classList.contains("skill-detail-page")).toBe(true);
    expect(screen.getByRole("heading", { name: "Demo Skill" })).toBeTruthy();
    expect(screen.getByText("Source install")).toBeTruthy();
    expect(screen.getByText("Source tabs")).toBeTruthy();
    expect(screen.getAllByText("Source provenance")).toHaveLength(2);
  });

  it("omits the fallback title icon and renders source metadata before taxonomy", () => {
    const { container } = render(
      <TooltipProvider>
        <SkillDetailPageView
          {...makeMinimalProps()}
          taxonomyPrefix={<a href="https://skills.sh/example/skills/demo">Synced from skills.sh</a>}
          categories={[{ slug: "development", label: "Development", icon: "wrench", keywords: [] }]}
        />
      </TooltipProvider>,
    );

    expect(container.querySelector(".marketplace-icon")).toBeNull();
    const taxonomy = container.querySelector(".skill-hero-taxonomy-row");
    expect(taxonomy).toBeTruthy();
    expect(taxonomy?.textContent).toContain("Synced from skills.sh");
    expect(taxonomy?.textContent).toContain("Development");
    expect(taxonomy?.querySelector(".skill-hero-taxonomy-separator")).toBeTruthy();
  });

  it.each([
    ["legacy", "brain"],
    ["hosted", `/api/v1/skill-icons/${"a".repeat(64)}`],
  ])("omits the title icon for %s skill icon data", (_kind, icon) => {
    const { container } = render(
      <TooltipProvider>
        <SkillDetailPageView
          {...makeMinimalProps()}
          skill={{
            ...makeMinimalProps().skill,
            icon,
          }}
          categories={[{ slug: "development", label: "Development", icon: "wrench", keywords: [] }]}
        />
      </TooltipProvider>,
    );

    expect(container.querySelector(".skill-hero-title-row .marketplace-icon")).toBeNull();
    expect(container.querySelector(".skill-hero-taxonomy-row .skill-category-icon")).toBeTruthy();
  });
});

function makeMinimalProps(): SkillDetailPageViewProps {
  return {
    skill: {
      slug: "demo",
      displayName: "Demo Skill",
      summary: "Shared detail page",
      icon: null,
      stats: { downloads: 12, stars: 0 },
      updatedAt: 1,
    },
    owner: null,
    ownerHandle: "publisher",
    latestVersion: null,
    modInfo: null,
    canManage: false,
    isAuthenticated: false,
    isStaff: false,
    isStarred: false,
    onToggleStar: vi.fn(),
    onOpenReport: vi.fn(),
    onRequireSignIn: vi.fn(),
    forkOf: null,
    forkOfLabel: "fork of",
    forkOfHref: null,
    forkOfOwnerHandle: null,
    canonical: null,
    canonicalHref: null,
    canonicalOwnerHandle: null,
    staffVisibilityTag: null,
    isAutoHidden: false,
    isRemoved: false,
    nixPlugin: undefined,
    hasPluginBundle: false,
    configRequirements: undefined,
    cliHelp: undefined,
    clawdis: undefined,
  };
}
