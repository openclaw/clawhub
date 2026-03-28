/* @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const getRequestHeadersMock = vi.fn();
const getRequestUrlMock = vi.fn();
vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeaders: () => getRequestHeadersMock(),
  getRequestUrl: () => getRequestUrlMock(),
}));

import {
  fetchPackageDetail,
  fetchPackageReadme,
  fetchPackageVersion,
  fetchPluginCatalog,
  fetchPackages,
  getPackageDownloadPath,
} from "./packageApi";

describe("fetchPackages", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_CONVEX_SITE_URL", "");
  });

  afterEach(() => {
    getRequestHeadersMock.mockReset();
    getRequestUrlMock.mockReset();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("preserves search filters when using /packages/search", async () => {
    vi.stubEnv("VITE_CONVEX_URL", "https://registry.example");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ results: [] }), { status: 200 }));

    await fetchPackages({
      q: "demo",
      family: "code-plugin",
      executesCode: true,
      capabilityTag: "tools",
      limit: 12,
      isOfficial: true,
    });

    const requestUrl = fetchMock.mock.calls[0]?.[0];
    if (typeof requestUrl !== "string") {
      throw new Error("Expected fetch to be called with a string URL");
    }
    const url = new URL(requestUrl);
    expect(url.pathname).toBe("/api/v1/packages/search");
    expect(url.searchParams.get("q")).toBe("demo");
    expect(url.searchParams.get("family")).toBe("code-plugin");
    expect(url.searchParams.get("executesCode")).toBe("true");
    expect(url.searchParams.get("capabilityTag")).toBe("tools");
    expect(url.searchParams.get("limit")).toBe("12");
    expect(url.searchParams.get("isOfficial")).toBe("true");
  });

  it("forwards skill family on package listings", async () => {
    vi.stubEnv("VITE_CONVEX_URL", "https://registry.example");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 }));

    await fetchPackages({
      family: "skill",
      limit: 12,
    });

    const requestUrl = fetchMock.mock.calls[0]?.[0];
    if (typeof requestUrl !== "string") {
      throw new Error("Expected fetch to be called with a string URL");
    }
    const url = new URL(requestUrl);
    expect(url.pathname).toBe("/api/v1/packages");
    expect(url.searchParams.get("family")).toBe("skill");
    expect(url.searchParams.get("limit")).toBe("12");
  });

  it("forwards opaque cursors on package listing requests", async () => {
    vi.stubEnv("VITE_CONVEX_URL", "https://registry.example");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 }));

    await fetchPackages({
      cursor: "pkgpage:test",
      limit: 12,
    });

    const requestUrl = fetchMock.mock.calls[0]?.[0];
    if (typeof requestUrl !== "string") {
      throw new Error("Expected fetch to be called with a string URL");
    }
    const url = new URL(requestUrl);
    expect(url.pathname).toBe("/api/v1/packages");
    expect(url.searchParams.get("cursor")).toBe("pkgpage:test");
    expect(url.searchParams.get("limit")).toBe("12");
  });

  it("preserves non-search listing filters on package listings", async () => {
    vi.stubEnv("VITE_CONVEX_URL", "https://registry.example");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 }));

    await fetchPackages({
      isOfficial: false,
      executesCode: false,
      capabilityTag: "storage",
      limit: 7,
    });

    const requestUrl = fetchMock.mock.calls[0]?.[0];
    if (typeof requestUrl !== "string") {
      throw new Error("Expected fetch to be called with a string URL");
    }
    const url = new URL(requestUrl);
    expect(url.pathname).toBe("/api/v1/packages");
    expect(url.searchParams.get("isOfficial")).toBe("false");
    expect(url.searchParams.get("executesCode")).toBe("false");
    expect(url.searchParams.get("capabilityTag")).toBe("storage");
    expect(url.searchParams.get("limit")).toBe("7");
  });

  it("requests README through the canonical package file path once", async () => {
    vi.stubEnv("VITE_CONVEX_URL", "https://registry.example");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("lowercase readme", { status: 200 }));

    const result = await fetchPackageReadme("demo-plugin", "1.0.0");

    expect(result).toBe("lowercase readme");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestUrl = fetchMock.mock.calls[0]?.[0];
    if (typeof requestUrl !== "string") {
      throw new Error("Expected fetch call to use a string URL");
    }
    const url = new URL(requestUrl);
    expect(url.searchParams.get("path")).toBe("README.md");
    expect(url.searchParams.get("version")).toBe("1.0.0");
  });

  it("returns an empty package detail payload on 404", async () => {
    vi.stubEnv("VITE_CONVEX_URL", "https://registry.example");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("not found", { status: 404 }));

    await expect(fetchPackageDetail("missing-plugin")).resolves.toEqual({
      package: null,
      owner: null,
    });
  });

  it("forwards request cookies and includes credentials for package detail fetches", async () => {
    vi.stubEnv("VITE_CONVEX_URL", "https://registry.example");
    getRequestUrlMock.mockReturnValue(new URL("https://app.example/packages/private-plugin"));
    getRequestHeadersMock.mockReturnValue(
      new Headers({
        cookie: "session=abc",
        "cf-connecting-ip": "203.0.113.9",
        "x-forwarded-for": "203.0.113.9, 198.51.100.2",
        "x-real-ip": "203.0.113.9",
        "fly-client-ip": "203.0.113.9",
      }),
    );
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ package: null, owner: null }), { status: 200 }),
    );

    await fetchPackageDetail("private-plugin");

    const [, requestInit] = fetchMock.mock.calls[0] ?? [];
    expect(requestInit).toEqual(
      expect.objectContaining({
        credentials: "include",
        headers: expect.objectContaining({
          Accept: "application/json",
          cookie: "session=abc",
          "cf-connecting-ip": "203.0.113.9",
          "x-forwarded-for": "203.0.113.9, 198.51.100.2",
          "x-real-ip": "203.0.113.9",
          "fly-client-ip": "203.0.113.9",
        }),
      }),
    );
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://app.example/api/v1/packages/private-plugin");
  });

  it("uses the app origin for browser package detail fetches", async () => {
    vi.stubEnv("VITE_CONVEX_URL", "https://registry.example");
    vi.stubGlobal("window", {
      location: { origin: "https://app.example" },
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ package: null, owner: null }), { status: 200 }),
    );

    await fetchPackageDetail("private-plugin");

    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://app.example/api/v1/packages/private-plugin");
  });

  it("falls back to the site URL when SSR request context is unavailable", async () => {
    vi.stubEnv("VITE_CONVEX_SITE_URL", "https://app.example");
    vi.stubEnv("VITE_CONVEX_URL", "https://registry.example");
    getRequestUrlMock.mockImplementation(() => {
      throw new Error("no request context");
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 }));

    await fetchPackages({
      family: "bundle-plugin",
      limit: 12,
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://app.example/api/v1/bundle-plugins?limit=12");
  });

  it("uses the dedicated plugins endpoint for mixed plugin browse", async () => {
    vi.stubEnv("VITE_CONVEX_URL", "https://registry.example");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 }));

    await fetchPluginCatalog({
      limit: 12,
      cursor: "pkgpage:test",
      isOfficial: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestUrl = fetchMock.mock.calls[0]?.[0];
    if (typeof requestUrl !== "string") {
      throw new Error("Expected fetch to be called with a string URL");
    }
    const url = new URL(requestUrl);
    expect(url.pathname).toBe("/api/v1/plugins");
    expect(url.searchParams.get("limit")).toBe("12");
    expect(url.searchParams.get("cursor")).toBe("pkgpage:test");
    expect(url.searchParams.get("isOfficial")).toBe("true");
  });

  it("uses the dedicated plugins search endpoint for mixed plugin search", async () => {
    vi.stubEnv("VITE_CONVEX_URL", "https://registry.example");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ results: [] }), { status: 200 }));

    await fetchPluginCatalog({
      q: "demo",
      limit: 8,
      executesCode: false,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestUrl = fetchMock.mock.calls[0]?.[0];
    if (typeof requestUrl !== "string") {
      throw new Error("Expected fetch to be called with a string URL");
    }
    const url = new URL(requestUrl);
    expect(url.pathname).toBe("/api/v1/plugins/search");
    expect(url.searchParams.get("q")).toBe("demo");
    expect(url.searchParams.get("limit")).toBe("8");
    expect(url.searchParams.get("executesCode")).toBe("false");
  });

  it("throws package detail errors for non-404 failures", async () => {
    vi.stubEnv("VITE_CONVEX_URL", "https://registry.example");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("boom", { status: 500 }));

    await expect(fetchPackageDetail("broken-plugin")).rejects.toThrow("boom");
  });

  it("fetches package version details from the encoded version route", async () => {
    vi.stubEnv("VITE_CONVEX_URL", "https://registry.example");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          package: { name: "demo-plugin", displayName: "Demo Plugin", family: "code-plugin" },
          version: { version: "1.2.3", createdAt: 1, changelog: "demo", files: [] },
        }),
        { status: 200 },
      ),
    );

    const result = await fetchPackageVersion("demo-plugin", "1.2.3+build/meta");

    expect(result.version?.version).toBe("1.2.3");
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://registry.example/api/v1/packages/demo-plugin/versions/1.2.3%2Bbuild%2Fmeta",
    );
  });

  it("returns null when no supported README variant exists", async () => {
    vi.stubEnv("VITE_CONVEX_URL", "https://registry.example");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("missing", { status: 404 }));

    await expect(fetchPackageReadme("demo-plugin", "1.0.0")).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns null when README access is blocked pending scan", async () => {
    vi.stubEnv("VITE_CONVEX_URL", "https://registry.example");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("pending scan", { status: 423 }));

    await expect(fetchPackageReadme("demo-plugin", "1.0.0")).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws when README fetch fails for reasons other than 404", async () => {
    vi.stubEnv("VITE_CONVEX_URL", "https://registry.example");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("rate limited", { status: 429 }));

    await expect(fetchPackageReadme("demo-plugin", "1.0.0")).rejects.toThrow("rate limited");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("builds same-origin package download paths", () => {
    expect(getPackageDownloadPath("private-plugin", "1.0.0")).toBe(
      "/api/v1/packages/private-plugin/download?version=1.0.0",
    );
    expect(getPackageDownloadPath("private-plugin")).toBe(
      "/api/v1/packages/private-plugin/download",
    );
  });
});

describe("fetchPluginCatalog", () => {
  afterEach(() => {
    getRequestHeadersMock.mockReset();
    getRequestUrlMock.mockReset();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("uses the dedicated plugins endpoint for browse mode without touching the unified catalog", async () => {
    vi.stubEnv("VITE_CONVEX_URL", "https://registry.example");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ items: [], nextCursor: "plugins:next" }), { status: 200 }));

    const result = await fetchPluginCatalog({
      isOfficial: true,
      limit: 20,
    });

    expect(result.nextCursor).toBe("plugins:next");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(fetchMock.mock.calls[0]?.[0] as string);
    expect(url.pathname).toBe("/api/v1/plugins");
    expect(url.searchParams.get("isOfficial")).toBe("true");
  });

  it("uses the dedicated plugins search endpoint for search mode", async () => {
    vi.stubEnv("VITE_CONVEX_URL", "https://registry.example");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            results: [
              {
                score: 5,
                package: {
                  name: "code-demo",
                  displayName: "Code Demo",
                  family: "code-plugin",
                  channel: "community",
                  isOfficial: true,
                  createdAt: 2,
                  updatedAt: 2,
                },
              },
              {
                score: 4,
                package: {
                  name: "bundle-demo",
                  displayName: "Bundle Demo",
                  family: "bundle-plugin",
                  channel: "community",
                  isOfficial: false,
                  createdAt: 1,
                  updatedAt: 1,
                },
              },
            ],
          }),
          { status: 200 },
        ),
      );

    const result = await fetchPluginCatalog({
      q: "demo",
      limit: 10,
    });

    expect(result.nextCursor).toBeNull();
    expect(result.items.map((item) => item.name)).toEqual(["code-demo", "bundle-demo"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(fetchMock.mock.calls[0]?.[0] as string);
    expect(url.pathname).toBe("/api/v1/plugins/search");
  });
});
