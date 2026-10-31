import { describe, expect, it } from "vitest";
import { isDirectRasterRepresentation } from "./publicPluginArtwork";

const asset = { sha256: "00".repeat(32), contentType: "image/png" as const, size: 100 };
const stored = {
  sha256: btoa(String.fromCharCode(...new Uint8Array(32))),
  contentType: "image/png",
  size: 100,
};

describe("direct public raster representation", () => {
  it("binds the public hex digest to the base64 storage digest and representation", () => {
    expect(isDirectRasterRepresentation(asset, stored)).toBe(true);
  });

  it("keeps SVGs on the sandboxed HTTP endpoint", () => {
    expect(
      isDirectRasterRepresentation(
        { ...asset, contentType: "image/svg+xml" },
        { ...stored, contentType: "image/svg+xml" },
      ),
    ).toBe(false);
  });

  it.each([
    null,
    { ...stored, sha256: btoa("different") },
    { ...stored, contentType: "application/octet-stream" },
    { ...stored, contentType: undefined },
    { ...stored, size: 99 },
  ])("rejects missing or mismatched storage metadata: %j", (metadata) => {
    expect(isDirectRasterRepresentation(asset, metadata)).toBe(false);
  });
});
