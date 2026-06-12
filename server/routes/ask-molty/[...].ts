import { defineEventHandler, getMethod, getRequestHeaders, getRequestURL, readRawBody } from "h3";

const DEFAULT_ASK_MOLTY_ORIGIN = "https://docs-chat.openclaw.ai";
const hopByHopHeaders = new Set([
  "connection",
  "content-length",
  "expect",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export default defineEventHandler(async (event) => {
  const origin = normalizeProxyOrigin(process.env.ASK_MOLTY_PROXY_ORIGIN);
  const requestUrl = getRequestURL(event);
  const target = new URL(`${requestUrl.pathname}${requestUrl.search}`, origin);
  const headers = forwardedHeaders(getRequestHeaders(event));
  const method = getMethod(event);
  const body = method === "GET" || method === "HEAD" ? undefined : await readRawBody(event);

  return fetch(target, {
    body,
    headers,
    method,
    redirect: "manual",
  });
});

function normalizeProxyOrigin(value?: string) {
  try {
    return new URL(value || DEFAULT_ASK_MOLTY_ORIGIN).origin;
  } catch {
    return DEFAULT_ASK_MOLTY_ORIGIN;
  }
}

function forwardedHeaders(rawHeaders: HeadersInit) {
  const headers = new Headers();
  for (const [name, value] of new Headers(rawHeaders).entries()) {
    const lowerName = name.toLowerCase();
    if (hopByHopHeaders.has(lowerName) || lowerName === "cookie" || lowerName === "authorization")
      continue;
    headers.set(name, value);
  }
  return headers;
}
