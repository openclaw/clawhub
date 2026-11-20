import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { hasNoPublishedPackageVersions } from "./packageReleaseVisibility";
import {
  MAX_TEMPLATE_DISPLAY_ARCHIVE_BYTES,
  MAX_TEMPLATE_DISPLAY_DATA_BYTES,
  type TemplateDisplayBinding,
  type TemplateDisplayData,
} from "./templateDisplayData";

type ReleaseFields = Pick<
  Doc<"packageReleases">,
  | "version"
  | "artifactKind"
  | "clawpackStorageId"
  | "clawpackSha256"
  | "clawpackSize"
  | "npmIntegrity"
  | "npmShasum"
>;
export function templateDisplayBinding(
  name: string,
  r: ReleaseFields,
): TemplateDisplayBinding | null {
  if (
    r.artifactKind !== "npm-pack" ||
    !r.clawpackStorageId ||
    !r.clawpackSha256 ||
    !r.clawpackSize ||
    !r.npmIntegrity
  )
    return null;
  return {
    packageName: name,
    version: r.version,
    storageId: r.clawpackStorageId,
    sha256: r.clawpackSha256,
    size: r.clawpackSize,
    npmIntegrity: r.npmIntegrity,
    ...(r.npmShasum === undefined ? {} : { npmShasum: r.npmShasum }),
  };
}
export function sameTemplateDisplayBinding(
  a: TemplateDisplayBinding | null,
  b: TemplateDisplayBinding,
) {
  return (
    !!a &&
    a.packageName === b.packageName &&
    a.version === b.version &&
    a.storageId === b.storageId &&
    a.sha256 === b.sha256 &&
    a.size === b.size &&
    a.npmIntegrity === b.npmIntegrity &&
    a.npmShasum === b.npmShasum
  );
}
/** Only trusted server-produced bytes arrive here. Bind once, inside the release mutation or with a second, exact comparison after archive I/O. */
export async function writeTemplateDisplaySnapshot(
  ctx: Pick<MutationCtx, "db">,
  releaseId: Id<"packageReleases">,
  binding: TemplateDisplayBinding,
  data: TemplateDisplayData,
) {
  const release = await ctx.db.get(releaseId);
  if (!release) return false;
  const pkg = await ctx.db.get(release.packageId);
  // A reserved, not-yet-published shell retains its old family until moderation completes.
  // Identify the first staged Template by the release's trusted metadata, never by caller input.
  const staged: unknown = release.pendingPublication;
  const firstPendingTemplate =
    pkg &&
    hasNoPublishedPackageVersions(pkg) &&
    release.publicationStatus === "pending" &&
    staged !== null &&
    typeof staged === "object" &&
    "family" in staged &&
    staged.family === "claw";
  if (
    !pkg ||
    (pkg.family !== "claw" && !firstPendingTemplate) ||
    !sameTemplateDisplayBinding(templateDisplayBinding(pkg.name, release), binding) ||
    binding.size > MAX_TEMPLATE_DISPLAY_ARCHIVE_BYTES ||
    new TextEncoder().encode(JSON.stringify(data)).length > MAX_TEMPLATE_DISPLAY_DATA_BYTES
  )
    return false;
  const prior = await ctx.db
    .query("templateDisplaySnapshots")
    .withIndex("by_release", (q) => q.eq("releaseId", releaseId))
    .unique();
  if (prior)
    return prior.packageId === pkg._id && sameTemplateDisplayBinding(prior.binding, binding);
  await ctx.db.insert("templateDisplaySnapshots", {
    schemaVersion: 1,
    packageId: pkg._id,
    releaseId,
    binding,
    data,
  });
  return true;
}
