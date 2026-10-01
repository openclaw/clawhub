import { decodeUtf8Text } from "clawhub-schema";

export function decodeBoundedUtf8Text(bytes: Uint8Array, maxBytes: number) {
  if (bytes.byteLength <= maxBytes) return decodeUtf8Text(bytes);

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, maxBytes), {
      stream: true,
    });
  } catch {
    return null;
  }
}
