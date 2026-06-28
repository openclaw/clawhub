/* @vitest-environment jsdom */
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Route as SkillsRoute, SkillsIndex } from "../routes/skills/index";
import {
  convexHttpMock,
  convexReactMocks,
  resetConvexReactMocks,
  setupDefaultConvexReactMocks,
} from "./helpers/convexReactMocks";

const navigateMock = vi.fn();
let searchMock: Record<string, unknown> = {};
let loaderDataMock: unknown = null;

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: { component: unknown; validateSearch: unknown }) => ({
    __config: config,
    useLoaderData: () => loaderDataMock,
    useNavigate: () => navigateMock,
    useSearch: () => searchMock,
  }),
  useRouterState: (options: { select: (state: unknown) => unknown }) =>
    options.select({ location: { searchStr: "" } }),
  redirect: (options: unknown) => ({ redirect: options }),
  Link: (props: { children: ReactNode }) => <a href="/">{props.children}</a>,
}));

vi.mock("convex/react", () => ({
  ConvexReactClient: class {},
  useAction: (...args: unknown[]) => convexReactMocks.useAction(...args),
  useQuery: (...args: unknown[]) => convexReactMocks.useQuery(...args),
}));

vi.mock("../../src/convex/client", () => ({
  convexHttp: {
    action: (...args: unknown[]) => convexHttpMock.action(...args),
    query: (...args: unknown[]) => convexHttpMock.query(...args),
  },
}));

