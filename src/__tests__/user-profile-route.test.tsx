/* @vitest-environment jsdom */

import { render, screen, within } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { loaderDataMock, paginatedQueryMock, queryMock } = vi.hoisted(() => ({
  loaderDataMock: vi.fn(),
  paginatedQueryMock: vi.fn(),
  queryMock: vi.fn(),
}));

vi.mock("convex/react", () => ({
  usePaginatedQuery: (...args: unknown[]) => paginatedQueryMock(...args),
  useQuery: (...args: unknown[]) => queryMock(...args),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: { component?: unknown; head?: unknown; loader?: unknown }) => ({
    __config: config,
    useLoaderData: () => loaderDataMock(),
    useParams: () => ({ handle: "nvidia" }),
  }),
  Link: ({ children, to }: { children: ReactNode; to?: string }) => (
    <a href={to ?? "/test"}>{children}</a>
  ),
  notFound: () => ({ notFound: true }),
}));

async function loadRoute() {
  return (await import("../routes/user/$handle")).Route as unknown as {
    __config: {
      component?: ComponentType;
    };
  };
}

const publisher = {
  _id: "publishers:nvidia",
  _creationTime: 1,
  bio: "Official NVIDIA publisher.",
  displayName: "NVIDIA",
  handle: "nvidia",
  image: null,
  kind: "org" as const,
  official: true,
  publishedItems: [],
  stats: {
    downloads: 0,
    installs: 27,
    packages: 0,
    skills: 136,
    stars: 0,
  },
};

describe("user profile route", () => {
  beforeEach(() => {
    vi.resetModules();
    loaderDataMock.mockReset();
    loaderDataMock.mockReturnValue({ publisher });
    paginatedQueryMock.mockReset();
    paginatedQueryMock.mockReturnValue({
      loadMore: vi.fn(),
      results: [],
      status: "Exhausted",
    });
    queryMock.mockReset();
    queryMock.mockImplementation((_query, args: Record<string, unknown>) => {
      if ("publisherHandle" in args) return { publisher, members: [] };
      if ("kind" in args) return null;
      return publisher;
    });
  });

  it("shows total installs instead of downloads in the publisher header", async () => {
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    const stats = screen.getByLabelText("Publisher stats");
    expect(within(stats).getByText("27")).toBeTruthy();
    expect(within(stats).getByText("installs")).toBeTruthy();
    expect(within(stats).queryByText("downloads")).toBeNull();
  });
});
