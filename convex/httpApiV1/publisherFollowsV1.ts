import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { applyRateLimit } from "../lib/httpRateLimit";
import { json, parseJsonPayload, requireApiTokenUserOrResponse, text } from "./shared";

const publisherFollowInternalRefs = internal as unknown as {
  publisherFollows: {
    followPublisherInternal: unknown;
    unfollowPublisherInternal: unknown;
    listFollowedPublishersInternal: unknown;
  };
};

function publisherIdFromUrl(request: Request) {
  const value = new URL(request.url).searchParams.get("publisherId")?.trim();
  return value ? (value as Id<"publishers">) : undefined;
}

function publisherIdFromPayload(payload: Record<string, unknown>) {
  const value = typeof payload.publisherId === "string" ? payload.publisherId.trim() : "";
  return value ? (value as Id<"publishers">) : undefined;
}

function notificationsFromPayload(payload: Record<string, unknown>) {
  const value =
    typeof payload.notifications === "string" ? payload.notifications.trim() : undefined;
  if (!value) return undefined;
  if (value === "all" || value === "none") return value;
  throw new Error('notifications must be "all" or "none"');
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseListParams(url: URL, headers: HeadersInit) {
  const limitValue = url.searchParams.get("limit");
  if (limitValue !== null && !/^[1-9]\d*$/.test(limitValue)) {
    return { response: text("Invalid follow list limit", 400, headers) } as const;
  }
  const limit = limitValue === null ? undefined : Number(limitValue);
  if (limit !== undefined && !Number.isSafeInteger(limit)) {
    return { response: text("Invalid follow list limit", 400, headers) } as const;
  }

  const cursor = url.searchParams.get("cursor");
  if (url.searchParams.has("cursor") && !cursor) {
    return { response: text("Invalid cursor format", 400, headers) } as const;
  }
  const query = url.searchParams.get("q")?.trim();
  if (query && query.length > 200) {
    return { response: text("Follow list query is too long", 400, headers) } as const;
  }

  return {
    args: {
      ...(cursor ? { cursor } : {}),
      ...(limit === undefined ? {} : { limit }),
      ...(query ? { query } : {}),
    },
  } as const;
}

export async function publisherFollowsGetV1Handler(ctx: ActionCtx, request: Request) {
  const rate = await applyRateLimit(ctx, request, "read");
  if (!rate.ok) return rate.response;

  const auth = await requireApiTokenUserOrResponse(ctx, request, rate.headers);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const params = parseListParams(url, rate.headers);
  if ("response" in params) return params.response;
  try {
    const result = await ctx.runQuery(
      publisherFollowInternalRefs.publisherFollows.listFollowedPublishersInternal as never,
      { followerUserId: auth.userId, ...params.args } as never,
    );
    return json(result, 200, rate.headers);
  } catch (error) {
    if (error instanceof Error && error.message.includes("Invalid cursor format")) {
      return text("Invalid cursor format", 400, rate.headers);
    }
    throw error;
  }
}

export async function publisherFollowsPostV1Handler(ctx: ActionCtx, request: Request) {
  const rate = await applyRateLimit(ctx, request, "write");
  if (!rate.ok) return rate.response;

  const auth = await requireApiTokenUserOrResponse(ctx, request, rate.headers);
  if (!auth.ok) return auth.response;

  const payloadResult = await parseJsonPayload(request, rate.headers);
  if (!payloadResult.ok) return payloadResult.response;
  const payload = payloadResult.payload;
  if (!isJsonObject(payload)) return text("JSON body must be an object", 400, rate.headers);
  const publisherId = publisherIdFromPayload(payload);
  if (!publisherId) return text("Missing publisherId", 400, rate.headers);

  try {
    const notifications = notificationsFromPayload(payload);
    const result = await ctx.runMutation(
      publisherFollowInternalRefs.publisherFollows.followPublisherInternal as never,
      {
        followerUserId: auth.userId,
        publisherId,
        ...(notifications ? { notifications } : {}),
      } as never,
    );
    return json(result, 200, rate.headers);
  } catch (error) {
    return text(
      errorMessage(error, "Unable to follow publisher."),
      errorStatus(error),
      rate.headers,
    );
  }
}

export async function publisherFollowsDeleteV1Handler(ctx: ActionCtx, request: Request) {
  const rate = await applyRateLimit(ctx, request, "write");
  if (!rate.ok) return rate.response;

  const auth = await requireApiTokenUserOrResponse(ctx, request, rate.headers);
  if (!auth.ok) return auth.response;

  const publisherId = publisherIdFromUrl(request);
  if (!publisherId) return text("Missing publisherId", 400, rate.headers);

  try {
    const result = await ctx.runMutation(
      publisherFollowInternalRefs.publisherFollows.unfollowPublisherInternal as never,
      { followerUserId: auth.userId, publisherId } as never,
    );
    return json(result, 200, rate.headers);
  } catch (error) {
    return text(
      errorMessage(error, "Unable to unfollow publisher."),
      errorStatus(error),
      rate.headers,
    );
  }
}

function errorStatus(error: unknown) {
  const message = errorMessage(error, "");
  if (/not found/i.test(message)) return 404;
  if (/unauthorized/i.test(message)) return 401;
  return 400;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message.trim() : fallback;
}
