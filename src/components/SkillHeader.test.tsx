/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import type { PublicPublisher, PublicSkill } from "../lib/publicUser";
import { SkillHeader } from "./SkillHeader";
import { TooltipProvider } from "./ui/tooltip";

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
    capabilityTags: [],
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
    expect(screen.getByText("Owner")).toBeTruthy();
    expect(screen.getByText("Downloads")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(container.querySelector('a[href="/p/local"]')).toBeTruthy();
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
