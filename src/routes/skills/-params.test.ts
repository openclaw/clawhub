import { describe, expect, it } from "vitest";
import { parseSort, sortKeys } from "./-params";

describe("skill sort params", () => {
  it("normalizes legacy downloads sort links to installs", () => {
    expect(parseSort("downloads")).toBe("installs");
  });

  it("does not expose downloads as a supported sort", () => {
    expect(sortKeys).not.toContain("downloads");
  });
});
