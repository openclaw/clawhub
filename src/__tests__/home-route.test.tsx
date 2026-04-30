/* @vitest-environment jsdom */

import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const siteModeMock = vi.fn(() => "skills");
const navigateMock = vi.fn();
const { convexQueryMock, fetchFeaturedPluginsMock } = vi.hoisted(() => ({
  convexQueryMock: vi.fn(),
  fetchFeaturedPluginsMock: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: { component?: unknown }) => ({
    __config: config,
  }),
  Link: ({ children, className, to }: { children: ReactNode; className?: string; to?: string }) => (
    <a className={className} href={to ?? "/"}>
      {children}
    </a>
  ),
  useNavigate: () => navigateMock,
}));

vi.mock("convex/react", () => ({
  useAction: () => vi.fn(),
  useQuery: () => undefined,
}));

vi.mock("../../convex/_generated/api", () => ({
  api: {
    skills: {
      listHighlightedPublic: "skills:listHighlightedPublic",
      listPublicPageV4: "skills:listPublicPageV4",
    },
  },
}));

vi.mock("../convex/client", () => ({
  convexHttp: {
    query: convexQueryMock,
  },
}));

vi.mock("../lib/featuredCatalog", () => ({
  fetchFeaturedPlugins: fetchFeaturedPluginsMock,
}));

vi.mock("../lib/site", () => ({
  getSiteMode: () => siteModeMock(),
}));

vi.mock("../components/SoulCard", () => ({
  SoulCard: () => <div />,
}));

vi.mock("../components/SoulStats", () => ({
  SoulStatsTripletLine: () => <div />,
}));

