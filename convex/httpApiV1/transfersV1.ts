import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { applyRateLimit } from "../lib/httpRateLimit";
import { getPathSegments, json, requireApiTokenUserOrResponse, text } from "./shared";

export async function transfersGetRouterV1Handler(ctx: ActionCtx, request: Request) {
  const rate = await applyRateLimit(ctx, request, "read");
  if (!rate.ok) return rate.response;

  const segments = getPathSegments(request, "/api/v1/transfers/");
  const direction = segments[0]?.trim().toLowerCase() ?? "";
  if (segments.length !== 1 || (direction !== "incoming" && direction !== "outgoing")) {
    return text("Not found", 404, rate.headers);
  }

  const auth = await requireApiTokenUserOrResponse(ctx, request, rate.headers);
  if (!auth.ok) return auth.response;

  const transfers =
    direction === "incoming"
      ? await ctx.runQuery(internal.skillTransfers.listIncomingInternal, { userId: auth.userId })
      : await ctx.runQuery(internal.skillTransfers.listOutgoingInternal, { userId: auth.userId });
  return json({ transfers }, 200, rate.headers);
}
