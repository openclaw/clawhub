/* @vitest-environment jsdom */

import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  convexReactMocks,
  resetConvexReactMocks,
  setupDefaultConvexReactMocks,
} from "./helpers/convexReactMocks";

const fetchPluginCatalogMock = vi.fn();
const isRateLimitedPackageApiErrorMock = vi.fn(
  (error: unknown) =>
    typeof error === "object" && error !== null && (error as { status?: number }).status === 429,
);
const navigateMock = vi.fn();
const redirectMock = vi.fn((args: unknown) => {
  const error = new Error("redirect");
  Object.assign(error, { args });
  throw error;
});
let searchMock: Record<string, unknown> = {};
let loaderDataMock:
  | {
      items: Array<{
        name: string;
        displayName: string;
        family: "skill" | "code-plugin" | "bundle-plugin";
        channel: "official" | "community" | "private";
        isOfficial: boolean;
        summary?: string | null;
        ownerHandle?: string | null;
        latestVersion?: string | null;
        topics?: string[];
        stats?: { downloads: number; installs: number; stars: number; versions: number };
        createdAt: number;
        updatedAt: number;
      }>;
      nextCursor: string | null;
      rateLimited: boolean;
      retryAfterSeconds: number | null;
      totalCount?: number | null;
      isLoading?: boolean;
      apiError?: boolean;
    }
  | undefined;

vi.mock("@tanstack/react-router", () => ({
  createFileRoute:
    () => (config: { loader?: unknown; component?: unknown; validateSearch?: unknown }) => ({
      __config: config,
      useNavigate: () => navigateMock,
      useSearch: () => searchMock,
      useLoaderData: () => loaderDataMock,
    }),
  Link: (props: { children: ReactNode }) => <a href="/">{props.children}</a>,
  redirect: (args: unknown) => redirectMock(args),
}));

vi.mock("../lib/packageApi", () => ({
  fetchPluginCatalog: (...args: unknown[]) => fetchPluginCatalogMock(...args),
  isRateLimitedPackageApiError: (error: unknown) => isRateLimitedPackageApiErrorMock(error),
}));

vi.mock("convex/react", () => ({
  useQuery: (...args: unknown[]) => convexReactMocks.useQuery(...args),
}));

vi.mock("../../convex/_generated/api", () => ({
  api: {
    catalogTopics: {
      listTopByCategory: "catalogTopics:listTopByCategory",
    },
    packages: {
      countPublicPlugins: "packages:countPublicPlugins",
    },
  },
}));

async function loadRoute() {
  return (await import("../routes/plugins/index")).Route as unknown as {
    __config: {
      loader?: unknown;
      component?: ComponentType;
      pendingComponent?: ComponentType;
      validateSearch?: (search: Record<string, unknown>) => Record<string, unknown>;
    };
  };
}

