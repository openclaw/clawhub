/* @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getQueryMock = vi.fn();
const getRequestHostMock = vi.fn();
const setHeaderMock = vi.fn();
const fetchPluginOgMetaMock = vi.fn();
const getMarkDataUrlMock = vi.fn();
const getWatermarkDataUrlMock = vi.fn();
const ensureResvgWasmMock = vi.fn();
const getFontBuffersMock = vi.fn();
const buildPluginOgSvgMock = vi.fn();
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

vi.mock("../../og/fetchPluginOgMeta", () => ({
  fetchPluginOgMeta: (...args: unknown[]) => fetchPluginOgMetaMock(...args),
}));

vi.mock("../../og/ogAssets", () => ({
  FONT_MONO: "IBM Plex Mono",
  FONT_SANS: "Bricolage Grotesque",
  getMarkDataUrl: (...args: unknown[]) => getMarkDataUrlMock(...args),
  getWatermarkDataUrl: (...args: unknown[]) => getWatermarkDataUrlMock(...args),
  ensureResvgWasm: (...args: unknown[]) => ensureResvgWasmMock(...args),
  getFontBuffers: (...args: unknown[]) => getFontBuffersMock(...args),
}));

vi.mock("../../og/fetchImageDataUrl", () => ({
  fetchImageDataUrl: vi.fn(async () => null),
}));

vi.mock("../../og/pluginOgSvg", () => ({
  buildPluginOgSvg: (...args: unknown[]) => buildPluginOgSvgMock(...args),
}));

vi.mock("@resvg/resvg-wasm", () => ({
  Resvg: ResvgMockClass,
}));

beforeEach(() => {
  getQueryMock.mockReset();
  getRequestHostMock.mockReset();
  setHeaderMock.mockReset();
  fetchPluginOgMetaMock.mockReset();
  getMarkDataUrlMock.mockReset();
  getWatermarkDataUrlMock.mockReset();
  ensureResvgWasmMock.mockReset();
  getFontBuffersMock.mockReset();
  buildPluginOgSvgMock.mockReset();
  renderAsPngMock.mockReset();
  freeMock.mockReset();
  resvgCtorMock.mockReset();

  getMarkDataUrlMock.mockResolvedValue("data:image/png;base64,AAA=");
  getWatermarkDataUrlMock.mockResolvedValue("data:image/png;base64,WWW=");
  ensureResvgWasmMock.mockResolvedValue(undefined);
  getFontBuffersMock.mockResolvedValue([new Uint8Array([1, 2, 3])]);
  buildPluginOgSvgMock.mockReturnValue("<svg>plugin</svg>");
  renderAsPngMock.mockReturnValue(new Uint8Array([7, 8, 9]));
});

afterEach(() => {
  delete process.env.VITE_CONVEX_SITE_URL;
  delete process.env.SITE_URL;
  delete process.env.VITE_SITE_URL;
});

describe("plugin og route", () => {
  it("returns plain text when name is missing", async () => {
    getQueryMock.mockReturnValue({});

    const handler = (await import("./plugin.png")).default;
    await expect(handler({} as never)).resolves.toBe("Missing `name` query param.");

    expect(setHeaderMock).toHaveBeenCalledWith({}, "Content-Type", "text/plain; charset=utf-8");
    expect(fetchPluginOgMetaMock).not.toHaveBeenCalled();
    expect(resvgCtorMock).not.toHaveBeenCalled();
  });

  it("does not render pending plugin scans as passing", async () => {
    getQueryMock.mockReturnValue({ name: "@openclaw/codex" });
    getRequestHostMock.mockReturnValue("preview.clawhub.ai");
    fetchPluginOgMetaMock.mockResolvedValue({
      name: "@openclaw/codex",
      owner: "openclaw",
      ownerImage: null,
      latestVersion: null,
      displayName: "Codex",
      summary: "OpenClaw Codex harness.",
      stats: { downloads: 1200 },
      verification: { scanStatus: "pending" },
    });

    const handler = (await import("./plugin.png")).default;
    const response = (await handler({} as never)) as Response;

    expect(fetchPluginOgMetaMock).toHaveBeenCalledWith(
      "@openclaw/codex",
      "https://preview.clawhub.ai",
    );
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(buildPluginOgSvgMock).toHaveBeenCalledWith(
      expect.objectContaining({
        stats: [
          { value: "1.2k", label: "Downloads" },
          { value: "PENDING", label: "Audit" },
        ],
      }),
    );
  });

  it("only renders PASS for explicit clean plugin scans", async () => {
    getQueryMock.mockReturnValue({ name: "@openclaw/codex" });
    fetchPluginOgMetaMock.mockResolvedValue({
      name: "@openclaw/codex",
      owner: "openclaw",
      ownerImage: null,
      latestVersion: "1.0.0",
      displayName: "Codex",
      summary: "OpenClaw Codex harness.",
      stats: { downloads: 1200 },
      verification: { scanStatus: "clean" },
    });

    const handler = (await import("./plugin.png")).default;
    const response = (await handler({} as never)) as Response;

    expect(response.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(buildPluginOgSvgMock).toHaveBeenCalledWith(
      expect.objectContaining({
        stats: [
          { value: "1.2k", label: "Downloads" },
          { value: "PASS", label: "Audit" },
        ],
      }),
    );
  });

  it("renders unknown audit state when metadata is not fetched", async () => {
    getQueryMock.mockReturnValue({
      name: "@openclaw/codex",
      owner: "openclaw",
      title: "Codex",
      description: "OpenClaw Codex harness.",
      downloads: "0",
    });

    const handler = (await import("./plugin.png")).default;
    await handler({} as never);

    expect(fetchPluginOgMetaMock).not.toHaveBeenCalled();
    expect(buildPluginOgSvgMock).toHaveBeenCalledWith(
      expect.objectContaining({
        stats: [
          { value: "0", label: "Downloads" },
          { value: "UNKNOWN", label: "Audit" },
        ],
      }),
    );
  });

  it("uses explicit downloads over legacy installs query params", async () => {
    getQueryMock.mockReturnValue({
      name: "@openclaw/codex",
      owner: "openclaw",
      title: "Codex",
      description: "OpenClaw Codex harness.",
      downloads: "0",
      installs: "9.9k",
    });

    const handler = (await import("./plugin.png")).default;
    await handler({} as never);

    expect(fetchPluginOgMetaMock).not.toHaveBeenCalled();
    expect(buildPluginOgSvgMock).toHaveBeenCalledWith(
      expect.objectContaining({
        stats: [
          { value: "0", label: "Downloads" },
          { value: "UNKNOWN", label: "Audit" },
        ],
      }),
    );
  });
});
