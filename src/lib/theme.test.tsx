import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyTheme, getStoredTheme, getStoredThemeName, getStoredThemeSelection, useThemeMode } from "./theme";

describe("theme", () => {
  let store: Record<string, string>;

  function Harness() {
    const { family, mode, setFamily, setMode } = useThemeMode();
    return (
      <div>
        <div data-testid="mode">{mode}</div>
        <div data-testid="family">{family}</div>
        <button type="button" onClick={() => setMode("dark")}>
          dark
        </button>
        <button type="button" onClick={() => setFamily("dash")}>
          dash
        </button>
      </div>
    );
  }

  beforeEach(() => {
    store = {};
    Object.defineProperty(window, "localStorage", {
      value: {
        getItem: (key: string) => (key in store ? store[key] : null),
        setItem: (key: string, value: string) => {
          store[key] = String(value);
        },
        removeItem: (key: string) => {
          delete store[key];
        },
        clear: () => {
          store = {};
        },
      },
      configurable: true,
    });
  });

  afterEach(() => {
    document.documentElement.classList.remove("dark");
    delete document.documentElement.dataset.theme;
    delete document.documentElement.dataset.themeResolved;
    delete document.documentElement.dataset.themeFamily;
    delete document.documentElement.dataset.themeMode;
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("reads stored selection with legacy fallback", () => {
    expect(getStoredTheme()).toBe("system");
    expect(getStoredThemeName()).toBe("claw");

    window.localStorage.setItem(
      "clawhub-theme-selection",
      JSON.stringify({ theme: "dash", mode: "light" }),
    );
    expect(getStoredThemeSelection()).toEqual({ theme: "dash", mode: "light" });

    window.localStorage.clear();
    window.localStorage.setItem("clawhub-theme", "dark");
    expect(getStoredTheme()).toBe("dark");

    window.localStorage.clear();
    window.localStorage.setItem("clawdhub-theme", "openknot");
    expect(getStoredThemeSelection()).toEqual({ theme: "knot", mode: "dark" });
  });

  it("applies family and resolved mode to the document", () => {
    applyTheme("dark", "dash");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.themeResolved).toBe("dark");
    expect(document.documentElement.dataset.themeFamily).toBe("dash");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    applyTheme("light", "knot");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.dataset.themeResolved).toBe("light");
    expect(document.documentElement.dataset.themeFamily).toBe("knot");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("resolves system theme via matchMedia", () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    applyTheme("system", "claw");
    expect(document.documentElement.dataset.themeResolved).toBe("dark");
  });

  it("useThemeMode persists family and mode", async () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));

    render(<Harness />);
    expect(screen.getByTestId("mode").textContent).toBe("system");
    expect(screen.getByTestId("family").textContent).toBe("claw");

    fireEvent.click(screen.getByRole("button", { name: "dash" }));
    fireEvent.click(screen.getByRole("button", { name: "dark" }));

    await waitFor(() => {
      expect(document.documentElement.dataset.themeFamily).toBe("dash");
      expect(document.documentElement.dataset.themeResolved).toBe("dark");
    });

    expect(window.localStorage.getItem("clawhub-theme")).toBe("dark");
    expect(window.localStorage.getItem("clawhub-theme-name")).toBe("dash");
  });
});
