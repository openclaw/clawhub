import { parseArk } from "clawhub-schema";
import { ConvexError } from "convex/values";
import {
  SearchReportRequestSchema,
  type SearchReportRequest,
} from "../../packages/clawhub/src/schema/searchReports";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { normalizeReportRequest } from "../lib/searchReportContract";
import { json, requireApiTokenUserOrResponse, requireModeratorOrResponse, text } from "./shared";

export async function searchReportsV1Handler(ctx: ActionCtx, request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  const auth = await requireApiTokenUserOrResponse(ctx, request, headers);
  if (!auth.ok) return auth.response;
  const staff = requireModeratorOrResponse(auth.user, headers);
  if (!staff.ok) return staff.response;
  if (request.method === "POST") {
    let parsed: SearchReportRequest;
    try {
      parsed = parseArk(SearchReportRequestSchema, await request.json(), "Report request");
    } catch {
      return text("Invalid report request", 400, headers);
    }
    try {
      normalizeReportRequest(parsed, Date.now());
    } catch {
      return text("Invalid report filters", 400, headers);
    }
    try {
      return json(
        await ctx.runMutation(internal.searchReports.startInternal, parsed),
        202,
        headers,
      );
    } catch (error) {
      if (error instanceof ConvexError && error.data === "report_not_found")
        return text("Report expired or no longer available; start a new report", 404, headers);
      if (error instanceof ConvexError && error.data === "refresh_request_mismatch")
        return text("Refresh must use the original report filters", 409, headers);
      throw error;
    }
  }
  const reportId = new URL(request.url).pathname.slice("/api/v1/search-insights/reports/".length);
  if (!reportId || reportId.includes("/")) return text("Invalid report ID", 400, headers);
  try {
    return json(
      await ctx.runAction(internal.searchReports.getInternal, { reportId }),
      200,
      headers,
    );
  } catch (error) {
    if (!(error instanceof ConvexError) || error.data !== "report_not_found") throw error;
    return text("Report not found or unavailable; start a new report", 404, headers);
  }
}
