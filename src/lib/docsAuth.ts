import { isDevRuntime } from "./runtimeEnv";

const PROD_DOCS_ORIGINS = ["https://documentation.openclaw.ai", "https://docs.openclaw.ai"];

// Loopback origins are the docs dev server. They must never be accepted in
// production: a signed-in user's auth token is POSTed to the return origin,
// so allowing localhost there hands the token to any local process on :4173.
const DEV_DOCS_ORIGINS = ["http://localhost:4173", "http://127.0.0.1:4173"];

function allowedDocsOrigins(): Set<string> {
  return isDevRuntime()
    ? new Set([...PROD_DOCS_ORIGINS, ...DEV_DOCS_ORIGINS])
    : new Set(PROD_DOCS_ORIGINS);
}

export function normalizeDocsReturnTo(value?: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!allowedDocsOrigins().has(url.origin)) return null;
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function buildDocsAuthCallbackUrl(returnTo: string) {
  const normalized = normalizeDocsReturnTo(returnTo);
  if (!normalized) return null;
  const url = new URL(normalized);
  return `${url.origin}/ask-molty/auth/callback`;
}
