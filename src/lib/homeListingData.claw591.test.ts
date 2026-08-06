import { beforeEach, describe, expect, it, vi } from "vitest";

const convexQueryMock = vi.fn();
const fetchPluginCatalogMock = vi.fn();
const fetchCanonicalTrendingPageMock = vi.fn();
const fetchCatalogDiscoveryCapabilitiesMock = vi.fn();

vi.mock("../convex/client", () => ({
  convexHttp: { query: (...args: unknown[]) => convexQueryMock(...args) },
}));

vi.mock("../../convex/_generated/api", () => ({
  api: {
    packages: { listPublicNewPluginsPage: "packages:listPublicNewPluginsPage" },
    skills: {
      listPublicPageV4: "skills:listPublicPageV4",
      listPublicTrendingPage: "skills:listPublicTrendingPage",
    },
  },
}));

vi.mock("./packageApi", () => ({
  fetchPluginCatalog: (...args: unknown[]) => fetchPluginCatalogMock(...args),
}));

vi.mock("./catalogDiscoveryCapabilities", () => ({
  fetchCatalogDiscoveryCapabilities: (...args: unknown[]) =>
    fetchCatalogDiscoveryCapabilitiesMock(...args),
}));

vi.mock("./trendingApi", async (importOriginal) => {
  const original = await importOriginal<typeof import("./trendingApi")>();
  return {
    ...original,
    fetchCanonicalTrendingPage: (...args: unknown[]) => fetchCanonicalTrendingPageMock(...args),
  };
});

import {
  fetchHomePluginListing,
  fetchHomeSkillListing,
  fetchInitialHomeListing,
  HOME_LISTING_PAGE_SIZE,
  HOME_NEW_WINDOW_MS,
  searchHomeTrendingSkillListing,
} from "./homeListingData";

