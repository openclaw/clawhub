import {
  PUBLISHER_FEED_CHANGE_MAX_LIMIT,
  PUBLISHER_FEED_MAX_LIMIT,
  PUBLISHER_FEED_QUERY_MAX_LIMIT,
  PUBLISHER_FEED_SCHEMA_VERSION,
  normalizePublisherFeedQuery,
  type PublisherFeedChange,
  type PublisherFeedEntry,
  type PublisherFeedQuery,
} from "clawhub-schema";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { mergeHeaders } from "../lib/httpHeaders";
import { applyRateLimit } from "../lib/httpRateLimit";
import { resolveFeedSigningConfig, type FeedSigningConfig } from "./catalogFeedSigning";
import {
  PUBLISHER_FEED_CHANGES_PAYLOAD_TYPE,
  PUBLISHER_FEED_QUERY_PAYLOAD_TYPE,
  PUBLISHER_FEED_SNAPSHOT_PAYLOAD_TYPE,
  decodePublisherProjectionCursor,
  encodePublisherProjectionCursor,
  signedPublisherProjectionResponse,
  type PublisherChangesCursor,
  type PublisherQueryCursor,
} from "./publisherFeedSigning";
import { getPathSegments, json, text } from "./shared";

const publisherFeedRefs = internal as unknown as {
  accountFeeds: {
    getPublisherDetail: unknown;
    getPublisherFeedPublication: unknown;
    getPublisherFeedChanges: unknown;
    queryPublisherFeed: unknown;
    refreshPublisherFeed: unknown;
  };
};

type PublisherFeedCursor = {
  publisherId: string;
  sequence: number;
  offset: number;
};

type StoredPublisherFeed = {
  publisherId: string;
  feedId: string;
  sequence: number;
  generatedAt: string;
  handle: string | null;
  displayName: string;
  entries: unknown[];
};

type PublisherQueryProjection = {
  feedId: string;
  sequence: number;
  query: PublisherFeedQuery;
  startIndex: number;
  resultCount: number;
  entries: PublisherFeedEntry[];
  nextOffset: number | null;
};

type PublisherChangesProjection =
  | null
  | { status: "invalid" }
  | {
      status: "reset-required";
      feedId: string;
      fromSequence: number;
      currentSequence: number;
    }
  | {
      status: "complete";
      feedId: string;
      fromSequence: number;
      toSequence: number;
      startIndex: number;
      changeCount: number;
      changes: PublisherFeedChange[];
      nextOffset: number | null;
    };

async function runQueryRef<T>(
  ctx: Pick<ActionCtx, "runQuery">,
  ref: unknown,
  args: unknown,
): Promise<T> {
  return (await ctx.runQuery(ref as never, args as never)) as T;
}

async function runMutationRef<T>(
  ctx: Pick<ActionCtx, "runMutation">,
  ref: unknown,
  args: unknown,
): Promise<T> {
  return (await ctx.runMutation(ref as never, args as never)) as T;
}

