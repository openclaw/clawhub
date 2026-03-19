import { describe, expect, it, vi } from "vitest";
import { startThemeTransition } from "./theme-transition";

describe("startThemeTransition", () => {
  it("no-ops when theme does not change", () => {
    const setTheme = vi.fn();
    startThemeTransition({
      currentTheme: "dark",
      nextTheme: "dark",
      setTheme,
    });
    expect(setTheme).not.toHaveBeenCalled();
  });

  it("applies theme without document (SSR)", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "document");
    Object.defineProperty(globalThis, "document", { value: undefined, configurable: true });

    try {
      const calls: string[] = [];
      const setTheme = vi.fn();
      startThemeTransition({
        currentTheme: "light",
        nextTheme: "dark",
        setTheme,
        onBeforeThemeChange: () => calls.push("before"),
        onAfterThemeChange: () => calls.push("after"),
      });
      expect(calls).toEqual(["before", "after"]);
      expect(setTheme).toHaveBeenCalledWith("dark");
    } finally {
      if (original) Object.defineProperty(globalThis, "document", original);
      else delete (globalThis as unknown as { document?: unknown }).document;
    }
  });

  it("skips view-transition when prefers reduced motion", () => {
    const setTheme = vi.fn();
    const root = document.documentElement;

    window.matchMedia = vi.fn(() => ({ matches: true }) as unknown as MediaQueryList);
    (document as unknown as { startViewTransition?: unknown }).startViewTransition = vi.fn();

    startThemeTransition({
      currentTheme: "light",
      nextTheme: "dark",
      setTheme,
      context: { pointerClientX: 10, pointerClientY: 10 },
    });

    expect(setTheme).toHaveBeenCalledWith("dark");
    expect(root.classList.contains("theme-transition")).toBe(false);
    expect(
      (document as unknown as { startViewTransition?: unknown }).startViewTransition,
    ).not.toHaveBeenCalled();
  });

  it("uses view-transition when available", async () => {
    const setTheme = vi.fn();
    const root = document.documentElement;

    window.matchMedia = vi.fn(() => ({ matches: false }) as unknown as MediaQueryList);

    (
      document as unknown as {
        startViewTransition?: (callback: () => void) => { finished: Promise<void> };
      }
    ).startViewTransition = (callback) => {
      callback();
      return { finished: Promise.resolve() };
    };

    startThemeTransition({
      currentTheme: "light",
      nextTheme: "dark",
      setTheme,
      context: { pointerClientX: 10, pointerClientY: 20 },
    });

    expect(setTheme).toHaveBeenCalledWith("dark");
    expect(root.classList.contains("theme-transition")).toBe(true);

    await new Promise((r) => setTimeout(r, 0));
    expect(root.classList.contains("theme-transition")).toBe(false);
    expect(root.style.getPropertyValue("--theme-switch-x")).toBe("");
    expect(root.style.getPropertyValue("--theme-switch-y")).toBe("");
  });

  it("cleans up when view-transition does not provide finished", () => {
    const setTheme = vi.fn();
    const root = document.documentElement;

    window.matchMedia = vi.fn(() => ({ matches: false }) as unknown as MediaQueryList);
    (
      document as unknown as { startViewTransition?: (callback: () => void) => unknown }
    ).startViewTransition = (callback) => {
      callback();
      return {};
    };

    startThemeTransition({
      currentTheme: "light",
      nextTheme: "dark",
      setTheme,
      context: { element: document.body },
    });

    expect(setTheme).toHaveBeenCalledWith("dark");
    expect(root.classList.contains("theme-transition")).toBe(false);
  });

  it("falls back when view-transition throws", () => {
    const setTheme = vi.fn();
    const root = document.documentElement;

    window.matchMedia = vi.fn(() => ({ matches: false }) as unknown as MediaQueryList);
    (document as unknown as { startViewTransition?: () => never }).startViewTransition = () => {
      throw new Error("nope");
    };

    const element = document.createElement("button");
    element.getBoundingClientRect = () => ({ left: 10, top: 10, width: 10, height: 10 }) as DOMRect;

    startThemeTransition({
      currentTheme: "light",
      nextTheme: "dark",
      setTheme,
      context: { element },
    });

    expect(setTheme).toHaveBeenCalledWith("dark");
    expect(root.classList.contains("theme-transition")).toBe(false);
  });
});
