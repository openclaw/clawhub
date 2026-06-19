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

  it("renders the listing toolbar and skill cards by default", async () => {
    render(<HomeListingSection />);

    expect(screen.getByRole("group", { name: "Content type" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Trending" })).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText("Demo Skill")).toBeTruthy();
    });
  });

  it("switches to plugins and loads plugin cards", async () => {
    render(<HomeListingSection />);

    fireEvent.click(screen.getByRole("button", { name: "Plugins" }));
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

    render(<HomeListingSection />);

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

  it("renders the canonical skill and plugin category definitions", async () => {
    render(<HomeListingSection />);

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

    render(<HomeListingSection />);

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
                _id: "skills:low",
                slug: "low-trending-skill",
                displayName: "Low Trending Skill",
                summary: "Hot this week.",
                stats: { installsAllTime: 999 },
              },
              ownerHandle: "builder",
              trending: { installs: 7, downloads: 100 },
            },
            {
              skill: {
                _id: "skills:high",
                slug: "high-trending-skill",
                displayName: "High Trending Skill",
                summary: "Hotter this week.",
                stats: { installsAllTime: 1 },
              },
              ownerHandle: "builder",
              trending: { installs: 42, downloads: 0 },
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

    render(<HomeListingSection />);

    await waitFor(() => {
      expect(screen.getByText("Demo Skill")).toBeTruthy();
    });

    convexQueryMock.mockClear();
    fireEvent.click(screen.getByRole("tab", { name: "Trending" }));

    await waitFor(() => {
      expect(convexQueryMock).toHaveBeenCalledWith("skills:listPublicTrendingPage", { limit: 20 });
      expect(screen.getByText("High Trending Skill")).toBeTruthy();
      expect(screen.getByText("Low Trending Skill")).toBeTruthy();
      expect(
        screen
          .getByText("High Trending Skill")
          .compareDocumentPosition(screen.getByText("Low Trending Skill")) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(screen.getByText("42")).toBeTruthy();
      expect(screen.getByText("7")).toBeTruthy();
      expect(screen.queryByText("999")).toBeNull();
    });
  });

  it("filters official plugins locally without using the broken official-only endpoint", async () => {
    fetchPluginCatalogMock.mockResolvedValue({
      items: [
        {
          name: "community-plugin",
          displayName: "Community Plugin",
          family: "code-plugin",
          channel: "community",
          isOfficial: false,
          createdAt: 1,
          updatedAt: 2,
          stats: { stars: 1, downloads: 2, installs: 0, versions: 1 },
        },
        {
          name: "official-plugin",
          displayName: "Official Plugin",
          family: "code-plugin",
          channel: "official",
          isOfficial: true,
          createdAt: 1,
          updatedAt: 2,
          stats: { stars: 4, downloads: 8, installs: 0, versions: 1 },
        },
      ],
      nextCursor: null,
    });

    render(<HomeListingSection />);
    fireEvent.click(screen.getByRole("button", { name: "Plugins" }));
    fireEvent.click(screen.getByRole("tab", { name: "Official" }));

    await waitFor(() => {
      expect(screen.getByText("Official Plugin").textContent).toBe("Official Plugin");
    });
    expect(screen.queryByText("Community Plugin")).toBeNull();
    const latestRequest = fetchPluginCatalogMock.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(latestRequest).toEqual(expect.objectContaining({ limit: 100 }));
    expect(latestRequest).not.toHaveProperty("isOfficial");
  });

  it("allows selecting multiple skill categories and refetches each selected category", async () => {
    render(<HomeListingSection />);

    await waitFor(() => {
      expect(screen.getByText("Demo Skill")).toBeTruthy();
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
