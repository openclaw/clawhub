import { describe, expect, it } from "vitest";
import {
  isReusableCompletedSecurityScanVerdict,
  isSecurityScanStatusBlockedFromPublic,
  isSecurityScanStatusCompletedNonBlocked,
  normalizeSecurityScanStatus,
  shouldPreserveSecurityScanStateForUnchangedContent,
  type SecurityScanStatus,
} from "./securityScanPolicy";

describe("security scan policy", () => {
  it.each([
    ["benign", "clean"],
    [" clean ", "clean"],
    ["suspicious", "suspicious"],
    ["malicious", "malicious"],
    ["pending", "pending"],
    ["failed", "failed"],
    ["not-run", "not-run"],
    ["completed", undefined],
    [undefined, undefined],
  ] satisfies Array<[string | undefined, SecurityScanStatus | undefined]>)(
    "normalizes %s to %s",
    (status, expected) => {
      expect(normalizeSecurityScanStatus(status)).toBe(expected);
    },
  );

  it.each([
    ["clean", true],
    ["suspicious", true],
    ["pending", false],
    ["failed", false],
    ["malicious", false],
    ["not-run", false],
    [undefined, false],
  ] satisfies Array<[SecurityScanStatus | undefined, boolean]>)(
    "treats %s completed non-blocked state as %s",
    (status, expected) => {
      expect(isSecurityScanStatusCompletedNonBlocked(status)).toBe(expected);
    },
  );

  it.each([
    ["clean", false],
    ["suspicious", false],
    ["pending", false],
    ["failed", true],
    ["malicious", true],
    ["not-run", false],
    [undefined, false],
  ] satisfies Array<[SecurityScanStatus | undefined, boolean]>)(
    "treats %s public block state as %s",
    (status, expected) => {
      expect(isSecurityScanStatusBlockedFromPublic(status)).toBe(expected);
    },
  );

  it("reuses only completed scan verdicts", () => {
    expect(isReusableCompletedSecurityScanVerdict("clean")).toBe(true);
    expect(isReusableCompletedSecurityScanVerdict("suspicious")).toBe(true);
    expect(isReusableCompletedSecurityScanVerdict("malicious")).toBe(true);
    expect(isReusableCompletedSecurityScanVerdict("failed")).toBe(false);
    expect(isReusableCompletedSecurityScanVerdict("pending")).toBe(false);
    expect(isReusableCompletedSecurityScanVerdict("not-run")).toBe(false);
    expect(isReusableCompletedSecurityScanVerdict(undefined)).toBe(false);
  });

  it("preserves failed state for unchanged content without treating it as reusable", () => {
    expect(shouldPreserveSecurityScanStateForUnchangedContent("clean")).toBe(true);
    expect(shouldPreserveSecurityScanStateForUnchangedContent("suspicious")).toBe(true);
    expect(shouldPreserveSecurityScanStateForUnchangedContent("malicious")).toBe(true);
    expect(shouldPreserveSecurityScanStateForUnchangedContent("failed")).toBe(true);
    expect(shouldPreserveSecurityScanStateForUnchangedContent("pending")).toBe(false);
    expect(shouldPreserveSecurityScanStateForUnchangedContent("not-run")).toBe(false);
    expect(shouldPreserveSecurityScanStateForUnchangedContent(undefined)).toBe(false);
  });
});
