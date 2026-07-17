import {
  ApiRoutes,
  CATALOG_FEED_CHANGES_MAX_RECORDS,
  CATALOG_FEED_CHANGES_PAYLOAD_TYPE,
  CATALOG_FEED_ID,
  CATALOG_FEED_SCHEMA_VERSION,
  parseCatalogFeedChangePage,
  parseCatalogFeedResetRequired,
  type CatalogFeedChange,
} from "clawhub-schema";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { httpAction } from "../functions";
import { corsHeaders, mergeHeaders } from "../lib/httpHeaders";
import {
  type FeedSigningConfig,
  resolveFeedSigningConfig,
  signFeedPayload,
} from "./catalogFeedSigning";
import { catalogFeedUnavailableResponse } from "./catalogFeedV1";

const CATALOG_FEED_CURSOR_PAYLOAD_TYPE = "openclaw.official-catalog-change-cursor.v1";
const CURSOR_MAX_LENGTH = 4096;
const PROJECTION_TTL_MS = 5 * 60 * 1000;
const MAX_SIGNED_PAGE_BYTES = 1024 * 1024;

type CatalogChangesCursor = {
  schemaVersion: 1;
  operation: "changes";
  feedId: typeof CATALOG_FEED_ID;
  fromSequence: number;
  toSequence: number;
  databaseCursor: string;
  limit: number;
  pageIndex: number;
  startIndex: number;
  changeCount: number;
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

function parseCursorPayload(value: unknown): CatalogChangesCursor | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    !hasExactKeys(record, [
      "schemaVersion",
      "operation",
      "feedId",
      "fromSequence",
      "toSequence",
      "databaseCursor",
      "limit",
      "pageIndex",
      "startIndex",
      "changeCount",
      "generatedAt",
      "expiresAt",
    ]) ||
    record.schemaVersion !== 1 ||
    record.operation !== "changes" ||
    record.feedId !== CATALOG_FEED_ID ||
    !isNonNegativeInteger(record.fromSequence) ||
    !isNonNegativeInteger(record.toSequence) ||
    record.toSequence < record.fromSequence ||
    typeof record.databaseCursor !== "string" ||
    !record.databaseCursor ||
    record.databaseCursor.length > CURSOR_MAX_LENGTH ||
    !isNonNegativeInteger(record.limit) ||
    record.limit < 1 ||
    record.limit > CATALOG_FEED_CHANGES_MAX_RECORDS ||
    !isNonNegativeInteger(record.pageIndex) ||
    record.pageIndex < 1 ||
    !isNonNegativeInteger(record.startIndex) ||
    record.startIndex < record.pageIndex ||
    !isNonNegativeInteger(record.changeCount) ||
    record.startIndex >= record.changeCount ||
    typeof record.generatedAt !== "string" ||
    typeof record.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(record.generatedAt)) ||
    !Number.isFinite(Date.parse(record.expiresAt)) ||
    Date.parse(record.expiresAt) <= Date.parse(record.generatedAt)
  ) {
    return null;
  }
  return record as CatalogChangesCursor;
}

async function encodeCursor(cursor: CatalogChangesCursor, config: FeedSigningConfig) {
  const signed = await signFeedPayload(
    CATALOG_FEED_CURSOR_PAYLOAD_TYPE,
    JSON.stringify(cursor),
    config,
  );
  const encoded = base64UrlEncode(new TextEncoder().encode(signed.body));
  if (encoded.length > CURSOR_MAX_LENGTH) throw new Error("Catalog change cursor is too large");
  return encoded;
}

