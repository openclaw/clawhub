import {
  CATALOG_FEED_ID,
  CATALOG_FEED_QUERY_MAX_ENTRIES,
  CATALOG_FEED_QUERY_PAYLOAD_TYPE,
  CATALOG_FEED_SCHEMA_VERSION,
  normalizeCatalogFeedQuery,
  parseCatalogFeedQueryPage,
  type CatalogFeedEntry,
  type CatalogFeedQuery,
} from "clawhub-schema";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { httpAction } from "../functions";
import { sha256Hex } from "../lib/clawpack";
import { corsHeaders, mergeHeaders } from "../lib/httpHeaders";
import {
  type FeedSigningConfig,
  resolveFeedSigningConfig,
  signFeedPayload,
} from "./catalogFeedSigning";
import { catalogFeedUnavailableResponse } from "./catalogFeedV1";

const CATALOG_FEED_QUERY_CURSOR_PAYLOAD_TYPE =
  "openclaw.official-external-plugin-catalog-query-cursor.v1";
const CURSOR_MAX_LENGTH = 4096;
const PROJECTION_TTL_MS = 5 * 60 * 1000;
const MAX_SIGNED_PAGE_BYTES = 1024 * 1024;

type CatalogQueryCursor = {
  schemaVersion: 1;
  operation: "query";
  feedId: typeof CATALOG_FEED_ID;
  sequence: number;
  materializationKey: string;
  querySha256: string;
  databaseCursor: string;
  limit: number;
  pageIndex: number;
  startIndex: number;
  resultCount: number;
  generatedAt: string;
  expiresAt: string;
};

function base64UrlEncode(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlDecode(value: string) {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error("Invalid base64url value");
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function timingSafeEqual(left: string, right: string) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(record).sort().join("\0") === [...keys].sort().join("\0");
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function parseCursorPayload(value: unknown): CatalogQueryCursor | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    !hasExactKeys(record, [
      "schemaVersion",
      "operation",
      "feedId",
      "sequence",
      "materializationKey",
      "querySha256",
      "databaseCursor",
      "limit",
      "pageIndex",
      "startIndex",
      "resultCount",
      "generatedAt",
      "expiresAt",
    ]) ||
    record.schemaVersion !== 1 ||
    record.operation !== "query" ||
    record.feedId !== CATALOG_FEED_ID ||
    !isNonNegativeInteger(record.sequence) ||
    typeof record.materializationKey !== "string" ||
    !/^[a-f0-9]{64}$/u.test(record.materializationKey) ||
    typeof record.querySha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(record.querySha256) ||
    typeof record.databaseCursor !== "string" ||
    !record.databaseCursor ||
    record.databaseCursor.length > CURSOR_MAX_LENGTH ||
    !isNonNegativeInteger(record.limit) ||
    record.limit < 1 ||
    record.limit > CATALOG_FEED_QUERY_MAX_ENTRIES ||
    !isNonNegativeInteger(record.pageIndex) ||
    record.pageIndex < 1 ||
    !isNonNegativeInteger(record.startIndex) ||
    record.startIndex < record.pageIndex ||
    !isNonNegativeInteger(record.resultCount) ||
    record.startIndex >= record.resultCount ||
    typeof record.generatedAt !== "string" ||
    typeof record.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(record.generatedAt)) ||
    !Number.isFinite(Date.parse(record.expiresAt)) ||
    Date.parse(record.expiresAt) <= Date.parse(record.generatedAt)
  ) {
    return null;
  }
  return record as CatalogQueryCursor;
}

async function encodeCursor(cursor: CatalogQueryCursor, config: FeedSigningConfig) {
  const signed = await signFeedPayload(
    CATALOG_FEED_QUERY_CURSOR_PAYLOAD_TYPE,
    JSON.stringify(cursor),
    config,
  );
  const encoded = base64UrlEncode(new TextEncoder().encode(signed.body));
  if (encoded.length > CURSOR_MAX_LENGTH) throw new Error("Catalog query cursor is too large");
  return encoded;
}

