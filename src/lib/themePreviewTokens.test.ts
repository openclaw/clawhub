import { describe, expect, it } from "vitest";
import {
  themeBackgroundTokens,
  themeChipStyle,
  themeModeFor,
  themePaletteToPreviewTokens,
} from "./themePreviewTokens";

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
  it("maps portable palette keys onto the Control UI tokens the preview reads", () => {
    expect(themePaletteToPreviewTokens(palette)).toEqual({
      "--cu-bg": "#061009",
      "--cu-card": "#0a1710",
      "--cu-text": "#e1f1e5",
      "--cu-muted": "#afc9b8",
      "--cu-border": "#35523e",
      "--cu-accent": "#243e2c",
      "--cu-primary": "#e6c178",
      "--cu-primary-foreground": "#171207",
    });
  });

  it("uses the theme fonts only when declared", () => {
    expect(
      themePaletteToPreviewTokens({
        ...palette,
        fontSans: '"JetBrains Mono", monospace',
        fontMono: "ui-monospace",
      }),
    ).toMatchObject({ "--cu-font": '"JetBrains Mono", monospace', "--cu-mono": "ui-monospace" });
  });
});

describe("themeChipStyle", () => {
  it("sets background, ink, accent and primary only for the modes a theme ships", () => {
    expect(themeChipStyle({ dark: palette })).toEqual({
      "--theme-chip-dark-bg": "#061009",
      "--theme-chip-dark-ink": "#e1f1e5",
      "--theme-chip-dark-accent": "#243e2c",
      "--theme-chip-dark-primary": "#e6c178",
    });
  });
});

describe("themeModeFor", () => {
  it("prefers the requested mode and falls back to the one a theme ships", () => {
    expect(themeModeFor({ light: palette, dark: palette }, "dark")).toBe("dark");
    expect(themeModeFor({ dark: palette }, "light")).toBe("dark");
    expect(themeModeFor({ light: palette }, "dark")).toBe("light");
  });
});

describe("themeBackgroundTokens", () => {
  const url = `/api/v1/skill-icons/${"a".repeat(64)}`;
  it("layers a background-colored scrim over hosted images only", () => {
    expect(themeBackgroundTokens(url, "dark")).toEqual({
      "--cu-background-image": `linear-gradient(color-mix(in srgb, var(--cu-bg) 84%, transparent), color-mix(in srgb, var(--cu-bg) 84%, transparent)), url("${url}")`,
    });
    expect(themeBackgroundTokens("https://evil.example/x.png", "dark")).toBeUndefined();
    expect(themeBackgroundTokens(`${url}") , url("x`, "light")).toBeUndefined();
  });
});
