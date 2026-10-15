import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { isPublishedPackageRelease } from "./packageReleaseVisibility";
import {
  MAX_SDK_USAGE_ENTRIES,
  MAX_SDK_USAGE_ENTRY_BYTES,
  MAX_SDK_USAGE_EVIDENCE,
  MAX_SDK_USAGE_BYTES,
  MAX_SDK_USAGE_UNKNOWNS,
  SDK_USAGE_ANALYSIS_VERSION,
  SDK_USAGE_SCHEMA_VERSION,
  normalizeSdkUsageReport,
  type SdkUsageReport,
  type SdkUsageScan,
} from "./packageSdkUsageContract";
import { isPackageBlockedFromPublic, resolvePackageReleaseScanStatus } from "./packageSecurity";

type Reader = Pick<QueryCtx, "db">;

export function sdkUsageArtifactSha256(release: Doc<"packageReleases">) {
  return release.clawpackSha256 ?? release.integritySha256;
}

export function isPublicSdkUsageRelease(
  pkg: Doc<"packages"> | null,
  release: Doc<"packageReleases"> | null,
): release is Doc<"packageReleases"> {
  if (
    !pkg ||
    pkg.softDeletedAt !== undefined ||
    pkg.channel === "private" ||
    (pkg.family !== "code-plugin" && pkg.family !== "bundle-plugin") ||
    isPackageBlockedFromPublic(pkg.scanStatus)
  )
    return false;
  return (
    isPublishedPackageRelease(release, pkg._id) &&
    (pkg.latestReleaseId ?? pkg.tags?.latest) === release._id &&
    !isPackageBlockedFromPublic(resolvePackageReleaseScanStatus(release))
  );
}

export async function publicSdkUsageRelease(ctx: Reader, pkg: Doc<"packages"> | null) {
  const id = pkg?.latestReleaseId ?? pkg?.tags?.latest;
  const release = id ? await ctx.db.get(id) : null;
  return isPublicSdkUsageRelease(pkg, release) ? release : null;
}

export async function currentSdkUsageScan(
  ctx: Reader,
  pkg: Doc<"packages">,
  release: Doc<"packageReleases">,
) {
  const state = pkg.sdkUsageScanId ? await ctx.db.get(pkg.sdkUsageScanId) : null;
  if (
    !state?.sdkUsage ||
    state.packageId !== pkg._id ||
    state.releaseId !== release._id ||
    state.sdkUsage.artifactSha256 !== sdkUsageArtifactSha256(release)
  )
    return null;
  if (
    (state.sdkUsage.status === "complete" || state.sdkUsage.status === "partial") &&
    !state.sdkUsage.applied
  )
    return null;
  return state;
}

export function sdkUsageStatus(scan: Doc<"packageInspectorScanStates"> | null) {
  if (!scan?.sdkUsage) return "missing" as const;
  if (
    scan.sdkUsage.schemaVersion !== SDK_USAGE_SCHEMA_VERSION ||
    scan.sdkUsage.analysisVersion !== SDK_USAGE_ANALYSIS_VERSION ||
    scan.sdkUsage.inputKind !== "artifact"
  )
    return "incompatible" as const;
  return scan.sdkUsage.status;
}

export function publicSdkUsageScan(scan: Doc<"packageInspectorScanStates"> | null) {
  return scan?.sdkUsage
    ? {
        ...scan.sdkUsage,
        status: sdkUsageStatus(scan),
        inspectorVersion: scan.inspectorVersion,
        targetOpenClawVersion: scan.targetOpenClawVersion,
        completedAt: scan.completedAt,
        evidenceLimit: MAX_SDK_USAGE_EVIDENCE,
        unknownLimit: MAX_SDK_USAGE_UNKNOWNS,
      }
    : { status: "missing" as const };
}

export async function recordPackageInspectorScan(
  ctx: Pick<MutationCtx, "db">,
  args: {
    pkg: Doc<"packages">;
    release: Doc<"packageReleases">;
    inspectorVersion: string;
    targetOpenClawVersion: string;
    notificationComplete?: boolean;
    report?: SdkUsageReport;
    artifactSha256?: string;
  },
) {
  const { pkg, release, inspectorVersion, targetOpenClawVersion } = args;
  const existing = await ctx.db
    .query("packageInspectorScanStates")
    .withIndex("by_release_and_inspector_version_and_target_openclaw_version", (q) =>
      q
        .eq("releaseId", release._id)
        .eq("inspectorVersion", inspectorVersion)
        .eq("targetOpenClawVersion", targetOpenClawVersion),
    )
    .unique();
  const completedAt = Date.now();
  const values = {
    packageId: pkg._id,
    releaseId: release._id,
    inspectorVersion,
    targetOpenClawVersion,
    completedAt,
    ...(args.notificationComplete ? { notificationCompletedAt: completedAt } : {}),
  };
  const scanId = existing?._id ?? (await ctx.db.insert("packageInspectorScanStates", values));
  if (existing) await ctx.db.patch(scanId, values);
  if (args.report && args.artifactSha256) {
    return await replacePackageSdkUsage(ctx, {
      pkg,
      release,
      scanId,
      artifactSha256: args.artifactSha256,
      report: normalizeSdkUsageReport(args.report)!,
    });
  }
  return undefined;
}

