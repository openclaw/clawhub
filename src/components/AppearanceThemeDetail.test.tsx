import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { THEME_COLOR_KEYS, type ThemeRelease } from "clawhub-schema";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchAppearanceTheme } from "../lib/appearance";
import { AppearanceThemeDetail } from "./AppearanceThemeDetail";
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("../lib/appearance", () => ({ fetchAppearanceTheme: vi.fn() }));
const item: ThemeRelease = {
  id: "alice/night",
  name: "Night",
  description: "A calm workspace",
  version: "1.2.3",
  category: "themes",
  author: { handle: "alice" },
  updatedAt: 1,
  sha256: "a".repeat(64),
  definition: {
    name: "Night",
    description: "A calm workspace",
    dark: Object.fromEntries(
      THEME_COLOR_KEYS.map((key) => [key, "#123456"]),
    ) as ThemeRelease["definition"]["dark"],
  },
};
beforeEach(() => {
  vi.mocked(fetchAppearanceTheme).mockReset();
});
describe("pinned Appearance theme detail", () => {
  it("renders a contained palette and checksum without modifying host styles or offering plugin install", async () => {
    vi.mocked(fetchAppearanceTheme).mockResolvedValue(item);
    const original = document.documentElement.getAttribute("style");
    render(<AppearanceThemeDetail owner="alice" slug="night" version="1.2.3" />);
    expect(screen.getByRole("status").textContent).toBe("Loading theme…");
    await screen.findByRole("heading", { name: "Dark palette" });
    expect(fetchAppearanceTheme).toHaveBeenCalledWith(
      "alice",
      "night",
      "1.2.3",
      expect.any(AbortSignal),
    );
    expect(
      screen.getByRole("heading", { name: "Install through OpenClaw Appearance" }),
    ).toBeTruthy();
    expect(screen.getByText(item.sha256)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /install/i })).toBeNull();
    expect(document.documentElement.getAttribute("style")).toBe(original);
  });
  it("retries an unavailable exact version and ignores the old detail after navigation", async () => {
    vi.mocked(fetchAppearanceTheme)
      .mockRejectedValueOnce(new Error("Theme not found or no longer available."))
      .mockResolvedValueOnce(item);
    const { rerender } = render(
      <AppearanceThemeDetail owner="alice" slug="night" version="1.2.3" />,
    );
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByRole("heading", { name: "Night" });
    let resolveOld!: (item: ThemeRelease) => void;
    vi.mocked(fetchAppearanceTheme)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockResolvedValueOnce({ ...item, name: "Day" });
    rerender(<AppearanceThemeDetail owner="alice" slug="old" version="1.2.3" />);
    rerender(<AppearanceThemeDetail owner="alice" slug="day" version="1.2.3" />);
    await screen.findByRole("heading", { name: "Day" });
    resolveOld(item);
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Night" })).toBeNull());
  });
});
