import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { applyRateLimit } from "../lib/httpRateLimit";
import { getPathSegments, json, requireApiTokenUserOrResponse, text } from "./shared";

const internalRefs = internal as unknown as {
  packageTransfers: {
    listIncomingInternal: unknown;
    listOutgoingInternal: unknown;
  };
};

async function runQueryRef<T>(ctx: ActionCtx, ref: unknown, args: unknown): Promise<T> {
  return (await ctx.runQuery(ref as never, args as never)) as T;
}

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

  const [skillTransfers, packageTransfers] = await Promise.all([
    direction === "incoming"
      ? ctx.runQuery(internal.skillTransfers.listIncomingInternal, { userId: auth.userId })
      : ctx.runQuery(internal.skillTransfers.listOutgoingInternal, { userId: auth.userId }),
    direction === "incoming"
      ? runQueryRef<unknown[]>(ctx, internalRefs.packageTransfers.listIncomingInternal, { userId: auth.userId })
      : runQueryRef<unknown[]>(ctx, internalRefs.packageTransfers.listOutgoingInternal, { userId: auth.userId }),
  ]);

  const transfers = [...skillTransfers, ...packageTransfers];
  return json({ transfers }, 200, rate.headers);
}
