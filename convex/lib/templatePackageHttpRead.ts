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

/** Anonymous scoped Template content only; all other requests retain the canonical router. */
export async function readTemplatePackageHttp(
  ctx: ActionCtx,
  request: Request,
): Promise<Response | null> {
  const route = parsePackagePathSegments(getPathSegments(request, "/api/v1/packages/"));
  if (!route || !route.packageName.startsWith("@")) return null;
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
  // Never reinterpret authenticated or cookie-backed reads as anonymous.
  if (request.headers.has("authorization") || request.headers.has("cookie")) return null;
  try {
    if (await getOptionalApiTokenUserId(ctx, request)) return null;
    if (await ctx.auth.getUserIdentity()) return null;
  } catch {
    return null;
  }
  const rate = await applyRateLimit(ctx, request, archive ? "download" : "read");
  if (!rate.ok) return rate.response;
  const name = tryNormalizePackageName(route.packageName);
  if (!name) return text("Package not found", 404, rate.headers);
  const snapshot = await readPackageDetailForRequest(ctx, request, name);
  const pkg = snapshot?.package;
  // The request-local snapshot is reused if a plugin or skill compatibility
  // request falls back, preserving the old router without duplicate DB reads.
  if (!pkg || pkg.family !== "template") return null;
  if (metadata) {
    const tags = await resolvePackageTags(ctx, pkg);
    return json(toPackageMetadataResponse(pkg, snapshot.owner, tags), 200, rate.headers);
  }
  const selected = await readPackageVersionForRequest(ctx, request, name, rest[1]!);
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
  return await streamClawPackRelease(ctx, request, rate.headers, pkg, selected.version, null);
}
