import { describe, expect, it } from "vitest";
import { validateRasterInternal } from "./skillPresentationImageNode";

type WrappedHandler = {
  _handler: (
    ctx: unknown,
    args: { bytes: ArrayBuffer; contentType: "image/png" },
  ) => Promise<boolean>;
};

const validateRaster = (validateRasterInternal as unknown as WrappedHandler)._handler;
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
