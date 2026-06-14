import {
  HTTPResponse,
  defineEventHandler,
  getMethod,
  getRequestHeaders,
  getRequestURL,
  readRawBody,
} from "h3";
import { normalizeDocsReturnTo } from "../../../src/lib/docsAuth";

const DEFAULT_ASK_MOLTY_ORIGIN = "https://docs-chat.openclaw.ai";
const askMoltyCookieName = "ask_molty_session";
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

  const response = await fetch(target, {
    body,
    headers,
    method,
    redirect: "manual",
  });
  return new HTTPResponse(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: forwardedResponseHeaders(response.headers, requestUrl),
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
    if (hopByHopHeaders.has(lowerName) || lowerName === "authorization") continue;
    if (lowerName === "cookie") {
      const askMoltyCookie = pickCookie(value, askMoltyCookieName);
      if (askMoltyCookie) headers.set("Cookie", askMoltyCookie);
      continue;
    }
    headers.set(name, value);
  }
  return headers;
}

function pickCookie(header: string, name: string) {
  const prefix = `${name}=`;
  return header
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
}

function forwardedResponseHeaders(rawHeaders: Headers, requestUrl: URL) {
  const headers = new Headers();
  for (const [name, value] of rawHeaders.entries()) {
    const lowerName = name.toLowerCase();
    if (
      ["content-encoding", "content-length", "set-cookie", "transfer-encoding"].includes(lowerName)
    )
      continue;
    headers.append(
      name,
      lowerName === "location" ? canonicalizeAuthLocation(value, requestUrl) : value,
    );
  }

  for (const value of getSetCookieHeaders(rawHeaders)) {
    const setCookie = sanitizeAskMoltySetCookie(value);
    if (setCookie) headers.append("Set-Cookie", setCookie);
  }
  return headers;
}

function getSetCookieHeaders(headers: Headers) {
  const withGetSetCookie = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof withGetSetCookie.getSetCookie === "function") return withGetSetCookie.getSetCookie();
  const value = headers.get("set-cookie");
  return value ? [value] : [];
}

function canonicalizeAuthLocation(value: string, requestUrl: URL) {
  try {
    const location = new URL(value);
    if (location.origin !== "https://hub.openclaw.ai" || location.pathname !== "/docs/auth") {
      return value;
    }

    const authOrigin = isLocalOrigin(requestUrl.origin) ? requestUrl.origin : "https://clawhub.ai";
    const authUrl = new URL(authOrigin);
    location.protocol = authUrl.protocol;
    location.host = authUrl.host;
    location.pathname = "/auth/docs";
    const returnTo = normalizeDocsReturnTo(requestUrl.searchParams.get("return_to"), {
      currentOrigin: requestUrl.origin,
    });
    if (returnTo) location.searchParams.set("return_to", returnTo);
    return location.href;
  } catch {
    return value;
  }
}

function isLocalOrigin(origin: string) {
  try {
    return ["localhost", "127.0.0.1"].includes(new URL(origin).hostname);
  } catch {
    return false;
  }
}

function sanitizeAskMoltySetCookie(value: string | null) {
  if (!value) return null;
  const parts = value.split(";").map((part) => part.trim());
  const cookie = parts[0];
  if (!cookie?.startsWith(`${askMoltyCookieName}=`)) return null;
  const maxAge = parts.find((part) => /^Max-Age=\d+$/i.test(part));
  return [cookie, maxAge, "Path=/ask-molty", "HttpOnly", "Secure", "SameSite=Lax"]
    .filter(Boolean)
    .join("; ");
}
