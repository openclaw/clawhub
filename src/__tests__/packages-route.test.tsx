/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchPluginCatalogMock = vi.fn();
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
    isRateLimitedPackageApiErrorMock.mockClear();
    navigateMock.mockReset();
    searchMock = {};
    loaderDataMock = { items: [], nextCursor: null, rateLimited: false, retryAfterSeconds: null };
  });

  it("rejects skill family filter in search state", async () => {
    const route = await loadRoute();
    const validateSearch = route.__config.validateSearch as (
      search: Record<string, unknown>,
    ) => Record<string, unknown>;

    expect(validateSearch({ family: "skill", q: "demo" })).toEqual({
      family: undefined,
      q: "demo",
      cursor: undefined,
      verified: undefined,
      executesCode: undefined,
    });
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
        family: "code-plugin",
      },
    });

    expect(fetchPluginCatalogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: "cursor:current",
        family: "code-plugin",
        limit: 50,
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
    expect(lastCall.search({ family: "code-plugin" })).toEqual({
      family: "code-plugin",
      cursor: "cursor:next",
    });
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
        family: undefined,
        isOfficial: true,
        limit: 50,
      }),
    );
  });

  it("returns a retryable empty state when the catalog is rate limited", async () => {
    fetchPluginCatalogMock.mockRejectedValue({ status: 429, retryAfterSeconds: 22 });
    const route = await loadRoute();
    const loader = route.__config.loader as (args: {
      deps: Record<string, unknown>;
    }) => Promise<{
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
});
