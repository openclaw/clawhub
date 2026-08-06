/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigateMock = vi.fn();
const convexQueryMock = vi.fn();
const fetchPluginCatalogMock = vi.fn();
const fetchCatalogDiscoveryCapabilitiesMock = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    className,
    to,
  }: {
    children: React.ReactNode;
    className?: string;
    to?: string;
  }) => (
    <a className={className} href={typeof to === "string" ? to : "/"}>
      {children}
    </a>
  ),
  useNavigate: () => navigateMock,
}));

const convexActionMock = vi.fn();

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
      searchNativeSkills: "search:searchNativeSkills",
    },
  },
}));

vi.mock("../lib/packageApi", () => ({
  fetchPluginCatalog: (...args: unknown[]) => fetchPluginCatalogMock(...args),
}));

vi.mock("../lib/catalogDiscoveryCapabilities", () => ({
  fetchCatalogDiscoveryCapabilities: (...args: unknown[]) =>
    fetchCatalogDiscoveryCapabilitiesMock(...args),
}));

import { HomeListingSection } from "../components/HomeListingSection";

const featuredPlugin = {
  name: "demo-plugin",
  displayName: "Demo Plugin",
  family: "code-plugin" as const,
  channel: "community" as const,
  isOfficial: false,
  summary: "Runs workflows.",
  icon: "https://example.com/demo-plugin.png",
  createdAt: 1,
  updatedAt: 2,
  latestVersion: "1.0.0",
  stats: { stars: 8, downloads: 120, installs: 120, versions: 1 },
};

function initialPluginListing({
  items = [featuredPlugin],
}: {
  items?: (typeof featuredPlugin)[];
} = {}) {
  return {
    kind: "plugins" as const,
    tab: "featured" as const,
    categorySlugs: [] as [],
    fetchLimit: 20 as const,
    items,
    hasMore: false,
  };
}

function renderSkillsListing() {
  const result = render(<HomeListingSection initialListing={initialPluginListing()} />);
  fireEvent.click(screen.getByRole("button", { name: "Skills" }));
  fireEvent.click(screen.getByRole("tab", { name: "New" }));
  return result;
}

