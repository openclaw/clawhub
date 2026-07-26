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
});
