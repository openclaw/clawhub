/* @vitest-environment jsdom */

import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildPublisherCatalogCategoryOptions,
  formatRelativeUpdatedAt,
  getCatalogItemShortTypeLabel,
  groupPublisherCatalogItemsByTopic,
  publisherCatalogItemMatchesCategory,
  shouldShowPublisherCatalogLoadMore,
} from "../routes/user/$handle";

const { loaderDataMock, paginatedQueryMock, queryMock } = vi.hoisted(() => ({
  loaderDataMock: vi.fn(),
  paginatedQueryMock: vi.fn(),
  queryMock: vi.fn(),
}));

vi.mock("convex/react", () => ({
  usePaginatedQuery: (...args: unknown[]) => paginatedQueryMock(...args),
  useQuery: (...args: unknown[]) => queryMock(...args),
}));

vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signIn: vi.fn() }),
}));

vi.mock("../lib/useAuthStatus", () => ({
  useAuthStatus: () => ({ isAuthenticated: false, isLoading: false, me: null }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: { component?: unknown; head?: unknown; loader?: unknown }) => ({
    __config: config,
    useLoaderData: () => loaderDataMock(),
    useParams: () => ({ handle: "nvidia" }),
  }),
  Link: ({
    children,
    to,
    className,
  }: {
    children: ReactNode;
    to?: string;
    className?: string;
  }) => (
    <a href={to ?? "/test"} className={className}>
      {children}
    </a>
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
    queryMock.mockImplementation((_query, args: Record<string, unknown> | "skip") => {
      if (args === "skip") return undefined;
      if ("publisherHandle" in args) return { publisher, members: [] };
      if ("kind" in args) return null;
      return publisher;
    });
  });

  it("shows downloads in the publisher stat strip", async () => {
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    const stats = screen.getByLabelText("Publisher stats");
    expect(within(stats).getByText("42")).toBeTruthy();
    expect(within(stats).getByText("downloads")).toBeTruthy();
    expect(within(stats).queryByText("installs")).toBeNull();
  });

  it("renders profile actions menu with report option", async () => {
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Follow" })).toBeNull();
    expect(screen.getByRole("button", { name: "Profile actions" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /github/i })).toBeTruthy();
  });

  it("renders segmented catalog tabs and sort control", async () => {
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    const catalogTabs = screen.getByRole("group", { name: "Catalog" });
    expect(catalogTabs.className).toContain("clawhub-segmented");
    expect(within(catalogTabs).getByRole("button", { name: /skills 136/i, pressed: true })).toBeTruthy();
    expect(within(catalogTabs).getByRole("button", { name: /plugins 0/i, pressed: false })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Sort" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Sort" }).textContent).toMatch(/^Sort$/i);
  });

  it("shows catalog search trigger when item count meets threshold", async () => {
    paginatedQueryMock.mockReturnValue({
      loadMore: vi.fn(),
      results: Array.from({ length: 8 }, (_, index) => ({
        _id: `skills:item-${index}`,
        kind: "skill",
        displayName: `Skill ${index}`,
        summary: null,
        topics: [],
        icon: null,
        href: `/nvidia/skill-${index}`,
        installs: 1,
        stars: 0,
        isOfficial: true,
        updatedAt: 1,
      })),
      status: "Exhausted",
    });
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.getByRole("button", { name: "Filter catalog" })).toBeTruthy();
    expect(screen.queryByRole("searchbox", { name: /catalog search/i })).toBeNull();
  });

  it("uses downloads sort for published catalog pages by default", async () => {
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    const args = paginatedQueryMock.mock.calls.map((call) => call[1]);
    expect(args).toContainEqual(expect.objectContaining({ handle: "nvidia", sort: "downloads" }));
  });

  it("groups published items by topic and labels empty topics as uncategorized", async () => {
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
          _id: "skills:orphan",
          kind: "skill",
          displayName: "Orphan Helper",
          summary: "No topic",
          topics: [],
          icon: null,
          href: "/nvidia/orphan-helper",
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

    const groupTabs = screen.getByRole("radiogroup", { name: "Catalog groups" });
    expect(within(groupTabs).getByRole("radio", { name: /all 3/i })).toBeTruthy();
    expect(within(groupTabs).getByRole("radio", { name: /gpu development 1/i })).toBeTruthy();
    expect(within(groupTabs).getByRole("radio", { name: /travel 1/i })).toBeTruthy();
    expect(within(groupTabs).getByRole("radio", { name: /uncategorized 1/i })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "GPU development · 1" })).toBeNull();
    expect(screen.getByText("GPU Helper")).toBeTruthy();
    expect(screen.getByText("Travel Helper")).toBeTruthy();
    expect(screen.getByText("Orphan Helper")).toBeTruthy();

    fireEvent.click(within(groupTabs).getByRole("radio", { name: /travel 1/i }));

    expect(screen.getByText("Travel Helper")).toBeTruthy();
    expect(screen.queryByText("GPU Helper")).toBeNull();
    expect(screen.queryByText("Orphan Helper")).toBeNull();
  });
});

