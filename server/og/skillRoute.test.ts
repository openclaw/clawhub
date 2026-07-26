/* @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getQueryMock = vi.fn();
const getRequestHostMock = vi.fn();
const setHeaderMock = vi.fn();
const fetchSkillOgMetaMock = vi.fn();
const getMarkDataUrlMock = vi.fn();
const getWatermarkDataUrlMock = vi.fn();
const ensureResvgWasmMock = vi.fn();
const getFontBuffersMock = vi.fn();
const buildSkillOgSvgMock = vi.fn();
const fetchImageDataUrlMock = vi.fn();
const fetchPublicOgImageDataUrlMock = vi.fn();
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

vi.mock("./fetchSkillOgMeta", () => ({
  fetchSkillOgMeta: (...args: unknown[]) => fetchSkillOgMetaMock(...args),
}));

vi.mock("./ogAssets", () => ({
  FONT_MONO: "IBM Plex Mono",
  FONT_SANS: "Bricolage Grotesque",
  getMarkDataUrl: (...args: unknown[]) => getMarkDataUrlMock(...args),
  getWatermarkDataUrl: (...args: unknown[]) => getWatermarkDataUrlMock(...args),
  ensureResvgWasm: (...args: unknown[]) => ensureResvgWasmMock(...args),
  getFontBuffers: (...args: unknown[]) => getFontBuffersMock(...args),
}));

vi.mock("./fetchImageDataUrl", () => ({
  fetchImageDataUrl: (...args: unknown[]) => fetchImageDataUrlMock(...args),
  fetchPublisherProfileImageDataUrl: (...args: unknown[]) => fetchPublicOgImageDataUrlMock(...args),
}));

vi.mock("./skillOgSvg", () => ({
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
  getWatermarkDataUrlMock.mockReset();
  ensureResvgWasmMock.mockReset();
  getFontBuffersMock.mockReset();
  buildSkillOgSvgMock.mockReset();
  fetchImageDataUrlMock.mockReset();
  fetchPublicOgImageDataUrlMock.mockReset();
  renderAsPngMock.mockReset();
  freeMock.mockReset();
  resvgCtorMock.mockReset();

  getMarkDataUrlMock.mockResolvedValue("data:image/png;base64,AAA=");
  getWatermarkDataUrlMock.mockResolvedValue("data:image/png;base64,WWW=");
  ensureResvgWasmMock.mockResolvedValue(undefined);
  getFontBuffersMock.mockResolvedValue([new Uint8Array([1, 2, 3])]);
  buildSkillOgSvgMock.mockReturnValue("<svg>skill</svg>");
  fetchImageDataUrlMock.mockResolvedValue(null);
  fetchPublicOgImageDataUrlMock.mockResolvedValue(null);
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

    const handler = (await import("../routes/og/skill.png")).default;
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
      downloads: "0",
    });

    const handler = (await import("../routes/og/skill.png")).default;
    const response = (await handler({} as never)) as Response;
    await expect(response.arrayBuffer()).resolves.toEqual(new Uint8Array([7, 8, 9]).buffer);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(response.headers.get("Content-Type")).toBe("image/png");

    expect(fetchSkillOgMetaMock).not.toHaveBeenCalled();
    expect(buildSkillOgSvgMock).toHaveBeenCalledWith({
      markDataUrl: "data:image/png;base64,AAA=",
      watermarkDataUrl: "data:image/png;base64,WWW=",
      avatarDataUrl: null,
      avatarShape: "circle",
      avatarFit: "cover",
      title: "Gifgrep",
      description: "Search GIFs fast",
      ownerLabel: "@steipete",
      versionLabel: "v1.0.1",
      installCommand: {
        subject: "skills",
        action: "install",
        target: "gifgrep",
      },
      stats: [
        { value: "0", label: "Downloads" },
        { value: "PASS", label: "Audit" },
      ],
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
      icon: null,
      ownerImage: null,
      stats: { downloads: 1200 },
      moderation: { verdict: "clean", isSuspicious: false, isMalwareBlocked: false },
    });

    const handler = (await import("../routes/og/skill.png")).default;
    const response = (await handler({} as never)) as Response;

    expect(fetchSkillOgMetaMock).toHaveBeenCalledWith(
      "gifgrep",
      "https://preview.clawhub.ai",
      undefined,
    );
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=3600");
    expect(buildSkillOgSvgMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Gifgrep",
        description: "Search GIFs fast",
        ownerLabel: "@steipete",
        versionLabel: "latest",
        stats: [
          { value: "1.2k", label: "Downloads" },
          { value: "PASS", label: "Audit" },
        ],
      }),
    );
  });

  it("prefers the skill icon over the publisher profile image", async () => {
    const iconUrl = "https://clawhub.ai/api/v1/skill-icons/aaaaaaaa";
    const ownerImage = "https://avatars.githubusercontent.com/u/1?v=4";
    getQueryMock.mockReturnValue({ slug: "playwright-interactive" });
    fetchSkillOgMetaMock.mockResolvedValue({
      owner: "tridefender",
      version: "1.0.0",
      displayName: "Playwright Interactive",
      summary: "Control a browser interactively",
      icon: iconUrl,
      ownerImage,
      stats: { downloads: 42 },
      moderation: { verdict: "clean", isSuspicious: false, isMalwareBlocked: false },
    });
    fetchPublicOgImageDataUrlMock.mockImplementation(async (url: string | null | undefined) =>
      url === iconUrl ? "data:image/png;base64,ICON" : null,
    );

    const handler = (await import("../routes/og/skill.png")).default;
    await handler({} as never);

    expect(fetchPublicOgImageDataUrlMock).toHaveBeenCalledTimes(1);
    expect(fetchPublicOgImageDataUrlMock).toHaveBeenCalledWith(iconUrl);
    expect(buildSkillOgSvgMock).toHaveBeenCalledWith(
      expect.objectContaining({
        avatarDataUrl: "data:image/png;base64,ICON",
        avatarShape: "rounded",
        avatarFit: "contain",
      }),
    );
  });

  it("falls back to the publisher profile image when the skill icon cannot render", async () => {
    const iconUrl = "https://clawhub.ai/api/v1/skill-icons/aaaaaaaa";
    const ownerImage = "https://avatars.githubusercontent.com/u/1?v=4";
    getQueryMock.mockReturnValue({ slug: "playwright-interactive" });
    fetchSkillOgMetaMock.mockResolvedValue({
      owner: "tridefender",
      version: "1.0.0",
      displayName: "Playwright Interactive",
      summary: "Control a browser interactively",
      icon: iconUrl,
      ownerImage,
      stats: { downloads: 42 },
      moderation: { verdict: "clean", isSuspicious: false, isMalwareBlocked: false },
    });
    fetchPublicOgImageDataUrlMock.mockImplementation(async (url: string | null | undefined) =>
      url === ownerImage ? "data:image/png;base64,PROFILE" : null,
    );

    const handler = (await import("../routes/og/skill.png")).default;
    await handler({} as never);

    expect(fetchPublicOgImageDataUrlMock.mock.calls.map(([url]) => url)).toEqual([
      iconUrl,
      ownerImage,
    ]);
    expect(buildSkillOgSvgMock).toHaveBeenCalledWith(
      expect.objectContaining({
        avatarDataUrl: "data:image/png;base64,PROFILE",
        avatarShape: "circle",
        avatarFit: "cover",
      }),
    );
  });

  it("uses explicit downloads over legacy installs query params", async () => {
    getQueryMock.mockReturnValue({
      slug: "gifgrep",
      owner: "steipete",
      version: "1.0.1",
      title: "Gifgrep",
      description: "Search GIFs fast",
      downloads: "0",
      installs: "9.9k",
    });

    const handler = (await import("../routes/og/skill.png")).default;
    await handler({} as never);

    expect(fetchSkillOgMetaMock).not.toHaveBeenCalled();
    expect(buildSkillOgSvgMock).toHaveBeenCalledWith(
      expect.objectContaining({
        stats: [
          { value: "0", label: "Downloads" },
          { value: "PASS", label: "Audit" },
        ],
      }),
    );
  });

  it("formats raw integer downloads query params", async () => {
    getQueryMock.mockReturnValue({
      slug: "gifgrep",
      owner: "steipete",
      version: "1.0.1",
      title: "Gifgrep",
      description: "Search GIFs fast",
      downloads: "43456",
    });

    const handler = (await import("../routes/og/skill.png")).default;
    await handler({} as never);

    expect(buildSkillOgSvgMock).toHaveBeenCalledWith(
      expect.objectContaining({
        stats: [
          { value: "43.5k", label: "Downloads" },
          { value: "PASS", label: "Audit" },
        ],
      }),
    );
  });
});
