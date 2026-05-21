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
  it("renders the Verified label with the shared verified badge", () => {
    const { container } = render(
      <SkillCard
        skill={makeSkill()}
        badge="Verified"
        summaryFallback="Fallback summary"
        meta={<span>meta</span>}
      />,
    );

    expect(screen.getByText("Verified")).toBeTruthy();
    expect(container.querySelector(".verified-badge")).toBeTruthy();
    expect(container.querySelector(".verified-badge-icon")).toBeTruthy();
  });
});

function makeSkill(): PublicSkill {
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
  };
}
