/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import { sha256Hex, toHex } from "./hash";

describe("byte hashing", () => {
  it("matches the SHA-256 empty and UTF-8 test vectors", async () => {
    await expect(sha256Hex(new Uint8Array())).resolves.toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    await expect(sha256Hex(new TextEncoder().encode("abc"))).resolves.toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("hashes the addressed view without including surrounding bytes", async () => {
    const bytes = new Uint8Array([255, 97, 98, 99, 0]);
    await expect(sha256Hex(bytes.subarray(1, 4))).resolves.toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(Array.from(bytes)).toEqual([255, 97, 98, 99, 0]);
  });

  it("keeps leading zeros and lowercase hex digits", () => {
    expect(toHex(new Uint8Array([0, 15, 128, 255]))).toBe("000f80ff");
  });
});
