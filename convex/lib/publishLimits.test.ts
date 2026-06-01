import { describe, expect, it } from "vitest";
import {
  findOversizedPublishFile,
  getClawPackSizeError,
  getPublishFileSizeError,
  getPublishTotalSizeError,
  MAX_CLAWPACK_BYTES,
  MAX_PACKAGE_MULTIPART_BYTES,
  MAX_PUBLISH_FILE_BYTES,
} from "./publishLimits";

describe("publishLimits", () => {
  it("finds files over the max publish file size", () => {
    expect(
      findOversizedPublishFile([
        { path: "small.txt", size: 128 },
        { path: "big.txt", size: MAX_PUBLISH_FILE_BYTES + 1 },
      ]),
    ).toEqual({
      path: "big.txt",
      size: MAX_PUBLISH_FILE_BYTES + 1,
    });
  });

  it("formats user-facing size errors", () => {
    expect(getPublishFileSizeError("dist/plugin.wasm")).toBe(
      'File "dist/plugin.wasm" exceeds 10MB limit',
    );
    expect(getPublishTotalSizeError("package")).toBe("Package exceeds 50MB limit");
    expect(getClawPackSizeError("demo-1.0.0.tgz")).toBe(
      'ClawPack "demo-1.0.0.tgz" exceeds 18MB multipart upload limit',
    );
  });

  it("uses the multipart upload budget for ClawPack tarballs", () => {
    expect(MAX_CLAWPACK_BYTES).toBe(MAX_PACKAGE_MULTIPART_BYTES);
    expect(MAX_CLAWPACK_BYTES).toBeGreaterThan(MAX_PUBLISH_FILE_BYTES);
  });
});
