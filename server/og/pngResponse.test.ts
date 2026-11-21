/* @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pngResponse } from "./pngResponse";

const { construct, render, encode, freeImage, freeRenderer } = vi.hoisted(() => ({
  construct: vi.fn(),
  render: vi.fn(),
  encode: vi.fn(),
  freeImage: vi.fn(),
  freeRenderer: vi.fn(),
}));

vi.mock("@resvg/resvg-wasm", () => ({
  Resvg: class {
    constructor(...args: unknown[]) {
      construct(...args);
    }
    render() {
      return render();
    }
    free() {
      freeRenderer();
    }
  },
}));

vi.mock("./ogAssets", () => ({
  FONT_SANS: "Bricolage Grotesque",
  FONT_MONO: "IBM Plex Mono",
}));

const fontBuffers = [new Uint8Array([1, 2, 3])];
const failure = new Error("rendering failed");

beforeEach(() => {
  vi.resetAllMocks();
  render.mockReturnValue({ asPng: encode, free: freeImage });
  encode.mockReturnValue(new Uint8Array([7, 8, 9]));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function expectImageThenRendererFreed() {
  expect(freeImage).toHaveBeenCalledOnce();
  expect(freeRenderer).toHaveBeenCalledOnce();
  expect(freeImage.mock.invocationCallOrder[0]).toBeLessThan(
    freeRenderer.mock.invocationCallOrder[0],
  );
}

function expectSameFailure() {
  try {
    pngResponse("<svg/>", fontBuffers, "no-store");
    expect.fail("Rendering should fail");
  } catch (error) {
    expect(error).toBe(failure);
  }
}

describe("PNG response resource ownership", () => {
  it("copies only the PNG view before releasing its image and renderer", async () => {
    const bytes = new Uint8Array([0, 7, 8, 9, 0]);
    encode.mockReturnValue(bytes.subarray(1, 4));
    freeImage.mockImplementation(() => bytes.fill(0));

    const response = pngResponse("<svg/>", fontBuffers, "public, max-age=3600");

    expectImageThenRendererFreed();
    await expect(response.arrayBuffer()).resolves.toEqual(new Uint8Array([7, 8, 9]).buffer);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=3600");
    expect(construct).toHaveBeenCalledWith("<svg/>", {
      font: {
        fontBuffers,
        defaultFontFamily: "Bricolage Grotesque",
        sansSerifFamily: "Bricolage Grotesque",
        monospaceFamily: "IBM Plex Mono",
      },
    });
  });

  it("preserves an explicit render size and immutable cache policy", () => {
    const response = pngResponse("<svg/>", fontBuffers, "public, max-age=31536000, immutable", {
      mode: "width",
      value: 1200,
    });
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(construct).toHaveBeenCalledWith(
      "<svg/>",
      expect.objectContaining({ fitTo: { mode: "width", value: 1200 } }),
    );
  });

  it("propagates construction failure without freeing unacquired resources", () => {
    construct.mockImplementation(() => {
      throw failure;
    });
    expectSameFailure();
    expect(render).not.toHaveBeenCalled();
    expect(freeImage).not.toHaveBeenCalled();
    expect(freeRenderer).not.toHaveBeenCalled();
  });

  it("releases the renderer when rendering fails before an image exists", () => {
    render.mockImplementation(() => {
      throw failure;
    });
    expectSameFailure();
    expect(encode).not.toHaveBeenCalled();
    expect(freeImage).not.toHaveBeenCalled();
    expect(freeRenderer).toHaveBeenCalledOnce();
  });

  it("releases image then renderer when PNG encoding fails", () => {
    encode.mockImplementation(() => {
      throw failure;
    });
    expectSameFailure();
    expectImageThenRendererFreed();
  });

  it("releases image then renderer when response construction fails", () => {
    vi.stubGlobal(
      "Response",
      class {
        constructor() {
          throw failure;
        }
      },
    );
    expectSameFailure();
    expectImageThenRendererFreed();
  });

  it("still releases the renderer when image cleanup fails", () => {
    freeImage.mockImplementation(() => {
      throw failure;
    });
    expectSameFailure();
    expectImageThenRendererFreed();
  });

  it("propagates renderer cleanup failure after releasing the image", () => {
    freeRenderer.mockImplementation(() => {
      throw failure;
    });
    expectSameFailure();
    expectImageThenRendererFreed();
  });
});
