/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import type { PublicPublisher, PublicSkill } from "../lib/publicUser";
import { SkillCard } from "./SkillCard";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children?: ReactNode; to?: string }) => <a href={to}>{children}</a>,
}));

describe("SkillCard", () => {
  it("renders official skills with the compact official mark", () => {
    const { container } = render(
      <SkillCard
        skill={makeSkill()}
        badge="Verified"
        summaryFallback="Fallback summary"
        meta={<span>meta</span>}
      />,
    );

    expect(screen.getByLabelText("Verified")).toBeTruthy();
    expect(screen.queryByText("Verified")).toBeNull();
    expect(container.querySelector(".official-badge")).toBeTruthy();
  });

  it("renders the compact official mark for skills owned by official publishers", () => {
    const { container } = render(
      <SkillCard
        skill={makeSkill()}
        owner={makePublisher({ official: true })}
        summaryFallback="Fallback summary"
        meta={<span>meta</span>}
      />,
    );

    expect(screen.getByLabelText("Verified")).toBeTruthy();
    expect(container.querySelector(".official-badge")).toBeTruthy();
  });

  it("renders author topics", () => {
    render(
      <SkillCard
        skill={makeSkill({ topics: ["google-calendar", "productivity"] })}
        summaryFallback="Fallback summary"
        meta={<span>meta</span>}
      />,
    );

    expect(screen.getByText("#google-calendar")).toBeTruthy();
    expect(screen.getByText("#productivity")).toBeTruthy();
  });

  it("shows standard-length names in full and previews longer compatibility names", () => {
    const portableName = "S".repeat(64);
    const compatibilityName = "L".repeat(71);
    const { rerender } = render(
      <SkillCard
        skill={makeSkill({ displayName: portableName })}
        summaryFallback="Fallback summary"
        meta={<span>meta</span>}
      />,
    );

    expect(screen.getByText(portableName)).toBeTruthy();

    rerender(
      <SkillCard
        skill={makeSkill({ displayName: compatibilityName })}
        summaryFallback="Fallback summary"
        meta={<span>meta</span>}
      />,
    );

    const preview = `${"L".repeat(69)}…`;
    expect(screen.getByText(preview).getAttribute("title")).toBe(compatibilityName);
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
      downloads: 0,
      stars: 0,
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
