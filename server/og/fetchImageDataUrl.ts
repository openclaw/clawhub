const MAX_IMAGE_BYTES = 1_500_000;
const IMAGE_FETCH_TIMEOUT_MS = 1_500;
const TRUSTED_IMAGE_HOSTS = new Set([
  "avatars.githubusercontent.com",
  "camo.githubusercontent.com",
  "github.githubassets.com",
  "raw.githubusercontent.com",
  "user-images.githubusercontent.com",
  "gravatar.com",
  "secure.gravatar.com",
  "www.gravatar.com",
]);

export function isTrustedOgImageUrl(url: string | null | undefined) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    return TRUSTED_IMAGE_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export async function fetchImageDataUrl(url: string | null | undefined) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!isTrustedOgImageUrl(parsed.toString())) return null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(parsed, {
        headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,image/*" },
        redirect: "manual",
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const contentType = response.headers.get("content-type")?.split(";")[0]?.trim();
      if (!contentType?.startsWith("image/")) return null;
      const buffer = await readLimitedImageBody(response);
      if (!buffer) return null;
      return `data:${contentType};base64,${buffer.toString("base64")}`;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return null;
  }
}

async function readLimitedImageBody(response: Response) {
  const contentLength = response.headers.get("content-length");
  if (contentLength) {
    const expectedBytes = Number.parseInt(contentLength, 10);
    if (Number.isFinite(expectedBytes) && expectedBytes > MAX_IMAGE_BYTES) return null;
  }

  const reader = response.body?.getReader();
  if (!reader) return null;

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_IMAGE_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  if (totalBytes === 0) return null;
  return Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)),
    totalBytes,
  );
}
