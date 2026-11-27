/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import { makePublicPublisher, makePublicSkill } from "../__tests__/helpers/publicCatalog";
import type { PublicSkill } from "../lib/publicUser";
import { SkillRelatedSection } from "./SkillRelatedSection";

const category = {
  slug: "productivity",
  label: "Productivity",
  icon: "list-checks",
  keywords: ["task"],
};

describe("SkillRelatedSection", () => {
  it("shows only the plain download count in compact related rows", () => {
    const { container } = render(
      <SkillRelatedSection
        category={category}
        relatedSkills={[{ skill: makeSkill(), ownerHandle: "creator" }]}
        isLoading={false}
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

  it.each([
    { ownerHandle: " creator ", owner: null, label: "creator", href: "/creator/skills/related" },
    {
      ownerHandle: null,
      owner: makePublicPublisher({ handle: " team " }),
      label: "team",
      href: "/team/skills/related",
    },
    {
      ownerHandle: null,
      owner: null,
      label: "publishers:owner",
      href: "/publishers%3Aowner/skills/related",
    },
  ])(
    "keeps the owner label and canonical row link for $label",
    ({ ownerHandle, owner, label, href }) => {
      render(
        <SkillRelatedSection
          category={category}
          relatedSkills={[{ skill: makeSkill(), ownerHandle, owner }]}
          isLoading={false}
        />,
      );
      expect(screen.getByText(`@${label}`)).toBeTruthy();
      expect(screen.getByRole("link", { name: /Related Skill/ }).getAttribute("href")).toBe(href);
      expect(screen.getByRole("link", { name: "More in Productivity" }).getAttribute("href")).toBe(
        "/skills?category=productivity",
      );
    },
  );

  it("keeps three complete skeleton rows while related results are loading", () => {
    const { container } = render(
      <SkillRelatedSection
        category={category}
        relatedSkills={[{ skill: makeSkill() }]}
        isLoading
      />,
    );
    expect(screen.getByRole("heading", { name: "Related skills" })).toBeTruthy();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(container.querySelectorAll(".related-skill-row-skeleton")).toHaveLength(3);
    expect(container.querySelectorAll(".related-skill-owner-skeleton")).toHaveLength(3);
    expect(container.querySelectorAll(".related-skill-icon-skeleton")).toHaveLength(3);
    expect(screen.queryByRole("link", { name: /Related Skill/ })).toBeNull();
  });

  it("keeps input ordering, limits rows to five, and truncates long summaries", () => {
    const summary = "A".repeat(90);
    const relatedSkills = Array.from({ length: 6 }, (_, index) => ({
      skill: makeSkill({
        _id: `skills:${index}` as Id<"skills">,
        slug: `related-${index}`,
        displayName: `Related ${index}`,
        summary,
      }),
      ownerHandle: "creator",
    }));
    const { container } = render(
      <SkillRelatedSection category={category} relatedSkills={relatedSkills} isLoading={false} />,
    );
    expect(
      Array.from(container.querySelectorAll(".related-skill-name"), (node) => node.textContent),
    ).toEqual(["Related 0", "Related 1", "Related 2", "Related 3", "Related 4"]);
    expect(screen.queryByText("Related 5")).toBeNull();
    expect(screen.getAllByText(`${"A".repeat(79)}…`)).toHaveLength(5);
    expect(container.querySelector('[aria-busy="false"]')).not.toBeNull();
  });

  it.each([
    { category: null, relatedSkills: [{ skill: makeSkill() }], isLoading: false },
    { category: null, relatedSkills: [], isLoading: true },
    { category, relatedSkills: [], isLoading: false },
  ])("does not render without a category or settled results %#", (props) => {
    const { container } = render(<SkillRelatedSection {...props} />);
    expect(container.innerHTML).toBe("");
  });
});

function makeSkill(overrides: Partial<PublicSkill> = {}): PublicSkill {
  return makePublicSkill({
    _id: "skills:related" as Id<"skills">,
    slug: "related",
    displayName: "Related Skill",
    summary: "A related skill.",
    stats: {
      downloads: 4_321,
      stars: 654,
      versions: 1,
      comments: 0,
      installs: 7_300,
    },
    ...overrides,
  });
}
