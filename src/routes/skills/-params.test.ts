import { describe, expect, it } from "vitest";
import { parseSort, sortKeys } from "./-params";

describe("skill sort params", () => {
  it("normalizes legacy installs sort links to downloads", () => {
    expect(parseSort("installs")).toBe("downloads");
  });

  it("exposes downloads as a supported sort", () => {
    expect(sortKeys).toContain("downloads");
  });
});
