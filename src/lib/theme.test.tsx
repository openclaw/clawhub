import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyTheme,
  getStoredTheme,
  getStoredThemeName,
  getStoredThemeSelection,
  useThemeMode,
} from "./theme";

describe("theme", () => {
  let store: Record<string, string>;

  function Harness() {
    const { mode, setMode, theme } = useThemeMode();
    return (
      <div>
        <div data-testid="mode">{mode}</div>
        <div data-testid="theme">{theme}</div>
        <button type="button" onClick={() => setMode("dark")}>
          dark
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
          store[key] = value;
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
      JSON.stringify({ theme: "claw", mode: "light" }),
    );
    expect(getStoredThemeSelection()).toEqual({ theme: "claw", mode: "light" });

    window.localStorage.clear();
    window.localStorage.setItem("clawhub-theme", "dark");
    expect(getStoredTheme()).toBe("dark");

    window.localStorage.clear();
    window.localStorage.setItem("clawdhub-theme", "dark");
    expect(getStoredThemeSelection()).toEqual({ theme: "claw", mode: "dark" });

    window.localStorage.clear();
    window.localStorage.setItem("clawdhub-theme", "openknot");
    expect(getStoredThemeSelection()).toEqual({ theme: "claw", mode: "system" });
  });

  it("clears custom overlay state and resets stale visual settings to system defaults", () => {
    window.localStorage.setItem(
      "clawhub-custom-theme",
      JSON.stringify({ light: { background: "red" }, dark: { background: "black" } }),
    );
    window.localStorage.setItem(
      "clawhub-theme-selection",
      JSON.stringify({ theme: "hub", mode: "dark" }),
    );
    window.localStorage.setItem("clawhub-theme", "dark");
    window.localStorage.setItem("clawhub-theme-name", "hub");
    window.localStorage.setItem(
      "clawhub-preferences",
      JSON.stringify({ layoutDensity: "compact" }),
    );
    document.cookie = "clawhub-custom-theme=1; path=/";
    document.cookie = "clawhub-preferences=1; path=/";

    const style = document.createElement("style");
    style.id = "clawhub-custom-theme-style";
    document.head.appendChild(style);
    const fonts = document.createElement("link");
    fonts.id = "clawhub-custom-theme-fonts";
    document.head.appendChild(fonts);
    document.documentElement.classList.add("theme-custom", "high-contrast", "reduce-motion");
    document.documentElement.dataset.density = "compact";
    document.documentElement.dataset.animation = "none";
    document.documentElement.style.setProperty("--code-font-size", "16px");

    expect(getStoredThemeSelection()).toEqual({ theme: "claw", mode: "system" });
    expect(window.localStorage.getItem("clawhub-custom-theme")).toBeNull();
    expect(window.localStorage.getItem("clawhub-preferences")).toBeNull();
    expect(window.localStorage.getItem("clawhub-theme")).toBe("system");
    expect(window.localStorage.getItem("clawhub-theme-name")).toBe("claw");
    expect(document.cookie).not.toContain("clawhub-custom-theme");
    expect(document.cookie).not.toContain("clawhub-preferences");
    expect(document.getElementById("clawhub-custom-theme-style")).toBeNull();
    expect(document.getElementById("clawhub-custom-theme-fonts")).toBeNull();
    expect(document.documentElement.classList.contains("theme-custom")).toBe(false);
    expect(document.documentElement.classList.contains("high-contrast")).toBe(false);
    expect(document.documentElement.classList.contains("reduce-motion")).toBe(false);
    expect(document.documentElement.dataset.density).toBeUndefined();
    expect(document.documentElement.dataset.animation).toBeUndefined();
    expect(document.documentElement.style.getPropertyValue("--code-font-size")).toBe("");
  });

  it("applies family and resolved mode to the document", () => {
    applyTheme("dark", "claw");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.themeResolved).toBe("dark");
    expect(document.documentElement.dataset.themeFamily).toBe("claw");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    applyTheme("light", "claw");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.dataset.themeResolved).toBe("light");
    expect(document.documentElement.dataset.themeFamily).toBe("claw");
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

  it("useThemeMode persists the supported theme and mode", async () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));

    render(<Harness />);
    expect(screen.getByTestId("mode").textContent).toBe("system");
    expect(screen.getByTestId("theme").textContent).toBe("claw");

    fireEvent.click(screen.getByRole("button", { name: "dark" }));

    await waitFor(() => {
      expect(document.documentElement.dataset.themeFamily).toBe("claw");
      expect(document.documentElement.dataset.themeResolved).toBe("dark");
    });

    expect(window.localStorage.getItem("clawhub-theme")).toBe("dark");
    expect(window.localStorage.getItem("clawhub-theme-name")).toBe("claw");
  });
});
