import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { contentDispositionAttachment } from "./contentDisposition";
import { buildDownloadMetricArgs, getDownloadIdentity } from "./downloadIdentity";
import { areDownloadMetricsPaused } from "./downloadMetricsSwitch";
import { corsHeaders, mergeHeaders, text } from "./httpHeaders";
import type { PublicPackageDocLike, ReleaseLike } from "./packageReadProjection";
import { getPackageDownloadSecurityBlock } from "./packageSecurity";

export async function streamClawPackRelease(
  ctx: ActionCtx,
  request: Request,
  rateHeaders: HeadersInit,
  pkg: PublicPackageDocLike,
  release: ReleaseLike,
  viewerUserId: Id<"users"> | null,
  statKind: "download" | "install" = "download",
) {
  const securityBlock = getPackageDownloadSecurityBlock(release);
  if (securityBlock) return text(securityBlock.message, securityBlock.status, rateHeaders);
  if (release.artifactKind !== "npm-pack" || !release.clawpackStorageId) {
    return text("ClawPack artifact not found", 404, rateHeaders);
  }
  const blob = await ctx.storage.get(release.clawpackStorageId);
  if (!blob) return text("ClawPack artifact not found", 404, rateHeaders);
  try {
    const identity = getDownloadIdentity(request, viewerUserId ? String(viewerUserId) : null);
    const now = Date.now();
    const metricArgs = identity
      ? await buildDownloadMetricArgs({
          target: { kind: "package", id: pkg._id },
          identity,
          now,
        })
      : null;
    if (statKind === "install") {
      await ctx.runMutation(internal.packages.recordPackageInstallInternal, {
        packageId: pkg._id,
        ...(metricArgs
          ? {
              identityKind: metricArgs.identityKind,
              identityHash: metricArgs.identityHash,
              dayStart: metricArgs.dayStart,
              occurredAt: metricArgs.occurredAt,
            }
          : {}),
      });
    }

    if (metricArgs && !areDownloadMetricsPaused()) {
      await ctx.runMutation(internal.downloadMetrics.recordDownloadMetricInternal, metricArgs);
    }
  } catch {
    // Best-effort metric path; never fail package downloads.
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/octet-stream",
    "Content-Disposition": contentDispositionAttachment(
      release.npmTarballName ?? `${pkg.name.replaceAll("/", "-")}-${release.version}.tgz`,
    ),
    "X-ClawHub-Artifact-Type": "npm-pack-tarball",
  };
  if (release.clawpackSha256) {
    headers.ETag = `"sha256:${release.clawpackSha256}"`;
    headers["X-ClawHub-Artifact-Sha256"] = release.clawpackSha256;
  }
  if (release.npmIntegrity) headers["X-ClawHub-Npm-Integrity"] = release.npmIntegrity;
  if (release.npmShasum) headers["X-ClawHub-Npm-Shasum"] = release.npmShasum;
  return new Response(blob, {
    status: 200,
    headers: mergeHeaders(rateHeaders, headers, corsHeaders()),
  });
}
