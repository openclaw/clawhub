export function normalizeContentType(contentType?: string | null) {
  const normalized = contentType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return normalized || undefined;
}

export function decodeUtf8Text(bytes: Uint8Array) {
  // Detached views, like empty views, have no bytes to decode.
  if (bytes.length === 0) return "";
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}
