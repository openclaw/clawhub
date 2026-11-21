import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fetchTemplateCatalog } from "../../lib/packageApi";
import { Route } from "./index";
vi.mock("../../lib/packageApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/packageApi")>()),
  fetchTemplateCatalog: vi.fn(),
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: ({ to, children, ...attrs }: { to: string; children?: React.ReactNode }) => (
    <a href={to} {...attrs}>
      {children}
    </a>
  ),
}));
beforeEach(() => {
  vi.mocked(fetchTemplateCatalog).mockReset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const row = (name: string) => ({
  name,
  displayName: name,
  family: "template" as const,
  ownerHandle: "maker",
  channel: "community" as const,
  isOfficial: false,
  createdAt: 1,
  updatedAt: 1,
});
it("loads the next ranked page with the same typed query and category", async () => {
  vi.spyOn(Route, "useSearch").mockReturnValue({ q: "trip", category: "travel" });
  vi.spyOn(Route, "useNavigate").mockReturnValue(vi.fn());
  vi.spyOn(Route, "useLoaderData").mockReturnValue({
    items: [row("trip-first")],
    nextCursor: "frozen",
  });
  vi.mocked(fetchTemplateCatalog).mockResolvedValue({
    items: [row("trip-next")],
    nextCursor: null,
  });
  const Page = Route.options.component!;
  render(<Page />);
  fireEvent.click(screen.getByRole("button", { name: "Load more" }));
  expect(await screen.findByText("trip-next")).toBeTruthy();
  expect(screen.getByText("trip-first")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  expect(fetchTemplateCatalog).toHaveBeenCalledWith({
    q: "trip",
    category: "travel",
    cursor: "frozen",
    signal: expect.any(AbortSignal),
  });
});

it("keeps failed automatic pagination available for an explicit manual retry", async () => {
  let intersect!: IntersectionObserverCallback;
  const construct = vi.fn();
  const disconnect = vi.fn();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        intersect = callback;
        construct();
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  vi.spyOn(Route, "useSearch").mockReturnValue({ q: "trip", category: "travel" });
  vi.spyOn(Route, "useLoaderData").mockReturnValue({
    items: [row("trip-first")],
    nextCursor: "frozen",
  });
  vi.mocked(fetchTemplateCatalog)
    .mockRejectedValueOnce(new Error("Unavailable"))
    .mockResolvedValueOnce({ items: [row("trip-next")], nextCursor: null });
  const Page = Route.options.component!;
  render(<Page />);

  await act(async () =>
    intersect([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver),
  );

  expect((await screen.findByRole("status")).textContent).toBe(
    "The Template catalog is temporarily unavailable. Please try again later.",
  );
  expect(screen.getByText("trip-first")).toBeTruthy();
  expect(construct).toHaveBeenCalledTimes(1);
  expect(disconnect).toHaveBeenCalled();
  expect(fetchTemplateCatalog).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Load more" }));
  expect(await screen.findByText("trip-next")).toBeTruthy();
  expect(screen.getByText("trip-first")).toBeTruthy();
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  expect(fetchTemplateCatalog).toHaveBeenCalledTimes(2);
  expect(vi.mocked(fetchTemplateCatalog).mock.calls.map(([args]) => args.cursor)).toEqual([
    "frozen",
    "frozen",
  ]);
});
