/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import * as schema from ".";
import { decodeUtf8Text, normalizeContentType } from "./textFiles";

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

  it.each([
    [0x80],
    [0xc0, 0x80],
    [0xc2],
    [0xe0, 0x80, 0x80],
    [0xed, 0xa0, 0x80],
    [0xf0, 0x80, 0x80, 0x80],
    [0xf4, 0x90, 0x80, 0x80],
    [0xf5, 0x80, 0x80, 0x80],
    [0xf0, 0x90, 0x80],
  ])("rejects malformed UTF-8 bytes %j", (...bytes) => {
    expect(decodeUtf8Text(Uint8Array.from(bytes))).toBeNull();
  });

  it("removes only the initial BOM and preserves embedded NULs", () => {
    const text = "\ufeffa\0\ufeff";
    expect(decodeUtf8Text(new TextEncoder().encode(`\ufeff${text}`))).toBe(text);
    expect(decodeUtf8Text(new Uint8Array())).toBe("");
  });

  it("decodes only the selected view, including a shared buffer view", () => {
    const bytes = Uint8Array.from([0xff, 0x68, 0xc3, 0xa9, 0xff]);
    expect(decodeUtf8Text(bytes.subarray(1, 4))).toBe("hé");
    const shared = new Uint8Array(new SharedArrayBuffer(bytes.length));
    shared.set(bytes);
    expect(decodeUtf8Text(shared.subarray(1, 4))).toBe("hé");
  });

  it("keeps detached views empty and decoding calls independent after failure", () => {
    const bytes = Uint8Array.from([0x68, 0x69]);
    structuredClone(bytes.buffer, { transfer: [bytes.buffer] });
    expect(decodeUtf8Text(bytes)).toBe("");
    expect(decodeUtf8Text(Uint8Array.from([0xff]))).toBeNull();
    expect(decodeUtf8Text(new TextEncoder().encode("\ufeffhello"))).toBe("hello");
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
