import { describe, expect, it } from "vitest";
import { derivePluginManifestSummary } from "./packageRegistry";
import {
  declaredThemeSourcePaths,
  extractThemePreviews,
  getThemeOnlyPreviews,
  packageThemePreviewFields,
} from "./pluginThemes";

const darkPalette = {
  background: "#061009",
  foreground: "#e1f1e5",
  card: "#0a1710",
  "card-foreground": "#f4fff6",
  popover: "#09130d",
  "popover-foreground": "#f4fff6",
  primary: "#e6c178",
  "primary-foreground": "#171207",
  secondary: "#16281d",
  "secondary-foreground": "#e6c178",
  muted: "#0c1810",
  "muted-foreground": "#afc9b8",
  accent: "#243e2c",
  "accent-foreground": "#f0d79d",
  destructive: "#e07b66",
  "destructive-foreground": "#160907",
  border: "#35523e",
  input: "#1d3426",
  ring: "#d1af63",
  "font-sans": '"JetBrains Mono", "SFMono-Regular", Consolas, monospace',
};
const description = "Carbon-black panels and sage-green signals.";
const manifest = {
  id: "artemis-canopy-theme",
  themes: [
    { id: "canopy-dark", name: "Artemis Canopy", description, source: "./themes/canopy-dark.json" },
  ],
};

function themeFile(definition: unknown, path = "themes/canopy-dark.json") {
  const text = JSON.stringify(definition);
  return { path, size: text.length, sha256: "0".repeat(64), text };
}

describe("extractThemePreviews", () => {
  it("keeps only the preview colors and fonts of a valid dark-only theme", () => {
    const [preview] =
      extractThemePreviews(manifest, [
        themeFile({ name: "Artemis Canopy", description, dark: darkPalette }),
      ]) ?? [];
    expect(preview).toEqual({
      id: "canopy-dark",
      name: "Artemis Canopy",
      dark: {
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
        fontSans: '"JetBrains Mono", "SFMono-Regular", Consolas, monospace',
      },
    });
  });

  it.each([
    [
      "an incomplete palette",
      { name: "Artemis Canopy", description, dark: { background: "#000" } },
    ],
    [
      "a CSS injection attempt",
      {
        name: "Artemis Canopy",
        description,
        dark: { ...darkPalette, accent: "red; background: url(x)" },
      },
    ],
    [
      "an unsafe font",
      { name: "Artemis Canopy", description, dark: { ...darkPalette, "font-sans": "inherit" } },
    ],
    ["no palette", { name: "Artemis Canopy", description }],
    ["a mismatched name", { name: "Other", description, dark: darkPalette }],
    ["unsupported fields", { name: "Artemis Canopy", description, dark: darkPalette, css: "x" }],
  ])("drops a theme with %s", (_label, definition) => {
    expect(extractThemePreviews(manifest, [themeFile(definition)])).toBeUndefined();
  });

  it("drops themes whose source is missing, unsafe, or not JSON", () => {
    const valid = { name: "Artemis Canopy", description, dark: darkPalette };
    expect(extractThemePreviews(manifest, [])).toBeUndefined();
    expect(extractThemePreviews(manifest, [{ ...themeFile(valid), text: "{" }])).toBeUndefined();
    const unsafe = { themes: [{ ...manifest.themes[0], source: "../outside.json" }] };
    expect(declaredThemeSourcePaths(unsafe)).toEqual([]);
    expect(extractThemePreviews(unsafe, [themeFile(valid, "../outside.json")])).toBeUndefined();
  });

  it("keeps valid themes when a sibling is invalid", () => {
    const light = { ...darkPalette, background: "#ffffff" };
    const twoThemes = {
      themes: [
        ...manifest.themes,
        { id: "canopy-light", name: "Canopy Light", description, source: "themes/light.json" },
      ],
    };
    const previews = extractThemePreviews(twoThemes, [
      themeFile({ name: "Artemis Canopy", description, dark: { background: "#000" } }),
      themeFile({ name: "Canopy Light", description, light }, "themes/light.json"),
    ]);
    expect(previews?.map((theme) => [theme.id, Boolean(theme.light), Boolean(theme.dark)])).toEqual(
      [["canopy-light", true, false]],
    );
  });
});

describe("theme-only plugins", () => {
  const files = [themeFile({ name: "Artemis Canopy", description, dark: darkPalette })];

  it("adds themes to the manifest summary and the package chip", () => {
    const summary = derivePluginManifestSummary({ pluginManifest: manifest, files });
    expect(summary.themes?.[0]?.id).toBe("canopy-dark");
    expect(getThemeOnlyPreviews(summary)).toHaveLength(1);
    expect(packageThemePreviewFields(summary).themePreview?.name).toBe("Artemis Canopy");
  });

  it("keeps the usual icon for plugins that also ship capabilities", () => {
    const summary = derivePluginManifestSummary({
      pluginManifest: { ...manifest, providers: ["acme"] },
      files,
    });
    expect(summary.themes).toHaveLength(1);
    expect(getThemeOnlyPreviews(summary)).toBeUndefined();
    expect(packageThemePreviewFields(summary)).toEqual({});
  });

  it("keeps the usual icon for theme packs with more than one theme", () => {
    const summary = derivePluginManifestSummary({
      pluginManifest: {
        themes: [
          ...manifest.themes,
          { ...manifest.themes[0], id: "canopy-copy", source: "themes/copy.json" },
        ],
      },
      files: [...files, { ...files[0]!, path: "themes/copy.json" }],
    });
    expect(getThemeOnlyPreviews(summary)).toHaveLength(2);
    expect(packageThemePreviewFields(summary)).toEqual({});
  });
});
