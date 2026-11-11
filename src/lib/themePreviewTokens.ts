import type { CSSProperties } from "react";
import type { ThemePreview, ThemePreviewPalette } from "../../convex/lib/pluginThemes";

/**
 * Maps a portable OpenClaw theme palette onto the Carapace tokens the compact
 * OpenClaw preview reads. Applied inline, so it only restyles that preview.
 */
export function themePaletteToPreviewTokens(palette: ThemePreviewPalette): CSSProperties {
  return {
    "--oc-bg-page": palette.background,
    "--oc-bg-recessed": palette.background,
    "--oc-bg-surface": palette.card,
    "--oc-border-subtle": palette.border,
    "--oc-text-primary": palette.foreground,
    "--oc-text-muted": palette.mutedForeground,
    "--oc-surface-interactive": palette.secondary,
    "--oc-text-secondary": palette.secondaryForeground,
    "--oc-accent-primary": palette.primary,
    "--oc-text-on-accent": palette.primaryForeground,
    // Carapace derives links from the root accent, so the scoped value is set directly.
    "--oc-text-link": palette.primary,
    "--oc-surface-accent-soft": palette.accent,
    // Text on accent surfaces (the active session row), paired like the portable palette.
    "--oc-accent-secondary": palette.accentForeground,
    ...(palette.fontSans ? { "--oc-font-body": palette.fontSans } : {}),
    ...(palette.fontMono ? { "--oc-font-mono": palette.fontMono } : {}),
  } as CSSProperties;
}

/**
 * Settings > Appearance chip colors for each shipped mode. CSS picks the mode that
 * matches the site and falls back to the other one.
 */
export function themeChipStyle(theme: ThemePreview): CSSProperties {
  const style: Record<string, string> = {};
  for (const mode of ["light", "dark"] as const) {
    const palette = theme[mode];
    if (!palette) continue;
    style[`--theme-chip-${mode}-bg`] = palette.background;
    style[`--theme-chip-${mode}-accent`] = palette.accent;
    style[`--theme-chip-${mode}-accent-2`] = palette.primary;
    style[`--theme-chip-${mode}-ink`] = mode === "light" ? "#000" : "#fff";
  }
  return style as CSSProperties;
}
