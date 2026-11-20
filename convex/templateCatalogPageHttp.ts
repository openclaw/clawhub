import { ConvexError } from "convex/values";
import { api } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { json } from "./lib/httpHeaders";
import { applyRateLimit } from "./lib/httpRateLimit";
export const get = httpAction(async (ctx, request) => {
  const rate = await applyRateLimit(ctx, request, "read");
  if (!rate.ok) return rate.response;
  const params = new URL(request.url).searchParams;
  const keys = [...params.keys()];
  if (
    new Set(keys).size !== keys.length ||
    keys.some((k) => !["q", "category", "limit", "cursor"].includes(k))
  )
    return json({ error: "Invalid Template page parameters" }, 400, rate.headers);
  try {
    const result = await ctx.runQuery(api.templateCatalogPage.get, {
      q: params.get("q") ?? undefined,
      category: params.get("category") ?? undefined,
      limit: Number(params.get("limit") ?? 20),
      cursor: params.get("cursor") ?? undefined,
    });
    return json(result, 200, rate.headers);
  } catch (error) {
    if (error instanceof ConvexError) {
      const code = error.data?.code;
      if (code === "invalid_template_page" || code === "template_page_capacity")
        return json(
          { error: error.data.message, code },
          code === "invalid_template_page" ? 400 : 422,
          rate.headers,
        );
    }
    throw error;
  }
});
