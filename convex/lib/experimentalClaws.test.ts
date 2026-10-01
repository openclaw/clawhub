import { describe, expect, it } from "vitest";
import { experimentalClawsEnabled, isClawFamilyPubliclyVisible } from "./experimentalClaws";

describe("experimental Claw visibility", () => {
  it("requires the exact deployment gate value", () => {
    expect(experimentalClawsEnabled({})).toBe(false);
    expect(experimentalClawsEnabled({ CLAWHUB_EXPERIMENTAL_CLAWS: "true" })).toBe(false);
    expect(experimentalClawsEnabled({ CLAWHUB_EXPERIMENTAL_CLAWS: "1" })).toBe(true);
  });

  it("keeps existing package families visible while gating Claws", () => {
    expect(isClawFamilyPubliclyVisible("code-plugin", {})).toBe(true);
    expect(isClawFamilyPubliclyVisible("claw", {})).toBe(false);
    expect(isClawFamilyPubliclyVisible("claw", { CLAWHUB_EXPERIMENTAL_CLAWS: "1" })).toBe(true);
  });
});
