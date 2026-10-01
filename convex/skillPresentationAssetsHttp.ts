import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { httpAction } from "./functions";
import { corsHeaders, mergeHeaders } from "./lib/httpHeaders";

const ICON_PATH_PREFIX = "/api/v1/skill-icons/";

export async function skillPresentationAssetHandler(ctx: ActionCtx, request: Request) {
  const url = new URL(request.url);
  const sha256 = url.pathname.startsWith(ICON_PATH_PREFIX)
    ? url.pathname.slice(ICON_PATH_PREFIX.length).toLowerCase()
    : "";
  if (!/^[a-f\d]{64}$/.test(sha256)) return iconText("Not found", 404);

  const asset = (await ctx.runQuery(internal.skillPresentationAssets.getBySha256Internal, {
    sha256,
  })) as Doc<"skillPresentationAssets"> | null;
  if (!asset) return iconText("Not found", 404);

  const etag = `"sha256:${asset.sha256}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: iconHeaders(asset, etag) });
  }
  const blob = await ctx.storage.get(asset.storageId);
  if (!blob) return iconText("Not found", 404);
  return new Response(new Uint8Array(await blob.arrayBuffer()), {
    status: 200,
    headers: iconHeaders(asset, etag),
  });
}

function iconHeaders(asset: Doc<"skillPresentationAssets">, etag: string) {
  return mergeHeaders(
    {
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Type": asset.contentType,
      "Content-Length": String(asset.size),
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      ETag: etag,
      "X-Content-SHA256": asset.sha256,
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    },
    corsHeaders(),
  );
}

function iconText(value: string, status: number) {
  return new Response(value, {
    status,
    headers: mergeHeaders(
      { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
      corsHeaders(),
    ),
  });
}

export const skillPresentationAssetHttp = httpAction(skillPresentationAssetHandler);
