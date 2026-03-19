/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import { __test, generateToken, hashToken } from "./tokens";

describe("tokens", () => {
  it("hashToken returns sha256 hex", async () => {
    await expect(hashToken("test")).resolves.toBe(
      "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    );
  });

  it("generateToken returns token + prefix", () => {
    const { token, prefix } = generateToken();
    expect(token).toMatch(/^clh_[A-Za-z0-9_-]+$/);
    expect(prefix).toBe(token.slice(0, 12));
  });

  it("toHex encodes bytes", () => {
    expect(__test.toHex(new Uint8Array([0, 15, 255]))).toBe("000fff");
  });

  it("toBase64 encodes 1/2/3-byte tails", () => {
    expect(__test.toBase64(new Uint8Array([0xff]))).toBe("/w==");
    expect(__test.toBase64(new Uint8Array([0xff, 0xee]))).toBe("/+4=");
    expect(__test.toBase64(new Uint8Array([0xff, 0xee, 0xdd]))).toBe("/+7d");
  });

  it("toBase64Url replaces alphabet and strips padding", () => {
    expect(__test.toBase64Url(new Uint8Array([0xff]))).toBe("_w");
    expect(__test.toBase64Url(new Uint8Array([0xfa, 0x00, 0x00]))).toBe("-gAA");
  });
});
