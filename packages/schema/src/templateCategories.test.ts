import { describe, expect, it } from "vitest";
import {
  LEGACY_TEMPLATE_CATEGORY_DEFINITIONS,
  TEMPLATE_CATEGORY_DEFINITIONS,
  getTemplateCategoryLabel,
  isTemplateCategoryFilterSlug,
  isTemplateCategorySlug,
  resolveDeclaredTemplateCategory,
} from "./catalogMetadata";

const REMOVED = ["personal", "governance", "finance", "people"];

describe("Template category taxonomy", () => {
  it("offers the ten agreed categories in display order", () => {
    expect(TEMPLATE_CATEGORY_DEFINITIONS.map(({ slug }) => slug)).toEqual([
      "engineering",
      "operations",
      "household",
      "entertainment",
      "travel",
      "productivity",
      "research",
      "health",
      "sales",
      "product",
    ]);
  });

  it("uses the agreed icons for the two new categories", () => {
    const icons = new Map(TEMPLATE_CATEGORY_DEFINITIONS.map(({ slug, icon }) => [slug, icon]));
    expect(icons.get("household")).toBe("house");
    expect(icons.get("entertainment")).toBe("popcorn");
  });

  it("gives the classifier a distinct, non-empty description for every category", () => {
    const descriptions = TEMPLATE_CATEGORY_DEFINITIONS.map(({ description }) => description);
    expect(descriptions.every((description) => description.trim().length > 0)).toBe(true);
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });

  it("does not accept arbitrary, fallback, or removed categories as declarations", () => {
    expect(isTemplateCategorySlug("travel")).toBe(true);
    expect(isTemplateCategorySlug("household")).toBe(true);
    expect(isTemplateCategorySlug("marketing")).toBe(false);
    expect(isTemplateCategorySlug("other")).toBe(false);
    for (const slug of REMOVED) expect(isTemplateCategorySlug(slug)).toBe(false);
  });

  it("keeps removed categories out of the current set but readable as filters", () => {
    expect(LEGACY_TEMPLATE_CATEGORY_DEFINITIONS.map(({ slug }) => slug)).toEqual(REMOVED);
    const current = new Set<string>(TEMPLATE_CATEGORY_DEFINITIONS.map(({ slug }) => slug));
    for (const slug of REMOVED) {
      expect(current.has(slug)).toBe(false);
      expect(isTemplateCategoryFilterSlug(slug)).toBe(true);
    }
    for (const slug of current) expect(isTemplateCategoryFilterSlug(slug)).toBe(true);
    expect(isTemplateCategoryFilterSlug("other")).toBe(true);
    expect(isTemplateCategoryFilterSlug("marketing")).toBe(false);
    expect(isTemplateCategoryFilterSlug("")).toBe(false);
  });

  it("labels current and removed categories and passes unknown slugs through", () => {
    expect(getTemplateCategoryLabel("household")).toBe("Household");
    expect(getTemplateCategoryLabel("personal")).toBe("Personal");
    expect(getTemplateCategoryLabel("custom-category")).toBe("custom-category");
  });
});

describe("resolveDeclaredTemplateCategory", () => {
  it("uses the first declared category and ignores the rest", () => {
    expect(resolveDeclaredTemplateCategory(["engineering", "operations"])).toBe("engineering");
    expect(resolveDeclaredTemplateCategory(["travel", "personal"])).toBe("travel");
    expect(resolveDeclaredTemplateCategory(["household"])).toBe("household");
  });

  it.each([
    { declared: ["personal", "productivity"] },
    { declared: ["governance"] },
    { declared: ["made-up", "travel"] },
    { declared: ["other"] },
    { declared: [] },
    { declared: undefined },
    { declared: null },
  ])("does not fall through to a later category for $declared", ({ declared }) => {
    expect(resolveDeclaredTemplateCategory(declared)).toBeUndefined();
  });
});
