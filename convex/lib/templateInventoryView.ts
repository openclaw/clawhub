import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { json, text } from "./httpHeaders";
import { toPackageMetadataResponse } from "./packageReadProjection";
import { toPackageReleaseSecurityResponse } from "./packageReleaseSecurityResponse";
import { templateDisplayBinding } from "./templateDisplaySnapshot";

export async function templateInventoryViewResponse(
  ctx: ActionCtx,
  request: Request,
  name: string,
  headers: HeadersInit,
) {
  const params = new URL(request.url).searchParams;
  const versions = params.getAll("version");
  if (
    versions.length > 1 ||
    (versions[0] !== undefined && (!versions[0] || versions[0].length > 256))
  )
    return text("Invalid version", 400, headers);
  const selected = await ctx.runQuery(internal.packages.getPublicTemplateInventoryInternal, {
    name,
    ...(versions[0] === undefined ? {} : { version: versions[0] }),
  });
  if (!selected) return text("Template not found", 404, headers);
  if (selected.blocked) return text("Release unavailable", 403, headers);
  const { release, package: pkg, owner, tags } = selected;
  const binding = templateDisplayBinding(pkg.name, release);
  if (!binding) return text("Template inventory unavailable", 422, headers);
  if (selected.projection === "invalid")
    return text("Template inventory integrity mismatch", 422, headers);
  const metadata = toPackageMetadataResponse(pkg, owner, tags);
  const allowMetadata =
    selected.capacityMetadataEligible && params.get("inventoryFallback") === "metadata";
  function capacityResponse() {
    // Only a website opening latest may use ordinary metadata in place of the optional
    // inventory. The version-one summary comes from trusted publication, not the request.
    if (allowMetadata) return json(metadata, 200, headers);
    return text("Template inventory too large", 413, headers);
  }
  let data = selected.projection;
  if (!data) {
    // Read-only compatibility for old and unsupported releases. Never populate a row from a GET.
    const { readVerifiedTemplateDisplayArchive } = await import("./templateDisplayArchive");
    const parsed = await readVerifiedTemplateDisplayArchive(ctx.storage, binding);
    if (!parsed.ok)
      return parsed.status === 413
        ? capacityResponse()
        : text(parsed.message, parsed.status, headers);
    data = parsed.data;
  }
  const { version, sha256, npmIntegrity, npmShasum } = binding;
  const artifact = {
    kind: "npm-pack" as const,
    sha256,
    npmIntegrity,
    ...(npmShasum === undefined ? {} : { npmShasum }),
  };
  const security = toPackageReleaseSecurityResponse({
    request,
    pkg,
    release,
    ownerHandle: owner?.handle,
  });
  const payload = {
    ...metadata,
    templateInventory: {
      schemaVersion: 1,
      packageName: pkg.name,
      version,
      artifact,
      icon: release.icon ?? null,
      ...data,
      security,
    },
  };
  if (new TextEncoder().encode(JSON.stringify(payload)).length > 512 * 1024)
    return capacityResponse();
  return json(payload, 200, headers);
}
