/**
 * Lightweight custom theme support for ClawHub.
 *
 * Accepts tweakcn theme URLs, bare tweakcn names, tweakcn JSON payloads,
 * or raw CSS variable blocks, then maps them into ClawHub's token system.
 */

const SUPPORTED_COLOR_VARS = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "destructive-foreground",
  "border",
  "input",
  "ring",
  "info",
  "info-foreground",
  "success",
  "success-foreground",
  "warning",
  "warning-foreground",
] as const;

const SUPPORTED_DESIGN_VARS = ["radius"] as const;
const SUPPORTED_FONT_VARS = ["font-sans", "font-serif", "font-mono"] as const;

const ALL_SUPPORTED_VARS = new Set<string>([
  ...SUPPORTED_COLOR_VARS,
  ...SUPPORTED_DESIGN_VARS,
  ...SUPPORTED_FONT_VARS,
]);

const CUSTOM_THEME_STORAGE_KEY = "clawhub-custom-theme";
const CUSTOM_THEME_STYLE_ID = "clawhub-custom-theme-style";
const CUSTOM_THEME_FONT_LINK_ID = "clawhub-custom-theme-fonts";

const SYSTEM_FONTS = new Set([
  "system-ui",
  "-apple-system",
  "blinkmacsystemfont",
  "segoe ui",
  "roboto",
  "helvetica neue",
  "arial",
  "sans-serif",
  "serif",
  "monospace",
  "sf mono",
  "sfmono-regular",
  "consolas",
  "liberation mono",
  "menlo",
  "courier new",
  "dm sans",
  "georgia",
  "times new roman",
  "times",
  "ui-monospace",
  "ui-sans-serif",
  "ui-serif",
  "bricolage grotesque",
  "manrope",
  "ibm plex mono",
]);

export interface CustomThemeData {
  name?: string | undefined;
  source?: string | undefined;
  light: Record<string, string>;
  dark: Record<string, string>;
}

function hasDom(): boolean {
  return (
    typeof document !== "undefined" &&
    typeof document.getElementById === "function" &&
    typeof document.createElement === "function"
  );
}

function extractBraceContent(css: string, startAfterBrace: number): string {
  let depth = 1;
  let i = startAfterBrace;
  while (i < css.length && depth > 0) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") depth--;
    i++;
  }
  return css.substring(startAfterBrace, i - 1);
}

function extractVariables(block: string): Record<string, string> {
  const vars: Record<string, string> = {};
  const regex = /--([\w-]+)\s*:\s*([^;]+);/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(block)) !== null) {
    const name = match[1]?.trim();
    const value = match[2]?.trim();
    if (!name || !value || !ALL_SUPPORTED_VARS.has(name)) continue;
    vars[name] = value;
  }
  return vars;
}

function filterSupported(vars: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(vars)) {
    if (ALL_SUPPORTED_VARS.has(key)) out[key] = value;
  }
  return out;
}

export function parseThemeCSS(css: string): CustomThemeData {
  const cleaned = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const light: Record<string, string> = {};
  const dark: Record<string, string> = {};

  const rootRegex = /:root\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = rootRegex.exec(cleaned)) !== null) {
    const start = match.index + match[0].length;
    Object.assign(light, extractVariables(extractBraceContent(cleaned, start)));
  }

  const darkRegex = /\.dark\s*\{/g;
  while ((match = darkRegex.exec(cleaned)) !== null) {
    const start = match.index + match[0].length;
    Object.assign(dark, extractVariables(extractBraceContent(cleaned, start)));
  }

  if (Object.keys(light).length === 0 && Object.keys(dark).length === 0) {
    const vars = extractVariables(cleaned);
    Object.assign(light, vars);
    Object.assign(dark, vars);
  }

  return { light, dark };
}

export function parseTweakcnJSON(json: unknown): CustomThemeData {
  if (!json || typeof json !== "object") {
    throw new Error("Invalid theme JSON");
  }

  const obj = json as Record<string, unknown>;
  const name = typeof obj.name === "string" ? obj.name : undefined;
  const cssVars = obj.cssVars as Record<string, Record<string, string>> | undefined;

  if (!cssVars || typeof cssVars !== "object") {
    throw new Error('Theme JSON missing "cssVars" object');
  }

  const light = filterSupported({ ...cssVars.theme, ...cssVars.light });
  const dark = filterSupported({ ...cssVars.theme, ...cssVars.dark });

  if (Object.keys(light).length === 0 && Object.keys(dark).length === 0) {
    throw new Error("No supported theme variables found in JSON");
  }

  return { name, light, dark };
}

