/* @vitest-environment jsdom */

import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const initialListingFixture = {
  kind: "skills",
  tab: "popular",
  categorySlugs: [],
  fetchLimit: 20,
  items: [
    {
      skill: {
        _id: "skills:initial",
        slug: "initial-skill",
        displayName: "Initial Skill",
        stats: { installsAllTime: 10 },
      },
      ownerHandle: "builder",
    },
  ],
  hasMore: false,
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

  function clickHeroHeadlineTriple() {
    const headline = screen.getByRole("button", { name: /Equip/ });
    act(() => {
      fireEvent.click(headline);
      fireEvent.click(headline);
      fireEvent.click(headline);
    });
  }

  it("renders the polished hero copy without the community eyebrow", async () => {
    await renderHome();

    expect(screen.queryByText("BUILT BY THE COMMUNITY")).toBeNull();
    expect(
      Array.from(document.querySelectorAll(".home-v2-cycle-word")).map((el) => el.textContent),
    ).toEqual(["Unleash", "Ship", "Build", "Create", "Unleash"]);
    expect(screen.getByText("Discover skills and plugins from top creators").textContent).toBe(
      "Discover skills and plugins from top creators",
    );
    expect(screen.queryByRole("link", { name: "200k+ publishers" })).toBeNull();
    expect(screen.getByRole("button", { name: /Equip/ }).tabIndex).toBe(0);
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
    expect(screen.queryByText(/claw for your claw/i)).toBeNull();
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

  it("starts the slot machine when the community label is triple-clicked", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-29T00:00:00Z"));
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    await renderHome();
    clickHeroHeadlineTriple();

    expect(document.querySelector(".home-v2-headline-slots")).toBeTruthy();
    expect(document.querySelector(".home-v2-confetti")).toBeTruthy();
  });

  it("rerolls accidental triples on non-jackpot spins", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-29T00:00:00Z"));
    vi.spyOn(Math, "random")
      .mockReturnValueOnce(0.5)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0.1)
      .mockReturnValueOnce(0.2)
      .mockReturnValueOnce(0.3);

    await renderHome();
    clickHeroHeadlineTriple();

    act(() => {
      vi.advanceTimersByTime(2400);
    });

    expect(
      Array.from(document.querySelectorAll(".home-v2-slot-word")).map((el) => el.textContent),
    ).toEqual(["Install", "Unleash", "Ship"]);
    expect(document.querySelector(".home-v2-headline-jackpot")).toBeNull();
  });

  it("applies the Hack jackpot effect on the 1-in-100 path", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-29T00:00:00Z"));
    vi.spyOn(Math, "random")
      .mockReturnValueOnce(0.01)
      .mockReturnValueOnce(0.1)
      .mockReturnValue(0.5);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);

    await renderHome();
    clickHeroHeadlineTriple();

    act(() => {
      vi.advanceTimersByTime(2400);
    });

    expect(
      Array.from(document.querySelectorAll(".home-v2-slot-word")).map((el) => el.textContent),
    ).toEqual(["Hack", "Hack", "Hack"]);
    expect(document.querySelector(".home-v2-headline-hack")).toBeTruthy();
    expect(document.querySelector(".home-v2-hack-lobster")).toBeTruthy();
  });
});