function encodeFeedCursor(cursor: PublisherFeedCursor) {
  return btoa(JSON.stringify(cursor)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function decodeFeedCursor(raw: string): PublisherFeedCursor | null {
  if (!raw || raw.length > 512 || !/^[A-Za-z0-9_-]+$/u.test(raw)) return null;
  try {
    const padded = raw
      .replaceAll("-", "+")
      .replaceAll("_", "/")
      .padEnd(Math.ceil(raw.length / 4) * 4, "=");
    const parsed = JSON.parse(atob(padded)) as Partial<PublisherFeedCursor>;
    if (
      typeof parsed.publisherId !== "string" ||
      !parsed.publisherId ||
      !Number.isSafeInteger(parsed.sequence) ||
      (parsed.sequence ?? -1) < 0 ||
      !Number.isSafeInteger(parsed.offset) ||
      (parsed.offset ?? 0) <= 0
    ) {
      return null;
    }
    return parsed as PublisherFeedCursor;
  } catch {
    return null;
  }
}

type ParsedFeedReadParams =
  | { response: Response }
  | { args: { limit: number; cursor: PublisherFeedCursor | null } };

function parseFeedReadParams(request: Request, rateHeaders: HeadersInit): ParsedFeedReadParams {
  const url = new URL(request.url);
  const limitValue = url.searchParams.get("limit");
  let limit = Math.min(50, PUBLISHER_FEED_MAX_LIMIT);
  if (limitValue !== null) {
    if (!/^[1-9]\d*$/u.test(limitValue)) {
      return { response: text("Invalid feed limit", 400, rateHeaders) };
    }
    const parsedLimit = Number(limitValue);
    if (!Number.isSafeInteger(parsedLimit)) {
      return { response: text("Invalid feed limit", 400, rateHeaders) };
    }
    limit = Math.min(parsedLimit, PUBLISHER_FEED_MAX_LIMIT);
  }

  const cursorValue = url.searchParams.get("cursor");
  const cursor = cursorValue === null ? null : decodeFeedCursor(cursorValue);
  if (cursorValue !== null && !cursor) {
    return { response: text("Invalid publisher feed cursor", 400, rateHeaders) };
  }
  return { args: { limit, cursor } };
}

const FEED_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

function feedHeaders(rateHeaders: HeadersInit) {
  return mergeHeaders(rateHeaders, FEED_HEADERS);
}

function safePathSegments(request: Request, prefix: string) {
  try {
    return getPathSegments(request, prefix);
  } catch (error) {
    if (error instanceof URIError) return null;
    throw error;
  }
}

function pagePublisherFeed(feed: StoredPublisherFeed, limit: number, offset: number) {
  const entries = feed.entries.slice(offset, offset + limit);
  const nextOffset = offset + entries.length;
  return {
    schemaVersion: PUBLISHER_FEED_SCHEMA_VERSION,
    feedId: feed.feedId,
    publisherId: feed.publisherId,
    handle: feed.handle,
    displayName: feed.displayName,
    generatedAt: feed.generatedAt,
    sequence: feed.sequence,
    entries,
    nextCursor:
      nextOffset < feed.entries.length
        ? encodeFeedCursor({
            publisherId: feed.publisherId,
            sequence: feed.sequence,
            offset: nextOffset,
          })
        : null,
  };
}

const SIGNED_PROJECTION_TTL_MS = 5 * 60 * 1000;

function projectionTimes() {
  const now = Date.now();
  return {
    generatedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + SIGNED_PROJECTION_TTL_MS).toISOString(),
  };
}

function parseBoundedLimit(
  raw: string | null,
  defaultLimit: number,
  maxLimit: number,
): number | null {
  if (raw === null) return defaultLimit;
  if (!/^[1-9]\d*$/u.test(raw)) return null;
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) return null;
  return Math.min(value, maxLimit);
}

function hasOnlySearchParams(url: URL, allowed: ReadonlySet<string>) {
  return [...url.searchParams.keys()].every((key) => allowed.has(key));
}

function signingUnavailable(rateHeaders: HeadersInit) {
  return text(
    "Signed publisher feed projections are unavailable",
    503,
    mergeHeaders(rateHeaders, { "Cache-Control": "no-store" }),
  );
}

async function resolveProjectionSigningConfig(
  env: Record<string, string | undefined>,
  rateHeaders: HeadersInit,
): Promise<{ config: FeedSigningConfig } | { response: Response }> {
  try {
    const config = await resolveFeedSigningConfig(env);
    return config ? { config } : { response: signingUnavailable(rateHeaders) };
  } catch {
    return { response: signingUnavailable(rateHeaders) };
  }
}

async function refreshPublisherProjection(
  ctx: ActionCtx,
  publisherId: string,
  rateHeaders: HeadersInit,
): Promise<{ feed: StoredPublisherFeed } | { response: Response }> {
  const feed = await runMutationRef<null | { status: "capacity-exceeded" } | StoredPublisherFeed>(
    ctx,
    publisherFeedRefs.accountFeeds.refreshPublisherFeed,
    { publisherId },
  );
  if (!feed) return { response: text("Publisher feed not found", 404, rateHeaders) };
  if ("status" in feed) {
    return {
      response: text(
        "Publisher feed exceeds the current snapshot capacity",
        503,
        mergeHeaders(rateHeaders, { "Cache-Control": "no-store" }),
      ),
    };
  }
  return { feed };
}

