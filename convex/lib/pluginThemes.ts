// Theme previews for plugins that declare OpenClaw \`themes\` in openclaw.plugin.json.
// Validation mirrors OpenClaw's portable theme rules (packages/gateway-protocol/src/theme.ts
// and src/plugins/manifest-themes.ts) so ClawHub does not preview a theme OpenClaw would drop.
// Invalid themes are dropped individually; they never block publication.

/** Portable palette keys the theme chip and compact preview read; nothing else is stored. */
const THEME_PREVIEW_COLOR_KEYS = [
  "background",
  "foreground",
  "card",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "border",
] as const;

// Stored with camelCase keys: Convex object validators reject hyphenated field names.
type CamelCase<T extends string> = T extends `${infer Head}-${infer Tail}`
  ? `${Head}${Capitalize<CamelCase<Tail>>}`
  : T;
type ThemePreviewColorKey = CamelCase<(typeof THEME_PREVIEW_COLOR_KEYS)[number]>;
export type ThemePreviewPalette = Record<ThemePreviewColorKey, string> & {
  fontSans?: string;
  fontMono?: string;
};
export type ThemePreview = {
  id: string;
  name: string;
  light?: ThemePreviewPalette;
  dark?: ThemePreviewPalette;
};

const THEME_COLOR_KEYS = [
  ...THEME_PREVIEW_COLOR_KEYS,
  "card-foreground",
  "popover",
  "popover-foreground",
  "muted",
  "destructive",
  "destructive-foreground",
  "input",
  "ring",
] as const;
const THEME_FONT_KEYS = ["font-sans", "font-mono"] as const;
const PALETTE_KEYS = new Set<string>([...THEME_COLOR_KEYS, ...THEME_FONT_KEYS]);
const PREVIEW_COLOR_KEYS = new Set<string>(THEME_PREVIEW_COLOR_KEYS);
const THEME_DEFINITION_KEYS = new Set([
  "name",
  "description",
  "mascot",
  "brandName",
  "brandIcon",
  "workingIndicator",
  "lobsterdex",
  "communityLinks",
  "workingPhrases",
  "critters",
  "avatarHat",
  "light",
  "dark",
]);
const MAX_PLUGIN_THEMES = 32;
// OpenClaw reads at most 4 × MAX_THEME_DEFINITION_BYTES of formatted theme JSON.
export const MAX_THEME_SOURCE_BYTES = 16_384;
const THEME_LOCAL_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const THEME_SOURCE_PATTERN = /^(?:[a-z0-9_-][a-z0-9._-]*\/)*[a-z0-9_-][a-z0-9._-]*\.json$/i;

const NUMBER = "[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:e[+-]?\\d+)?";
const COMPONENT = `${NUMBER}%?`;
const HUE = `${NUMBER}(?:deg|grad|rad|turn)?`;
const COLOR_PATTERNS = [
  /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i,
  /^(?:transparent|black|white)$/i,
  new RegExp(
    `^(?:(?:rgb|rgba)\\( *(?:${NUMBER} *, *${NUMBER} *, *${NUMBER}|${NUMBER}% *, *${NUMBER}% *, *${NUMBER}%)|(?:hsl|hsla)\\( *${HUE} *, *${NUMBER}% *, *${NUMBER}%)(?: *, *${COMPONENT})? *\\)$`,
    "i",
  ),
  new RegExp(
    `^(?:(?:rgb|rgba|oklab|lab)\\( *${COMPONENT} +${COMPONENT} +${COMPONENT}|(?:hsl|hsla)\\( *${HUE} +${COMPONENT} +${COMPONENT}|(?:oklch|lch)\\( *${COMPONENT} +${COMPONENT} +${HUE})(?: */ *${COMPONENT})? *\\)$`,
    "i",
  ),
  new RegExp(
    `^color\\( *(?:srgb|srgb-linear|display-p3|a98-rgb|prophoto-rgb|rec2020|xyz|xyz-d50|xyz-d65) +${COMPONENT} +${COMPONENT} +${COMPONENT}(?: */ *${COMPONENT})? *\\)$`,
    "i",
  ),
];
const FONT_IDENTIFIER = "(?:--[a-z0-9_-]*|-?[a-z_][a-z0-9_-]*)";
const FONT_FAMILY = `(?:"[a-z0-9 ,'._-]*"|'[a-z0-9 ,"._-]*'|${FONT_IDENTIFIER}(?: +${FONT_IDENTIFIER})*)`;
const FONT_FAMILY_LIST = new RegExp(`^${FONT_FAMILY}(?: *, *${FONT_FAMILY})*$`, "i");
const RESERVED_FONT_WORDS = new Set(["inherit", "initial", "unset", "revert", "revert-layer"]);
const GENERIC_FONT_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "emoji",
  "math",
  "fangsong",
  "-webkit-body",
]);

type JsonRecord = Record<string, unknown>;
type ThemeSourceFile = { path: string; size: number; text?: string };

function camelCase(key: string) {
  return key.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function themeText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  // oxlint-disable-next-line no-control-regex -- OpenClaw rejects ASCII control characters.
  return text && text.length <= maxLength && !/[\u0000-\u001f\u007f]/u.test(value)
    ? text
    : undefined;
}

