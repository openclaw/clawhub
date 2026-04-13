import { useEffect, useState } from 'react';
import {
  clearStoredCustomTheme,
  getStoredCustomTheme,
  parseThemeInput,
  setStoredCustomTheme,
  syncCustomThemeFromStorage,
  type CustomThemeData,
} from './customTheme';

export type ThemeName = 'claw' | 'hub';
export type ThemeMode = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export type ThemeSelection = {
  theme: ThemeName;
  mode: ThemeMode;
};

const THEME_SELECTION_KEY = 'clawhub-theme-selection';
const THEME_KEY = 'clawhub-theme';
const LEGACY_THEME_KEY = 'clawdhub-theme';
const THEME_NAME_KEY = 'clawhub-theme-name';
const THEME_CHANGE_EVENT = 'clawhub:themechange';

export const THEME_OPTIONS: Array<{ value: ThemeName; label: string; description: string }> = [
  {
    value: 'claw',
    label: 'Claw',
    description: 'OpenClaw black, white, and red.',
  },
  {
    value: 'hub',
    label: 'Hub',
    description: 'Marketplace monochrome index with terminal-style contrast.',
  },
];

export const THEME_FAMILY_OPTIONS = THEME_OPTIONS;

const VALID_THEME_NAMES = new Set<ThemeName>(['claw', 'hub']);
const VALID_THEME_MODES = new Set<ThemeMode>(['system', 'light', 'dark']);

const LEGACY_MAP: Record<string, ThemeSelection> = {
  dark: { theme: 'claw', mode: 'dark' },
  light: { theme: 'claw', mode: 'light' },
  system: { theme: 'claw', mode: 'system' },
  defaultTheme: { theme: 'claw', mode: 'dark' },
  docsTheme: { theme: 'claw', mode: 'light' },
  lightTheme: { theme: 'claw', mode: 'dark' },
  landingTheme: { theme: 'claw', mode: 'dark' },
  newTheme: { theme: 'claw', mode: 'dark' },
  openknot: { theme: 'claw', mode: 'dark' },
  fieldmanual: { theme: 'hub', mode: 'dark' },
  clawdash: { theme: 'hub', mode: 'light' },
};

function parseThemeSelection(themeRaw: unknown, modeRaw: unknown): ThemeSelection {
  const theme = typeof themeRaw === 'string' ? themeRaw : '';
  const mode = typeof modeRaw === 'string' ? modeRaw : '';

  const normalizedTheme = VALID_THEME_NAMES.has(theme as ThemeName)
    ? (theme as ThemeName)
    : (LEGACY_MAP[theme]?.theme ?? 'claw');
  const normalizedMode = VALID_THEME_MODES.has(mode as ThemeMode)
    ? (mode as ThemeMode)
    : (LEGACY_MAP[theme]?.mode ?? 'system');

  return { theme: normalizedTheme, mode: normalizedMode };
}

function persistThemeSelection(selection: ThemeSelection) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(THEME_SELECTION_KEY, JSON.stringify(selection));
  window.localStorage.setItem(THEME_KEY, selection.mode);
  window.localStorage.setItem(THEME_NAME_KEY, selection.theme);
}

export function getStoredThemeSelection(): ThemeSelection {
  if (typeof window === 'undefined') return { theme: 'claw', mode: 'system' };

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

  return { theme: 'claw', mode: 'system' };
}

export function getStoredTheme(): ThemeMode {
  return getStoredThemeSelection().mode;
}

export function getStoredThemeName(): ThemeName {
  return getStoredThemeSelection().theme;
}

export function getThemeFamilyLabel(theme: ThemeName): string {
  return THEME_OPTIONS.find((option) => option.value === theme)?.label ?? 'Claw';
}

function resolveMode(mode: ThemeMode): ResolvedTheme {
  if (mode !== 'system') return mode;
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function resolveTheme(theme: ThemeName, mode: ThemeMode): ResolvedTheme {
  void theme;
  return resolveMode(mode);
}

export function isDarkResolvedTheme(resolvedTheme: string | null | undefined): boolean {
  return resolvedTheme === 'dark';
}

export function isDarkThemeResolved(): boolean {
  if (typeof document === 'undefined') return false;
  return isDarkResolvedTheme(document.documentElement.dataset.themeResolved);
}

export function applyTheme(selectionOrMode: ThemeSelection | ThemeMode, theme: ThemeName = 'claw') {
  const selection = typeof selectionOrMode === 'string' ? { theme, mode: selectionOrMode } : selectionOrMode;
  applyThemeSelection(selection);
}

export function applyThemeSelection(selection: ThemeSelection) {
  if (typeof document === 'undefined') return;
  const resolved = resolveTheme(selection.theme, selection.mode);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themeResolved = resolved;
  document.documentElement.dataset.themeMode = selection.mode;
  document.documentElement.dataset.themeFamily = selection.theme;
  document.documentElement.classList.toggle('dark', isDarkResolvedTheme(resolved));
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT));
  }
}

export function onThemeChange(handler: () => void) {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(THEME_CHANGE_EVENT, handler);
  return () => window.removeEventListener(THEME_CHANGE_EVENT, handler);
}

export function useThemeMode() {
  const [selection, setSelection] = useState<ThemeSelection>({ theme: 'claw', mode: 'system' });
  const [isHydrated, setIsHydrated] = useState(false);
  const [customTheme, setCustomTheme] = useState<CustomThemeData | null>(null);

  useEffect(() => {
    setSelection(getStoredThemeSelection());
    setCustomTheme(getStoredCustomTheme());
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    applyThemeSelection(selection);
    persistThemeSelection(selection);
    syncCustomThemeFromStorage();

    if (selection.mode !== 'system' || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      applyThemeSelection(selection);
      syncCustomThemeFromStorage();
    };

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', handler);
      return () => media.removeEventListener('change', handler);
    }

    media.addListener(handler);
    return () => media.removeListener(handler);
  }, [isHydrated, selection]);

  const importCustomTheme = async (input: string) => {
    const parsed = await parseThemeInput(input);
    const theme = {
      ...parsed,
      source: input.trim(),
    };
    setStoredCustomTheme(theme);
    setCustomTheme(theme);
    syncCustomThemeFromStorage();
    return theme;
  };

  const clearCustomTheme = () => {
    clearStoredCustomTheme();
    setCustomTheme(null);
    syncCustomThemeFromStorage();
  };

  return {
    theme: selection.theme,
    family: selection.theme,
    mode: selection.mode,
    selection,
    customTheme,
    setTheme: (theme: ThemeName) => setSelection((current) => ({ ...current, theme })),
    setFamily: (theme: ThemeName) => setSelection((current) => ({ ...current, theme })),
    setMode: (mode: ThemeMode) => setSelection((current) => ({ ...current, mode })),
    importCustomTheme,
    clearCustomTheme,
  };
}
