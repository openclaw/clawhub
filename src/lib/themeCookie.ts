export type ThemeMode = "system" | "light" | "dark";

export const THEME_MODE_COOKIE = "clawhub-theme-mode";
export const VALID_THEME_MODES = new Set<ThemeMode>(["system", "light", "dark"]);

// Browsers cap long-lived client-set cookies, so use the practical maximum.
const THEME_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 400;

export function normalizeThemeMode(value: unknown): ThemeMode {
  return typeof value === "string" && VALID_THEME_MODES.has(value as ThemeMode)
    ? (value as ThemeMode)
    : "system";
}

export function getThemeModeFromCookieHeader(cookieHeader: string | null | undefined): ThemeMode {
  if (!cookieHeader) return "system";

  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValueParts] = part.trim().split("=");
    if (rawName !== THEME_MODE_COOKIE) continue;

    try {
      return normalizeThemeMode(decodeURIComponent(rawValueParts.join("=")));
    } catch {
      return "system";
    }
  }

  return "system";
}

export function createThemeModeCookie(mode: ThemeMode): string {
  return `${THEME_MODE_COOKIE}=${encodeURIComponent(mode)}; Max-Age=${THEME_COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Lax`;
}
