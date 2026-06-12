export const localeLabels = {
  en: "English",
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文",
  "ja-JP": "日本語",
  es: "Español",
  "pt-BR": "Português do Brasil",
  ko: "한국어",
  de: "Deutsch",
  fr: "Français",
  ar: "العربية",
  it: "Italiano",
  vi: "Tiếng Việt",
  nl: "Nederlands",
  fa: "فارسی",
  tr: "Türkçe",
  uk: "Українська",
  id: "Bahasa Indonesia",
  pl: "Polski",
  th: "ไทย",
};

export const mintlifyLocaleToDir = {
  en: "en",
  "zh-Hans": "zh-CN",
  "zh-Hant": "zh-TW",
  ja: "ja-JP",
  es: "es",
  "pt-BR": "pt-BR",
  ko: "ko",
  de: "de",
  fr: "fr",
  ar: "ar",
  it: "it",
  vi: "vi",
  nl: "nl",
  fa: "fa",
  tr: "tr",
  uk: "uk",
  id: "id",
  pl: "pl",
  th: "th",
};

export const rtlLocales = new Set(["ar", "fa"]);

export const ignoredDocDirs = new Set([".generated", ".i18n", "assets"]);

export const ignoredDocFiles = new Set([
  "docs.json",
  "AGENTS.md",
  "README.md",
  "nav-tabs-underline.js",
  "style.css",
]);
