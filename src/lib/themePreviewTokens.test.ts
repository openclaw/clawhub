import { describe, expect, it } from "vitest";
import { themeChipStyle, themePaletteToPreviewTokens } from "./themePreviewTokens";

const palette = {
  background: "#061009",
  foreground: "#e1f1e5",
  card: "#0a1710",
  primary: "#e6c178",
  primaryForeground: "#171207",
  secondary: "#16281d",
  secondaryForeground: "#e6c178",
  mutedForeground: "#afc9b8",
  accent: "#243e2c",
  accentForeground: "#f0d79d",
  border: "#35523e",
};

describe("themePaletteToPreviewTokens", () => {
  it("maps portable palette keys onto the Carapace tokens the preview reads", () => {
    expect(themePaletteToPreviewTokens(palette)).toEqual({
      "--oc-bg-page": "#061009",
      "--oc-bg-recessed": "#061009",
      "--oc-bg-surface": "#0a1710",
      "--oc-border-subtle": "#35523e",
      "--oc-text-primary": "#e1f1e5",
      "--oc-text-muted": "#afc9b8",
      "--oc-surface-interactive": "#16281d",
      "--oc-text-secondary": "#e6c178",
      "--oc-accent-primary": "#e6c178",
      "--oc-text-on-accent": "#171207",
      "--oc-text-link": "#e6c178",
      "--oc-surface-accent-soft": "#243e2c",
      "--oc-accent-secondary": "#f0d79d",
    });
  });

  it("uses the theme fonts only when declared", () => {
    expect(
      themePaletteToPreviewTokens({
        ...palette,
        fontSans: '"JetBrains Mono", monospace',
        fontMono: "ui-monospace",
      }),
    ).toMatchObject({
      "--oc-font-body": '"JetBrains Mono", monospace',
      "--oc-font-mono": "ui-monospace",
    });
  });
});

describe("themeChipStyle", () => {
  it("sets chip colors only for the modes a theme ships", () => {
    expect(themeChipStyle({ id: "canopy-dark", name: "Artemis Canopy", dark: palette })).toEqual({
      "--theme-chip-dark-bg": "#061009",
      "--theme-chip-dark-accent": "#243e2c",
      "--theme-chip-dark-accent-2": "#e6c178",
      "--theme-chip-dark-ink": "#fff",
    });
  });
});
