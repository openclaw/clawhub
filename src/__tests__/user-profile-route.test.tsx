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
    downloads: 42,
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

  it("shows total downloads in the publisher header", async () => {
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    const stats = screen.getByLabelText("Publisher stats");
    expect(within(stats).getByText("42")).toBeTruthy();
    expect(within(stats).getByText("downloads")).toBeTruthy();
    expect(within(stats).queryByText("installs")).toBeNull();
  });

  it("uses downloads sort for published catalog pages", async () => {
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    const args = paginatedQueryMock.mock.calls.map((call) => call[1]);
    expect(args).toContainEqual(expect.objectContaining({ handle: "nvidia", sort: "downloads" }));
  });

  it("groups published items by the author's first topic", async () => {
    paginatedQueryMock.mockReturnValue({
      loadMore: vi.fn(),
      results: [
        {
          _id: "skills:gpu",
          kind: "skill",
          displayName: "GPU Helper",
          summary: "GPU tasks",
          topics: ["GPU development", "CUDA"],
          icon: null,
          href: "/nvidia/gpu-helper",
          installs: 1,
          stars: 0,
          isOfficial: true,
          updatedAt: 1,
        },
        {
          _id: "skills:travel",
          kind: "skill",
          displayName: "Travel Helper",
          summary: "Travel tasks",
          topics: ["Travel"],
          icon: null,
          href: "/nvidia/travel-helper",
          installs: 1,
          stars: 0,
          isOfficial: true,
          updatedAt: 1,
        },
        {
          _id: "skills:gpu-runtime",
          kind: "skill",
          displayName: "GPU Runtime",
          summary: "GPU runtime tasks",
          topics: ["gpu-development"],
          icon: null,
          href: "/nvidia/gpu-runtime",
          installs: 1,
          stars: 0,
          isOfficial: true,
          updatedAt: 1,
        },
      ],
      status: "Exhausted",
    });
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.getByRole("heading", { name: "GPU development" })).toBeTruthy();
    expect(screen.getAllByRole("heading", { name: /gpu(?: |-)development/i })).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Travel" })).toBeTruthy();
    expect(screen.getByText("GPU Helper")).toBeTruthy();
    expect(screen.getByText("GPU Runtime")).toBeTruthy();
    expect(screen.getByText("Travel Helper")).toBeTruthy();
  });
});