describe("homeListingData", () => {
  beforeEach(() => {
    convexQueryMock.mockReset();
    fetchPluginCatalogMock.mockReset();
    fetchCanonicalTrendingPageMock.mockReset();
    fetchCatalogDiscoveryCapabilitiesMock.mockReset();
    fetchCatalogDiscoveryCapabilitiesMock.mockResolvedValue({
      apiVersion: 1,
      canonicalTrendingEnabled: true,
    });
    convexQueryMock.mockResolvedValue({ page: [], hasMore: false, nextCursor: null });
    fetchPluginCatalogMock.mockResolvedValue({ items: [], nextCursor: null });
    fetchCanonicalTrendingPageMock.mockResolvedValue(canonicalPage([], null));
  });

  it("loads canonical Trending skills as the initial homepage catalog", async () => {
    const item = makeTrending("first", "First", 12);
    fetchCanonicalTrendingPageMock.mockResolvedValue(canonicalPage([item], "next-cursor"));

    await expect(fetchInitialHomeListing()).resolves.toEqual({
      kind: "skills",
      tab: "trending",
      categorySlugs: [],
      fetchLimit: HOME_LISTING_PAGE_SIZE,
      items: [{ trending: item }],
      hasMore: true,
      trendingState: "available",
    });
  });

  it("preserves canonical order and forwards opaque cursors across pages", async () => {
    const first = makeTrending("first", "First", 12);
    const second = makeTrending("second", "Second", 8);
    fetchCanonicalTrendingPageMock
      .mockResolvedValueOnce(canonicalPage([first], "opaque cursor 2"))
      .mockResolvedValueOnce(canonicalPage([second], null));

    const result = await fetchHomeSkillListing("trending", [], 2);

    expect(
      result.page.map((entry) => ("trending" in entry ? entry.trending.id : "native")),
    ).toEqual([first.id, second.id]);
    expect(fetchCanonicalTrendingPageMock).toHaveBeenNthCalledWith(1, {
      cursor: null,
      limit: 2,
      signal: undefined,
    });
    expect(fetchCanonicalTrendingPageMock).toHaveBeenNthCalledWith(2, {
      cursor: "opaque cursor 2",
      limit: 1,
      signal: undefined,
    });
  });

  it("limits Trending search pages while preserving buffered matches for See more", async () => {
    const matches = Array.from({ length: 25 }, (_, index) =>
      makeTrending(`calendar-${index}`, `Calendar ${index}`, 25 - index),
    );
    fetchCanonicalTrendingPageMock.mockResolvedValue(canonicalPage(matches, null));

    const firstPage = await searchHomeTrendingSkillListing("calendar", 20);
    expect(firstPage.page).toHaveLength(20);
    expect(firstPage.hasMore).toBe(true);

    const expandedPage = await searchHomeTrendingSkillListing("calendar", 40);
    expect(expandedPage.page).toHaveLength(25);
    expect(expandedPage.hasMore).toBe(false);
  });

  it("rejects a later canonical page failure instead of replacing loaded results", async () => {
    const first = makeTrending("first", "First", 12);
    fetchCanonicalTrendingPageMock
      .mockResolvedValueOnce(canonicalPage([first], "opaque cursor 2"))
      .mockRejectedValueOnce(new Error("second page unavailable"));

    await expect(fetchHomeSkillListing("trending", [], 2)).rejects.toThrow(
      "second page unavailable",
    );
    expect(convexQueryMock).not.toHaveBeenCalled();
  });

  it("reports canonical Trending unavailable without reading the legacy leaderboard", async () => {
    fetchCatalogDiscoveryCapabilitiesMock.mockResolvedValue({
      apiVersion: 0,
      canonicalTrendingEnabled: false,
    });

    await expect(fetchHomeSkillListing("trending", [], HOME_LISTING_PAGE_SIZE)).resolves.toEqual({
      page: [],
      hasMore: false,
      trendingState: "unavailable",
    });
    expect(convexQueryMock).not.toHaveBeenCalled();
    expect(fetchCanonicalTrendingPageMock).not.toHaveBeenCalled();
  });

  it("reports stale or unavailable canonical Trending without a legacy retry", async () => {
    fetchCanonicalTrendingPageMock.mockRejectedValue(new Error("Trending snapshot expired"));

    await expect(fetchHomeSkillListing("trending", [], HOME_LISTING_PAGE_SIZE)).resolves.toEqual({
      page: [],
      hasMore: false,
      trendingState: "unavailable",
    });
    expect(convexQueryMock).not.toHaveBeenCalled();
  });

  it("reports Trending unavailable when capability discovery fails", async () => {
    fetchCatalogDiscoveryCapabilitiesMock.mockRejectedValue(new Error("capability outage"));

    await expect(fetchHomeSkillListing("trending", [], HOME_LISTING_PAGE_SIZE)).resolves.toEqual({
      page: [],
      hasMore: false,
      trendingState: "unavailable",
    });
    expect(convexQueryMock).not.toHaveBeenCalled();
    expect(fetchCanonicalTrendingPageMock).not.toHaveBeenCalled();
  });

  it("loads New from the native 14-day chronological feed", async () => {
    const now = Date.now();
    await fetchHomeSkillListing("new", [], HOME_LISTING_PAGE_SIZE);

    expect(convexQueryMock).toHaveBeenCalledWith(
      "skills:listPublicPageV4",
      expect.objectContaining({
        sort: "newest",
        dir: "desc",
        numItems: HOME_LISTING_PAGE_SIZE,
        createdAfter: expect.any(Number),
      }),
    );
    const args = convexQueryMock.mock.calls[0]?.[1] as { createdAfter: number };
    expect(now - args.createdAfter).toBeGreaterThanOrEqual(HOME_NEW_WINDOW_MS - 10);
  });

  it("omits new-only arguments and filters the cutoff against a legacy backend", async () => {
    const now = Date.now();
    const recent = makeNative("recent", now - 1_000, 0);
    const old = makeNative("old", now - HOME_NEW_WINDOW_MS - 1, 0);
    fetchCatalogDiscoveryCapabilitiesMock.mockResolvedValue({
      apiVersion: 0,
      canonicalTrendingEnabled: false,
    });
    convexQueryMock.mockResolvedValue({
      page: [recent, old],
      hasMore: true,
      nextCursor: "must-not-scan",
    });

    const result = await fetchHomeSkillListing("new", [], HOME_LISTING_PAGE_SIZE);

    expect(result).toEqual({ page: [recent], hasMore: false });
    expect(convexQueryMock).toHaveBeenCalledWith(
      "skills:listPublicPageV4",
      expect.not.objectContaining({ createdAfter: expect.any(Number) }),
    );
  });

  it("requests the latest 40 Featured skills and preserves editorial order", async () => {
    convexQueryMock.mockResolvedValue({
      page: [makeNative("newest", 200, 1), makeNative("older", 100, 10_000)],
      hasMore: false,
      nextCursor: null,
    });

    const result = await fetchHomeSkillListing("featured", [], HOME_LISTING_PAGE_SIZE);

    expect(result.page.map((entry) => ("skill" in entry ? entry.skill.slug : "trending"))).toEqual([
      "newest",
      "older",
    ]);
    expect(convexQueryMock).toHaveBeenCalledWith(
      "skills:listPublicPageV4",
      expect.objectContaining({ highlightedOnly: true, numItems: 40 }),
    );
  });

  it("ends the finite Featured feed after exposing the latest 40", async () => {
    convexQueryMock.mockResolvedValue({
      page: Array.from({ length: 40 }, (_, index) =>
        makeNative(`featured-${index}`, 40 - index, 0),
      ),
      hasMore: true,
      nextCursor: "ignored-after-40",
    });

    await expect(fetchHomeSkillListing("featured", [], 40)).resolves.toMatchObject({
      hasMore: false,
    });
  });

  it("uses the backend official-publisher contract for Official skills", async () => {
    await fetchHomeSkillListing("official", [], HOME_LISTING_PAGE_SIZE);

    expect(convexQueryMock).toHaveBeenCalledWith(
      "skills:listPublicPageV4",
      expect.objectContaining({ officialOnly: true, sort: "newest" }),
    );
  });

  it("keeps plugins out of Trending and supports New, Featured, and Official", async () => {
    const plugin = makePlugin("plugin");
    fetchPluginCatalogMock.mockResolvedValue({ items: [plugin], nextCursor: null });

    await fetchHomePluginListing("new", [], 20);
    await fetchHomePluginListing("featured", [], 20);
    await fetchHomePluginListing("official", [], 20);

    expect(convexQueryMock).toHaveBeenCalledWith(
      "packages:listPublicNewPluginsPage",
      expect.any(Object),
    );
    expect(fetchPluginCatalogMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ featured: true, isOfficial: undefined }),
    );
    expect(fetchPluginCatalogMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ featured: undefined, isOfficial: true }),
    );
  });

  it("loads New plugins from the bounded server-side creation-time feed", async () => {
    const now = Date.now();
    convexQueryMock
      .mockResolvedValueOnce({
        page: [makePlugin("newer", now - 100, now - 1_000)],
        isDone: false,
        continueCursor: "opaque-next",
      })
      .mockResolvedValueOnce({
        page: [makePlugin("new", now - 200)],
        isDone: true,
        continueCursor: "",
      });

    const result = await fetchHomePluginListing("new", [], 20);

    expect(result.items.map((item) => item.name)).toEqual(["newer", "new"]);
    expect(convexQueryMock).toHaveBeenNthCalledWith(
      1,
      "packages:listPublicNewPluginsPage",
      expect.objectContaining({
        createdAfter: expect.any(Number),
        paginationOpts: { cursor: null, numItems: 20 },
      }),
    );
    expect(convexQueryMock).toHaveBeenNthCalledWith(
      2,
      "packages:listPublicNewPluginsPage",
      expect.objectContaining({
        paginationOpts: { cursor: "opaque-next", numItems: 19 },
      }),
    );
    expect(fetchPluginCatalogMock).not.toHaveBeenCalled();
    expect(result.hasMore).toBe(false);
  });

  it("falls back to the legacy plugin catalog and applies the creation cutoff locally", async () => {
    const now = Date.now();
    const recent = makePlugin("recent", now - 1_000, now - 100);
    const old = makePlugin("old", now - HOME_NEW_WINDOW_MS - 1, now - 200);
    fetchCatalogDiscoveryCapabilitiesMock.mockResolvedValue({
      apiVersion: 0,
      canonicalTrendingEnabled: false,
    });
    fetchPluginCatalogMock.mockResolvedValue({
      items: [old, recent],
      nextCursor: null,
    });

    await expect(fetchHomePluginListing("new", [], 20)).resolves.toEqual({
      items: [recent],
      hasMore: false,
    });
    expect(fetchPluginCatalogMock).toHaveBeenCalledWith(
      expect.objectContaining({ sort: "updated", limit: 100 }),
    );
    expect(convexQueryMock).not.toHaveBeenCalled();
  });

  it("keeps the New plugin continuation after filling the visible window", async () => {
    convexQueryMock.mockResolvedValue({
      page: Array.from({ length: 20 }, (_, index) => makePlugin(`new-${index}`)),
      isDone: false,
      continueCursor: "more-new",
    });

    const result = await fetchHomePluginListing("new", [], 20);

    expect(convexQueryMock).toHaveBeenCalledWith(
      "packages:listPublicNewPluginsPage",
      expect.objectContaining({ paginationOpts: { cursor: null, numItems: 20 } }),
    );
    expect(result.hasMore).toBe(true);
  });

  it("stops New plugin cursor requests after navigation aborts", async () => {
    const controller = new AbortController();
    convexQueryMock.mockImplementationOnce(async () => {
      controller.abort();
      return {
        page: [makePlugin("stale")],
        isDone: false,
        continueCursor: "must-not-request",
      };
    });

    await expect(fetchHomePluginListing("new", [], 40, controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(convexQueryMock).toHaveBeenCalledTimes(1);
  });
});

