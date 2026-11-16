import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { getOptionalApiTokenUserId } from "./apiTokenAuth";
import { json, text } from "./httpHeaders";
import { getPathSegments, parsePackagePathSegments } from "./httpPathSegments";
import { applyRateLimit } from "./httpRateLimit";
import { streamClawPackRelease } from "./packageArchiveHttp";
import {
  readPackageDetailForRequest,
  readPackageVersionForRequest,
  resolvePackageTags,
} from "./packageHttpRead";
import { tryNormalizePackageName } from "./packageReadName";
import { toPackageMetadataResponse, toPackageVersionResponse } from "./packageReadProjection";
import { toPublicPackageFamily } from "./templateStorage";

// Unscoped first segments that name router endpoints rather than packages. A word missing
// here is still safe: no package has that name, so its lookup falls back to the router.
const UNSCOPED_ROUTER_SEGMENTS = new Set([
  "-",
  "appeals",
  "migrations",
  "moderation",
  "publish",
  "reports",
  "search",
  "validation-report",
]);

/**
 * Template content for anonymous and API-token readers; every other request, family and
 * credential keeps the canonical router.
 */
export async function readTemplatePackageHttp(
  ctx: ActionCtx,
  request: Request,
): Promise<Response | null> {
  const route = parsePackagePathSegments(getPathSegments(request, "/api/v1/packages/"));
  if (!route) return null;
  if (!route.packageName.startsWith("@") && UNSCOPED_ROUTER_SEGMENTS.has(route.packageName)) {
    return null;
  }
  const rest = route.rest;
  const metadata = rest.length === 0;
  const version = rest.length === 2 && rest[0] === "versions" && Boolean(rest[1]);
  const archive =
    rest.length === 4 &&
    rest[0] === "versions" &&
    Boolean(rest[1]) &&
    rest[2] === "artifact" &&
    rest[3] === "download";
  if (!metadata && !version && !archive) return null;
  // Never reinterpret cookie-backed reads as anonymous.
  if (request.headers.has("cookie")) return null;
  let viewerUserId: Id<"users"> | undefined;
  try {
    const tokenUserId = await getOptionalApiTokenUserId(ctx, request);
    if (tokenUserId) {
      // The queries below apply this reader's visibility exactly as the router would.
      viewerUserId = tokenUserId;
    } else {
      // A credential that is not a current API token keeps the router's own outcome.
      if (request.headers.has("authorization")) return null;
      if (await ctx.auth.getUserIdentity()) return null;
    }
  } catch {
    return null;
  }
  const rate = await applyRateLimit(ctx, request, archive ? "download" : "read");
  if (!rate.ok) return rate.response;
  const name = tryNormalizePackageName(route.packageName);
  if (!name) return text("Package not found", 404, rate.headers);
  const snapshot = await readPackageDetailForRequest(ctx, request, name, viewerUserId);
  const pkg = snapshot?.package;
  // The request-local snapshot is reused if a plugin or skill compatibility
  // request falls back, preserving the old router without duplicate DB reads.
  if (!pkg || pkg.family !== "template") return null;
  if (metadata) {
    const tags = await resolvePackageTags(ctx, pkg, viewerUserId);
    return json(toPackageMetadataResponse(pkg, snapshot.owner, tags), 200, rate.headers);
  }
  const selected = await readPackageVersionForRequest(ctx, request, name, rest[1]!, viewerUserId);
  if (!selected) return text("Version not found", 404, rate.headers);
  if (version) {
    return json(
      {
        package: {
          name: selected.package.name,
          displayName: selected.package.displayName,
          family: toPublicPackageFamily(selected.package.family),
        },
        version: toPackageVersionResponse(selected.version, selected.package.name),
      },
      200,
      rate.headers,
    );
  }
  // Historical ZIP redirect behavior remains in the unchanged compatibility router.
  if (selected.version.artifactKind !== "npm-pack") return null;
  return await streamClawPackRelease(
    ctx,
    request,
    rate.headers,
    pkg,
    selected.version,
    viewerUserId ?? null,
  );
}
