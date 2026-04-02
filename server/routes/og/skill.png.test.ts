/* @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getQueryMock = vi.fn();
const getRequestHostMock = vi.fn();
const setHeaderMock = vi.fn();
const fetchSkillOgMetaMock = vi.fn();
const getMarkDataUrlMock = vi.fn();
const ensureResvgWasmMock = vi.fn();
const getFontBuffersMock = vi.fn();
const buildSkillOgSvgMock = vi.fn();
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

vi.mock("../../og/fetchSkillOgMeta", () => ({
  fetchSkillOgMeta: (...args: unknown[]) => fetchSkillOgMetaMock(...args),
}));

vi.mock("../../og/ogAssets", () => ({
  FONT_MONO: "IBM Plex Mono",
  FONT_SANS: "Bricolage Grotesque",
  getMarkDataUrl: (...args: unknown[]) => getMarkDataUrlMock(...args),
  ensureResvgWasm: (...args: unknown[]) => ensureResvgWasmMock(...args),
  getFontBuffers: (...args: unknown[]) => getFontBuffersMock(...args),
}));

vi.mock("../../og/skillOgSvg", () => ({
  buildSkillOgSvg: (...args: unknown[]) => buildSkillOgSvgMock(...args),
}));

vi.mock("@resvg/resvg-wasm", () => ({
  Resvg: ResvgMockClass,
}));

beforeEach(() => {
  getQueryMock.mockReset();
  getRequestHostMock.mockReset();
  setHeaderMock.mockReset();
  fetchSkillOgMetaMock.mockReset();
  getMarkDataUrlMock.mockReset();
  ensureResvgWasmMock.mockReset();
  getFontBuffersMock.mockReset();
  buildSkillOgSvgMock.mockReset();
  renderAsPngMock.mockReset();
  freeMock.mockReset();
  resvgCtorMock.mockReset();

  getMarkDataUrlMock.mockResolvedValue("data:image/png;base64,AAA=");
  ensureResvgWasmMock.mockResolvedValue(undefined);
  getFontBuffersMock.mockResolvedValue([new Uint8Array([1, 2, 3])]);
  buildSkillOgSvgMock.mockReturnValue("<svg>skill</svg>");
  renderAsPngMock.mockReturnValue(new Uint8Array([7, 8, 9]));
});

afterEach(() => {
  delete process.env.VITE_CONVEX_SITE_URL;
  delete process.env.SITE_URL;
  delete process.env.VITE_SITE_URL;
});

describe("skill og route", () => {
  it("returns plain text when slug is missing", async () => {
    getQueryMock.mockReturnValue({});

    const handler = (await import("./skill.png")).default;
    await expect(handler({} as never)).resolves.toBe("Missing `slug` query param.");

    expect(setHeaderMock).toHaveBeenCalledWith({}, "Content-Type", "text/plain; charset=utf-8");
    expect(fetchSkillOgMetaMock).not.toHaveBeenCalled();
    expect(resvgCtorMock).not.toHaveBeenCalled();
  });

  it("renders from explicit query params without fetching metadata", async () => {
    getQueryMock.mockReturnValue({
      slug: "gifgrep",
      owner: "steipete",
      version: "1.0.1",
      title: "Gifgrep",
      description: "Search GIFs fast",
    });

    const handler = (await import("./skill.png")).default;
    await expect(handler({} as never)).resolves.toEqual(new Uint8Array([7, 8, 9]));

    expect(fetchSkillOgMetaMock).not.toHaveBeenCalled();
    expect(setHeaderMock).toHaveBeenCalledWith(
      {},
      "Cache-Control",
      "public, max-age=31536000, immutable",
    );
    expect(setHeaderMock).toHaveBeenCalledWith({}, "Content-Type", "image/png");
    expect(buildSkillOgSvgMock).toHaveBeenCalledWith({
      markDataUrl: "data:image/png;base64,AAA=",
      title: "Gifgrep",
      description: "Search GIFs fast",
      ownerLabel: "@steipete",
      versionLabel: "v1.0.1",
      footer: "clawhub.ai/steipete/gifgrep",
    });
    expect(resvgCtorMock).toHaveBeenCalledWith("<svg>skill</svg>", {
      fitTo: { mode: "width", value: 1200 },
      font: {
        fontBuffers: [new Uint8Array([1, 2, 3])],
        defaultFontFamily: "Bricolage Grotesque",
        sansSerifFamily: "Bricolage Grotesque",
        monospaceFamily: "IBM Plex Mono",
      },
    });
    expect(freeMock).toHaveBeenCalledOnce();
  });

  it("fetches metadata from the request host when query params are incomplete", async () => {
    getQueryMock.mockReturnValue({ slug: "gifgrep" });
    getRequestHostMock.mockReturnValue("preview.clawhub.ai");
    fetchSkillOgMetaMock.mockResolvedValue({
      owner: "steipete",
      version: null,
      displayName: "Gifgrep",
      summary: "Search GIFs fast",
    });

    const handler = (await import("./skill.png")).default;
    await handler({} as never);

    expect(fetchSkillOgMetaMock).toHaveBeenCalledWith("gifgrep", "https://preview.clawhub.ai");
    expect(setHeaderMock).toHaveBeenCalledWith({}, "Cache-Control", "public, max-age=3600");
    expect(buildSkillOgSvgMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Gifgrep",
        description: "Search GIFs fast",
        ownerLabel: "@steipete",
        versionLabel: "latest",
      }),
    );
  });
});
