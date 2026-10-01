/* @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getQueryMock = vi.fn();
const setHeaderMock = vi.fn();
const fetchImageDataUrlMock = vi.fn();
const fetchPublisherProfileImageDataUrlMock = vi.fn();
const fetchPublisherOgMetaMock = vi.fn();
const normalizeOgLogoDataUrlMock = vi.fn();
const getClawHubLogoDataUrlMock = vi.fn();
const ensureResvgWasmMock = vi.fn();
const getPublisherFontBuffersMock = vi.fn();
const buildPublisherOgSvgMock = vi.fn();
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
  setHeader: (...args: unknown[]) => setHeaderMock(...args),
}));

vi.mock("./fetchImageDataUrl", () => ({
  fetchImageDataUrl: (...args: unknown[]) => fetchImageDataUrlMock(...args),
  fetchPublisherProfileImageDataUrl: (...args: unknown[]) =>
    fetchPublisherProfileImageDataUrlMock(...args),
}));

vi.mock("./fetchPublisherOgMeta", () => ({
  fetchPublisherOgMeta: (...args: unknown[]) => fetchPublisherOgMetaMock(...args),
}));

vi.mock("./normalizeLogoDataUrl", () => ({
  normalizeOgLogoDataUrl: (...args: unknown[]) => normalizeOgLogoDataUrlMock(...args),
}));

vi.mock("./ogAssets", () => ({
  FONT_MONO: "IBM Plex Mono",
  FONT_SANS: "Bricolage Grotesque",
  getClawHubLogoDataUrl: (...args: unknown[]) => getClawHubLogoDataUrlMock(...args),
  ensureResvgWasm: (...args: unknown[]) => ensureResvgWasmMock(...args),
  getPublisherFontBuffers: (...args: unknown[]) => getPublisherFontBuffersMock(...args),
}));

vi.mock("./publisherOgSvg", () => ({
  buildPublisherOgSvg: (...args: unknown[]) => buildPublisherOgSvgMock(...args),
}));

vi.mock("@resvg/resvg-wasm", () => ({
  Resvg: ResvgMockClass,
}));

beforeEach(() => {
  vi.resetModules();
  getQueryMock.mockReset();
  setHeaderMock.mockReset();
  fetchImageDataUrlMock.mockReset();
  fetchPublisherProfileImageDataUrlMock.mockReset();
  fetchPublisherOgMetaMock.mockReset();
  normalizeOgLogoDataUrlMock.mockReset();
  getClawHubLogoDataUrlMock.mockReset();
  ensureResvgWasmMock.mockReset();
  getPublisherFontBuffersMock.mockReset();
  buildPublisherOgSvgMock.mockReset();
  renderAsPngMock.mockReset();
  freeMock.mockReset();
  resvgCtorMock.mockReset();

  getClawHubLogoDataUrlMock.mockResolvedValue("data:image/png;base64,TE9HTw==");
  ensureResvgWasmMock.mockResolvedValue(undefined);
  getPublisherFontBuffersMock.mockResolvedValue([new Uint8Array([1, 2, 3])]);
  fetchPublisherProfileImageDataUrlMock.mockResolvedValue("data:image/png;base64,QVZBVEFS");
  fetchImageDataUrlMock.mockImplementation(async (url: string) => `data:image/png;base64,${url}`);
  normalizeOgLogoDataUrlMock.mockImplementation(async (dataUrl: string) => `${dataUrl}-normalized`);
  buildPublisherOgSvgMock.mockReturnValue("<svg>profile</svg>");
  renderAsPngMock.mockReturnValue(new Uint8Array([7, 8, 9]));
});

afterEach(() => {
  delete process.env.VITE_CONVEX_URL;
  delete process.env.CONVEX_URL;
});

describe("profile og route", () => {
  it("returns plain text when handle is missing", async () => {
    getQueryMock.mockReturnValue({});

    const handler = (await import("../routes/og/profile.png")).default;
    await expect(handler({} as never)).resolves.toBe("Missing `handle` query param.");

    expect(setHeaderMock).toHaveBeenCalledWith({}, "Content-Type", "text/plain; charset=utf-8");
    expect(fetchPublisherOgMetaMock).not.toHaveBeenCalled();
    expect(resvgCtorMock).not.toHaveBeenCalled();
  });

  it("renders explicit query params without fetching metadata", async () => {
    getQueryMock.mockReturnValue({
      handle: "nvidia",
      title: "NVIDIA",
      downloads: "1200",
      kind: "org",
      official: "0",
      orgState: "0",
      orgImages: "0",
      avatar: "https://cdn.example.com/avatar.png",
    });

    const handler = (await import("../routes/og/profile.png")).default;
    const response = (await handler({} as never)) as Response;

    await expect(response.arrayBuffer()).resolves.toEqual(new Uint8Array([7, 8, 9]).buffer);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(fetchPublisherOgMetaMock).not.toHaveBeenCalled();
    expect(fetchPublisherProfileImageDataUrlMock).toHaveBeenCalledWith(
      "https://cdn.example.com/avatar.png",
    );
    expect(fetchImageDataUrlMock).not.toHaveBeenCalled();
    expect(normalizeOgLogoDataUrlMock).not.toHaveBeenCalled();
    expect(buildPublisherOgSvgMock).toHaveBeenCalledWith({
      clawHubLogoDataUrl: "data:image/png;base64,TE9HTw==",
      avatarDataUrl: "data:image/png;base64,QVZBVEFS",
      avatarShape: "rounded",
      official: false,
      title: "NVIDIA",
      handleLabel: "@nvidia",
      organizationCount: 0,
      organizationLogos: [],
      stats: [{ value: "1.2k", label: "Downloads" }],
    });
  });

  it("verifies trust indicators before rendering query-requested official state", async () => {
    process.env.VITE_CONVEX_URL = "https://convex.example";
    getQueryMock.mockReturnValue({
      handle: "nvidia",
      title: "Fake NVIDIA",
      downloads: "999999",
      official: "1",
      orgState: "many",
      orgImages: "https://attacker.example/0.png|https://attacker.example/1.png",
      avatar: "https://attacker.example/avatar.png",
    });
    fetchPublisherOgMetaMock.mockResolvedValue({
      handle: "nvidia",
      kind: "user",
      official: false,
      displayName: "Verified NVIDIA",
      image: "https://cdn.example.com/verified-avatar.png",
      affiliations: [],
      stats: { downloads: 1200 },
    });

    const handler = (await import("../routes/og/profile.png")).default;
    await handler({} as never);

    expect(fetchPublisherOgMetaMock).toHaveBeenCalledWith("nvidia", "https://convex.example");
    expect(fetchPublisherProfileImageDataUrlMock).toHaveBeenCalledWith(
      "https://cdn.example.com/verified-avatar.png",
    );
    expect(fetchImageDataUrlMock).not.toHaveBeenCalled();
    expect(normalizeOgLogoDataUrlMock).not.toHaveBeenCalled();
    expect(buildPublisherOgSvgMock).toHaveBeenCalledWith(
      expect.objectContaining({
        official: false,
        title: "Verified NVIDIA",
        organizationCount: 0,
        organizationLogos: [],
        stats: [{ value: "1.2k", label: "Downloads" }],
      }),
    );
  });

  it("verifies non-zero organization state even when affiliations have no images", async () => {
    process.env.VITE_CONVEX_URL = "https://convex.example";
    getQueryMock.mockReturnValue({
      handle: "nvidia",
      title: "Fake NVIDIA",
      downloads: "999999",
      kind: "user",
      official: "0",
      orgState: "many",
      orgImages: "0",
      avatar: "https://attacker.example/avatar.png",
    });
    fetchPublisherOgMetaMock.mockResolvedValue({
      handle: "nvidia",
      kind: "user",
      official: false,
      displayName: "Verified NVIDIA",
      image: "https://cdn.example.com/verified-avatar.png",
      affiliations: [
        {
          handle: "verified-org-1",
          displayName: "Verified Org 1",
          image: null,
        },
        {
          handle: "verified-org-2",
          displayName: "Verified Org 2",
          image: null,
        },
      ],
      stats: { downloads: 1200 },
    });

    const handler = (await import("../routes/og/profile.png")).default;
    await handler({} as never);

    expect(fetchPublisherOgMetaMock).toHaveBeenCalledWith("nvidia", "https://convex.example");
    expect(fetchPublisherProfileImageDataUrlMock).toHaveBeenCalledWith(
      "https://cdn.example.com/verified-avatar.png",
    );
    expect(fetchImageDataUrlMock).not.toHaveBeenCalled();
    expect(normalizeOgLogoDataUrlMock).not.toHaveBeenCalled();
    expect(buildPublisherOgSvgMock).toHaveBeenCalledWith(
      expect.objectContaining({
        official: false,
        title: "Verified NVIDIA",
        organizationCount: 2,
        organizationLogos: [],
        stats: [{ value: "1.2k", label: "Downloads" }],
      }),
    );
  });

  it("uses verified metadata for official cards requested by query params", async () => {
    process.env.VITE_CONVEX_URL = "https://convex.example";
    getQueryMock.mockReturnValue({
      handle: "nvidia",
      title: "Fake NVIDIA",
      downloads: "999999",
      kind: "user",
      official: "1",
      orgImages: "https://attacker.example/org.png",
      avatar: "https://attacker.example/avatar.png",
    });
    fetchPublisherOgMetaMock.mockResolvedValue({
      handle: "nvidia",
      kind: "org",
      official: true,
      displayName: "Verified NVIDIA",
      image: "https://cdn.example.com/verified-avatar.png",
      affiliations: [
        {
          handle: "verified-org",
          displayName: "Verified Org",
          image: "https://cdn.example.com/verified-org.png",
        },
      ],
      stats: { downloads: 1200 },
    });

    const handler = (await import("../routes/og/profile.png")).default;
    await handler({} as never);

    expect(fetchPublisherOgMetaMock).toHaveBeenCalledWith("nvidia", "https://convex.example");
    expect(fetchPublisherProfileImageDataUrlMock).toHaveBeenCalledWith(
      "https://cdn.example.com/verified-avatar.png",
    );
    expect(fetchImageDataUrlMock).toHaveBeenCalledTimes(1);
    expect(fetchImageDataUrlMock).toHaveBeenCalledWith("https://cdn.example.com/verified-org.png", {
      allowPublicHttps: true,
      followRedirects: true,
    });
    expect(buildPublisherOgSvgMock).toHaveBeenCalledWith(
      expect.objectContaining({
        avatarShape: "rounded",
        official: true,
        title: "Verified NVIDIA",
        organizationCount: 1,
        organizationLogos: [
          "data:image/png;base64,https://cdn.example.com/verified-org.png-normalized",
        ],
        stats: [{ value: "1.2k", label: "Downloads" }],
      }),
    );
  });

  it("uses verified metadata when fetched metadata adds trust indicators", async () => {
    process.env.VITE_CONVEX_URL = "https://convex.example";
    getQueryMock.mockReturnValue({
      handle: "nvidia",
      title: "Fake NVIDIA",
      downloads: "999999",
      kind: "user",
      official: "0",
      orgImages: "0",
    });
    fetchPublisherOgMetaMock.mockResolvedValue({
      handle: "nvidia",
      kind: "org",
      official: true,
      displayName: "Verified NVIDIA",
      image: "https://cdn.example.com/verified-avatar.png",
      affiliations: [
        {
          handle: "verified-org",
          displayName: "Verified Org",
          image: "https://cdn.example.com/verified-org.png",
        },
      ],
      stats: { downloads: 1200 },
    });

    const handler = (await import("../routes/og/profile.png")).default;
    await handler({} as never);

    expect(fetchPublisherOgMetaMock).toHaveBeenCalledWith("nvidia", "https://convex.example");
    expect(fetchPublisherProfileImageDataUrlMock).toHaveBeenCalledWith(
      "https://cdn.example.com/verified-avatar.png",
    );
    expect(fetchImageDataUrlMock).toHaveBeenCalledWith("https://cdn.example.com/verified-org.png", {
      allowPublicHttps: true,
      followRedirects: true,
    });
    expect(buildPublisherOgSvgMock).toHaveBeenCalledWith(
      expect.objectContaining({
        avatarShape: "rounded",
        official: true,
        title: "Verified NVIDIA",
        organizationCount: 1,
        organizationLogos: [
          "data:image/png;base64,https://cdn.example.com/verified-org.png-normalized",
        ],
        stats: [{ value: "1.2k", label: "Downloads" }],
      }),
    );
  });

  it("caps metadata affiliation logos before fetching and normalizing", async () => {
    process.env.VITE_CONVEX_URL = "https://convex.example";
    getQueryMock.mockReturnValue({ handle: "nvidia" });
    fetchPublisherOgMetaMock.mockResolvedValue({
      handle: "nvidia",
      kind: "user",
      official: true,
      displayName: "NVIDIA",
      image: "https://cdn.example.com/avatar.png",
      affiliations: Array.from({ length: 7 }, (_, index) => ({
        handle: `org-${index}`,
        displayName: `Org ${index}`,
        image: `https://cdn.example.com/org-${index}.png`,
      })),
      stats: { downloads: 1200 },
    });
    normalizeOgLogoDataUrlMock.mockImplementation(async (dataUrl: string) =>
      dataUrl.includes("org-2") ? null : `${dataUrl}-normalized`,
    );

    const handler = (await import("../routes/og/profile.png")).default;
    await handler({} as never);

    expect(fetchPublisherOgMetaMock).toHaveBeenCalledWith("nvidia", "https://convex.example");
    expect(fetchImageDataUrlMock).toHaveBeenCalledTimes(5);
    expect(fetchImageDataUrlMock.mock.calls.map((call) => call[0])).toEqual([
      "https://cdn.example.com/org-0.png",
      "https://cdn.example.com/org-1.png",
      "https://cdn.example.com/org-2.png",
      "https://cdn.example.com/org-3.png",
      "https://cdn.example.com/org-4.png",
    ]);
    expect(normalizeOgLogoDataUrlMock).toHaveBeenCalledTimes(5);
    expect(buildPublisherOgSvgMock).toHaveBeenCalledWith(
      expect.objectContaining({
        official: true,
        title: "NVIDIA",
        handleLabel: "@nvidia",
        organizationCount: 5,
        organizationLogos: [
          "data:image/png;base64,https://cdn.example.com/org-0.png-normalized",
          "data:image/png;base64,https://cdn.example.com/org-1.png-normalized",
          "data:image/png;base64,https://cdn.example.com/org-3.png-normalized",
          "data:image/png;base64,https://cdn.example.com/org-4.png-normalized",
        ],
      }),
    );
  });
});