describe("publisher profile helpers", () => {
  it("renames empty topic groups to uncategorized and sorts them last", () => {
    const groups = groupPublisherCatalogItemsByTopic([
      {
        _id: "skills:orphan",
        kind: "skill",
        displayName: "Orphan",
        summary: null,
        topics: [],
        icon: null,
        href: "/x/orphan",
        installs: 0,
        stars: 0,
        isOfficial: false,
        updatedAt: 1,
      },
      {
        _id: "skills:prompt",
        kind: "skill",
        displayName: "Prompt",
        summary: null,
        topics: ["Prompt"],
        icon: null,
        href: "/x/prompt",
        installs: 0,
        stars: 0,
        isOfficial: false,
        updatedAt: 1,
      },
    ]);

    expect(groups.map((group) => group.title)).toEqual(["Prompt", "Uncategorized"]);
  });

  it("hides catalog load more when a topic group is selected or the manifest is active", () => {
    expect(
      shouldShowPublisherCatalogLoadMore({
        activeStatus: "CanLoadMore",
        catalogSearch: "",
        selectedCatalogGroup: "current-weather",
      }),
    ).toBe(false);

    expect(
      shouldShowPublisherCatalogLoadMore({
        activeStatus: "CanLoadMore",
        catalogSearch: "",
        selectedCatalogGroup: "all",
        activePublishedDisplay: {
          sections: [],
        },
      }),
    ).toBe(false);

    expect(
      shouldShowPublisherCatalogLoadMore({
        activeStatus: "CanLoadMore",
        catalogSearch: "",
        selectedCatalogGroup: "all",
      }),
    ).toBe(true);
  });

  it("formats short type labels and relative update times", () => {
    expect(
      getCatalogItemShortTypeLabel({
        _id: "skills:prompt",
        kind: "skill",
        displayName: "Prompt",
        summary: null,
        topics: ["Prompt"],
        icon: null,
        href: "/x/prompt",
        installs: 0,
        stars: 0,
        isOfficial: false,
        updatedAt: 1,
      }),
    ).toBe("prompt");

    const now = Date.UTC(2026, 5, 23, 12, 0, 0);
    expect(formatRelativeUpdatedAt(now - 3 * 24 * 60 * 60 * 1000, now)).toBe("3d ago");
  });

  it("builds category options from catalog items and matches category slugs", () => {
    const items = [
      {
        _id: "skills:dev",
        kind: "skill" as const,
        displayName: "Dev Helper",
        summary: null,
        topics: [],
        categories: ["development"],
        icon: null,
        href: "/nvidia/dev-helper",
        installs: 0,
        stars: 0,
        isOfficial: false,
        updatedAt: 1,
      },
      {
        _id: "packages:gateway",
        kind: "plugin" as const,
        displayName: "Gateway Plugin",
        summary: null,
        topics: [],
        categories: ["gateway"],
        icon: null,
        href: "/plugins/gateway",
        installs: 0,
        stars: 0,
        isOfficial: false,
        updatedAt: 1,
      },
    ];

    expect(buildPublisherCatalogCategoryOptions(items, "skill").map((category) => category.slug)).toEqual(
      ["development"],
    );
    expect(
      buildPublisherCatalogCategoryOptions(items, "plugin").map((category) => category.slug),
    ).toEqual(["gateway"]);
    expect(publisherCatalogItemMatchesCategory(items[0], "development")).toBe(true);
    expect(publisherCatalogItemMatchesCategory(items[0], "automation")).toBe(false);
  });
});
