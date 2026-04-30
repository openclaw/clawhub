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
    "r",
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
];
export const TEXT_FILE_EXTENSIONS = RAW_TEXT_FILE_EXTENSIONS;
export const TEXT_FILE_EXTENSION_SET = new Set(TEXT_FILE_EXTENSIONS);
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
];
export const TEXT_CONTENT_TYPES = RAW_TEXT_CONTENT_TYPES;
export const TEXT_CONTENT_TYPE_SET = new Set(TEXT_CONTENT_TYPES);
const CANONICAL_TEXT_CONTENT_TYPES = {
    md: "text/markdown",
    mdx: "text/markdown",
    txt: "text/plain",
    json: "application/json",
    json5: "application/json",
    yaml: "application/yaml",
    yml: "application/yaml",
    toml: "application/toml",
    js: "application/javascript",
    cjs: "application/javascript",
    mjs: "application/javascript",
    jsx: "application/javascript",
    ts: "application/typescript",
    mts: "application/typescript",
    cts: "application/typescript",
    tsx: "application/typescript",
    xml: "application/xml",
    svg: "image/svg+xml",
};
export function isTextContentType(contentType) {
    if (!contentType)
        return false;
    const normalized = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
    if (!normalized)
        return false;
    if (normalized.startsWith("text/"))
        return true;
    return TEXT_CONTENT_TYPE_SET.has(normalized);
}
export function guessTextContentType(path) {
    const ext = path.trim().toLowerCase().split(".").at(-1) ?? "";
    if (!ext || !TEXT_FILE_EXTENSION_SET.has(ext))
        return undefined;
    return CANONICAL_TEXT_CONTENT_TYPES[ext] ?? "text/plain";
}
export function normalizeTextContentType(path, contentType) {
    const normalized = contentType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
    const guessed = guessTextContentType(path);
    if (!guessed)
        return normalized || undefined;
    if (isTextContentType(normalized))
        return normalized;
    return guessed;
}
//# sourceMappingURL=textFiles.js.map