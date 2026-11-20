import { describe, expect, it } from "vitest";
import { dashboardSearchParams, parseDashboardSearch } from "./dashboardSearch";

describe("dashboard template filter", () => {
  it("preserves the template filter across URL round trips", () => {
    const state = parseDashboardSearch({ kind: "template", view: "grid" });
    expect(state.kind).toBe("template");
    expect(parseDashboardSearch(dashboardSearchParams(state))).toEqual(state);
  });
  it("continues rejecting unknown kinds", () => {
    expect(parseDashboardSearch({ kind: "something-else" }).kind).toBeUndefined();
  });
});
