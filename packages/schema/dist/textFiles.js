export function normalizeContentType(contentType) {
    const normalized = contentType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
    return normalized || undefined;
}
export function decodeUtf8Text(bytes) {
    if (bytes.includes(0))
        return null;
    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=textFiles.js.map