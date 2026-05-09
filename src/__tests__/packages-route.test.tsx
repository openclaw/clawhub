/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchPluginCatalogMock = vi.fn();
const fetchFeaturedPluginsMock = vi.fn();
const isRateLimitedPackageApiErrorMock = vi.fn(
  (error: unknown) =>
    typeof error === "object" && error !== null && (error as { status?: number }).status === 429,
);
const navigateMock = vi.fn();
let searchMock: Record<string, unknown> = {};
let loaderDataMock: {
  items: Array<{
    name: string;
    displayName: string;
    family: "skill" | "code-plugin" | "bundle-plugin";
    channel: "official" | "community" | "private";
    isOfficial: boolean;
    executesCode?: boolean;
    summary?: string | null;
    ownerHandle?: string | null;
    latestVersion?: string | null;
    createdAt: number;
    updatedAt: number;
  }>;
  nextCursor: string | null;
  rateLimited: boolean;
  retryAfterSeconds: number | null;
  apiError?: boolean;
} = {
  items: [],
  nextCursor: null,
  rateLimited: false,
  retryAfterSeconds: null,
};

vi.mock("@tanstack/react-router", () => ({
  createFileRoute:
    () =>
    (config: {
      loader?: (args: { deps: Record<string, unknown> }) => Promise<unknown>;
      component?: unknown;
      validateSearch?: unknown;
    }) => ({
      __config: config,
      useNavigate: () => navigateMock,
      useSearch: () => searchMock,
      useLoaderData: () => loaderDataMock,
    }),
  Link: (props: { children: ReactNode }) => <a href="/">{props.children}</a>,
}));

vi.mock("../lib/packageApi", () => ({
  fetchPluginCatalog: (...args: unknown[]) => fetchPluginCatalogMock(...args),
  isRateLimitedPackageApiError: (error: unknown) => isRateLimitedPackageApiErrorMock(error),
}));

vi.mock("../lib/featuredCatalog", () => ({
  fetchFeaturedPlugins: (...args: unknown[]) => fetchFeaturedPluginsMock(...args),
}));

async function loadRoute() {
  return (await import("../routes/plugins/index")).Route as unknown as {
    __config: {
      loader?: (args: { deps: Record<string, unknown> }) => Promise<unknown>;
      component?: ComponentType;
      validateSearch?: (search: Record<string, unknown>) => Record<string, unknown>;
    };
  };
}

