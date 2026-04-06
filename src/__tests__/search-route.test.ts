import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: { validateSearch?: unknown; component?: unknown }) => ({
    __config: config,
  }),
  redirect: (options: unknown) => ({ redirect: options }),
  Link: "a",
  useNavigate: () => vi.fn(),
}));

import { Route } from "../routes/search";

function runValidateSearch(search: Record<string, unknown>) {
  const route = Route as unknown as {
    __config: {
      validateSearch?: (search: Record<string, unknown>) => unknown;
    };
  };
  const validateSearch = route.__config.validateSearch;
  return validateSearch ? validateSearch(search) : {};
}

describe("search route", () => {
  it("validates search with query", () => {
    expect(runValidateSearch({ q: "crab" })).toEqual({
      q: "crab",
      type: undefined,
    });
  });

  it("validates search with type filter", () => {
    expect(runValidateSearch({ q: "crab", type: "skills" })).toEqual({
      q: "crab",
      type: "skills",
    });
  });

  it("ignores invalid type filter", () => {
    expect(runValidateSearch({ q: "crab", type: "invalid" })).toEqual({
      q: "crab",
      type: undefined,
    });
  });

  it("accepts the users type filter", () => {
    expect(runValidateSearch({ q: "vincent", type: "users" })).toEqual({
      q: "vincent",
      type: "users",
    });
  });

  it("strips empty query", () => {
    expect(runValidateSearch({ q: "   " })).toEqual({
      q: undefined,
      type: undefined,
    });
  });

  it("has a component (not a redirect-only route)", () => {
    const route = Route as unknown as {
      __config: { component?: unknown };
    };
    expect(route.__config.component).toBeDefined();
  });
});
