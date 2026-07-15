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
  fetchHomeFeaturedAvailability,
  fetchHomeSkillListing,
  fetchInitialHomeListing,
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

  it("loads Featured plugins as the initial catalog when they exist", async () => {
    fetchPluginCatalogMock.mockResolvedValue({
      items: [featuredPlugin],
      nextCursor: null,
    });

    await expect(fetchInitialHomeListing()).resolves.toEqual({
      kind: "plugins",
      tab: "featured",
      categorySlugs: [],
      fetchLimit: HOME_LISTING_PAGE_SIZE,
      items: [featuredPlugin],
      hasMore: false,
      featuredAvailability: {
        plugins: true,
        skills: true,
      },
    });
    expect(fetchPluginCatalogMock).toHaveBeenCalledWith(
      expect.objectContaining({ featured: true, limit: HOME_LISTING_PAGE_SIZE }),
    );
  });

  it("falls back to Verified plugins when no Featured plugins exist", async () => {
    fetchPluginCatalogMock
      .mockResolvedValueOnce({ items: [], nextCursor: null })
      .mockResolvedValueOnce({
        items: [{ ...featuredPlugin, name: "verified-plugin", isOfficial: true }],
        nextCursor: null,
      });

    const result = await fetchInitialHomeListing();

    expect(result.kind).toBe("plugins");
    expect(result.tab).toBe("officials");
    expect(result.featuredAvailability.plugins).toBe(false);
    expect(fetchPluginCatalogMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ isOfficial: true, featured: undefined }),
    );
  });

  it("uses the highlighted browse path for Featured skills", async () => {
    await fetchHomeSkillListing("featured", [], HOME_LISTING_PAGE_SIZE);

    expect(convexQueryMock).toHaveBeenCalledWith(
      "skills:listPublicPageV4",
      expect.objectContaining({
        highlightedOnly: true,
        numItems: 200,
        sort: "downloads",
      }),
    );
  });

  it("uses a one-item request when probing Featured skill availability", async () => {
    await expect(fetchHomeFeaturedAvailability("skills")).resolves.toBe(true);

    expect(convexQueryMock).toHaveBeenCalledWith(
      "skills:listPublicPageV4",
      expect.objectContaining({
        highlightedOnly: true,
        numItems: 1,
      }),
    );
  });
});