describe("SkillsIndex", () => {
  beforeEach(() => {
    resetConvexReactMocks();
    navigateMock.mockReset();
    searchMock = {};
    loaderDataMock = null;
    setupDefaultConvexReactMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("maps topic search params", () => {
    const validateSearch = (
      SkillsRoute as unknown as {
        __config: {
          validateSearch: (search: Record<string, unknown>) => Record<string, unknown>;
        };
      }
    ).__config.validateSearch;

    expect(validateSearch({ topic: "github" })).toEqual(
      expect.objectContaining({ topic: "github" }),
    );
  });

  it("maps legacy category URLs before browsing", () => {
    const validateSearch = (
      SkillsRoute as unknown as {
        __config: {
          validateSearch: (search: Record<string, unknown>) => Record<string, unknown>;
        };
      }
    ).__config.validateSearch;

    expect(validateSearch({ category: "workflows" })).toEqual(
      expect.objectContaining({ category: "automation" }),
    );
    expect(validateSearch({ category: "mcp-tools" })).toEqual(
      expect.objectContaining({ category: "integrations" }),
    );
    expect(validateSearch({ category: "unknown" })).toEqual(
      expect.objectContaining({ category: undefined }),
    );
  });

  it("requests the first skills page", async () => {
    render(<SkillsIndex />);
    await act(async () => {});

    const args = getLastListPageArgs();
    expect(args).toEqual(
      expect.objectContaining({
        dir: "desc",
        highlightedOnly: false,
        cursor: undefined,
        numItems: 25,
      }),
    );
    expect(args).not.toHaveProperty("sort");
    expect(args).not.toHaveProperty("officialFirst");
    expect(screen.getByRole("radio", { name: "All" }).getAttribute("aria-checked")).toBe("true");
    const sortOptions = Array.from(
      screen.getByRole("radiogroup", { name: "Skill view" }).querySelectorAll('[role="radio"]'),
    ).map((option) => option.textContent);
    expect(sortOptions).toEqual(["All", "Trending", "Top", "Most starred", "Featured"]);
  });

  it("offers Top without exposing downloads as a browse view", async () => {
    render(<SkillsIndex />);
    await act(async () => {});

    expect(screen.getByRole("radio", { name: "Top" })).toBeTruthy();
    expect(screen.queryByRole("radio", { name: "Most downloaded" })).toBeNull();
  });

  it("separates primary views from secondary sort options", async () => {
    render(<SkillsIndex />);
    await act(async () => {});

    const views = Array.from(
      screen.getByRole("radiogroup", { name: "Skill view" }).querySelectorAll('[role="radio"]'),
    ).map((option) => option.textContent);
    fireEvent.click(screen.getByRole("combobox", { name: "Sort" }));
    const sortOptions = screen.getAllByRole("option").map((option) => option.textContent);

    expect(views).toEqual(["All", "Trending", "Top", "Most starred", "Featured"]);
    expect(sortOptions).toEqual(["Recently updated", "Newest", "Name"]);
  });

  it("preserves a secondary sort when switching to Featured", async () => {
    searchMock = { sort: "updated", dir: "desc" };
    render(<SkillsIndex />);

    fireEvent.click(screen.getByRole("radio", { name: "Featured" }));

    const lastCall = getLastNavigateCall();
    expect(lastCall.search({ sort: "updated", dir: "desc" })).toEqual({
      sort: "updated",
      dir: "desc",
      featured: true,
      highlighted: undefined,
    });
  });

  it("renders an empty state when no skills are returned", async () => {
    render(<SkillsIndex />);
    await act(async () => {});
    expect(screen.getByText("No skills found")).toBeTruthy();
    expect(screen.queryByText(/\d+ loaded/)).toBeNull();
  });

  it("renders the total skills count in the unfiltered page title", async () => {
    convexReactMocks.useQuery.mockReturnValue(70_300);

    render(<SkillsIndex />);
    await act(async () => {});

    expect(screen.getByRole("heading", { name: "Skills 70.3K" })).toBeTruthy();
  });

  it("hides the total skills count when filters are active", async () => {
    searchMock = { category: "development" };
    convexReactMocks.useQuery.mockReturnValue(70_300);

    render(<SkillsIndex />);
    await act(async () => {});

    expect(screen.getByRole("heading", { name: "Skills" })).toBeTruthy();
    expect(screen.queryByText("70.3K")).toBeNull();
  });

  it("clears the skill search from the search field", async () => {
    searchMock = { q: "agent", sort: "relevance", category: "development" };

    render(<SkillsIndex />);
    await act(async () => {});

    fireEvent.click(screen.getByRole("button", { name: "Close search" }));

    expect(navigateMock).toHaveBeenCalled();
    const lastCall = navigateMock.mock.calls.at(-1)?.[0] as {
      search: (prev: Record<string, unknown>) => Record<string, unknown>;
      replace?: boolean;
    };
    expect(
      lastCall.search({
        q: "agent",
        sort: "relevance",
        category: "development",
      }),
    ).toEqual({
      q: undefined,
      sort: undefined,
      category: "development",
    });
    expect(lastCall.replace).toBe(true);
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
  });

  it("keeps search collapsed until slash opens and focuses it", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });

    render(<SkillsIndex />);
    await act(async () => {});

    const input = screen.getByPlaceholderText("Search skills...");
    const panel = input.closest(".browse-search-panel");
    expect(panel?.hasAttribute("hidden")).toBe(true);

    fireEvent.keyDown(window, { key: "/" });

    expect(panel?.hasAttribute("hidden")).toBe(false);
    expect(document.activeElement).toBe(input);
  });

  it("does not render a browse count when more pages exist", async () => {
    convexHttpMock.query.mockResolvedValue({
      page: [makeListResult("skill-0", "Skill 0")],
      hasMore: true,
      nextCursor: "cursor-1",
    });

    render(<SkillsIndex />);
    await act(async () => {});

    expect(screen.getByText("Skill 0")).toBeTruthy();
    expect(screen.queryByText(/\d+ loaded/)).toBeNull();
  });

  it("keeps browse counts hidden after loading another page", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    convexHttpMock.query
      .mockResolvedValueOnce({
        page: [makeListResult("skill-0", "Skill 0")],
        hasMore: true,
        nextCursor: "cursor-1",
      })
      .mockResolvedValueOnce({
        page: [makeListResult("skill-1", "Skill 1")],
        hasMore: false,
        nextCursor: null,
      });

    render(<SkillsIndex />);
    await act(async () => {});

    expect(screen.getByText("Skill 0")).toBeTruthy();
    expect(screen.queryByText(/\d+ loaded/)).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    });

    expect(screen.getByText("Skill 1")).toBeTruthy();
    expect(screen.queryByText(/\d+ loaded/)).toBeNull();
  });

  it("does not render the publish CTA on the skills browse page", async () => {
    render(<SkillsIndex />);
    await act(async () => {});

    expect(screen.queryByRole("link", { name: "Publish" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
  });

  it("shows loading state before fetch completes", async () => {
    // Never resolve the query to keep the component in loading state
    convexHttpMock.query.mockReturnValue(new Promise(() => {}));
    render(<SkillsIndex />);
    await act(async () => {});
    // Results area shows skeletons while loading, without count copy.
    expect(screen.queryByText(/\d+ loaded/)).toBeNull();
    expect(screen.getByRole("status", { name: "Loading results" })).toBeTruthy();
    expect(screen.queryByText("No skills found")).toBeNull();
  });

  it("uses grid as the canonical browse view URL value", async () => {
    render(<SkillsIndex />);

    fireEvent.click(screen.getByRole("button", { name: "Grid" }));

    const lastCall = navigateMock.mock.calls.at(-1)?.[0] as {
      replace?: boolean;
      search: (prev: Record<string, unknown>) => Record<string, unknown>;
    };
    expect(lastCall.replace).toBe(true);
    expect(lastCall.search({})).toEqual({ view: "grid" });
  });

  it("renders the view toggle above the skills search input", async () => {
    render(<SkillsIndex />);
    await act(async () => {});

    const listButton = screen.getByRole("button", { name: "List" });
    const searchInput = screen.getByPlaceholderText("Search skills...");

    expect(listButton.closest(".browse-controls")).not.toBeNull();
    expect(
      Boolean(listButton.compareDocumentPosition(searchInput) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true);
  });

  it("keeps legacy cards URLs compatible with the grid view", async () => {
    searchMock = { view: "cards" };
    render(<SkillsIndex />);

    const gridButton = screen.getByRole("button", { name: "Grid" });
    expect(gridButton.className).toContain("is-active");

    fireEvent.click(screen.getByRole("button", { name: "List" }));

    const lastCall = navigateMock.mock.calls.at(-1)?.[0] as {
      replace?: boolean;
      search: (prev: Record<string, unknown>) => Record<string, unknown>;
    };
    expect(lastCall.replace).toBe(true);
    expect(lastCall.search({ view: "cards" })).toEqual({ view: undefined });
  });

  it("shows empty state immediately when search returns no results", async () => {
    searchMock = { q: "nonexistent-skill-xyz" };
    const actionFn = vi.fn().mockResolvedValue([]);
    convexReactMocks.useAction.mockReturnValue(actionFn);
    vi.useFakeTimers();

    render(<SkillsIndex />);
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    // Should show empty state, not loading
    expect(screen.getByText("No skills found")).toBeTruthy();
    expect(screen.queryByText(/\d+ loaded/)).toBeNull();
    expect(screen.queryByText(/Loading skills/)).toBeNull();
  });

  it("renders URL-query skill search results from loader data before client refresh", async () => {
    searchMock = { q: "japanese-conversation-scorer" };
    loaderDataMock = {
      key: "japanese-conversation-scorer::0::::",
      limit: 25,
      results: [
        {
          skill: makeListResult("japanese-conversation-scorer", "Japanese Conversation Scorer")
            .skill,
          version: null,
          ownerHandle: "bianmaxingkong",
          owner: null,
          score: 1,
        },
      ],
    };
    convexReactMocks.useAction.mockReturnValue(vi.fn(() => new Promise(() => {})));

    render(<SkillsIndex />);

    expect(screen.getByText("Japanese Conversation Scorer")).toBeTruthy();
    expect(screen.queryByText("No skills found")).toBeNull();
  });

  it("skips list fetch and calls search when query is set", async () => {
    searchMock = { q: "remind" };
    const actionFn = vi.fn().mockResolvedValue([]);
    convexReactMocks.useAction.mockReturnValue(actionFn);
    vi.useFakeTimers();

    render(<SkillsIndex />);

    // convexHttp.query should NOT be called for list when searching
    const listCalls = convexHttpMock.query.mock.calls.filter((call: unknown[]) => {
      const args = call[1] as Record<string, unknown> | undefined;
      return args && "numItems" in args;
    });
    expect(listCalls).toHaveLength(0);

    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(actionFn).toHaveBeenCalledWith({
      query: "remind",
      highlightedOnly: false,
      limit: 25,
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(actionFn).toHaveBeenCalledWith({
      query: "remind",
      highlightedOnly: false,
      limit: 25,
    });
  });

  it("passes the selected category to backend skill search", async () => {
    searchMock = { q: "helper", category: "development" };
    const actionFn = vi.fn().mockResolvedValue([]);
    convexReactMocks.useAction.mockReturnValue(actionFn);
    vi.useFakeTimers();

    render(<SkillsIndex />);
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(actionFn).toHaveBeenCalledWith({
      query: "helper",
      highlightedOnly: false,
      categorySlug: "development",
      limit: 25,
    });
  });

  it("keeps All as the visible default search view", async () => {
    searchMock = { q: "notion" };
    const actionFn = vi.fn().mockResolvedValue([]);
    convexReactMocks.useAction.mockReturnValue(actionFn);
    vi.useFakeTimers();

    render(<SkillsIndex />);

    expect(screen.getByRole("radio", { name: "All" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByRole("radio", { name: "Relevance" })).toBeNull();
    const sortOptions = Array.from(
      screen.getByRole("radiogroup", { name: "Skill view" }).querySelectorAll('[role="radio"]'),
    ).map((option) => option.textContent);
    expect(sortOptions[0]).toBe("All");
  });

  it("keeps recommended sort stable while typing a search", async () => {
    vi.useFakeTimers();

    render(<SkillsIndex />);

    const input = screen.getByPlaceholderText("Search skills...");
    fireEvent.change(input, { target: { value: "agent" } });

    expect(screen.getByRole("radio", { name: "All" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByRole("radio", { name: "Relevance" })).toBeNull();
  });

  it("keeps the skills sort option list stable while typing a search", async () => {
    vi.useFakeTimers();

    render(<SkillsIndex />);

    const beforeTyping = Array.from(
      screen.getByRole("radiogroup", { name: "Skill view" }).querySelectorAll('[role="radio"]'),
    ).map((option) => option.textContent);
    const input = screen.getByPlaceholderText("Search skills...");
    fireEvent.change(input, { target: { value: "agent" } });
    const whileTyping = Array.from(
      screen.getByRole("radiogroup", { name: "Skill view" }).querySelectorAll('[role="radio"]'),
    ).map((option) => option.textContent);

    expect(whileTyping).toEqual(beforeTyping);
    expect(screen.getByRole("radio", { name: "Featured" })).toBeTruthy();
  });

  it("does not treat category keywords typed in search as category filters", async () => {
    const actionFn = vi.fn().mockResolvedValue([]);
    convexReactMocks.useAction.mockReturnValue(actionFn);
    vi.useFakeTimers();

    render(<SkillsIndex />);

    const input = screen.getByPlaceholderText("Search skills...");
    await act(async () => {
      fireEvent.change(input, { target: { value: "test" } });
      await vi.runAllTimersAsync();
    });

    fireEvent.click(screen.getByRole("combobox", { name: "Category" }));
    expect(screen.getByRole("radio", { name: "All categories" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(screen.getByRole("radio", { name: "Development" }).getAttribute("aria-checked")).toBe(
      "false",
    );
    expect(actionFn).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "test",
      }),
    );
  });

  it("switches implicit recommended sorting back to relevance when entering search", async () => {
    searchMock = { sort: "recommended" };
    vi.useFakeTimers();

    render(<SkillsIndex />);

    const input = screen.getByPlaceholderText("Search skills...");
    await act(async () => {
      fireEvent.change(input, { target: { value: "cli-design-framework" } });
      await vi.runAllTimersAsync();
    });

    expect(navigateMock).toHaveBeenCalled();
    const lastCall = navigateMock.mock.calls.at(-1)?.[0] as {
      replace?: boolean;
      search: (prev: Record<string, unknown>) => Record<string, unknown>;
    };
    expect(lastCall.replace).toBe(true);
    expect(lastCall.search({ sort: "recommended" })).toEqual({
      q: "cli-design-framework",
      sort: undefined,
      dir: undefined,
    });
  });

  it("preserves explicitly user-set downloads sort when entering search", async () => {
    searchMock = { sort: "downloads", dir: "desc" };
    vi.useFakeTimers();

    render(<SkillsIndex />);

    const input = screen.getByPlaceholderText("Search skills...");
    await act(async () => {
      fireEvent.change(input, { target: { value: "cli-design-framework" } });
      await vi.runAllTimersAsync();
    });

    expect(navigateMock).toHaveBeenCalled();
    const lastCall = navigateMock.mock.calls.at(-1)?.[0] as {
      replace?: boolean;
      search: (prev: Record<string, unknown>) => Record<string, unknown>;
    };
    expect(lastCall.replace).toBe(true);
    expect(lastCall.search({ sort: "downloads", dir: "desc" })).toEqual({
      q: "cli-design-framework",
      sort: "downloads",
      dir: "desc",
    });
  });

  it("clears stale recommended sort aliases when entering search", async () => {
    searchMock = { sort: "default", dir: "asc" };
    vi.useFakeTimers();

    render(<SkillsIndex />);

    const input = screen.getByPlaceholderText("Search skills...");
    await act(async () => {
      fireEvent.change(input, { target: { value: "cli-design-framework" } });
      await vi.runAllTimersAsync();
    });

    const lastCall = getLastNavigateCall();
    expect(lastCall.replace).toBe(true);
    expect(lastCall.search({ sort: "default", dir: "asc" })).toEqual({
      q: "cli-design-framework",
      sort: undefined,
      dir: undefined,
    });
  });

  it("does not reuse a stale recommended direction when choosing an explicit browse sort", async () => {
    searchMock = { sort: "recommended", dir: "asc" };
    render(<SkillsIndex />);

    fireEvent.click(screen.getByRole("radio", { name: "Top" }));

    const lastCall = getLastNavigateCall();
    expect(lastCall.replace).toBe(true);
    expect(lastCall.search({ sort: "recommended", dir: "asc" })).toEqual({
      sort: "downloads",
      dir: "desc",
    });
  });

  it("does not reuse a stale relevance direction when choosing an explicit search sort", async () => {
    searchMock = { q: "notion", sort: "relevance", dir: "asc" };
    render(<SkillsIndex />);

    fireEvent.click(screen.getByRole("radio", { name: "Top" }));

    const lastCall = getLastNavigateCall();
    expect(lastCall.replace).toBe(true);
    expect(lastCall.search({ q: "notion", sort: "relevance", dir: "asc" })).toEqual({
      q: "notion",
      sort: "downloads",
      dir: "desc",
    });
  });

  it("clears direction when returning to the All view", async () => {
    searchMock = { sort: "downloads", dir: "asc" };
    render(<SkillsIndex />);

    fireEvent.click(screen.getByRole("radio", { name: "All" }));

    const lastCall = getLastNavigateCall();
    expect(lastCall.replace).toBe(true);
    expect(lastCall.search({ sort: "downloads", dir: "asc" })).toEqual({
      sort: undefined,
      dir: undefined,
    });
  });

  it("loads more results when search pagination is requested", async () => {
    searchMock = { q: "remind" };
    vi.stubGlobal("IntersectionObserver", undefined);
    const actionFn = vi
      .fn()
      .mockResolvedValueOnce(makeSearchResults(25))
      .mockResolvedValueOnce(makeSearchResults(50));
    convexReactMocks.useAction.mockReturnValue(actionFn);
    vi.useFakeTimers();

    render(<SkillsIndex />);
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(screen.queryByText(/\d+ loaded/)).toBeNull();

    const loadMoreButton = screen.getByRole("button", { name: "Load more" });
    await act(async () => {
      fireEvent.click(loadMoreButton);
      await vi.runAllTimersAsync();
    });

    expect(actionFn).toHaveBeenLastCalledWith({
      query: "remind",
      highlightedOnly: false,
      limit: 50,
    });
    expect(screen.queryByText(/\d+ loaded/)).toBeNull();
  });

  it("sorts search results by stars and breaks ties by updatedAt", async () => {
    searchMock = { q: "remind", sort: "stars", dir: "desc" };
    const actionFn = vi
      .fn()
      .mockResolvedValue([
        makeSearchEntry({ slug: "skill-a", displayName: "Skill A", stars: 5, updatedAt: 100 }),
        makeSearchEntry({ slug: "skill-b", displayName: "Skill B", stars: 5, updatedAt: 200 }),
        makeSearchEntry({ slug: "skill-c", displayName: "Skill C", stars: 4, updatedAt: 999 }),
      ]);
    convexReactMocks.useAction.mockReturnValue(actionFn);
    vi.useFakeTimers();

    render(<SkillsIndex />);
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const links = screen.getAllByRole("link").filter((link) => link.textContent?.includes("Skill"));
    expect(links[0]?.textContent).toContain("Skill B");
    expect(links[1]?.textContent).toContain("Skill A");
    expect(links[2]?.textContent).toContain("Skill C");
  });

  it("uses relevance as default sort when searching", async () => {
    searchMock = { q: "notion" };
    const actionFn = vi
      .fn()
      .mockResolvedValue([
        makeSearchResult("newer-low-score", "Newer Low Score", 0.1, 2000),
        makeSearchResult("older-high-score", "Older High Score", 0.9, 1000),
      ]);
    convexReactMocks.useAction.mockReturnValue(actionFn);
    vi.useFakeTimers();

    render(<SkillsIndex />);
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const titles = Array.from(document.querySelectorAll(".skill-list-item-name")).map(
      (node) => node.textContent,
    );

    expect(titles[0]).toBe("Older High Score");
    expect(titles[1]).toBe("Newer Low Score");
  });

  it("includes results explicitly assigned to the selected category", async () => {
    searchMock = { category: "development" };
    convexHttpMock.query.mockResolvedValue({
      page: [
        makeListResult("web3-dev", "Blockscout for Web3 Dev", {
          categories: ["development"],
          summary:
            "Build web3 applications that need blockchain data via the Blockscout PRO API over HTTP.",
        }),
        makeListResult("developer-utils", "Developer Utils", {
          categories: ["development"],
          summary: "Utilities for build and debug workflows.",
        }),
      ],
      hasMore: false,
      nextCursor: null,
    });

    render(<SkillsIndex />);
    await act(async () => {});

    const args = getLastListPageArgs();
    expect(args).toEqual(
      expect.objectContaining({
        categorySlug: "development",
        officialFirst: true,
        categoryKeywords: expect.arrayContaining(["developer"]),
        excludeCategoryKeywords: undefined,
      }),
    );
    expect(screen.getByText("Blockscout for Web3 Dev")).toBeTruthy();
    expect(screen.getByText("Developer Utils")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
    expect(screen.queryByText(/\d+ loaded/)).toBeNull();
  });

  it("passes author topics to browse filtering and shows the active topic chip", async () => {
    searchMock = { topic: "google-calendar" };
    convexHttpMock.query.mockResolvedValue({
      page: [
        makeListResult("calendar-helper", "Calendar Helper", {
          topics: ["google-calendar", "productivity"],
        }),
      ],
      hasMore: false,
      nextCursor: null,
    });

    render(<SkillsIndex />);
    await act(async () => {});

    expect(getLastListPageArgs()).toEqual(
      expect.objectContaining({
        topic: "google-calendar",
      }),
    );
    const topicChip = screen.getByRole("button", { name: "Clear topic google-calendar" });
    expect(topicChip).toBeTruthy();
    expect(screen.queryByRole("radio", { name: "All topics" })).toBeNull();
  });

  it("shows the top five topics beneath the selected category and filters by chip", async () => {
    searchMock = { category: "development" };
    convexReactMocks.useQuery.mockImplementation((_reference, args) => {
      if (
        args &&
        typeof args === "object" &&
        "kind" in args &&
        (args as { kind?: string }).kind === "skill"
      ) {
        return ["typescript", "docker", "github", "debugging", "coding"];
      }
      return null;
    });

    render(<SkillsIndex />);
    await act(async () => {});

    const category = screen.getByRole("combobox", { name: "Category" });
    const firstTopic = screen.getByRole("button", { name: "#typescript" });
    expect(
      Boolean(category.compareDocumentPosition(firstTopic) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true);
    expect(screen.getAllByRole("button", { name: /^#/ })).toHaveLength(5);

    fireEvent.click(screen.getByRole("button", { name: "#docker" }));

    const lastCall = navigateMock.mock.calls.at(-1)?.[0] as {
      search: (prev: Record<string, unknown>) => Record<string, unknown>;
      replace?: boolean;
    };
    expect(lastCall.search({ category: "development" })).toEqual({
      category: "development",
      topic: "docker",
      featured: undefined,
      highlighted: undefined,
    });
    expect(lastCall.replace).toBe(true);
  });

  it("clears the active category topic when its clear button is pressed", async () => {
    searchMock = { category: "development", topic: "docker" };
    convexReactMocks.useQuery.mockImplementation((_reference, args) => {
      if (
        args &&
        typeof args === "object" &&
        "kind" in args &&
        (args as { kind?: string }).kind === "skill"
      ) {
        return ["docker"];
      }
      return null;
    });

    render(<SkillsIndex />);
    await act(async () => {});

    fireEvent.click(screen.getByRole("button", { name: "Clear topic docker" }));

    const lastCall = navigateMock.mock.calls.at(-1)?.[0] as {
      search: (prev: Record<string, unknown>) => Record<string, unknown>;
    };
    expect(lastCall.search({ category: "development", topic: "docker" })).toEqual({
      category: "development",
      featured: undefined,
      highlighted: undefined,
    });
  });

  it("shows the active topic chip when topic filtering returns no results", async () => {
    searchMock = { topic: "google-calendar" };
    convexHttpMock.query.mockResolvedValue({
      page: [],
      hasMore: false,
      nextCursor: null,
    });

    render(<SkillsIndex />);
    await act(async () => {});

    expect(screen.getByRole("button", { name: "Clear topic google-calendar" })).toBeTruthy();
    expect(screen.queryByRole("radio", { name: "All topics" })).toBeNull();
  });

  it("preserves backend official-first ordering on category pages", async () => {
    searchMock = { category: "development" };
    convexHttpMock.query.mockResolvedValue({
      page: [
        makeListResult("official-dev", "Official Dev", {
          categories: ["development"],
          official: true,
        }),
        makeListResult("community-dev", "Community Dev", {
          categories: ["development"],
        }),
      ],
      hasMore: false,
      nextCursor: null,
    });

    render(<SkillsIndex />);
    await act(async () => {});

    const titles = Array.from(document.querySelectorAll(".skill-list-item-name")).map(
      (node) => node.textContent,
    );
    expect(titles).toEqual(["Official Dev", "Community Dev"]);
    expect(getLastListPageArgs()).toEqual(expect.objectContaining({ officialFirst: true }));
  });

  it("does not render the warning filter", async () => {
    convexHttpMock.query.mockResolvedValue({
      page: [makeListResult("clean-skill", "Clean Skill")],
      hasMore: false,
      nextCursor: null,
    });

    render(<SkillsIndex />);
    await act(async () => {});

    expect(screen.queryByLabelText("Hide warnings")).toBeNull();
  });

  it("passes highlightedOnly to list query when filter is active", async () => {
    searchMock = { highlighted: true };
    render(<SkillsIndex />);
    await act(async () => {});

    const args = getLastListPageArgs();
    expect(args).toEqual(
      expect.objectContaining({
        dir: "desc",
        highlightedOnly: true,
      }),
    );
    expect(args).not.toHaveProperty("sort");
  });

  it("shows load-more button when more results are available", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    convexHttpMock.query.mockResolvedValue({
      page: [makeListResult("skill-0", "Skill 0")],
      hasMore: true,
      nextCursor: "cursor-1",
    });
    render(<SkillsIndex />);
    await act(async () => {});

    expect(screen.getByRole("button", { name: "Load more" })).toBeTruthy();
  });

  it("keeps loading across empty filtered pages without flashing terminal states", async () => {
    class IntersectionObserverMock {
      observe = vi.fn();
      disconnect = vi.fn();
    }
    vi.stubGlobal(
      "IntersectionObserver",
      IntersectionObserverMock as unknown as typeof IntersectionObserver,
    );
    searchMock = { category: "automation" };
    convexHttpMock.query
      .mockResolvedValueOnce({
        page: [],
        hasMore: true,
        nextCursor: "cursor-1",
      })
      .mockReturnValueOnce(new Promise(() => {}));

    render(<SkillsIndex />);
    await act(async () => {});

    expect(convexHttpMock.query).toHaveBeenCalledTimes(2);
    expect(getLastListPageArgs()).toEqual(expect.objectContaining({ cursor: "cursor-1" }));
    expect(screen.getByRole("status", { name: "Loading results" })).toBeTruthy();
    expect(screen.queryByText("Scroll to load more")).toBeNull();
    expect(screen.queryByText("No skills found")).toBeNull();
  });

  it("bounds empty filtered page auto-advance and pauses for a manual retry", async () => {
    class IntersectionObserverMock {
      observe = vi.fn();
      disconnect = vi.fn();
    }
    vi.stubGlobal(
      "IntersectionObserver",
      IntersectionObserverMock as unknown as typeof IntersectionObserver,
    );
    searchMock = { category: "automation" };
    convexHttpMock.query
      .mockResolvedValueOnce({
        page: [],
        hasMore: true,
        nextCursor: "cursor-1",
      })
      .mockResolvedValueOnce({
        page: [],
        hasMore: true,
        nextCursor: "cursor-2",
      })
      .mockResolvedValueOnce({
        page: [],
        hasMore: true,
        nextCursor: "cursor-3",
      })
      .mockReturnValueOnce(new Promise(() => {}));

    render(<SkillsIndex />);
    await act(async () => {});

    expect(convexHttpMock.query).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("button", { name: "Load more" })).toBeTruthy();
    expect(screen.queryByText("Scroll to load more")).toBeNull();
    expect(screen.queryByText("No skills found")).toBeNull();
  });

  it("keeps the retry cursor when a filtered follow-up page fails", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    vi.spyOn(console, "error").mockImplementation(() => {});
    searchMock = { category: "automation" };
    convexHttpMock.query
      .mockResolvedValueOnce({
        page: [],
        hasMore: true,
        nextCursor: "cursor-1",
      })
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockReturnValueOnce(new Promise(() => {}));

    render(<SkillsIndex />);
    await act(async () => {});

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    });

    expect(convexHttpMock.query).toHaveBeenCalledTimes(3);
    expect(getLastListPageArgs()).toEqual(expect.objectContaining({ cursor: "cursor-1" }));
    expect(screen.getByRole("status", { name: "Loading results" })).toBeTruthy();
    expect(screen.queryByText("No skills found")).toBeNull();
  });

  it("shows skeletons during load-more", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    convexHttpMock.query
      .mockResolvedValueOnce({
        page: [makeListResult("skill-0", "Skill 0")],
        hasMore: true,
        nextCursor: "cursor-1",
      })
      // Second call (load more) never resolves
      .mockReturnValueOnce(new Promise(() => {}));

    render(<SkillsIndex />);
    await act(async () => {});

    const loadMoreButton = screen.getByRole("button", { name: "Load more" });
    await act(async () => {
      fireEvent.click(loadMoreButton);
    });

    expect(screen.getByRole("status", { name: "Loading results" })).toBeTruthy();
    expect(screen.queryByText(/Loading/)).toBeNull();
  });
});

type NavigateSearchCall = {
  replace?: boolean;
  search: (prev: Record<string, unknown>) => Record<string, unknown>;
};

function getLastNavigateCall(): NavigateSearchCall {
  const call = navigateMock.mock.calls.at(-1)?.[0];
  if (!isNavigateSearchCall(call)) {
    throw new Error("Expected a route navigation call with a search updater");
  }
  return call;
}

function isNavigateSearchCall(value: unknown): value is NavigateSearchCall {
  if (!isRecord(value)) return false;
  return typeof value.search === "function";
}

function getLastListPageArgs(): Record<string, unknown> {
  let call: unknown[] | undefined;
  for (let index = convexHttpMock.query.mock.calls.length - 1; index >= 0; index -= 1) {
    const candidate = convexHttpMock.query.mock.calls[index];
    const args = candidate[1];
    if (isRecord(args) && "numItems" in args) {
      call = candidate;
      break;
    }
  }
  if (!call) {
    throw new Error("Expected a listPublicPageV4 query call");
  }
  const args = call[1];
  if (!isRecord(args)) {
    throw new Error("Expected listPublicPageV4 args to be an object");
  }
  return args;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function makeListResult(
  slug: string,
  displayName: string,
  options: {
    isSuspicious?: boolean;
    summary?: string;
    topics?: string[];
    categories?: string[];
    official?: boolean;
  } = {},
) {
  return {
    skill: {
      _id: `skill_${slug}`,
      slug,
      displayName,
      summary: options.summary ?? `${displayName} summary`,
      topics: options.topics,
      categories: options.categories,
      badges: options.official ? { official: { byUserId: "users:admin", at: 1 } } : {},
      tags: {},
      stats: {
        downloads: 0,
        installsCurrent: 0,
        installsAllTime: 0,
        stars: 0,
        versions: 1,
        comments: 0,
      },
      isSuspicious: options.isSuspicious,
      createdAt: 0,
      updatedAt: 0,
    },
    latestVersion: null,
    ownerHandle: null,
  };
}

function makeSearchResults(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    score: 0.9,
    skill: {
      _id: `skill_${index}`,
      slug: `skill-${index}`,
      displayName: `Skill ${index}`,
      summary: `Summary ${index}`,
      tags: {},
      stats: {
        downloads: 0,
        installsCurrent: 0,
        installsAllTime: 0,
        stars: 0,
        versions: 1,
        comments: 0,
      },
      createdAt: 0,
      updatedAt: 0,
    },
    version: null,
  }));
}

function makeSearchResult(slug: string, displayName: string, score: number, createdAt: number) {
  return {
    score,
    skill: {
      _id: `skill_${slug}`,
      slug,
      displayName,
      summary: `${displayName} summary`,
      tags: {},
      stats: {
        downloads: 0,
        installsCurrent: 0,
        installsAllTime: 0,
        stars: 0,
        versions: 1,
        comments: 0,
      },
      createdAt,
      updatedAt: createdAt,
    },
    version: null,
  };
}

function makeSearchEntry(params: {
  slug: string;
  displayName: string;
  stars: number;
  updatedAt: number;
}) {
  return {
    score: 0.9,
    skill: {
      _id: `skill_${params.slug}`,
      slug: params.slug,
      displayName: params.displayName,
      summary: `Summary ${params.slug}`,
      tags: {},
      stats: {
        downloads: 0,
        installsCurrent: 0,
        installsAllTime: 0,
        stars: params.stars,
        versions: 1,
        comments: 0,
      },
      createdAt: 0,
      updatedAt: params.updatedAt,
    },
    version: null,
  };
}
