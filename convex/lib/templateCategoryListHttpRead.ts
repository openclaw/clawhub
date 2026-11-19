import { isTemplateCategorySlug } from "clawhub-schema/catalogMetadata";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { getOptionalApiTokenUserId } from "./apiTokenAuth";
import { json } from "./httpHeaders";
import { applyRateLimit } from "./httpRateLimit";

// The catalog router owns every other parameter, including sort, channel and featured.
const NARROW_PARAMETERS = new Set(["family", "category", "limit", "cursor"]);

/**
 * One Template category for anonymous and API-token readers, as OpenClaw's Templates
 * page requests it. Reads the catalog router's own query with the router's arguments;
 * every other request shape and credential keeps the canonical router.
 */
export async function readTemplateCategoryListHttp(
  ctx: ActionCtx,
  request: Request,
): Promise<Response | null> {
  const params = new URL(request.url).searchParams;
  const names = [...params.keys()];
  if (names.length !== new Set(names).size) return null;
  if (names.some((name) => !NARROW_PARAMETERS.has(name))) return null;
  if (params.get("family") !== "template") return null;
  const category = params.get("category")?.trim();
  // The router answers a missing or unknown category, including its 400.
  if (!category || (category !== "other" && !isTemplateCategorySlug(category))) return null;
  // Never reinterpret cookie-backed reads as anonymous.
  if (request.headers.has("cookie")) return null;
  let viewerUserId: Id<"users"> | undefined;
  try {
    const tokenUserId = await getOptionalApiTokenUserId(ctx, request);
    if (tokenUserId) {
      // The query below applies this reader's visibility exactly as the router would.
      viewerUserId = tokenUserId;
    } else {
      // A credential that is not a current API token keeps the router's own outcome.
      if (request.headers.has("authorization")) return null;
      if (await ctx.auth.getUserIdentity()) return null;
    }
  } catch {
    return null;
  }
  const rate = await applyRateLimit(ctx, request, "read");
  if (!rate.ok) return rate.response;
  const rawLimit = params.get("limit");
  const parsedLimit = rawLimit ? Number.parseInt(rawLimit, 10) : Number.NaN;
  const limit = Math.max(1, Math.min(Number.isFinite(parsedLimit) ? parsedLimit : 25, 100));
  const result = await ctx.runQuery(internal.packages.listPageForViewerInternal, {
    family: "template",
    category,
    viewerUserId,
    paginationOpts: { cursor: params.get("cursor"), numItems: limit },
  });
  return json(
    { items: result.page, nextCursor: result.isDone ? null : result.continueCursor },
    200,
    rate.headers,
  );
}
