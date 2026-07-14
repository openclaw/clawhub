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
  fetchPackageFile,
  fetchPackageReadme,
  fetchPackageVersion,
  fetchPackageVersions,
  fetchPluginCatalog,
  fetchPackages,
  getPackageDownloadPath,
  PackageApiError,
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

  it("omits retired execution and capability filters when using /packages/search", async () => {
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
    } as Parameters<typeof fetchPackages>[0] & { executesCode?: boolean; capabilityTag?: string });

    const requestUrl = fetchMock.mock.calls[0]?.[0];
    if (typeof requestUrl !== "string") {
      throw new Error("Expected fetch to be called with a string URL");
    }
    const url = new URL(requestUrl);
    expect(url.pathname).toBe("/api/v1/packages/search");
    expect(url.searchParams.get("q")).toBe("demo");
    expect(url.searchParams.get("family")).toBe("code-plugin");
    expect(url.searchParams.has("executesCode")).toBe(false);
    expect(url.searchParams.has("capabilityTag")).toBe(false);
    expect(url.searchParams.get("limit")).toBe("12");
    expect(url.searchParams.get("isOfficial")).toBe("true");
  });

  it("forwards skill family on package listings", async () => {
    vi.stubEnv("VITE_CONVEX_URL", "https://registry.example");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 }),
      );

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
      .mockResolvedValue(
        new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 }),
      );

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

  it("omits retired execution and capability filters on package listings", async () => {
    vi.stubEnv("VITE_CONVEX_URL", "https://registry.example");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 }),
      );

    await fetchPackages({
      isOfficial: false,
      executesCode: false,
      capabilityTag: "storage",
      limit: 7,
    } as Parameters<typeof fetchPackages>[0] & { executesCode?: boolean; capabilityTag?: string });

    const requestUrl = fetchMock.mock.calls[0]?.[0];
    if (typeof requestUrl !== "string") {
      throw new Error("Expected fetch to be called with a string URL");
    }
    const url = new URL(requestUrl);
    expect(url.pathname).toBe("/api/v1/packages");
    expect(url.searchParams.get("isOfficial")).toBe("false");
    expect(url.searchParams.has("executesCode")).toBe(false);
    expect(url.searchParams.has("capabilityTag")).toBe(false);
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

  it("preserves package stats from package detail responses", async () => {
    vi.stubEnv("VITE_CONVEX_URL", "https://registry.example");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          package: {
            name: "demo-plugin",
            displayName: "Demo Plugin",
            family: "code-plugin",
            channel: "community",
            isOfficial: false,
            createdAt: 1,
            updatedAt: 2,
            tags: {},
            stats: {
              downloads: 7,
              installs: 3,
              stars: 2,
              versions: 4,
            },
          },
          owner: null,
        }),
        { status: 200 },
      ),
    );

    await expect(fetchPackageDetail("demo-plugin")).resolves.toMatchObject({
      package: {
        stats: {
          downloads: 7,
          installs: 3,
          stars: 2,
          versions: 4,
        },
      },
    });
  });

  it("forwards request cookies and includes credentials for package detail fetches", async () => {
    vi.stubEnv("VITE_CONVEX_SITE_URL", "https://app.example");
    vi.stubEnv("VITE_CONVEX_URL", "https://registry.example");
    getRequestHeadersMock.mockReturnValue(
      new Headers({
        cookie: "session=abc",
        "cf-connecting-ip": "203.0.113.9",
        "x-forwarded-for": "203.0.113.9, 198.51.100.2",
        "x-real-ip": "203.0.113.9",
        "fly-client-ip": "203.0.113.9",
      }),
    );
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ package: null, owner: null }), { status: 200 }),
      );

    await fetchPackageDetail("private-plugin");

    const [, requestInit] = fetchMock.mock.calls[0] ?? [];
    expect(requestInit).toEqual(
      expect.objectContaining({
        credentials: expect.stringMatching(/^(include|omit)$/),
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
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
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
      .mockResolvedValue(
        new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 }),
      );

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
      .mockResolvedValue(
        new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 }),
      );

    await fetchPluginCatalog({
      limit: 12,
      cursor: "pkgpage:test",
      isOfficial: true,
      category: "tools",
      officialFirst: true,
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
    expect(url.searchParams.get("category")).toBe("tools");
    expect(url.searchParams.get("officialFirst")).toBe("true");
  });

  it("omits viewer credentials from anonymous plugin catalog requests", async () => {
    vi.stubEnv("VITE_CONVEX_SITE_URL", "https://app.example");
    vi.stubEnv("VITE_CONVEX_URL", "https://registry.example");
    getRequestHeadersMock.mockReturnValue(
      new Headers({
        authorization: "Bearer private-token",
        cookie: "session=private",
        "x-forwarded-for": "203.0.113.9",
      }),
    );
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 }),
      );

    await fetchPluginCatalog({ limit: 12, viewerMode: "anonymous" });

    const [, requestInit] = fetchMock.mock.calls[0] ?? [];
    expect(requestInit).toEqual(
      expect.objectContaining({
        credentials: "omit",
        headers: expect.objectContaining({
          Accept: "application/json",
          "x-forwarded-for": "203.0.113.9",
        }),
      }),
    );
    expect(requestInit?.headers).not.toHaveProperty("authorization");
    expect(requestInit?.headers).not.toHaveProperty("cookie");
  });

  it("uses the dedicated plugins search endpoint for mixed plugin search", async () => {
    vi.stubEnv("VITE_CONVEX_URL", "https://registry.example");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ results: [] }), { status: 200 }));

    await fetchPluginCatalog({
      q: "demo",
      limit: 8,
      category: "runtime",
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
    expect(url.searchParams.has("executesCode")).toBe(false);
    expect(url.searchParams.get("category")).toBe("runtime");
  });

  it("throws package detail errors for non-404 failures", async () => {
    vi.stubEnv("VITE_CONVEX_URL", "https://registry.example");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("boom", { status: 500 }));

    await expect(fetchPackageDetail("broken-plugin")).rejects.toMatchObject({
      message: "boom",
      status: 500,
      retryAfterSeconds: null,
    });
  });

  it("expands generic package API auth and visibility failures", async () => {
    vi.stubEnv("VITE_CONVEX_URL", "https://registry.example");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 }),
    );

    await expect(fetchPackages({ family: "code-plugin" })).rejects.toMatchObject({
      message:
        "Sign in required. If this ClawHub account was deleted, banned, or disabled, it cannot access private packages.",
      status: 401,
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Package not found", { status: 404 }),
    );
    await expect(fetchPackages({ family: "code-plugin" })).rejects.toMatchObject({
      message: "Package not found or not visible to this account.",
      status: 404,
    });
  });

  it("keeps specific package API denial bodies", async () => {
    vi.stubEnv("VITE_CONVEX_URL", "https://registry.example");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Trusted publisher config is not set for this package", { status: 403 }),
    );

    await expect(fetchPackages({ family: "code-plugin" })).rejects.toMatchObject({
      message: "Trusted publisher config is not set for this package",
      status: 403,
    });
  });

  it("preserves retry metadata on rate-limited package detail failures", async () => {
    vi.stubEnv("VITE_CONVEX_URL", "https://registry.example");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("rate limited", {
        status: 429,
        headers: { "Retry-After": "17" },
      }),
    );

    await expect(fetchPackageDetail("busy-plugin")).rejects.toEqual(
      expect.objectContaining<Partial<PackageApiError>>({
        name: "PackageApiRateLimitError",
        message: "rate limited",
        status: 429,
        retryAfterSeconds: 17,
      }),
    );
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

    expect(result?.version?.version).toBe("1.2.3");
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://registry.example/api/v1/packages/demo-plugin/versions/1.2.3%2Bbuild%2Fmeta",
    );
  });

  it("preserves plugin manifest summaries from package version responses", async () => {
    vi.stubEnv("VITE_CONVEX_URL", "https://registry.example");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          package: {
            name: "example-ai-plugin",
            displayName: "Example AI Plugin",
            family: "code-plugin",
          },
          version: {
            version: "1.2.3",
            createdAt: 1,
            changelog: "demo",
            files: [],
            pluginManifestSummary: {
              schemaVersion: 1,
              compatibility: { pluginApiRange: "^2.0.0" },
              configFields: [
                {
                  name: "EXAMPLE_PLUGIN_API_KEY",
                  description: "API key used to connect to the example service.",
                  required: true,
                  sensitive: true,
                },
              ],
              mcpServers: [{ name: "exampleMcp" }],
              bundledSkills: [
                {
                  name: "research",
                  description: "Deep research assistant.",
                  rootPath: "skills/research",
                  skillMdPath: "skills/research/SKILL.md",
                  sha256: "a".repeat(64),
                  size: 128,
                },
              ],
            },
          },
        }),
        { status: 200 },
      ),
    );

    const result = await fetchPackageVersion("example-ai-plugin", "1.2.3");

    expect(result?.version?.pluginManifestSummary).toMatchObject({
      compatibility: { pluginApiRange: "^2.0.0" },
      mcpServers: [{ name: "exampleMcp" }],
      bundledSkills: [expect.objectContaining({ skillMdPath: "skills/research/SKILL.md" })],
    });
  });

  it("fetches arbitrary package text files with encoded paths for lazy previews", async () => {
    vi.stubEnv("VITE_CONVEX_URL", "https://registry.example");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("# Research", { status: 200 }));

    await expect(
      fetchPackageFile("example-ai-plugin", "skills/research/SKILL.md", "1.2.3"),
    ).resolves.toBe("# Research");

    const url = new URL(fetchMock.mock.calls[0]?.[0] as string);
    expect(url.pathname).toBe("/api/v1/packages/example-ai-plugin/file");
    expect(url.searchParams.get("path")).toBe("skills/research/SKILL.md");
    expect(url.searchParams.get("version")).toBe("1.2.3");
  });

  it("fetches scoped package version history with pagination", async () => {
    vi.stubEnv("VITE_CONVEX_URL", "https://registry.example");
    const response = {
      items: [
        {
          version: "1.2.3",
          createdAt: 123,
          changelog: "Added package history",
          distTags: ["latest"],
        },
      ],
      nextCursor: "versions:next",
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify(response), { status: 200 }));

    await expect(
      fetchPackageVersions("@scope/demo-plugin", {
        cursor: "versions:current",
        limit: 25,
      }),
    ).resolves.toEqual(response);

    const requestUrl = fetchMock.mock.calls[0]?.[0];
    if (typeof requestUrl !== "string") {
      throw new Error("Expected fetch to be called with a string URL");
    }
    const url = new URL(requestUrl);
    expect(url.pathname).toBe("/api/v1/packages/%40scope%2Fdemo-plugin/versions");
    expect(url.searchParams.get("cursor")).toBe("versions:current");
    expect(url.searchParams.get("limit")).toBe("25");
  });

  it("omits unprovided package version history params and forwards the signal", async () => {
    vi.stubEnv("VITE_CONVEX_URL", "https://registry.example");
    const signal = new AbortController().signal;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 }),
      );

    await fetchPackageVersions("demo-plugin", { signal });

    const requestUrl = fetchMock.mock.calls[0]?.[0];
    if (typeof requestUrl !== "string") {
      throw new Error("Expected fetch to be called with a string URL");
    }
    const url = new URL(requestUrl);
    expect(url.searchParams.has("cursor")).toBe(false);
    expect(url.searchParams.has("limit")).toBe(false);
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(signal);
  });

  it("omits an empty package version history cursor", async () => {
    vi.stubEnv("VITE_CONVEX_URL", "https://registry.example");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 }),
      );

    await fetchPackageVersions("demo-plugin", { cursor: "" });

    const url = new URL(fetchMock.mock.calls[0]?.[0] as string);
    expect(url.searchParams.has("cursor")).toBe(false);
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
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("rate limited", {
        status: 429,
        headers: { "Retry-After": "9" },
      }),
    );

    await expect(fetchPackageReadme("demo-plugin", "1.0.0")).rejects.toMatchObject({
      name: "PackageApiRateLimitError",
      message: "rate limited",
      status: 429,
      retryAfterSeconds: 9,
    });
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
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ items: [], nextCursor: "plugins:next", totalCount: 42 }), {
        status: 200,
      }),
    );

    const result = await fetchPluginCatalog({
      isOfficial: true,
      limit: 20,
    });

    expect(result.nextCursor).toBe("plugins:next");
    expect(result.totalCount).toBe(42);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(fetchMock.mock.calls[0]?.[0] as string);
    expect(url.pathname).toBe("/api/v1/plugins");
    expect(url.searchParams.get("isOfficial")).toBe("true");
  });

  it("forwards explicit valid sort values to the dedicated plugins browse endpoint", async () => {
    vi.stubEnv("VITE_CONVEX_URL", "https://registry.example");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 });
    });

    await fetchPluginCatalog({
      sort: "updated",
      limit: 20,
    });

    const url = new URL(fetchMock.mock.calls[0]?.[0] as string);
    expect(url.pathname).toBe("/api/v1/plugins");
    expect(url.searchParams.get("sort")).toBe("updated");

    await fetchPluginCatalog({
      sort: "downloads",
      limit: 20,
    });

    const downloadsUrl = new URL(fetchMock.mock.calls[1]?.[0] as string);
    expect(downloadsUrl.pathname).toBe("/api/v1/plugins");
    expect(downloadsUrl.searchParams.get("sort")).toBe("downloads");
  });

  it("uses the dedicated plugins search endpoint for search mode", async () => {
    vi.stubEnv("VITE_CONVEX_URL", "https://registry.example");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
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
      cursor: "cursor:plugins",
      limit: 10,
    });

    expect(result.nextCursor).toBeNull();
    expect(result.items.map((item) => item.name)).toEqual(["code-demo", "bundle-demo"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(fetchMock.mock.calls[0]?.[0] as string);
    expect(url.pathname).toBe("/api/v1/plugins/search");
    expect(url.searchParams.has("cursor")).toBe(false);
    expect(url.searchParams.has("sort")).toBe(false);
  });

  it("ignores malformed plugin search entries defensively", async () => {
    vi.stubEnv("VITE_CONVEX_URL", "https://registry.example");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            null,
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

    const result = await fetchPluginCatalog({ q: "demo" });

    expect(result.items.map((item) => item.name)).toEqual(["bundle-demo"]);
  });

  it("keeps relevance as the implicit plugins search sort", async () => {
    vi.stubEnv("VITE_CONVEX_URL", "https://registry.example");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [],
          nextCursor: "ignored-for-relevance",
        }),
        { status: 200 },
      ),
    );

    const result = await fetchPluginCatalog({
      q: "demo",
      limit: 10,
    });

    expect(result.nextCursor).toBeNull();
    const url = new URL(fetchMock.mock.calls[0]?.[0] as string);
    expect(url.pathname).toBe("/api/v1/plugins/search");
    expect(url.searchParams.has("sort")).toBe(false);
  });
});
