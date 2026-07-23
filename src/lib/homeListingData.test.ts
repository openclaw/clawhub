import { beforeEach, describe, expect, it, vi } from "vitest";

const convexQueryMock = vi.fn();
const convexActionMock = vi.fn();
const fetchPluginCatalogMock = vi.fn();

vi.mock("../convex/client", () => ({
  convexHttp: {
    query: (...args: unknown[]) => convexQueryMock(...args),
    action: (...args: unknown[]) => convexActionMock(...args),
  },
}));

vi.mock("../../convex/_generated/api", () => ({
  api: {
    skills: {
      listPublicPageV4: "skills:listPublicPageV4",
      listPublicTrendingPage: "skills:listPublicTrendingPage",
    },
    search: {
      listSkillsShMirrorBrowse: "search:listSkillsShMirrorBrowse",
    },
  },
}));

vi.mock("./packageApi", () => ({
  fetchPluginCatalog: (...args: unknown[]) => fetchPluginCatalogMock(...args),
}));

import {
  fetchHomeFeaturedAvailability,
  fetchHomePluginListing,
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
    convexActionMock.mockReset();
    fetchPluginCatalogMock.mockReset();
    convexActionMock.mockResolvedValue({ page: [], nextCursor: null, hasMore: false });
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

  it("falls back to Top plugins when no Featured plugins exist", async () => {
    fetchPluginCatalogMock
      .mockResolvedValueOnce({ items: [], nextCursor: null })
      .mockResolvedValueOnce({
        items: [{ ...featuredPlugin, name: "top-plugin" }],
        nextCursor: null,
      });

    const result = await fetchInitialHomeListing();

    expect(result.kind).toBe("plugins");
    expect(result.tab).toBe("popular");
    expect(result.featuredAvailability.plugins).toBe(false);
    expect(fetchPluginCatalogMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: "downloads", featured: undefined }),
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
      result.page.map((entry) => ("skill" in entry ? entry.skill.slug : entry.result.slug)),
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

  it("includes category-matched mirrored skills in Top browse order", async () => {
    convexQueryMock.mockResolvedValue({
      page: [
        {
          skill: {
            _id: "skills:native",
            slug: "native",
            displayName: "Native",
            categories: ["development"],
            stats: { downloads: 10 },
          },
        },
      ],
      hasMore: false,
      nextCursor: null,
    });
    convexActionMock.mockResolvedValue({
      page: [
        {
          source: "skills.sh",
          externalId: "acme/skills/external",
          route: "/skills-sh/acme/skills/external",
          reference: "skills-sh:acme/skills/external",
          owner: "acme",
          repo: "skills",
          slug: "external",
          displayName: "External",
          categories: ["development"],
          topics: [],
          upstreamInstalls: 1_000,
          lastObservedAt: 1,
        },
      ],
      nextCursor: null,
      hasMore: false,
    });

    const result = await fetchHomeSkillListing("popular", ["development"], 20);

    expect(result.page[0]).toMatchObject({
      source: "skills.sh",
      result: { externalId: "acme/skills/external" },
    });
    expect(convexActionMock).toHaveBeenCalledWith("search:listSkillsShMirrorBrowse", {
      limit: 20,
      cursor: undefined,
      categorySlug: "development",
    });
  });

  it("keeps native Top results when mirrored browse is unavailable", async () => {
    convexQueryMock.mockResolvedValue({
      page: [
        {
          skill: {
            _id: "skills:native",
            slug: "native",
            displayName: "Native",
            categories: ["development"],
            stats: { downloads: 10 },
          },
        },
      ],
      hasMore: false,
      nextCursor: null,
    });
    convexActionMock.mockRejectedValue(new Error("mirror unavailable"));

    const result = await fetchHomeSkillListing("popular", ["development"], 20);

    expect(result.page).toEqual([
      expect.objectContaining({
        skill: expect.objectContaining({ slug: "native" }),
      }),
    ]);
    expect(result.hasMore).toBe(false);
  });

  it("orders mixed Top results by native downloads without double-counting skills.sh installs", async () => {
    convexQueryMock.mockResolvedValue({
      page: [
        {
          nativeDownloads: 10,
          skill: {
            _id: "skills:native",
            slug: "native",
            displayName: "Native",
            categories: ["development"],
            stats: { downloads: 1_010 },
          },
        },
      ],
      hasMore: false,
      nextCursor: null,
    });
    convexActionMock.mockResolvedValue({
      page: [
        {
          source: "skills.sh",
          externalId: "acme/skills/external",
          route: "/skills-sh/acme/skills/external",
          reference: "skills-sh:acme/skills/external",
          owner: "acme",
          repo: "skills",
          slug: "external",
          displayName: "External",
          categories: ["development"],
          topics: [],
          upstreamInstalls: 100,
          lastObservedAt: 1,
        },
      ],
      nextCursor: null,
      hasMore: false,
    });

    const result = await fetchHomeSkillListing("popular", ["development"], 20);

    expect(
      result.page.map((entry) => ("skill" in entry ? entry.skill.slug : entry.result.slug)),
    ).toEqual(["external", "native"]);
  });

  it("continues mirrored Top browse beyond the action page cap", async () => {
    convexQueryMock.mockResolvedValue({
      page: [],
      hasMore: false,
      nextCursor: null,
    });
    const externalRows = Array.from({ length: 60 }, (_, index) => ({
      source: "skills.sh",
      externalId: `acme/skills/external-${index}`,
      route: `/skills-sh/acme/skills/external-${index}`,
      reference: `skills-sh:acme/skills/external-${index}`,
      owner: "acme",
      repo: "skills",
      slug: `external-${index}`,
      displayName: `External ${index}`,
      categories: ["development"],
      topics: [],
      upstreamInstalls: 1_000 - index,
      lastObservedAt: 1,
    }));
    convexActionMock
      .mockResolvedValueOnce({
        page: externalRows.slice(0, 50),
        nextCursor: "external:50",
        hasMore: true,
      })
      .mockResolvedValueOnce({
        page: externalRows.slice(50),
        nextCursor: null,
        hasMore: false,
      });

    const result = await fetchHomeSkillListing("popular", ["development"], 60);

    expect(result.page).toHaveLength(60);
    expect(result.hasMore).toBe(false);
    expect(convexActionMock).toHaveBeenNthCalledWith(1, "search:listSkillsShMirrorBrowse", {
      limit: 50,
      cursor: undefined,
      categorySlug: "development",
    });
    expect(convexActionMock).toHaveBeenNthCalledWith(2, "search:listSkillsShMirrorBrowse", {
      limit: 10,
      cursor: "external:50",
      categorySlug: "development",
    });
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

  it("preserves global Trending order while filtering multiple plugin categories", async () => {
    fetchPluginCatalogMock
      .mockResolvedValueOnce({
        items: [
          { ...featuredPlugin, name: "unmatched-first", categories: ["productivity"] },
          { ...featuredPlugin, name: "security-second", categories: ["security"] },
          { ...featuredPlugin, name: "development-third", categories: ["development"] },
        ],
        nextCursor: "page-2",
      })
      .mockResolvedValueOnce({
        items: [
          { ...featuredPlugin, name: "security-fourth", categories: ["security"] },
          { ...featuredPlugin, name: "unmatched-fifth", categories: ["productivity"] },
        ],
        nextCursor: null,
      });

    const result = await fetchHomePluginListing("trending", ["development", "security"], 3);

    expect(result.items.map((item) => item.name)).toEqual([
      "security-second",
      "development-third",
      "security-fourth",
    ]);
    expect(fetchPluginCatalogMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        category: undefined,
        sort: "trending",
        limit: 100,
      }),
    );
    expect(fetchPluginCatalogMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        category: undefined,
        cursor: "page-2",
        sort: "trending",
      }),
    );
  });

  it("uses the API category filter for a single Trending plugin category", async () => {
    fetchPluginCatalogMock.mockResolvedValue({
      items: [{ ...featuredPlugin, name: "security-plugin", categories: ["security"] }],
      nextCursor: null,
    });

    await fetchHomePluginListing("trending", ["security"], 3);

    expect(fetchPluginCatalogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "security",
        sort: "trending",
        limit: 3,
      }),
    );
  });

  it("filters the complete bounded Trending leaderboard for multiple categories", async () => {
    fetchPluginCatalogMock
      .mockResolvedValueOnce({
        items: Array.from({ length: 100 }, (_, index) => ({
          ...featuredPlugin,
          name: `unmatched-${index}`,
          categories: ["other"],
        })),
        nextCursor: "page-2",
      })
      .mockResolvedValueOnce({
        items: [
          ...Array.from({ length: 99 }, (_, index) => ({
            ...featuredPlugin,
            name: `unmatched-${index + 100}`,
            categories: ["other"],
          })),
          { ...featuredPlugin, name: "security-last", categories: ["security"] },
        ],
        nextCursor: null,
      });

    const result = await fetchHomePluginListing("trending", ["development", "security"], 20);

    expect(result.items.map((item) => item.name)).toEqual(["security-last"]);
    expect(result.hasMore).toBe(false);
    expect(fetchPluginCatalogMock).toHaveBeenCalledTimes(2);
  });

  it("fails closed if the Trending API exceeds its shared leaderboard contract", async () => {
    fetchPluginCatalogMock
      .mockResolvedValueOnce({
        items: Array.from({ length: 100 }, (_, index) => ({
          ...featuredPlugin,
          name: `unmatched-${index}`,
          categories: ["other"],
        })),
        nextCursor: "page-2",
      })
      .mockResolvedValueOnce({
        items: Array.from({ length: 100 }, (_, index) => ({
          ...featuredPlugin,
          name: `unmatched-${index + 100}`,
          categories: ["other"],
        })),
        nextCursor: "unexpected-page-3",
      });

    await expect(
      fetchHomePluginListing("trending", ["development", "security"], 20),
    ).rejects.toThrow("exceeded 200-item contract");
  });
});
