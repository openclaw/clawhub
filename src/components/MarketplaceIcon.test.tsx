import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarketplaceIcon } from "./MarketplaceIcon";

describe("MarketplaceIcon", () => {
  it("renders skill glyphs from the primary resolved skill category instead of the custom icon", () => {
    const { container } = render(
      <MarketplaceIcon
        kind="skill"
        label="Custom Icon Skill"
        icon="lucide:Plug"
        skill={{
          slug: "custom-icon-skill",
          displayName: "Custom Icon Skill",
          summary: "Debug and test codebases.",
          categories: ["development"],
        }}
      />,
    );

    const glyph = container.querySelector("svg.marketplace-icon-glyph");
    expect(glyph?.classList.contains("lucide-wrench")).toBe(true);
    expect(glyph?.classList.contains("lucide-plug")).toBe(false);
  });

  it("renders Slash for skills whose stored category cannot resolve", () => {
    const { container } = render(
      <MarketplaceIcon
        kind="skill"
        label="Retired Category Skill"
        skill={{
          slug: "retired-category-skill",
          displayName: "Retired Category Skill",
          summary: "No usable category.",
          categories: ["retired-category"],
        }}
      />,
    );

    const glyph = container.querySelector("svg.marketplace-icon-glyph");
    expect(glyph?.classList.contains("lucide-slash")).toBe(true);
    expect(glyph?.classList.contains("lucide-package")).toBe(false);
  });

  it("renders skill glyphs from current inferred category metadata", () => {
    const { container } = render(
      <MarketplaceIcon
        kind="skill"
        label="Inferred Category Skill"
        skill={{
          slug: "inferred-category-skill",
          displayName: "Inferred Category Skill",
          summary: "No author category, but classifier selected automation.",
          categories: undefined,
          inferredCategories: ["automation"],
          latestVersionId: "version-current",
          inferredFromVersionId: "version-current",
        }}
      />,
    );

    const glyph = container.querySelector("svg.marketplace-icon-glyph");
    expect(glyph?.classList.contains("lucide-zap")).toBe(true);
    expect(glyph?.classList.contains("lucide-slash")).toBe(false);
  });

  it("keeps the generic skill glyph when the caller has no category-capable skill data", () => {
    const { container } = render(<MarketplaceIcon kind="skill" label="Typeahead Skill" />);

    const glyph = container.querySelector("svg.marketplace-icon-glyph");
    expect(glyph?.classList.contains("lucide-package")).toBe(true);
    expect(glyph?.classList.contains("lucide-slash")).toBe(false);
  });
});