describe("HomeListingSection", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    convexQueryMock.mockReset();
    convexActionMock.mockReset();
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
            _id: "skills:1",
            slug: "demo-skill",
            displayName: "Demo Skill",
            summary: "A helpful skill.",
            stats: { stars: 12, downloads: 340 },
          },
          ownerHandle: "builder",
        },
      ],
    });
    fetchPluginCatalogMock.mockResolvedValue({
      items: [
        {
          name: "demo-plugin",
          displayName: "Demo Plugin",
          family: "code-plugin",
          channel: "community",
          isOfficial: false,
          summary: "Runs workflows.",
          createdAt: 1,
          updatedAt: 2,
          latestVersion: "1.0.0",
          stats: { stars: 8, downloads: 120, installs: 120, versions: 1 },
        },
      ],
      nextCursor: null,
    });
  });

  it("renders kind and its tabs on the left, secondary controls on the right, and only lists", async () => {
    render(<HomeListingSection initialListing={initialPluginListing()} />);

    const toolbar = document.querySelector(".home-v2-listing-toolbar");
    const primary = document.querySelector(".home-v2-listing-primary");
    const divider = document.querySelector(".browse-controls-divider");
    const catalogTabs = screen.getByRole("tablist", { name: "Catalog view" });
    const contentType = screen.getByRole("group", { name: "Content type" });
    const contentTypeButtons = contentType.querySelectorAll("button");
    expect(toolbar?.firstElementChild).toBe(primary);
    expect(primary?.firstElementChild).toBe(contentType);
    expect(contentType.nextElementSibling).toBe(divider);
    expect(divider?.getAttribute("aria-hidden")).toBe("true");
    expect(divider?.nextElementSibling?.contains(catalogTabs)).toBe(true);
    expect(primary?.lastElementChild?.contains(catalogTabs)).toBe(true);
    expect(toolbar?.lastElementChild?.classList.contains("home-v2-listing-actions")).toBe(true);
    expect(Array.from(contentTypeButtons, (button) => button.textContent)).toEqual([
      "Skills",
      "Plugins",
    ]);
    expect(screen.getByRole("button", { name: "Plugins" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("tab", { name: "Featured" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Featured",
      "Official",
      "New",
    ]);
    expect(screen.getByRole("button", { name: "Search catalog" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Category" }).textContent).toContain(
      "All categories",
    );
    expect(screen.queryByRole("button", { name: "List view" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Grid view" })).toBeNull();
    expect(screen.getByText("Demo Plugin")).toBeTruthy();
    expect(document.querySelector(".home-v2-listing-list")).toBeTruthy();
    expect(screen.getByText("Downloads")).toBeTruthy();
    expect(document.querySelectorAll(".home-v2-listing-row-icon")).toHaveLength(1);
    expect(
      document
        .querySelector<HTMLImageElement>(".home-v2-listing-row-icon img")
        ?.getAttribute("src"),
    ).toBe(featuredPlugin.icon);
    expect(document.querySelector(".home-v2-listing-row-stats svg")).toBeNull();
  });

  it("keeps the initial Skills skeleton iconless", () => {
    fetchCatalogDiscoveryCapabilitiesMock.mockReturnValue(new Promise(() => {}));

    render(<HomeListingSection />);

    const loadingResults = screen.getByRole("status", { name: "Loading results" });
    expect(loadingResults.querySelector(".browse-results-skeleton-icon")).toBeNull();
    expect(loadingResults.querySelector(".browse-list-head-icon-spacer")).toBeNull();
    expect(loadingResults.querySelectorAll(".skill-list-item-no-icon")).toHaveLength(6);
  });

  it("searches skills within the selected tab and category", async () => {
    convexActionMock.mockResolvedValue([
      {
        skill: {
          _id: "skills:featured-development",
          slug: "featured-development",
          displayName: "Featured Development Skill",
          summary: "Builds software.",
          categories: ["development"],
          stats: { stars: 1, downloads: 10 },
        },
        ownerHandle: "builder",
      },
    ]);

    render(<HomeListingSection initialListing={initialPluginListing()} />);
    fireEvent.click(screen.getByRole("button", { name: "Skills" }));
    fireEvent.click(screen.getByRole("tab", { name: "Featured" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Category" }));
    fireEvent.click(screen.getByRole("radio", { name: "Development" }));
    fireEvent.click(screen.getByRole("button", { name: "Search catalog" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search skills" }), {
      target: { value: "development" },
    });

    await waitFor(() => {
      expect(convexActionMock).toHaveBeenCalledWith("search:searchNativeSkills", {
        query: "development",
        limit: 20,
        highlightedOnly: true,
        categorySlug: "development",
      });
      expect(screen.getByText("Featured Development Skill")).toBeTruthy();
    });
    expect(screen.getByRole("tab", { name: "Featured" }).getAttribute("aria-selected")).toBe(
      "true",
    );
  });

  it("passes Official and New skill eligibility into native search", async () => {
    convexActionMock.mockResolvedValue([]);
    const { unmount } = render(<HomeListingSection initialListing={initialPluginListing()} />);
    fireEvent.click(screen.getByRole("button", { name: "Skills" }));
    fireEvent.click(screen.getByRole("tab", { name: "Official" }));
    fireEvent.click(screen.getByRole("button", { name: "Search catalog" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search skills" }), {
      target: { value: "official" },
    });

    await waitFor(() => {
      expect(convexActionMock).toHaveBeenCalledWith(
        "search:searchNativeSkills",
        expect.objectContaining({ query: "official", limit: 20, officialOnly: true }),
      );
    });

    unmount();
    convexActionMock.mockClear();
    render(<HomeListingSection initialListing={initialPluginListing()} />);
    fireEvent.click(screen.getByRole("button", { name: "Skills" }));
    fireEvent.click(screen.getByRole("tab", { name: "New" }));
    fireEvent.click(screen.getByRole("button", { name: "Search catalog" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search skills" }), {
      target: { value: "recent" },
    });

    await waitFor(() => {
      expect(convexActionMock).toHaveBeenCalledWith(
        "search:searchNativeSkills",
        expect.objectContaining({
          query: "recent",
          limit: 20,
          createdAfter: expect.any(Number),
        }),
      );
    });
  });

  it("searches plugins within the selected tab and category", async () => {
    fetchPluginCatalogMock.mockResolvedValue({
      items: [
        {
          ...featuredPlugin,
          name: "official-channel-plugin",
          displayName: "Official Channel Plugin",
          isOfficial: true,
          categories: ["channels"],
        },
      ],
      nextCursor: null,
    });

    render(<HomeListingSection initialListing={initialPluginListing()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Official" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Category" }));
    fireEvent.click(screen.getByRole("radio", { name: "Channels" }));
    fireEvent.click(screen.getByRole("button", { name: "Search catalog" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search plugins" }), {
      target: { value: "channel" },
    });

    await waitFor(() => {
      expect(fetchPluginCatalogMock).toHaveBeenCalledWith(
        expect.objectContaining({
          q: "channel",
          category: "channels",
          isOfficial: true,
          limit: 20,
        }),
      );
      expect(screen.getByText("Official Channel Plugin")).toBeTruthy();
    });
    expect(screen.getByRole("tab", { name: "Official" }).getAttribute("aria-selected")).toBe(
      "true",
    );
  });

  it("passes New plugin eligibility into catalog search", async () => {
    render(<HomeListingSection initialListing={initialPluginListing()} />);
    fireEvent.click(screen.getByRole("tab", { name: "New" }));
    fireEvent.click(screen.getByRole("button", { name: "Search catalog" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search plugins" }), {
      target: { value: "calendar" },
    });

    await waitFor(() => {
      expect(fetchPluginCatalogMock).toHaveBeenCalledWith(
        expect.objectContaining({
          q: "calendar",
          createdAfter: expect.any(Number),
          limit: 20,
        }),
      );
    });
  });

  it("clears a pending search load-more state when search closes", async () => {
    type PluginResult = {
      items: (typeof featuredPlugin)[];
      nextCursor: string | null;
    };
    let resolveExpanded!: (result: PluginResult) => void;
    const expandedResult = new Promise<PluginResult>((resolve) => {
      resolveExpanded = resolve;
    });
    const searchItems = Array.from({ length: 20 }, (_, index) => ({
      ...featuredPlugin,
      name: `demo-plugin-${index}`,
      displayName: `Demo Plugin ${index}`,
    }));
    fetchPluginCatalogMock.mockImplementation((args: { limit?: number }) =>
      args.limit === 40
        ? expandedResult
        : Promise.resolve({ items: searchItems, nextCursor: "more" }),
    );

    render(<HomeListingSection initialListing={{ ...initialPluginListing(), hasMore: true }} />);
    fireEvent.click(screen.getByRole("button", { name: "Search catalog" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search plugins" }), {
      target: { value: "demo" },
    });

    const loadMore = await screen.findByRole("button", { name: "Load more" });
    fireEvent.click(loadMore);
    await screen.findByRole("button", { name: "Loading…" });
    fireEvent.click(screen.getByRole("button", { name: "Close search" }));

    const restoredLoadMore = await screen.findByRole("button", { name: "Load more" });
    expect(restoredLoadMore.hasAttribute("disabled")).toBe(false);
    expect(screen.getByText("Demo Plugin")).toBeTruthy();

    resolveExpanded({ items: searchItems, nextCursor: null });
  });

  it("clears and hides the category filter when Trending is selected", async () => {
    render(<HomeListingSection initialListing={initialPluginListing()} />);
    fireEvent.click(screen.getByRole("button", { name: "Skills" }));
    fireEvent.click(screen.getByRole("tab", { name: "Featured" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Category" }));
    fireEvent.click(screen.getByRole("radio", { name: "Development" }));

    expect(screen.getByRole("combobox", { name: "Category" }).textContent).toContain("Development");
    fireEvent.click(screen.getByRole("tab", { name: "Trending" }));
    expect(screen.queryByRole("combobox", { name: "Category" })).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Featured" }));
    expect(screen.getByRole("combobox", { name: "Category" }).textContent).toContain(
      "All categories",
    );
  });

  it("previews long skill and plugin names while retaining their full labels", async () => {
    const skillName = "S".repeat(71);
    const pluginName = "P".repeat(71);
    convexQueryMock.mockResolvedValue({
      page: [
        {
          skill: {
            _id: "skills:long",
            slug: "long-skill",
            displayName: skillName,
            summary: "A helpful skill.",
            stats: { stars: 12, downloads: 340 },
          },
          ownerHandle: "builder",
        },
      ],
    });
    fetchPluginCatalogMock.mockResolvedValue({
      items: [
        {
          name: "long-plugin",
          displayName: pluginName,
          family: "code-plugin",
          channel: "community",
          isOfficial: false,
          summary: "Runs workflows.",
          createdAt: 1,
          updatedAt: 2,
          latestVersion: "1.0.0",
          stats: { stars: 8, downloads: 120, installs: 120, versions: 1 },
        },
      ],
      nextCursor: null,
    });

    render(
      <HomeListingSection
        initialListing={initialPluginListing({
          items: [{ ...featuredPlugin, name: "long-plugin", displayName: pluginName }],
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Skills" }));
    fireEvent.click(screen.getByRole("tab", { name: "New" }));

    await waitFor(() => {
      expect(screen.getByText(`${"S".repeat(69)}…`).getAttribute("title")).toBe(skillName);
    });

    fireEvent.click(screen.getByRole("button", { name: "Plugins" }));
    fireEvent.click(screen.getByRole("tab", { name: "Featured" }));

    await waitFor(() => {
      expect(screen.getByText(`${"P".repeat(69)}…`).getAttribute("title")).toBe(pluginName);
    });
  });

  it("renders an initial Skills New listing without refetching on mount", async () => {
    render(
      <HomeListingSection
        initialListing={{
          kind: "skills",
          tab: "new",
          categorySlugs: [],
          fetchLimit: 20,
          items: [
            {
              skill: {
                _id: "skills:initial" as never,
                slug: "initial-skill",
                displayName: "Initial Skill",
                summary: "Already loaded by the route.",
                stats: {
                  comments: 0,
                  downloads: 0,
                  installs: 42,
                  stars: 0,
                  versions: 1,
                },
              } as never,
              ownerHandle: "builder",
            },
          ],
          hasMore: true,
        }}
      />,
    );

    expect(screen.getByText("Initial Skill")).toBeTruthy();
    expect(document.querySelector(".home-v2-listing-row-icon")).toBeNull();
    expect(document.querySelector(".marketplace-icon-skill")).toBeNull();
    expect(screen.getByRole("button", { name: "Load more" })).toBeTruthy();
    await waitFor(() => {
      expect(convexQueryMock).not.toHaveBeenCalled();
    });
  });

  it("expands the listing preview when see more is clicked", async () => {
    const rows = Array.from({ length: 35 }, (_, index) => ({
      skill: {
        _id: `skills:${index}`,
        slug: `skill-${index}`,
        displayName: `Skill ${index}`,
        summary: "Summary",
        stats: { stars: 1, downloads: 1 },
      },
      ownerHandle: "builder",
    }));
    convexQueryMock.mockImplementation((_, args: { numItems: number }) =>
      Promise.resolve({
        page: rows.slice(0, args.numItems),
        hasMore: args.numItems < rows.length,
      }),
    );

    renderSkillsListing();

    await waitFor(() => {
      expect(screen.getByText("Skill 0")).toBeTruthy();
    });
    expect(screen.queryByText("Skill 20")).toBeNull();
    expect(screen.getByText("Skill 19")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    await waitFor(() => {
      expect(screen.getByText("Skill 34")).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("reuses cached skill tabs instead of refetching when switching back", async () => {
    convexQueryMock.mockImplementation((_name, args: { highlightedOnly?: boolean }) => {
      const featured = args.highlightedOnly === true;
      return Promise.resolve({
        page: [
          {
            skill: {
              _id: featured ? "skills:featured" : "skills:new",
              slug: featured ? "featured-skill" : "new-skill",
              displayName: featured ? "Featured Skill" : "New Skill",
              summary: featured ? "Editorial." : "Recently published.",
              stats: { installs: 100 },
            },
            ownerHandle: "builder",
          },
        ],
        hasMore: false,
        nextCursor: null,
      });
    });

    renderSkillsListing();

    await waitFor(() => {
      expect(screen.getByText("New Skill")).toBeTruthy();
    });
    expect(convexQueryMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("tab", { name: "Featured" }));

    await waitFor(() => {
      expect(screen.getByText("Featured Skill")).toBeTruthy();
    });
    expect(convexQueryMock).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("tab", { name: "New" }));

    await waitFor(() => {
      expect(screen.getByText("New Skill")).toBeTruthy();
    });
    expect(convexQueryMock).toHaveBeenCalledTimes(2);
  });

  it("reuses cached plugin tabs instead of refetching when switching back", async () => {
    fetchPluginCatalogMock.mockImplementation((args: { isOfficial?: boolean }) =>
      Promise.resolve({
        items: [
          {
            name: args.isOfficial ? "official-plugin" : "new-plugin",
            displayName: args.isOfficial ? "Official Plugin" : "New Plugin",
            family: "code-plugin",
            channel: "community",
            isOfficial: false,
            summary: "Cached plugin.",
            createdAt: 1,
            updatedAt: 2,
            latestVersion: "1.0.0",
            stats: {
              stars: 1,
              downloads: 2,
              installs: args.isOfficial ? 50 : 75,
              versions: 1,
            },
          },
        ],
        nextCursor: null,
      }),
    );

    render(<HomeListingSection initialListing={initialPluginListing()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Official" }));

    await waitFor(() => {
      expect(screen.getByText("Official Plugin")).toBeTruthy();
    });
    expect(fetchPluginCatalogMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("tab", { name: "Featured" }));

    await waitFor(() => {
      expect(screen.getByText("Demo Plugin")).toBeTruthy();
    });
    expect(fetchPluginCatalogMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("tab", { name: "Official" }));

    await waitFor(() => {
      expect(screen.getByText("Official Plugin")).toBeTruthy();
    });
    expect(fetchPluginCatalogMock).toHaveBeenCalledTimes(1);
  });

  it("uses the skills cursor when loading beyond the first page", async () => {
    const firstSkill = {
      skill: {
        _id: "skills:first",
        slug: "first-skill",
        displayName: "First Skill",
        summary: "First page.",
        stats: { installs: 100 },
      },
      ownerHandle: "builder",
    };
    const secondSkill = {
      skill: {
        _id: "skills:second",
        slug: "second-skill",
        displayName: "Second Skill",
        summary: "Second page.",
        stats: { installs: 90 },
      },
      ownerHandle: "builder",
    };
    convexQueryMock
      .mockResolvedValueOnce({
        page: [firstSkill],
        hasMore: true,
        nextCursor: "skills-cursor-2",
      })
      .mockResolvedValueOnce({
        page: [firstSkill],
        hasMore: true,
        nextCursor: "skills-cursor-2",
      })
      .mockResolvedValueOnce({
        page: [secondSkill],
        hasMore: false,
        nextCursor: null,
      });

    renderSkillsListing();

    await waitFor(() => {
      expect(screen.getByText("First Skill")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    await waitFor(() => {
      expect(screen.getByText("Second Skill")).toBeTruthy();
    });
    expect(convexQueryMock).toHaveBeenCalledWith(
      "skills:listPublicPageV4",
      expect.objectContaining({ cursor: "skills-cursor-2" }),
    );
  });
});
