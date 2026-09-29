import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
/* @vitest-environment jsdom */
import {
  Route as SkillsRoute,
  SKILLS_INITIAL_PAGE_TIMEOUT_MS,
  loadInitialSkillsData,
  SkillsIndex,
} from "../routes/skills/index";
import {
  convexHttpMock,
  convexReactMocks,
  resetConvexReactMocks,
  setupDefaultConvexReactMocks,
} from "./helpers/convexReactMocks";

const navigateMock = vi.fn();
const fetchCatalogDiscoveryCapabilitiesMock = vi.fn();
const fetchCanonicalTrendingPageMock = vi.fn();
let searchMock: Record<string, unknown> = {};
let loaderDataMock: unknown = null;

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
    url: "https://example.convex.cloud",
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
    fetchCatalogDiscoveryCapabilitiesMock.mockReset();
    fetchCatalogDiscoveryCapabilitiesMock.mockResolvedValue({
      apiVersion: 1,
      canonicalTrendingEnabled: true,
    });
    fetchCanonicalTrendingPageMock.mockReset();
    fetchCanonicalTrendingPageMock.mockResolvedValue({
      kind: "skills",
      snapshotId: "snapshot-1",
      snapshotCursor: "snapshot-cursor",
      generatedAt: "2026-08-04T00:00:00.000Z",
      windowHours: 24,
      rankingVersion: "skills-trending-v1",
      totalItems: 0,
      items: [],
      nextCursor: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("renders category-only skill browsing and ignores retired catalog filters", async () => {
    const config = (
      SkillsRoute as unknown as {
        __config: { validateSearch: (search: Record<string, unknown>) => Record<string, unknown> };
      }
    ).__config;
    searchMock = config.validateSearch({
      tab: "new",
      featured: true,
      highlighted: true,
      category: "development",
    });
    render(<SkillsIndex />);
    await act(async () => {});
    expect(screen.queryByRole("radiogroup", { name: "Skill view" })).toBeNull();
    expect(screen.getByLabelText("Skill categories")).toBeTruthy();
    const args = getLastListPageArgs();
    expect(args.categorySlug).toBe("development");
    expect(args.createdAfter).toBeUndefined();
    expect(args.officialOnly).toBeUndefined();
    expect(args.highlightedOnly).toBeUndefined();
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

  it("loads the full first page on the server and excludes view and retired tab state", async () => {
    const config = (
      SkillsRoute as unknown as {
        __config: {
          validateSearch: (s: Record<string, unknown>) => Record<string, unknown>;
          loaderDeps: (a: { search: Record<string, unknown> }) => Record<string, unknown>;
          loader: (a: {
            deps: Record<string, unknown>;
            abortController: AbortController;
          }) => Promise<unknown>;
        };
      }
    ).__config;
    const entry = makeListResult("server-skill", "Server Skill");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "success",
          value: { page: [entry], hasMore: true, nextCursor: "cursor-2" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const deps = config.loaderDeps({ search: config.validateSearch({}) });
    expect(
      config.loaderDeps({
        search: config.validateSearch({ view: "grid", tab: "new", featured: true }),
      }),
    ).toEqual(deps);
    await expect(config.loader({ deps, abortController: new AbortController() })).resolves.toEqual({
      kind: "browse",
      key: '{"numItems":20,"dir":"desc"}',
      results: [entry],
      nextCursor: "cursor-2",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(request.path).toBe("skills:listPublicPageV4");
    expect(request.args[0]).toEqual({ numItems: 20, dir: "desc" });
    expect(fetchCanonicalTrendingPageMock).not.toHaveBeenCalled();
  });

  it("releases the initial response when full catalog loading exceeds its latency budget", async () => {
    vi.useFakeTimers();
    const config = (
      SkillsRoute as unknown as {
        __config: {
          loader: (a: {
            deps: Record<string, unknown>;
            abortController: AbortController;
          }) => Promise<unknown>;
        };
      }
    ).__config;
    let requestSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input, init) =>
          new Promise((_resolve, reject) => {
            requestSignal = init.signal;
            requestSignal?.addEventListener("abort", () => reject(requestSignal?.reason), {
              once: true,
            });
          }),
      ),
    );
    const result = config.loader({ deps: {}, abortController: new AbortController() });
    await vi.advanceTimersByTimeAsync(SKILLS_INITIAL_PAGE_TIMEOUT_MS);
    await expect(result).resolves.toBeNull();
    expect(requestSignal?.aborted).toBe(true);
  });

  it("cancels the underlying browse request when navigation aborts", async () => {
    const config = (
      SkillsRoute as unknown as {
        __config: {
          loader: (args: {
            deps: Record<string, unknown>;
            abortController: AbortController;
          }) => Promise<unknown>;
        };
      }
    ).__config;
    let requestSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input, init) =>
          new Promise((_resolve, reject) => {
            requestSignal = init.signal;
            requestSignal?.addEventListener("abort", () => reject(requestSignal?.reason), {
              once: true,
            });
          }),
      ),
    );
    const controller = new AbortController();
    const result = config.loader({ deps: {}, abortController: controller });
    const rejection = expect(result).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await rejection;
    expect(requestSignal?.aborted).toBe(true);
  });

  it("renders full-catalog loader data without a duplicate first-page request", async () => {
    searchMock = {};
    loaderDataMock = {
      kind: "browse",
      key: '{"numItems":20,"dir":"desc"}',
      results: [makeListResult("server-skill", "Server Skill")],
      nextCursor: "cursor-2",
    };
    render(<SkillsIndex />);
    await act(async () => {});
    expect(screen.getByText("Server Skill")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Load more" })).toBeTruthy();
    expect(convexHttpMock.query).not.toHaveBeenCalled();
  });

  it("continues scanning when the server returns an empty filtered transport page", async () => {
    convexHttpMock.query.mockResolvedValueOnce({ page: [], hasMore: true, nextCursor: "scan-2" });
    loaderDataMock = await loadInitialSkillsData({});
    expect(loaderDataMock).toBeNull();
    convexHttpMock.query
      .mockResolvedValueOnce({ page: [], hasMore: true, nextCursor: "scan-2" })
      .mockResolvedValueOnce({
        page: [makeListResult("visible-skill", "Visible Skill")],
        hasMore: false,
        nextCursor: null,
      });
    render(<SkillsIndex />);
    await act(async () => {});
    expect(screen.getByText("Visible Skill")).toBeTruthy();
    expect(getLastListPageArgs().cursor).toBe("scan-2");
  });

  it("does not reuse server results for a different category", async () => {
    loaderDataMock = {
      kind: "browse",
      key: '{"numItems":20,"dir":"desc"}',
      results: [makeListResult("stale-skill", "Stale Skill")],
      nextCursor: null,
    };
    searchMock = { category: "development" };
    render(<SkillsIndex />);
    await act(async () => {});
    expect(screen.queryByText("Stale Skill")).toBeNull();
    expect(getLastListPageArgs().categorySlug).toBe("development");
  });

  it("requests the full first skills page without a date or publisher filter", async () => {
    render(<SkillsIndex />);
    await act(async () => {});
    expect(getLastListPageArgs()).toMatchObject({ dir: "desc", numItems: 20, cursor: undefined });
    expect(getLastListPageArgs().createdAfter).toBeUndefined();
    expect(getLastListPageArgs().highlightedOnly).toBeUndefined();
    expect(getLastListPageArgs().officialOnly).toBeUndefined();
    expect(screen.queryByRole("radiogroup", { name: "Skill view" })).toBeNull();
  });

  it("renders desktop category navigation and keeps the responsive category dropdown", async () => {
    render(<SkillsIndex />);
    await act(async () => {});

    const categorySidebar = screen.getByLabelText("Skill categories");
    expect(categorySidebar.querySelectorAll("button")).toHaveLength(15);
    expect(categorySidebar.textContent).toContain("Development");
    expect(screen.getByRole("combobox", { name: "Category" })).toBeTruthy();

    fireEvent.click(
      categorySidebar.querySelector('button[aria-pressed="false"]') as HTMLButtonElement,
    );

    expect(navigateMock).toHaveBeenCalled();
  });

  it("renders an empty state when no skills are returned", async () => {
    render(<SkillsIndex />);
    await act(async () => {});
    expect(screen.getByText("No skills found")).toBeTruthy();
    expect(screen.queryByText(/\d+ loaded/)).toBeNull();
  });

  it("renders the total skills count in the unfiltered page title", async () => {
    searchMock = {};
    convexReactMocks.useQuery.mockReturnValue(70_300);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            kind: "skills",
            snapshotId: "snapshot-1",
            snapshotCursor: "snapshot-cursor",
            generatedAt: new Date().toISOString(),
            windowHours: 24,
            rankingVersion: "skills-trending-v1",
            totalItems: 0,
            items: [],
            nextCursor: null,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    render(<SkillsIndex />);
    await act(async () => {});

    expect(await screen.findByRole("heading", { name: "Skills 70.3K" })).toBeTruthy();
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

    fireEvent.click(screen.getByRole("button", { name: "Clear skill search" }));

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

  it("keeps search visible and focuses it with slash", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });

    render(<SkillsIndex />);
    await act(async () => {});

    const input = screen.getByPlaceholderText("Search skills...");
    expect(input.closest("[hidden]")).toBeNull();

    fireEvent.keyDown(window, { key: "/" });

    expect(input.closest("[hidden]")).toBeNull();
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

  it.each(["list", "grid"] as const)(
    "shows iconless list loading for legacy %s view links",
    async (view) => {
      searchMock = { tab: "new", view: view === "grid" ? view : undefined };
      // Never resolve the query to keep the component in loading state
      convexHttpMock.query.mockReturnValue(new Promise(() => {}));
      render(<SkillsIndex />);
      await act(async () => {});
      // Results area shows skeletons while loading, without count copy.
      expect(screen.queryByText(/\d+ loaded/)).toBeNull();
      const loadingResults = screen.getByRole("status", { name: "Loading results" });
      expect(loadingResults.querySelector(".browse-results-skeleton-icon")).toBeNull();
      expect(loadingResults.querySelector(".browse-list-head-icon-spacer")).toBeNull();
      expect(loadingResults.querySelectorAll(".skill-card-header-no-icon")).toHaveLength(0);
      expect(loadingResults.querySelectorAll(".skill-list-item-no-icon")).toHaveLength(6);
      expect(screen.queryByText("No skills found")).toBeNull();
    },
  );

  it.each(["grid", "cards"])("renders legacy %s URLs as lists", async (view) => {
    searchMock = { view };
    convexHttpMock.query.mockResolvedValue({
      page: [makeListResult("list-only", "List Only")],
      hasMore: false,
      nextCursor: null,
    });
    render(<SkillsIndex />);
    await act(async () => {});
    expect(screen.getByText("List Only").closest(".results-list")).not.toBeNull();
    expect(document.querySelector(".browse-results-grid")).toBeNull();
    expect(screen.queryByRole("button", { name: "Grid" })).toBeNull();
    expect(screen.queryByRole("button", { name: "List" })).toBeNull();
  });

  it("renders search above category navigation and results", async () => {
    render(<SkillsIndex />);
    await act(async () => {});
    const searchInput = screen.getByRole("searchbox", { name: "skill search" });
    const categories = screen.getByLabelText("Skill categories");
    expect(searchInput.closest("[hidden]")).toBeNull();
    expect(
      Boolean(searchInput.compareDocumentPosition(categories) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true);
    expect(screen.queryByRole("button", { name: "Search skills" })).toBeNull();
  });

  it("clears with Escape while keeping the search field visible and focused", async () => {
    searchMock = { q: "github" };
    render(<SkillsIndex />);
    await act(async () => {});
    const input = screen.getByRole("searchbox", { name: "skill search" });
    input.focus();
    fireEvent.keyDown(input, { key: "Escape" });
    expect((input as HTMLInputElement).value).toBe("");
    expect(document.activeElement).toBe(input);
    expect(input.closest("[hidden]")).toBeNull();
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

  it("renders URL-query skill search results from loader data without a duplicate refresh", async () => {
    searchMock = { q: "japanese-conversation-scorer" };
    loaderDataMock = {
      key: "japanese-conversation-scorer::0::::",
      limit: 25,
      results: [
        makeSearchResult(
          "japanese-conversation-scorer",
          "Japanese Conversation Scorer",
          1,
          0,
          "bianmaxingkong",
        ),
      ],
    };
    const actionFn = vi.fn().mockResolvedValue([]);
    convexReactMocks.useAction.mockReturnValue(actionFn);

    render(<SkillsIndex />);

    expect(screen.getByText("Japanese Conversation Scorer")).toBeTruthy();
    expect(screen.queryByText("No skills found")).toBeNull();
    expect(actionFn).not.toHaveBeenCalled();
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
      categorySlug: undefined,
      topic: undefined,
      limit: 20,
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(actionFn).toHaveBeenCalledWith({
      query: "remind",
      highlightedOnly: false,
      categorySlug: undefined,
      topic: undefined,
      limit: 20,
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
      topic: undefined,
      limit: 20,
    });
  });

  it("keeps search free of catalog tabs", async () => {
    searchMock = { q: "notion" };
    render(<SkillsIndex />);
    expect(screen.queryByRole("radiogroup", { name: "Skill view" })).toBeNull();
    expect(screen.getByLabelText("Skill categories")).toBeTruthy();
  });

  it("does not reveal catalog tabs while typing a search", async () => {
    vi.useFakeTimers();
    render(<SkillsIndex />);
    fireEvent.change(screen.getByPlaceholderText("Search skills..."), {
      target: { value: "agent" },
    });
    expect(screen.queryByRole("radiogroup", { name: "Skill view" })).toBeNull();
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
    // The settled route loader owns search; typing only hands the query to navigation.
    expect(getLastNavigateCall().search({})).toMatchObject({ q: "test" });
    expect(actionFn).not.toHaveBeenCalled();
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

  it("loads more results when search pagination is requested", async () => {
    searchMock = { q: "remind" };
    vi.stubGlobal("IntersectionObserver", undefined);
    const actionFn = vi
      .fn()
      .mockResolvedValueOnce(makeSearchResults(20))
      .mockResolvedValueOnce(makeSearchResults(40));
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
      categorySlug: undefined,
      topic: undefined,
      limit: 40,
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

  it("preserves canonical API order for default relevance search", async () => {
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

    expect(titles[0]).toBe("Newer Low Score");
    expect(titles[1]).toBe("Older High Score");
  });

  it("renders external skills in the canonical mixed order", async () => {
    searchMock = { q: "find skills" };
    convexReactMocks.useAction.mockReturnValue(
      vi
        .fn()
        .mockResolvedValue([
          makeSearchResult("native-find", "Native Find", 6_000, 2_000),
          makeExternalSearchResult("vercel-labs/skills/find-skills", "Find Skills", 5_000),
        ]),
    );
    vi.useFakeTimers();

    render(<SkillsIndex />);
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const titles = Array.from(document.querySelectorAll(".skill-list-item-name")).map(
      (node) => node.textContent,
    );
    expect(titles).toEqual(["Native Find", "Find Skills"]);
    expect(screen.getByText("skills.sh")).toBeTruthy();
    expect(document.querySelector(".marketplace-icon-skill")).toBeNull();
    expect(document.querySelector(".browse-list-head-icon-spacer")).toBeNull();
  });

  it("keeps native and external results in a list for old grid links", async () => {
    searchMock = { q: "find skills", view: "grid" };
    convexReactMocks.useAction.mockReturnValue(
      vi
        .fn()
        .mockResolvedValue([
          makeSearchResult("native-find", "Native Find", 6_000, 2_000),
          makeExternalSearchResult("vercel-labs/skills/find-skills", "Find Skills", 5_000),
        ]),
    );
    vi.useFakeTimers();

    render(<SkillsIndex />);
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(screen.getByText("Native Find")).toBeTruthy();
    expect(screen.getByText("Find Skills")).toBeTruthy();
    expect(document.querySelector(".marketplace-icon-skill")).toBeNull();
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

  it("preserves backend ordering on category pages without client reranking", async () => {
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
    expect(getLastListPageArgs()).toHaveProperty("officialFirst", true);
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

  it.each(["new", "featured", "official"] as const)(
    "surfaces a retryable failure on the %s first page after a temporary fetch failure",
    async (tab) => {
      searchMock = { tab };
      vi.stubGlobal("IntersectionObserver", undefined);
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        convexHttpMock.query
          .mockRejectedValueOnce(new Error("temporary failure"))
          .mockResolvedValueOnce({
            page: [makeListResult("recovered-skill", "Recovered Skill")],
            hasMore: false,
            nextCursor: null,
          });

        render(<SkillsIndex />);
        await act(async () => {});

        expect(screen.queryByText("No skills found")).toBeNull();
        expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
        expect(screen.getByRole("alert").textContent).toContain("Skills couldn't be loaded");

        await act(async () => {
          fireEvent.click(screen.getByRole("button", { name: "Try again" }));
        });

        expect(convexHttpMock.query).toHaveBeenCalledTimes(2);
        expect(convexHttpMock.query.mock.calls.at(-1)?.[1]?.cursor ?? null).toBeNull();
        expect(screen.getByText("Recovered Skill")).toBeTruthy();
        expect(screen.queryByRole("alert")).toBeNull();
        expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
      } finally {
        consoleErrorSpy.mockRestore();
      }
    },
  );

  it("dispatches one first-page request when Try again is activated twice before it settles", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      let settleRetry: (page: unknown) => void = () => {};
      convexHttpMock.query
        .mockRejectedValueOnce(new Error("temporary failure"))
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              settleRetry = resolve;
            }),
        )
        .mockRejectedValue(new Error("duplicate retry dispatched"));

      render(<SkillsIndex />);
      await act(async () => {});

      const retryButton = screen.getByRole("button", { name: "Try again" });
      await act(async () => {
        fireEvent.click(retryButton);
        fireEvent.click(retryButton);
      });

      // Both activations land before React rerenders, so only the guard can keep the second
      // one from starting a rival request that outlives the first.
      expect(convexHttpMock.query).toHaveBeenCalledTimes(2);

      await act(async () => {
        settleRetry({
          page: [makeListResult("recovered-skill", "Recovered Skill")],
          hasMore: false,
          nextCursor: null,
        });
      });

      expect(convexHttpMock.query).toHaveBeenCalledTimes(2);
      expect(screen.getByText("Recovered Skill")).toBeTruthy();
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it("keeps the first-page failure state when the retry fails again", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      convexHttpMock.query
        .mockRejectedValueOnce(new Error("temporary failure"))
        .mockRejectedValueOnce(new Error("still failing"));

      render(<SkillsIndex />);
      await act(async () => {});

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      });

      expect(convexHttpMock.query).toHaveBeenCalledTimes(2);
      expect(screen.queryByText("No skills found")).toBeNull();
      expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
      expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    } finally {
      consoleErrorSpy.mockRestore();
    }
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

  it.each(["list", "grid"] as const)(
    "shows iconless list load-more skeletons for legacy %s view links",
    async (view) => {
      vi.stubGlobal("IntersectionObserver", undefined);
      searchMock = { tab: "new", view: view === "grid" ? view : undefined };
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

      const loadingResults = screen.getByRole("status", { name: "Loading results" });
      expect(loadingResults.querySelector(".browse-results-skeleton-icon")).toBeNull();
      expect(loadingResults.querySelector(".browse-list-head-icon-spacer")).toBeNull();
      expect(loadingResults.querySelectorAll(".skill-card-header-no-icon")).toHaveLength(0);
      expect(loadingResults.querySelectorAll(".skill-list-item-no-icon")).toHaveLength(2);
      expect(screen.queryByText(/Loading/)).toBeNull();
    },
  );
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
        installs: 0,
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
  return Array.from({ length: count }, (_, index) =>
    makeSearchResult(`skill-${index}`, `Skill ${index}`, 0.9, 0),
  );
}

function makeSearchResult(
  slug: string,
  displayName: string,
  score: number,
  createdAt: number,
  ownerHandle: string | null = null,
) {
  const skill = makeListResult(slug, displayName).skill;
  skill.createdAt = createdAt;
  skill.updatedAt = createdAt;
  return {
    id: `clawhub:${skill._id}`,
    source: "clawhub",
    slug,
    displayName,
    summary: skill.summary,
    score,
    canonicalUrl: `/${ownerHandle ?? "owner"}/skills/${slug}`,
    links: {
      canonical: `/${ownerHandle ?? "owner"}/skills/${slug}`,
      source: null,
    },
    official: false,
    featured: false,
    publisher: null,
    install: { kind: "clawhub", reference: `${ownerHandle ?? "owner"}/${slug}`, sourceUrl: null },
    sourceIdentity: {
      id: skill._id,
      owner: ownerHandle,
      repo: null,
      host: null,
      lifetimeInstalls: null,
    },
    trust: {
      visibility: "public",
      installability: "installable",
      clawHubVerdict: null,
      upstreamScanners: null,
      sourceFreshness: "native",
    },
    metrics: { rolling60DayInstalls: 0, bookmarks: 0, updatedAt: createdAt },
    native: { skill, version: null, owner: null, ownerHandle },
    ownerHandle,
    version: null,
    downloads: 0,
    updatedAt: createdAt,
  };
}

function makeExternalSearchResult(externalId: string, displayName: string, score: number) {
  const slug = externalId.split("/").at(-1) ?? externalId;
  const [owner, repo] = externalId.split("/");
  return {
    id: `skills-sh:${externalId}`,
    source: "skills-sh",
    slug,
    displayName,
    summary: `${displayName} summary`,
    score,
    canonicalUrl: `/skills-sh/${externalId}`,
    links: {
      canonical: `/skills-sh/${externalId}`,
      source: `https://skills.sh/${externalId}`,
    },
    official: false,
    featured: false,
    publisher: null,
    install: {
      kind: "skills-sh",
      reference: `skills-sh/${externalId}`,
      sourceUrl: `https://skills.sh/${externalId}`,
    },
    sourceIdentity: { id: externalId, owner, repo, host: null, lifetimeInstalls: 42 },
    trust: {
      visibility: "public",
      installability: "installable",
      clawHubVerdict: null,
      upstreamScanners: {},
      sourceFreshness: "observed-only",
    },
    metrics: { rolling60DayInstalls: null, bookmarks: null, updatedAt: 1_000 },
    native: null,
    ownerHandle: owner,
    version: null,
    downloads: null,
    updatedAt: 1_000,
  };
}

function makeSearchEntry(params: {
  slug: string;
  displayName: string;
  stars: number;
  updatedAt: number;
}) {
  const entry = makeSearchResult(params.slug, params.displayName, 0.9, params.updatedAt);
  if (entry.native) entry.native.skill.stats.stars = params.stars;
  return entry;
}