function isFontFamilyList(value: string) {
  if (!FONT_FAMILY_LIST.test(value)) return false;
  // Quoted names may contain commas or match reserved keywords.
  return value
    .replace(/"[^"]*"|'[^']*'/g, "")
    .split(",")
    .every((family) => {
      const words = family.trim().toLowerCase().split(/ +/);
      return words.every(
        (word) =>
          !RESERVED_FONT_WORDS.has(word) &&
          word !== "default" &&
          (words.length === 1 || !GENERIC_FONT_FAMILIES.has(word)),
      );
    });
}

// undefined: mode not shipped; null: invalid palette, which drops the whole theme.
function previewPalette(value: unknown): ThemePreviewPalette | undefined | null {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return null;
  if (Object.keys(value).some((key) => !PALETTE_KEYS.has(key))) return null;
  const colors = THEME_COLOR_KEYS.map((key) => [key, themeText(value[key], 120)] as const);
  if (colors.some(([, color]) => !color || !COLOR_PATTERNS.some((pattern) => pattern.test(color))))
    return null;
  const palette: Record<string, string> = {};
  for (const [key, color] of colors)
    if (PREVIEW_COLOR_KEYS.has(key)) palette[camelCase(key)] = color!;
  for (const key of THEME_FONT_KEYS) {
    if (value[key] === undefined) continue;
    const font = themeText(value[key], 120);
    if (!font || !isFontFamilyList(font)) return null;
    palette[camelCase(key)] = font;
  }
  // SAFETY: every preview color was validated above; fonts are optional.
  return palette as ThemePreviewPalette;
}

function themeSourcePath(entry: unknown) {
  if (!isRecord(entry) || typeof entry.source !== "string") return undefined;
  const path = entry.source.replace(/^\.\//, "");
  return THEME_SOURCE_PATTERN.test(path) ? path : undefined;
}

function declaredThemes(manifest: unknown): unknown[] {
  // OpenClaw rejects an oversized themes list as a whole.
  const themes = isRecord(manifest) ? manifest.themes : undefined;
  return Array.isArray(themes) && themes.length <= MAX_PLUGIN_THEMES ? themes : [];
}

/** Release file paths whose text the manifest summary needs to derive theme previews. */
export function declaredThemeSourcePaths(manifest: unknown): string[] {
  return declaredThemes(manifest).flatMap((entry) => {
    const path = themeSourcePath(entry);
    return path ? [path] : [];
  });
}

function readThemePreview(entry: unknown, files: ThemeSourceFile[]): ThemePreview | undefined {
  const path = themeSourcePath(entry);
  if (!path || !isRecord(entry)) return undefined;
  const id = typeof entry.id === "string" && THEME_LOCAL_ID_PATTERN.test(entry.id) ? entry.id : "";
  const name = themeText(entry.name, 80);
  const description = themeText(entry.description, 320);
  const file = files.find((candidate) => candidate.path === path);
  if (!id || !name || !description || !file?.text || file.size > MAX_THEME_SOURCE_BYTES)
    return undefined;
  let definition: unknown;
  try {
    definition = JSON.parse(file.text);
  } catch {
    return undefined;
  }
  if (
    !isRecord(definition) ||
    Object.keys(definition).some((key) => !THEME_DEFINITION_KEYS.has(key)) ||
    themeText(definition.name, 80) !== name ||
    themeText(definition.description, 320) !== description
  )
    return undefined;
  const light = previewPalette(definition.light);
  const dark = previewPalette(definition.dark);
  if (light === null || dark === null || (!light && !dark)) return undefined;
  return { id, name, ...(light ? { light } : {}), ...(dark ? { dark } : {}) };
}

export function extractThemePreviews(
  manifest: unknown,
  files: ThemeSourceFile[],
): ThemePreview[] | undefined {
  const ids = new Set<string>();
  const previews = declaredThemes(manifest).flatMap((entry) => {
    const preview = readThemePreview(entry, files);
    if (!preview || ids.has(preview.id)) return [];
    ids.add(preview.id);
    return [preview];
  });
  return previews.length ? previews : undefined;
}

/** Themes of a plugin that ships nothing but themes; other plugins keep their usual icon. */
export function getThemeOnlyPreviews(
  summary:
    | {
        themes?: ThemePreview[];
        contracts?: Record<string, string[]>;
        providers?: string[];
        channels?: string[];
        mcpServers?: unknown[];
        bundledSkills?: unknown[];
      }
    | null
    | undefined,
) {
  if (!summary?.themes?.length) return undefined;
  const hasCapabilities =
    Object.keys(summary.contracts ?? {}).length > 0 ||
    Boolean(summary.providers?.length) ||
    Boolean(summary.channels?.length) ||
    Boolean(summary.mcpServers?.length) ||
    Boolean(summary.bundledSkills?.length);
  return hasCapabilities ? undefined : summary.themes;
}

/**
 * Package-level copy for catalog cards, which never read release summaries. Only a
 * single-theme pack gets the chip; multi-theme packs keep the usual icon fallback.
 */
export function packageThemePreviewFields(summary: Parameters<typeof getThemeOnlyPreviews>[0]): {
  themePreview?: ThemePreview;
} {
  const themes = getThemeOnlyPreviews(summary);
  return themes?.length === 1 ? { themePreview: themes[0] } : {};
}
