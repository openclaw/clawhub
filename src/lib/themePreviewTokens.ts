import { type CSSProperties, useSyncExternalStore } from "react";
import type { ThemePreview, ThemePreviewPalette } from "../../convex/lib/pluginThemes";
import { isHostedSkillPresentationIconPath } from "../../convex/lib/skillPresentation";
import { isDarkThemeResolved, onThemeChange } from "./theme";

type ThemeMode = "light" | "dark";

/**
 * Maps a portable OpenClaw palette onto the Control UI tokens the theme preview reads,
 * following ui/src/app/theme-palette.ts normalizeThemePalette (--bg = background,
 * --text = foreground, --muted = muted-foreground, --accent, --primary, ...). Applied
 * inline, so it only restyles that preview.
 */
export function themePaletteToPreviewTokens(palette: ThemePreviewPalette): CSSProperties {
  return {
    "--cu-bg": palette.background,
    "--cu-card": palette.card,
    "--cu-text": palette.foreground,
    "--cu-muted": palette.mutedForeground,
    "--cu-border": palette.border,
    "--cu-accent": palette.accent,
    "--cu-primary": palette.primary,
    "--cu-primary-foreground": palette.primaryForeground,
    ...(palette.fontSans ? { "--cu-font": palette.fontSans } : {}),
    ...(palette.fontMono ? { "--cu-mono": palette.fontMono } : {}),
  } as CSSProperties;
}

/**
 * The theme's canvas image under a scrim of its own background, like the Control UI at
 * default visibility: about 16% image in dark mode and 10% in light mode, so text stays
 * on a near-solid surface. Only hosted ClawHub image paths are used.
 */
export function themeBackgroundTokens(url: string | undefined, mode: ThemeMode) {
  if (!isHostedSkillPresentationIconPath(url)) return undefined;
  const scrim = `color-mix(in srgb, var(--cu-bg) ${mode === "light" ? 90 : 84}%, transparent)`;
  return {
    "--cu-background-image": `linear-gradient(${scrim}, ${scrim}), url("${url}")`,
  } as CSSProperties;
}

type ChipColors = Pick<ThemePreviewPalette, "background" | "foreground" | "accent" | "primary">;

/**
 * Chip colors for each shipped mode, as the Control UI Settings cards use them
 * (openclaw/openclaw#197388): background, foreground ink, accent, primary. CSS picks the
 * mode that matches the site and falls back to the other one.
 */
export function themeChipStyle(theme: { light?: ChipColors; dark?: ChipColors }): CSSProperties {
  const style: Record<string, string> = {};
  for (const mode of ["light", "dark"] as const) {
    const colors = theme[mode];
    if (!colors) continue;
    style[`--theme-chip-${mode}-bg`] = colors.background;
    style[`--theme-chip-${mode}-ink`] = colors.foreground;
    style[`--theme-chip-${mode}-accent`] = colors.accent;
    style[`--theme-chip-${mode}-primary`] = colors.primary;
  }
  return style as CSSProperties;
}

/** The mode to show for a theme: the preferred one when it ships, else the one it has. */
export function themeModeFor(theme: Pick<ThemePreview, "light" | "dark">, preferred: ThemeMode) {
  return theme[preferred] ? preferred : theme.light ? "light" : "dark";
}

/** ClawHub's resolved light/dark mode; SSR renders light and hydrates to the real mode. */
export function useSiteThemeMode(): ThemeMode {
  return useSyncExternalStore(
    onThemeChange,
    () => (isDarkThemeResolved() ? "dark" : "light"),
    () => "light",
  );
}
