import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { applyRateLimit, getClientIp } from "../lib/httpRateLimit";
import { json, parseJsonPayload, text } from "./shared";

const ALLOWED_SEARCH_TELEMETRY_HOSTS = new Set([
  "clawhub.ai",
  "www.clawhub.ai",
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
]);

export async function recordSearchTelemetryV1Handler(ctx: ActionCtx, request: Request) {
  if (!isAllowedSearchTelemetrySource(request)) {
    return text("Search telemetry source not allowed", 403);
  }

  const rate = await applyRateLimit(ctx, request, "write");
  if (!rate.ok) return rate.response;

  const parsed = await parseJsonPayload(request, rate.headers);
  if (!parsed.ok) return parsed.response;

  const query = typeof parsed.payload.query === "string" ? parsed.payload.query : "";
  if (!query.trim()) return text("Missing query", 400, rate.headers);

  const bucketKey = await getSearchTelemetryBucketKey(request);
  await ctx.runMutation(internal.searchTelemetry.recordSearchInternal, { query, bucketKey });
  return json({ ok: true }, 202, rate.headers);
}

export function isAllowedSearchTelemetrySource(request: Request) {
  const requestOrigin = parseUrl(request.url)?.origin;
  const source =
    parseUrl(request.headers.get("origin") ?? "") ?? parseUrl(request.headers.get("referer") ?? "");

  if (!source) return false;
  if (requestOrigin && source.origin === requestOrigin) return true;
  return ALLOWED_SEARCH_TELEMETRY_HOSTS.has(source.hostname.toLowerCase());
}

async function getSearchTelemetryBucketKey(request: Request) {
  const ip = getClientIp(request) ?? "unknown";
  return `v1:${await sha256Hex(`search-telemetry:${ip}`)}`;
}

function parseUrl(value: string) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
