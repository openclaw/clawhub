import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppearanceCatalog } from "../lib/useAppearanceCatalog";
import { AppearanceCatalog } from "./AppearanceCatalog";
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("../lib/useAppearanceCatalog", () => ({ useAppearanceCatalog: vi.fn() }));
const retry = vi.fn();
const loadMore = vi.fn();
beforeEach(() => {
  vi.mocked(useAppearanceCatalog).mockReturnValue({
    page: null,
    loading: true,
    error: null,
    retry,
    loadMore,
  });
});
describe("Appearance shared discovery", () => {
  it("provides accessible child views and search without conflating installation", () => {
    const navigate = vi.fn();
    render(<AppearanceCatalog search={{}} onNavigate={navigate} />);
    expect(screen.getByRole("heading", { name: "Appearance" })).toBeTruthy();
    expect(screen.getByRole("status", { name: "Loading themes" })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Lobster Packs" }));
    expect(navigate).toHaveBeenLastCalledWith({ view: "packs", q: undefined });
    fireEvent.change(screen.getByRole("textbox", { name: "Search themes" }), {
      target: { value: " night " },
    });
    fireEvent.submit(screen.getByRole("search"));
    expect(navigate).toHaveBeenLastCalledWith({ view: undefined, q: "night" });
    expect(screen.queryByRole("button", { name: /install/i })).toBeNull();
  });
  it("exposes errors and retry, never a misleading empty state", () => {
    vi.mocked(useAppearanceCatalog).mockReturnValue({
      page: null,
      loading: false,
      error: "Offline",
      retry,
      loadMore,
    });
    render(<AppearanceCatalog search={{ view: "packs" }} onNavigate={vi.fn()} />);
    expect(screen.getByRole("alert").textContent).toContain("Offline");
    expect(screen.queryByText("No Lobster Packs to show yet")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalled();
  });
  it("allows loading beyond filtered-empty theme pages", () => {
    vi.mocked(useAppearanceCatalog).mockReturnValue({
      page: { kind: "themes", items: [], nextCursor: "next" },
      loading: false,
      error: null,
      retry,
      loadMore,
    });
    render(<AppearanceCatalog search={{}} onNavigate={vi.fn()} />);
    expect(screen.getByText("More results may be available on the next page.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(loadMore).toHaveBeenCalled();
  });
  it("links to immutable theme versions instead of a plugin install", () => {
    vi.mocked(useAppearanceCatalog).mockReturnValue({
      page: {
        kind: "themes",
        items: [
          {
            id: "alice/night",
            name: "Night",
            description: "Calm",
            version: "1.2.3",
            category: "themes",
            author: { handle: "alice" },
            updatedAt: 1,
          },
        ],
        nextCursor: null,
      },
      loading: false,
      error: null,
      retry,
      loadMore,
    });
    render(<AppearanceCatalog search={{}} onNavigate={vi.fn()} />);
    expect(
      screen.getByRole("link", { name: "View Night version 1.2.3" }).getAttribute("href"),
    ).toBe("/~appearance/themes/alice/night?version=1.2.3");
  });
});
