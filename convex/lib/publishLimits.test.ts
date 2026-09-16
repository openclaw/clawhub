import { describe, expect, it } from "vitest";
import {
  findOversizedPublishFile,
  getClawPackSizeError,
  getPackageMultipartSizeError,
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
      'ClawPack "demo-1.0.0.tgz" exceeds 120MB limit',
    );
  });

  it("keeps ClawPack capacity above the multipart request budget", () => {
    expect(MAX_CLAWPACK_BYTES).toBe(120 * 1024 * 1024);
    expect(MAX_CLAWPACK_BYTES).toBeGreaterThan(MAX_PACKAGE_MULTIPART_BYTES);
    expect(MAX_CLAWPACK_BYTES).toBeGreaterThan(MAX_PUBLISH_FILE_BYTES);
  });

  it("keeps the inline multipart budget under the Vercel function payload cap", () => {
    // clawhub.ai proxies /api through Vercel functions, which 413 above 4.5 MB.
    const vercelFunctionPayloadCapBytes = 4.5 * 1024 * 1024;
    expect(MAX_PACKAGE_MULTIPART_BYTES).toBe(4 * 1024 * 1024);
    expect(MAX_PACKAGE_MULTIPART_BYTES).toBeLessThan(vercelFunctionPayloadCapBytes);
    expect(getPackageMultipartSizeError()).toBe(
      "Package upload exceeds 4MB multipart upload limit",
    );
  });
});
