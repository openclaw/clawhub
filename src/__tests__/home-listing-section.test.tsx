/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigateMock = vi.fn();
const convexQueryMock = vi.fn();
const fetchPluginCatalogMock = vi.fn();

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
      searchSkills: "search:searchSkills",
    },
  },
}));

vi.mock("../lib/packageApi", () => ({
  fetchPluginCatalog: (...args: unknown[]) => fetchPluginCatalogMock(...args),
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
  pluginsFeatured = true,
  skillsFeatured = true,
}: {
  items?: (typeof featuredPlugin)[];
  pluginsFeatured?: boolean;
  skillsFeatured?: boolean;
} = {}) {
  return {
    kind: "plugins" as const,
    tab: pluginsFeatured ? ("featured" as const) : ("popular" as const),
    categorySlugs: [] as [],
    fetchLimit: 20 as const,
    items,
    hasMore: false,
    featuredAvailability: {
      plugins: pluginsFeatured,
      skills: skillsFeatured,
    },
  };
}

function renderSkillsListing() {
  const result = render(
    <HomeListingSection initialListing={initialPluginListing({ skillsFeatured: false })} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Skills" }));
  return result;
}

describe("HomeListingSection", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    convexQueryMock.mockReset();
    convexActionMock.mockReset();
    fetchPluginCatalogMock.mockReset();
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

  it("renders Featured plugins as cards by default", async () => {
    render(<HomeListingSection initialListing={initialPluginListing()} />);

    const contentTypeButtons = screen
      .getByRole("group", { name: "Content type" })
      .querySelectorAll("button");
    expect(Array.from(contentTypeButtons, (button) => button.textContent)).toEqual([
      "Plugins",
      "Skills",
    ]);
    expect(screen.getByRole("button", { name: "Plugins" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("tab", { name: "Featured" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "Grid view" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Featured",
      "Top",
      "Trending",
    ]);
    expect(screen.queryByRole("tab", { name: "New" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Verified" })).toBeNull();
    expect(screen.getByText("Demo Plugin")).toBeTruthy();
    expect(document.querySelector(".home-v2-listing-grid")).toBeTruthy();
    expect(document.querySelector(".marketplace-icon-image")?.getAttribute("src")).toBe(
      featuredPlugin.icon,
    );
  });

  it("hides Featured and selects Top when plugins have no Featured results", () => {
    render(
      <HomeListingSection
        initialListing={initialPluginListing({ items: [], pluginsFeatured: false })}
      />,
    );

    expect(screen.queryByRole("tab", { name: "Featured" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Top" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Top", "Trending"]);
  });

  it("selects Featured when switching to skills that have Featured results", async () => {
    render(<HomeListingSection initialListing={initialPluginListing()} />);
    fireEvent.click(screen.getByRole("button", { name: "Skills" }));

    expect(screen.getByRole("tab", { name: "Featured" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Featured",
      "Top",
      "Trending",
    ]);
    expect(screen.queryByRole("tab", { name: "New" })).toBeNull();
    await waitFor(() => {
      expect(convexQueryMock).toHaveBeenCalledWith(
        "skills:listPublicPageV4",
        expect.objectContaining({ highlightedOnly: true }),
      );
    });
  });

  it("hides Featured and selects Top when skills have no Featured results", () => {
    render(<HomeListingSection initialListing={initialPluginListing({ skillsFeatured: false })} />);
    fireEvent.click(screen.getByRole("button", { name: "Skills" }));

    expect(screen.queryByRole("tab", { name: "Featured" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Top" }).getAttribute("aria-selected")).toBe("true");
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

    renderSkillsListing();

    await waitFor(() => {
      expect(screen.getByText(`${"S".repeat(69)}…`).getAttribute("title")).toBe(skillName);
    });

    fireEvent.click(screen.getByRole("button", { name: "Plugins" }));
    fireEvent.click(screen.getByRole("tab", { name: "Top" }));

    await waitFor(() => {
      expect(screen.getByText(`${"P".repeat(69)}…`).getAttribute("title")).toBe(pluginName);
    });
  });

  it("renders an initial Skills Top listing without refetching on mount", async () => {
    render(
      <HomeListingSection
        initialListing={{
          kind: "skills",
          tab: "popular",
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
          featuredAvailability: {
            plugins: true,
            skills: true,
          },
        }}
      />,
    );

    expect(screen.getByText("Initial Skill")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Load more" })).toBeTruthy();
    await waitFor(() => {
      expect(convexQueryMock).not.toHaveBeenCalled();
    });
  });

  it("loads the plugin Top tab", async () => {
    render(<HomeListingSection initialListing={initialPluginListing()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Top" }));

    await waitFor(() => {
      expect(screen.getByText("Demo Plugin")).toBeTruthy();
      expect(screen.getByText("120")).toBeTruthy();
    });
    expect(fetchPluginCatalogMock).toHaveBeenCalled();
  });

  it("opens listing search from the toolbar icon and with slash", async () => {
    convexActionMock.mockResolvedValue([
      {
        skill: {
          _id: "skills:1",
          slug: "alpha-skill",
          displayName: "Alpha Skill",
          summary: "Alpha",
          stats: { stars: 1, downloads: 1 },
        },
        ownerHandle: "builder",
      },
    ]);

    renderSkillsListing();

    fireEvent.click(screen.getByRole("button", { name: "Search catalog" }));
    expect(document.querySelector(".home-v2-listing-search.is-open")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close search" }));
    expect(document.querySelector(".home-v2-listing-search.is-open")).toBeNull();

    fireEvent.keyDown(document, { key: "/" });

    const searchInput = await screen.findByRole("searchbox", { name: "Search skills" });
    expect(document.querySelector(".home-v2-listing-search.is-open")).toBeTruthy();

    fireEvent.change(searchInput, { target: { value: "alpha" } });

    await waitFor(() => {
      expect(convexActionMock).toHaveBeenCalledWith("search:searchSkills", {
        query: "alpha",
        limit: 20,
      });
      expect(screen.getByText("Alpha Skill")).toBeTruthy();
    });
  });

  it("searches skills inside the selected category before truncating results", async () => {
    convexActionMock.mockResolvedValue([
      {
        skill: {
          _id: "skills:dev-alpha",
          slug: "dev-alpha",
          displayName: "Dev Alpha",
          summary: "Alpha",
          categories: ["development"],
          stats: { stars: 1, downloads: 1 },
        },
        ownerHandle: "builder",
      },
    ]);

    renderSkillsListing();

    fireEvent.click(screen.getByRole("combobox", { name: "Category" }));
    fireEvent.click(screen.getByRole("option", { name: "Development" }));

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Category" }).textContent).toContain(
        "Development",
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Search catalog" }));
    const searchInput = await screen.findByRole("searchbox", { name: "Search skills" });
    fireEvent.change(searchInput, { target: { value: "alpha" } });

    await waitFor(() => {
      expect(convexActionMock).toHaveBeenCalledWith("search:searchSkills", {
        query: "alpha",
        limit: 20,
        categorySlug: "development",
      });
      expect(screen.getByText("Dev Alpha")).toBeTruthy();
    });
  });

  it("keeps listing search fetch-on-query instead of serving repeated queries from tab cache", async () => {
    convexActionMock.mockResolvedValue([
      {
        skill: {
          _id: "skills:alpha",
          slug: "alpha-skill",
          displayName: "Alpha Skill",
          summary: "Alpha",
          stats: { stars: 1, downloads: 1 },
        },
        ownerHandle: "builder",
      },
    ]);

    renderSkillsListing();

    fireEvent.click(screen.getByRole("button", { name: "Search catalog" }));
    const searchInput = await screen.findByRole("searchbox", { name: "Search skills" });
    fireEvent.change(searchInput, { target: { value: "alpha" } });

    await waitFor(() => {
      expect(convexActionMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.change(searchInput, { target: { value: "" } });
    await waitFor(() => {
      expect(screen.queryByText("Alpha Skill")).toBeNull();
    });

    fireEvent.change(searchInput, { target: { value: "alpha" } });

    await waitFor(() => {
      expect(convexActionMock).toHaveBeenCalledTimes(2);
    });
  });

  it("renders the canonical skill and plugin category definitions", async () => {
    renderSkillsListing();

    await waitFor(() => {
      expect(screen.getByText("Demo Skill").textContent).toBe("Demo Skill");
    });

    const categorySelect = screen.getByRole("combobox", { name: "Category" });
    expect(categorySelect.getAttribute("aria-expanded")).toBe("false");
    expect(categorySelect.textContent).toContain("All categories");

    fireEvent.click(categorySelect);
    expect(
      screen.getByRole("listbox", { name: "Category" }).getAttribute("aria-multiselectable"),
    ).toBe("true");
    expect(screen.getByRole("option", { name: "All categories" }).textContent).toContain(
      "All categories",
    );
    expect(screen.getByRole("option", { name: "Integrations" }).textContent).toContain(
      "Integrations",
    );
    expect(screen.getByRole("option", { name: "Security" }).textContent).toContain("Security");

    fireEvent.click(screen.getByRole("button", { name: "Plugins" }));
    expect(screen.getByRole("option", { name: "Channels" }).textContent).toContain("Channels");
    expect(screen.getByRole("option", { name: "Runtime" }).textContent).toContain("Runtime");
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

  it("loads the existing trending skills leaderboard for the Trending tab", async () => {
    convexQueryMock.mockImplementation((name) => {
      if (name === "skills:listPublicTrendingPage") {
        return Promise.resolve({
          items: [
            {
              skill: {
                _id: "skills:trending",
                slug: "trending-skill",
                displayName: "Trending Skill",
                summary: "Hot this week.",
                stats: { installs: 999 },
              },
              ownerHandle: "builder",
            },
          ],
        });
      }
      return Promise.resolve({
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
    });

    renderSkillsListing();

    await waitFor(() => {
      expect(screen.getByText("Demo Skill")).toBeTruthy();
    });

    convexQueryMock.mockClear();
    fireEvent.click(screen.getByRole("tab", { name: "Trending" }));

    await waitFor(() => {
      expect(convexQueryMock).toHaveBeenCalledWith("skills:listPublicTrendingPage", { limit: 20 });
      expect(screen.getByText("Trending Skill")).toBeTruthy();
    });
    expect(screen.queryByText("Popularity")).toBeNull();
    expect(screen.queryByText("999")).toBeNull();
  });

  it("reuses cached skill tabs instead of refetching when switching back", async () => {
    convexQueryMock.mockImplementation((name) => {
      if (name === "skills:listPublicTrendingPage") {
        return Promise.resolve({
          items: [
            {
              skill: {
                _id: "skills:trending",
                slug: "trending-skill",
                displayName: "Trending Skill",
                summary: "Hot this week.",
                stats: { installs: 999 },
              },
              ownerHandle: "builder",
            },
          ],
        });
      }
      return Promise.resolve({
        page: [
          {
            skill: {
              _id: "skills:top",
              slug: "top-skill",
              displayName: "Top Skill",
              summary: "Popular.",
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
      expect(screen.getByText("Top Skill")).toBeTruthy();
    });
    expect(convexQueryMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("tab", { name: "Trending" }));

    await waitFor(() => {
      expect(screen.getByText("Trending Skill")).toBeTruthy();
    });
    expect(convexQueryMock).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("tab", { name: "Top" }));

    await waitFor(() => {
      expect(screen.getByText("Top Skill")).toBeTruthy();
    });
    expect(convexQueryMock).toHaveBeenCalledTimes(2);
  });

  it("keeps Featured active for skill search", async () => {
    convexActionMock.mockResolvedValue([
      {
        skill: {
          _id: "skills:featured-search",
          slug: "featured-search",
          displayName: "Featured Search Skill",
          stats: { installs: 0 },
        },
        ownerHandle: "builder",
      },
    ]);

    render(<HomeListingSection initialListing={initialPluginListing()} />);
    fireEvent.click(screen.getByRole("button", { name: "Skills" }));
    fireEvent.click(screen.getByRole("button", { name: "Search catalog" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "search" } });

    await waitFor(() => {
      expect(convexActionMock).toHaveBeenCalledWith("search:searchSkills", {
        query: "search",
        limit: 20,
        highlightedOnly: true,
      });
      expect(screen.getByText("Featured Search Skill")).toBeTruthy();
    });
  });

  it("keeps Featured active for plugin search", async () => {
    render(<HomeListingSection initialListing={initialPluginListing()} />);
    fireEvent.click(screen.getByRole("button", { name: "Search catalog" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "search" } });

    await waitFor(() => {
      expect(fetchPluginCatalogMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          featured: true,
          q: "search",
        }),
      );
    });
  });

  it("requests trending plugins from the catalog API", async () => {
    fetchPluginCatalogMock.mockResolvedValue({
      items: [
        {
          name: "trending-plugin",
          displayName: "Trending Plugin",
          family: "code-plugin",
          channel: "community",
          isOfficial: false,
          createdAt: 1,
          updatedAt: 2,
          stats: { stars: 4, downloads: 8, installs: 9, versions: 1 },
        },
      ],
      nextCursor: null,
    });

    render(<HomeListingSection initialListing={initialPluginListing()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Trending" }));

    await waitFor(() => {
      expect(screen.getByText("Trending Plugin").textContent).toBe("Trending Plugin");
    });
    const latestRequest = fetchPluginCatalogMock.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(latestRequest).toEqual(expect.objectContaining({ sort: "trending", limit: 20 }));
  });

  it("reuses cached plugin tabs instead of refetching when switching back", async () => {
    fetchPluginCatalogMock.mockImplementation((args: { sort?: string }) =>
      Promise.resolve({
        items: [
          {
            name: args.sort === "trending" ? "trending-plugin" : "top-plugin",
            displayName: args.sort === "trending" ? "Trending Plugin" : "Top Plugin",
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
              installs: args.sort === "trending" ? 50 : 75,
              versions: 1,
            },
          },
        ],
        nextCursor: null,
      }),
    );

    render(<HomeListingSection initialListing={initialPluginListing()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Trending" }));

    await waitFor(() => {
      expect(screen.getByText("Trending Plugin")).toBeTruthy();
    });
    expect(fetchPluginCatalogMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("tab", { name: "Top" }));

    await waitFor(() => {
      expect(screen.getByText("Top Plugin")).toBeTruthy();
    });
    expect(fetchPluginCatalogMock).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("tab", { name: "Trending" }));

    await waitFor(() => {
      expect(screen.getByText("Trending Plugin")).toBeTruthy();
    });
    expect(fetchPluginCatalogMock).toHaveBeenCalledTimes(2);
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

  it("keeps load more available when selected skill categories overflow after merging", async () => {
    const makeEntry = (index: number, category: string) => ({
      skill: {
        _id: `skills:${category}:${index}`,
        slug: `${category}-skill-${index}`,
        displayName: `${category} Skill ${index}`,
        summary: "Category skill.",
        categories: [category],
        stats: { installs: 100 - index },
      },
      ownerHandle: "builder",
    });
    const development = Array.from({ length: 12 }, (_, index) => makeEntry(index, "development"));
    const security = Array.from({ length: 12 }, (_, index) => makeEntry(index, "security"));

    convexQueryMock.mockImplementation((name, args?: { categorySlug?: string }) => {
      if (name !== "skills:listPublicPageV4") {
        return Promise.resolve({ items: [], nextCursor: null });
      }
      if (args?.categorySlug === "development") {
        return Promise.resolve({ page: development, hasMore: false, nextCursor: null });
      }
      if (args?.categorySlug === "security") {
        return Promise.resolve({ page: security, hasMore: false, nextCursor: null });
      }
      return Promise.resolve({ page: development, hasMore: false, nextCursor: null });
    });

    renderSkillsListing();

    await waitFor(() => {
      expect(screen.getByText("development Skill 0")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("combobox", { name: "Category" }));
    fireEvent.click(screen.getByRole("option", { name: "Development" }));

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Category" }).textContent).toContain(
        "Development",
      );
    });

    fireEvent.click(screen.getByRole("option", { name: "Security" }));

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Category" }).textContent).toContain(
        "2 categories",
      );
      expect(screen.getByRole("button", { name: "Load more" })).toBeTruthy();
    });
    expect(screen.queryByText("security Skill 11")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    await waitFor(() => {
      expect(screen.getByText("security Skill 11")).toBeTruthy();
    });
  });

  it("allows selecting multiple skill categories and refetches each selected category", async () => {
    convexQueryMock.mockResolvedValue({
      page: [
        {
          skill: {
            _id: "skills:inferred",
            slug: "inferred-skill",
            displayName: "Inferred Skill",
            summary: "Uses inferred category metadata.",
            inferredCategories: ["development"],
            latestVersionId: "versions:1",
            inferredFromVersionId: "versions:1",
            stats: { installs: 10 },
          },
          ownerHandle: "builder",
        },
      ],
      hasMore: false,
      nextCursor: null,
    });

    renderSkillsListing();

    await waitFor(() => {
      expect(screen.getByText("Inferred Skill")).toBeTruthy();
    });

    convexQueryMock.mockClear();
    fireEvent.click(screen.getByRole("combobox", { name: "Category" }));
    fireEvent.click(screen.getByRole("option", { name: "Development" }));

    await waitFor(() => {
      expect(convexQueryMock).toHaveBeenCalledWith(
        "skills:listPublicPageV4",
        expect.objectContaining({ categorySlug: "development" }),
      );
    });
    expect(screen.getByRole("combobox", { name: "Category" }).textContent).toContain("Development");
    await waitFor(() => {
      expect(screen.getByText("Inferred Skill")).toBeTruthy();
    });

    convexQueryMock.mockClear();
    fireEvent.click(screen.getByRole("option", { name: "Security" }));

    await waitFor(() => {
      expect(convexQueryMock).toHaveBeenCalledWith(
        "skills:listPublicPageV4",
        expect.objectContaining({ categorySlug: "development" }),
      );
      expect(convexQueryMock).toHaveBeenCalledWith(
        "skills:listPublicPageV4",
        expect.objectContaining({ categorySlug: "security" }),
      );
    });
    expect(screen.getByRole("combobox", { name: "Category" }).textContent).toContain(
      "2 categories",
    );
    expect(screen.getByRole("option", { name: "Development" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByRole("option", { name: "Security" }).getAttribute("aria-selected")).toBe(
      "true",
    );

    fireEvent.click(screen.getByRole("option", { name: "All categories" }));

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Category" }).textContent).toContain(
        "All categories",
      );
    });
  });
});
