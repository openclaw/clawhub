import { internal } from "./_generated/api";
import { httpAction } from "./functions";
import { json, requireAdminOrResponse, requireApiTokenUserOrResponse } from "./httpApiV1/shared";
import { applyRateLimit } from "./lib/httpRateLimit";

export const handle = httpAction(async (ctx, request) => {
  const rate = await applyRateLimit(ctx, request, request.method === "GET" ? "read" : "write");
  if (!rate.ok) return rate.response;
  const auth = await requireApiTokenUserOrResponse(ctx, request, rate.headers);
  if (!auth.ok) return auth.response;
  const admin = requireAdminOrResponse(auth.user, rate.headers);
  if (!admin.ok) return admin.response;
  const args = { actorUserId: auth.userId };
  const summary =
    request.method === "POST"
      ? await ctx.runMutation(internal.downloadAnalytics.refreshForAdminInternal, args)
      : await ctx.runQuery(internal.downloadAnalytics.getSummaryForAdminInternal, args);
  const headers = new Headers(rate.headers);
  headers.set("Cache-Control", "no-store");
  return json(summary, 200, headers);
});
