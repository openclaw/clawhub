/* @vitest-environment jsdom */

import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ConvexHttpClient } from "convex/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Header from "../components/Header";
import { HomeListingSection } from "../components/HomeListingSection";
import { Route as pluginsRoute } from "../routes/plugins/index";
import { Route as searchRoute } from "../routes/search";

const { searchSkills } = vi.hoisted(() => ({ searchSkills: vi.fn(async () => []) }));
vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signIn: vi.fn(), signOut: vi.fn() }),
}));

vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useQuery: () => undefined,
  useAction: () => searchSkills,
  useConvexAuth: () => ({ isAuthenticated: false, isLoading: false }),
}));

const requests: URL[] = [];
let pluginResults: Array<{
  score: number;
  package: {
    name: string;
    displayName: string;
    family: "code-plugin";
    channel: "community";
    isOfficial: boolean;
    createdAt: number;
    updatedAt: number;
  };
}> = [];

async function openPlugins(url: string) {
  const root = createRootRoute();
  const route = pluginsRoute.update({
    id: "/plugins",
    path: "/plugins",
    getParentRoute: () => root,
  } as never);
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: [url] }),
    defaultPendingMinMs: 0,
  });
  await router.load();
  render(<RouterProvider router={router} />);
  await screen.findByRole("heading", { name: "Plugins" });
  return router;
}

async function openGlobalSearch(url = "/search") {
  const root = createRootRoute({
    component: () => (
      <>
        <Header />
        <Outlet />
      </>
    ),
  });
  const route = searchRoute.update({
    id: "/search",
    path: "/search",
    getParentRoute: () => root,
  } as never);
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  return router;
}

