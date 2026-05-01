import { useEffect, useState } from "react";

type ThemeName = "claw";
type ThemeMode = "system" | "light" | "dark";
type ResolvedTheme = "light" | "dark";

type ThemeSelection = {
  theme: ThemeName;
  mode: ThemeMode;
};

const THEME_SELECTION_KEY = "clawhub-theme-selection";
const THEME_KEY = "clawhub-theme";
const LEGACY_THEME_KEY = "clawdhub-theme";
const THEME_NAME_KEY = "clawhub-theme-name";
const THEME_CHANGE_EVENT = "clawhub:themechange";
const LEGACY_CUSTOM_THEME_KEY = "clawhub-custom-theme";
const LEGACY_PREFERENCES_KEY = "clawhub-preferences";
const LEGACY_CUSTOM_THEME_STYLE_ID = "clawhub-custom-theme-style";
const LEGACY_CUSTOM_THEME_FONT_LINK_ID = "clawhub-custom-theme-fonts";

const VALID_THEME_NAMES = new Set<ThemeName>(["claw"]);
const VALID_THEME_MODES = new Set<ThemeMode>(["system", "light", "dark"]);
const DEFAULT_THEME_SELECTION: ThemeSelection = { theme: "claw", mode: "system" };
const LEGACY_VISUAL_STORAGE_KEYS = [LEGACY_CUSTOM_THEME_KEY, LEGACY_PREFERENCES_KEY] as const;
const LEGACY_VISUAL_COOKIE_KEYS = [
  LEGACY_CUSTOM_THEME_KEY,
  LEGACY_PREFERENCES_KEY,
  THEME_SELECTION_KEY,
  THEME_KEY,
  THEME_NAME_KEY,
  LEGACY_THEME_KEY,
] as const;

const LEGACY_MAP: Record<string, ThemeSelection> = {
  dark: { theme: "claw", mode: "dark" },
  light: { theme: "claw", mode: "light" },
  system: { theme: "claw", mode: "system" },
};

function parseThemeSelection(themeRaw: unknown, modeRaw: unknown): ThemeSelection {
  const theme = typeof themeRaw === "string" ? themeRaw : "";
  const mode = typeof modeRaw === "string" ? modeRaw : "";

  const normalizedTheme = VALID_THEME_NAMES.has(theme as ThemeName)
    ? (theme as ThemeName)
    : (LEGACY_MAP[theme]?.theme ?? "claw");
  const normalizedMode = VALID_THEME_MODES.has(mode as ThemeMode)
    ? (mode as ThemeMode)
    : (LEGACY_MAP[theme]?.mode ?? "system");

  return { theme: normalizedTheme, mode: normalizedMode };
}

function persistThemeSelection(selection: ThemeSelection) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(THEME_SELECTION_KEY, JSON.stringify(selection));
  window.localStorage.setItem(THEME_KEY, selection.mode);
  window.localStorage.setItem(THEME_NAME_KEY, selection.theme);
}

