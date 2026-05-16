import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { applyRateLimit, getClientIp } from "../lib/httpRateLimit";
import { json, parseJsonPayload, text } from "./shared";

export async function recordSearchTelemetryV1Handler(ctx: ActionCtx, request: Request) {
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

async function getSearchTelemetryBucketKey(request: Request) {
  const ip = getClientIp(request) ?? "unknown";
  return `v1:${await sha256Hex(`search-telemetry:${ip}`)}`;
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
