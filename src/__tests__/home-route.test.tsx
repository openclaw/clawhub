/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const initialListingFixture = {
  kind: "skills",
  tab: "trending",
  categorySlugs: [],
  fetchLimit: 20,
  items: [
    {
      trending: {
        id: "clawhub:initial-skill",
        source: "clawhub",
        slug: "initial-skill",
        displayName: "Initial Skill",
        summary: "Initial summary",
        canonicalUrl: "/owner/initial-skill",
        publisher: null,
        official: false,
        featured: false,
        metrics: {
          lifetimeInstalls: 1,
          lifetimeInstallsPeriod: "lifetime",
          trending24hBookmarks: null,
          trending24hInstalls: 2,
          updatedAt: 3,
        },
      },
    },
  ],
  hasMore: false,
};

const initialFeatureFlagsFixture = {
  values: null,
};

const homeListingSectionMock = vi.fn();
const navigateMock = vi.fn();
let routeSearch: Record<string, unknown> = {};
const fetchInitialHomeListingMock = vi.fn((_view?: unknown) =>
  Promise.resolve(initialListingFixture),
);
const loadInitialFeatureFlagsMock = vi.fn(() => Promise.resolve(initialFeatureFlagsFixture));
let featureFlagEnabled = false;

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: { component?: unknown }) => {
    const route = {
      __config: config,
      useLoaderData: () => ({
        initialFeatureFlags: initialFeatureFlagsFixture,
        initialListing: initialListingFixture,
      }),
      useSearch: () => routeSearch,
    };
    return route;
  },
  useNavigate: () => navigateMock,
  Link: ({ children, className, to }: { children: ReactNode; className?: string; to?: string }) => (
    <a className={className} href={to ?? "/"}>
      {children}
    </a>
  ),
}));

vi.mock("../lib/featureFlags", () => ({
  FeatureFlagProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useFeatureFlag: () => featureFlagEnabled,
}));

vi.mock("../lib/featureFlags.functions", () => ({
  loadInitialFeatureFlags: () => loadInitialFeatureFlagsMock(),
}));

vi.mock("../components/HomeListingSection", () => ({
  HomeListingSection: (props: unknown) => {
    homeListingSectionMock(props);
    return <section data-testid="home-listing-stub" />;
  },
}));

vi.mock("../lib/homeListingData", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/homeListingData")>()),
  fetchInitialHomeListing: (view: unknown) => fetchInitialHomeListingMock(view),
}));

vi.mock("../components/HomePopularPublishersSection", () => ({
  HomePopularPublishersSection: () => <section data-testid="home-publishers-stub" />,
}));

vi.mock("../components/HomeAppsSection", () => ({
  HomeAppsSection: () => <section data-testid="home-apps-stub" />,
}));

vi.mock("../components/HomeBringSkillsSection", () => ({
  HomeBringSkillsSection: () => <section data-testid="home-bring-skills-stub" />,
}));

