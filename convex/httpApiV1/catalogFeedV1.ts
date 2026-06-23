import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { corsHeaders, mergeHeaders } from "../lib/httpHeaders";

function matchesEtag(request: Request, etag: string) {
  const header = request.headers.get("if-none-match");
  if (!header) return false;
  return header
    .split(",")
    .map((value) => value.trim())
    .some((value) => value === "*" || value === etag);
}

export async function catalogFeedV1Handler(ctx: ActionCtx, request: Request) {
  const publication = await ctx.runQuery(internal.catalogFeed.getLatestPublication, {});
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

  if (matchesEtag(request, etag)) return new Response(null, { status: 304, headers });
  return new Response(publication.payload, { status: 200, headers });
}
