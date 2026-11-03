/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import {
  hasSecretLikeValue,
  redactBundleContent,
  redactSecretValues,
} from "./securityDatasetRedaction";

describe("security dataset redaction", () => {
  it.each([
    "person@example.com",
    `ghp_${"a".repeat(24)}`,
    `sk-${"b".repeat(24)}`,
    `AKIA${"A".repeat(16)}`,
    "api_key=example-secret-value",
    "Authorization: Bearer example-authorization-value",
    "-----BEGIN PRIVATE KEY-----\nexample\n-----END PRIVATE KEY-----",
    "https://example:password@localhost/path",
    `"${"Ab1".repeat(12)}"`,
  ])("redacts and detects %s across repeated calls", (value) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(hasSecretLikeValue(value)).toBe(true);
      expect(redactSecretValues(value)).toBe("[REDACTED_SECRET]");
      expect(hasSecretLikeValue(value)).toBe(true);
      expect(redactBundleContent(value)).toBe("[REDACTED_SECRET]");
      expect(hasSecretLikeValue("ordinary documentation")).toBe(false);
    }
  });

  it("preserves bundle whitespace and DEL while replacing other controls", () => {
    const value = " \t\r\nhello\0\u000b\u001fworld\u007f\n ";
    expect(redactBundleContent(value)).toBe(" \t\r\nhello   world\u007f\n ");
    expect(redactSecretValues(value)).toBe(value);
  });
});
