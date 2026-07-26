import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarketplaceIcon } from "./MarketplaceIcon";

describe("MarketplaceIcon", () => {
  it("renders hosted skill icons before the category fallback", () => {
    const imageUrl = `/api/v1/skill-icons/${"a".repeat(64)}`;
    const { container } = render(
      <MarketplaceIcon
        kind="skill"
        label="Custom Icon Skill"
        imageUrl={imageUrl}
        skill={{
          slug: "custom-icon-skill",
          displayName: "Custom Icon Skill",
          summary: "Debug and test codebases.",
          categories: ["development"],
        }}
      />,
    );

    expect(container.querySelector("img")?.getAttribute("src")).toBe(imageUrl);
    expect(container.querySelector("svg.marketplace-icon-glyph")).toBeNull();
    expect(
      container
        .querySelector(".marketplace-icon")
        ?.classList.contains("marketplace-icon-image-backed"),
    ).toBe(true);
  });

  it("ignores legacy skill custom-icon values", () => {
    const { container } = render(
      <MarketplaceIcon
        kind="skill"
        label="Legacy Icon Skill"
        imageUrl="lucide:Plug"
        skill={{
          slug: "legacy-icon-skill",
          displayName: "Legacy Icon Skill",
          categories: ["developer-tools"],
        }}
      />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg.marketplace-icon-glyph")).toBeTruthy();
    expect(
      container
        .querySelector(".marketplace-icon")
        ?.classList.contains("marketplace-icon-image-backed"),
    ).toBe(false);
  });

  it("keeps hosted skill icons image-backed in muted contexts", () => {
    const imageUrl = `/api/v1/skill-icons/${"b".repeat(64)}`;
    const { container } = render(
      <MarketplaceIcon kind="skill" label="Muted Icon Skill" imageUrl={imageUrl} tone="muted" />,
    );
    const icon = container.querySelector(".marketplace-icon");

    expect(icon?.classList.contains("marketplace-icon-muted")).toBe(true);
    expect(icon?.classList.contains("marketplace-icon-image-backed")).toBe(true);
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

  it("exposes a muted treatment for neutral marketplace contexts", () => {
    const { container } = render(
      <MarketplaceIcon kind="plugin" label="Muted Plugin" tone="muted" />,
    );

    expect(
      container.querySelector(".marketplace-icon")?.classList.contains("marketplace-icon-muted"),
    ).toBe(true);
  });
});
