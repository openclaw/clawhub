/* @vitest-environment jsdom */

import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildPublisherCatalogCategoryOptions,
  buildPublisherGroupTabOptions,
  formatRelativeUpdatedAt,
  getCatalogItemShortTypeLabel,
  groupPublisherCatalogItemsByTopic,
  parsePluginCatalogRoute,
  publisherCatalogItemMatchesCategory,
  resolveDefaultCatalogTab,
  shouldShowPublisherCatalogLoadMore,
} from "../routes/user/$handle";

const {
  authStatusMock,
  followPublisherMock,
  loaderDataMock,
  mutationCallState,
  paginatedQueryMock,
  queryMock,
  unfollowPublisherMock,
} = vi.hoisted(() => ({
  authStatusMock: vi.fn(),
  followPublisherMock: vi.fn(),
  loaderDataMock: vi.fn(),
  mutationCallState: { count: 0 },
  paginatedQueryMock: vi.fn(),
  queryMock: vi.fn(),
  unfollowPublisherMock: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useMutation: () => {
    mutationCallState.count += 1;
    return mutationCallState.count % 2 === 1 ? followPublisherMock : unfollowPublisherMock;
  },
  usePaginatedQuery: (...args: unknown[]) => paginatedQueryMock(...args),
  useQuery: (...args: unknown[]) => queryMock(...args),
}));

vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signIn: vi.fn() }),
}));

