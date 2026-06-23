/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { loaderDataMock, navigateMock, queryMock, searchMock } = vi.hoisted(() => ({
  loaderDataMock: vi.fn(),
  navigateMock: vi.fn(),
  queryMock: vi.fn(),
  searchMock: vi.fn(),
}));

vi.mock("../convex/client", () => ({
  convexHttp: { query: (...args: unknown[]) => queryMock(...args) },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute:
    () =>
    (config: {
      component?: unknown;
      head?: unknown;
      loader?: unknown;
      loaderDeps?: unknown;
      validateSearch?: unknown;
    }) => ({
      __config: config,
      useLoaderData: () => loaderDataMock(),
      useNavigate: () => navigateMock,
      useSearch: () => searchMock(),
    }),
  Link: ({
    children,
    className,
    resetScroll: _resetScroll,
    to,
    ...props
  }: {
    children: ReactNode;
    className?: string;
    resetScroll?: boolean;
    to?: string;
    "aria-label"?: string;
  }) => (
    <a className={className} href={to} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("../components/PublisherListItem", () => ({
  PublisherListItem: ({ publisher }: { publisher: { _id: string } }) => <div>{publisher._id}</div>,
}));

vi.mock("../lib/site", () => ({
  SITE_NAME: "ClawHub",
  getClawHubSiteUrl: () => "https://clawhub.ai",
}));

async function loadRoute() {
  return (await import("../routes/publishers/index")).Route as unknown as {
    __config: {
      component?: ComponentType;
      head?: () => {
        links?: Array<{ rel: string; href: string }>;
        meta?: Array<Record<string, string>>;
      };
      loader?: (args: {
        deps: { kind?: "orgs" | "people"; official?: boolean; q?: string };
      }) => Promise<unknown>;
      validateSearch?: (search: Record<string, unknown>) => Record<string, unknown>;
    };
  };
}

describe("publishers route", () => {
  beforeEach(() => {
    vi.resetModules();
    loaderDataMock.mockReset();
    loaderDataMock.mockReturnValue({
      page: [],
      counts: { all: 0, organizations: 0, individuals: 0 },
      continueCursor: "",
      isDone: true,
    });
    navigateMock.mockReset();
    queryMock.mockReset();
    queryMock.mockResolvedValue({
      page: [],
      counts: { all: 0, organizations: 0, individuals: 0 },
      continueCursor: "",
      isDone: true,
    });
    searchMock.mockReset();
    searchMock.mockReturnValue({});
  });

  it("renders the public publishers listing surface", async () => {
    const route = await loadRoute();
    const result = await route.__config.loader?.({ deps: {} });

    expect(result).toEqual({
      page: [],
      counts: { all: 0, organizations: 0, individuals: 0 },
      continueCursor: "",
      isDone: true,
    });
    expect(queryMock.mock.calls[0]?.[1]).toEqual({
      paginationOpts: { cursor: null, numItems: 25 },
      kind: undefined,
      query: undefined,
    });
  });

  it("passes the organization filter to the public publishers query", async () => {
    const route = await loadRoute();
    await route.__config.loader?.({ deps: { kind: "orgs" } });

    expect(queryMock.mock.calls[0]?.[1]).toEqual({
      paginationOpts: { cursor: null, numItems: 25 },
      kind: "org",
      query: undefined,
    });
  });

  it("normalizes legacy builder URLs to people", async () => {
    const route = await loadRoute();

    expect(route.__config.validateSearch?.({ kind: "builders" })).toEqual({
      kind: "people",
      official: undefined,
      q: undefined,
      view: undefined,
    });
    expect(route.__config.validateSearch?.({ kind: "individuals" })).toEqual({
      kind: "people",
      official: undefined,
      q: undefined,
      view: undefined,
    });
  });

  it("passes the people filter and query to the public publishers query", async () => {
    const route = await loadRoute();
    await route.__config.loader?.({ deps: { kind: "people", q: "openclaw" } });

    expect(queryMock.mock.calls[0]?.[1]).toEqual({
      paginationOpts: { cursor: null, numItems: 25 },
      kind: "user",
      query: "openclaw",
    });
  });

  it("passes the official filter to the public publishers query without a legacy scan", async () => {
    const route = await loadRoute();

    await route.__config.loader?.({ deps: { official: true } });

    expect(queryMock.mock.calls[0]?.[1]).toEqual({
      paginationOpts: { cursor: null, numItems: 25 },
      kind: undefined,
      query: undefined,
      official: true,
    });
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it("renders the loaded publisher results", async () => {
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.getByText("Creators")).toBeTruthy();
    expect(screen.getByText("No publishers found")).toBeTruthy();
  });

  it("does not present the bounded publisher result count as a global total", async () => {
    loaderDataMock.mockReturnValue({
      page: [],
      counts: { all: 17, organizations: 6, individuals: 11 },
      globalCounts: { all: 17, organizations: 6, individuals: 11 },
      continueCursor: "",
      isDone: true,
    });
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.getByRole("heading", { name: "Creators" })).toBeTruthy();
    expect(screen.queryByText("17")).toBeNull();
    expect(screen.getByRole("radio", { name: "All" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Official" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Organizations" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Users" })).toBeTruthy();
    expect(screen.queryByText("Builders")).toBeNull();
    expect(screen.queryByText(/Showing/i)).toBeNull();
  });

  it("keeps the publisher heading unchanged when filters are active", async () => {
    searchMock.mockReturnValue({ kind: "orgs" });
    loaderDataMock.mockReturnValue({
      page: [],
      counts: { all: 6, organizations: 6, individuals: 0 },
      globalCounts: { all: 17, organizations: 6, individuals: 11 },
      continueCursor: "",
      isDone: true,
    });
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.getByRole("heading", { name: "Creators" })).toBeTruthy();
    expect(screen.queryByText("17")).toBeNull();
  });

  it("keeps publisher type filters and view controls in the horizontal controls", async () => {
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    const allTab = screen.getByRole("radio", { name: "All" });
    const listView = screen.getByRole("button", { name: "List" });
    const searchInput = screen.getByPlaceholderText("Search publishers...");

    expect(allTab.closest(".browse-controls")).not.toBeNull();
    expect(listView.closest(".browse-controls")).not.toBeNull();
    expect(
      Boolean(listView.compareDocumentPosition(searchInput) & Node.DOCUMENT_POSITION_FOLLOWING),
    ).toBe(true);
  });

  it("clears publisher search from the search field", async () => {
    searchMock.mockReturnValue({ q: "ope", kind: "orgs" });
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    fireEvent.click(screen.getByRole("button", { name: "Close search" }));

    expect(navigateMock).toHaveBeenCalled();
    const lastCall = navigateMock.mock.calls.at(-1)?.[0] as {
      search: (prev: Record<string, unknown>) => Record<string, unknown>;
      replace?: boolean;
    };
    expect(lastCall.search({ q: "ope", kind: "orgs" })).toEqual({
      q: undefined,
      kind: "orgs",
    });
    expect(lastCall.replace).toBe(true);
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
  });

  it("sets publisher-specific sharing metadata", async () => {
    const route = await loadRoute();
    const head = route.__config.head?.();

    expect(head?.links).toContainEqual({ rel: "canonical", href: "https://clawhub.ai/publishers" });
    expect(head?.meta).toContainEqual({ property: "og:title", content: "Publishers · ClawHub" });
  });
});
