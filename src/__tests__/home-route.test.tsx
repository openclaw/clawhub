/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const initialListingFixture = {
  kind: "plugins",
  tab: "featured",
  categorySlugs: [],
  fetchLimit: 20,
  items: [
    {
      name: "initial-plugin",
      displayName: "Initial Plugin",
      family: "code-plugin",
      channel: "community",
      isOfficial: false,
      createdAt: 1,
      updatedAt: 2,
    },
  ],
  hasMore: false,
  featuredAvailability: {
    plugins: true,
    skills: true,
  },
};

const homeListingSectionMock = vi.fn();
const fetchInitialHomeListingMock = vi.fn(() => Promise.resolve(initialListingFixture));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: { component?: unknown }) => {
    const route = {
      __config: config,
      useLoaderData: () => initialListingFixture,
    };
    return route;
  },
  Link: ({ children, className, to }: { children: ReactNode; className?: string; to?: string }) => (
    <a className={className} href={to ?? "/"}>
      {children}
    </a>
  ),
}));

vi.mock("../components/HomeListingSection", () => ({
  HomeListingSection: (props: unknown) => {
    homeListingSectionMock(props);
    return <section data-testid="home-listing-stub" />;
  },
}));

vi.mock("../lib/homeListingData", () => ({
  fetchInitialHomeListing: () => fetchInitialHomeListingMock(),
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
    fetchInitialHomeListingMock.mockClear();
  });

  async function renderHome() {
    const { Route } = await import("../routes/index");
    const Component = (Route as unknown as { __config: { component: React.ComponentType } })
      .__config.component;

    render(<Component />);
  }

  async function getRouteLoader() {
    const { Route } = await import("../routes/index");
    return (Route as unknown as { __config: { loader: () => Promise<unknown> } }).__config.loader;
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
    expect(screen.getByRole("heading", { level: 1, name: "Claws for your Claws" })).toBeTruthy();
    expect(screen.getByText("Discover skills and plugins from top creators").textContent).toBe(
      "Discover skills and plugins from top creators",
    );
    expect(screen.queryByRole("link", { name: "200k+ publishers" })).toBeNull();
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

  it("passes the loader listing into the home listing section", async () => {
    await renderHome();

    expect(homeListingSectionMock).toHaveBeenCalledWith({
      initialListing: initialListingFixture,
    });
  });

  it("loads the default home listing in the route loader", async () => {
    const loader = await getRouteLoader();

    await expect(loader()).resolves.toBe(initialListingFixture);
    expect(fetchInitialHomeListingMock).toHaveBeenCalledTimes(1);
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

    await expect(loader()).resolves.toBeNull();
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
