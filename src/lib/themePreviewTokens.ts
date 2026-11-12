import type { CSSProperties } from "react";
import type { ThemePreview, ThemePreviewPalette } from "../../convex/lib/pluginThemes";
import { isHostedSkillPresentationIconPath } from "../../convex/lib/skillPresentation";

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
 * The theme's canvas image under a scrim of its own background, like the Control UI at
 * default visibility: about 16% image in dark mode and 10% in light mode, so text stays
 * on a near-solid surface. Only hosted ClawHub image paths are used.
 */
export function themeBackgroundTokens(url: string | undefined, mode: "light" | "dark") {
  if (!isHostedSkillPresentationIconPath(url)) return undefined;
  const scrim = `color-mix(in srgb, var(--oc-bg-page) ${mode === "light" ? 90 : 84}%, transparent)`;
  return {
    "--plugin-preview-background": `linear-gradient(${scrim}, ${scrim}), url("${url}")`,
  } as CSSProperties;
}

/**
 * Settings > Appearance chip colors for each shipped mode, summarizing the live preview:
 * pill = primary (buttons, send), dot = accent (active session), lines = foreground.
 * CSS picks the mode that matches the site and falls back to the other one.
 */
export function themeChipStyle(theme: ThemePreview): CSSProperties {
  const style: Record<string, string> = {};
  for (const mode of ["light", "dark"] as const) {
    const palette = theme[mode];
    if (!palette) continue;
    style[`--theme-chip-${mode}-bg`] = palette.background;
    style[`--theme-chip-${mode}-accent`] = palette.primary;
    style[`--theme-chip-${mode}-accent-2`] = palette.accent;
    style[`--theme-chip-${mode}-ink`] = palette.foreground;
  }
  return style as CSSProperties;
}
