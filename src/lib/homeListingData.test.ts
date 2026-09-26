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
});
