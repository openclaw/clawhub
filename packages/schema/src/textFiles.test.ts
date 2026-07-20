/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import * as schema from ".";
import { decodeUtf8Text, normalizeContentType } from "./textFiles";

describe("clawhub-schema textFiles", () => {
  it("detects UTF-8 text from bytes instead of file extensions", () => {
    expect(decodeUtf8Text(new TextEncoder().encode('resource "null_resource" "demo" {}'))).toBe(
      'resource "null_resource" "demo" {}',
    );
    expect(decodeUtf8Text(Uint8Array.from([0, 1, 2, 255]))).toBeNull();
    expect(decodeUtf8Text(Uint8Array.from([0xc3, 0x28]))).toBeNull();
  });

  it("normalizes supplied MIME types without consulting file extensions", () => {
    expect(normalizeContentType("video/mp2t")).toBe("video/mp2t");
    expect(normalizeContentType("text/markdown; charset=utf-8")).toBe("text/markdown");
    expect(normalizeContentType("image/png")).toBe("image/png");
  });

  it("re-exports helpers from index", () => {
    expect(schema.normalizeContentType("video/mp2t")).toBe("video/mp2t");
    expect(schema.decodeUtf8Text(new TextEncoder().encode("hello"))).toBe("hello");
  });
});
