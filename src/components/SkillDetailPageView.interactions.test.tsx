/* @vitest-environment jsdom */

import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import { makeSkillDetailPageViewProps } from "../__tests__/helpers/skillDetailPageView";
import { setViewportWidth } from "../__tests__/helpers/viewport";
import type { PublicPublisher, PublicSkill } from "../lib/publicUser";
import { SkillDetailPageView } from "./SkillDetailPageView";
import { TooltipProvider } from "./ui/tooltip";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    search,
  }: {
    children?: ReactNode;
    to?: string;
    search?: Record<string, string | number | boolean | undefined>;
  }) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(search ?? {})) {
      if (value !== undefined) params.set(key, String(value));
    }
    const query = params.toString();
    return <a href={`${to ?? "#"}${query ? `?${query}` : ""}`}>{children}</a>;
  },
}));

describe("SkillDetailPageView", () => {
  function sidebarStatsRoot(container: HTMLElement) {
    const node = container.querySelector(".catalog-detail__sidebar");
    if (!node) throw new Error("Missing .catalog-detail__sidebar");
    return node as HTMLElement;
  }

  function heroCreatorRoot(container: HTMLElement) {
    const node = container.querySelector(".skill-catalog-byline");
    if (!node) throw new Error("Missing .skill-catalog-byline");
    return node as HTMLElement;
  }

  function expectCreatorAboveSummary(container: HTMLElement) {
    const summary = container.querySelector(".catalog-detail__summary");
    const creator = container.querySelector(".skill-catalog-byline");
    expect(summary).toBeTruthy();
    expect(creator).toBeTruthy();
    expect(
      creator!.compareDocumentPosition(summary!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  }

  beforeEach(() => {
    setViewportWidth(1071);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const skill: PublicSkill = {
    _id: "skills:demo" as Id<"skills">,
    _creationTime: 1,
    slug: "demo",
    displayName: "Demo Skill",
    summary: "Demo summary",
    ownerUserId: "users:owner" as Id<"users">,
    ownerPublisherId: "publishers:local" as Id<"publishers">,
    canonicalSkillId: undefined,
    forkOf: undefined,
    latestVersionId: undefined,
    tags: {},
    badges: {},
    stats: {
      downloads: 2,
      stars: 7,
      versions: 1,
      comments: 0,
      installs: 3,
    },
    isSuspicious: false,
    createdAt: 1,
    updatedAt: 1,
  };

  const owner: PublicPublisher = {
    _id: "publishers:local" as Id<"publishers">,
    _creationTime: 1,
    kind: "user",
    handle: "local",
    displayName: "Local",
    image: undefined,
    bio: undefined,
    linkedUserId: "users:owner" as Id<"users">,
  };

  function renderHeader(overrides: Partial<Parameters<typeof SkillDetailPageView>[0]> = {}) {
    const props = makeSkillDetailPageViewProps({
      skill,
      owner,
      ownerHandle: "local",
      staffVisibilityAlert: null,
      settingsHref: null,
      ...overrides,
    });

    return render(
      <TooltipProvider>
        <SkillDetailPageView {...props} />
      </TooltipProvider>,
    );
  }

  it("keeps signed-out bookmark and report actions visible and routes clicks to sign-in", () => {
    const onToggleStar = vi.fn();
    const onOpenReport = vi.fn();
    const onRequireSignIn = vi.fn();

    const { container } = renderHeader({ onToggleStar, onOpenReport, onRequireSignIn });

    fireEvent.click(screen.getByRole("button", { name: "Bookmark skill" }));
    fireEvent.click(screen.getByRole("button", { name: "Report" }));

    expect(onRequireSignIn).toHaveBeenCalledTimes(2);
    expect(onToggleStar).not.toHaveBeenCalled();
    expect(onOpenReport).not.toHaveBeenCalled();
    expectCreatorAboveSummary(container);
    expect(within(heroCreatorRoot(container)).getByText("Local")).toBeTruthy();
    expect(within(heroCreatorRoot(container)).getByText("@local")).toBeTruthy();
    expect(within(sidebarStatsRoot(container)).queryByText("Creator")).toBeNull();
    expect(within(sidebarStatsRoot(container)).queryByText("Downloads")).toBeNull();
    expect(container.querySelector('a[href="/local"]')).toBeTruthy();
    expect(screen.getByRole("link", { name: "Skills" }).getAttribute("href")).toBe("/skills");
    expect(
      screen.getByRole("navigation", { name: "Breadcrumb" }).querySelector('[aria-current="page"]')
        ?.textContent,
    ).toBe("Demo Skill");
  });

  it("renders release category labels without comma separators", () => {
    renderHeader({
      skill: { ...skill, topics: ["workflow"] },
      categories: [
        { slug: "automation", label: "Automation", icon: "zap", keywords: [] },
        { slug: "development", label: "Development", icon: "wrench", keywords: [] },
      ],
    });

    const taxonomy = screen.getByLabelText("Categories");
    expect(taxonomy).toBeTruthy();
    expect(taxonomy?.textContent).toContain("Automation");
    expect(taxonomy?.textContent).toContain("Development");
    expect(taxonomy?.textContent).not.toContain(",");
  });

  it("keeps a single facts rail beside the overview", () => {
    const { container } = renderHeader();
    expectCreatorAboveSummary(container);
    const rail = screen.getByRole("complementary");
    expect(within(rail).getByText("Updated")).toBeTruthy();
    expect(within(rail).queryByText("Creator")).toBeNull();
    expect(container.querySelectorAll(".catalog-detail__sidebar")).toHaveLength(1);
  });

  it("keeps the same facts and creator reachable on mobile without duplicate tab panels", () => {
    setViewportWidth(488);
    const { container } = renderHeader();
    expectCreatorAboveSummary(container);
    expect(within(heroCreatorRoot(container)).getByText("@local")).toBeTruthy();
    expect(within(sidebarStatsRoot(container)).getByText("Updated")).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Stats & details" })).toBeNull();
    expect(container.querySelectorAll(".skill-catalog-byline")).toHaveLength(1);
  });

  it("distinguishes an official publisher from an official skill", () => {
    const { container } = renderHeader({
      owner: {
        ...owner,
        official: true,
      },
    });

    const creator = container.querySelector(".skill-catalog-byline");
    expect(creator?.querySelector(".official-badge-icon-only")).toBeNull();
    expect(within(screen.getByRole("complementary")).queryByText("Official publisher")).toBeNull();
    expect(within(heroCreatorRoot(container)).getByText("Local")).toBeTruthy();
  });

  it("keeps canonical topic links on the listing", () => {
    renderHeader({
      skill: {
        ...skill,
        topics: ["Google Workspace", "Email"],
      },
    });

    const topics = screen.getByLabelText("Topics");
    expect(
      within(topics).getByRole("link", { name: "View skills tagged #google-workspace" }),
    ).toBeTruthy();
    expect(within(topics).getByRole("link", { name: "View skills tagged #email" })).toBeTruthy();
  });

  it("shows a New version action for managers above Settings", () => {
    renderHeader({
      canManage: true,
      isAuthenticated: true,
      settingsHref: "/local/demo/settings",
      newVersionHref: "/skills/publish?updateSlug=demo&ownerHandle=local",
    } as Partial<Parameters<typeof SkillDetailPageView>[0]>);

    const newVersionLink = screen.getByRole("link", { name: "New version" });
    const settingsLink = screen.getByRole("link", { name: "Settings" });

    expect(newVersionLink.getAttribute("href")).toBe(
      "/skills/publish?updateSlug=demo&ownerHandle=local",
    );
    expect(
      newVersionLink.compareDocumentPosition(settingsLink) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("does not show a New version action without a manager href", () => {
    renderHeader({
      canManage: false,
      isAuthenticated: true,
      settingsHref: null,
      newVersionHref: null,
    });

    expect(screen.queryByRole("link", { name: "New version" })).toBeNull();
  });

  it("hides archive-only metadata for source-backed skills", () => {
    const { container } = renderHeader({ showArchiveMetadata: false });

    expect(within(sidebarStatsRoot(container)).queryByText("Downloads")).toBeNull();
    expect(within(sidebarStatsRoot(container)).queryByText("Creator")).toBeNull();
    expect(within(heroCreatorRoot(container)).getByText("Local")).toBeTruthy();
    expect(within(sidebarStatsRoot(container)).getByText("Updated")).toBeTruthy();
    expect(screen.queryByText("Version")).toBeNull();
    expect(screen.queryByText("License")).toBeNull();
    expect(screen.queryByText("MIT-0")).toBeNull();
  });

  it("shows the source repository for GitHub-backed skills", () => {
    renderHeader({
      skill: {
        ...skill,
        installKind: "github",
        githubSourceRepo: "NVIDIA/skills",
        githubPath: "skills/accelerated-computing-cudf",
        githubCurrentCommit: "bb0436f",
      },
      showArchiveMetadata: false,
    });

    const details = within(screen.getByRole("complementary"));

    expect(details.queryByText("Repository")).toBeNull();
    const repoLink = within(screen.getByRole("group", { name: "Skill actions" })).getByRole(
      "link",
      { name: "NVIDIA/skills" },
    );
    expect(repoLink.getAttribute("href")).toBe("https://github.com/NVIDIA/skills");
  });

  it("hides Report for non-staff managers", () => {
    renderHeader({
      canManage: true,
      isAuthenticated: true,
      settingsHref: "/local/demo/settings",
      newVersionHref: "/skills/publish?updateSlug=demo&ownerHandle=local",
    } as Partial<Parameters<typeof SkillDetailPageView>[0]>);

    expect(screen.queryByRole("button", { name: "Report" })).toBeNull();
  });

  it("keeps Report visible for staff managers", () => {
    renderHeader({
      canManage: true,
      isAuthenticated: true,
      isStaff: true,
      settingsHref: "/local/demo/settings",
      newVersionHref: "/skills/publish?updateSlug=demo&ownerHandle=local",
    } as Partial<Parameters<typeof SkillDetailPageView>[0]>);

    expect(screen.getByRole("button", { name: "Report" })).toBeTruthy();
  });

  it("shows Manage in the management toolbar for staff", () => {
    const { container } = renderHeader({
      isStaff: true,
      skill: { ...skill, slug: "release-checker" },
    });

    const toolbar = container.querySelector(".skill-management-toolbar");
    expect(toolbar).toBeTruthy();
    const manageLink = within(toolbar as HTMLElement).getByRole("link", { name: "Manage" });
    expect(manageLink.getAttribute("href")).toContain("skill=release-checker");
    expect(within(sidebarStatsRoot(container)).queryByRole("link", { name: "Manage" })).toBeNull();
  });

  it("keeps social controls after the related skills footer, outside the facts", () => {
    renderHeader({ footer: <footer>Related skills</footer> });
    const actions = screen.getByRole("group", { name: "Skill actions" });
    expect(
      screen.getByText("Related skills").compareDocumentPosition(actions) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(actions).getByRole("button", { name: "Report" })).toBeTruthy();
    expect(within(actions).getByRole("button", { name: "Bookmark skill" })).toBeTruthy();
    expect(screen.getByRole("complementary").contains(actions)).toBe(false);
  });

  it("presents the active bookmark control as an Unbookmark action", () => {
    renderHeader({ isAuthenticated: true, isStarred: true });

    const unbookmark = screen.getByRole("button", { name: "Unbookmark skill" });
    expect(unbookmark.textContent).toContain("Unbookmark");
    expect(unbookmark.querySelector(".lucide-bookmark")).toBeTruthy();
  });

  it("keeps one Bookmark control on mobile", () => {
    setViewportWidth(390);
    renderHeader();
    expect(screen.getAllByRole("button", { name: "Bookmark skill" })).toHaveLength(1);
  });

  it("does not render a separate warning banner for scanner warnings", () => {
    renderHeader({
      modInfo: {
        isPendingScan: false,
        isMalwareBlocked: false,
        isSuspicious: true,
        isHiddenByMod: false,
        isRemoved: false,
      },
    });

    expect(screen.queryByText("Security warning — review recommended")).toBeNull();
    expect(screen.queryByText(/Review the scan results before using/i)).toBeNull();
  });

  it("keeps the catalog summary concise with an inline full-description disclosure", () => {
    renderHeader({
      latestVersion: {
        _id: "skillVersions:demo" as Id<"skillVersions">,
        _creationTime: 1,
        skillId: skill._id,
        version: "1.0.0",
        changelog: "Initial release",
        files: [],
        parsed: {
          description:
            "Full uploaded description with more operational context than the short summary.",
          frontmatter: {},
        },
        createdBy: "users:owner" as Id<"users">,
        createdAt: 1,
      },
    });

    expect(screen.getByText("Demo summary").closest(".catalog-detail__summary")).toBeTruthy();
    const description =
      "Full uploaded description with more operational context than the short summary.";
    const disclosure = screen.getByText(description).closest("details");
    expect(disclosure).toBeTruthy();
    expect(disclosure?.open).toBe(false);
    expect(disclosure?.querySelector("summary")?.textContent).toBe("Full description");
  });

  it("prefers the resolved presentation summary for the latest version", () => {
    renderHeader({
      latestVersion: {
        _id: "skillVersions:demo" as Id<"skillVersions">,
        _creationTime: 1,
        skillId: skill._id,
        version: "1.0.0",
        changelog: "Initial release",
        files: [],
        parsed: {
          presentation: {
            displayName: "OpenAI Presentation Fixture",
            summary: "Feed-ready OpenAI summary.",
          },
          description: "Full uploaded description.",
          frontmatter: {},
        },
        createdBy: "users:owner" as Id<"users">,
        createdAt: 1,
      },
    });

    expect(screen.getByText("Demo summary").closest(".catalog-detail__summary")).toBeTruthy();
    expect(screen.getByText("Feed-ready OpenAI summary.").closest("details")).toBeTruthy();
    expect(screen.queryByText("Full uploaded description.")).toBeNull();
  });

  it("keeps the download action hidden on the detail header", () => {
    const { container } = renderHeader({
      latestVersion: {
        _id: "skillVersions:demo" as Id<"skillVersions">,
        _creationTime: 1,
        skillId: skill._id,
        version: "1.0.0",
        changelog: "Initial release",
        files: [],
        createdBy: "users:owner" as Id<"users">,
        createdAt: 1,
      },
    });

    expect(screen.queryByRole("link", { name: "Download" })).toBeNull();
    expect(within(sidebarStatsRoot(container)).queryByText("Downloads")).toBeNull();
  });

  it("falls back to legacy parsed frontmatter description when present", () => {
    renderHeader({
      latestVersion: {
        _id: "skillVersions:demo" as Id<"skillVersions">,
        _creationTime: 1,
        skillId: skill._id,
        version: "1.0.0",
        changelog: "Initial release",
        files: [],
        parsed: {
          frontmatter: {
            description: "Legacy full description from parsed frontmatter.",
          },
        },
        createdBy: "users:owner" as Id<"users">,
        createdAt: 1,
      },
    });

    expect(screen.getByText("Demo summary").closest(".catalog-detail__summary")).toBeTruthy();
    expect(
      screen.getByText("Legacy full description from parsed frontmatter.").closest("details"),
    ).toBeTruthy();
  });
});
