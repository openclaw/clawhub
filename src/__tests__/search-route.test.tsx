/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigateMock = vi.fn();
let searchMock: {
  q?: string;
  type?: "all" | "skills" | "plugins" | "creators";
} = {};
let loaderDataMock: unknown = null;
const useUnifiedSearchMock = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: { component?: unknown; validateSearch?: unknown }) => ({
    __config: config,
    useLoaderData: () => loaderDataMock,
    useSearch: () => searchMock,
  }),
  useNavigate: () => navigateMock,
}));

vi.mock("../convex/client", () => ({
  convexHttp: {
    action: vi.fn(),
  },
}));

vi.mock("../lib/useUnifiedSearch", () => ({
  useUnifiedSearch: (...args: unknown[]) => useUnifiedSearchMock(...args),
}));

vi.mock("../components/PluginListItem", () => ({
  PluginListItem: ({ item }: { item: { name: string } }) => <div>{item.name}</div>,
}));

vi.mock("../components/PublisherListItem", () => ({
  PublisherListItem: ({ publisher }: { publisher: { handle: string; displayName: string } }) => (
    <div>
      {publisher.displayName} @{publisher.handle}
    </div>
  ),
}));

vi.mock("../components/SkillListItem", () => ({
  SkillListItem: ({
    skill,
    owner,
  }: {
    skill: { slug: string };
    owner?: { official?: boolean } | null;
  }) => (
    <div>
      {skill.slug}
      {owner?.official ? <span data-testid="skill-official-badge" /> : null}
    </div>
  ),
}));

