import { describe, expect, it } from "vitest";
import { getTestHandler } from "../src/__tests__/helpers/convexHandler";
import { validateRasterInternal } from "./skillPresentationImageNode";

const validateRaster = getTestHandler<{ bytes: ArrayBuffer; contentType: "image/png" }, boolean>(
  validateRasterInternal,
);
const png = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  ),
);

describe("validateRasterInternal", () => {
  it("fully decodes valid raster bytes and rejects truncated images", async () => {
    await expect(
      validateRaster({}, { bytes: new Uint8Array(png).buffer, contentType: "image/png" }),
    ).resolves.toBe(true);
    await expect(
      validateRaster(
        {},
        { bytes: new Uint8Array(png.slice(0, 40)).buffer, contentType: "image/png" },
      ),
    ).resolves.toBe(false);
  });
});
