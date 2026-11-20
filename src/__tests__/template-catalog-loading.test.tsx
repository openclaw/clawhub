import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { fetchTemplateCatalog } from "../lib/packageApi";
import { Route } from "../routes/templates/index";
import { Route as Layout } from "../routes/templates/route";

vi.mock("../lib/packageApi", async (original) => ({
  ...(await original<typeof import("../lib/packageApi")>()),
  fetchTemplateCatalog: vi.fn(),
}));

function catalogRouter(initialEntries = ["/templates"]) {
  const root = createRootRoute();
  const layout = Layout.update({
    id: "/templates",
    path: "/templates",
    getParentRoute: () => root,
  } as never);
  const route = Route.update({ id: "/", path: "/", getParentRoute: () => layout } as never);
  return createRouter({
    routeTree: root.addChildren([layout.addChildren([route])]),
    history: createMemoryHistory({ initialEntries }),
    // A fast search can finish before the router publishes a pending match.
    defaultPendingMs: 350,
    defaultPendingMinMs: 0,
  });
}

it("keeps focus and newer keystrokes when a pending catalog or search settles", async () => {
  const router = catalogRouter();
  let finish!: (value: Awaited<ReturnType<typeof fetchTemplateCatalog>>) => void;
  const page = new Promise<Awaited<ReturnType<typeof fetchTemplateCatalog>>>((resolve) => {
    finish = resolve;
  });
  vi.mocked(fetchTemplateCatalog).mockReturnValue(page);
  await act(async () => {
    render(<RouterProvider router={router} />);
  });
  await screen.findByRole("status", { name: "Loading results" });
  const input = screen.getByRole("searchbox", { name: "Template search" });
  expect(screen.getByRole("complementary", { name: "Template categories" })).toBeTruthy();
  input.focus();
  await act(async () => {
    fireEvent.change(input, { target: { value: "hello" } });
  });
  await act(async () => finish({ items: [], nextCursor: null }));
  await screen.findByText("No templates found");
  expect(screen.getByRole("searchbox", { name: "Template search" })).toBe(input);
  expect(document.activeElement).toBe(input);
  expect((input as HTMLInputElement).value).toBe("hello");

  // The response for the submitted text must not replace the next keystroke.
  vi.mocked(fetchTemplateCatalog).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.submit(input.closest("form")!);
  await waitFor(() =>
    expect(fetchTemplateCatalog).toHaveBeenCalledWith(expect.objectContaining({ q: "hello" })),
  );
  fireEvent.change(input, { target: { value: "hello!" } });
  await act(async () => finish({ items: [], nextCursor: null }));
  await waitFor(() => expect(router.state.status).toBe("idle"));
  expect(document.activeElement).toBe(input);
  expect((input as HTMLInputElement).value).toBe("hello!");
});

it("keeps a word separator when the URL acknowledges the trimmed draft", async () => {
  vi.mocked(fetchTemplateCatalog).mockResolvedValue({ items: [], nextCursor: null });
  const router = catalogRouter();
  await act(async () => {
    render(<RouterProvider router={router} />);
  });
  const input = await screen.findByRole("searchbox", { name: "Template search" });
  fireEvent.change(input, { target: { value: "daily " } });
  await waitFor(() => expect(router.state.location.search.q).toBe("daily"));
  expect((input as HTMLInputElement).value).toBe("daily ");
});

it.each(["/templates?q=daily&category=productivity", "/templates?q=daily"])(
  "cancels an unsent draft when Back leaves the history entry %s",
  async (entry) => {
    vi.mocked(fetchTemplateCatalog).mockResolvedValue({ items: [], nextCursor: null });
    const router = catalogRouter(["/templates?q=daily", entry]);
    await act(async () => {
      render(<RouterProvider router={router} />);
    });
    const input = await screen.findByRole("searchbox", { name: "Template search" });
    fireEvent.change(input, { target: { value: "abandoned" } });
    await act(async () => router.history.back());
    await waitFor(() => expect((input as HTMLInputElement).value).toBe("daily"));
    // The superseded debounce must not replace the restored history entry.
    await act(async () => new Promise<void>((resolve) => setTimeout(resolve, 260)));
    expect(router.state.location.search).toEqual({ q: "daily" });
  },
);