const TWEAKCN_URL_PATTERNS = [
  /^https?:\/\/(?:www\.)?tweakcn\.com\/r\/themes\/([^/?#]+)/,
  /^https?:\/\/(?:www\.)?tweakcn\.com\/themes\/([^/?#]+)/,
  /^https?:\/\/(?:www\.)?tweakcn\.com\/editor\/theme\?theme=([^&#]+)/,
];

export function isTweakcnURL(input: string): boolean {
  const trimmed = input.trim();
  return TWEAKCN_URL_PATTERNS.some((re) => re.test(trimmed));
}

function extractTweakcnThemeId(url: string): string | null {
  const trimmed = url.trim();
  for (const re of TWEAKCN_URL_PATTERNS) {
    const match = trimmed.match(re);
    if (match?.[1]) return match[1];
  }
  return null;
}

function isBareThemeName(input: string): boolean {
  return /^[a-zA-Z0-9][\w-]*$/.test(input);
}

export async function fetchTweakcnTheme(urlOrName: string): Promise<CustomThemeData> {
  const themeId = isBareThemeName(urlOrName) ? urlOrName : extractTweakcnThemeId(urlOrName);

  if (!themeId) {
    throw new Error("Could not extract theme ID from URL");
  }

  const response = await fetch(`https://tweakcn.com/r/themes/${encodeURIComponent(themeId)}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch theme: ${response.status} ${response.statusText}`);
  }

  return parseTweakcnJSON(await response.json());
}

export async function parseThemeInput(input: string): Promise<CustomThemeData> {
  const trimmed = input.trim();

  if (isTweakcnURL(trimmed)) {
    return fetchTweakcnTheme(trimmed);
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return parseTweakcnJSON(JSON.parse(trimmed));
    } catch {
      // fall through to CSS parsing
    }
  }

  if (isBareThemeName(trimmed)) {
    return fetchTweakcnTheme(trimmed);
  }

  const parsed = parseThemeCSS(trimmed);
  if (Object.keys(parsed.light).length === 0 && Object.keys(parsed.dark).length === 0) {
    throw new Error("No theme variables found. Paste CSS, a tweakcn theme URL, or a theme name.");
  }

  return parsed;
}

function extractGoogleFonts(theme: CustomThemeData): string[] {
  const fonts = new Set<string>();

  for (const mode of [theme.light, theme.dark]) {
    for (const key of SUPPORTED_FONT_VARS) {
      const value = mode[key];
      if (!value) continue;
      const families = value.split(",").map((part) => part.trim().replace(/^["']|["']$/g, ""));
      for (const family of families) {
        if (family && !SYSTEM_FONTS.has(family.toLowerCase())) {
          fonts.add(family);
        }
      }
    }
  }

  return Array.from(fonts);
}

function loadGoogleFonts(fonts: string[]): void {
  if (!hasDom()) return;
  document.getElementById(CUSTOM_THEME_FONT_LINK_ID)?.remove();
  if (fonts.length === 0) return;

  const fontUrl = new URL("https://fonts.googleapis.com/css2");
  for (const font of fonts) {
    fontUrl.searchParams.append("family", `${font}:wght@300..800`);
  }
  fontUrl.searchParams.set("display", "swap");
  const link = document.createElement("link");
  link.id = CUSTOM_THEME_FONT_LINK_ID;
  link.rel = "stylesheet";
  link.href = fontUrl.toString();
  document.head.appendChild(link);
}

function unloadGoogleFonts(): void {
  if (!hasDom()) return;
  document.getElementById(CUSTOM_THEME_FONT_LINK_ID)?.remove();
}

function getVar(vars: Record<string, string>, key: string, fallback: string): string {
  return vars[key] ?? fallback;
}

function buildModeLines(vars: Record<string, string>): string[] {
  const background = getVar(vars, "background", "var(--bg)");
  const foreground = getVar(vars, "foreground", "var(--ink)");
  const card = getVar(vars, "card", background);
  const secondary = getVar(vars, "secondary", card);
  const muted = getVar(vars, "muted", secondary);
  const primary = getVar(vars, "primary", "var(--accent)");
  const primaryForeground = getVar(vars, "primary-foreground", "var(--accent-fg)");
  const accent = getVar(vars, "accent", primary);
  const border = getVar(vars, "border", "var(--line)");
  const input = getVar(vars, "input", border);
  const ring = getVar(vars, "ring", primary);
  const destructive = getVar(vars, "destructive", "var(--status-error-fg)");
  const success = getVar(vars, "success", "var(--seafoam)");
  const warning = getVar(vars, "warning", "var(--gold)");
  const mutedForeground = getVar(vars, "muted-foreground", foreground);
  const radius = vars.radius;
  const fontSans = vars["font-sans"];
  const fontMono = vars["font-mono"];

  const lines = [
    `  --bg: ${background};`,
    `  --bg-soft: ${muted};`,
    `  --surface: ${card};`,
    `  --surface-muted: ${secondary};`,
    `  --nav-bg: color-mix(in srgb, ${background} 96%, transparent);`,
    `  --ink: ${foreground};`,
    `  --ink-soft: ${mutedForeground};`,
    `  --accent: ${primary};`,
    `  --accent-fg: ${primaryForeground};`,
    `  --accent-deep: ${accent};`,
    `  --accent-subtle: color-mix(in srgb, ${primary} 14%, transparent);`,
    `  --seafoam: ${success};`,
    `  --gold: ${warning};`,
    `  --line: color-mix(in srgb, ${border} 72%, transparent);`,
    `  --border-ui: color-mix(in srgb, ${border} 90%, transparent);`,
    `  --border-ui-hover: color-mix(in srgb, ${ring} 50%, ${border});`,
    `  --border-ui-active: color-mix(in srgb, ${ring} 70%, ${border});`,
    `  --input-border: ${input};`,
    `  --input-bg: ${card};`,
    `  --input-placeholder: color-mix(in srgb, ${mutedForeground} 72%, transparent);`,
    `  --input-focus-border: ${ring};`,
    `  --input-focus-ring: color-mix(in srgb, ${ring} 18%, transparent);`,
    `  --label-fg: color-mix(in srgb, ${foreground} 82%, transparent);`,
    `  --hover-bg: color-mix(in srgb, ${secondary} 72%, transparent);`,
    `  --active-bg: color-mix(in srgb, ${primary} 12%, transparent);`,
    `  --overlay-bg: color-mix(in srgb, ${background} 76%, transparent);`,
    `  --status-success-bg: color-mix(in srgb, ${success} 14%, transparent);`,
    `  --status-success-fg: ${success};`,
    `  --status-warning-bg: color-mix(in srgb, ${warning} 14%, transparent);`,
    `  --status-warning-fg: ${warning};`,
    `  --status-error-bg: color-mix(in srgb, ${destructive} 14%, transparent);`,
    `  --status-error-fg: ${destructive};`,
    `  --diff-added: ${success};`,
    `  --diff-added-strong: ${success};`,
    `  --diff-removed: ${destructive};`,
    `  --diff-removed-strong: ${destructive};`,
    `  --diff-diagonal: color-mix(in srgb, ${primary} 12%, transparent);`,
  ];

  if (radius) {
    lines.push(`  --r-lg: ${radius};`);
    lines.push(`  --r-md: ${radius};`);
    lines.push(`  --r-sm: ${radius};`);
  }
  if (fontSans) {
    lines.push(`  --font-display: ${fontSans};`);
    lines.push(`  --font-body: ${fontSans};`);
  }
  if (fontMono) {
    lines.push(`  --font-mono: ${fontMono};`);
  }

  return lines;
}

function buildCustomThemeCSS(theme: CustomThemeData): string {
  return [
    ":root.theme-custom {",
    ...buildModeLines(theme.light),
    "}",
    "",
    ":root.theme-custom.dark {",
    ...buildModeLines(theme.dark),
    "}",
  ].join("\n");
}

export function applyCustomTheme(theme: CustomThemeData): void {
  if (!hasDom()) return;

  let styleEl = document.getElementById(CUSTOM_THEME_STYLE_ID) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = CUSTOM_THEME_STYLE_ID;
    document.head.appendChild(styleEl);
  }

  styleEl.textContent = buildCustomThemeCSS(theme);
  document.documentElement.classList.add("theme-custom");
  loadGoogleFonts(extractGoogleFonts(theme));
}

export function removeCustomTheme(): void {
  if (!hasDom()) return;
  document.getElementById(CUSTOM_THEME_STYLE_ID)?.remove();
  document.documentElement.classList.remove("theme-custom");
  unloadGoogleFonts();
}

export function getStoredCustomTheme(): CustomThemeData | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(CUSTOM_THEME_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CustomThemeData;
    if (parsed && typeof parsed.light === "object" && typeof parsed.dark === "object") {
      return parsed;
    }
  } catch {
    // ignore bad storage payloads
  }
  return null;
}

export function setStoredCustomTheme(theme: CustomThemeData): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(CUSTOM_THEME_STORAGE_KEY, JSON.stringify(theme));
}

export function clearStoredCustomTheme(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(CUSTOM_THEME_STORAGE_KEY);
}

export function syncCustomThemeFromStorage(): void {
  const theme = getStoredCustomTheme();
  if (theme) {
    applyCustomTheme(theme);
    return;
  }
  removeCustomTheme();
}
