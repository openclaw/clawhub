/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import type { PublicPublisher, PublicSkill } from "../lib/publicUser";
import { SkillListItem } from "./SkillListItem";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children?: ReactNode; to?: string }) => <a href={to}>{children}</a>,
}));

describe("SkillListItem", () => {
  it("renders official skills with the compact official mark", () => {
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

    expect(screen.getByLabelText("Verified")).toBeTruthy();
    expect(screen.queryByText("Verified")).toBeNull();
    expect(container.querySelector(".official-badge")).toBeTruthy();
  });

  it("renders the compact official mark for skills owned by official publishers", () => {
    const { container } = render(
      <SkillListItem skill={makeSkill()} owner={makePublisher({ official: true })} />,
    );

    expect(screen.getByLabelText("Verified")).toBeTruthy();
    expect(container.querySelector(".official-badge")).toBeTruthy();
  });

  it("renders up to two author topics in browse rows", () => {
    render(<SkillListItem skill={makeSkill({ topics: ["discord", "community", "automation"] })} />);

    expect(screen.getByText("#discord")).toBeTruthy();
    expect(screen.getByText("#community")).toBeTruthy();
    expect(screen.queryByText("#automation")).toBeNull();
  });

  it("keeps the creator inline without a second avatar", () => {
    const { container } = render(<SkillListItem skill={makeSkill()} ownerHandle="creator" />);

    expect(screen.getByText("@creator")).toBeTruthy();
    expect(container.querySelector(".skill-list-item-main img")).toBeNull();
  });

  it("previews long names without displacing the creator identity", () => {
    const displayName = "L".repeat(71);
    const { container } = render(
      <SkillListItem skill={makeSkill({ displayName })} ownerHandle="creator" />,
    );

    const identity = container.querySelector(".skill-list-item-identity");
    const name = identity?.querySelector(".skill-list-item-name");
    expect(name?.textContent).toBe(`${"L".repeat(69)}…`);
    expect(name?.getAttribute("title")).toBe(displayName);
    expect(identity?.querySelector(".skill-list-item-owner")?.textContent).toBe("@creator");
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
    badges: {},
    stats: {
      downloads: 9,
      stars: 2,
      versions: 1,
      comments: 0,
      installs: 0,
    },
    isSuspicious: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function makePublisher(overrides: Partial<PublicPublisher> = {}): PublicPublisher {
  return {
    _id: "publishers:owner" as Id<"publishers">,
    _creationTime: 1,
    kind: "org",
    handle: "owner",
    displayName: "Owner",
    image: undefined,
    bio: undefined,
    linkedUserId: undefined,
    ...overrides,
  };
}
