/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { loaderDataMock, navigateMock, publisherListItemMock, queryMock, searchMock } = vi.hoisted(
  () => ({
    loaderDataMock: vi.fn(),
    navigateMock: vi.fn(),
    publisherListItemMock: vi.fn(),
    queryMock: vi.fn(),
    searchMock: vi.fn(),
  }),
);

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
}));

vi.mock("../components/PublisherListItem", () => ({
  PublisherListItem: (props: {
    publisher: { _id: string };
    showOfficialBadge?: boolean;
    variant?: string;
  }) => {
    publisherListItemMock(props);
    return <div>{props.publisher._id}</div>;
  },
}));

vi.mock("../lib/site", () => ({
  SITE_NAME: "ClawHub",
  getClawHubSiteUrl: () => "https://clawhub.ai",
}));

async function loadRoute() {
  return (await import("../routes/official/index")).Route as unknown as {
    __config: {
      component?: ComponentType;
      head?: () => {
        links?: Array<{ rel: string; href: string }>;
        meta?: Array<Record<string, string>>;
      };
      loader?: (args: { deps: { q?: string } }) => Promise<unknown>;
      validateSearch?: (search: Record<string, unknown>) => Record<string, unknown>;
    };
  };
}

describe("official route", () => {
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
    publisherListItemMock.mockReset();
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

  it("loads only official organizations", async () => {
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
      kind: "org",
      official: true,
      query: undefined,
    });
  });

  it("passes search queries without exposing kind or official controls", async () => {
    const route = await loadRoute();
    await route.__config.loader?.({ deps: { q: "openclaw" } });

    expect(queryMock.mock.calls[0]?.[1]).toEqual({
      paginationOpts: { cursor: null, numItems: 25 },
      kind: "org",
      official: true,
      query: "openclaw",
    });
  });

  it("renders the official header and list-only empty state", async () => {
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.getByRole("heading", { name: "Official" })).toBeTruthy();
    expect(
      screen.getByText("The organizations behind the top skills and plugins on ClawHub"),
    ).toBeTruthy();
    expect(screen.getByText("No official organizations found")).toBeTruthy();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByRole("button", { name: "Grid" })).toBeNull();
    expect(screen.queryByText("Popular publishers")).toBeNull();
  });

  it("renders official organizations in the existing table without redundant badges", async () => {
    loaderDataMock.mockReturnValue({
      page: [{ _id: "publishers:openclaw" }],
      counts: { all: 1, organizations: 1, individuals: 0 },
      continueCursor: "",
      isDone: true,
    });
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.getByText("Organization")).toBeTruthy();
    expect(screen.getByText("Activity")).toBeTruthy();
    expect(screen.getByText("publishers:openclaw")).toBeTruthy();
    expect(publisherListItemMock).toHaveBeenCalledWith(
      expect.objectContaining({
        showOfficialBadge: false,
        variant: "list",
      }),
    );
  });

  it("clears official organization search from the search field", async () => {
    searchMock.mockReturnValue({ q: "ope" });
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    fireEvent.click(screen.getByRole("button", { name: "Close search" }));

    expect(navigateMock).toHaveBeenCalled();
    const lastCall = navigateMock.mock.calls.at(-1)?.[0] as {
      search: (prev: Record<string, unknown>) => Record<string, unknown>;
      replace?: boolean;
    };
    expect(lastCall.search({ q: "ope" })).toEqual({ q: undefined });
    expect(lastCall.replace).toBe(true);
  });

  it("sets official-specific sharing metadata", async () => {
    const route = await loadRoute();
    const head = route.__config.head?.();

    expect(head?.links).toContainEqual({ rel: "canonical", href: "https://clawhub.ai/official" });
    expect(head?.meta).toContainEqual({ property: "og:title", content: "Official · ClawHub" });
    expect(head?.meta).toContainEqual({
      property: "og:description",
      content: "The organizations behind the top skills and plugins on ClawHub.",
    });
  });
});