function canonicalPage(items: ReturnType<typeof makeTrending>[], nextCursor: string | null) {
  return {
    kind: "skills" as const,
    snapshotId: "snapshot-1",
    snapshotCursor: "snapshot-cursor",
    generatedAt: "2026-07-26T00:00:00.000Z",
    windowHours: 24 as const,
    rankingVersion: "skills-trending-v1",
    totalItems: items.length,
    items,
    nextCursor,
  };
}

function makeTrending(slug: string, displayName: string, installs: number) {
  return {
    id: `clawhub:${slug}`,
    source: "clawhub" as const,
    slug,
    displayName,
    summary: `${displayName} summary`,
    canonicalUrl: `/owner/${slug}`,
    publisher: null,
    official: false,
    featured: false,
    metrics: {
      trending24hInstalls: installs,
      trending24hBookmarks: null,
      lifetimeInstalls: 1000,
      lifetimeInstallsPeriod: "lifetime" as const,
      updatedAt: 1,
    },
  };
}

function makeNative(slug: string, featuredAt: number, downloads: number) {
  return {
    skill: {
      _id: `skills:${slug}`,
      slug,
      displayName: slug,
      createdAt: featuredAt,
      updatedAt: featuredAt,
      badges: { highlighted: { at: featuredAt } },
      stats: { downloads },
    },
  };
}

function makePlugin(name: string, createdAt = Date.now(), updatedAt = Date.now()) {
  return {
    name,
    displayName: name,
    family: "code-plugin" as const,
    channel: "community" as const,
    isOfficial: false,
    createdAt,
    updatedAt,
  };
}
