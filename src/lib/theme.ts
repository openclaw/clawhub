import { useEffect, useState } from "react";

export type ThemeMode = "system" | "light" | "dark";

const THEME_KEY = "clawhub-theme";
const LEGACY_THEME_KEY = "clawdhub-theme";

export function getStoredTheme(): ThemeMode {
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem(THEME_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") return stored;
  const legacy = window.localStorage.getItem(LEGACY_THEME_KEY);
  if (legacy === "light" || legacy === "dark" || legacy === "system") return legacy;
  return "system";
}

function resolveTheme(mode: ThemeMode) {
  if (mode !== "system") return mode;
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(mode: ThemeMode) {
  if (typeof document === "undefined") return;
  const resolved = resolveTheme(mode);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.classList.toggle("dark", resolved === "dark");
}

export function useThemeMode() {
  const [mode, setMode] = useState<ThemeMode>("system");
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    setMode(getStoredTheme());
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    applyTheme(mode);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(THEME_KEY, mode);
    }
    if (mode !== "system" || typeof window === "undefined") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme(mode);
    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }, [isHydrated, mode]);

  return { mode, setMode };
}

export type ResolvedTheme = "light" | "dark";

export function getResolvedTheme(): ResolvedTheme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

/**
 * Returns the currently active theme ("light" | "dark") and reactively updates
 * whenever the theme changes. Observes the `data-theme` attribute on `<html>`
 * which `applyTheme` sets on every toggle.
 */
export function useResolvedTheme(): ResolvedTheme {
  const [theme, setTheme] = useState<ResolvedTheme>(getResolvedTheme);

  useEffect(() => {
    setTheme(getResolvedTheme());

    const observer = new MutationObserver(() => setTheme(getResolvedTheme()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  return theme;
}
