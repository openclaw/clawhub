import {
  CATALOG_FEED_ID,
  CATALOG_FEED_SCHEMA_VERSION,
  CATALOG_FEED_SHARD_ROOT_PAYLOAD_TYPE,
  CATALOG_SKILLS_FEED_ID,
  CATALOG_SKILLS_FEED_SHARD_ROOT_PAYLOAD_TYPE,
  ApiRoutes,
  parseCatalogFeedShardRoot,
  serializeCatalogFeedShardRoot,
} from "clawhub-schema";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { httpAction } from "../functions";
import { corsHeaders, mergeHeaders } from "../lib/httpHeaders";
import { resolveFeedSigningConfig, signFeedPayload } from "./catalogFeedSigning";
import { catalogFeedUnavailableResponse, matchesEtag } from "./catalogFeedV1";
import { publicApiOrigin } from "./shared";

const MAX_SIGNED_ROOT_BYTES = 1024 * 1024;

type FeedId = typeof CATALOG_FEED_ID | typeof CATALOG_SKILLS_FEED_ID;

function rootPayloadType(feedId: FeedId) {
  return feedId === CATALOG_FEED_ID
    ? CATALOG_FEED_SHARD_ROOT_PAYLOAD_TYPE
    : CATALOG_SKILLS_FEED_SHARD_ROOT_PAYLOAD_TYPE;
}

function shardApiRoute(feedId: FeedId) {
  return feedId === CATALOG_FEED_ID
    ? ApiRoutes.catalogFeedShards
    : ApiRoutes.catalogSkillsFeedShards;
}

function publicShardUrl(feedId: FeedId, sha256: string, origin: string) {
  const publicPath = `${shardApiRoute(feedId).replace(/^\/api/u, "")}/sha256-${sha256}.json`;
  return new URL(publicPath, origin).toString();
}

export async function signedCatalogFeedShardRootHandler(
  ctx: ActionCtx,
  request: Request,
  feedId: FeedId = CATALOG_FEED_ID,
  env: Record<string, string | undefined> = process.env,
) {
  let signingConfig;
  try {
    signingConfig = await resolveFeedSigningConfig(env);
  } catch {
    return catalogFeedUnavailableResponse("Signed catalog shard root is unavailable");
  }
  if (!signingConfig) {
    return catalogFeedUnavailableResponse("Signed catalog shard root is unavailable");
  }
  const publication = await ctx.runQuery(
    internal.catalogFeedShards.getLatestCatalogFeedShardPublication,
    { feedId, now: new Date().toISOString() },
  );
  if (!publication) return catalogFeedUnavailableResponse("Catalog shard root is not published");
  const requestOrigin = publicApiOrigin(request);
  const payload = serializeCatalogFeedShardRoot({
    schemaVersion: CATALOG_FEED_SCHEMA_VERSION,
    feedId,
    sequence: publication.sequence,
    generatedAt: publication.generatedAt,
    expiresAt: publication.expiresAt,
    metadata: { description: publication.description || null },
    entryCount: publication.entryCount,
    shards: publication.shards.map(
      (shard: { index: number; sha256: string; byteLength: number; entryCount: number }) => ({
        ...shard,
        url: publicShardUrl(feedId, shard.sha256, requestOrigin),
      }),
    ),
  });
  parseCatalogFeedShardRoot(JSON.parse(payload));
  const signed = await signFeedPayload(rootPayloadType(feedId), payload, signingConfig);
  if (new TextEncoder().encode(signed.body).length > MAX_SIGNED_ROOT_BYTES) {
    return catalogFeedUnavailableResponse("Signed catalog shard root exceeds its byte limit");
  }
  const etag = `"sha256:${signed.sha256}"`;
  const headers = mergeHeaders(
    {
      "Content-Type": "application/vnd.dsse+json; charset=utf-8",
      "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=86400",
      "Surrogate-Control": "max-age=300, stale-while-revalidate=86400",
      ETag: etag,
      "X-Catalog-Feed-Sequence": String(publication.sequence),
      "X-Content-SHA256": signed.sha256,
      "X-OpenClaw-Feed-Signing-Key-ID": signingConfig.keyId,
      "X-Content-Type-Options": "nosniff",
      Vary: "Accept-Encoding",
    },
    corsHeaders(),
  );
  if (matchesEtag(request, etag)) return new Response(null, { status: 304, headers });
  return new Response(signed.body, { status: 200, headers });
}

export async function catalogFeedShardHandler(
  ctx: ActionCtx,
  request: Request,
  feedId: FeedId = CATALOG_FEED_ID,
) {
  const prefix = `${shardApiRoute(feedId)}/`;
  const pathname = new URL(request.url).pathname;
  if (!pathname.startsWith(prefix)) return new Response("Not found", { status: 404 });
  const match = /^sha256-([a-f0-9]{64})\.json$/u.exec(pathname.slice(prefix.length));
  if (!match?.[1]) return new Response("Not found", { status: 404 });
  const shard = await ctx.runQuery(internal.catalogFeedShards.getCatalogFeedShardByDigest, {
    sha256: match[1],
  });
  if (!shard || shard.feedId !== feedId) return new Response("Not found", { status: 404 });
  const etag = `"sha256:${shard.sha256}"`;
  const headers = mergeHeaders(
    {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=31536000, immutable",
      "Surrogate-Control": "max-age=31536000, immutable",
      ETag: etag,
      "Content-Length": String(shard.byteLength),
      "X-Content-SHA256": shard.sha256,
      "X-Catalog-Feed-Sequence": String(shard.sequence),
      "X-Catalog-Feed-Shard-Index": String(shard.index),
      "X-Content-Type-Options": "nosniff",
      Vary: "Accept-Encoding",
    },
    corsHeaders(),
  );
  if (matchesEtag(request, etag)) return new Response(null, { status: 304, headers });
  return new Response(shard.payload, { status: 200, headers });
}

export const signedCatalogFeedShardRootHttp = httpAction(signedCatalogFeedShardRootHandler);
export const signedCatalogSkillsFeedShardRootHttp = httpAction((ctx, request) =>
  signedCatalogFeedShardRootHandler(ctx, request, CATALOG_SKILLS_FEED_ID),
);
export const catalogFeedShardHttp = httpAction(catalogFeedShardHandler);
export const catalogSkillsFeedShardHttp = httpAction((ctx, request) =>
  catalogFeedShardHandler(ctx, request, CATALOG_SKILLS_FEED_ID),
);
