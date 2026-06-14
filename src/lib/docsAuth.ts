const canonicalDocsOrigin = "https://clawhub.ai";
const docsOriginAliases = new Map([["https://hub.openclaw.ai", canonicalDocsOrigin]]);
const productionDocsOrigins = new Set([
  canonicalDocsOrigin,
  ...docsOriginAliases.keys(),
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
    const canonicalOrigin = docsOriginAliases.get(url.origin);
    if (canonicalOrigin) {
      const canonical = new URL(canonicalOrigin);
      url.protocol = canonical.protocol;
      url.host = canonical.host;
    }
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