describe("plugins route", () => {
  beforeEach(() => {
    fetchPluginCatalogMock.mockReset();
    fetchPluginCatalogMock.mockResolvedValue({ items: [], nextCursor: null });
    isRateLimitedPackageApiErrorMock.mockClear();
    resetConvexReactMocks();
    setupDefaultConvexReactMocks();
    navigateMock.mockReset();
    redirectMock.mockClear();
    searchMock = {};
    loaderDataMock = undefined;
  });

  it("rejects skill family filter in search state", async () => {
    const route = await loadRoute();
    const validateSearch = route.__config.validateSearch as (
      search: Record<string, unknown>,
    ) => Record<string, unknown>;

    expect(validateSearch({ family: "skill", q: "demo" })).toEqual({
      q: "demo",
      cursor: undefined,
      featured: undefined,
      official: undefined,
      sort: undefined,
      view: undefined,
    });
  });

  it("rejects bundle family filter while bundle UX is hidden", async () => {
    const route = await loadRoute();
    const validateSearch = route.__config.validateSearch as (
      search: Record<string, unknown>,
    ) => Record<string, unknown>;

    expect(validateSearch({ family: "bundle-plugin", q: "demo" })).toEqual({
      q: "demo",
      cursor: undefined,
      featured: undefined,
      official: undefined,
      sort: undefined,
      view: undefined,
    });
  });

  it("keeps legacy verified search params as official browse", async () => {
    const route = await loadRoute();
    const validateSearch = route.__config.validateSearch as (
      search: Record<string, unknown>,
    ) => Record<string, unknown>;

    expect(validateSearch({ verified: "1" })).toEqual({
      q: undefined,
      category: undefined,
      cursor: undefined,
      featured: undefined,
      official: true,
      sort: undefined,
      view: undefined,
    });
  });

  it("maps legacy category URLs before browsing", async () => {
    const route = await loadRoute();
    const validateSearch = route.__config.validateSearch as (
      search: Record<string, unknown>,
    ) => Record<string, unknown>;

    expect(validateSearch({ category: "data" })).toEqual(
      expect.objectContaining({ category: "tools" }),
    );
    expect(validateSearch({ category: "dev-tools" })).toEqual(
      expect.objectContaining({ category: "runtime" }),
    );
    expect(validateSearch({ category: "unknown" })).toEqual(
      expect.objectContaining({ category: undefined }),
    );
  });

  it("keeps validated legacy category URLs without a redundant redirect", async () => {
    const route = await loadRoute();
    const validateSearch = route.__config.validateSearch as (
      search: Record<string, unknown>,
    ) => Record<string, unknown>;
    const beforeLoad = (
      route.__config as never as {
        beforeLoad?: (args: { search: Record<string, unknown> }) => void;
      }
    ).beforeLoad;

    expect(() => beforeLoad?.({ search: validateSearch({ category: "data" }) })).not.toThrow();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("keeps downloads sort links and cursors in filtered plugin browse", async () => {
    const route = await loadRoute();
    const validateSearch = route.__config.validateSearch as (
      search: Record<string, unknown>,
    ) => Record<string, unknown>;

    expect(
      validateSearch({ category: "security", sort: "downloads", cursor: "download-cursor" }),
    ).toEqual(
      expect.objectContaining({
        category: "security",
        sort: "downloads",
        cursor: "download-cursor",
      }),
    );
  });

  it("drops legacy filtered browse cursors with implicit sort", async () => {
    const route = await loadRoute();
    const validateSearch = route.__config.validateSearch as (
      search: Record<string, unknown>,
    ) => Record<string, unknown>;

    expect(validateSearch({ category: "security", cursor: "legacy-install-cursor" })).toEqual(
      expect.objectContaining({
        category: "security",
        sort: undefined,
        cursor: undefined,
      }),
    );
  });

  it("drops legacy install sort cursors in plugin browse", async () => {
    const route = await loadRoute();
    const validateSearch = route.__config.validateSearch as (
      search: Record<string, unknown>,
    ) => Record<string, unknown>;

    expect(validateSearch({ sort: "installs", cursor: "legacy-install-cursor" })).toEqual(
      expect.objectContaining({
        sort: "downloads",
        cursor: undefined,
      }),
    );
  });

  it("redirects search-only sorts back to default when there is no query", async () => {
    const route = await loadRoute();
    const beforeLoad = (
      route.__config as never as {
        beforeLoad?: (args: { search: Record<string, unknown> }) => void;
      }
    ).beforeLoad;

    expect(() =>
      beforeLoad?.({
        search: { sort: "relevance" },
      }),
    ).toThrow();
  });

  it("keeps visible plugin sort choices when search is active", async () => {
    const route = await loadRoute();
    const beforeLoad = (
      route.__config as never as {
        beforeLoad?: (args: { search: Record<string, unknown> }) => void;
      }
    ).beforeLoad;

    expect(() =>
      beforeLoad?.({
        search: { q: "security", sort: "updated" },
      }),
    ).not.toThrow();
    expect(() =>
      beforeLoad?.({
        search: { q: "security", sort: "downloads" },
      }),
    ).not.toThrow();
    expect(() =>
      beforeLoad?.({
        search: { q: "security", sort: "newest" },
      }),
    ).toThrow();
    expect(() =>
      beforeLoad?.({
        search: { q: "security", sort: "name" },
      }),
    ).toThrow();
  });

  it("redirects hidden legacy plugin sort choices while search is active", async () => {
    const route = await loadRoute();
    const beforeLoad = (
      route.__config as never as {
        beforeLoad?: (args: { search: Record<string, unknown> }) => void;
      }
    ).beforeLoad;

    expect(() =>
      beforeLoad?.({
        search: { q: "security", sort: "newest" },
      }),
    ).toThrow();
    expect(() =>
      beforeLoad?.({
        search: { q: "security", sort: "name" },
      }),
    ).toThrow();
    expect(redirectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        search: expect.objectContaining({
          q: "security",
          sort: undefined,
        }),
      }),
    );
  });

  it("keeps hidden relevance sort URLs compatible while search is active", async () => {
    const route = await loadRoute();
    const beforeLoad = (
      route.__config as never as {
        beforeLoad?: (args: { search: Record<string, unknown> }) => void;
      }
    ).beforeLoad;

    expect(() =>
      beforeLoad?.({
        search: { q: "security", sort: "relevance" },
      }),
    ).not.toThrow();
  });

  it("keeps featured browse URLs when there is no search query", async () => {
    const route = await loadRoute();
    const beforeLoad = (
      route.__config as never as {
        beforeLoad?: (args: { search: Record<string, unknown> }) => void;
      }
    ).beforeLoad;

    expect(() =>
      beforeLoad?.({
        search: { featured: true, sort: "recommended" },
      }),
    ).not.toThrow();
  });

  it("redirects browse-only featured URLs when search is active", async () => {
    const route = await loadRoute();
    const beforeLoad = (
      route.__config as never as {
        beforeLoad?: (args: { search: Record<string, unknown> }) => void;
      }
    ).beforeLoad;

    expect(() =>
      beforeLoad?.({
        search: { q: "security", featured: true },
      }),
    ).toThrow();
  });

  it("preserves valid search sort when clearing stale featured URLs", async () => {
    const route = await loadRoute();
    const beforeLoad = (
      route.__config as never as {
        beforeLoad?: (args: { search: Record<string, unknown> }) => void;
      }
    ).beforeLoad;

    expect(() =>
      beforeLoad?.({
        search: { q: "security", sort: "updated", featured: true },
      }),
    ).toThrow();
    expect(redirectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        search: expect.objectContaining({
          featured: undefined,
          sort: "updated",
        }),
      }),
    );
  });

  it("uses grid as the canonical browse view in search state", async () => {
    const route = await loadRoute();
    const validateSearch = route.__config.validateSearch as (
      search: Record<string, unknown>,
    ) => Record<string, unknown>;

    expect(validateSearch({ view: "grid" })).toEqual(
      expect.objectContaining({
        view: "grid",
      }),
    );
  });

  it("keeps legacy cards URLs compatible with the grid view", async () => {
    const route = await loadRoute();
    const validateSearch = route.__config.validateSearch as (
      search: Record<string, unknown>,
    ) => Record<string, unknown>;

    expect(validateSearch({ view: "cards" })).toEqual(
      expect.objectContaining({
        view: "grid",
      }),
    );
  });

  it("forwards opaque cursors through catalog loading", async () => {
    fetchPluginCatalogMock.mockResolvedValue({ items: [], nextCursor: "cursor:next" });
    const { loadPluginsPageData } = await import("../routes/plugins/index");

    await loadPluginsPageData({
      cursor: "cursor:current",
    });

    expect(fetchPluginCatalogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: "cursor:current",
        limit: 25,
        sort: "downloads",
      }),
    );
    expect(fetchPluginCatalogMock.mock.calls[0]?.[0]).not.toHaveProperty("family");
  });

  it("uses downloads as the plugin browse ranking", async () => {
    fetchPluginCatalogMock.mockResolvedValue({ items: [], nextCursor: null });
    const { loadPluginsPageData } = await import("../routes/plugins/index");

    await loadPluginsPageData({});

    expect(fetchPluginCatalogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sort: "downloads",
        limit: 25,
      }),
    );
  });

  it("uses relevance fetching for sorted search results", async () => {
    fetchPluginCatalogMock.mockResolvedValue({ items: [], nextCursor: "cursor:next" });
    const { loadPluginsPageData } = await import("../routes/plugins/index");

    await loadPluginsPageData({
      q: "security",
      sort: "downloads",
      cursor: "cursor:search",
    });

    expect(fetchPluginCatalogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        q: "security",
        cursor: undefined,
        limit: 25,
      }),
    );
    expect(fetchPluginCatalogMock.mock.calls[0]?.[0]).not.toHaveProperty("sort");
  });

  it("forwards explicit plugin browse sorts", async () => {
    fetchPluginCatalogMock.mockResolvedValue({ items: [], nextCursor: null });
    const { loadPluginsPageData } = await import("../routes/plugins/index");

    await loadPluginsPageData({
      sort: "downloads",
    });

    expect(fetchPluginCatalogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sort: "downloads",
        limit: 25,
      }),
    );

    await loadPluginsPageData({
      sort: "updated",
    });

    expect(fetchPluginCatalogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sort: "updated",
        limit: 25,
      }),
    );
  });

  it("forwards category and topic through catalog loading without changing the query", async () => {
    fetchPluginCatalogMock.mockResolvedValue({ items: [], nextCursor: null });
    const { loadPluginsPageData } = await import("../routes/plugins/index");

    await loadPluginsPageData({
      q: "api",
      category: "tools",
      topic: "postgres",
    });

    expect(fetchPluginCatalogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        q: "api",
        category: "tools",
        topic: "postgres",
        officialFirst: false,
        cursor: undefined,
        limit: 25,
      }),
    );
  });

  it("requests official-first pagination for category browse", async () => {
    fetchPluginCatalogMock.mockResolvedValue({ items: [], nextCursor: null });
    const { loadPluginsPageData } = await import("../routes/plugins/index");

    await loadPluginsPageData({ category: "security" });

    expect(fetchPluginCatalogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "security",
        officialFirst: true,
      }),
    );
  });

  it("loads the next plugin page from horizontal browse controls", async () => {
    loaderDataMock = {
      items: [
        {
          name: "demo-plugin",
          displayName: "Demo Plugin",
          family: "code-plugin",
          channel: "community",
          isOfficial: false,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      nextCursor: "cursor:next",
      rateLimited: false,
      retryAfterSeconds: null,
    };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.getByRole("heading", { name: "Plugins" })).toBeTruthy();
    expect(screen.queryByText("1+ results")).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    });

    expect(fetchPluginCatalogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: "cursor:next",
      }),
    );
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("keeps downloads sort in filtered load-more requests", async () => {
    searchMock = { category: "security" };
    loaderDataMock = {
      items: [
        {
          name: "demo-plugin",
          displayName: "Demo Plugin",
          family: "code-plugin",
          channel: "community",
          isOfficial: false,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      nextCursor: "cursor:next",
      rateLimited: false,
      retryAfterSeconds: null,
    };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    });

    expect(fetchPluginCatalogMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        category: "security",
        cursor: "cursor:next",
        sort: "downloads",
      }),
    );
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("renders plugin download counts in browse results", async () => {
    loaderDataMock = {
      items: [
        {
          name: "demo-plugin",
          displayName: "Demo Plugin",
          family: "code-plugin",
          channel: "community",
          isOfficial: false,
          createdAt: 1,
          updatedAt: 1,
          stats: { downloads: 1_234, installs: 9, stars: 0, versions: 1 },
        },
      ],
      nextCursor: null,
      rateLimited: false,
      retryAfterSeconds: null,
    };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.getByText("1.2k")).toBeTruthy();
  });

  it("renders the browse shell immediately while catalog data loads", async () => {
    const item = {
      name: "demo-plugin",
      displayName: "Demo Plugin",
      family: "code-plugin" as const,
      channel: "community" as const,
      isOfficial: false,
      createdAt: 1,
      updatedAt: 1,
    };
    let resolveCatalog: (value: {
      items: (typeof item)[];
      nextCursor: string | null;
      totalCount: number;
    }) => void = () => {};
    fetchPluginCatalogMock.mockReturnValue(
      new Promise((resolve) => {
        resolveCatalog = resolve;
      }),
    );
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.getByRole("heading", { name: "Plugins" })).toBeTruthy();
    expect(screen.getByRole("status", { name: "Loading results" })).toBeTruthy();
    resolveCatalog({ items: [item], nextCursor: null, totalCount: 321 });

    expect(await screen.findByText("Demo Plugin")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Plugins 321" })).toBeTruthy();
  });

  it("keeps plugin count copy hidden on non-first browse pages", async () => {
    searchMock = { cursor: "cursor:current" };
    loaderDataMock = {
      items: [
        {
          name: "demo-plugin",
          displayName: "Demo Plugin",
          family: "code-plugin",
          channel: "community",
          isOfficial: false,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      nextCursor: "cursor:next",
      rateLimited: false,
      retryAfterSeconds: null,
    };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.getByRole("heading", { name: "Plugins" })).toBeTruthy();
    expect(screen.queryByText("1 shown")).toBeNull();
    expect(screen.queryByText("1 result shown")).toBeNull();
  });

  it("renders the total plugin count in the unfiltered page title", async () => {
    loaderDataMock = {
      items: [
        {
          name: "demo-plugin",
          displayName: "Demo Plugin",
          family: "code-plugin",
          channel: "community",
          isOfficial: false,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      nextCursor: null,
      totalCount: 321,
      rateLimited: false,
      retryAfterSeconds: null,
    };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.getByRole("heading", { name: "Plugins 321" })).toBeTruthy();
  });

  it("falls back to the Convex plugin count when catalog data has no total", async () => {
    convexReactMocks.useQuery.mockReturnValue(333);
    loaderDataMock = {
      items: [],
      nextCursor: null,
      totalCount: null,
      rateLimited: false,
      retryAfterSeconds: null,
    };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.getByRole("heading", { name: "Plugins 333" })).toBeTruthy();
  });

  it("hides the total plugin count when filters are active", async () => {
    searchMock = { official: true };
    loaderDataMock = {
      items: [],
      nextCursor: null,
      totalCount: 321,
      rateLimited: false,
      retryAfterSeconds: null,
    };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.getByRole("heading", { name: "Plugins" })).toBeTruthy();
    expect(screen.queryByText("321")).toBeNull();
  });

  it("does not render an active topic in the sidebar when it has no results", async () => {
    searchMock = { topic: "postgres" };
    loaderDataMock = {
      items: [],
      nextCursor: null,
      rateLimited: false,
      retryAfterSeconds: null,
    };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.queryByRole("radio", { name: "postgres" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "All topics" })).toBeNull();
  });

  it("shows category topic chips and filters plugins by the selected topic", async () => {
    searchMock = { category: "runtime" };
    loaderDataMock = {
      items: [],
      nextCursor: null,
      rateLimited: false,
      retryAfterSeconds: null,
    };
    convexReactMocks.useQuery.mockImplementation((_reference, args) => {
      if (
        args &&
        typeof args === "object" &&
        "kind" in args &&
        (args as { kind?: string }).kind === "plugin"
      ) {
        return ["docker", "typescript", "github", "debugging", "coding"];
      }
      return null;
    });
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.getAllByRole("button", { name: /^#/ })).toHaveLength(5);
    fireEvent.click(screen.getByRole("button", { name: "#docker" }));

    const lastCall = navigateMock.mock.calls.at(-1)?.[0] as {
      search: (prev: Record<string, unknown>) => Record<string, unknown>;
      replace?: boolean;
    };
    expect(lastCall.search({ category: "runtime" })).toEqual({
      category: "runtime",
      cursor: undefined,
      family: undefined,
      topic: "docker",
    });
    expect(lastCall.replace).toBe(true);
  });

  it("renders a label-only title without positive count data and switches to grid view", async () => {
    loaderDataMock = {
      items: [
        {
          name: "demo-plugin",
          displayName: "Demo Plugin",
          family: "code-plugin",
          channel: "community",
          isOfficial: false,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      nextCursor: null,
      rateLimited: false,
      retryAfterSeconds: null,
    };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.getByRole("heading", { name: "Plugins" })).toBeTruthy();
    expect(screen.queryByText("1")).toBeNull();
    expect(screen.getByRole("button", { name: "List" }).closest(".browse-controls")).not.toBeNull();
    expect(document.querySelector(".browse-results-toolbar .browse-view-toggle")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Grid" }));

    expect(navigateMock).toHaveBeenCalled();
    const lastCall = navigateMock.mock.calls.at(-1)?.[0] as {
      replace?: boolean;
      search: (prev: Record<string, unknown>) => Record<string, unknown>;
    };
    expect(lastCall.replace).toBe(true);
    expect(lastCall.search({})).toEqual({
      view: "grid",
    });
  });

  it("does not render the publish CTA on the plugins browse page", async () => {
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.queryByRole("link", { name: "Publish" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
  });

  it("renders browse skeletons while the plugins route is pending", async () => {
    const route = await loadRoute();
    const PendingComponent = route.__config.pendingComponent as ComponentType;

    render(<PendingComponent />);

    expect(screen.getByRole("status", { name: "Loading results" })).toBeTruthy();
    expect(screen.queryByText("Unable to load plugins")).toBeNull();
  });

  it("switches legacy cards URLs back to list view", async () => {
    searchMock = { view: "cards" };
    loaderDataMock = {
      items: [
        {
          name: "demo-plugin",
          displayName: "Demo Plugin",
          family: "code-plugin",
          channel: "community",
          isOfficial: false,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      nextCursor: null,
      rateLimited: false,
      retryAfterSeconds: null,
    };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

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

  it("preserves catalog results during catalog loading", async () => {
    fetchPluginCatalogMock.mockResolvedValue({
      items: [
        {
          name: "my-skill",
          displayName: "My Skill",
          family: "skill",
          channel: "community",
          isOfficial: false,
          createdAt: 1,
          updatedAt: 1,
        },
        {
          name: "my-plugin",
          displayName: "My Plugin",
          family: "code-plugin",
          channel: "community",
          isOfficial: false,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      nextCursor: null,
    });
    const { loadPluginsPageData } = await import("../routes/plugins/index");

    const result = await loadPluginsPageData({});

    expect(result.items).toHaveLength(2);
  });

  it("uses plugin-only catalog fetching for official browse", async () => {
    fetchPluginCatalogMock.mockResolvedValue({ items: [], nextCursor: null });
    const { loadPluginsPageData } = await import("../routes/plugins/index");

    await loadPluginsPageData({
      official: true,
    });

    expect(fetchPluginCatalogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        isOfficial: true,
        sort: "downloads",
        limit: 25,
      }),
    );
    expect(fetchPluginCatalogMock.mock.calls[0]?.[0]).not.toHaveProperty("family");
  });

  it("preserves featured browse when selecting All from the plugin tab group", async () => {
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    fireEvent.click(screen.getByRole("radio", { name: "All" }));

    expect(navigateMock).toHaveBeenCalled();
    const lastCall = navigateMock.mock.calls.at(-1)?.[0] as {
      replace?: boolean;
      search: (prev: Record<string, unknown>) => Record<string, unknown>;
    };
    expect(lastCall.replace).toBe(true);
    expect(
      lastCall.search({
        family: "code-plugin",
        cursor: "cursor:current",
        featured: true,
        sort: "updated",
      }),
    ).toEqual({
      family: undefined,
      cursor: undefined,
      featured: true,
      sort: "downloads",
    });
  });

  it("keeps downloads explicit when selected from filtered plugin browse", async () => {
    searchMock = { category: "security" };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    fireEvent.click(screen.getByRole("radio", { name: "All" }));

    const lastCall = navigateMock.mock.calls.at(-1)?.[0] as {
      replace?: boolean;
      search: (prev: Record<string, unknown>) => Record<string, unknown>;
    };
    expect(lastCall.replace).toBe(true);
    expect(lastCall.search({ category: "security", cursor: "cursor:current" })).toEqual({
      category: "security",
      cursor: undefined,
      family: undefined,
      featured: undefined,
      sort: "downloads",
    });
  });

  it("returns a retryable empty state when the catalog is rate limited", async () => {
    fetchPluginCatalogMock.mockRejectedValue({ status: 429, retryAfterSeconds: 22 });
    const { loadPluginsPageData } = await import("../routes/plugins/index");

    const result = await loadPluginsPageData({});

    expect(result).toEqual({
      items: [],
      nextCursor: null,
      rateLimited: true,
      retryAfterSeconds: 22,
      totalCount: null,
      isLoading: false,
      apiError: false,
    });
  });

  it("flags API errors for filtered catalog requests", async () => {
    fetchPluginCatalogMock.mockRejectedValue(new Error("boom"));
    const { loadPluginsPageData } = await import("../routes/plugins/index");

    const result = await loadPluginsPageData({
      q: "demo",
    });

    expect(result).toEqual({
      items: [],
      nextCursor: null,
      rateLimited: false,
      retryAfterSeconds: null,
      totalCount: null,
      isLoading: false,
      apiError: true,
    });
  });

  it("flags browser network failures instead of leaving plugin loading stuck", async () => {
    fetchPluginCatalogMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const { loadPluginsPageData } = await import("../routes/plugins/index");

    const result = await loadPluginsPageData({});

    expect(result).toEqual({
      items: [],
      nextCursor: null,
      rateLimited: false,
      retryAfterSeconds: null,
      totalCount: null,
      isLoading: false,
      apiError: true,
    });
  });

  it("rethrows aborted plugin catalog requests", async () => {
    const controller = new AbortController();
    controller.abort();
    const abortError = new DOMException("The operation was aborted.", "AbortError");
    fetchPluginCatalogMock.mockRejectedValue(abortError);
    const { loadPluginsPageData } = await import("../routes/plugins/index");

    await expect(loadPluginsPageData({ signal: controller.signal })).rejects.toBe(abortError);
  });

  it("renders a rate-limit message instead of the global error boundary state", async () => {
    loaderDataMock = {
      items: [],
      nextCursor: null,
      rateLimited: true,
      retryAfterSeconds: 22,
    };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.getByText("Plugin catalog is temporarily unavailable")).toBeTruthy();
    expect(screen.getByText(/Try again in about 22 seconds/i)).toBeTruthy();
  });

  it("parses supported sort values without inventing a URL default", async () => {
    const route = await loadRoute();
    const validateSearch = route.__config.validateSearch as (
      search: Record<string, unknown>,
    ) => Record<string, unknown>;

    expect(validateSearch({ sort: "updated" })).toEqual(
      expect.objectContaining({ sort: "updated" }),
    );
    expect(validateSearch({ sort: "recommended" })).toEqual(
      expect.objectContaining({ sort: "recommended" }),
    );
    expect(validateSearch({ sort: "installs" })).toEqual(
      expect.objectContaining({ sort: "downloads" }),
    );
    expect(validateSearch({ sort: "relevance" })).toEqual(
      expect.objectContaining({ sort: "relevance" }),
    );
    expect(validateSearch({ sort: "invalid" })).toEqual(
      expect.objectContaining({ sort: undefined }),
    );
    expect(validateSearch({ sort: "newest" })).toEqual(expect.objectContaining({ sort: "newest" }));
    expect(validateSearch({ sort: "name" })).toEqual(expect.objectContaining({ sort: "name" }));
    expect(validateSearch({})).toEqual(expect.objectContaining({ sort: undefined }));
  });

  it("selects a category from the horizontal controls without rewriting search text", async () => {
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    fireEvent.click(screen.getByRole("combobox", { name: "Category" }));
    fireEvent.click(screen.getByRole("radio", { name: "Security" }));

    expect(navigateMock).toHaveBeenCalled();
    const lastCall = navigateMock.mock.calls.at(-1)?.[0] as {
      search: (prev: Record<string, unknown>) => Record<string, unknown>;
    };
    expect(lastCall.search({})).toEqual(
      expect.objectContaining({
        cursor: undefined,
        family: undefined,
        category: "security",
        featured: undefined,
        sort: undefined,
      }),
    );
    expect(lastCall.search({ q: "api" })).toEqual(
      expect.objectContaining({
        q: "api",
        category: "security",
      }),
    );
  });

  it("preserves backend official-first ordering on category pages", async () => {
    searchMock = { category: "security" };
    loaderDataMock = {
      items: [
        {
          name: "official-security",
          displayName: "Official Security",
          family: "code-plugin",
          channel: "official",
          isOfficial: true,
          createdAt: 1,
          updatedAt: 1,
        },
        {
          name: "community-security",
          displayName: "Community Security",
          family: "code-plugin",
          channel: "community",
          isOfficial: false,
          createdAt: 2,
          updatedAt: 2,
        },
      ],
      nextCursor: null,
      rateLimited: false,
      retryAfterSeconds: null,
    };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    const titles = Array.from(document.querySelectorAll(".skill-list-item-name")).map(
      (node) => node.textContent,
    );
    expect(titles).toEqual(["Official Security", "Community Security"]);
  });

  it("does not render retired plugin categories", async () => {
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.queryByRole("radio", { name: "Integrations" })).toBeNull();
  });

  it("submitting search clears browse-only state", async () => {
    searchMock = { featured: true, sort: "updated" };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    const input = screen.getByPlaceholderText("Search plugins...");
    fireEvent.change(input, { target: { value: "security" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);

    expect(navigateMock).toHaveBeenCalled();
    const lastCall = navigateMock.mock.calls.at(-1)?.[0] as {
      search: (prev: Record<string, unknown>) => Record<string, unknown>;
    };
    expect(
      lastCall.search({
        cursor: "cursor:current",
        family: "code-plugin",
        featured: true,
        sort: "updated",
      }),
    ).toEqual({
      cursor: undefined,
      family: undefined,
      featured: undefined,
      q: "security",
      sort: undefined,
    });
  });

  it("updates plugin search while typing", async () => {
    vi.useFakeTimers();
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    const input = screen.getByPlaceholderText("Search plugins...");
    fireEvent.change(input, { target: { value: "github" } });
    expect(navigateMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(navigateMock).toHaveBeenCalled();
    const lastCall = navigateMock.mock.calls.at(-1)?.[0] as {
      replace?: boolean;
      search: (prev: Record<string, unknown>) => Record<string, unknown>;
    };
    expect(lastCall.replace).toBe(true);
    expect(
      lastCall.search({
        cursor: "cursor:current",
        family: "code-plugin",
        featured: true,
        sort: "updated",
      }),
    ).toEqual({
      cursor: undefined,
      family: undefined,
      featured: undefined,
      q: "github",
      sort: undefined,
    });
    vi.useRealTimers();
  });

  it("clears plugin search from the search field", async () => {
    searchMock = {
      q: "github",
      cursor: "cursor:current",
      sort: "name",
      category: "security",
    };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    fireEvent.click(screen.getByRole("button", { name: "Close search" }));

    expect(navigateMock).toHaveBeenCalled();
    const lastCall = navigateMock.mock.calls.at(-1)?.[0] as {
      search: (prev: Record<string, unknown>) => Record<string, unknown>;
      replace?: boolean;
    };
    expect(
      lastCall.search({
        q: "github",
        cursor: "cursor:current",
        sort: "name",
        category: "security",
      }),
    ).toEqual({
      q: undefined,
      cursor: undefined,
      sort: undefined,
      category: "security",
    });
    expect(lastCall.replace).toBe(true);
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
  });

  it("keeps browse sort choices when only a category is active", async () => {
    searchMock = { category: "security" };
    loaderDataMock = {
      items: [
        {
          name: "demo-plugin",
          displayName: "Demo Plugin",
          family: "code-plugin",
          channel: "community",
          isOfficial: false,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      nextCursor: null,
      rateLimited: false,
      retryAfterSeconds: null,
    };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.getByRole("radio", { name: "All" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "Verified" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Updated" })).toBeTruthy();
    expect(screen.queryByRole("radio", { name: "Relevance" })).toBeNull();
  });

  it("keeps featured browse active when selecting All", async () => {
    searchMock = { featured: true };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    fireEvent.click(screen.getByRole("radio", { name: "All" }));

    const lastCall = navigateMock.mock.calls.at(-1)?.[0] as {
      search: (prev: Record<string, unknown>) => Record<string, unknown>;
    };
    expect(lastCall.search({ featured: true, cursor: "cursor:current" })).toEqual({
      featured: true,
      cursor: undefined,
      family: undefined,
      sort: "downloads",
    });
  });

  it("selects visible search sort without changing the query", async () => {
    searchMock = { q: "security" };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    fireEvent.click(screen.getByRole("radio", { name: "All" }));

    const lastCall = navigateMock.mock.calls.at(-1)?.[0] as {
      search: (prev: Record<string, unknown>) => Record<string, unknown>;
    };
    expect(lastCall.search({ q: "security", cursor: "cursor:current" })).toEqual({
      q: "security",
      cursor: undefined,
      family: undefined,
      featured: undefined,
      sort: "downloads",
    });
  });

  it("sorts loaded search results by the selected search sort", async () => {
    searchMock = { q: "security", sort: "downloads" };
    loaderDataMock = {
      items: [
        {
          name: "zulu-plugin",
          displayName: "Zulu Plugin",
          family: "code-plugin",
          channel: "community",
          isOfficial: false,
          createdAt: 2,
          updatedAt: 20,
          stats: { downloads: 1, installs: 10, stars: 0, versions: 1 },
        },
        {
          name: "alpha-plugin",
          displayName: "Alpha Plugin",
          family: "code-plugin",
          channel: "community",
          isOfficial: false,
          createdAt: 1,
          updatedAt: 10,
          stats: { downloads: 10, installs: 1, stars: 0, versions: 1 },
        },
      ],
      nextCursor: null,
      rateLimited: false,
      retryAfterSeconds: null,
    };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    const alpha = screen.getByText("Alpha Plugin");
    const zulu = screen.getByText("Zulu Plugin");
    expect(alpha.compareDocumentPosition(zulu) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("sorts loaded search results by download count", async () => {
    searchMock = { q: "security", sort: "downloads" };
    loaderDataMock = {
      items: [
        {
          name: "zulu-plugin",
          displayName: "Zulu Plugin",
          family: "code-plugin",
          channel: "community",
          isOfficial: false,
          createdAt: 2,
          updatedAt: 20,
          stats: { downloads: 10, installs: 1, stars: 0, versions: 1 },
        },
        {
          name: "alpha-plugin",
          displayName: "Alpha Plugin",
          family: "code-plugin",
          channel: "community",
          isOfficial: false,
          createdAt: 1,
          updatedAt: 10,
          stats: { downloads: 1, installs: 10, stars: 0, versions: 1 },
        },
      ],
      nextCursor: null,
      rateLimited: false,
      retryAfterSeconds: null,
    };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    const zulu = screen.getByText("Zulu Plugin");
    const alpha = screen.getByText("Alpha Plugin");
    expect(zulu.compareDocumentPosition(alpha) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps search sort visible even if a stale featured flag is present", async () => {
    searchMock = { q: "security", featured: true };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.getByRole("radio", { name: "All" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByRole("radio", { name: "Featured" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "Relevance" })).toBeNull();
  });

  it("keeps plugin sort options stable while searching", async () => {
    searchMock = { q: "security" };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    const sortOptions = Array.from(
      screen.getByRole("radiogroup", { name: "Sort order" }).querySelectorAll('[role="radio"]'),
    ).map((option) => option.textContent);
    expect(sortOptions).toEqual(["All", "Verified", "Updated"]);
    expect(screen.queryByRole("radio", { name: "Most downloaded" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "Newest" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "Name" })).toBeNull();
  });

  it("puts the default plugin sort first", async () => {
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    const sortOptions = Array.from(
      screen.getByRole("radiogroup", { name: "Sort order" }).querySelectorAll('[role="radio"]'),
    ).map((option) => option.textContent);
    expect(sortOptions[0]).toBe("All");
    expect(screen.getByRole("radio", { name: "All" }).getAttribute("aria-checked")).toBe("true");
  });
});
