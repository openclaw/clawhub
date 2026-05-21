/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import type { PublicSkill } from "../lib/publicUser";
import { SkillListItem } from "./SkillListItem";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children?: ReactNode; to?: string }) => <a href={to}>{children}</a>,
}));

describe("SkillListItem", () => {
  it("renders official skills with the shared verified badge", () => {
    const { container } = render(
      <SkillListItem
        skill={makeSkill({
          badges: {
            official: {
              byUserId: "users:admin" as Id<"users">,
              at: 1,
            },
          },
        })}
        ownerHandle="local"
      />,
    );

    expect(screen.getByText("Verified")).toBeTruthy();
    expect(container.querySelector(".verified-badge")).toBeTruthy();
    expect(container.querySelector(".verified-badge-icon")).toBeTruthy();
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
    ownerPublisherId: "publishers:owner" as Id<"publishers">,
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
