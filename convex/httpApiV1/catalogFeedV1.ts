import { CATALOG_FEED_ID, CATALOG_SKILLS_FEED_ID, PROMOTIONS_FEED_ID } from "clawhub-schema";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { corsHeaders, mergeHeaders } from "../lib/httpHeaders";

function matchesEtag(request: Request, etag: string) {
  const header = request.headers.get("if-none-match");
  if (!header) return false;
  return header
    .split(",")
    .map((value) => value.trim())
    .some((value) => {
      if (value === "*") return true;
      const normalized = value.startsWith("W/") ? value.slice(2) : value;
      return normalized === etag;
    });
}

function matchesLastModified(request: Request, publishedAt: number) {
  const header = request.headers.get("if-modified-since");
  if (!header) return false;
  const since = Date.parse(header);
  if (!Number.isFinite(since)) return false;
  return Math.floor(publishedAt / 1000) * 1000 <= since;
}

export async function catalogFeedV1Handler(
  ctx: ActionCtx,
  request: Request,
  feedId:
    | typeof CATALOG_FEED_ID
    | typeof CATALOG_SKILLS_FEED_ID
    | typeof PROMOTIONS_FEED_ID = CATALOG_FEED_ID,
) {
  const publication = await ctx.runQuery(internal.catalogFeed.getLatestPublication, { feedId });
  if (!publication) {
    return new Response("Catalog feed is not published", {
      status: 503,
      headers: mergeHeaders(
        {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
        },
        corsHeaders(),
      ),
    });
  }

  const etag = `"sha256:${publication.payloadSha256}"`;
  const headers = mergeHeaders(
    {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=86400",
      "Surrogate-Control": "max-age=300, stale-while-revalidate=86400",
      ETag: etag,
      "Last-Modified": new Date(publication.publishedAt).toUTCString(),
      "X-Catalog-Feed-Sequence": String(publication.sequence),
      "X-Content-SHA256": publication.payloadSha256,
      "X-Content-Type-Options": "nosniff",
      Vary: "Accept-Encoding",
    },
    corsHeaders(),
  );

  if (
    matchesEtag(request, etag) ||
    (!request.headers.has("if-none-match") && matchesLastModified(request, publication.publishedAt))
  ) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(publication.payload, { status: 200, headers });
}

export async function catalogSkillsFeedV1Handler(ctx: ActionCtx, request: Request) {
  return await catalogFeedV1Handler(ctx, request, CATALOG_SKILLS_FEED_ID);
}

export async function promotionsFeedV1Handler(ctx: ActionCtx, request: Request) {
  return await catalogFeedV1Handler(ctx, request, PROMOTIONS_FEED_ID);
}
