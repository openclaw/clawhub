import { beforeEach, describe, expect, it, vi } from "vitest";

const convexQueryMock = vi.fn();
const fetchPluginCatalogMock = vi.fn();

vi.mock("../convex/client", () => ({
  convexHttp: {
    query: (...args: unknown[]) => convexQueryMock(...args),
  },
}));

vi.mock("../../convex/_generated/api", () => ({
  api: {
    skills: {
      listPublicPageV4: "skills:listPublicPageV4",
      listPublicTrendingPage: "skills:listPublicTrendingPage",
    },
  },
}));

vi.mock("./packageApi", () => ({
  fetchPluginCatalog: (...args: unknown[]) => fetchPluginCatalogMock(...args),
}));

import {
  fetchHomePluginListing,
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

  it("uses the highlighted browse path for Featured skills", async () => {
    await fetchHomeSkillListing("featured", [], HOME_LISTING_PAGE_SIZE);

    expect(convexQueryMock).toHaveBeenCalledWith(
      "skills:listPublicPageV4",
      expect.objectContaining({
        highlightedOnly: true,
        numItems: 40,
        sort: "updated",
      }),
    );
  });

  it("sorts filtered Featured skills newest-first by featuredAt", async () => {
    convexQueryMock
      .mockResolvedValueOnce({
        page: [
          {
            skill: {
              _id: "skills:older",
              slug: "older",
              displayName: "Older Featured",
              categories: ["development"],
              badges: { highlighted: { at: 100 } },
              stats: { downloads: 10_000 },
            },
          },
        ],
        hasMore: false,
        nextCursor: null,
      })
      .mockResolvedValueOnce({
        page: [
          {
            skill: {
              _id: "skills:newest",
              slug: "newest",
              displayName: "Newest Featured",
              categories: ["integrations"],
              badges: { highlighted: { at: 200 } },
              stats: { downloads: 1 },
            },
          },
        ],
        hasMore: false,
        nextCursor: null,
      });

    const result = await fetchHomeSkillListing(
      "featured",
      ["development", "integrations"],
      HOME_LISTING_PAGE_SIZE,
    );

    expect(
      result.page.map((entry) => ("skill" in entry ? entry.skill.slug : entry.trending.slug)),
    ).toEqual(["newest", "older"]);
    expect(convexQueryMock).toHaveBeenCalledTimes(2);
    expect(convexQueryMock).toHaveBeenNthCalledWith(
      1,
      "skills:listPublicPageV4",
      expect.objectContaining({ categorySlug: "development" }),
    );
    expect(convexQueryMock).toHaveBeenNthCalledWith(
      2,
      "skills:listPublicPageV4",
      expect.objectContaining({ categorySlug: "integrations" }),
    );
  });

  it("sorts filtered Featured plugins newest-first by featuredAt", async () => {
    fetchPluginCatalogMock
      .mockResolvedValueOnce({
        items: [
          {
            ...featuredPlugin,
            name: "older",
            categories: ["tools"],
            featuredAt: 100,
            stats: { downloads: 10_000 },
          },
        ],
        nextCursor: null,
      })
      .mockResolvedValueOnce({
        items: [
          {
            ...featuredPlugin,
            name: "newest",
            categories: ["gateway"],
            featuredAt: 200,
            stats: { downloads: 1 },
          },
        ],
        nextCursor: null,
      });

    const result = await fetchHomePluginListing(
      "featured",
      ["tools", "gateway"],
      HOME_LISTING_PAGE_SIZE,
    );

    expect(result.items.map((item) => item.name)).toEqual(["newest", "older"]);
    expect(fetchPluginCatalogMock).toHaveBeenCalledTimes(2);
    expect(fetchPluginCatalogMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ category: "tools" }),
    );
    expect(fetchPluginCatalogMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ category: "gateway" }),
    );
  });
});
