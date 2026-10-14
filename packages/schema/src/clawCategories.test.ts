import { describe, expect, it } from "vitest";
import { CLAW_CATEGORY_DEFINITIONS, isClawCategorySlug } from "./catalogMetadata";

describe("Claw category taxonomy", () => {
  it("offers the twelve agreed one-word categories", () => {
    expect(CLAW_CATEGORY_DEFINITIONS.map(({ slug }) => slug)).toEqual([
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
    expect(isClawCategorySlug("travel")).toBe(true);
    expect(isClawCategorySlug("marketing")).toBe(false);
    expect(isClawCategorySlug("other")).toBe(false);
  });
});
