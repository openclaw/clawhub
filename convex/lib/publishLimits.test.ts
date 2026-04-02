import { describe, expect, it } from "vitest";
import {
  findOversizedPublishFile,
  getPublishFileSizeError,
  getPublishTotalSizeError,
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
  });
});
