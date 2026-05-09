/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
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
  Link: ({ children, className, to }: { children: ReactNode; className?: string; to?: string }) => (
    <a className={className} href={to}>
      {children}
    </a>
  ),
}));

vi.mock("../components/PublisherListItem", () => ({
  PublisherListItem: ({ publisher }: { publisher: { _id: string } }) => <div>{publisher._id}</div>,
}));

vi.mock("../lib/site", () => ({
  getSiteMode: () => "skills",
  getSiteName: () => "ClawHub",
  getSiteUrlForMode: () => "https://clawhub.ai",
}));

async function loadRoute() {
  return (await import("../routes/publishers/index")).Route as unknown as {
    __config: {
      component?: ComponentType;
      head?: () => {
        links?: Array<{ rel: string; href: string }>;
        meta?: Array<Record<string, string>>;
      };
      loader?: (args: { deps: { kind?: "orgs" | "builders"; q?: string } }) => Promise<unknown>;
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

  it("passes the builders filter and query to the public publishers query", async () => {
    const route = await loadRoute();
    await route.__config.loader?.({ deps: { kind: "builders", q: "openclaw" } });

    expect(queryMock.mock.calls[0]?.[1]).toEqual({
      paginationOpts: { cursor: null, numItems: 25 },
      kind: "user",
      query: "openclaw",
    });
  });

  it("renders the loaded publisher results", async () => {
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.getByText("Publishers")).toBeTruthy();
    expect(screen.getByText("No publishers found")).toBeTruthy();
  });

  it("sets publisher-specific sharing metadata", async () => {
    const route = await loadRoute();
    const head = route.__config.head?.();

    expect(head?.links).toContainEqual({ rel: "canonical", href: "https://clawhub.ai/publishers" });
    expect(head?.meta).toContainEqual({ property: "og:title", content: "Publishers · ClawHub" });
  });
});
