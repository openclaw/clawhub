const productionDocsOrigins = new Set([
  "https://clawhub.ai",
  "https://documentation.openclaw.ai",
  "https://docs.openclaw.ai",
]);

type DocsAuthOptions = {
  currentOrigin?: string | null;
};

export function normalizeDocsReturnTo(value?: string | null, options: DocsAuthOptions = {}) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (!isAllowedDocsOrigin(url.origin, options.currentOrigin ?? getCurrentOrigin())) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function buildDocsAuthCallbackUrl(returnTo: string, options: DocsAuthOptions = {}) {
  const normalized = normalizeDocsReturnTo(returnTo, options);
  if (!normalized) return null;
  const url = new URL(normalized);
  return `${url.origin}/ask-molty/auth/callback`;
}

function isAllowedDocsOrigin(origin: string, currentOrigin?: string | null) {
  if (productionDocsOrigins.has(origin)) return true;
  return isLocalDocsOrigin(origin) && isLocalDocsOrigin(currentOrigin ?? "");
}

function isLocalDocsOrigin(origin: string) {
  try {
    const url = new URL(origin);
    return url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function getCurrentOrigin() {
  if (typeof window === "undefined") return null;
  return window.location.origin;
}