vi.mock("../components/ui/card", () => ({
  Card: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

async function loadRoute() {
  return (await import("../routes/search")).Route as unknown as {
    __config: {
      component?: ComponentType;
    };
  };
}

describe("search route", () => {
  beforeEach(() => {
    searchMock = { q: "first" };
    loaderDataMock = null;
    navigateMock.mockReset();
    useUnifiedSearchMock.mockReset();
    useUnifiedSearchMock.mockReturnValue({
      results: [],
      skillResults: [],
      pluginResults: [],
      creatorResults: [],
      skillCount: 0,
      pluginCount: 0,
      creatorCount: 0,
      skillHasMore: false,
      pluginHasMore: false,
      creatorHasMore: false,
      isSearching: false,
    });
  });

  it("keeps the input synced with query param changes while mounted", async () => {
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;
    const rendered = render(<Component />);

    const input = screen.getByPlaceholderText(
      "Search skills, plugins, and creators...",
    ) as HTMLInputElement;
    expect(input.value).toBe("first");

    fireEvent.change(input, { target: { value: "draft" } });
    expect(input.value).toBe("draft");

    searchMock = { q: "second" };
    rendered.rerender(<Component />);

    expect(
      (screen.getByPlaceholderText("Search skills, plugins, and creators...") as HTMLInputElement)
        .value,
    ).toBe("second");
  });

  it("does not render a public users search tab", async () => {
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.queryByRole("button", { name: /users/i })).toBeNull();
  });

  it("uses result skeletons instead of a boxed searching message", async () => {
    useUnifiedSearchMock.mockReturnValue({
      results: [],
      skillResults: [],
      pluginResults: [],
      creatorResults: [],
      skillCount: 0,
      pluginCount: 0,
      creatorCount: 0,
      isSearching: true,
    });
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.getByRole("status", { name: "Loading results" })).toBeTruthy();
    expect(screen.queryByText("Searching...")).toBeNull();
  });

  it("does not render count chips in active search tabs", async () => {
    useUnifiedSearchMock.mockReturnValue({
      results: [],
      skillResults: [],
      pluginResults: [{ type: "plugin", plugin: { name: "github-plugin" } }],
      creatorResults: [],
      skillCount: 0,
      pluginCount: 3,
      creatorCount: 0,
      skillHasMore: false,
      pluginHasMore: false,
      creatorHasMore: false,
      isSearching: false,
    });
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.getByRole("button", { name: "All" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Skills" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Plugins" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Creators" })).toBeTruthy();
    expect(screen.queryByText("0")).toBeNull();
    expect(screen.queryByText("3")).toBeNull();
  });

  it("clears the active search query from the input", async () => {
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));

    expect(navigateMock).toHaveBeenCalledWith({
      to: "/search",
      search: { q: undefined, type: undefined },
      replace: true,
    });
  });

  it("can request more results from global search", async () => {
    searchMock = { q: "weather", type: "skills" };
    const skills = Array.from({ length: 25 }, (_, index) => ({
      type: "skill",
      skill: {
        _id: `skill-${index}`,
        slug: `weather-${index}`,
        displayName: `Weather ${index}`,
        ownerUserId: "users:1",
        stats: { downloads: 0, stars: 0 },
        updatedAt: 1,
        createdAt: 1,
      },
      ownerHandle: "clawhub",
      score: 1,
    }));
    useUnifiedSearchMock.mockReturnValue({
      results: skills,
      skillResults: skills,
      pluginResults: [],
      creatorResults: [],
      skillCount: 25,
      pluginCount: 0,
      creatorCount: 0,
      skillHasMore: true,
      pluginHasMore: false,
      creatorHasMore: false,
      isSearching: false,
    });
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(useUnifiedSearchMock).toHaveBeenCalledWith("weather", "all", {
      limits: { skills: 25, plugins: 25, creators: 25 },
    });

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    expect(useUnifiedSearchMock).toHaveBeenCalledWith("weather", "all", {
      limits: { skills: 50, plugins: 50, creators: 50 },
    });
  });

  it("keeps inactive tab labels visible while rendering the active tab", async () => {
    searchMock = { q: "weather", type: "skills" };
    useUnifiedSearchMock.mockReturnValue({
      results: [
        {
          type: "skill",
          skill: {
            _id: "skill-weather",
            slug: "weather",
            displayName: "Weather",
            ownerUserId: "users:1",
            stats: { downloads: 0, stars: 0 },
            updatedAt: 1,
            createdAt: 1,
          },
          ownerHandle: "clawhub",
          score: 1,
        },
        { type: "plugin", plugin: { name: "weather-plugin" } },
      ],
      skillResults: [
        {
          type: "skill",
          skill: {
            _id: "skill-weather",
            slug: "weather",
            displayName: "Weather",
            ownerUserId: "users:1",
            stats: { downloads: 0, stars: 0 },
            updatedAt: 1,
            createdAt: 1,
          },
          ownerHandle: "clawhub",
          score: 1,
        },
      ],
      pluginResults: [{ type: "plugin", plugin: { name: "weather-plugin" } }],
      creatorResults: [
        {
          type: "creator",
          creator: {
            _id: "publishers:weather",
            _creationTime: 1,
            kind: "org",
            handle: "weather",
            displayName: "Weather Creator",
            image: undefined,
            bio: "Weather creator",
            linkedUserId: undefined,
            official: true,
            stats: { skills: 0, packages: 0, installs: 0, downloads: 0, stars: 0 },
            publishedItems: [],
          },
        },
      ],
      skillCount: 1,
      pluginCount: 1,
      creatorCount: 1,
      skillHasMore: false,
      pluginHasMore: false,
      creatorHasMore: false,
      isSearching: false,
    });
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.getByRole("button", { name: "All" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Plugins" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Creators" })).toBeTruthy();
    expect(screen.getByText("weather")).toBeTruthy();
    expect(screen.queryByText("weather-plugin")).toBeNull();
    expect(screen.queryByText("Weather Creator @weather")).toBeNull();
  });

  it("passes official owner metadata to skill search rows", async () => {
    searchMock = { q: "weather", type: "skills" };
    const skill = {
      type: "skill",
      skill: {
        _id: "skill-weather",
        slug: "weather",
        displayName: "Weather",
        ownerUserId: "users:1",
        stats: { downloads: 0, stars: 0 },
        updatedAt: 1,
        createdAt: 1,
      },
      ownerHandle: "openclaw",
      owner: { official: true },
      score: 1,
    };
    useUnifiedSearchMock.mockReturnValue({
      results: [skill],
      skillResults: [skill],
      pluginResults: [],
      creatorResults: [],
      skillCount: 1,
      pluginCount: 0,
      creatorCount: 0,
      skillHasMore: false,
      pluginHasMore: false,
      creatorHasMore: false,
      isSearching: false,
    });
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.getByTestId("skill-official-badge")).toBeTruthy();
  });

  it("does not render partial count labels when more results are available", async () => {
    useUnifiedSearchMock.mockReturnValue({
      results: [],
      skillResults: [],
      pluginResults: [{ type: "plugin", plugin: { name: "github-plugin" } }],
      creatorResults: [],
      skillCount: 0,
      pluginCount: 25,
      creatorCount: 0,
      skillHasMore: false,
      pluginHasMore: true,
      creatorHasMore: false,
      isSearching: false,
    });
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.getByRole("button", { name: "All" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Plugins" })).toBeTruthy();
    expect(screen.queryByText("25+")).toBeNull();
  });

  it("does not show load more only because the current page is full", async () => {
    searchMock = { q: "weather", type: "skills" };
    useUnifiedSearchMock.mockReturnValue({
      results: Array.from({ length: 25 }, (_, index) => ({
        type: "skill",
        skill: {
          _id: `skill-${index}`,
          slug: `weather-${index}`,
          displayName: `Weather ${index}`,
          ownerUserId: "users:1",
          stats: { downloads: 0, stars: 0 },
          updatedAt: 1,
          createdAt: 1,
        },
        ownerHandle: "clawhub",
        score: 1,
      })),
      skillResults: [],
      pluginResults: [],
      creatorResults: [],
      skillCount: 25,
      pluginCount: 0,
      creatorCount: 0,
      skillHasMore: false,
      pluginHasMore: false,
      creatorHasMore: false,
      isSearching: false,
    });
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("links to skills browse when search has no matches", async () => {
    searchMock = { q: "zzzz", type: "skills" };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.getByText('No matches for "zzzz"')).toBeTruthy();
    expect(screen.getByRole("link", { name: "Show all skills" }).getAttribute("href")).toBe(
      "/skills",
    );
    expect(screen.queryByRole("link", { name: "Show all plugins" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Show all creators" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Search all types" })).toBeNull();
  });

  it("links to creators browse when creator search has no matches", async () => {
    searchMock = { q: "zzzz", type: "creators" };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.getByText('No matches for "zzzz"')).toBeTruthy();
    expect(screen.getByRole("link", { name: "Show all creators" }).getAttribute("href")).toBe(
      "/creators",
    );
    expect(screen.queryByRole("link", { name: "Show all skills" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Show all plugins" })).toBeNull();
  });

  it("offers all-types recovery when the active type is empty but another type matched", async () => {
    searchMock = { q: "weather", type: "skills" };
    useUnifiedSearchMock.mockReturnValue({
      results: [{ type: "plugin", plugin: { name: "weather-plugin" } }],
      skillResults: [],
      pluginResults: [{ type: "plugin", plugin: { name: "weather-plugin" } }],
      creatorResults: [],
      skillCount: 0,
      pluginCount: 1,
      creatorCount: 0,
      skillHasMore: false,
      pluginHasMore: false,
      creatorHasMore: false,
      isSearching: false,
    });
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    fireEvent.click(screen.getByRole("button", { name: "Search all types" }));
    expect(navigateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/search",
        replace: true,
        search: expect.objectContaining({ type: undefined }),
      }),
    );
  });

  it("passes only result limits to unified search", async () => {
    searchMock = { q: "hello" };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(useUnifiedSearchMock).toHaveBeenLastCalledWith("hello", "all", {
      limits: { skills: 25, plugins: 25, creators: 25 },
    });
  });

  it("passes loader-backed skill results to unified search", async () => {
    searchMock = { q: "japanese-reading-grader" };
    loaderDataMock = {
      query: "japanese-reading-grader",
      activeType: "all",
      limits: { skills: 25, plugins: 25, creators: 25 },
      skillResults: [
        {
          type: "skill",
          skill: {
            _id: "skill-japanese-reading-grader",
            slug: "japanese-reading-grader",
            displayName: "Japanese Reading Grader",
            ownerUserId: "users:1",
            stats: { downloads: 0, stars: 0 },
            updatedAt: 1,
            createdAt: 1,
          },
          ownerHandle: "bianmaxingkong",
          score: 1,
        },
      ],
      pluginResults: [],
      creatorResults: [],
      skillHasMore: false,
      pluginHasMore: false,
      creatorHasMore: false,
    };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(useUnifiedSearchMock).toHaveBeenLastCalledWith("japanese-reading-grader", "all", {
      initialData: loaderDataMock,
      limits: { skills: 25, plugins: 25, creators: 25 },
    });
  });

  it("renders creators as their own all-results section and active tab", async () => {
    searchMock = { q: "weather" };
    useUnifiedSearchMock.mockReturnValue({
      results: [
        {
          type: "creator",
          creator: {
            _id: "publishers:weather",
            _creationTime: 1,
            kind: "org",
            handle: "weather",
            displayName: "Weather Creator",
            image: undefined,
            bio: "Weather creator",
            linkedUserId: undefined,
            official: true,
            stats: { skills: 0, packages: 0, installs: 0, downloads: 0, stars: 0 },
            publishedItems: [],
          },
        },
      ],
      skillResults: [],
      pluginResults: [],
      creatorResults: [
        {
          type: "creator",
          creator: {
            _id: "publishers:weather",
            _creationTime: 1,
            kind: "org",
            handle: "weather",
            displayName: "Weather Creator",
            image: undefined,
            bio: "Weather creator",
            linkedUserId: undefined,
            official: true,
            stats: { skills: 0, packages: 0, installs: 0, downloads: 0, stars: 0 },
            publishedItems: [],
          },
        },
      ],
      skillCount: 0,
      pluginCount: 0,
      creatorCount: 1,
      skillHasMore: false,
      pluginHasMore: false,
      creatorHasMore: false,
      isSearching: false,
    });
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    const rendered = render(<Component />);

    expect(screen.getByRole("button", { name: "Creators" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Creators" })).toBeTruthy();
    expect(screen.getByText("Weather Creator @weather")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Creators" }));
    expect(navigateMock).toHaveBeenCalledWith({
      to: "/search",
      search: { q: "weather", type: "creators" },
      replace: true,
    });

    searchMock = { q: "weather", type: "creators" };
    rendered.rerender(<Component />);

    expect(screen.getByText("Weather Creator @weather")).toBeTruthy();
  });

  it("does not render a warning-filter chip on the plugins tab", async () => {
    searchMock = { q: "hello", type: "plugins" };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.queryByRole("button", { name: /warnings/i })).toBeNull();
  });
});
