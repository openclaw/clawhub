import { describe, expect, it } from "vitest";
import { containsLocalPath } from "./validate-sanitized-snapshot";

describe("containsLocalPath", () => {
  it("distinguishes macOS home paths from lowercase API routes", () => {
    expect(containsLocalPath("/Users/patrick/private.txt")).toBe(true);
    expect(containsLocalPath("/users/{owner}/messages")).toBe(false);
  });

  it("detects Windows user paths case-insensitively", () => {
    expect(containsLocalPath("C:\\Users\\Patrick\\private.txt")).toBe(true);
    expect(containsLocalPath("c:\\users\\patrick\\private.txt")).toBe(true);
  });
});
