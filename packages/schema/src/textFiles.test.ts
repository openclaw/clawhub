/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import * as schema from ".";
import { decodeUtf8Text, isRichOrActiveDocument, normalizeContentType } from "./textFiles";

describe("clawhub-schema textFiles", () => {
  it("detects UTF-8 text from bytes instead of file extensions", () => {
    expect(decodeUtf8Text(new TextEncoder().encode('resource "null_resource" "demo" {}'))).toBe(
      'resource "null_resource" "demo" {}',
    );
    expect(decodeUtf8Text(new TextEncoder().encode("hé😀"))).toBe("hé😀");
    expect(decodeUtf8Text(Uint8Array.from([0xef, 0xbb, 0xbf, 0x61]))).toBe("a");
    expect(decodeUtf8Text(Uint8Array.from([0]))).toBe("\0");
    expect(decodeUtf8Text(Uint8Array.from([0, 1, 2, 255]))).toBeNull();
    expect(decodeUtf8Text(Uint8Array.from([0xc3, 0x28]))).toBeNull();
  });

  it("normalizes supplied MIME types without consulting file extensions", () => {
    expect(normalizeContentType("video/mp2t")).toBe("video/mp2t");
    expect(normalizeContentType("text/markdown; charset=utf-8")).toBe("text/markdown");
    expect(normalizeContentType("image/png")).toBe("image/png");
  });

  it("identifies rich or active document formats from path or content type", () => {
    expect(isRichOrActiveDocument("page.html")).toBe(true);
    expect(isRichOrActiveDocument("diagram.unknown", "image/svg+xml")).toBe(true);
    expect(isRichOrActiveDocument("report.pdf", "application/octet-stream")).toBe(true);
    expect(isRichOrActiveDocument("main.tf", "text/plain")).toBe(false);
  });

  it("re-exports helpers from index", () => {
    expect(schema.normalizeContentType("video/mp2t")).toBe("video/mp2t");
    expect(schema.decodeUtf8Text(new TextEncoder().encode("hello"))).toBe("hello");
    expect(schema.isRichOrActiveDocument("report.pdf")).toBe(true);
  });
});
