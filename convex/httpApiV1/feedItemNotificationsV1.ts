import { CATALOG_FEED_ID, CATALOG_SKILLS_FEED_ID } from "clawhub-schema";
import { ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { applyRateLimit } from "../lib/httpRateLimit";
import {
  formatUserFacingErrorMessage,
  json,
  parseJsonPayload,
  requireApiTokenUserOrResponse,
  text,
} from "./shared";

const refs = internal as unknown as {
  feedItemNotifications: {
    watchItemInternal: unknown;
    unwatchItemInternal: unknown;
    listWatchesInternal: unknown;
    listInboxInternal: unknown;
    acknowledgeInboxItemInternal: unknown;
  };
};

type WatchIdentity = {
  feedId: string;
  representation: "catalog" | "publisher";
  itemKind: "plugin" | "skill";
  itemId: string;
};

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseWatchIdentity(value: Record<string, unknown>): WatchIdentity | null {
  const feedId = typeof value.feedId === "string" ? value.feedId.trim() : "";
  const itemId = typeof value.itemId === "string" ? value.itemId.trim() : "";
  const representation = value.representation;
  const itemKind = value.itemKind;
  if (
    !feedId ||
    !itemId ||
    (representation !== "catalog" && representation !== "publisher") ||
    (itemKind !== "plugin" && itemKind !== "skill")
  ) {
    return null;
  }
  return { feedId, representation, itemKind, itemId };
}

function watchIdentityFromUrl(url: URL) {
  return parseWatchIdentity({
    feedId: url.searchParams.get("feedId"),
    representation: url.searchParams.get("representation"),
    itemKind: url.searchParams.get("itemKind"),
    itemId: url.searchParams.get("itemId"),
  });
}

type ListParams = { cursor?: string; limit?: number };

function parseListParams(
  url: URL,
  headers: HeadersInit,
): { args: ListParams } | { response: Response } {
  const cursor = url.searchParams.get("cursor");
  if (url.searchParams.has("cursor") && !cursor) {
    return { response: text("Invalid cursor format", 400, headers) };
  }
  const limitValue = url.searchParams.get("limit");
  if (limitValue !== null && !/^[1-9]\d*$/u.test(limitValue)) {
    return { response: text("Invalid list limit", 400, headers) };
  }
  const limit = limitValue === null ? undefined : Number(limitValue);
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit > 100)) {
    return { response: text("Invalid list limit", 400, headers) };
  }
  return { args: { ...(cursor ? { cursor } : {}), ...(limit === undefined ? {} : { limit }) } };
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message.trim() : fallback;
}

function mutationErrorResponse(error: unknown, fallback: string, headers: HeadersInit) {
  const rawMessage = error instanceof Error ? error.message : "";
  const isUserFacing =
    error instanceof ConvexError || /(?:Uncaught\s+)?ConvexError:/iu.test(rawMessage);
  if (!isUserFacing) return text("Internal Server Error", 500, headers);

  const message = formatUserFacingErrorMessage(error, fallback);
  return text(message, /not found/iu.test(message) ? 404 : 400, headers);
}

export async function feedItemWatchesGetV1Handler(ctx: ActionCtx, request: Request) {
  const rate = await applyRateLimit(ctx, request, "read");
  if (!rate.ok) return rate.response;
  const auth = await requireApiTokenUserOrResponse(ctx, request, rate.headers);
  if (!auth.ok) return auth.response;
  const params = parseListParams(new URL(request.url), rate.headers);
  if ("response" in params) return params.response;
  try {
    const result = await ctx.runQuery(
      refs.feedItemNotifications.listWatchesInternal as never,
      { userId: auth.userId, ...params.args } as never,
    );
    return json(result, 200, rate.headers);
  } catch (error) {
    if (/cursor/i.test(errorMessage(error, ""))) {
      return text("Invalid cursor format", 400, rate.headers);
    }
    throw error;
  }
}

