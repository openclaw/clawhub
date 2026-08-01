/* @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CanonicalTrendingItem } from "../lib/trendingApi";

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

  it("shows canonical Trending download totals without changing order", () => {
    const first = makeTrending("first", "First Skill", 17, 9000, 71);
    const second = makeTrending("second", "Second Skill", 3, 8000, 29);
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
    expect(screen.getByText("71")).toBeTruthy();
    expect(screen.getByText("29")).toBeTruthy();
    expect(screen.queryByText("17")).toBeNull();
    expect(screen.queryByText("3")).toBeNull();
    expect(screen.getByText("Downloads")).toBeTruthy();
    expect(screen.getAllByLabelText("Downloads")).toHaveLength(2);
    expect(screen.queryByText("24h installs")).toBeNull();
    expect(screen.queryByLabelText("24-hour installs")).toBeNull();
    expect(screen.queryByText("9K")).toBeNull();
    expect(screen.queryByText("8K")).toBeNull();
    expect(screen.queryByText("skills.sh")).toBeNull();
    expect(document.querySelector(".home-v2-listing-row-icon")).toBeNull();
    expect(document.querySelector(".home-v2-listing-row-stats svg")).toBeNull();

    expect(screen.queryByRole("button", { name: "Grid view" })).toBeNull();
  });

  it("identifies skills.sh rows by their source owner and upstream install count", () => {
    const external = {
      ...makeTrending("reddit-automation", "reddit-automation", 0, 12_345, 0),
      id: "skills-sh:doany-skills/skills/reddit-automation",
      source: "skills-sh" as const,
      canonicalUrl: "/skills-sh/doany-skills/skills/reddit-automation",
      publisher: null,
      sourceIdentity: {
        id: "doany-skills/skills/reddit-automation",
        owner: "doany-skills",
        repo: "skills",
        host: null,
        lifetimeInstalls: 12_345,
      },
      metrics: {
        trending24hDownloads: null,
        trending24hInstalls: null,
        trending24hBookmarks: null,
        lifetimeInstalls: 12_345,
        lifetimeInstallsPeriod: "lifetime" as const,
        updatedAt: 1,
      },
    };

    render(<HomeListingSection initialListing={initialTrending([external])} />);

    expect(screen.getByText("@doany-skills")).toBeTruthy();
    expect(screen.getByText("skills.sh")).toBeTruthy();
    expect(screen.getByLabelText("Downloads").textContent).toContain("12.3k");
  });

  it("hides unavailable Trending and falls back to the Featured feed", async () => {
    render(<HomeListingSection initialListing={initialTrending([], false, "unavailable")} />);

    expect(screen.queryByRole("tab", { name: "Trending" })).toBeNull();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Featured",
      "Official",
      "New",
    ]);
    expect(screen.getByRole("tab", { name: "Featured" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.queryByText("24-hour Trending unavailable")).toBeNull();
    await waitFor(() =>
      expect(convexQueryMock).toHaveBeenCalledWith(
        "skills:listPublicPageV4",
        expect.objectContaining({ highlightedOnly: true }),
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
    expect(screen.getByRole("tab", { name: "Featured" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.queryByText("24-hour Trending unavailable")).toBeNull();
    expect(fetchCanonicalTrendingPageMock).not.toHaveBeenCalled();
    expect(convexQueryMock).toHaveBeenCalledWith(
      "skills:listPublicPageV4",
      expect.objectContaining({ highlightedOnly: true }),
    );
  });

  it("returns from Plugins to Featured when Trending is unavailable", async () => {
    render(<HomeListingSection initialListing={initialTrending([], false, "unavailable")} />);

    fireEvent.click(screen.getByRole("button", { name: "Plugins" }));
    expect(screen.getByRole("tab", { name: "New" }).getAttribute("aria-selected")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Skills" }));
    expect(screen.getByRole("tab", { name: "Featured" }).getAttribute("aria-selected")).toBe(
      "true",
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
    expect(screen.queryByRole("combobox", { name: "Category" })).toBeNull();

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
});

function initialTrending(
  items: CanonicalTrendingItem[],
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

function canonicalPage(items: CanonicalTrendingItem[], nextCursor: string | null = null) {
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

function makeTrending(
  slug: string,
  displayName: string,
  installs: number,
  lifetime: number,
  downloads = installs,
): CanonicalTrendingItem {
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
      trending24hDownloads: downloads,
      trending24hInstalls: installs,
      trending24hBookmarks: null,
      lifetimeInstalls: lifetime,
      lifetimeInstallsPeriod: "lifetime" as const,
      updatedAt: 1,
    },
  };
}