async function signedPublisherQueryHandler(params: {
  ctx: ActionCtx;
  request: Request;
  publisherId: string;
  config: FeedSigningConfig;
  rateHeaders: HeadersInit;
}): Promise<Response> {
  const url = new URL(params.request.url);
  const rawCursor = url.searchParams.get("cursor");
  let cursor: PublisherQueryCursor | null = null;
  let query: PublisherFeedQuery;
  let offset: number;
  let limit: number;
  let pageIndex: number;
  let generatedAt: string;
  let expiresAt: string;

  if (rawCursor !== null) {
    if (!hasOnlySearchParams(url, new Set(["cursor"]))) {
      return text("Cursor requests cannot include query filters", 400, params.rateHeaders);
    }
    const decoded = await decodePublisherProjectionCursor(rawCursor, params.config);
    if (!decoded || decoded.operation !== "query" || decoded.publisherId !== params.publisherId) {
      return text("Invalid publisher query cursor", 400, params.rateHeaders);
    }
    if (Date.parse(decoded.expiresAt) <= Date.now()) {
      return text("Publisher query cursor expired", 409, params.rateHeaders);
    }
    cursor = decoded;
    ({ query, offset, limit, pageIndex, generatedAt, expiresAt } = decoded);
  } else {
    if (!hasOnlySearchParams(url, new Set(["q", "kind", "limit"]))) {
      return text("Invalid publisher query parameter", 400, params.rateHeaders);
    }
    const parsedLimit = parseBoundedLimit(
      url.searchParams.get("limit"),
      50,
      PUBLISHER_FEED_QUERY_MAX_LIMIT,
    );
    if (parsedLimit === null) return text("Invalid query limit", 400, params.rateHeaders);
    const kinds = url.searchParams.getAll("kind");
    try {
      query = normalizePublisherFeedQuery({
        ...(url.searchParams.has("q") ? { text: url.searchParams.get("q") ?? "" } : {}),
        ...(kinds.length ? { kinds } : {}),
      });
    } catch {
      return text("Invalid publisher query", 400, params.rateHeaders);
    }
    const refreshed = await refreshPublisherProjection(
      params.ctx,
      params.publisherId,
      params.rateHeaders,
    );
    if ("response" in refreshed) return refreshed.response;
    offset = 0;
    limit = parsedLimit;
    pageIndex = 0;
    ({ generatedAt, expiresAt } = projectionTimes());
  }

  const projection = await runQueryRef<PublisherQueryProjection | null>(
    params.ctx,
    publisherFeedRefs.accountFeeds.queryPublisherFeed,
    { publisherId: params.publisherId, query, offset, limit },
  );
  if (!projection) return text("Publisher feed not found", 404, params.rateHeaders);
  if (cursor && projection.sequence !== cursor.sequence) {
    return text("Publisher query cursor is stale", 409, params.rateHeaders);
  }
  const nextCursor =
    projection.nextOffset === null
      ? null
      : await encodePublisherProjectionCursor(
          {
            schemaVersion: 1,
            operation: "query",
            publisherId: params.publisherId,
            feedId: projection.feedId,
            sequence: projection.sequence,
            query: projection.query,
            offset: projection.nextOffset,
            limit,
            pageIndex: pageIndex + 1,
            generatedAt,
            expiresAt,
          },
          params.config,
        );
  return await signedPublisherProjectionResponse(
    PUBLISHER_FEED_QUERY_PAYLOAD_TYPE,
    {
      schemaVersion: 1,
      feedId: projection.feedId,
      sequence: projection.sequence,
      generatedAt,
      expiresAt,
      query: projection.query,
      requestCursor: rawCursor,
      pageIndex,
      startIndex: projection.startIndex,
      resultCount: projection.resultCount,
      entries: projection.entries,
      nextCursor,
    },
    params.config,
    200,
    params.rateHeaders,
  );
}

