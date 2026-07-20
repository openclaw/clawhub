/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import * as schema from ".";
import { decodeUtf8Text, normalizeContentType } from "./textFiles";

describe("packages/clawhub schema textFiles", () => {
  it("re-exports helpers from index", () => {
    expect(schema.normalizeContentType("text/markdown; charset=utf-8")).toBe("text/markdown");
  });

  it("detects previewable UTF-8 bytes without an extension allowlist", () => {
    expect(decodeUtf8Text(new TextEncoder().encode("main.tf"))).toBe("main.tf");
    expect(decodeUtf8Text(Uint8Array.from([0, 1, 2, 255]))).toBeNull();
    expect(normalizeContentType("")).toBeUndefined();
  });
});
