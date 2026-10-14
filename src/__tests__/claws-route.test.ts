import { defaultParseSearch } from "@tanstack/react-router";
import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/clawDiscovery", () => ({
  fetchClawDiscovery: vi.fn(),
  clawCategoryLabel: vi.fn(),
}));
vi.mock("../components/ClawDiscovery", () => ({ ClawDiscovery: vi.fn(), ClawSearch: vi.fn() }));

import { Route } from "../routes/claws/index";

const validateSearch = Route.options.validateSearch as (search: Record<string, unknown>) => {
  q?: string;
  category?: string;
};

describe("Claw browse URLs", () => {
  it.each(["365", "true", "false", "null", "Sift"])(
    "preserves the native GET search term %s",
    (query) => {
      expect(validateSearch(defaultParseSearch(`?q=${query}&category=research`))).toEqual({
        q: query,
        category: "research",
      });
    },
  );
  it("rejects structured values and bounds text input", () => {
    expect(validateSearch({ q: ["Sift"], category: { name: "research" } })).toEqual({
      q: undefined,
      category: undefined,
    });
    expect(validateSearch({ q: "a".repeat(300), category: "b".repeat(300) })).toEqual({
      q: "a".repeat(200),
      category: "b".repeat(100),
    });
  });
});
