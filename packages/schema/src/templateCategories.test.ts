import { describe, expect, it } from "vitest";
import { TEMPLATE_CATEGORY_DEFINITIONS, isTemplateCategorySlug } from "./catalogMetadata";

describe("Template category taxonomy", () => {
  it("offers the twelve agreed one-word categories", () => {
    expect(TEMPLATE_CATEGORY_DEFINITIONS.map(({ slug }) => slug)).toEqual([
      "personal",
      "health",
      "travel",
      "productivity",
      "research",
      "engineering",
      "governance",
      "operations",
      "finance",
      "sales",
      "product",
      "people",
    ]);
  });

  it("does not accept arbitrary or fallback categories as declarations", () => {
    expect(isTemplateCategorySlug("travel")).toBe(true);
    expect(isTemplateCategorySlug("marketing")).toBe(false);
    expect(isTemplateCategorySlug("other")).toBe(false);
  });
});
