export function normalizeContentType(contentType?: string | null) {
  const normalized = contentType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return normalized || undefined;
}

export function decodeUtf8Text(bytes: Uint8Array) {
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}