async function replacePackageSdkUsage(
  ctx: Pick<MutationCtx, "db">,
  args: {
    pkg: Doc<"packages">;
    release: Doc<"packageReleases">;
    scanId: Id<"packageInspectorScanStates">;
    artifactSha256: string;
    report: SdkUsageReport;
  },
) {
  const { pkg, release, scanId, report } = args;
  if (args.artifactSha256 !== sdkUsageArtifactSha256(release)) {
    throw new ConvexError("SDK inventory artifact does not match the release");
  }
  const compatible =
    report.schemaVersion === SDK_USAGE_SCHEMA_VERSION &&
    report.analysisVersion === SDK_USAGE_ANALYSIS_VERSION &&
    report.inputKind === "artifact";
  const entries = new Map<string, SdkUsageReport["entries"][number]>();
  for (const entry of report.entries) {
    const previous = entries.get(entry.key);
    entries.set(
      entry.key,
      previous
        ? {
            ...entry,
            classification:
              previous.classification === entry.classification ? entry.classification : "mixed",
            referenceKinds: [
              ...new Set([...previous.referenceKinds, ...entry.referenceKinds]),
            ].sort(),
            evidence: [...previous.evidence, ...entry.evidence],
            deprecationCodes: [
              ...new Set([...previous.deprecationCodes, ...entry.deprecationCodes]),
            ].sort(),
          }
        : entry,
    );
  }
  const rows = [...entries.values()].map((entry) => ({
    ...entry,
    evidence: entry.evidence.slice(0, MAX_SDK_USAGE_EVIDENCE).map((e) => ({
      ...e,
      snippet: e.snippet.slice(0, 500),
      ...(e.note ? { note: e.note.slice(0, 500) } : {}),
    })),
    evidenceCount: entry.evidence.length,
    packageId: pkg._id,
    releaseId: release._id,
    scanId,
  }));
  const encoder = new TextEncoder();
  const rowBytes = rows.map((row) => encoder.encode(JSON.stringify(row)).byteLength);
  const tooLarge =
    entries.size > MAX_SDK_USAGE_ENTRIES ||
    rowBytes.some((size) => size > MAX_SDK_USAGE_ENTRY_BYTES) ||
    rowBytes.reduce((sum, size) => sum + size, rows.length + 2) > MAX_SDK_USAGE_BYTES;
  const currentRelease = (pkg.latestReleaseId ?? pkg.tags.latest) === release._id;
  const sdkUsage: SdkUsageScan = {
    schemaVersion: report.schemaVersion,
    analysisVersion: report.analysisVersion,
    inputKind: report.inputKind,
    status: !compatible ? "incompatible" : tooLarge ? "failed" : report.status,
    artifactSha256: args.artifactSha256,
    applied: currentRelease && compatible && !tooLarge && report.status !== "failed",
    entryCount: entries.size,
    unknownCount: report.unknowns.length,
    unknowns: report.unknowns.slice(0, MAX_SDK_USAGE_UNKNOWNS).map((u) => ({
      ...u,
      path: u.path.slice(0, 1024),
      expression: u.expression.slice(0, 500),
      reason: u.reason.slice(0, 1000),
    })),
    coverage: report.coverage,
    ...(tooLarge
      ? {
          reason: `Inventory exceeds the atomic replacement limit (${MAX_SDK_USAGE_ENTRIES} APIs / ${MAX_SDK_USAGE_BYTES} bytes / ${MAX_SDK_USAGE_ENTRY_BYTES} bytes per API); no entries applied`,
        }
      : {}),
  };
  await ctx.db.patch(scanId, { sdkUsage });
  // Late results are retained as scan metadata, but cannot replace a newer release's relationships.
  if (!currentRelease) return sdkUsage;
  await ctx.db.patch(pkg._id, { sdkUsageScanId: scanId });
  if (sdkUsage.status === "failed" || sdkUsage.status === "incompatible") return sdkUsage;
  const previous = await ctx.db
    .query("packageSdkUsage")
    .withIndex("by_packageId_and_key", (q) => q.eq("packageId", pkg._id))
    .take(MAX_SDK_USAGE_ENTRIES + 1);
  if (previous.length > MAX_SDK_USAGE_ENTRIES)
    throw new ConvexError("Stored SDK inventory exceeds replacement limit");
  for (const row of previous) await ctx.db.delete(row._id);
  for (const row of rows) await ctx.db.insert("packageSdkUsage", row);
  return sdkUsage;
}
