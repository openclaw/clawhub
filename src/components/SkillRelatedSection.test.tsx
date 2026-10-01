/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import type { PublicSkill } from "../lib/publicUser";
import { SkillRelatedSection } from "./SkillRelatedSection";

describe("SkillRelatedSection", () => {
  it("shows only the plain download count in compact related rows", () => {
    const { container } = render(
      <SkillRelatedSection
        category={{
          slug: "productivity",
          label: "Productivity",
          icon: "list-checks",
          keywords: [],
        }}
        relatedSkills={[{ skill: makeSkill(), ownerHandle: "creator" }]}
        isLoading={false}
        variant="compact"
      />,
    );

    const stats = screen.getByLabelText("4,321 downloads");
    expect(stats.textContent).toBe("4.3k");
    expect(stats.querySelector("svg")).toBeNull();
    expect(screen.queryByText("654")).toBeNull();
    expect(screen.queryByText("7.3k")).toBeNull();
    expect(container.querySelector(".lucide-bookmark")).toBeNull();
    expect(container.querySelector(".lucide-download")).toBeNull();
  });
});

function makeSkill(): PublicSkill {
  return {
    _id: "skills:related" as Id<"skills">,
    _creationTime: 1,
    slug: "related",
    displayName: "Related Skill",
    summary: "A related skill.",
    icon: undefined,
    ownerUserId: "users:owner" as Id<"users">,
    ownerPublisherId: "publishers:owner" as Id<"publishers">,
    canonicalSkillId: undefined,
    forkOf: undefined,
    latestVersionId: undefined,
    tags: {},
    badges: {},
    stats: {
      downloads: 4_321,
      stars: 654,
      versions: 1,
      comments: 0,
      installs: 7_300,
    },
    isSuspicious: false,
    createdAt: 1,
    updatedAt: 1,
  };
}
