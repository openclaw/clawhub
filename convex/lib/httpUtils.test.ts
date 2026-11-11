/* @vitest-environment node */

import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import {
  getTransientConvexErrorKind,
  isConvexWritePressureError,
  parseBooleanQueryParam,
  parseBooleanQueryParamOptional,
  resolveBooleanQueryParam,
} from "./httpUtils";

describe("isConvexWritePressureError", () => {
  it("recognizes only the captured typed capacity signature", () => {
    expect(
      isConvexWritePressureError(
        new Error("CommitterFullError: Too many writes in a short period of time."),
      ),
    ).toBe(true);
    for (const error of [
      new Error("Too many writes in a short period of time."),
      new Error("Invalid upload SHA-256"),
      new Error("CommitterFullError: Invalid argument"),
      "CommitterFullError: Too many writes in a short period of time.",
      null,
    ])
      expect(isConvexWritePressureError(error)).toBe(false);
  });
});

describe("getTransientConvexErrorKind", () => {
  it.each([
    "[Request ID: 0123456789abcdef] Server Error\nUncaught Error: InternalServerError: Transient error while running generate upload url",
    "InternalServerError: Your request couldn't be completed. Try again later.",
    "Your request couldn't be completed. Try again later.",
    "Overloaded: The deployment is overloaded. Try again later.",
    "CommitterFullError: Too many writes in a short period of time. (reset in 43s)",
  ])("classifies a Convex platform failure as system: %s", (message) => {
    expect(getTransientConvexErrorKind(new Error(message))).toBe("system");
  });

  it.each([
    'Documents read from or written to the "publishers" table changed while this mutation was being run and on every subsequent retry.',
    'Document in table "rateLimits" changed while this mutation was being run',
    "Optimistic concurrency control failure",
  ])("classifies a write conflict: %s", (message) => {
    expect(getTransientConvexErrorKind(new Error(message))).toBe("write_conflict");
  });

  it.each([
    new Error("Version 1.0.0 already exists. Increment the version number and try again."),
    new Error("Invalid file path: InternalServerError.md"),
    new Error("Too many writes in a short period of time."),
    new Error("Unauthorized"),
    new ConvexError("InternalServerError: is a reserved skill name"),
    new ConvexError("Your request couldn't be completed. Try again later."),
    "InternalServerError: Transient error while running mutation",
    null,
  ])("leaves application and validation failures unclassified: %s", (error) => {
    expect(getTransientConvexErrorKind(error)).toBeNull();
  });
});

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
