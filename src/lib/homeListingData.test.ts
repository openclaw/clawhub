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

  it("uses the highlighted browse path for Featured skills", async () => {
    await fetchHomeSkillListing("featured", [], HOME_LISTING_PAGE_SIZE);

    expect(convexQueryMock).toHaveBeenCalledWith(
      "skills:listPublicPageV4",
      expect.objectContaining({
        highlightedOnly: true,
        numItems: 16,
      }),
    );
  });

  it("preserves the published Featured skill order while filtering across categories", async () => {
    convexQueryMock.mockResolvedValue({
      page: [
        {
          skill: {
            _id: "skills:editorial",
            slug: "editorial",
            categories: ["development"],
            badges: { highlighted: { at: 100 } },
            stats: { downloads: 1 },
          },
        },
        {
          skill: {
            _id: "skills:excluded",
            slug: "excluded",
            categories: ["writing"],
            badges: { highlighted: { at: 500 } },
            stats: { downloads: 1000 },
          },
        },
        {
          skill: {
            _id: "skills:telemetry",
            slug: "telemetry",
            categories: ["integrations"],
            badges: { highlighted: { at: 200 } },
            stats: { downloads: 10000 },
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
    ).toEqual(["editorial", "telemetry"]);
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
});