async function decodeCursor(raw: string, config: FeedSigningConfig) {
  if (!raw || raw.length > CURSOR_MAX_LENGTH) return null;
  try {
    const envelopeBody = new TextDecoder().decode(base64UrlDecode(raw));
    const envelope = JSON.parse(envelopeBody) as Record<string, unknown>;
    if (
      !hasExactKeys(envelope, ["payloadType", "payload", "signatures"]) ||
      envelope.payloadType !== CATALOG_FEED_QUERY_CURSOR_PAYLOAD_TYPE ||
      typeof envelope.payload !== "string" ||
      !Array.isArray(envelope.signatures) ||
      envelope.signatures.length !== 1
    ) {
      return null;
    }
    const payload = new TextDecoder().decode(base64UrlDecode(envelope.payload));
    const expected = await signFeedPayload(CATALOG_FEED_QUERY_CURSOR_PAYLOAD_TYPE, payload, config);
    if (!timingSafeEqual(expected.body, envelopeBody)) return null;
    return parseCursorPayload(JSON.parse(payload));
  } catch {
    return null;
  }
}

function textResponse(message: string, status: number) {
  return new Response(message, {
    status,
    headers: mergeHeaders(
      { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
      corsHeaders(),
    ),
  });
}

function hasOnlySearchParams(url: URL, allowed: ReadonlySet<string>) {
  return [...url.searchParams.keys()].every((key) => allowed.has(key));
}

function parseInitialRequest(url: URL): { query: CatalogFeedQuery; limit: number } | null {
  if (!hasOnlySearchParams(url, new Set(["q", "type", "state", "publisherId", "limit"]))) {
    return null;
  }
  if (url.searchParams.getAll("q").length > 1 || url.searchParams.getAll("limit").length > 1) {
    return null;
  }
  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit === null ? 100 : Number(rawLimit);
  if (
    (rawLimit !== null && !/^\d+$/u.test(rawLimit)) ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > CATALOG_FEED_QUERY_MAX_ENTRIES
  ) {
    return null;
  }
  const raw: Record<string, unknown> = {};
  const text = url.searchParams.get("q");
  const types = url.searchParams.getAll("type");
  const states = url.searchParams.getAll("state");
  const publisherIds = url.searchParams.getAll("publisherId");
  if (text !== null) raw.text = text;
  if (types.length > 0) raw.types = types;
  if (states.length > 0) raw.states = states;
  if (publisherIds.length > 0) raw.publisherIds = publisherIds;
  try {
    return { query: normalizeCatalogFeedQuery(raw), limit };
  } catch {
    return null;
  }
}

async function signedQueryResponse(payload: unknown, config: FeedSigningConfig) {
  parseCatalogFeedQueryPage(payload);
  const signed = await signFeedPayload(
    CATALOG_FEED_QUERY_PAYLOAD_TYPE,
    JSON.stringify(payload),
    config,
  );
  if (new TextEncoder().encode(signed.body).length > MAX_SIGNED_PAGE_BYTES) {
    return catalogFeedUnavailableResponse("Catalog query response exceeds its byte limit");
  }
  return new Response(signed.body, {
    status: 200,
    headers: mergeHeaders(
      {
        "Content-Type": "application/vnd.dsse+json; charset=utf-8",
        "Cache-Control": "private, no-store",
        "X-Content-SHA256": signed.sha256,
        "X-OpenClaw-Feed-Signing-Key-ID": config.keyId,
        "X-Content-Type-Options": "nosniff",
      },
      corsHeaders(),
    ),
  });
}

export async function signedCatalogFeedQueryHandler(
  ctx: ActionCtx,
  request: Request,
  env: Record<string, string | undefined> = process.env,
) {
  let config: FeedSigningConfig | null;
  try {
    config = await resolveFeedSigningConfig(env);
  } catch {
    return catalogFeedUnavailableResponse("Catalog query signing is unavailable");
  }
  if (!config) return catalogFeedUnavailableResponse("Catalog query signing is unavailable");

  const url = new URL(request.url);
  const rawCursor = url.searchParams.get("cursor");
  let query: CatalogFeedQuery | undefined;
  let querySha256: string;
  let sequence: number;
  let materializationKey: string;
  let databaseCursor: string | null;
  let limit: number;
  let pageIndex: number;
  let startIndex: number;
  let expectedResultCount: number;
  let generatedAt: string;
  let expiresAt: string;

  if (rawCursor !== null) {
    if (
      !hasOnlySearchParams(url, new Set(["cursor"])) ||
      url.searchParams.getAll("cursor").length !== 1
    ) {
      return textResponse("Invalid catalog query parameters", 400);
    }
    const cursor = await decodeCursor(rawCursor, config);
    if (!cursor) return textResponse("Invalid catalog query cursor", 400);
    if (Date.parse(cursor.expiresAt) <= Date.now()) {
      return textResponse("Catalog query cursor expired", 409);
    }
    ({
      querySha256,
      sequence,
      materializationKey,
      databaseCursor,
      limit,
      pageIndex,
      startIndex,
      resultCount: expectedResultCount,
      generatedAt,
      expiresAt,
    } = cursor);
  } else {
    const parsed = parseInitialRequest(url);
    if (!parsed) return textResponse("Invalid catalog query request", 400);
    query = parsed.query;
    querySha256 = await sha256Hex(new TextEncoder().encode(JSON.stringify(query)));
    limit = parsed.limit;
    pageIndex = 0;
    startIndex = 0;
    databaseCursor = null;
    const now = Date.now();
    generatedAt = new Date(now).toISOString();
    expiresAt = new Date(now + PROJECTION_TTL_MS).toISOString();
    try {
      const materialization: {
        materializationKey: string;
        sequence: number;
        query: string;
        querySha256: string;
        resultCount: number;
        expirationTime: number;
      } = await ctx.runAction(internal.catalogFeed.materializeCatalogFeedQuery, {
        feedId: CATALOG_FEED_ID,
        query: JSON.stringify(query),
        expirationTime: Date.parse(expiresAt),
      });
      materializationKey = materialization.materializationKey;
      sequence = materialization.sequence;
      expectedResultCount = materialization.resultCount;
      expiresAt = new Date(materialization.expirationTime).toISOString();
      if (
        materialization.query !== JSON.stringify(query) ||
        materialization.querySha256 !== querySha256
      ) {
        return catalogFeedUnavailableResponse("Catalog query materialization changed unexpectedly");
      }
    } catch {
      return catalogFeedUnavailableResponse("Catalog query index is unavailable");
    }
  }

  const result = await ctx.runQuery(internal.catalogFeed.listCatalogFeedQueryResults, {
    materializationKey,
    feedId: CATALOG_FEED_ID,
    sequence,
    querySha256,
    paginationOpts: { cursor: databaseCursor, numItems: limit },
  });
  if (result.unavailable) return textResponse("Catalog query materialization expired", 409);
  if (result.resultCount !== expectedResultCount) {
    return catalogFeedUnavailableResponse("Catalog query result count changed unexpectedly");
  }
  let materializedQuery: CatalogFeedQuery;
  try {
    materializedQuery = normalizeCatalogFeedQuery(JSON.parse(result.query));
  } catch {
    return catalogFeedUnavailableResponse("Catalog query materialization is invalid");
  }
  if (
    JSON.stringify(materializedQuery) !== result.query ||
    (query !== undefined && JSON.stringify(query) !== result.query)
  ) {
    return catalogFeedUnavailableResponse("Catalog query materialization changed unexpectedly");
  }
  query = materializedQuery;
  const entries = result.page.map(({ payload }) => JSON.parse(payload) as CatalogFeedEntry);
  if (
    result.page.some(({ ordinal }, index) => ordinal !== startIndex + index) ||
    startIndex + entries.length > expectedResultCount ||
    (!result.isDone && (!result.continueCursor || entries.length === 0))
  ) {
    return catalogFeedUnavailableResponse("Catalog query result ordering changed unexpectedly");
  }
  const nextCursor = result.isDone
    ? null
    : await encodeCursor(
        {
          schemaVersion: 1,
          operation: "query",
          feedId: CATALOG_FEED_ID,
          sequence,
          materializationKey,
          querySha256,
          databaseCursor: result.continueCursor,
          limit,
          pageIndex: pageIndex + 1,
          startIndex: startIndex + entries.length,
          resultCount: expectedResultCount,
          generatedAt,
          expiresAt,
        },
        config,
      );
  return await signedQueryResponse(
    {
      schemaVersion: CATALOG_FEED_SCHEMA_VERSION,
      feedId: CATALOG_FEED_ID,
      sequence,
      generatedAt,
      expiresAt,
      query,
      requestCursor: rawCursor,
      pageIndex,
      startIndex,
      resultCount: expectedResultCount,
      entries,
      nextCursor,
    },
    config,
  );
}

export const signedCatalogFeedQueryHttp = httpAction(signedCatalogFeedQueryHandler);