async function signedPublisherChangesHandler(params: {
  ctx: ActionCtx;
  request: Request;
  publisherId: string;
  config: FeedSigningConfig;
  rateHeaders: HeadersInit;
}): Promise<Response> {
  const url = new URL(params.request.url);
  const rawCursor = url.searchParams.get("cursor");
  let cursor: PublisherChangesCursor | null = null;
  let fromSequence: number;
  let offset: number;
  let limit: number;
  let pageIndex: number;
  let generatedAt: string;
  let expiresAt: string;

  if (rawCursor !== null) {
    if (!hasOnlySearchParams(url, new Set(["cursor"]))) {
      return text("Cursor requests cannot include change filters", 400, params.rateHeaders);
    }
    const decoded = await decodePublisherProjectionCursor(rawCursor, params.config);
    if (!decoded || decoded.operation !== "changes" || decoded.publisherId !== params.publisherId) {
      return text("Invalid publisher changes cursor", 400, params.rateHeaders);
    }
    if (Date.parse(decoded.expiresAt) <= Date.now()) {
      return text("Publisher changes cursor expired", 409, params.rateHeaders);
    }
    cursor = decoded;
    ({ fromSequence, offset, limit, pageIndex, generatedAt, expiresAt } = decoded);
  } else {
    if (!hasOnlySearchParams(url, new Set(["fromSequence", "limit"]))) {
      return text("Invalid publisher changes parameter", 400, params.rateHeaders);
    }
    const rawFromSequence = url.searchParams.get("fromSequence");
    const parsedLimit = parseBoundedLimit(
      url.searchParams.get("limit"),
      100,
      PUBLISHER_FEED_CHANGE_MAX_LIMIT,
    );
    if (
      rawFromSequence === null ||
      !/^\d+$/u.test(rawFromSequence) ||
      !Number.isSafeInteger(Number(rawFromSequence)) ||
      parsedLimit === null
    ) {
      return text("Invalid publisher changes request", 400, params.rateHeaders);
    }
    const refreshed = await refreshPublisherProjection(
      params.ctx,
      params.publisherId,
      params.rateHeaders,
    );
    if ("response" in refreshed) return refreshed.response;
    fromSequence = Number(rawFromSequence);
    offset = 0;
    limit = parsedLimit;
    pageIndex = 0;
    ({ generatedAt, expiresAt } = projectionTimes());
  }

  const projection = await runQueryRef<PublisherChangesProjection>(
    params.ctx,
    publisherFeedRefs.accountFeeds.getPublisherFeedChanges,
    { publisherId: params.publisherId, fromSequence, offset, limit },
  );
  if (!projection) return text("Publisher feed not found", 404, params.rateHeaders);
  if (projection.status === "invalid") {
    return text("Invalid publisher changes range", 400, params.rateHeaders);
  }
  if (projection.status === "reset-required") {
    const snapshotUrl = new URL(
      `/api/v1/publishers/${encodeURIComponent(params.publisherId)}/feed/snapshot`,
      params.request.url,
    ).toString();
    return await signedPublisherProjectionResponse(
      PUBLISHER_FEED_CHANGES_PAYLOAD_TYPE,
      {
        schemaVersion: 1,
        feedId: projection.feedId,
        fromSequence: projection.fromSequence,
        currentSequence: projection.currentSequence,
        generatedAt,
        expiresAt,
        resetRequired: true,
        snapshotUrl,
      },
      params.config,
      409,
      params.rateHeaders,
    );
  }
  if (cursor && projection.toSequence !== cursor.toSequence) {
    return text("Publisher changes cursor is stale", 409, params.rateHeaders);
  }
  const nextCursor =
    projection.nextOffset === null
      ? null
      : await encodePublisherProjectionCursor(
          {
            schemaVersion: 1,
            operation: "changes",
            publisherId: params.publisherId,
            feedId: projection.feedId,
            fromSequence: projection.fromSequence,
            toSequence: projection.toSequence,
            offset: projection.nextOffset,
            limit,
            pageIndex: pageIndex + 1,
            generatedAt,
            expiresAt,
          },
          params.config,
        );
  return await signedPublisherProjectionResponse(
    PUBLISHER_FEED_CHANGES_PAYLOAD_TYPE,
    {
      schemaVersion: 1,
      feedId: projection.feedId,
      fromSequence: projection.fromSequence,
      toSequence: projection.toSequence,
      generatedAt,
      expiresAt,
      requestCursor: rawCursor,
      pageIndex,
      startIndex: projection.startIndex,
      changeCount: projection.changeCount,
      changes: projection.changes,
      nextCursor,
    },
    params.config,
    200,
    params.rateHeaders,
  );
}

