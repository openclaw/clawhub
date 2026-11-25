/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeSkillDetailPageViewProps } from "../__tests__/helpers/skillDetailPageView";
import { SkillDetailPageView } from "./SkillDetailPageView";
import { TooltipProvider } from "./ui/tooltip";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children?: ReactNode; to?: string }) => (
    <a href={to ?? "#"}>{children}</a>
  ),
}));

describe("SkillDetailPageView", () => {
  afterEach(cleanup);

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

  it.each([false, true])(
    "shows exactly one inline install card in the sidebar on desktop and mobile (%s)",
    (mobile) => {
      vi.stubGlobal("matchMedia", () => ({
        matches: mobile,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }));
      render(
        <TooltipProvider>
          <SkillDetailPageView {...makeMinimalProps()} />
        </TooltipProvider>,
      );
      const card = screen.getByRole("article", { name: "Install" });
      expect(screen.getByRole("complementary").contains(card)).toBe(true);
      expect(screen.queryByRole("button", { name: /^(Add|Install|Install options)$/ })).toBeNull();
      expect(screen.queryByRole("dialog")).toBeNull();
    },
  );

  it("shows only the available discovered Skill facts in registry order", () => {
    const props = makeInstallableProps();
    render(
      <TooltipProvider>
        <SkillDetailPageView
          {...props}
          skill={{ ...props.skill, updatedAt: new Date(2026, 4, 11, 12).getTime() }}
          latestVersion={{
            ...props.latestVersion,
            parsed: { frontmatter: {}, license: "MIT-0", clawdis: { os: ["darwin", "linux"] } },
            llmAnalysis: { status: "malicious", checkedAt: 1 },
          }}
          securityAuditHref="/publisher/skills/demo/security-audit"
          versionHistory={<button type="button">Version history</button>}
        />
      </TooltipProvider>,
    );
    const rail = within(screen.getByRole("complementary"));
    expect(rail.getAllByRole("term").map((el) => el.textContent)).toEqual([
      "Security check",
      "Version",
      "Updated",
      "License",
      "Platforms",
    ]);
    expect(rail.getAllByRole("definition").map((el) => el.textContent)).toEqual([
      "Blocked",
      "1.0.0",
      "May 11, 2026",
      "MIT-0",
      "darwinlinux",
    ]);
    expect(
      rail.getByRole("link", { name: "Full security report: Blocked" }).getAttribute("href"),
    ).toBe("/publisher/skills/demo/security-audit");
    for (const name of ["Version history", "Bookmark skill", "Report"]) {
      expect(rail.queryByRole("button", { name })).toBeNull();
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
  });

  it("does not invent a pending security scan, license or platforms for a bare release", () => {
    render(
      <TooltipProvider>
        <SkillDetailPageView
          {...makeInstallableProps()}
          securityAuditHref="/publisher/skills/demo/security-audit"
        />
      </TooltipProvider>,
    );
    const rail = within(screen.getByRole("complementary"));
    expect(rail.getAllByRole("term").map((el) => el.textContent)).toEqual(["Version", "Updated"]);
    expect(screen.getByRole("link", { name: "Full security report" })).toBeTruthy();
  });

  it("offers only an owner-qualified identity intent for a current hosted skill", () => {
    render(
      <TooltipProvider>
        <SkillDetailPageView {...makeInstallableProps()} />
      </TooltipProvider>,
    );
    const card = within(screen.getByRole("complementary")).getByRole("article", {
      name: "Install",
    });
    fireEvent.click(within(card).getByRole("button", { name: "Desktop" }));
    const link = within(card).getByRole("link", { name: "Install in OpenClaw" });
    expect(link.getAttribute("href")).toBe("openclaw://skills/install?name=%40publisher%2Fdemo");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(link.querySelector("svg")).toBeNull();
  });

  it.each([
    { latestVersion: null },
    { ownerHandle: null },
    { isPendingPublication: true },
    { isRemoved: true },
    { isAutoHidden: true },
    ...["isPendingScan", "isMalwareBlocked", "isHiddenByMod", "isRemoved"].map((flag) => ({
      modInfo: {
        isPendingScan: false,
        isMalwareBlocked: false,
        isHiddenByMod: false,
        isRemoved: false,
        isSuspicious: false,
        [flag]: true,
      },
    })),
    {
      modInfo: {
        isPendingScan: false,
        isMalwareBlocked: false,
        isHiddenByMod: false,
        isRemoved: false,
        isSuspicious: false,
        verdict: "malicious" as const,
      },
    },
  ])("does not offer an app intent for an unavailable skill: %j", (overrides) => {
    render(
      <TooltipProvider>
        <SkillDetailPageView {...makeInstallableProps()} {...overrides} />
      </TooltipProvider>,
    );
    expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Install options" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Desktop" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Install in OpenClaw" })).toBeNull();
  });

  it("does not turn GitHub-only or external-source cards into hosted install intents", () => {
    const props = makeInstallableProps();
    render(
      <TooltipProvider>
        <SkillDetailPageView {...props} skill={{ ...props.skill, installKind: "github" }} />
      </TooltipProvider>,
    );
    expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Install options" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Desktop" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Install in OpenClaw" })).toBeNull();
  });

  it("tells the owner when publication checks failed and where to get help", () => {
    render(
      <TooltipProvider>
        <SkillDetailPageView
          {...makeMinimalProps()}
          canManage
          isAuthenticated
          publicationProgress={{
            version: "2.0.0",
            stage: "checks_failed",
            retrying: true,
            updatedAt: 3,
            checks: { trufflehog: "clean", clawscan: "failed" },
          }}
        />
      </TooltipProvider>,
    );
    expect(screen.getByRole("status").textContent).toContain("Publication checks failed");
    expect(screen.getByRole("status").textContent).toContain("2.0.0");
    expect(screen.getByRole("status").textContent).toContain("not yet public or installable");
    expect(screen.getByRole("status").textContent).toContain("Security check: could not complete");
    expect(screen.getByRole("link", { name: "Contact support" }).getAttribute("href")).toBe(
      "https://community.openclaw.ai/",
    );
  });

  it("owns the whole shared detail page while rendering source-specific slots", () => {
    const props = makeSkillDetailPageViewProps({
      skill: {
        slug: "demo",
        displayName: "Demo Skill",
        summary: "Shared detail page",
        stats: { downloads: 12, stars: 0 },
        updatedAt: 1,
      },
      installContent: <div>Source install</div>,
      renderSidebarContent: () => <div>Source provenance</div>,
      children: <div>Source tabs</div>,
    });

    render(
      <TooltipProvider>
        <SkillDetailPageView {...props} />
      </TooltipProvider>,
    );

    expect(screen.getByRole("main").classList.contains("skill-detail-page")).toBe(true);
    expect(screen.getByRole("heading", { name: "Demo Skill" })).toBeTruthy();
    expect(screen.getByText("Source install")).toBeTruthy();
    expect(screen.getByText("Source tabs")).toBeTruthy();
    expect(screen.getAllByText("Source provenance")).toHaveLength(1);
  });

  it("renders the book fallback and keeps source metadata before taxonomy", () => {
    const { container } = render(
      <TooltipProvider>
        <SkillDetailPageView
          {...makeMinimalProps()}
          taxonomyPrefix={<a href="https://skills.sh/example/skills/demo">Synced from skills.sh</a>}
          categories={[{ slug: "development", label: "Development", icon: "wrench", keywords: [] }]}
        />
      </TooltipProvider>,
    );

    expect(container.querySelector(".catalog-detail__icon .lucide-book-open-text")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "View files" })).toBeNull();
    const taxonomy = container.querySelector(".skill-hero-taxonomy-row");
    expect(taxonomy).toBeTruthy();
    expect(taxonomy?.textContent).toContain("Synced from skills.sh");
    expect(taxonomy?.textContent).toContain("Development");
    expect(taxonomy?.querySelector(".skill-hero-taxonomy-separator")).toBeTruthy();
  });

  it("uses a publisher image only if the registry would admit it as skill artwork", () => {
    const hosted = "/api/v1/skill-icons/" + "b".repeat(64);
    const props = makeMinimalProps();
    const owner = { ...props.owner!, image: "https://avatars.githubusercontent.com/u/1" };
    const { container, rerender } = render(
      <TooltipProvider>
        <SkillDetailPageView {...props} owner={owner} />
      </TooltipProvider>,
    );
    expect(container.querySelector(".skill-catalog-tile img")).toBeNull();
    rerender(
      <TooltipProvider>
        <SkillDetailPageView {...props} owner={{ ...owner, image: hosted }} />
      </TooltipProvider>,
    );
    expect(container.querySelector(".skill-catalog-tile--profile img")?.getAttribute("src")).toBe(
      hosted,
    );
  });

  it.each([
    ["legacy", "brain"],
    ["hosted", `/api/v1/skill-icons/${"a".repeat(64)}`],
  ])("uses only content-addressed artwork for %s skill icon data", (_kind, icon) => {
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

    const image = container.querySelector(".catalog-detail__icon img");
    if (_kind === "hosted") expect(image?.getAttribute("src")).toBe(icon);
    else expect(image).toBeNull();
    expect(container.querySelector(".skill-hero-taxonomy-row .skill-category-icon")).toBeTruthy();
  });
});

function makeMinimalProps() {
  return makeSkillDetailPageViewProps({
    skill: {
      slug: "demo",
      displayName: "Demo Skill",
      summary: "Shared detail page",
      icon: null,
      stats: { downloads: 12, stars: 0 },
      updatedAt: 1,
    },
  });
}

function makeInstallableProps() {
  const props = makeMinimalProps();
  return {
    ...props,
    latestVersion: {
      _id: "skillVersions:demo" as import("../../convex/_generated/dataModel").Id<"skillVersions">,
      _creationTime: 1,
      skillId: "skills:demo" as import("../../convex/_generated/dataModel").Id<"skills">,
      version: "1.0.0",
      changelog: "Initial",
      files: [],
      parsed: { frontmatter: {} },
      createdBy: "users:owner" as import("../../convex/_generated/dataModel").Id<"users">,
      createdAt: 1,
    },
  };
}
