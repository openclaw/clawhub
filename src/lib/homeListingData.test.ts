import { beforeEach, describe, expect, it, vi } from "vitest";

const convexQueryMock = vi.fn();
const fetchPluginCatalogMock = vi.fn();
const fetchCatalogDiscoveryCapabilitiesMock = vi.fn();

vi.mock("../convex/client", () => ({
  convexHttp: {
    query: (...args: unknown[]) => convexQueryMock(...args),
  },
}));

vi.mock("../../convex/_generated/api", () => ({
  api: {
    featuredSkills: { listPublic: "featuredSkills:listPublic" },
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

import {
  fetchHomePluginListing,
  fetchHomeTrendingPluginListing,
  fetchHomeSkillListing,
  HOME_LISTING_PAGE_SIZE,
} from "./homeListingData";

const featuredPlugin = {
  name: "featured-plugin",
  displayName: "Featured Plugin",
  family: "code-plugin",
  channel: "community",
  isOfficial: false,
  createdAt: 1,
  updatedAt: 2,
};

describe("homeListingData", () => {
  beforeEach(() => {
    convexQueryMock.mockReset();
    fetchPluginCatalogMock.mockReset();
    fetchCatalogDiscoveryCapabilitiesMock.mockReset();
    fetchCatalogDiscoveryCapabilitiesMock.mockResolvedValue({
      apiVersion: 1,
      canonicalTrendingEnabled: true,
    });
    convexQueryMock.mockResolvedValue({
      page: [
        {
          skill: {
            _id: "skills:featured",
            slug: "featured-skill",
            displayName: "Featured Skill",
            stats: { downloads: 10 },
          },
        },
      ],
      hasMore: false,
      nextCursor: null,
    });
  });

  it("keeps the backend ranking when loading Trending plugins", async () => {
    const ranked = [
      { ...featuredPlugin, name: "popular", updatedAt: 1 },
      { ...featuredPlugin, name: "newer", updatedAt: 5 },
    ];
    fetchPluginCatalogMock.mockResolvedValue({ items: ranked, nextCursor: null });
    const result = await fetchHomePluginListing("trending", [], 20);
    expect(fetchPluginCatalogMock).toHaveBeenCalledWith(
      expect.objectContaining({ sort: "trending" }),
    );
    expect(result.items.map((item) => item.name)).toEqual(["popular", "newer"]);
  });

  it("uses the mixed-source Featured selection", async () => {
    convexQueryMock.mockResolvedValue({ page: [] });
    await fetchHomeSkillListing("featured", [], HOME_LISTING_PAGE_SIZE);
    expect(convexQueryMock).toHaveBeenCalledWith("featuredSkills:listPublic", { query: undefined });
  });

  it("preserves newest-selected order across sources while filtering categories", async () => {
    const external = {
      id: "skills-sh:humanlayer/skills/show-me",
      slug: "show-me",
      native: null,
      categories: ["development"],
    };
    const native = {
      skill: { _id: "skills:older", slug: "older" },
      owner: null,
      ownerHandle: null,
    };
    convexQueryMock.mockResolvedValue({
      page: [
        { external, categories: external.categories },
        { external: { id: "excluded" }, categories: ["writing"] },
        { ...native, skill: { ...native.skill, categories: ["integrations"] } },
      ],
    });
    const result = await fetchHomeSkillListing(
      "featured",
      ["development", "integrations"],
      HOME_LISTING_PAGE_SIZE,
    );
    expect(
      result.page.map((entry) =>
        "external" in entry
          ? entry.external.slug
          : "skill" in entry
            ? entry.skill.slug
            : "trending",
      ),
    ).toEqual(["show-me", "older"]);
    expect(result.hasMore).toBe(false);
    expect(convexQueryMock).toHaveBeenCalledTimes(1);
  });

  it("preserves the published Featured plugin order while filtering across categories", async () => {
    fetchPluginCatalogMock.mockResolvedValue({
      items: [
        { ...featuredPlugin, name: "editorial", categories: ["tools"], featuredAt: 100 },
        { ...featuredPlugin, name: "excluded", categories: ["other"], featuredAt: 500 },
        { ...featuredPlugin, name: "telemetry", categories: ["gateway"], featuredAt: 200 },
      ],
      nextCursor: null,
    });
    const result = await fetchHomePluginListing(
      "featured",
      ["tools", "gateway"],
      HOME_LISTING_PAGE_SIZE,
    );
    expect(result.items.map((item) => item.name)).toEqual(["editorial", "telemetry"]);
    expect(result.hasMore).toBe(false);
    expect(fetchPluginCatalogMock).toHaveBeenCalledTimes(1);
  });

  it("preserves plugin Trending rank across pages instead of sorting by update time", async () => {
    const first = { ...featuredPlugin, name: "first", updatedAt: 1 };
    const second = { ...featuredPlugin, name: "second", updatedAt: 999 };
    fetchPluginCatalogMock
      .mockResolvedValueOnce({ items: [first], nextCursor: "page-2" })
      .mockResolvedValueOnce({ items: [second], nextCursor: "page-3" });

    const result = await fetchHomePluginListing("trending", ["tools"], 2);

    expect(result).toEqual({ items: [first, second], hasMore: true });
    expect(fetchPluginCatalogMock).toHaveBeenNthCalledWith(1, {
      sort: "trending",
      cursor: undefined,
      limit: 2,
      signal: undefined,
    });
    expect(fetchPluginCatalogMock).toHaveBeenNthCalledWith(2, {
      sort: "trending",
      cursor: "page-2",
      limit: 1,
      signal: undefined,
    });
  });

  it("searches the entire plugin Trending feed in rank order with accurate pagination", async () => {
    const first = { ...featuredPlugin, name: "calendar-first", ownerHandle: "builder" };
    const second = { ...featuredPlugin, name: "calendar-second", ownerHandle: "builder" };
    const third = { ...featuredPlugin, name: "calendar-third", ownerHandle: "builder" };
    fetchPluginCatalogMock.mockImplementation(({ cursor }: { cursor?: string }) =>
      Promise.resolve(
        cursor === "page-2"
          ? { items: [first, second, third], nextCursor: null }
          : { items: [featuredPlugin], nextCursor: "page-2" },
      ),
    );

    expect(await fetchHomeTrendingPluginListing(2, undefined, " CALENDAR builder ")).toEqual({
      items: [first, second],
      hasMore: true,
    });
    expect(await fetchHomeTrendingPluginListing(4, undefined, "calendar builder")).toEqual({
      items: [first, second, third],
      hasMore: false,
    });
    expect(
      fetchPluginCatalogMock.mock.calls.every(([args]) => args.sort === "trending" && !args.q),
    ).toBe(true);
  });

  it("stops plugin Trending requests on abort and propagates later-page failures", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(fetchHomeTrendingPluginListing(20, controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(fetchPluginCatalogMock).not.toHaveBeenCalled();

    fetchPluginCatalogMock
      .mockResolvedValueOnce({ items: [featuredPlugin], nextCursor: "page-2" })
      .mockRejectedValueOnce(new Error("Feed unavailable"));
    await expect(fetchHomeTrendingPluginListing(20)).rejects.toThrow("Feed unavailable");
  });
});
