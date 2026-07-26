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
const fetchCanonicalTrendingPageMock = vi.fn();
let searchMock: Record<string, unknown> = {};
let loaderDataMock: unknown = null;

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
  Link: (props: { children: ReactNode; to?: string }) => (
    <a href={props.to ?? "/"}>{props.children}</a>
  ),
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
    fetchCanonicalTrendingPageMock.mockReset();
    fetchCanonicalTrendingPageMock.mockResolvedValue(canonicalPage([]));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("normalizes supported tab, topic, and legacy category URLs", () => {
    const validateSearch = getValidateSearch();

    expect(validateSearch({}).tab).toBe("trending");
    expect(validateSearch({ tab: "official", topic: "github" })).toEqual(
      expect.objectContaining({ tab: "official", topic: "github" }),
    );
    expect(validateSearch({ category: "workflows" }).category).toBe("automation");
    expect(validateSearch({ category: "workflows" }).tab).toBe("new");
    expect(validateSearch({ topic: "github" }).tab).toBe("new");
    expect(validateSearch({ tab: "trending", category: "workflows" }).tab).toBe("trending");
    expect(validateSearch({ category: "mcp-tools" }).category).toBe("integrations");
    expect(validateSearch({ category: "unknown" }).category).toBeUndefined();
    expect(validateSearch({ category: "unknown" }).tab).toBe("trending");
  });

  it("defaults to canonical Trending and exposes the exact accepted tabs", async () => {
    render(<SkillsIndex />);
    await act(async () => {});

    expect(fetchCanonicalTrendingPageMock).toHaveBeenCalledWith({ cursor: null, limit: 20 });
    expect(convexHttpMock.query).not.toHaveBeenCalled();
    expect(screen.getByRole("radio", { name: "Trending" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(tabLabels()).toEqual(["Trending", "New", "Featured", "Official"]);
    expect(screen.queryByRole("radio", { name: "Top" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "All" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Sort" })).toBeNull();
    expect(screen.queryByLabelText("Skill categories")).toBeNull();
  });

  it("renders canonical Trending rows in API order with only 24-hour installs", async () => {
    fetchCanonicalTrendingPageMock.mockResolvedValue(
      canonicalPage([
        makeTrending("first", "First Skill", 17, 9000),
        makeTrending("second", "Second Skill", 3, 8000),
      ]),
    );

    render(<SkillsIndex />);

    expect(await screen.findByTitle("First Skill")).toBeTruthy();
    const names = Array.from(
      document.querySelectorAll(".skill-list-item-name"),
      (node) => node.textContent,
    );
    expect(names).toEqual(["First Skill", "Second Skill"]);
    expect(screen.getByText("17")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.queryByText("9K")).toBeNull();
    expect(screen.queryByText("8K")).toBeNull();
    expect(screen.queryByText("skills.sh")).toBeNull();
    expect(screen.queryByText(/Not scanned by ClawHub/i)).toBeNull();
  });

  it("loads New from the native 14-day chronological feed", async () => {
    searchMock = { tab: "new" };
    convexHttpMock.query.mockResolvedValue({
      page: [makeListResult("new-skill", "New Skill")],
      hasMore: false,
      nextCursor: null,
    });

    render(<SkillsIndex />);
    expect(await screen.findByText("New Skill")).toBeTruthy();

    const args = getLastListPageArgs();
    expect(args).toEqual(
      expect.objectContaining({
        sort: "newest",
        dir: "desc",
        numItems: 20,
        highlightedOnly: undefined,
        officialOnly: undefined,
      }),
    );
    expect(typeof args.createdAfter).toBe("number");
    expect(Date.now() - Number(args.createdAfter)).toBeLessThanOrEqual(
      14 * 24 * 60 * 60 * 1000 + 1000,
    );
  });

  it("loads the latest 40 Featured skills from editorial history", async () => {
    searchMock = { tab: "featured" };
    convexHttpMock.query.mockResolvedValue({
      page: [makeListResult("featured-skill", "Featured Skill")],
      hasMore: true,
      nextCursor: "must-not-continue",
    });

    render(<SkillsIndex />);
    expect(await screen.findByText("Featured Skill")).toBeTruthy();

    expect(getLastListPageArgs()).toEqual(
      expect.objectContaining({
        highlightedOnly: true,
        numItems: 40,
        sort: "updated",
      }),
    );
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("loads Official through the backend official-publisher filter", async () => {
    searchMock = { tab: "official", category: "development" };
    convexHttpMock.query.mockResolvedValue({ page: [], hasMore: false, nextCursor: null });

    render(<SkillsIndex />);
    await act(async () => {});

    expect(getLastListPageArgs()).toEqual(
      expect.objectContaining({
        categorySlug: "development",
        officialOnly: true,
        sort: "newest",
        numItems: 20,
      }),
    );
    expect(getLastListPageArgs()).not.toHaveProperty("officialFirst");
  });

  it("shows category navigation outside Trending and sends the selected category", async () => {
    searchMock = { tab: "new", category: "development" };
    convexHttpMock.query.mockResolvedValue({ page: [], hasMore: false, nextCursor: null });

    render(<SkillsIndex />);
    await act(async () => {});

    expect(screen.getByLabelText("Skill categories")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Category" })).toBeTruthy();
    expect(getLastListPageArgs()).toEqual(expect.objectContaining({ categorySlug: "development" }));
    expect(getLastListPageArgs()).not.toHaveProperty("officialFirst");
  });

  it("switches feeds through URL state and clears filters that would rerank Trending", async () => {
    searchMock = { tab: "new", category: "development", topic: "github", q: "agent" };
    render(<SkillsIndex />);

    fireEvent.click(screen.getByRole("radio", { name: "Trending" }));

    const call = getLastNavigateCall();
    expect(
      call.search({ tab: "new", category: "development", topic: "github", q: "agent" }),
    ).toEqual({
      tab: "trending",
      category: undefined,
      topic: undefined,
      q: undefined,
      sort: undefined,
      dir: undefined,
      featured: undefined,
      highlighted: undefined,
    });
  });

  it("renders the full eligible backend count on the default page", async () => {
    convexReactMocks.useQuery.mockReturnValue(70_300);

    render(<SkillsIndex />);
    await act(async () => {});

    expect(screen.getByRole("heading", { name: "Skills 70.3K" })).toBeTruthy();
  });

  it("hides the global count on subset feeds", async () => {
    searchMock = { tab: "featured" };
    convexReactMocks.useQuery.mockReturnValue(70_300);
    convexHttpMock.query.mockResolvedValue({ page: [], hasMore: false, nextCursor: null });

    render(<SkillsIndex />);
    await act(async () => {});

    expect(screen.getByRole("heading", { name: "Skills" })).toBeTruthy();
    expect(screen.queryByText("70.3K")).toBeNull();
  });

  it("keeps search relevance separate and skips feed requests", async () => {
    searchMock = { q: "remind" };
    const action = vi.fn().mockResolvedValue([]);
    convexReactMocks.useAction.mockReturnValue(action);
    vi.useFakeTimers();

    render(<SkillsIndex />);
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(fetchCanonicalTrendingPageMock).not.toHaveBeenCalled();
    expect(convexHttpMock.query).not.toHaveBeenCalled();
    expect(action).toHaveBeenCalledWith({
      query: "remind",
      highlightedOnly: false,
      categorySlug: undefined,
      topic: undefined,
      limit: 20,
    });
  });

  it("clears browse-only category and topic constraints when entering search", async () => {
    searchMock = { tab: "new", category: "development", topic: "github" };
    convexHttpMock.query.mockResolvedValue({ page: [], hasMore: false, nextCursor: null });
    vi.useFakeTimers();

    render(<SkillsIndex />);
    fireEvent.click(screen.getByRole("button", { name: "Search skills" }));
    fireEvent.change(screen.getByPlaceholderText("Search skills..."), {
      target: { value: "agent" },
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(
      getLastNavigateCall().search({ tab: "new", category: "development", topic: "github" }),
    ).toEqual({
      tab: "new",
      category: undefined,
      dir: undefined,
      topic: undefined,
      q: "agent",
      sort: undefined,
    });
  });

  it("uses loader-provided search results without a duplicate refresh", () => {
    searchMock = { q: "japanese-conversation-scorer" };
    loaderDataMock = {
      key: "japanese-conversation-scorer::0::::",
      limit: 25,
      results: [makeSearchResult("japanese-conversation-scorer", "Japanese Conversation Scorer")],
    };
    const action = vi.fn().mockResolvedValue([]);
    convexReactMocks.useAction.mockReturnValue(action);

    render(<SkillsIndex />);

    expect(screen.getByText("Japanese Conversation Scorer")).toBeTruthy();
    expect(screen.queryByText("24h installs")).toBeNull();
    expect(screen.getByText("Popularity")).toBeTruthy();
    expect(action).not.toHaveBeenCalled();
  });

  it("keeps the existing list/grid and search controls", async () => {
    render(<SkillsIndex />);
    await act(async () => {});

    fireEvent.click(screen.getByRole("button", { name: "Grid" }));
    expect(getLastNavigateCall().search({})).toEqual({ view: "grid" });

    fireEvent.click(screen.getByRole("button", { name: "Search skills" }));
    expect(screen.getByPlaceholderText("Search skills...")).toBeTruthy();
  });
});

function getValidateSearch() {
  return (
    SkillsRoute as unknown as {
      __config: {
        validateSearch: (search: Record<string, unknown>) => Record<string, unknown>;
      };
    }
  ).__config.validateSearch;
}

function tabLabels() {
  return Array.from(
    screen.getByRole("radiogroup", { name: "Skill view" }).querySelectorAll('[role="radio"]'),
    (node) => node.textContent,
  );
}

function getLastNavigateCall() {
  return navigateMock.mock.calls.at(-1)?.[0] as {
    search: (prev: Record<string, unknown>) => Record<string, unknown>;
    replace?: boolean;
  };
}

function getLastListPageArgs() {
  const call = convexHttpMock.query.mock.calls.at(-1);
  return (call?.[1] ?? {}) as Record<string, unknown>;
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
    canonicalUrl: `/owner/${slug}`,
    publisher: {
      kind: "user" as const,
      handle: "owner",
      displayName: "Owner",
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

function makeListResult(slug: string, displayName: string) {
  return {
    skill: {
      _id: `skill_${slug}`,
      slug,
      displayName,
      summary: `${displayName} summary`,
      tags: {},
      stats: { downloads: 0, installs: 0, stars: 0, versions: 1, comments: 0 },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    latestVersion: null,
    ownerHandle: "owner",
  };
}

function makeSearchResult(slug: string, displayName: string) {
  const skill = makeListResult(slug, displayName).skill;
  return {
    id: `clawhub:${slug}`,
    source: "clawhub" as const,
    slug,
    displayName,
    summary: skill.summary,
    score: 1,
    canonicalUrl: `/owner/${slug}`,
    links: { canonical: `/owner/${slug}`, source: null },
    official: false,
    featured: false,
    publisher: null,
    install: { kind: "clawhub" as const, reference: slug, sourceUrl: null },
    sourceIdentity: { id: slug, owner: null, repo: null, host: null, lifetimeInstalls: null },
    trust: {
      visibility: "public" as const,
      installability: "installable" as const,
      clawHubVerdict: null,
      upstreamScanners: null,
      sourceFreshness: "native" as const,
    },
    metrics: { rolling60DayInstalls: null, bookmarks: null, updatedAt: skill.updatedAt },
    native: { skill, version: null, owner: null, ownerHandle: "owner" },
    ownerHandle: "owner",
    version: null,
    downloads: 0,
    updatedAt: skill.updatedAt,
  };
}
