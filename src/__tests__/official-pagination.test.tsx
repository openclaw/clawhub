import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { Route } from "../routes/official/index";

const { queryMock, observerCallbacks } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  observerCallbacks: [] as IntersectionObserverCallback[],
}));

vi.mock("../convex/client", () => ({
  convexHttp: { query: (...args: unknown[]) => queryMock(...args) },
}));
vi.mock("../components/PublisherListItem", () => ({
  PublisherListItem: ({ publisher }: { publisher: { _id: string } }) => <div>{publisher._id}</div>,
}));

type Page = ReturnType<typeof page>;
function page(id: string, cursor: string | null) {
  return {
    page: id ? [{ _id: id }] : [],
    counts: { all: 2, organizations: 2, individuals: 0 },
    continueCursor: cursor ?? "",
    isDone: cursor === null,
  };
}

function pendingPage() {
  let resolve!: (value: Page) => void;
  const promise = new Promise<Page>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function officialRouter() {
  const root = createRootRoute();
  const route = Route.update({
    id: "/official",
    path: "/official",
    getParentRoute: () => root,
  } as never);
  return createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ["/official?q=old"] }),
  });
}

beforeEach(() => {
  queryMock.mockReset();
  observerCallbacks.length = 0;
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        observerCallbacks.push(callback);
      }
      observe() {}
      disconnect() {}
    },
  );
});

it("keeps the same official route input when search loads a new first page", async () => {
  queryMock.mockImplementation((_reference, args) =>
    Promise.resolve(page(`${args.query}-first`, `${args.query}:1`)),
  );
  const router = officialRouter();
  render(<RouterProvider router={router} />);
  await screen.findByText("old-first");
  const input = screen.getByRole("searchbox", { name: "official organization search" });

  await act(async () => router.navigate({ to: "/official", search: { q: "new" } }));

  await screen.findByText("new-first");
  expect(screen.queryByText("old-first")).toBeNull();
  expect(screen.getByRole("searchbox", { name: "official organization search" })).toBe(input);
  expect((input as HTMLInputElement).value).toBe("new");
});

it("rejects an old pagination response after the router publishes a new query", async () => {
  const oldPage = pendingPage();
  queryMock.mockImplementation((_reference, args) =>
    args.paginationOpts.cursor
      ? oldPage.promise
      : Promise.resolve(page(`${args.query}-first`, `${args.query}:1`)),
  );
  const router = officialRouter();
  render(<RouterProvider router={router} />);
  await screen.findByText("old-first");
  fireEvent.click(screen.getByRole("button", { name: "Load more" }));
  expect(queryMock).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.objectContaining({ query: "old", paginationOpts: { cursor: "old:1", numItems: 25 } }),
  );
  await act(async () => router.navigate({ to: "/official", search: { q: "new" } }));
  await screen.findByText("new-first");

  await act(async () => oldPage.resolve(page("old-second", "old:2")));

  expect(screen.queryByText("old-second")).toBeNull();
  expect(screen.getByText("new-first")).toBeTruthy();
});

it("keeps new pagination pending when the old query request settles", async () => {
  const oldPage = pendingPage();
  const newPage = pendingPage();
  queryMock.mockImplementation((_reference, args) =>
    args.paginationOpts.cursor
      ? args.query === "old"
        ? oldPage.promise
        : newPage.promise
      : Promise.resolve(page(`${args.query}-first`, `${args.query}:1`)),
  );
  const router = officialRouter();
  render(<RouterProvider router={router} />);
  await screen.findByText("old-first");
  fireEvent.click(screen.getByRole("button", { name: "Load more" }));
  await act(async () => router.navigate({ to: "/official", search: { q: "new" } }));
  await screen.findByText("new-first");
  fireEvent.click(screen.getByRole("button", { name: "Load more" }));
  expect((screen.getByRole("button", { name: "Loading..." }) as HTMLButtonElement).disabled).toBe(
    true,
  );

  await act(async () => oldPage.resolve(page("", "old:2")));

  expect((screen.getByRole("button", { name: "Loading..." }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  await act(async () => newPage.resolve(page("new-second", null)));
  expect(screen.getByText("new-second")).toBeTruthy();
});

it("appends pages in order with the returned cursor until pagination completes", async () => {
  queryMock.mockImplementation((_reference, args) =>
    Promise.resolve(
      args.paginationOpts.cursor === null ? page("first", "next") : page("second", null),
    ),
  );
  render(<RouterProvider router={officialRouter()} />);
  await screen.findByText("first");

  fireEvent.click(screen.getByRole("button", { name: "Load more" }));

  await screen.findByText("second");
  expect(queryMock).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.objectContaining({ query: "old", paginationOpts: { cursor: "next", numItems: 25 } }),
  );
  expect(
    Array.from(document.querySelectorAll(".publisher-directory-list > div")).map(
      (row) => row.textContent,
    ),
  ).toEqual(["first", "second"]);
  expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
});

it("shares the in-flight fence between manual and observed loading", async () => {
  const nextPage = pendingPage();
  queryMock.mockImplementation((_reference, args) =>
    args.paginationOpts.cursor ? nextPage.promise : Promise.resolve(page("first", "next")),
  );
  render(<RouterProvider router={officialRouter()} />);
  await screen.findByText("first");
  fireEvent.click(screen.getByRole("button", { name: "Load more" }));
  await act(async () => {
    observerCallbacks[0]?.(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
  });
  expect(queryMock).toHaveBeenCalledTimes(2);
  expect((screen.getByRole("button", { name: "Loading..." }) as HTMLButtonElement).disabled).toBe(
    true,
  );

  await act(async () => nextPage.resolve(page("second", null)));
  expect(screen.getByText("second")).toBeTruthy();
  expect(queryMock).toHaveBeenCalledTimes(2);
});
