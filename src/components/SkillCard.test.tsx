/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import type { PublicSkill } from "../lib/publicUser";
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
      installsCurrent: 0,
      installsAllTime: 0,
    },
    isSuspicious: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}
