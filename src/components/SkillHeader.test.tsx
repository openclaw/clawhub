/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import type { PublicPublisher, PublicSkill } from "../lib/publicUser";
import { SkillHeader } from "./SkillHeader";
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

describe("SkillHeader", () => {
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
      installsCurrent: 1,
      installsAllTime: 3,
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

  function renderHeader(overrides: Partial<Parameters<typeof SkillHeader>[0]> = {}) {
    const props: Parameters<typeof SkillHeader>[0] = {
      skill,
      owner,
      ownerHandle: "local",
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
      priorityContent: null,
      settingsHref: null,
      ...overrides,
    };

    return render(
      <TooltipProvider>
        <SkillHeader {...props} />
      </TooltipProvider>,
    );
  }

  it("keeps signed-out star and report actions visible and routes clicks to sign-in", () => {
    const onToggleStar = vi.fn();
    const onOpenReport = vi.fn();
    const onRequireSignIn = vi.fn();

    const { container } = renderHeader({ onToggleStar, onOpenReport, onRequireSignIn });

    fireEvent.click(screen.getByRole("button", { name: "Star skill" }));
    fireEvent.click(screen.getByRole("button", { name: "Report" }));

    expect(onRequireSignIn).toHaveBeenCalledTimes(2);
    expect(onToggleStar).not.toHaveBeenCalled();
    expect(onOpenReport).not.toHaveBeenCalled();
    expect(screen.getByText("Creator")).toBeTruthy();
    expect(screen.getByText("Downloads")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(container.querySelector('a[href="/user/local"]')).toBeTruthy();
    expect(
      container.querySelector('nav[aria-label="Skill breadcrumbs"] a[href="/user/local"]'),
    ).toBeTruthy();
  });

  it("shows the 30-day downloads graph from activity data", () => {
    renderHeader({
      activityTrend: {
        downloads: {
          range: "daily",
          days: 30,
          total: 12,
          points: [
            { day: 20_451, value: 1 },
            { day: 20_452, value: 0 },
            { day: 20_453, value: 4 },
            { day: 20_454, value: 2 },
            { day: 20_455, value: 0 },
            { day: 20_456, value: 3 },
            { day: 20_457, value: 2 },
          ],
        },
      },
    });

    expect(screen.getByText("Downloads")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByRole("tablist", { name: "Download period" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "30d" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByText("30-day Installs")).toBeNull();
    expect(screen.queryByText("5")).toBeNull();
    expect(screen.queryByRole("img", { name: "Daily installs over the last 30 days" })).toBeNull();
    expect(screen.getByRole("img", { name: "Daily downloads over the last 30 days" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "About activity counts" })).toHaveLength(1);
  });

  it("reserves graph space while activity metrics are loading", () => {
    const { container } = renderHeader({ activityTrendLoading: true });

    expect(screen.getByText("Downloads")).toBeTruthy();
    expect(screen.queryByText("30-day Installs")).toBeNull();
    expect(container.querySelectorAll(".metric-trend-card-skeleton")).toHaveLength(1);
    expect(screen.queryByRole("img", { name: "Daily installs over the last 30 days" })).toBeNull();
  });

  it("switches download period tabs and updates the chart label", () => {
    renderHeader({
      skill: {
        ...skill,
        stats: { ...skill.stats, downloads: 500 },
      },
      activityTrend: {
        downloads: {
          range: "daily",
          days: 30,
          total: 12,
          points: [
            { day: 20_451, value: 1 },
            { day: 20_452, value: 2 },
            { day: 20_453, value: 3 },
            { day: 20_454, value: 1 },
            { day: 20_455, value: 1 },
            { day: 20_456, value: 2 },
            { day: 20_457, value: 2 },
          ],
        },
      },
    });

    expect(screen.getByText("30 days")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "All time" }));
    expect(screen.getByRole("tab", { name: "All time" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("500")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "7d" }));
    expect(screen.getByText("7 days")).toBeTruthy();
  });

  it("shows the nearest daily download graph point and line marker on hover", () => {
    const { container } = renderHeader({
      activityTrend: {
        downloads: {
          range: "daily",
          days: 30,
          total: 12,
          points: [
            { day: 20_451, value: 1 },
            { day: 20_452, value: 0 },
            { day: 20_453, value: 11 },
          ],
        },
      },
    });

    const chart = screen.getByRole("img", { name: "Daily downloads over the last 30 days" });
    chart.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 100,
        bottom: 34,
        width: 100,
        height: 34,
        toJSON: () => ({}),
      }) satisfies DOMRect;

    fireEvent.pointerMove(chart, { clientX: 100 });

    expect(screen.getByText(/11 downloads$/)).toBeTruthy();
    expect(container.querySelectorAll(".metric-trend-marker-line")).toHaveLength(1);
  });

  it("shows the Official tag in the title for official owner skills", () => {
    const { container } = renderHeader({
      owner: {
        ...owner,
        official: true,
      },
    });

    expect(screen.getByText("Official")).toBeTruthy();
    expect(container.querySelector(".official-tag")).toBeTruthy();
  });

  it("renders canonical topics in the detail hero", () => {
    renderHeader({
      skill: {
        ...skill,
        topics: ["Google Workspace", "Email"],
      },
    });

    expect(screen.getByLabelText("Topics").textContent).toContain("#google-workspace");
    expect(screen.getByLabelText("Topics").textContent).toContain("#email");
  });

  it("shows a New version action for managers above Settings", () => {
    renderHeader({
      canManage: true,
      isAuthenticated: true,
      settingsHref: "/local/demo/settings",
      newVersionHref: "/skills/publish?updateSlug=demo&ownerHandle=local",
    } as Partial<Parameters<typeof SkillHeader>[0]>);

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
    renderHeader({ showArchiveMetadata: false });

    expect(screen.getByText("Downloads")).toBeTruthy();
    expect(screen.getByText("Creator")).toBeTruthy();
    expect(screen.getByText("Last updated")).toBeTruthy();
    expect(screen.queryByText("Current version")).toBeNull();
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

    expect(screen.getByText("Repository")).toBeTruthy();
    const repoLink = screen.getByRole("link", { name: "NVIDIA/skills" });
    expect(repoLink.getAttribute("href")).toBe("https://github.com/NVIDIA/skills");
  });

  it("hides Report for non-staff managers", () => {
    renderHeader({
      canManage: true,
      isAuthenticated: true,
      settingsHref: "/local/demo/settings",
      newVersionHref: "/skills/publish?updateSlug=demo&ownerHandle=local",
    } as Partial<Parameters<typeof SkillHeader>[0]>);

    expect(screen.queryByRole("button", { name: "Report" })).toBeNull();
  });

  it("keeps Report visible for staff managers", () => {
    renderHeader({
      canManage: true,
      isAuthenticated: true,
      isStaff: true,
      settingsHref: "/local/demo/settings",
      newVersionHref: "/skills/publish?updateSlug=demo&ownerHandle=local",
    } as Partial<Parameters<typeof SkillHeader>[0]>);

    expect(screen.getByRole("button", { name: "Report" })).toBeTruthy();
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

  it("shows the latest version description instead of the short catalog summary", () => {
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

    expect(
      screen.getByText(
        "Full uploaded description with more operational context than the short summary.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("Demo summary")).toBeNull();
  });

  it("keeps the download action hidden on the detail header", () => {
    renderHeader({
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
    expect(screen.getByText("Downloads")).toBeTruthy();
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

    expect(screen.getByText("Legacy full description from parsed frontmatter.")).toBeTruthy();
    expect(screen.queryByText("Demo summary")).toBeNull();
  });
});
