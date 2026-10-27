import { describe, expect, it } from "vitest";
import { normalizeThemeDefinition, THEME_COLOR_KEYS } from "./themes";
const palette = Object.fromEntries(THEME_COLOR_KEYS.map((key) => [key, "#123456"]));
const theme = () => ({ name: " Aurora ", description: " A calm palette ", dark: { ...palette } });

describe("portable OpenClaw theme normalization", () => {
  it("normalizes a complete palette in canonical order with built-in branding", () => {
    const input = {
      ...theme(),
      light: { ...palette, "font-sans": "'IBM Plex Sans', sans-serif" },
      mascot: "none",
      brandName: "Aurora",
      brandIcon: "mark",
      workingIndicator: "dots",
      lobsterdex: false,
      communityLinks: true,
      workingPhrases: [" Thinking "],
      critters: ["penguin", "fedora"],
      avatarHat: "crown",
    };
    const normalized = normalizeThemeDefinition(input);
    expect(normalized.name).toBe("Aurora");
    expect(normalized.workingPhrases).toEqual(["Thinking"]);
    expect(Object.keys(normalized)).toEqual([
      "name",
      "description",
      "light",
      "dark",
      "mascot",
      "brandName",
      "brandIcon",
      "workingIndicator",
      "lobsterdex",
      "communityLinks",
      "workingPhrases",
      "critters",
      "avatarHat",
    ]);
    expect(Object.keys(normalized.dark!)).toEqual(THEME_COLOR_KEYS);
    expect(normalizeThemeDefinition(JSON.parse(JSON.stringify(normalized)))).toEqual(normalized);
  });
  it.each([
    "#abc",
    "#abcd",
    "#aabbccdd",
    "transparent",
    "black",
    "white",
    "rgb(1, 2, 3)",
    "rgba(1 2 3 / 50%)",
    "hsl(20deg 40% 50%)",
    "oklch(0.5 0.2 30)",
    "lab(50% 10 20)",
    "color(display-p3 0.1 0.2 0.3 / .5)",
  ])("accepts safe color %s", (color) => {
    expect(
      normalizeThemeDefinition({ ...theme(), dark: { ...palette, background: color } }).dark
        ?.background,
    ).toBe(color);
  });
  it.each([
    "url(https://evil.example/a)",
    "var(--remote)",
    "red; color:blue",
    "expression(alert(1))",
    "<svg/>",
    "rgb(NaN 0 0)",
    "calc(0)",
  ])("rejects executable or unsupported color %s", (color) => {
    expect(() =>
      normalizeThemeDefinition({ ...theme(), dark: { ...palette, background: color } }),
    ).toThrow();
  });
  it.each([
    "url(https://example.com/a.woff)",
    "inherit",
    "sans-serif Surprise",
    "system-ui; color:red",
    "<style>",
  ])("rejects unsafe font %s", (font) => {
    expect(() =>
      normalizeThemeDefinition({ ...theme(), dark: { ...palette, "font-sans": font } }),
    ).toThrow();
  });
  it("rejects missing tokens, unknown fields, URLs as artwork, and duplicate normalized phrases", () => {
    for (const input of [
      { name: "x", description: "y" },
      { ...theme(), dark: { background: "#abc" } },
      { ...theme(), css: "body{}" },
      { ...theme(), dark: { ...palette, color: "#abc" } },
      { ...theme(), brandIcon: "https://example.com/a.svg" },
      { ...theme(), avatarHat: "remote" },
      { ...theme(), critters: ["penguin", "penguin"] },
      { ...theme(), workingPhrases: ["a", " a "] },
      { ...theme(), brandName: "bad\u200bname" },
      { ...theme(), mascot: "other" },
      { ...theme(), lobsterdex: "yes" },
    ])
      expect(() => normalizeThemeDefinition(input)).toThrow();
  });
  it("enforces normalized text and UTF-8 byte limits", () => {
    expect(() => normalizeThemeDefinition({ ...theme(), name: "x".repeat(81) })).toThrow();
    expect(() => normalizeThemeDefinition({ ...theme(), description: "x".repeat(321) })).toThrow();
    const long = Object.fromEntries(
      THEME_COLOR_KEYS.map((key) => [
        key,
        "color(display-p3 0.11111111111111111111111111111111111111111111111 0.2 0.3)",
      ]),
    );
    expect(() =>
      normalizeThemeDefinition({
        name: "界".repeat(80),
        description: "界".repeat(320),
        light: long,
        dark: long,
      }),
    ).toThrow(/4096 bytes/);
  });
});
