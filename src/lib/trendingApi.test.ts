import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchCanonicalTrendingPage } from "./trendingApi";

describe("fetchCanonicalTrendingPage", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubEnv("VITE_CONVEX_SITE_URL", "https://catalog.example");
  });

  it("requests the canonical skills feed with its opaque stable cursor", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          kind: "skills",
          snapshotId: "snapshot-1",
          snapshotCursor: "snapshot-cursor",
          generatedAt: "2026-07-26T00:00:00.000Z",
          windowHours: 24,
          rankingVersion: "skills-trending-v1",
          totalItems: 21,
          items: [],
          nextCursor: "next-cursor",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchCanonicalTrendingPage({ cursor: "opaque cursor", limit: 20 }),
    ).resolves.toEqual(
      expect.objectContaining({ snapshotId: "snapshot-1", nextCursor: "next-cursor" }),
    );

    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/api/v1/trending");
    expect(url.searchParams.get("kind")).toBe("skills");
    expect(url.searchParams.get("limit")).toBe("20");
    expect(url.searchParams.get("cursor")).toBe("opaque cursor");
  });

  it("preserves the canonical 24-hour download total separately from installs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify(
            canonicalPage({
              metrics: {
                trending24hDownloads: 71,
                trending24hInstalls: 17,
                trending24hBookmarks: null,
                lifetimeInstalls: 10,
                lifetimeInstallsPeriod: "lifetime",
                updatedAt: 1,
              },
            }),
          ),
          { status: 200 },
        ),
      ),
    );

    const page = await fetchCanonicalTrendingPage({ limit: 20 });
    expect(page.items[0]?.metrics.trending24hDownloads).toBe(71);
    expect(page.items[0]?.metrics.trending24hInstalls).toBe(17);
  });

  it("fails closed on a malformed canonical response", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ items: [{ id: "missing-contract" }] }), { status: 200 }),
        ),
    );

    await expect(fetchCanonicalTrendingPage({ limit: 20 })).rejects.toThrow(
      "Invalid canonical Trending response",
    );
  });

  it("fails closed on an unsafe canonical link", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify(
            canonicalPage({
              canonicalUrl: "javascript:alert(document.domain)",
            }),
          ),
          { status: 200 },
        ),
      ),
    );

    await expect(fetchCanonicalTrendingPage({ limit: 20 })).rejects.toThrow(
      "Invalid canonical Trending response",
    );
  });

  it("fails closed when consumed publisher or metric fields are malformed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify(
            canonicalPage({
              publisher: "not-a-publisher",
              metrics: {
                trending24hInstalls: 3,
                trending24hBookmarks: null,
                lifetimeInstalls: null,
                lifetimeInstallsPeriod: "weekly",
                updatedAt: "yesterday",
              },
            }),
          ),
          { status: 200 },
        ),
      ),
    );

    await expect(fetchCanonicalTrendingPage({ limit: 20 })).rejects.toThrow(
      "Invalid canonical Trending response",
    );
  });
});

function canonicalPage(itemOverrides: Record<string, unknown>) {
  return {
    kind: "skills",
    snapshotId: "snapshot-1",
    snapshotCursor: "snapshot-cursor",
    generatedAt: "2026-07-26T00:00:00.000Z",
    windowHours: 24,
    rankingVersion: "skills-trending-v1",
    totalItems: 1,
    items: [
      {
        id: "clawhub:skill-1",
        source: "clawhub",
        slug: "skill-1",
        displayName: "Skill One",
        summary: "A useful skill",
        canonicalUrl: "/owner/skill-1",
        publisher: {
          kind: "user",
          handle: "owner",
          displayName: "Owner",
          image: null,
          official: false,
        },
        official: false,
        featured: false,
        metrics: {
          trending24hDownloads: 3,
          trending24hInstalls: 3,
          trending24hBookmarks: null,
          lifetimeInstalls: 10,
          lifetimeInstallsPeriod: "lifetime",
          updatedAt: 1,
        },
        ...itemOverrides,
      },
    ],
    nextCursor: null,
  };
}
