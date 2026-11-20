import { isTemplateCategoryFilterSlug } from "clawhub-schema/catalogMetadata";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { getOptionalApiTokenUserId } from "./apiTokenAuth";
import { json } from "./httpHeaders";
import { applyRateLimit } from "./httpRateLimit";

// The catalog router owns every other parameter, including sort, channel and featured.
const LIST_PARAMETERS = new Set(["family", "category", "limit", "cursor"]);
const SEARCH_PARAMETERS = new Set(["family", "category", "limit", "q"]);

/**
 * Public Template listings and ranked searches need neither the publishing nor the
 * compatibility router. Reuse its exact read queries, response projection and access
 * rules; all other parameters and credentials still belong to the canonical router.
 */
export async function readTemplateCatalogHttp(
  ctx: ActionCtx,
  request: Request,
): Promise<Response | null> {
  const { pathname, searchParams: params } = new URL(request.url);
  const isSearch = pathname === "/api/v1/packages/search";
  if (!isSearch && pathname !== "/api/v1/packages") return null;
  const allowed = isSearch ? SEARCH_PARAMETERS : LIST_PARAMETERS;
  const names = [...params.keys()];
  if (names.length !== new Set(names).size) return null;
  if (names.some((name) => !allowed.has(name))) return null;
  if (params.get("family") !== "template") return null;
  const category = params.get("category")?.trim();
  if (category !== undefined && !isTemplateCategoryFilterSlug(category)) return null;
  const query = params.get("q")?.trim();
  if (isSearch && !query) return null;
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
  const defaultLimit = isSearch ? 20 : 25;
  const limit = Math.max(
    1,
    Math.min(Number.isFinite(parsedLimit) ? parsedLimit : defaultLimit, 100),
  );
  if (query) {
    const results = await ctx.runQuery(internal.packages.searchForViewerInternal, {
      family: "template",
      query,
      category,
      limit,
      viewerUserId,
    });
    return json(
      { results: results.map(({ score, package: pkg }) => ({ score, package: pkg })) },
      200,
      rate.headers,
    );
  }
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
