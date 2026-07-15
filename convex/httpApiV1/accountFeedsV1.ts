import { ACCOUNT_FEED_MAX_LIMIT } from "clawhub-schema";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { mergeHeaders } from "../lib/httpHeaders";
import { applyRateLimit } from "../lib/httpRateLimit";
import { getPathSegments, json, text } from "./shared";

const accountFeedRefs = internal as unknown as {
  accountFeeds: {
    getAccountDetail: unknown;
    getAccountFeed: unknown;
    getPublisherDetail: unknown;
    getPublisherFeed: unknown;
  };
};

async function runQueryRef<T>(
  ctx: Pick<ActionCtx, "runQuery">,
  ref: unknown,
  args: unknown,
): Promise<T> {
  return (await ctx.runQuery(ref as never, args as never)) as T;
}

type ParsedFeedReadParams = { response: Response } | { args: { limit?: number } };

function parseFeedReadParams(request: Request, rateHeaders: HeadersInit): ParsedFeedReadParams {
  const url = new URL(request.url);
  if (url.searchParams.has("cursor")) {
    return { response: text("Cursor pagination is not available", 400, rateHeaders) } as const;
  }
  const limitValue = url.searchParams.get("limit");
  if (limitValue === null) return { args: {} } as const;
  if (!/^[1-9]\d*$/.test(limitValue)) {
    return { response: text("Invalid feed limit", 400, rateHeaders) } as const;
  }
  const parsedLimit = Number(limitValue);
  if (!Number.isSafeInteger(parsedLimit)) {
    return { response: text("Invalid feed limit", 400, rateHeaders) } as const;
  }
  return { args: { limit: Math.min(parsedLimit, ACCOUNT_FEED_MAX_LIMIT) } } as const;
}

const PUBLIC_FEED_HEADERS = {
  "Cache-Control": "public, max-age=60, s-maxage=300",
  "X-Content-Type-Options": "nosniff",
};

function feedHeaders(rateHeaders: HeadersInit) {
  return mergeHeaders(rateHeaders, PUBLIC_FEED_HEADERS);
}

function safePathSegments(request: Request, prefix: string) {
  try {
    return getPathSegments(request, prefix);
  } catch (error) {
    if (error instanceof URIError) return null;
    throw error;
  }
}

export async function accountsGetRouterV1Handler(ctx: ActionCtx, request: Request) {
  const rate = await applyRateLimit(ctx, request, "read");
  if (!rate.ok) return rate.response;

  const segments = safePathSegments(request, "/api/v1/accounts/");
  if (!segments || (segments.length !== 1 && !(segments.length === 2 && segments[1] === "feed"))) {
    return text("Not found", 404, rate.headers);
  }

  const accountId = (segments[0] ?? "").trim();
  if (!accountId) return text("Account not found", 404, rate.headers);

  if (segments.length === 1) {
    const detail = await runQueryRef(ctx, accountFeedRefs.accountFeeds.getAccountDetail, {
      accountId,
    });
    if (!detail) return text("Account not found", 404, rate.headers);
    return json(detail, 200, rate.headers);
  }

  const params = parseFeedReadParams(request, rate.headers);
  if ("response" in params) return params.response;
  const feed = await runQueryRef(ctx, accountFeedRefs.accountFeeds.getAccountFeed, {
    accountId,
    ...params.args,
  });
  if (!feed) return text("Account feed not found", 404, rate.headers);
  return json(feed, 200, feedHeaders(rate.headers));
}

export async function publishersGetRouterV1Handler(ctx: ActionCtx, request: Request) {
  const rate = await applyRateLimit(ctx, request, "read");
  if (!rate.ok) return rate.response;

  const segments = safePathSegments(request, "/api/v1/publishers/");
  if (!segments || (segments.length !== 1 && !(segments.length === 2 && segments[1] === "feed"))) {
    return text("Not found", 404, rate.headers);
  }

  const publisherId = (segments[0] ?? "").trim();
  if (!publisherId) return text("Publisher not found", 404, rate.headers);

  if (segments.length === 1) {
    const detail = await runQueryRef(ctx, accountFeedRefs.accountFeeds.getPublisherDetail, {
      publisherId,
    });
    if (!detail) return text("Publisher not found", 404, rate.headers);
    return json(detail, 200, rate.headers);
  }

  const params = parseFeedReadParams(request, rate.headers);
  if ("response" in params) return params.response;
  const feed = await runQueryRef(ctx, accountFeedRefs.accountFeeds.getPublisherFeed, {
    publisherId,
    ...params.args,
  });
  if (!feed) return text("Publisher feed not found", 404, rate.headers);
  return json(feed, 200, feedHeaders(rate.headers));
}
