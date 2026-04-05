import { describe, expect, it } from "vitest";
import {
  parseBooleanQueryParam,
  parseBooleanQueryParamOptional,
  resolveBooleanQueryParam,
} from "./httpUtils";

describe("parseBooleanQueryParam", () => {
  it("returns true for true-like values", () => {
    expect(parseBooleanQueryParam("true")).toBe(true);
    expect(parseBooleanQueryParam("1")).toBe(true);
    expect(parseBooleanQueryParam(" TRUE ")).toBe(true);
  });

  it("returns false for missing and false-like values", () => {
    expect(parseBooleanQueryParam(null)).toBe(false);
    expect(parseBooleanQueryParam("")).toBe(false);
    expect(parseBooleanQueryParam("false")).toBe(false);
    expect(parseBooleanQueryParam("0")).toBe(false);
    expect(parseBooleanQueryParam("yes")).toBe(false);
  });

  it("supports optional parsing for precedence-sensitive callers", () => {
    expect(parseBooleanQueryParamOptional(null)).toBeUndefined();
    expect(parseBooleanQueryParamOptional("false")).toBe(false);
    expect(parseBooleanQueryParamOptional("1")).toBe(true);
  });

  it("prefers the primary param over the legacy alias when both are present", () => {
    expect(resolveBooleanQueryParam("false", "1")).toBe(false);
    expect(resolveBooleanQueryParam("true", "0")).toBe(true);
    expect(resolveBooleanQueryParam(null, "1")).toBe(true);
    expect(resolveBooleanQueryParam(null, null)).toBeUndefined();
  });
});
