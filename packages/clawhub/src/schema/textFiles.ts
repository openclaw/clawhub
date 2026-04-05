const RAW_TEXT_FILE_EXTENSIONS = [
  "md",
  "mdx",
  "txt",
  "json",
  "json5",
  "yaml",
  "yml",
  "toml",
  "js",
  "cjs",
  "mjs",
  "ts",
  "tsx",
  "jsx",
  "py",
  "sh",
  "rb",
  "go",
  "rs",
  "swift",
  "kt",
  "java",
  "cs",
  "cpp",
  "c",
  "h",
  "hpp",
  "sql",
  "csv",
  "ini",
  "cfg",
  "env",
  "xml",
  "html",
  "css",
  "scss",
  "sass",
  "svg",
] as const;

export const TEXT_FILE_EXTENSIONS = RAW_TEXT_FILE_EXTENSIONS;
export const TEXT_FILE_EXTENSION_SET = new Set<string>(TEXT_FILE_EXTENSIONS);

const RAW_TEXT_CONTENT_TYPES = [
  "application/json",
  "application/xml",
  "application/yaml",
  "application/x-yaml",
  "application/toml",
  "application/javascript",
  "application/typescript",
  "application/markdown",
  "image/svg+xml",
] as const;

export const TEXT_CONTENT_TYPES = RAW_TEXT_CONTENT_TYPES;
export const TEXT_CONTENT_TYPE_SET = new Set<string>(TEXT_CONTENT_TYPES);

export function isTextContentType(contentType: string) {
  if (!contentType) return false;
  const normalized = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!normalized) return false;
  if (normalized.startsWith("text/")) return true;
  return TEXT_CONTENT_TYPE_SET.has(normalized);
}
