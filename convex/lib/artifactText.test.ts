import { describe, expect, it } from "vitest";
import { decodeBoundedUtf8Text } from "./artifactText";

describe("decodeBoundedUtf8Text", () => {
  it("decodes a bounded prefix of a larger UTF-8 artifact", () => {
    const bytes = new TextEncoder().encode(`dangerous-prefix\n${"a".repeat(1024)}`);
    expect(decodeBoundedUtf8Text(bytes, 64)).toContain("dangerous-prefix");
  });

  it("accepts a prefix ending in a partial multi-byte character", () => {
    const bytes = new TextEncoder().encode(`abc😀${"z".repeat(32)}`);
    expect(decodeBoundedUtf8Text(bytes, 5)).toBe("abc");
  });

  it("rejects invalid UTF-8 within the inspected prefix", () => {
    expect(decodeBoundedUtf8Text(Uint8Array.from([0, 1, 2, 255, 97]), 4)).toBeNull();
  });
});
