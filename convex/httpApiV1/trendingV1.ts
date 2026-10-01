import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { applyRateLimit } from "../lib/httpRateLimit";
import { json, text } from "./shared";

const internalRefs = internal as unknown as {
  canonicalTrending: {
    getPageInternal: unknown;
  };
};

const DEFAULT_TRENDING_LIMIT = 20;
const MAX_TRENDING_LIMIT = 100;

type TrendingPageQueryResult =
  | { status: "ok"; page: unknown }
  | { status: "unavailable" }
  | { status: "invalid-cursor" }
  | { status: "expired" };

function parseLimit(value: string | null) {
  if (value === null) return DEFAULT_TRENDING_LIMIT;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_TRENDING_LIMIT) return null;
  return parsed;
}

export async function trendingV1Handler(ctx: ActionCtx, request: Request) {
  const rate = await applyRateLimit(ctx, request, "read");
  if (!rate.ok) return rate.response;

  const url = new URL(request.url);
  const kind = url.searchParams.get("kind")?.trim() || "skills";
  if (kind !== "skills") return text("Unsupported trending kind", 400, rate.headers);
  const limit = parseLimit(url.searchParams.get("limit"));
  if (limit === null) return text("Invalid limit", 400, rate.headers);
  const cursor = url.searchParams.get("cursor")?.trim() || null;

  const result = (await ctx.runQuery(
    internalRefs.canonicalTrending.getPageInternal as never,
    { cursor, limit } as never,
  )) as TrendingPageQueryResult;
  if (result.status === "unavailable") {
    return text("Trending snapshot unavailable", 503, rate.headers);
  }
  if (result.status === "invalid-cursor") return text("Invalid cursor format", 400, rate.headers);
  if (result.status === "expired") return text("Trending snapshot expired", 410, rate.headers);
  return json(result.page, 200, rate.headers);
}