vi.mock("../lib/useAuthStatus", () => ({
  useAuthStatus: () => authStatusMock(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: { component?: unknown; head?: unknown; loader?: unknown }) => ({
    __config: config,
    useLoaderData: () => loaderDataMock(),
    useParams: () => ({ handle: "nvidia" }),
    useSearch: () => ({}),
  }),
  Link: ({ children, to, className }: { children: ReactNode; to?: string; className?: string }) => (
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
    authStatusMock.mockReset();
    authStatusMock.mockReturnValue({ isAuthenticated: false, isLoading: false, me: null });
    followPublisherMock.mockReset();
    followPublisherMock.mockResolvedValue({ following: true });
    mutationCallState.count = 0;
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
      if ("publisherId" in args) return false;
      if ("kind" in args) return null;
      if (Object.keys(args).length === 0) return [];
      return publisher;
    });
    unfollowPublisherMock.mockReset();
    unfollowPublisherMock.mockResolvedValue({ following: false });
  });

  it("shows downloads in the publisher stat strip", async () => {
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    const stats = screen.getByLabelText("Publisher stats");
    expect(within(stats).getByText("42")).toBeTruthy();
    expect(within(stats).getByText(/downloads/i)).toBeTruthy();
    expect(within(stats).queryByText("installs")).toBeNull();
  });

  it("renders profile actions menu with report option", async () => {
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
    expect(screen.getByRole("button", { name: /follow/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Profile actions" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /github/i })).toBeTruthy();
  });

  it("shows edit profile instead of report on the viewer's own publisher page", async () => {
    const personalPublisher = {
      ...publisher,
      kind: "user" as const,
    };
    loaderDataMock.mockReturnValue({ publisher: personalPublisher });
    authStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { handle: "nvidia" },
    });
    queryMock.mockImplementation((_query, args: Record<string, unknown> | "skip") => {
      if (args === "skip") return undefined;
      if ("publisherHandle" in args) return { publisher: personalPublisher, members: [] };
      if ("kind" in args) return null;
      if (Object.keys(args).length === 0) {
        return [{ publisher: { handle: "nvidia", kind: "user" }, role: "owner" }];
      }
      return personalPublisher;
    });

    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    const editProfile = screen.getByRole("link", { name: "Edit profile" });
    const add = screen.getByRole("link", { name: "Add" });

    expect(
      screen.getAllByRole("link", { name: /^(Edit profile|Add)$/ }).map((link) => link.textContent),
    ).toEqual(["Edit profile", "Add"]);
    expect(editProfile.getAttribute("href")).toBe("/settings");
    expect(add.getAttribute("href")).toContain("/add");
    expect(screen.queryByRole("button", { name: "Profile actions" })).toBeNull();
    expect(screen.queryByText("Report profile")).toBeNull();
    expect(screen.queryByRole("button", { name: /follow/i })).toBeNull();
  });

  it("requires sign-in before following a publisher", async () => {
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    fireEvent.click(screen.getByRole("button", { name: /follow/i }));

    expect(followPublisherMock).not.toHaveBeenCalled();
  });

  it("follows a publisher for signed-in users", async () => {
    authStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: "users:viewer", handle: "viewer", role: "user" },
    });
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    fireEvent.click(screen.getByRole("button", { name: /follow/i }));

    expect(followPublisherMock).toHaveBeenCalledWith({ publisherId: "publishers:nvidia" });
  });

  it("unfollows a publisher when already following", async () => {
    authStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: "users:viewer", handle: "viewer", role: "user" },
    });
    queryMock.mockImplementation((_query, args: Record<string, unknown> | "skip") => {
      if (args === "skip") return undefined;
      if ("publisherHandle" in args) return { publisher, members: [] };
      if ("publisherId" in args) return true;
      if ("kind" in args) return null;
      if (Object.keys(args).length === 0) return [];
      return publisher;
    });
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    fireEvent.click(screen.getByRole("button", { name: /following/i }));

    expect(unfollowPublisherMock).toHaveBeenCalledWith({ publisherId: "publishers:nvidia" });
  });

  it("does not render follow controls on the viewer's own profile", async () => {
    authStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: "users:nvidia", handle: "nvidia", role: "user" },
    });
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.queryByRole("button", { name: /follow/i })).toBeNull();
  });

  it("renders segmented catalog tabs and sort control", async () => {
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    const catalogTabs = screen.getByRole("group", { name: "Catalog" });
    expect(catalogTabs.className).toContain("clawhub-segmented");
    expect(
      within(catalogTabs).getByRole("button", { name: /skills 136/i, pressed: true }),
    ).toBeTruthy();
    expect(
      within(catalogTabs).getByRole("button", { name: /plugins 0/i, pressed: false }),
    ).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Sort" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Sort" }).textContent).toMatch(/^Sort$/i);
  });

  it("opens plugins tab when publisher has plugins but no skills", async () => {
    const pluginsOnlyPublisher = {
      ...publisher,
      handle: "expediagroup",
      displayName: "Expedia Group",
      stats: {
        ...publisher.stats,
        skills: 0,
        packages: 1,
      },
    };
    loaderDataMock.mockReturnValue({ publisher: pluginsOnlyPublisher });
    queryMock.mockImplementation((_query, args: Record<string, unknown> | "skip") => {
      if (args === "skip") return undefined;
      if ("publisherHandle" in args) return { publisher: pluginsOnlyPublisher, members: [] };
      if ("kind" in args) return null;
      return pluginsOnlyPublisher;
    });

    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    const catalogTabs = screen.getByRole("group", { name: "Catalog" });
    expect(
      within(catalogTabs).getByRole("button", { name: /skills 0/i, pressed: false }),
    ).toBeTruthy();
    expect(
      within(catalogTabs).getByRole("button", { name: /plugins 1/i, pressed: true }),
    ).toBeTruthy();
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

  it("keeps later indexed pages reachable when a page has no visible items", async () => {
    const loadMore = vi.fn();
    paginatedQueryMock.mockReturnValue({ loadMore, results: [], status: "CanLoadMore" });
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(loadMore).toHaveBeenCalledWith(12);
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
    expect(within(groupTabs).getByRole("radio", { name: /all 136/i })).toBeTruthy();
    expect(within(groupTabs).getByRole("radio", { name: /gpu development 1/i })).toBeTruthy();
    expect(within(groupTabs).getByRole("radio", { name: /travel 1/i })).toBeTruthy();
    expect(within(groupTabs).getByRole("radio", { name: /uncategorized 1/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "GPU development" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Travel" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Uncategorized" })).toBeTruthy();
    expect(screen.getByText("GPU Helper")).toBeTruthy();
    expect(screen.getByText("Travel Helper")).toBeTruthy();
    expect(screen.getByText("Orphan Helper")).toBeTruthy();

    fireEvent.click(within(groupTabs).getByRole("radio", { name: /travel 1/i }));

    expect(screen.getByRole("heading", { name: "Travel" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "GPU development" })).toBeNull();
    expect(screen.getByText("Travel Helper")).toBeTruthy();
    expect(screen.queryByText("GPU Helper")).toBeNull();
    expect(screen.queryByText("Orphan Helper")).toBeNull();
  });

  it("shows publisher total in grouped All tab while catalog is paginated", async () => {
    const openclawPublisher = {
      ...publisher,
      handle: "openclaw",
      displayName: "OpenClaw",
      stats: {
        ...publisher.stats,
        skills: 6,
        packages: 59,
      },
    };
    loaderDataMock.mockReturnValue({ publisher: openclawPublisher });
    queryMock.mockImplementation((_query, args: Record<string, unknown> | "skip") => {
      if (args === "skip") return undefined;
      if ("publisherHandle" in args) return { publisher: openclawPublisher, members: [] };
      if ("kind" in args) return null;
      return openclawPublisher;
    });
    paginatedQueryMock.mockReturnValue({
      loadMore: vi.fn(),
      results: [
        {
          _id: "packages:codex",
          kind: "plugin",
          displayName: "Codex",
          summary: null,
          topics: ["Codex"],
          icon: null,
          href: "/openclaw/plugins/codex",
          installs: 1,
          stars: 0,
          isOfficial: true,
          updatedAt: 1,
        },
        {
          _id: "packages:diagnostics",
          kind: "plugin",
          displayName: "Diagnostics",
          summary: null,
          topics: ["Diagnostics"],
          icon: null,
          href: "/openclaw/plugins/diagnostics",
          installs: 1,
          stars: 0,
          isOfficial: true,
          updatedAt: 1,
        },
        ...Array.from({ length: 10 }, (_, index) => ({
          _id: `packages:plugin-${index}`,
          kind: "plugin" as const,
          displayName: `Plugin ${index}`,
          summary: null,
          topics: ["Feishu"],
          icon: null,
          href: `/openclaw/plugins/plugin-${index}`,
          installs: 1,
          stars: 0,
          isOfficial: true,
          updatedAt: 1,
        })),
      ],
      status: "CanLoadMore",
    });

    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    fireEvent.click(screen.getByRole("button", { name: /plugins 59/i }));

    const groupTabs = screen.getByRole("radiogroup", { name: "Catalog groups" });
    expect(within(groupTabs).getByRole("radio", { name: /all 59/i })).toBeTruthy();
    expect(within(groupTabs).getByRole("radio", { name: /codex 1/i })).toBeTruthy();
    expect(within(groupTabs).getByRole("radio", { name: /feishu 10/i })).toBeTruthy();
  });
});