async function decodeCursor(raw: string, config: FeedSigningConfig) {
  if (!raw || raw.length > CURSOR_MAX_LENGTH) return null;
  try {
    const envelopeBody = new TextDecoder().decode(base64UrlDecode(raw));
    const envelope = JSON.parse(envelopeBody) as Record<string, unknown>;
    if (
      !hasExactKeys(envelope, ["schemaVersion", "payloadType", "payload", "signatures"]) ||
      envelope.schemaVersion !== 1 ||
      envelope.payloadType !== CATALOG_FEED_CURSOR_PAYLOAD_TYPE ||
      typeof envelope.payload !== "string" ||
      !Array.isArray(envelope.signatures) ||
      envelope.signatures.length !== 1
    ) {
      return null;
    }
    const payload = new TextDecoder().decode(base64UrlDecode(envelope.payload));
    const expected = await signFeedPayload(CATALOG_FEED_CURSOR_PAYLOAD_TYPE, payload, config);
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

async function signedChangesResponse(payload: unknown, config: FeedSigningConfig, status = 200) {
  if ((payload as { resetRequired?: unknown }).resetRequired === true) {
    parseCatalogFeedResetRequired(payload);
  } else {
    parseCatalogFeedChangePage(payload);
  }
  const signed = await signFeedPayload(
    CATALOG_FEED_CHANGES_PAYLOAD_TYPE,
    JSON.stringify(payload),
    config,
  );
  if (new TextEncoder().encode(signed.body).length > MAX_SIGNED_PAGE_BYTES) {
    return textResponse("Catalog change page is too large; retry with a smaller limit", 413);
  }
  return new Response(signed.body, {
    status,
    headers: mergeHeaders(
      {
        "Content-Type": "application/vnd.dsse+json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-SHA256": signed.sha256,
        "X-OpenClaw-Feed-Signing-Key-ID": config.keyId,
        "X-Content-Type-Options": "nosniff",
      },
      corsHeaders(),
    ),
  });
}

function hasOnlySearchParams(url: URL, allowed: ReadonlySet<string>) {
  return [...url.searchParams.keys()].every((key) => allowed.has(key));
}

function projectionTimes() {
  const generatedAtMs = Date.now();
  return {
    generatedAt: new Date(generatedAtMs).toISOString(),
    expiresAt: new Date(generatedAtMs + PROJECTION_TTL_MS).toISOString(),
  };
}

export async function signedCatalogFeedChangesHandler(
  ctx: ActionCtx,
  request: Request,
  env: Record<string, string | undefined> = process.env,
) {
  let config: FeedSigningConfig | null;
  try {
    config = await resolveFeedSigningConfig(env);
  } catch {
    return catalogFeedUnavailableResponse("Signed catalog changes are unavailable");
  }
  if (!config) return catalogFeedUnavailableResponse("Signed catalog changes are unavailable");

  const url = new URL(request.url);
  const rawCursor = url.searchParams.get("cursor");
  let fromSequence: number;
  let toSequence: number;
  let databaseCursor: string | null;
  let limit: number;
  let pageIndex: number;
  let startIndex: number;
  let expectedChangeCount: number | null;
  let generatedAt: string;
  let expiresAt: string;

  if (rawCursor !== null) {
    if (!hasOnlySearchParams(url, new Set(["cursor"]))) {
      return textResponse("Cursor requests cannot include change parameters", 400);
    }
    const cursor = await decodeCursor(rawCursor, config);
    if (!cursor) return textResponse("Invalid catalog changes cursor", 400);
    if (Date.parse(cursor.expiresAt) <= Date.now()) {
      return textResponse("Catalog changes cursor expired", 409);
    }
    ({
      fromSequence,
      toSequence,
      databaseCursor,
      limit,
      pageIndex,
      startIndex,
      changeCount: expectedChangeCount,
      generatedAt,
      expiresAt,
    } = cursor);
  } else {
    if (!hasOnlySearchParams(url, new Set(["fromSequence", "limit"]))) {
      return textResponse("Invalid catalog changes parameter", 400);
    }
    const rawFromSequence = url.searchParams.get("fromSequence");
    const rawLimit = url.searchParams.get("limit");
    limit = rawLimit === null ? 100 : Number(rawLimit);
    if (
      rawFromSequence === null ||
      !/^\d+$/u.test(rawFromSequence) ||
      !Number.isSafeInteger(Number(rawFromSequence)) ||
      (rawLimit !== null && !/^\d+$/u.test(rawLimit)) ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > CATALOG_FEED_CHANGES_MAX_RECORDS
    ) {
      return textResponse("Invalid catalog changes request", 400);
    }
    fromSequence = Number(rawFromSequence);
    const window = await ctx.runQuery(internal.catalogFeed.getChangeWindow, {
      feedId: CATALOG_FEED_ID,
    });
    if (fromSequence > window.currentSequence) {
      return textResponse("Catalog changes fromSequence is ahead of the current feed", 400);
    }
    toSequence = window.currentSequence;
    databaseCursor = null;
    pageIndex = 0;
    startIndex = 0;
    expectedChangeCount = null;
    ({ generatedAt, expiresAt } = projectionTimes());
  }

  const result = await ctx.runQuery(internal.catalogFeed.listChanges, {
    feedId: CATALOG_FEED_ID,
    fromSequence,
    toSequence,
    paginationOpts: { cursor: databaseCursor, numItems: limit },
  });
  if (result.resetRequired) {
    return await signedChangesResponse(
      {
        schemaVersion: CATALOG_FEED_SCHEMA_VERSION,
        feedId: CATALOG_FEED_ID,
        fromSequence,
        currentSequence: result.currentSequence,
        generatedAt,
        expiresAt,
        resetRequired: true,
        snapshotUrl: new URL(ApiRoutes.catalogFeed, request.url).toString(),
      },
      config,
      409,
    );
  }
  if (expectedChangeCount !== null && result.changeCount !== expectedChangeCount) {
    return catalogFeedUnavailableResponse("Catalog change range changed unexpectedly");
  }

  const changes = result.page.map(({ payload }) => JSON.parse(payload) as CatalogFeedChange);
  const changeCount = result.changeCount;
  const nextCursor = result.isDone
    ? null
    : await encodeCursor(
        {
          schemaVersion: 1,
          operation: "changes",
          feedId: CATALOG_FEED_ID,
          fromSequence,
          toSequence,
          databaseCursor: result.continueCursor,
          limit,
          pageIndex: pageIndex + 1,
          startIndex: startIndex + changes.length,
          changeCount,
          generatedAt,
          expiresAt,
        },
        config,
      );
  return await signedChangesResponse(
    {
      schemaVersion: CATALOG_FEED_SCHEMA_VERSION,
      feedId: CATALOG_FEED_ID,
      fromSequence,
      toSequence,
      generatedAt,
      expiresAt,
      requestCursor: rawCursor,
      pageIndex,
      startIndex,
      changeCount,
      changes,
      nextCursor,
    },
    config,
  );
}

export const signedCatalogFeedChangesHttp = httpAction(signedCatalogFeedChangesHandler);
