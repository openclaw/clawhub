import type { Doc } from "../_generated/dataModel";

export type PackageScanStatus = Doc<"packages">["scanStatus"];

type PackageReleaseSecurityLike = Pick<
  Doc<"packageReleases">,
  "sha256hash" | "vtAnalysis" | "llmAnalysis" | "verification" | "staticScan" | "manualModeration"
>;

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

  const llmStatus = normalizePackageScanStatus(
    release.llmAnalysis?.verdict ?? release.llmAnalysis?.status,
  );
  if (llmStatus === "malicious") return "malicious";
  if (llmStatus === "suspicious") return "suspicious";
  if (llmStatus === "clean") return "clean";

  const verificationStatus = normalizePackageScanStatus(release.verification?.scanStatus);
  if (verificationStatus === "clean" && release.verification?.trustedOpenClawPlugin === true) {
    return "clean";
  }

  const staticStatus = normalizePackageScanStatus(release.staticScan?.status);
  if (staticStatus === "malicious") return "malicious";

  const effectiveVerificationStatus =
    verificationStatus === "suspicious" && staticStatus === "suspicious"
      ? undefined
      : verificationStatus;
  if (effectiveVerificationStatus === "malicious") return "malicious";
  if (effectiveVerificationStatus === "suspicious") return "suspicious";

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
