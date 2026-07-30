/* @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigateMock = vi.fn();
const convexQueryMock = vi.fn();
const convexActionMock = vi.fn();
const fetchPluginCatalogMock = vi.fn();
const fetchCanonicalTrendingPageMock = vi.fn();
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
    <a className={className} href={to ?? "/"}>
      {children}
    </a>
  ),
  useNavigate: () => navigateMock,
}));

vi.mock("../convex/client", () => ({
  convexHttp: {
    query: (...args: unknown[]) => convexQueryMock(...args),
    action: (...args: unknown[]) => convexActionMock(...args),
  },
}));

vi.mock("../../convex/_generated/api", () => ({
  api: {
    packages: { listPublicNewPluginsPage: "packages:listPublicNewPluginsPage" },
    skills: { listPublicPageV4: "skills:listPublicPageV4" },
    search: { searchNativeSkills: "search:searchNativeSkills" },
  },
}));

vi.mock("../lib/packageApi", () => ({
  fetchPluginCatalog: (...args: unknown[]) => fetchPluginCatalogMock(...args),
}));

vi.mock("../lib/catalogDiscoveryCapabilities", () => ({
  fetchCatalogDiscoveryCapabilities: (...args: unknown[]) =>
    fetchCatalogDiscoveryCapabilitiesMock(...args),
}));

vi.mock("../lib/trendingApi", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/trendingApi")>();
  return {
    ...original,
    fetchCanonicalTrendingPage: (...args: unknown[]) => fetchCanonicalTrendingPageMock(...args),
  };
});

import { HomeListingSection } from "../components/HomeListingSection";

describe("HomeListingSection", () => {
  beforeEach(() => {
    navigateMock.mockReset();
    convexQueryMock.mockReset();
    convexActionMock.mockReset();
    fetchPluginCatalogMock.mockReset();
    fetchCanonicalTrendingPageMock.mockReset();
    fetchCatalogDiscoveryCapabilitiesMock.mockReset();
    fetchCatalogDiscoveryCapabilitiesMock.mockResolvedValue({
      apiVersion: 1,
      canonicalTrendingEnabled: true,
    });
    convexQueryMock.mockResolvedValue({ page: [], hasMore: false, nextCursor: null });
    convexActionMock.mockResolvedValue([]);
    fetchPluginCatalogMock.mockResolvedValue({ items: [], nextCursor: null });
    fetchCanonicalTrendingPageMock.mockResolvedValue(canonicalPage([]));
  });

  it("defaults the homepage to Skills and canonical Trending with exact tab order", () => {
    const first = makeTrending("first", "First Skill", 17, 9000);
    const second = makeTrending("second", "Second Skill", 3, 8000);
    render(<HomeListingSection initialListing={initialTrending([first, second])} />);

    const contentTypeButtons = screen
      .getByRole("group", { name: "Content type" })
      .querySelectorAll("button");
    expect(Array.from(contentTypeButtons, (button) => button.textContent)).toEqual([
      "Skills",
      "Plugins",
    ]);
    expect(screen.getByRole("button", { name: "Skills" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("tab", { name: "Trending" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Trending",
      "Featured",
      "Official",
      "New",
    ]);
    expect(screen.queryByRole("tab", { name: "Top" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Category" })).toBeNull();
    expect(
      Array.from(
        document.querySelectorAll(".home-v2-listing-row-name"),
        (node) => node.textContent,
      ),
    ).toEqual(["First Skill", "Second Skill"]);
    expect(screen.getByText("17")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.queryByText("9K")).toBeNull();
    expect(screen.queryByText("8K")).toBeNull();
    expect(screen.queryByText("skills.sh")).toBeNull();
  });

  it("hides unavailable Trending and falls back to the native New feed", async () => {
    render(<HomeListingSection initialListing={initialTrending([], false, "unavailable")} />);

    expect(screen.queryByRole("tab", { name: "Trending" })).toBeNull();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Featured",
      "Official",
      "New",
    ]);
    expect(screen.getByRole("tab", { name: "New" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByText("24-hour Trending unavailable")).toBeNull();
    await waitFor(() =>
      expect(convexQueryMock).toHaveBeenCalledWith(
        "skills:listPublicPageV4",
        expect.objectContaining({ sort: "newest", createdAfter: expect.any(Number) }),
      ),
    );
  });

  it("falls back when Trending becomes unavailable after mount", async () => {
    fetchCatalogDiscoveryCapabilitiesMock.mockResolvedValue({
      apiVersion: 1,
      canonicalTrendingEnabled: false,
    });

    render(<HomeListingSection />);

    await waitFor(() => expect(screen.queryByRole("tab", { name: "Trending" })).toBeNull());
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Featured",
      "Official",
      "New",
    ]);
    expect(screen.getByRole("tab", { name: "New" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByText("24-hour Trending unavailable")).toBeNull();
    expect(fetchCanonicalTrendingPageMock).not.toHaveBeenCalled();
    expect(convexQueryMock).toHaveBeenCalledWith(
      "skills:listPublicPageV4",
      expect.objectContaining({ sort: "newest", createdAfter: expect.any(Number) }),
    );
  });

  it("labels an empty canonical 24-hour window honestly", () => {
    render(<HomeListingSection initialListing={initialTrending([])} />);

    expect(screen.getByText("No 24-hour activity yet")).toBeTruthy();
    expect(screen.getByText(/eligible activity in the current 24-hour window/i)).toBeTruthy();
  });

  it("shows Featured, Official, and New for plugins but never plugin Trending", async () => {
    render(<HomeListingSection initialListing={initialTrending([])} />);

    fireEvent.click(screen.getByRole("button", { name: "Plugins" }));

    expect(screen.getByRole("tab", { name: "New" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Featured",
      "Official",
      "New",
    ]);
    expect(screen.queryByRole("tab", { name: "Trending" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Top" })).toBeNull();
    await waitFor(() =>
      expect(convexQueryMock).toHaveBeenCalledWith(
        "packages:listPublicNewPluginsPage",
        expect.any(Object),
      ),
    );
  });

  it("uses the native New, Featured, and Official eligibility contracts", async () => {
    render(<HomeListingSection initialListing={initialTrending([])} />);

    fireEvent.click(screen.getByRole("tab", { name: "New" }));
    await waitFor(() => {
      expect(convexQueryMock).toHaveBeenCalledWith(
        "skills:listPublicPageV4",
        expect.objectContaining({ sort: "newest", createdAfter: expect.any(Number) }),
      );
    });
    expect(screen.getByRole("combobox", { name: "Category" })).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Featured" }));
    await waitFor(() => {
      expect(convexQueryMock).toHaveBeenCalledWith(
        "skills:listPublicPageV4",
        expect.objectContaining({ highlightedOnly: true, numItems: 40 }),
      );
    });

    fireEvent.click(screen.getByRole("tab", { name: "Official" }));
    await waitFor(() => {
      expect(convexQueryMock).toHaveBeenCalledWith(
        "skills:listPublicPageV4",
        expect.objectContaining({ officialOnly: true }),
      );
    });
  });

  it("preserves the explicit Load more interaction", async () => {
    const first = makeTrending("first", "First Skill", 17, 9000);
    const second = makeTrending("second", "Second Skill", 3, 8000);
    fetchCanonicalTrendingPageMock.mockResolvedValue(canonicalPage([first, second]));
    render(<HomeListingSection initialListing={initialTrending([first], true)} />);

    expect(screen.getByRole("button", { name: "Load more" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    expect(await screen.findByTitle("Second Skill")).toBeTruthy();
    expect(fetchCanonicalTrendingPageMock).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: null, limit: 20 }),
    );
  });

  it("keeps loaded Trending rows when a later Load more page fails", async () => {
    const first = makeTrending("first", "First Skill", 17, 9000);
    fetchCanonicalTrendingPageMock
      .mockResolvedValueOnce(canonicalPage([first], "opaque cursor 2"))
      .mockRejectedValueOnce(new Error("second page unavailable"));
    render(<HomeListingSection initialListing={initialTrending([first], true)} />);

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    await waitFor(() => {
      expect(fetchCanonicalTrendingPageMock).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByTitle("First Skill")).toBeTruthy();
    expect(screen.queryByText("24-hour Trending unavailable")).toBeNull();
  });

  it("keeps search as a separate relevance-first interaction", async () => {
    convexActionMock.mockResolvedValue([
      {
        skill: makeNativeSkill("search-hit", "Search Hit"),
        ownerHandle: "builder",
      },
    ]);
    render(<HomeListingSection initialListing={initialTrending([])} />);

    fireEvent.click(screen.getByRole("button", { name: "Search catalog" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search skills" }), {
      target: { value: "search" },
    });

    expect(await screen.findByText("Search Hit")).toBeTruthy();
    expect(convexActionMock).toHaveBeenCalledWith(
      "search:searchNativeSkills",
      expect.objectContaining({ query: "search" }),
    );
  });

  it("supports list and grid presentation without changing feed order", () => {
    const first = makeTrending("first", "First Skill", 17, 9000);
    const second = makeTrending("second", "Second Skill", 3, 8000);
    render(<HomeListingSection initialListing={initialTrending([first, second])} />);

    fireEvent.click(screen.getByRole("button", { name: "Grid view" }));
    expect(document.querySelector(".home-v2-listing-grid")).toBeTruthy();
    expect(
      Array.from(
        document.querySelectorAll(".home-v2-listing-card-name"),
        (node) => node.textContent,
      ),
    ).toEqual(["First Skill", "Second Skill"]);
  });
});

function initialTrending(
  items: ReturnType<typeof makeTrending>[],
  hasMore = false,
  trendingState: "available" | "empty" | "unavailable" = items.length ? "available" : "empty",
) {
  return {
    kind: "skills" as const,
    tab: "trending" as const,
    categorySlugs: [] as [],
    fetchLimit: 20 as const,
    items: items.map((trending) => ({ trending })),
    hasMore,
    trendingState,
  };
}

function canonicalPage(items: ReturnType<typeof makeTrending>[], nextCursor: string | null = null) {
  return {
    kind: "skills" as const,
    snapshotId: "snapshot-1",
    snapshotCursor: "snapshot-cursor",
    generatedAt: "2026-07-26T00:00:00.000Z",
    windowHours: 24 as const,
    rankingVersion: "skills-trending-v1",
    totalItems: items.length,
    items,
    nextCursor,
  };
}

function makeTrending(slug: string, displayName: string, installs: number, lifetime: number) {
  return {
    id: `clawhub:${slug}`,
    source: "clawhub" as const,
    slug,
    displayName,
    summary: `${displayName} summary`,
    canonicalUrl: `/builder/${slug}`,
    publisher: {
      kind: "user" as const,
      handle: "builder",
      displayName: "Builder",
      image: null,
      official: false,
    },
    official: false,
    featured: false,
    metrics: {
      trending24hInstalls: installs,
      trending24hBookmarks: null,
      lifetimeInstalls: lifetime,
      lifetimeInstallsPeriod: "lifetime" as const,
      updatedAt: 1,
    },
  };
}

function makeNativeSkill(slug: string, displayName: string) {
  return {
    _id: `skills:${slug}`,
    slug,
    displayName,
    summary: `${displayName} summary`,
    stats: { comments: 0, downloads: 0, installs: 0, stars: 0, versions: 1 },
    tags: {},
    createdAt: 1,
    updatedAt: 1,
  };
}