export async function feedItemWatchesPostV1Handler(ctx: ActionCtx, request: Request) {
  const rate = await applyRateLimit(ctx, request, "write");
  if (!rate.ok) return rate.response;
  const auth = await requireApiTokenUserOrResponse(ctx, request, rate.headers);
  if (!auth.ok) return auth.response;
  const payload = await parseJsonPayload(request, rate.headers);
  if (!payload.ok) return payload.response;
  if (!isObject(payload.payload)) return text("JSON body must be an object", 400, rate.headers);
  if (!hasExactKeys(payload.payload, ["feedId", "representation", "itemKind", "itemId"])) {
    return text("Invalid feed item identity", 400, rate.headers);
  }
  const identity = parseWatchIdentity(payload.payload);
  if (!identity) return text("Invalid feed item identity", 400, rate.headers);
  if (identity.representation !== "catalog") {
    return text("Only catalog item watches are currently available", 400, rate.headers);
  }
  const supported =
    (identity.itemKind === "plugin" && identity.feedId === CATALOG_FEED_ID) ||
    (identity.itemKind === "skill" && identity.feedId === CATALOG_SKILLS_FEED_ID);
  if (!supported) {
    return text(
      "Only official ClawHub plugin and skill catalog watches are available",
      400,
      rate.headers,
    );
  }
  try {
    const result = await ctx.runMutation(
      refs.feedItemNotifications.watchItemInternal as never,
      { userId: auth.userId, ...identity, source: "explicit" } as never,
    );
    return json(result, 200, rate.headers);
  } catch (error) {
    return mutationErrorResponse(error, "Unable to watch feed item.", rate.headers);
  }
}

export async function feedItemWatchesDeleteV1Handler(ctx: ActionCtx, request: Request) {
  const rate = await applyRateLimit(ctx, request, "write");
  if (!rate.ok) return rate.response;
  const auth = await requireApiTokenUserOrResponse(ctx, request, rate.headers);
  if (!auth.ok) return auth.response;
  const identity = watchIdentityFromUrl(new URL(request.url));
  if (!identity) return text("Invalid feed item identity", 400, rate.headers);
  try {
    const result = await ctx.runMutation(
      refs.feedItemNotifications.unwatchItemInternal as never,
      { userId: auth.userId, ...identity } as never,
    );
    return json(result, 200, rate.headers);
  } catch (error) {
    return mutationErrorResponse(error, "Unable to unwatch feed item.", rate.headers);
  }
}

export async function feedNotificationsGetV1Handler(ctx: ActionCtx, request: Request) {
  const rate = await applyRateLimit(ctx, request, "read");
  if (!rate.ok) return rate.response;
  const auth = await requireApiTokenUserOrResponse(ctx, request, rate.headers);
  if (!auth.ok) return auth.response;
  const params = parseListParams(new URL(request.url), rate.headers);
  if ("response" in params) return params.response;
  try {
    const result = await ctx.runQuery(
      refs.feedItemNotifications.listInboxInternal as never,
      { userId: auth.userId, ...params.args } as never,
    );
    return json(result, 200, rate.headers);
  } catch (error) {
    if (/cursor/i.test(errorMessage(error, ""))) {
      return text("Invalid cursor format", 400, rate.headers);
    }
    throw error;
  }
}

export async function feedNotificationsPatchV1Handler(ctx: ActionCtx, request: Request) {
  const rate = await applyRateLimit(ctx, request, "write");
  if (!rate.ok) return rate.response;
  const auth = await requireApiTokenUserOrResponse(ctx, request, rate.headers);
  if (!auth.ok) return auth.response;
  const payload = await parseJsonPayload(request, rate.headers);
  if (!payload.ok) return payload.response;
  if (!isObject(payload.payload)) return text("JSON body must be an object", 400, rate.headers);
  if (!hasExactKeys(payload.payload, ["notificationId", "action"])) {
    return text("Invalid notification acknowledgement", 400, rate.headers);
  }
  const notificationId =
    typeof payload.payload.notificationId === "string" ? payload.payload.notificationId.trim() : "";
  const action = payload.payload.action;
  if (!notificationId || (action !== "read" && action !== "dismiss")) {
    return text("Invalid notification acknowledgement", 400, rate.headers);
  }
  try {
    const result = await ctx.runMutation(
      refs.feedItemNotifications.acknowledgeInboxItemInternal as never,
      {
        userId: auth.userId,
        notificationId,
        action,
      } as never,
    );
    return json(result, 200, rate.headers);
  } catch (error) {
    return mutationErrorResponse(error, "Unable to acknowledge notification.", rate.headers);
  }
}
