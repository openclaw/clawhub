import type { Doc } from "../_generated/dataModel";

export type PackageScanStatus = Doc<"packages">["scanStatus"];

type PackageReleaseSecurityLike = Pick<
  Doc<"packageReleases">,
  "sha256hash" | "vtAnalysis" | "llmAnalysis" | "verification" | "staticScan" | "manualModeration"
>;

type PackageVtEngineStats = {
  malicious?: number;
  suspicious?: number;
  undetected?: number;
  harmless?: number;
};

type PackageVirusTotalAnalysis =
  | (NonNullable<PackageReleaseSecurityLike["vtAnalysis"]> & {
      metadata?: {
        stats?: PackageVtEngineStats;
      };
    })
  | null
  | undefined;

export function normalizePackageScanStatus(status: string | null | undefined): PackageScanStatus {
  const normalized = status?.trim().toLowerCase();
  switch (normalized) {
    case "benign":
      return "clean";
    case "clean":
    case "suspicious":
    case "malicious":
    case "pending":
    case "not-run":
      return normalized as PackageScanStatus;
    default:
      return undefined;
  }
}

function getVtEngineStats(analysis: PackageVirusTotalAnalysis) {
  return analysis?.engineStats ?? analysis?.metadata?.stats;
}

function isVtAiOnlyAnalysis(analysis: PackageVirusTotalAnalysis) {
  const scanner = analysis?.scanner?.trim().toLowerCase();
  const source = analysis?.source?.trim().toLowerCase();
  return scanner === "code_insight" || source === "palm" || source?.includes("code insight");
}

function getAuthoritativePackageVtStatus(analysis: PackageVirusTotalAnalysis) {
  const stats = getVtEngineStats(analysis);
  if (stats) {
    if ((stats.malicious ?? 0) > 0) return "malicious";
    if ((stats.suspicious ?? 0) > 0) return "suspicious";
    return undefined;
  }

  if (isVtAiOnlyAnalysis(analysis)) return undefined;

  const source = analysis?.source?.trim().toLowerCase();
  if (source === "engines" || source?.startsWith("engines-")) {
    return normalizePackageScanStatus(analysis?.status);
  }

  return undefined;
}

export function resolvePackageReleaseScanStatus(
  release: PackageReleaseSecurityLike,
): Exclude<PackageScanStatus, undefined> {
  if (release.manualModeration?.state === "approved") return "clean";
  if (
    release.manualModeration?.state === "quarantined" ||
    release.manualModeration?.state === "revoked"
  ) {
    return "malicious";
  }

  const staticStatus = normalizePackageScanStatus(release.staticScan?.status);
  if (staticStatus === "malicious") return "malicious";

  const vtStatus = getAuthoritativePackageVtStatus(release.vtAnalysis);
  if (vtStatus === "malicious") return "malicious";

  const llmStatus = normalizePackageScanStatus(
    release.llmAnalysis?.verdict ?? release.llmAnalysis?.status,
  );
  if (llmStatus === "malicious") return "malicious";
  if (llmStatus === "suspicious") return "suspicious";
  if (llmStatus === "clean") return "clean";

  if (vtStatus === "suspicious") return "suspicious";

  const verificationStatus = normalizePackageScanStatus(release.verification?.scanStatus);
  const effectiveVerificationStatus =
    verificationStatus === "suspicious" && staticStatus === "suspicious"
      ? undefined
      : verificationStatus;
  if (effectiveVerificationStatus === "malicious") return "malicious";
  if (effectiveVerificationStatus === "suspicious") return "suspicious";

  if (vtStatus) return vtStatus;
  if (effectiveVerificationStatus && effectiveVerificationStatus !== "not-run") {
    return effectiveVerificationStatus;
  }
  if (release.sha256hash) return "pending";

  return effectiveVerificationStatus ?? "not-run";
}

export function isPackageBlockedFromPublic(scanStatus: PackageScanStatus) {
  return scanStatus === "malicious";
}

export function isPackageReleaseTrustStale(release: Pick<Doc<"packageReleases">, "vtAnalysis">) {
  return release.vtAnalysis?.status?.trim().toLowerCase() === "stale";
}

export function getPackageTrustReasons(
  release: Pick<Doc<"packageReleases">, "manualModeration" | "staticScan" | "vtAnalysis">,
  scanStatus: Exclude<PackageScanStatus, undefined>,
  reportCount = 0,
) {
  const reasons: string[] = [];
  if (release.manualModeration?.state) reasons.push(`manual:${release.manualModeration.state}`);
  if (scanStatus !== "clean" && scanStatus !== "not-run") reasons.push(`scan:${scanStatus}`);
  if (release.staticScan?.status === "malicious") {
    reasons.push(`static:${release.staticScan.status}`);
  }
  const vtStatus = getAuthoritativePackageVtStatus(release.vtAnalysis);
  if ((vtStatus === "suspicious" || vtStatus === "malicious") && vtStatus === scanStatus) {
    reasons.push(`vt:${vtStatus}`);
  }
  if (reportCount > 0) reasons.push(`reports:${reportCount}`);
  return [...new Set(reasons)];
}

export function getPackageDownloadSecurityBlock(release: PackageReleaseSecurityLike) {
  if (release.manualModeration?.state === "quarantined") {
    return {
      status: 403,
      message: "Blocked: this package release is quarantined by ClawHub moderation.",
    };
  }

  if (release.manualModeration?.state === "revoked") {
    return {
      status: 403,
      message: "Blocked: this package release has been revoked by ClawHub moderation.",
    };
  }

  const scanStatus = resolvePackageReleaseScanStatus(release);

  if (scanStatus === "malicious") {
    return {
      status: 403,
      message:
        "Blocked: this package release has been flagged as malicious and cannot be downloaded.",
    };
  }

  return null;
}
