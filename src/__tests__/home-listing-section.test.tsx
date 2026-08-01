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

  it("renders listing tabs left, content tabs right, and only the list presentation", async () => {
    render(<HomeListingSection initialListing={initialPluginListing()} />);

    const toolbar = document.querySelector(".home-v2-listing-toolbar");
    const sortTabs = screen.getByRole("tablist", { name: "Sort" });
    const contentType = screen.getByRole("group", { name: "Content type" });
    const contentTypeButtons = contentType.querySelectorAll("button");
    expect(toolbar?.firstElementChild?.contains(sortTabs)).toBe(true);
    expect(toolbar?.lastElementChild).toBe(contentType);
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
    expect(screen.queryByRole("button", { name: "Search catalog" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Category" })).toBeNull();
    expect(screen.queryByRole("button", { name: "List view" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Grid view" })).toBeNull();
    expect(screen.getByText("Demo Plugin")).toBeTruthy();
    expect(document.querySelector(".home-v2-listing-list")).toBeTruthy();
    expect(screen.getByText("Downloads")).toBeTruthy();
    expect(document.querySelector(".home-v2-listing-row-icon")).toBeNull();
    expect(document.querySelector(".home-v2-listing-row-stats svg")).toBeNull();
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
