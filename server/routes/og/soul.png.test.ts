/* @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getQueryMock = vi.fn();
const getRequestHostMock = vi.fn();
const setHeaderMock = vi.fn();
const fetchSoulOgMetaMock = vi.fn();
const getMarkDataUrlMock = vi.fn();
const ensureResvgWasmMock = vi.fn();
const getFontBuffersMock = vi.fn();
const buildSoulOgSvgMock = vi.fn();
const renderAsPngMock = vi.fn();
const freeMock = vi.fn();
const resvgCtorMock = vi.fn();

class ResvgMockClass {
  constructor(...args: unknown[]) {
    resvgCtorMock(...args);
  }

  render() {
    return { asPng: renderAsPngMock };
  }

  free() {
    return freeMock();
  }
}

vi.mock("h3", () => ({
  defineEventHandler: (handler: unknown) => handler,
  getQuery: (...args: unknown[]) => getQueryMock(...args),
  getRequestHost: (...args: unknown[]) => getRequestHostMock(...args),
  setHeader: (...args: unknown[]) => setHeaderMock(...args),
}));

vi.mock("../../og/fetchSoulOgMeta", () => ({
  fetchSoulOgMeta: (...args: unknown[]) => fetchSoulOgMetaMock(...args),
}));

vi.mock("../../og/ogAssets", () => ({
  FONT_MONO: "IBM Plex Mono",
  FONT_SANS: "Bricolage Grotesque",
  getMarkDataUrl: (...args: unknown[]) => getMarkDataUrlMock(...args),
  ensureResvgWasm: (...args: unknown[]) => ensureResvgWasmMock(...args),
  getFontBuffers: (...args: unknown[]) => getFontBuffersMock(...args),
}));

vi.mock("../../og/soulOgSvg", () => ({
  buildSoulOgSvg: (...args: unknown[]) => buildSoulOgSvgMock(...args),
}));

vi.mock("@resvg/resvg-wasm", () => ({
  Resvg: ResvgMockClass,
}));

beforeEach(() => {
  getQueryMock.mockReset();
  getRequestHostMock.mockReset();
  setHeaderMock.mockReset();
  fetchSoulOgMetaMock.mockReset();
  getMarkDataUrlMock.mockReset();
  ensureResvgWasmMock.mockReset();
  getFontBuffersMock.mockReset();
  buildSoulOgSvgMock.mockReset();
  renderAsPngMock.mockReset();
  freeMock.mockReset();
  resvgCtorMock.mockReset();

  getMarkDataUrlMock.mockResolvedValue("data:image/png;base64,AAA=");
  ensureResvgWasmMock.mockResolvedValue(undefined);
  getFontBuffersMock.mockResolvedValue([new Uint8Array([1, 2, 3])]);
  buildSoulOgSvgMock.mockReturnValue("<svg>soul</svg>");
  renderAsPngMock.mockReturnValue(new Uint8Array([4, 5, 6]));
});

afterEach(() => {
  delete process.env.VITE_CONVEX_SITE_URL;
  delete process.env.SITE_URL;
  delete process.env.VITE_SITE_URL;
});

describe("soul og route", () => {
  it("returns plain text when slug is missing", async () => {
    getQueryMock.mockReturnValue({});

    const handler = (await import("./soul.png")).default;
    await expect(handler({} as never)).resolves.toBe("Missing `slug` query param.");

    expect(setHeaderMock).toHaveBeenCalledWith({}, "Content-Type", "text/plain; charset=utf-8");
    expect(fetchSoulOgMetaMock).not.toHaveBeenCalled();
    expect(resvgCtorMock).not.toHaveBeenCalled();
  });

  it("fetches metadata and renders SoulHub labels", async () => {
    getQueryMock.mockReturnValue({ slug: "lorekeeper" });
    getRequestHostMock.mockReturnValue("souls-preview.example.com");
    fetchSoulOgMetaMock.mockResolvedValue({
      owner: null,
      version: null,
      displayName: "Lorekeeper",
      summary: "Portable memory for your agent.",
    });

    const handler = (await import("./soul.png")).default;
    const response = (await handler({} as never)) as Response;
    await expect(response.arrayBuffer()).resolves.toEqual(new Uint8Array([4, 5, 6]).buffer);

    expect(fetchSoulOgMetaMock).toHaveBeenCalledWith(
      "lorekeeper",
      "https://souls-preview.example.com",
    );
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=3600");
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(buildSoulOgSvgMock).toHaveBeenCalledWith({
      markDataUrl: "data:image/png;base64,AAA=",
      title: "Lorekeeper",
      description: "Portable memory for your agent.",
      ownerLabel: "SoulHub",
      versionLabel: "latest",
      footer: "souls/lorekeeper",
    });
    expect(freeMock).toHaveBeenCalledOnce();
  });

  it("prefers explicit owner and version query params", async () => {
    getQueryMock.mockReturnValue({
      slug: "lorekeeper",
      owner: "steipete",
      version: "2.0.0",
      title: "Lorekeeper",
      description: "Portable memory for your agent.",
    });

    const handler = (await import("./soul.png")).default;
    const response = (await handler({} as never)) as Response;

    expect(fetchSoulOgMetaMock).not.toHaveBeenCalled();
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(buildSoulOgSvgMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerLabel: "@steipete",
        versionLabel: "v2.0.0",
        footer: "@steipete/lorekeeper",
      }),
    );
  });
});
