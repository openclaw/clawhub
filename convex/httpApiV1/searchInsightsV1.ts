import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import type { SearchInsightArgs } from "../lib/searchInsights";
import { json, requireApiTokenUserOrResponse, requireModeratorOrResponse, text } from "./shared";

export async function searchInsightsV1Handler(ctx: ActionCtx, request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  const auth = await requireApiTokenUserOrResponse(ctx, request, headers);
  if (!auth.ok) return auth.response;
  const staff = requireModeratorOrResponse(auth.user, headers);
  if (!staff.ok) return staff.response;
  const params = new URL(request.url).searchParams;
  const args: SearchInsightArgs = {};
  const source = params.get("source");
  if (source !== null) {
    if (source !== "clawhub-web" && source !== "openclaw-control-ui")
      return text("Invalid source", 400, headers);
    args.source = source;
  }
  const intent = params.get("intentKind");
  if (intent !== null) {
    if (intent !== "company_product" && intent !== "generic_capability" && intent !== "ambiguous")
      return text("Invalid intentKind", 400, headers);
    args.intentKind = intent;
  }
  for (const key of ["endDay", "limit", "window"] as const) {
    const value = params.get(key);
    if (value === null) continue;
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
      return text(`Invalid ${key}`, 400, headers);
    const number = Number(value);
    if (key === "window") {
      if (number !== 7 && number !== 30) return text("window must be 7 or 30", 400, headers);
      args.window = number;
    } else args[key] = number;
  }
  const officialGap = params.get("officialGap");
  if (officialGap !== null) {
    if (officialGap !== "true" && officialGap !== "false")
      return text("Invalid officialGap", 400, headers);
    args.officialGap = officialGap === "true";
  }
  if (args.limit !== undefined && (args.limit < 1 || args.limit > 100))
    return text("limit must be between 1 and 100", 400, headers);
  if (args.endDay !== undefined && args.endDay % 86_400_000 !== 0)
    return text("endDay must be a UTC day boundary", 400, headers);
  return json(await ctx.runAction(internal.searchInsights.getInternal, args), 200, headers);
}
