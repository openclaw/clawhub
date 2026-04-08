/* @vitest-environment jsdom */
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SkillsIndex } from "../routes/skills/index";
import {
  convexHttpMock,
  convexReactMocks,
  resetConvexReactMocks,
  setupDefaultConvexReactMocks,
} from "./helpers/convexReactMocks";

const navigateMock = vi.fn();
let searchMock: Record<string, unknown> = {};

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (_config: { component: unknown; validateSearch: unknown }) => ({
    useNavigate: () => navigateMock,
    useSearch: () => searchMock,
  }),
  redirect: (options: unknown) => ({ redirect: options }),
  Link: (props: { children: ReactNode }) => <a href="/">{props.children}</a>,
}));

vi.mock("convex/react", () => ({
  useAction: (...args: unknown[]) => convexReactMocks.useAction(...args),
  useQuery: (...args: unknown[]) => convexReactMocks.useQuery(...args),
}));

vi.mock("../../src/convex/client", () => ({
  convexHttp: {
    query: (...args: unknown[]) => convexHttpMock.query(...args),
  },
}));

describe("SkillsIndex", () => {
  beforeEach(() => {
    resetConvexReactMocks();
    navigateMock.mockReset();
    searchMock = {};
    setupDefaultConvexReactMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("requests the first skills page", async () => {
    render(<SkillsIndex />);
    await act(async () => {});

    expect(convexHttpMock.query).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sort: "downloads",
        dir: "desc",
        highlightedOnly: false,
        nonSuspiciousOnly: false,
        cursor: undefined,
        numItems: 25,
      }),
    );
  });

  it("renders an empty state when no skills are returned", async () => {
    render(<SkillsIndex />);
    await act(async () => {});
    expect(screen.getByText("No skills match that filter")).toBeTruthy();
  });

  it("shows loading state before fetch completes", async () => {
    // Never resolve the query to keep the component in loading state
    convexHttpMock.query.mockReturnValue(new Promise(() => {}));
    render(<SkillsIndex />);
    await act(async () => {});
    // Header subtitle shows "Loading skills..."
    expect(screen.getAllByText("Loading skills...").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("No skills match that filter")).toBeNull();
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
    expect(screen.getByText("No skills match that filter")).toBeTruthy();
    expect(screen.queryByText("Loading skills...")).toBeNull();
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
      nonSuspiciousOnly: false,
      limit: 25,
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(actionFn).toHaveBeenCalledWith({
      query: "remind",
      highlightedOnly: false,
      nonSuspiciousOnly: false,
      limit: 25,
    });
  });

  it("switches browse default sorting back to relevance when entering search", async () => {
    searchMock = { sort: "downloads" };
    vi.useFakeTimers();

    render(<SkillsIndex />);

    const input = screen.getByPlaceholderText("Search skills by name, slug, or summary...");
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
    expect(lastCall.search({ sort: "downloads" })).toEqual({
      q: "cli-design-framework",
      sort: undefined,
      dir: undefined,
    });
  });

  it("preserves explicitly user-set downloads sort when entering search", async () => {
    searchMock = { sort: "downloads", dir: "desc" };
    vi.useFakeTimers();

    render(<SkillsIndex />);

    const input = screen.getByPlaceholderText("Search skills by name, slug, or summary...");
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

    const loadMoreButton = screen.getByRole("button", { name: "Load more" });
    await act(async () => {
      fireEvent.click(loadMoreButton);
      await vi.runAllTimersAsync();
    });

    expect(actionFn).toHaveBeenLastCalledWith({
      query: "remind",
      highlightedOnly: false,
      nonSuspiciousOnly: false,
      limit: 50,
    });
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

    const links = screen.getAllByRole("link");
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

    const links = screen.getAllByRole("link");
    expect(links[0]?.textContent).toContain("Older High Score");
    expect(links[1]?.textContent).toContain("Newer Low Score");
  });

  it("passes nonSuspiciousOnly to list query when filter is active", async () => {
    searchMock = { nonSuspicious: true };
    render(<SkillsIndex />);
    await act(async () => {});

    expect(convexHttpMock.query).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sort: "downloads",
        dir: "desc",
        highlightedOnly: false,
        nonSuspiciousOnly: true,
      }),
    );
  });

  it("passes highlightedOnly to list query when filter is active", async () => {
    searchMock = { highlighted: true };
    render(<SkillsIndex />);
    await act(async () => {});

    expect(convexHttpMock.query).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sort: "downloads",
        dir: "desc",
        highlightedOnly: true,
        nonSuspiciousOnly: false,
      }),
    );
  });

  it("passes capabilityTag to list query when tag filter is active", async () => {
    searchMock = { tag: "crypto" };
    render(<SkillsIndex />);
    await act(async () => {});

    expect(convexHttpMock.query).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        capabilityTag: "crypto",
      }),
    );
  });

  it("shows and clears the active capability tag filter", async () => {
    searchMock = { tag: "crypto" };
    render(<SkillsIndex />);
    await act(async () => {});

    const capabilityChip = screen.getByRole("button", { name: /crypto/i });
    expect(capabilityChip).toBeTruthy();

    await act(async () => {
      fireEvent.click(capabilityChip);
    });

    expect(navigateMock).toHaveBeenCalled();
    const lastCall = navigateMock.mock.calls.at(-1)?.[0] as {
      replace?: boolean;
      search: (prev: Record<string, unknown>) => Record<string, unknown>;
    };
    expect(lastCall.replace).toBe(true);
    expect(lastCall.search({ tag: "crypto" })).toEqual({
      tag: undefined,
    });
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

  it("shows loading indicator during load-more", async () => {
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

    expect(screen.getByRole("button", { name: "Load more" }).hasAttribute("disabled")).toBe(true);
  });
});

function makeListResult(slug: string, displayName: string) {
  return {
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
