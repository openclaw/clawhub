import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
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
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("loads the next ranked page with the same typed query and category", async () => {
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
