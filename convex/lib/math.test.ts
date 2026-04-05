import { describe, expect, it } from "vitest";
import { clampInt } from "./math";

describe("clampInt", () => {
  it("clamps within range", () => {
    expect(clampInt(5, 1, 10)).toBe(5);
  });

  it("clamps below min", () => {
    expect(clampInt(-3, 1, 10)).toBe(1);
  });

  it("clamps above max", () => {
    expect(clampInt(20, 1, 10)).toBe(10);
  });

  it("truncates toward zero", () => {
    expect(clampInt(3.9, 1, 10)).toBe(3);
    expect(clampInt(-2.9, -5, 5)).toBe(-2);
  });

  it("returns min for NaN", () => {
    expect(clampInt(NaN, 1, 10)).toBe(1);
  });

  it("returns min for Infinity", () => {
    expect(clampInt(Infinity, 1, 10)).toBe(1);
    expect(clampInt(-Infinity, 1, 10)).toBe(1);
  });

  it("handles exact boundaries", () => {
    expect(clampInt(1, 1, 10)).toBe(1);
    expect(clampInt(10, 1, 10)).toBe(10);
  });
});
