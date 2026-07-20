export function normalizeContentType(contentType) {
    const normalized = contentType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
    return normalized || undefined;
}
export function decodeUtf8Text(bytes) {
    const chunks = [];
    const codeUnits = [];
    const appendCodePoint = (codePoint) => {
        if (codePoint <= 0xffff) {
            codeUnits.push(codePoint);
        }
        else {
            const offset = codePoint - 0x10000;
            codeUnits.push(0xd800 + (offset >> 10), 0xdc00 + (offset & 0x3ff));
        }
        if (codeUnits.length >= 8192) {
            chunks.push(String.fromCharCode(...codeUnits));
            codeUnits.length = 0;
        }
    };
    for (let index = 0; index < bytes.length; index += 1) {
        const first = bytes[index] ?? 0;
        if (first <= 0x7f) {
            appendCodePoint(first);
            continue;
        }
        const second = bytes[index + 1];
        if (first >= 0xc2 && first <= 0xdf) {
            if (second === undefined || second < 0x80 || second > 0xbf)
                return null;
            appendCodePoint(((first & 0x1f) << 6) | (second & 0x3f));
            index += 1;
            continue;
        }
        const third = bytes[index + 2];
        if (first >= 0xe0 && first <= 0xef) {
            const secondMin = first === 0xe0 ? 0xa0 : 0x80;
            const secondMax = first === 0xed ? 0x9f : 0xbf;
            if (second === undefined ||
                second < secondMin ||
                second > secondMax ||
                third === undefined ||
                third < 0x80 ||
                third > 0xbf) {
                return null;
            }
            appendCodePoint(((first & 0x0f) << 12) | ((second & 0x3f) << 6) | (third & 0x3f));
            index += 2;
            continue;
        }
        const fourth = bytes[index + 3];
        if (first >= 0xf0 && first <= 0xf4) {
            const secondMin = first === 0xf0 ? 0x90 : 0x80;
            const secondMax = first === 0xf4 ? 0x8f : 0xbf;
            if (second === undefined ||
                second < secondMin ||
                second > secondMax ||
                third === undefined ||
                third < 0x80 ||
                third > 0xbf ||
                fourth === undefined ||
                fourth < 0x80 ||
                fourth > 0xbf) {
                return null;
            }
            appendCodePoint(((first & 0x07) << 18) | ((second & 0x3f) << 12) | ((third & 0x3f) << 6) | (fourth & 0x3f));
            index += 3;
            continue;
        }
        return null;
    }
    if (codeUnits.length > 0)
        chunks.push(String.fromCharCode(...codeUnits));
    const text = chunks.join("");
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
// Legacy package/plugin presentation helpers. Skill admission and preview do not
// use this registry; skill artifacts are accepted independently of file type.
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
    "ps1",
    "psm1",
    "psd1",
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
    "tsv",
    "ini",
    "cfg",
    "conf",
    "env",
    "properties",
    "dat",
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
    csv: "text/csv",
    tsv: "text/tab-separated-values",
    xml: "application/xml",
    svg: "image/svg+xml",
};
export function isTextContentType(contentType) {
    const normalized = normalizeContentType(contentType) ?? "";
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
    const normalized = normalizeContentType(contentType);
    const guessed = guessTextContentType(path);
    if (!guessed)
        return normalized;
    if (normalized && isTextContentType(normalized))
        return normalized;
    return guessed;
}
//# sourceMappingURL=textFiles.js.map