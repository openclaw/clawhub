import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/convex/client", () => ({
  convexHttp: { query: vi.fn() },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute:
    () =>
    (config: {
      beforeLoad?: (args: { search: Record<string, unknown> }) => void;
      component?: unknown;
      validateSearch?: unknown;
    }) => ({ __config: config }),
  redirect: (options: unknown) => ({ redirect: options }),
  Link: () => null,
}));

import { Route } from "../routes/skills/index";

function validateSearch(search: Record<string, unknown>) {
  const route = Route as unknown as {
    __config: {
      validateSearch?: (search: Record<string, unknown>) => Record<string, unknown>;
    };
  };
  return route.__config.validateSearch?.(search);
}

function runBeforeLoad(search: Record<string, unknown>) {
  const route = Route as unknown as {
    __config: {
      beforeLoad?: (args: { search: Record<string, unknown> }) => void;
    };
  };
  const beforeLoad = route.__config.beforeLoad;
  if (!beforeLoad) return undefined;

  let thrown: unknown;

  try {
    beforeLoad({ search });
  } catch (error) {
    thrown = error;
  }

  return thrown;
}

describe("skills route default sort", () => {
  it("does not redirect browse view when sort is missing", () => {
    expect(runBeforeLoad({})).toBeUndefined();
  });

  it("does not redirect when query is present", () => {
    expect(runBeforeLoad({ q: "notion" })).toBeUndefined();
  });

  it("does not redirect when filters are present", () => {
    expect(runBeforeLoad({ featured: true })).toBeUndefined();
    expect(runBeforeLoad({ highlighted: true })).toBeUndefined();
  });

  it("preserves invalid topic filters so they cannot become unfiltered requests", () => {
    expect(validateSearch({ topic: "!!!" })).toEqual(expect.objectContaining({ topic: "!!!" }));
  });
});