describe("home route", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    homeListingSectionMock.mockClear();
    navigateMock.mockClear();
    routeSearch = {};
    fetchInitialHomeListingMock.mockClear();
    loadInitialFeatureFlagsMock.mockClear();
    featureFlagEnabled = false;
  });

  async function renderHome() {
    const { Route } = await import("../routes/index");
    const Component = (Route as unknown as { __config: { component: React.ComponentType } })
      .__config.component;

    render(<Component />);
  }

  async function getRouteLoader() {
    const { Route } = await import("../routes/index");
    const loader = (
      Route as unknown as {
        __config: { loader: (ctx: { location: { search: Record<string, unknown> } }) => unknown };
      }
    ).__config.loader;
    return (search: Record<string, unknown> = {}) => loader({ location: { search } });
  }

  async function getValidateSearch() {
    const { Route } = await import("../routes/index");
    return (
      Route as unknown as {
        __config: { validateSearch: (search: Record<string, unknown>) => unknown };
      }
    ).__config.validateSearch;
  }

  async function getRouteHeadLinks() {
    const { Route } = await import("../routes/index");
    const head = (
      Route as unknown as {
        __config: { head?: () => { links?: Array<{ rel?: string; as?: string; href?: string }> } };
      }
    ).__config.head?.();
    return head?.links ?? [];
  }

  it("renders the static hero copy without the community eyebrow", async () => {
    await renderHome();

    expect(screen.queryByText("BUILT BY THE COMMUNITY")).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Tools for your agents" })).toBeTruthy();
    expect(screen.getByText("Discover skills and plugins from top creators").textContent).toBe(
      "Discover skills and plugins from top creators",
    );
    expect(screen.queryByRole("link", { name: "200k+ publishers" })).toBeNull();
  });

  it("shows an unmistakable test message when the proof flag is enabled", async () => {
    featureFlagEnabled = true;

    await renderHome();

    expect(screen.getByText("Feature flag test is enabled.")).toBeTruthy();
    expect(screen.queryByText("Discover skills and plugins from top creators")).toBeNull();
  });

  it("renders the catalog and new homepage sections without the old hero search", async () => {
    await renderHome();

    expect(screen.getByTestId("home-listing-stub").tagName).toBe("SECTION");
    expect(screen.getByTestId("home-publishers-stub").tagName).toBe("SECTION");
    expect(screen.getByTestId("home-apps-stub").tagName).toBe("SECTION");
    expect(screen.getByTestId("home-bring-skills-stub").tagName).toBe("SECTION");
    expect(screen.queryByPlaceholderText("What are you looking for?")).toBeNull();
    expect(screen.queryByText("Featured skills")).toBeNull();
    expect(screen.queryByText("Trending Now")).toBeNull();
  });

  it("passes the loader listing and URL view into the home listing section", async () => {
    routeSearch = { kind: "skills", tab: "trending" };
    await renderHome();

    expect(homeListingSectionMock).toHaveBeenCalledWith({
      initialListing: initialListingFixture,
      requestedView: { kind: "skills", tab: "trending" },
      onViewChange: expect.any(Function),
    });
  });

  it("keeps default views out of the URL and drops unknown values", async () => {
    const validateSearch = await getValidateSearch();

    expect(validateSearch({ kind: "skills", tab: "new" })).toEqual({ kind: "skills", tab: "new" });
    expect(validateSearch({ kind: "plugins", tab: "featured" })).toEqual({
      kind: undefined,
      tab: undefined,
    });
    expect(validateSearch({ kind: "agents", tab: ["trending"] })).toEqual({
      kind: undefined,
      tab: undefined,
    });
  });

  it("replaces the URL view without scrolling when the listing view changes", async () => {
    routeSearch = { kind: "skills", tab: "trending" };
    await renderHome();
    const { onViewChange } = homeListingSectionMock.mock.calls[0]![0] as {
      onViewChange: (view: { kind: string; tab: string }) => void;
    };

    onViewChange({ kind: "plugins", tab: "new" });

    expect(navigateMock).toHaveBeenCalledWith({
      search: expect.any(Function),
      replace: true,
      resetScroll: false,
    });
    const { search } = navigateMock.mock.calls[0]![0] as {
      search: (prev: Record<string, unknown>) => Record<string, unknown>;
    };
    expect(search({ kind: "skills", tab: "trending" })).toEqual({ kind: undefined, tab: "new" });
  });

  it("loads the URL-requested listing view for direct links", async () => {
    const loader = await getRouteLoader();

    await loader({ kind: "skills", tab: "official" });

    expect(fetchInitialHomeListingMock).toHaveBeenCalledWith({ kind: "skills", tab: "official" });
  });

  it("loads the default home listing and feature flags in the route loader", async () => {
    const loader = await getRouteLoader();

    await expect(loader()).resolves.toEqual({
      initialFeatureFlags: initialFeatureFlagsFixture,
      initialListing: initialListingFixture,
    });
    expect(fetchInitialHomeListingMock).toHaveBeenCalledTimes(1);
    expect(fetchInitialHomeListingMock).toHaveBeenCalledWith({ kind: "plugins", tab: "featured" });
    expect(loadInitialFeatureFlagsMock).toHaveBeenCalledTimes(1);
  });

  it("does not prioritize offscreen app icons in the route head", async () => {
    const links = await getRouteHeadLinks();

    expect(links.some((link) => link.rel === "preload" && link.as === "image")).toBe(false);
    expect(links.some((link) => link.rel === "preconnect" && link.href?.includes("jsdelivr"))).toBe(
      false,
    );
  });

  it("falls back to client loading when the default listing loader fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchInitialHomeListingMock.mockRejectedValueOnce(new Error("offline"));
    const loader = await getRouteLoader();

    await expect(loader()).resolves.toEqual({
      initialFeatureFlags: initialFeatureFlagsFixture,
      initialListing: null,
    });
    expect(errorSpy).toHaveBeenCalledWith(
      "Failed to load initial home listing:",
      expect.any(Error),
    );
  });

  it("does not render the homepage social proof stats strip", async () => {
    await renderHome();

    expect(document.querySelector(".home-v2-proof-bar")).toBeNull();
    expect(screen.queryByText("52.7k")).toBeNull();
    expect(screen.queryByText("180k")).toBeNull();
    expect(screen.queryByText("12M")).toBeNull();
    expect(screen.queryByText("avg rating")).toBeNull();
  });
});