async function signedPublisherSnapshotHandler(params: {
  ctx: ActionCtx;
  request: Request;
  publisherId: string;
  config: FeedSigningConfig;
  rateHeaders: HeadersInit;
}): Promise<Response> {
  const url = new URL(params.request.url);
  if ([...url.searchParams].length > 0) {
    return text("Invalid publisher snapshot parameter", 400, params.rateHeaders);
  }
  const refreshed = await refreshPublisherProjection(
    params.ctx,
    params.publisherId,
    params.rateHeaders,
  );
  if ("response" in refreshed) return refreshed.response;
  const expiresAt = new Date(
    Math.max(Date.now() + SIGNED_PROJECTION_TTL_MS, Date.parse(refreshed.feed.generatedAt) + 1),
  ).toISOString();
  return await signedPublisherProjectionResponse(
    PUBLISHER_FEED_SNAPSHOT_PAYLOAD_TYPE,
    {
      schemaVersion: PUBLISHER_FEED_SCHEMA_VERSION,
      feedId: refreshed.feed.feedId,
      publisherId: refreshed.feed.publisherId,
      handle: refreshed.feed.handle,
      displayName: refreshed.feed.displayName,
      generatedAt: refreshed.feed.generatedAt,
      expiresAt,
      sequence: refreshed.feed.sequence,
      entries: refreshed.feed.entries,
    },
    params.config,
    200,
    params.rateHeaders,
  );
}

export async function publishersGetRouterV1Handler(
  ctx: ActionCtx,
  request: Request,
  env: Record<string, string | undefined> = process.env,
): Promise<Response> {
  const rate = await applyRateLimit(ctx, request, "read");
  if (!rate.ok) return rate.response;

  const segments = safePathSegments(request, "/api/v1/publishers/");
  const isFeed = segments?.length === 2 && segments[1] === "feed";
  const projection = segments?.length === 3 && segments[1] === "feed" ? segments[2] : null;
  if (
    !segments ||
    (segments.length !== 1 &&
      !isFeed &&
      projection !== "snapshot" &&
      projection !== "query" &&
      projection !== "changes")
  ) {
    return text("Not found", 404, rate.headers);
  }

  const publisherId = (segments[0] ?? "").trim();
  if (!publisherId) return text("Publisher not found", 404, rate.headers);

  if (segments.length === 1) {
    const detail = await runQueryRef(ctx, publisherFeedRefs.accountFeeds.getPublisherDetail, {
      publisherId,
    });
    if (!detail) return text("Publisher not found", 404, rate.headers);
    return json(detail, 200, rate.headers);
  }

  if (projection === "snapshot" || projection === "query" || projection === "changes") {
    const signing = await resolveProjectionSigningConfig(env, rate.headers);
    if ("response" in signing) return signing.response;
    return projection === "snapshot"
      ? await signedPublisherSnapshotHandler({
          ctx,
          request,
          publisherId,
          config: signing.config,
          rateHeaders: rate.headers,
        })
      : projection === "query"
        ? await signedPublisherQueryHandler({
            ctx,
            request,
            publisherId,
            config: signing.config,
            rateHeaders: rate.headers,
          })
        : await signedPublisherChangesHandler({
            ctx,
            request,
            publisherId,
            config: signing.config,
            rateHeaders: rate.headers,
          });
  }

  const params = parseFeedReadParams(request, rate.headers);
  if ("response" in params) return params.response;
  const { cursor, limit } = params.args;
  if (cursor && cursor.publisherId !== publisherId) {
    return text("Publisher feed cursor does not match publisher", 400, rate.headers);
  }

  if (cursor) {
    const publication = await runQueryRef<StoredPublisherFeed | null>(
      ctx,
      publisherFeedRefs.accountFeeds.getPublisherFeedPublication,
      { publisherId },
    );
    if (!publication) return text("Publisher feed not found", 404, rate.headers);
    if (publication.sequence !== cursor.sequence) {
      return text(
        "Publisher feed cursor is stale; restart from the first page",
        409,
        mergeHeaders(rate.headers, { "Cache-Control": "no-store" }),
      );
    }
    if (cursor.offset >= publication.entries.length) {
      return text("Invalid publisher feed cursor offset", 400, rate.headers);
    }
    return json(
      pagePublisherFeed(publication, limit, cursor.offset),
      200,
      feedHeaders(rate.headers),
    );
  }

  const feed = await runMutationRef<null | { status: "capacity-exceeded" } | StoredPublisherFeed>(
    ctx,
    publisherFeedRefs.accountFeeds.refreshPublisherFeed,
    { publisherId },
  );
  if (!feed) return text("Publisher feed not found", 404, rate.headers);
  if ("status" in feed) {
    return text(
      "Publisher feed exceeds the current snapshot capacity",
      503,
      mergeHeaders(rate.headers, { "Cache-Control": "no-store" }),
    );
  }
  return json(pagePublisherFeed(feed, limit, 0), 200, feedHeaders(rate.headers));
}