describe("publisher profile helpers", () => {
  it("resolves default catalog tab from publisher stats", () => {
    expect(resolveDefaultCatalogTab({ stats: { skills: 10, packages: 0 } } as never)).toBe(
      "skills",
    );
    expect(resolveDefaultCatalogTab({ stats: { skills: 0, packages: 3 } } as never)).toBe(
      "plugins",
    );
    expect(resolveDefaultCatalogTab({ stats: { skills: 5, packages: 2 } } as never)).toBe("skills");
    expect(resolveDefaultCatalogTab({ stats: { skills: 0, packages: 0 } } as never)).toBe("skills");
  });

  it("uses publisher total for grouped All tab when provided", () => {
    const groups = groupPublisherCatalogItemsByTopic([
      {
        _id: "packages:a",
        kind: "plugin",
        displayName: "A",
        summary: null,
        topics: ["Codex"],
        icon: null,
        href: "/openclaw/plugins/a",
        installs: 0,
        stars: 0,
        isOfficial: false,
        updatedAt: 1,
      },
      {
        _id: "packages:b",
        kind: "plugin",
        displayName: "B",
        summary: null,
        topics: ["Diagnostics"],
        icon: null,
        href: "/openclaw/plugins/b",
        installs: 0,
        stars: 0,
        isOfficial: false,
        updatedAt: 1,
      },
    ]);

    expect(
      buildPublisherGroupTabOptions(groups).find((option) => option.value === "all")?.count,
    ).toBe("2");
    expect(
      buildPublisherGroupTabOptions(groups, { totalCount: 59 }).find(
        (option) => option.value === "all",
      )?.count,
    ).toBe("59");
  });

  it("parses publisher-scoped plugin routes from catalog hrefs", () => {
    expect(
      parsePluginCatalogRoute({
        _id: "packages:gateway",
        kind: "plugin",
        displayName: "Gateway",
        summary: null,
        icon: null,
        href: "/expediagroup/plugins/travel-gateway",
        stars: 0,
        isOfficial: true,
        updatedAt: 1,
      }),
    ).toEqual({
      ownerHandle: "expediagroup",
      name: "@expediagroup/travel-gateway",
    });
  });

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
        activePublishedDisplay: null,
      }),
    ).toBe(false);

    expect(
      shouldShowPublisherCatalogLoadMore({
        activeStatus: "CanLoadMore",
        catalogSearch: "",
        selectedCatalogGroup: "all",
        activePublishedDisplay: {
          mode: "grouped",
          sourceRepos: [],
          sections: [],
        },
      }),
    ).toBe(false);

    expect(
      shouldShowPublisherCatalogLoadMore({
        activeStatus: "CanLoadMore",
        catalogSearch: "weather",
        selectedCatalogGroup: "all",
        activePublishedDisplay: null,
      }),
    ).toBe(true);

    expect(
      shouldShowPublisherCatalogLoadMore({
        activeStatus: "CanLoadMore",
        catalogSearch: "",
        selectedCatalogGroup: "all",
        activePublishedDisplay: null,
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

    expect(
      buildPublisherCatalogCategoryOptions(items, "skill").map((category) => category.slug),
    ).toEqual(["development"]);
    expect(
      buildPublisherCatalogCategoryOptions(items, "plugin").map((category) => category.slug),
    ).toEqual(["gateway"]);
    expect(publisherCatalogItemMatchesCategory(items[0], "development")).toBe(true);
    expect(publisherCatalogItemMatchesCategory(items[0], "automation")).toBe(false);
  });
});
