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
        badge="Official"
        summaryFallback="Fallback summary"
        meta={<span>meta</span>}
      />,
    );

    expect(screen.getByLabelText("Official")).toBeTruthy();
    expect(screen.queryByText("Official")).toBeNull();
    expect(container.querySelector(".official-badge")).toBeTruthy();
  });

  it("keeps badges after the title and summary", () => {
    const { container } = render(
      <SkillCard
        skill={makeSkill()}
        badge="Official"
        summaryFallback="Fallback summary"
        meta={<span>meta</span>}
      />,
    );

    const title = container.querySelector(".skill-card-title");
    const summary = container.querySelector(".skill-card-summary");
    const tags = container.querySelector(".skill-card-tags");
    expect(title).toBeTruthy();
    expect(summary).toBeTruthy();
    expect(tags).toBeTruthy();
    expect(title!.compareDocumentPosition(tags!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(summary!.compareDocumentPosition(tags!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
