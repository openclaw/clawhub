import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { applyRateLimit } from "../lib/httpRateLimit";
import {
  json,
  parseJsonPayload,
  requireApiTokenUserOrResponse,
  text,
  toOptionalNumber,
} from "./shared";

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

export async function publisherFollowsGetV1Handler(ctx: ActionCtx, request: Request) {
  const rate = await applyRateLimit(ctx, request, "read");
  if (!rate.ok) return rate.response;

  const auth = await requireApiTokenUserOrResponse(ctx, request, rate.headers);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const limit = toOptionalNumber(url.searchParams.get("limit"));
  const result = await ctx.runQuery(
    publisherFollowInternalRefs.publisherFollows.listFollowedPublishersInternal as never,
    { followerUserId: auth.userId, ...(limit ? { limit } : {}) } as never,
  );
  return json(result, 200, rate.headers);
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
