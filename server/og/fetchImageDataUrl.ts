const MAX_IMAGE_BYTES = 1_500_000;
const IMAGE_FETCH_TIMEOUT_MS = 1_500;
const MAX_IMAGE_REDIRECTS = 3;
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

const BLOCKED_IMAGE_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.google",
]);

type FetchImageDataUrlOptions = {
  allowPublicHttps?: boolean;
  followRedirects?: boolean;
};

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

export function isSafePublicHttpsOgImageUrl(url: string | null | undefined) {
  if (!url) return false;
  if (isTrustedOgImageUrl(url)) return true;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    if (parsed.username || parsed.password) return false;
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
    if (BLOCKED_IMAGE_HOSTNAMES.has(hostname)) return false;
    if (
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal")
    ) {
      return false;
    }
    if (isPrivateIpv4(hostname) || isPrivateIpv6(hostname)) return false;
    return !isIpv4Hostname(hostname) && !hostname.includes(":");
  } catch {
    return false;
  }
}

function isAllowedOgImageUrl(url: string, options: FetchImageDataUrlOptions) {
  return options.allowPublicHttps ? isSafePublicHttpsOgImageUrl(url) : isTrustedOgImageUrl(url);
}

export async function fetchImageDataUrl(
  url: string | null | undefined,
  options: FetchImageDataUrlOptions = {},
) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!isAllowedOgImageUrl(parsed.toString(), options)) return null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);
    try {
      const response = await fetchOgImageResponse(parsed, controller.signal, options);
      if (!response?.ok) return null;
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

export async function fetchPublisherProfileImageDataUrl(url: string | null | undefined) {
  return fetchImageDataUrl(url, { allowPublicHttps: true, followRedirects: true });
}

async function fetchOgImageResponse(
  initialUrl: URL,
  signal: AbortSignal,
  options: FetchImageDataUrlOptions,
) {
  let currentUrl = initialUrl;
  for (let hop = 0; hop <= MAX_IMAGE_REDIRECTS; hop += 1) {
    const response = await fetch(currentUrl, {
      headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,image/*" },
      redirect: "manual",
      signal,
    });
    if (
      options.followRedirects &&
      response.status >= 300 &&
      response.status < 400 &&
      hop < MAX_IMAGE_REDIRECTS
    ) {
      const location = response.headers.get("location")?.trim();
      if (!location) return null;
      const nextUrl = new URL(location, currentUrl);
      if (!isAllowedOgImageUrl(nextUrl.toString(), options)) return null;
      currentUrl = nextUrl;
      continue;
    }
    return response;
  }
  return null;
}

function isIpv4Hostname(hostname: string) {
  return parseIpv4(hostname) !== null;
}

function parseIpv4(hostname: string) {
  const parts = hostname.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((part) => Number.parseInt(part, 10));
  if (nums.some((value) => !Number.isFinite(value) || value < 0 || value > 255)) return null;
  return nums;
}

function isPrivateIpv4(hostname: string) {
  const nums = parseIpv4(hostname);
  if (!nums) return false;
  const [a, b] = nums;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function isPrivateIpv6(hostname: string) {
  const lower = hostname.toLowerCase();
  if (lower === "::1") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (lower.startsWith("fe80")) return true;
  return false;
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