describe("home route", () => {
  beforeEach(() => {
    siteModeMock.mockReturnValue("skills");
    convexQueryMock.mockResolvedValue([]);
    fetchFeaturedPluginsMock.mockResolvedValue([]);
    navigateMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function renderHome() {
    const { Route } = await import("../routes/index");
    const Component = (Route as unknown as { __config: { component: React.ComponentType } })
      .__config.component;

    render(<Component />);
  }

  function clickHeroLabelTriple() {
    const label = screen.getByText("BUILT BY THE COMMUNITY.");
    act(() => {
      fireEvent.click(label);
      fireEvent.click(label);
      fireEvent.click(label);
    });
    return label;
  }

  it("renders the restored community hero copy", async () => {
    await renderHome();

    expect(screen.getByText("BUILT BY THE COMMUNITY.")).toBeTruthy();
    expect(screen.getByText("Tools built by thousands, ready in one search.")).toBeTruthy();
  });

  it("marks the three home category options for one-or-three-column breakpoints", async () => {
    await renderHome();

    const grid = document.querySelector(".home-v2-categories-grid");

    expect(grid?.getAttribute("data-count")).toBe("3");
    expect(grid?.getAttribute("data-layout")).toBe("1-3");
    expect(screen.getByText("Skills")).toBeTruthy();
    expect(screen.getByText("Plugins")).toBeTruthy();
    expect(screen.getByText("Builders")).toBeTruthy();
  });

  it("keeps the featured skill carousel as a duplicated scrolling track", async () => {
    convexQueryMock.mockResolvedValue([
      {
        skill: {
          _id: "skill-one",
          ownerUserId: "user-one",
          slug: "one",
          displayName: "One",
          summary: "First highlighted skill.",
          stats: { stars: 3, downloads: 12 },
        },
        ownerHandle: "openclaw",
      },
      {
        skill: {
          _id: "skill-two",
          ownerUserId: "user-two",
          slug: "two",
          displayName: "Two",
          summary: "Second highlighted skill.",
          stats: { stars: 5, downloads: 24 },
        },
        ownerHandle: "ritual",
      },
    ]);

    await renderHome();

    expect(await screen.findByText("Featured skills")).toBeTruthy();
    expect(document.querySelector(".home-v2-carousel-track")).toBeTruthy();
    expect(document.querySelectorAll(".home-v2-carousel-track .home-v2-c-card")).toHaveLength(4);
    expect(
      document.querySelector(".home-v2-carousel-track .home-v2-c-card")?.getAttribute("href"),
    ).toBe("/openclaw/one");
  });

  it("wires carousel previous and next controls to scroll the featured track", async () => {
    const scrollByMock = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollBy", {
      configurable: true,
      value: scrollByMock,
    });
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      get: () => 320,
    });
    convexQueryMock.mockResolvedValue([
      {
        skill: {
          _id: "skill-one",
          ownerUserId: "user-one",
          slug: "one",
          displayName: "One",
          summary: "First highlighted skill.",
          stats: { stars: 3, downloads: 12 },
        },
        ownerHandle: "openclaw",
      },
    ]);

    await renderHome();
    fireEvent.click(await screen.findByLabelText("Next"));
    fireEvent.click(screen.getByLabelText("Previous"));

    expect(scrollByMock).toHaveBeenNthCalledWith(1, { left: 336, behavior: "smooth" });
    expect(scrollByMock).toHaveBeenNthCalledWith(2, { left: -336, behavior: "smooth" });
  });

  it("falls back to public skill cards when no highlighted carousel cards exist", async () => {
    convexQueryMock.mockImplementation((queryName: string) => {
      if (queryName === "skills:listHighlightedPublic") return Promise.resolve([]);
      if (queryName === "skills:listPublicPageV4") {
        return Promise.resolve({
          page: [
            {
              skill: {
                _id: "skill-popular",
                ownerUserId: "user-popular",
                slug: "popular",
                displayName: "Popular",
                summary: "Popular fallback skill.",
                stats: { stars: 8, downloads: 48 },
              },
              ownerHandle: "clawhub",
            },
          ],
        });
      }
      return Promise.resolve([]);
    });

    await renderHome();

    expect(await screen.findByText("Featured skills")).toBeTruthy();
    expect(
      Array.from(document.querySelectorAll(".home-v2-carousel-track .home-v2-c-name")).map(
        (node) => node.textContent,
      ),
    ).toEqual(["Popular", "Popular"]);
    expect(document.querySelector(".home-v2-carousel-section")?.getAttribute("data-source")).toBe(
      "popular",
    );
    expect(document.querySelectorAll(".home-v2-carousel-track .home-v2-c-card")).toHaveLength(2);
    expect(convexQueryMock).toHaveBeenCalledWith(
      "skills:listPublicPageV4",
      expect.objectContaining({
        numItems: 6,
        sort: "downloads",
        dir: "desc",
        nonSuspiciousOnly: true,
      }),
    );
  });

  it("restores the Trending Now skill grid from the public downloads feed", async () => {
    const trendingEntries = Array.from({ length: 6 }, (_, index) => ({
      skill: {
        _id: `skill-trending-${index}`,
        ownerUserId: `user-trending-${index}`,
        slug: `trending-${index}`,
        displayName: `Trending Skill ${index + 1}`,
        summary: `Trending skill ${index + 1} summary.`,
        stats: { stars: 100 + index, downloads: 12_000 + index * 1000 },
      },
      ownerHandle: `creator${index + 1}`,
    }));

    convexQueryMock.mockImplementation((queryName: string) => {
      if (queryName === "skills:listHighlightedPublic") {
        return Promise.resolve([
          {
            skill: {
              _id: "skill-highlighted",
              ownerUserId: "user-highlighted",
              slug: "highlighted",
              displayName: "Highlighted",
              summary: "Highlighted skill.",
              stats: { stars: 1, downloads: 2 },
            },
            ownerHandle: "featured",
          },
        ]);
      }
      if (queryName === "skills:listPublicPageV4") {
        return Promise.resolve({ page: trendingEntries });
      }
      return Promise.resolve([]);
    });

    await renderHome();

    expect(await screen.findByText("Trending Now")).toBeTruthy();
    expect(document.querySelectorAll(".home-v2-trending-grid .home-v2-trend-card")).toHaveLength(6);
    expect(document.querySelector(".home-v2-trend-title")?.textContent).toBe("Trending Skill 1");
    expect(document.querySelector(".home-v2-trend-creator")?.textContent).toBe("by creator1");
    expect(document.querySelector(".home-v2-trend-install")?.textContent).toContain("Install");
  });

  it("starts the slot machine when the community label is triple-clicked", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-29T00:00:00Z"));
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    await renderHome();
    const label = clickHeroLabelTriple();

    expect(label.className).toContain("home-v2-hero-label-active");
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
    clickHeroLabelTriple();

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
    clickHeroLabelTriple();

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