describe("plugins route", () => {
  beforeEach(() => {
    fetchPluginCatalogMock.mockReset();
    fetchFeaturedPluginsMock.mockReset();
    isRateLimitedPackageApiErrorMock.mockClear();
    navigateMock.mockReset();
    searchMock = {};
    loaderDataMock = {
      items: [],
      nextCursor: null,
      rateLimited: false,
      retryAfterSeconds: null,
      apiError: false,
    };
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
      verified: undefined,
      executesCode: undefined,
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
      verified: undefined,
      executesCode: undefined,
      sort: undefined,
      view: undefined,
    });
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

  it("keeps API-backed search sorts when search is active", async () => {
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
        search: { q: "security", sort: "newest" },
      }),
    ).not.toThrow();
    expect(() =>
      beforeLoad?.({
        search: { q: "security", sort: "name" },
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

  it("forwards opaque cursors through the loader", async () => {
    fetchPluginCatalogMock.mockResolvedValue({ items: [], nextCursor: "cursor:next" });
    const route = await loadRoute();
    const loader = route.__config.loader as (args: {
      deps: Record<string, unknown>;
    }) => Promise<unknown>;

    await loader({
      deps: {
        cursor: "cursor:current",
      },
    });

    expect(fetchPluginCatalogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: "cursor:current",
        limit: 100,
      }),
    );
    expect(fetchPluginCatalogMock.mock.calls[0]?.[0]).not.toHaveProperty("family");
  });

  it("forwards sorted search cursors through the loader", async () => {
    fetchPluginCatalogMock.mockResolvedValue({ items: [], nextCursor: "cursor:next" });
    const route = await loadRoute();
    const loader = route.__config.loader as (args: {
      deps: Record<string, unknown>;
    }) => Promise<unknown>;

    await loader({
      deps: {
        q: "security",
        sort: "name",
        cursor: "cursor:search",
      },
    });

    expect(fetchPluginCatalogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        q: "security",
        sort: "name",
        cursor: "cursor:search",
        limit: 100,
      }),
    );
  });

  it("renders next-page controls for browse mode", async () => {
    loaderDataMock = {
      items: [
        {
          name: "demo-plugin",
          displayName: "Demo Plugin",
          family: "code-plugin",
          channel: "community",
          isOfficial: false,
          executesCode: true,
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

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));

    expect(navigateMock).toHaveBeenCalled();
    const lastCall = navigateMock.mock.calls.at(-1)?.[0] as {
      search: (prev: Record<string, unknown>) => Record<string, unknown>;
    };
    expect(lastCall.search({})).toEqual({
      cursor: "cursor:next",
    });
  });

  it("renders a title count and switches to grid view", async () => {
    loaderDataMock = {
      items: [
        {
          name: "demo-plugin",
          displayName: "Demo Plugin",
          family: "code-plugin",
          channel: "community",
          isOfficial: false,
          executesCode: true,
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

    expect(screen.getByRole("heading", { name: "Plugins 1" })).toBeTruthy();

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
          executesCode: true,
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

  it("filters out skills from loader results", async () => {
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
    const route = await loadRoute();
    const loader = route.__config.loader as (args: {
      deps: Record<string, unknown>;
    }) => Promise<{ items: Array<{ name: string }>; nextCursor: string | null }>;

    const result = await loader({ deps: {} });

    expect(result.items).toHaveLength(2);
  });

  it("uses plugin-only catalog fetching for verified browse", async () => {
    fetchPluginCatalogMock.mockResolvedValue({ items: [], nextCursor: null });
    const route = await loadRoute();
    const loader = route.__config.loader as (args: {
      deps: Record<string, unknown>;
    }) => Promise<unknown>;

    await loader({
      deps: {
        verified: true,
      },
    });

    expect(fetchPluginCatalogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        isOfficial: true,
        limit: 100,
      }),
    );
    expect(fetchPluginCatalogMock.mock.calls[0]?.[0]).not.toHaveProperty("family");
  });

  it("selects featured from the sort group", async () => {
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    fireEvent.click(screen.getByRole("radio", { name: "Featured" }));

    expect(navigateMock).toHaveBeenCalled();
    const lastCall = navigateMock.mock.calls.at(-1)?.[0] as {
      search: (prev: Record<string, unknown>) => Record<string, unknown>;
    };
    expect(lastCall.search({ family: "code-plugin", cursor: "cursor:current" })).toEqual({
      family: undefined,
      cursor: undefined,
      featured: true,
      q: undefined,
      sort: undefined,
    });
  });

  it("returns a retryable empty state when the catalog is rate limited", async () => {
    fetchPluginCatalogMock.mockRejectedValue({ status: 429, retryAfterSeconds: 22 });
    const route = await loadRoute();
    const loader = route.__config.loader as (args: { deps: Record<string, unknown> }) => Promise<{
      items: Array<{ name: string }>;
      nextCursor: string | null;
      rateLimited: boolean;
      retryAfterSeconds: number | null;
    }>;

    const result = await loader({ deps: {} });

    expect(result).toEqual({
      items: [],
      nextCursor: null,
      rateLimited: true,
      retryAfterSeconds: 22,
      apiError: false,
    });
  });

  it("flags API errors for filtered catalog requests", async () => {
    fetchPluginCatalogMock.mockRejectedValue(new Error("boom"));
    const route = await loadRoute();
    const loader = route.__config.loader as (args: { deps: Record<string, unknown> }) => Promise<{
      items: Array<{ name: string }>;
      nextCursor: string | null;
      rateLimited: boolean;
      retryAfterSeconds: number | null;
      apiError?: boolean;
    }>;

    const result = await loader({
      deps: {
        q: "demo",
        executesCode: true,
      },
    });

    expect(result).toEqual({
      items: [],
      nextCursor: null,
      rateLimited: false,
      retryAfterSeconds: null,
      apiError: true,
    });
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

  it("selects a category from the sidebar and searches by keyword", async () => {
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    fireEvent.click(screen.getByRole("radio", { name: "Security" }));

    expect(navigateMock).toHaveBeenCalled();
    const lastCall = navigateMock.mock.calls.at(-1)?.[0] as {
      search: (prev: Record<string, unknown>) => Record<string, unknown>;
    };
    expect(lastCall.search({})).toEqual(
      expect.objectContaining({
        q: "security",
        cursor: undefined,
        family: undefined,
        featured: undefined,
        sort: undefined,
      }),
    );
  });

  it("does not render unsupported plugin categories", async () => {
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.queryByRole("radio", { name: "Other" })).toBeNull();
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

  it("shows API-backed sort choices when a category query is active", async () => {
    searchMock = { q: "security" };
    loaderDataMock = {
      items: [
        {
          name: "demo-plugin",
          displayName: "Demo Plugin",
          family: "code-plugin",
          channel: "community",
          isOfficial: false,
          executesCode: true,
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

    expect(screen.getByRole("radio", { name: "Relevance" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Recently updated" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Newest" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Name" })).toBeTruthy();
  });

  it("selects API-backed search sort without changing the query", async () => {
    searchMock = { q: "security" };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    fireEvent.click(screen.getByRole("radio", { name: "Name" }));

    const lastCall = navigateMock.mock.calls.at(-1)?.[0] as {
      search: (prev: Record<string, unknown>) => Record<string, unknown>;
    };
    expect(lastCall.search({ q: "security", cursor: "cursor:current" })).toEqual({
      q: "security",
      cursor: undefined,
      family: undefined,
      featured: undefined,
      sort: "name",
    });
  });

  it("keeps search sort visible even if a stale featured flag is present", async () => {
    searchMock = { q: "security", featured: true };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.getByRole("radio", { name: "Relevance" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(screen.queryByRole("radio", { name: "Featured" })).toBeNull();
  });
});
