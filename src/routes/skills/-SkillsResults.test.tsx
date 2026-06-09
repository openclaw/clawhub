/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import type { ReactNode, RefObject } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import type { PublicPublisher, PublicSkill } from "../../lib/publicUser";
import { SkillsResults } from "./-SkillsResults";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    className,
  }: {
    children?: ReactNode;
    to?: string;
    className?: string;
  }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

vi.mock("../../components/UserBadge", () => ({
  UserBadge: ({
    fallbackHandle,
    user,
  }: {
    fallbackHandle?: string | null;
    user?: { official?: boolean } | null;
  }) => (
    <span>
      {fallbackHandle ?? "unknown"}
      {user?.official ? <span aria-label="Official">Official</span> : null}
    </span>
  ),
}));

describe("SkillsResults", () => {
  it("renders owner-official badges on grid cards", () => {
    const officialOwner = makeOwner({ official: true });
    render(
      <SkillsResults
        isLoadingSkills={false}
        sorted={[
          {
            skill: makeSkill(),
            latestVersion: null,
            ownerHandle: officialOwner.handle,
            owner: officialOwner,
          },
        ]}
        view="grid"
        listDoneLoading={true}
        hasQuery={false}
        canLoadMore={false}
        isLoadingMore={false}
        canAutoLoad={false}
        loadMoreRef={{ current: null } satisfies RefObject<HTMLDivElement | null>}
        loadMore={() => undefined}
      />,
    );

    expect(screen.getAllByLabelText("Official")).toHaveLength(1);
  });
});

function makeSkill(overrides: Partial<PublicSkill> = {}): PublicSkill {
  return {
    _id: "skills:demo" as Id<"skills">,
    _creationTime: 1,
    slug: "demo",
    displayName: "Demo Skill",
    summary: "Demo summary",
    icon: undefined,
    ownerUserId: "users:owner" as Id<"users">,
    ownerPublisherId: "publishers:openclaw" as Id<"publishers">,
    canonicalSkillId: undefined,
    forkOf: undefined,
    latestVersionId: undefined,
    tags: {},
    capabilityTags: [],
    badges: {},
    stats: {
      downloads: 9,
      stars: 2,
      versions: 1,
      comments: 0,
      installsCurrent: 0,
      installsAllTime: 0,
    },
    isSuspicious: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function makeOwner(overrides: Partial<PublicPublisher> = {}): PublicPublisher {
  return {
    _id: "publishers:openclaw" as Id<"publishers">,
    _creationTime: 1,
    kind: "org",
    handle: "openclaw",
    displayName: "OpenClaw",
    image: undefined,
    bio: undefined,
    linkedUserId: undefined,
    ...overrides,
  };
}
