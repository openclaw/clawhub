import { makeFunctionReference } from "convex/server";
import { httpAction } from "./functions";
import { json } from "./httpApiV1/shared";
import { applyRateLimit } from "./lib/httpRateLimit";

export const get = httpAction(async (ctx, request) => {
  const rate = await applyRateLimit(ctx, request, "read");
  if (!rate.ok) return rate.response;
  const rawLimit = new URL(request.url).searchParams.get("limit");
  const limit = rawLimit === null ? 8 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 8) {
    return json({ error: "limit must be an integer from 1 to 8" }, 400, rate.headers);
  }
  try {
    const result = await ctx.runQuery(
      makeFunctionReference<"query">("packages:templateOverviewInternal"),
      { limit },
    );
    return json(result, 200, rate.headers);
  } catch (error) {
    // Full package documents can exhaust the read-byte budget below the row cap.
    // Only this specific platform limit permits legacy pagination; auth, rate
    // limits, transport and ordinary server failures must still propagate.
    if (
      error instanceof Error &&
      /Too many bytes read in a single function execution \(limit: \d+ bytes\)/.test(error.message)
    ) {
      return json({ complete: false, featured: [], sections: [] }, 200, rate.headers);
    }
    throw error;
  }
});