describe("manual plugin search attribution", () => {
  beforeEach(() => {
    requests.length = 0;
    pluginResults = [];
    vi.stubGlobal("scrollTo", vi.fn());
    vi.spyOn(ConvexHttpClient.prototype, "action").mockResolvedValue([]);
    vi.spyOn(ConvexHttpClient.prototype, "query").mockResolvedValue({ page: [], isDone: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const url = new URL(input);
        requests.push(url);
        return new Response(
          JSON.stringify({
            results: pluginResults.slice(0, Number(url.searchParams.get("limit") ?? 100)),
            items: [],
            nextCursor: null,
          }),
        );
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("marks only the settled manual search and keeps query URL loads unmarked", async () => {
    const router = await openPlugins("/plugins?q=shared&category=security&topic=audit");
    expect(requests).toHaveLength(1);
    expect(requests[0].searchParams.has("searchSource")).toBe(false);

    const input = screen.getByPlaceholderText("Search plugins...");
    fireEvent.change(input, { target: { value: "n" } });
    fireEvent.change(input, { target: { value: "notion" } });
    expect(requests).toHaveLength(1);

    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1].pathname).toBe("/api/v1/plugins/search");
    expect(Object.fromEntries(requests[1].searchParams)).toEqual({
      q: "notion",
      limit: "25",
      category: "security",
      topic: "audit",
      searchSource: "clawhub-web",
    });
    expect(router.state.location.searchStr).not.toContain("searchSource");
  });

  it("submits a URL-loaded query once, without marking repeat submit, retry, or reload", async () => {
    const router = await openPlugins("/plugins?q=notion");
    const input = screen.getByPlaceholderText("Search plugins...");
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1].searchParams.get("searchSource")).toBe("clawhub-web");
    await waitFor(() => expect(router.state.isLoading).toBe(false));

    fireEvent.submit(input.closest("form")!);
    await act(async () => {
      await router.invalidate();
    });
    expect(requests.filter((url) => url.searchParams.has("searchSource"))).toHaveLength(1);
    cleanup();
    await openPlugins("/plugins?q=notion");
    expect(requests.at(-1)?.searchParams.has("searchSource")).toBe(false);
  });

  it("marks a settled homepage plugin search but not a filter refresh", async () => {
    const root = createRootRoute({
      component: () => (
        <HomeListingSection
          initialListing={{
            kind: "plugins",
            tab: "featured",
            categorySlugs: [],
            fetchLimit: 20,
            items: [],
            hasMore: false,
          }}
        />
      ),
    });
    const router = createRouter({
      routeTree: root,
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    await router.load();
    render(<RouterProvider router={router} />);
    fireEvent.click(await screen.findByRole("button", { name: "Search catalog" }));
    const input = await screen.findByRole("searchbox", { name: "Search plugins" });
    fireEvent.change(input, { target: { value: "n" } });
    fireEvent.change(input, { target: { value: "notion" } });
    await waitFor(() =>
      expect(requests.filter((url) => url.pathname.endsWith("/plugins/search"))).toHaveLength(1),
    );
    const search = requests.find((url) => url.pathname.endsWith("/plugins/search"))!;
    expect(search.searchParams.get("searchSource")).toBe("clawhub-web");
    expect(search.searchParams.get("limit")).toBe("20");
    fireEvent.change(input, { target: { value: "notion " } });
    fireEvent.click(screen.getByRole("tab", { name: "Official" }));
    await waitFor(() =>
      expect(requests.filter((url) => url.pathname.endsWith("/plugins/search"))).toHaveLength(2),
    );
    expect(requests.filter((url) => url.searchParams.has("searchSource"))).toHaveLength(1);
  });

  it("starts a new manual intent after clearing and retyping the same plugin query", async () => {
    await openPlugins("/plugins?q=notion");
    const input = screen.getByPlaceholderText("Search plugins...");
    fireEvent.submit(input.closest("form")!);
    await waitFor(() =>
      expect(requests.filter((url) => url.searchParams.has("searchSource"))).toHaveLength(1),
    );
    fireEvent.click(screen.getByRole("button", { name: "Close search" }));
    await waitFor(() => expect((input as HTMLInputElement).value).toBe(""));
    fireEvent.click(screen.getByRole("button", { name: "Search plugins" }));
    fireEvent.change(screen.getByPlaceholderText("Search plugins..."), {
      target: { value: "notion" },
    });
    await waitFor(() =>
      expect(requests.filter((url) => url.searchParams.has("searchSource"))).toHaveLength(2),
    );
  });

  it("marks only visible header plugin results after manual input settles", async () => {
    await openGlobalSearch();
    const input = await screen.findByRole("combobox");
    fireEvent.change(input, { target: { value: "n" } });
    fireEvent.change(input, { target: { value: "notion" } });
    await waitFor(() =>
      expect(requests.filter((url) => url.pathname.endsWith("/plugins/search"))).toHaveLength(1),
    );
    const request = requests.find((url) => url.pathname.endsWith("/plugins/search"))!;
    expect(request.searchParams.get("searchSource")).toBe("clawhub-web");
    expect(request.searchParams.get("limit")).toBe("4");
  });

  it("carries an immediate header submit into full results as one manual search", async () => {
    const router = await openGlobalSearch();
    const input = await screen.findByRole("combobox");
    fireEvent.change(input, { target: { value: "notion" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() =>
      expect(requests.filter((url) => url.pathname.endsWith("/plugins/search"))).toHaveLength(1),
    );
    const request = requests.find((url) => url.pathname.endsWith("/plugins/search"))!;
    expect(request.searchParams.get("searchSource")).toBe("clawhub-web");
    expect(request.searchParams.get("limit")).toBe("25");
    expect(router.state.location.searchStr).not.toContain("searchSource");
  });

  it("marks a full-page submit but not its initial URL or type changes", async () => {
    await openGlobalSearch("/search?q=shared&type=plugins");
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].searchParams.has("searchSource")).toBe(false);
    const input = screen.getByPlaceholderText("Search skills, plugins, and creators...");
    fireEvent.change(input, { target: { value: "notion" } });
    expect(requests).toHaveLength(1);
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1].searchParams.get("searchSource")).toBe("clawhub-web");
    expect(requests[1].searchParams.get("limit")).toBe("25");
    fireEvent.click(screen.getByRole("button", { name: /^Skills$/ }));
    await waitFor(() => expect(requests).toHaveLength(3));
    expect(requests[2].searchParams.has("searchSource")).toBe(false);
  });

  it("excludes the hidden pagination probe and later pages from manual demand", async () => {
    pluginResults = Array.from({ length: 26 }, (_, index) => ({
      score: 26 - index,
      package: {
        name: `plugin-${index + 1}`,
        displayName: `Plugin ${index + 1}`,
        family: "code-plugin",
        channel: "community",
        isOfficial: index === 25,
        createdAt: 1,
        updatedAt: 1,
      },
    }));
    await openGlobalSearch();
    const input = screen.getByPlaceholderText("Search skills, plugins, and creators...");
    fireEvent.change(input, { target: { value: "notion" } });
    fireEvent.submit(input.closest("form")!);
    await screen.findByRole("button", { name: "Load more" });
    expect(requests).toHaveLength(2);
    expect(
      requests.map((url) => [url.searchParams.get("limit"), url.searchParams.get("searchSource")]),
    ).toEqual([
      ["25", "clawhub-web"],
      ["26", null],
    ]);
    expect(document.querySelectorAll(".skill-list-item")).toHaveLength(25);
    expect(screen.queryByText("Plugin 26")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await screen.findByText("Plugin 26");
    expect(requests.at(-1)?.searchParams.has("searchSource")).toBe(false);
    expect(requests.filter((url) => url.searchParams.has("searchSource"))).toHaveLength(1);
  });

  it("does not dispatch emptied or canceled input before the debounce completes", async () => {
    await openPlugins("/plugins");
    requests.length = 0;
    vi.useFakeTimers();
    const input = screen.getByPlaceholderText("Search plugins...");
    fireEvent.change(input, { target: { value: "notion" } });
    fireEvent.change(input, { target: { value: "" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(requests.some((url) => url.pathname.endsWith("/search"))).toBe(false);
    fireEvent.change(input, { target: { value: "calendar" } });
    cleanup();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(requests.some((url) => url.searchParams.has("searchSource"))).toBe(false);
  });

  it("does not count a settled typeahead again when opening full search results", async () => {
    await openGlobalSearch();
    const input = await screen.findByRole("combobox");
    fireEvent.change(input, { target: { value: "notion" } });
    await waitFor(() => expect(requests).toHaveLength(1));
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests.filter((url) => url.searchParams.has("searchSource"))).toHaveLength(1);
    expect(requests[1].searchParams.has("searchSource")).toBe(false);
  });

  it("shows failed plugin searches instead of presenting an official gap as an empty result", async () => {
    await openGlobalSearch();
    vi.mocked(fetch).mockResolvedValue(new Response("Search unavailable", { status: 503 }));
    const input = screen.getByPlaceholderText("Search skills, plugins, and creators...");
    fireEvent.change(input, { target: { value: "notion" } });
    fireEvent.submit(input.closest("form")!);
    expect((await screen.findByRole("alert")).textContent).toContain("Unable to search plugins");
  });

  it("shows a failed typeahead plugin search without claiming there were no matches", async () => {
    await openGlobalSearch();
    vi.mocked(fetch).mockResolvedValue(new Response("Search unavailable", { status: 503 }));
    fireEvent.change(await screen.findByRole("combobox"), { target: { value: "notion" } });
    expect((await screen.findByRole("alert")).textContent).toContain("Unable to search plugins");
    expect(screen.queryByText(/No skills, plugins, or creators found/)).toBeNull();
  });
});