function safeGetLocalStorageItem(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function removeLocalStorageKeys(keys: readonly string[]) {
  if (typeof window === "undefined") return;
  try {
    for (const key of keys) {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Storage can be blocked; cookie and DOM cleanup still need to run.
  }
}

function hasLegacyVisualCookie(): boolean {
  if (typeof document === "undefined" || !document.cookie) return false;
  const cookieNames = new Set(
    document.cookie
      .split(";")
      .map((part) => part.trim().split("=")[0])
      .filter(Boolean),
  );
  return LEGACY_VISUAL_COOKIE_KEYS.some((key) => cookieNames.has(key));
}

function clearLegacyVisualCookies() {
  if (typeof document === "undefined") return;
  for (const key of LEGACY_VISUAL_COOKIE_KEYS) {
    document.cookie = `${key}=; Max-Age=0; path=/`;
    document.cookie = `${key}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  }
}

function clearLegacyVisualDomState() {
  if (typeof document === "undefined") return;
  document.getElementById(LEGACY_CUSTOM_THEME_STYLE_ID)?.remove();
  document.getElementById(LEGACY_CUSTOM_THEME_FONT_LINK_ID)?.remove();
  document.documentElement.classList.remove("theme-custom", "high-contrast", "reduce-motion");
  delete document.documentElement.dataset.density;
  delete document.documentElement.dataset.animation;
  document.documentElement.style.removeProperty("--code-font-size");
}

function storedSelectionUsesUnsupportedTheme(): boolean {
  const rawSelection = safeGetLocalStorageItem(THEME_SELECTION_KEY);
  if (rawSelection) {
    try {
      const parsed = JSON.parse(rawSelection) as Partial<ThemeSelection>;
      if (typeof parsed.theme === "string" && !VALID_THEME_NAMES.has(parsed.theme as ThemeName)) {
        return true;
      }
    } catch {
      return true;
    }
  }

  const storedThemeName = safeGetLocalStorageItem(THEME_NAME_KEY);
  if (storedThemeName && !VALID_THEME_NAMES.has(storedThemeName as ThemeName)) {
    return true;
  }

  const storedMode = safeGetLocalStorageItem(THEME_KEY);
  if (storedMode && !VALID_THEME_MODES.has(storedMode as ThemeMode)) {
    return true;
  }

  const legacyTheme = safeGetLocalStorageItem(LEGACY_THEME_KEY);
  return Boolean(legacyTheme && !VALID_THEME_MODES.has(legacyTheme as ThemeMode));
}

function cleanupLegacyVisualSettings(): boolean {
  if (typeof window === "undefined") return false;

  const hasLegacyStorage = LEGACY_VISUAL_STORAGE_KEYS.some(
    (key) => safeGetLocalStorageItem(key) !== null,
  );
  const shouldReset =
    hasLegacyStorage || storedSelectionUsesUnsupportedTheme() || hasLegacyVisualCookie();

  if (!shouldReset) return false;

  removeLocalStorageKeys([
    ...LEGACY_VISUAL_STORAGE_KEYS,
    THEME_SELECTION_KEY,
    THEME_KEY,
    THEME_NAME_KEY,
    LEGACY_THEME_KEY,
  ]);
  try {
    persistThemeSelection(DEFAULT_THEME_SELECTION);
  } catch {
    // Storage can be blocked; DOM and cookie cleanup still reset the active page.
  }
  clearLegacyVisualCookies();
  clearLegacyVisualDomState();
  return true;
}

export function getStoredThemeSelection(): ThemeSelection {
  if (typeof window === "undefined") return DEFAULT_THEME_SELECTION;

  if (cleanupLegacyVisualSettings()) return DEFAULT_THEME_SELECTION;

  try {
    const storedSelection = window.localStorage.getItem(THEME_SELECTION_KEY);
    if (storedSelection) {
      const parsed = JSON.parse(storedSelection) as Partial<ThemeSelection>;
      return parseThemeSelection(parsed.theme, parsed.mode);
    }
  } catch {
    // fall through to legacy keys
  }

  const storedMode = window.localStorage.getItem(THEME_KEY);
  const storedTheme = window.localStorage.getItem(THEME_NAME_KEY);
  if (storedMode || storedTheme) {
    return parseThemeSelection(storedTheme, storedMode);
  }

  const legacy = window.localStorage.getItem(LEGACY_THEME_KEY);
  if (legacy) {
    return parseThemeSelection(legacy, undefined);
  }

  return DEFAULT_THEME_SELECTION;
}

export function getStoredTheme(): ThemeMode {
  return getStoredThemeSelection().mode;
}

export function getStoredThemeName(): ThemeName {
  return getStoredThemeSelection().theme;
}

function resolveMode(mode: ThemeMode): ResolvedTheme {
  if (mode !== "system") return mode;
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolveTheme(theme: ThemeName, mode: ThemeMode): ResolvedTheme {
  void theme;
  return resolveMode(mode);
}

function isDarkResolvedTheme(resolvedTheme: string | null | undefined): boolean {
  return resolvedTheme === "dark";
}

export function isDarkThemeResolved(): boolean {
  if (typeof document === "undefined") return false;
  return isDarkResolvedTheme(document.documentElement.dataset.themeResolved);
}

export function applyTheme(selectionOrMode: ThemeSelection | ThemeMode, theme: ThemeName = "claw") {
  const selection =
    typeof selectionOrMode === "string" ? { theme, mode: selectionOrMode } : selectionOrMode;
  applyThemeSelection(selection);
}

function applyThemeSelection(selection: ThemeSelection) {
  if (typeof document === "undefined") return;
  const resolved = resolveTheme(selection.theme, selection.mode);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themeResolved = resolved;
  document.documentElement.dataset.themeMode = selection.mode;
  document.documentElement.dataset.themeFamily = selection.theme;
  document.documentElement.classList.toggle("dark", isDarkResolvedTheme(resolved));
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT));
  }
}

export function onThemeChange(handler: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(THEME_CHANGE_EVENT, handler);
  return () => window.removeEventListener(THEME_CHANGE_EVENT, handler);
}

export function useThemeMode() {
  const [selection, setSelection] = useState<ThemeSelection>(DEFAULT_THEME_SELECTION);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    setSelection(getStoredThemeSelection());
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (!isHydrated) return () => {};
    applyThemeSelection(selection);
    persistThemeSelection(selection);

    if (
      selection.mode !== "system" ||
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return () => {};
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      applyThemeSelection(selection);
    };

    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", handler);
      return () => media.removeEventListener("change", handler);
    }

    media.addListener(handler);
    return () => media.removeListener(handler);
  }, [isHydrated, selection]);

  return {
    theme: selection.theme,
    mode: selection.mode,
    selection,
    setMode: (mode: ThemeMode) => setSelection((current) => ({ ...current, mode })),
  };
}
