import { PUBLISHER_FEED_MAX_LIMIT, PUBLISHER_FEED_SCHEMA_VERSION } from "clawhub-schema";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { mergeHeaders } from "../lib/httpHeaders";
import { applyRateLimit } from "../lib/httpRateLimit";
import { publisherSocialGraphGetV1Response } from "./publisherFollowsV1";
import { getPathSegments, json, text } from "./shared";

const publisherFeedRefs = internal as unknown as {
  accountFeeds: {
    getPublisherDetail: unknown;
    getPublisherFeedPublication: unknown;
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

export async function publishersGetRouterV1Handler(ctx: ActionCtx, request: Request) {
  const rate = await applyRateLimit(ctx, request, "read");
  if (!rate.ok) return rate.response;

  const segments = safePathSegments(request, "/api/v1/publishers/");
  if (
    !segments ||
    (segments.length !== 1 &&
      !(segments.length === 2 && ["feed", "followers", "following"].includes(segments[1] ?? "")))
  ) {
    return text("Not found", 404, rate.headers);
  }

  const publisherId = (segments[0] ?? "").trim();
  if (!publisherId) return text("Publisher not found", 404, rate.headers);

  if (segments[1] === "followers" || segments[1] === "following") {
    return await publisherSocialGraphGetV1Response(ctx, request, {
      publisherId,
      direction: segments[1],
      headers: rate.headers,
    });
  }

  if (segments.length === 1) {
    const detail = await runQueryRef(ctx, publisherFeedRefs.accountFeeds.getPublisherDetail, {
      publisherId,
    });
    if (!detail) return text("Publisher not found", 404, rate.headers);
    return json(detail, 200, rate.headers);
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
