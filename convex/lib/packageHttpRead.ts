import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import type { PublicPackageDocLike, ReleaseLike } from "./packageReadProjection";
import type { PublicPublisher } from "./public";

export type PackageHttpDetail = {
  package: PublicPackageDocLike | null;
  latestRelease: ReleaseLike | null;
  owner: PublicPublisher | null;
};
export type PackageHttpVersion = { package: PublicPackageDocLike; version: ReleaseLike };
type Reads = {
  details: Map<string, Promise<PackageHttpDetail | null>>;
  versions: Map<string, Promise<PackageHttpVersion | null>>;
};
// These promises live only inside one action context and Request. Compatibility
// fallback joins its initial lookup; nothing is cached across HTTP requests.
const contexts = new WeakMap<ActionCtx, WeakMap<Request, Reads>>();
function reads(ctx: ActionCtx, request: Request): Reads {
  let requests = contexts.get(ctx);
  if (!requests) {
    requests = new WeakMap();
    contexts.set(ctx, requests);
  }
  let value = requests.get(request);
  if (!value) {
    value = { details: new Map(), versions: new Map() };
    requests.set(request, value);
  }
  return value;
}

export function readPackageDetailForRequest(
  ctx: ActionCtx,
  request: Request,
  name: string,
  viewerUserId?: Id<"users">,
): Promise<PackageHttpDetail | null> {
  const cache = reads(ctx, request).details;
  const key = JSON.stringify([name.trim().toLowerCase(), viewerUserId ?? null]);
  let result = cache.get(key);
  if (!result) {
    result = ctx.runQuery(internal.packages.getByNameForViewerInternal, {
      name,
      viewerUserId,
    }) as Promise<PackageHttpDetail | null>;
    cache.set(key, result);
  }
  return result;
}

export function readPackageVersionForRequest(
  ctx: ActionCtx,
  request: Request,
  name: string,
  version: string,
  viewerUserId?: Id<"users">,
): Promise<PackageHttpVersion | null> {
  const cache = reads(ctx, request).versions;
  const key = JSON.stringify([name.trim().toLowerCase(), version, viewerUserId ?? null]);
  let result = cache.get(key);
  if (!result) {
    result = ctx.runQuery(internal.packages.getVersionByNameForViewerInternal, {
      name,
      version,
      viewerUserId,
    }) as Promise<PackageHttpVersion | null>;
    cache.set(key, result);
  }
  return result;
}

export async function resolvePackageTags(
  ctx: ActionCtx,
  pkg: Pick<PublicPackageDocLike, "_id" | "name">,
  viewerUserId?: Id<"users">,
): Promise<Record<string, string>> {
  return await ctx.runQuery(internal.packages.getTagsForViewerInternal, {
    name: pkg.name,
    packageId: pkg._id,
    viewerUserId,
  });
}
