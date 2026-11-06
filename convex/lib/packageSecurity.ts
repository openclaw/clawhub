import type { Doc } from "../_generated/dataModel";
import {
  isSecurityScanStatusBlockedFromPublic,
  normalizeSecurityScanStatus,
} from "./securityScanPolicy";

export type PackageScanStatus = Doc<"packages">["scanStatus"];

type PackageReleaseSecurityLike = Pick<
  Doc<"packageReleases">,
  "sha256hash" | "llmAnalysis" | "verification" | "staticScan" | "manualModeration"
>;

export function normalizePackageScanStatus(status: string | null | undefined): PackageScanStatus {
  const normalized = normalizeSecurityScanStatus(status);
  return normalized === "failed" ? undefined : (normalized as PackageScanStatus);
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

  // Legacy compatibility only: the retired static publish scan used to copy its
  // status into verification.scanStatus. A verification status that merely mirrors
  // a stored static result is not a trust verdict, so it is ignored. New releases
  // never carry staticScan; drop this once historical rows are migrated.
  const staticStatus = normalizePackageScanStatus(release.staticScan?.status);
  const effectiveVerificationStatus =
    (verificationStatus === "suspicious" && staticStatus === "suspicious") ||
    (verificationStatus === "malicious" && staticStatus === "malicious")
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
  return isSecurityScanStatusBlockedFromPublic(scanStatus);
}

export function getPackageTrustReasons(
  release: Pick<Doc<"packageReleases">, "manualModeration">,
  scanStatus: Exclude<PackageScanStatus, undefined>,
  reportCount = 0,
) {
  const reasons: string[] = [];
  if (release.manualModeration?.state) reasons.push(`manual:${release.manualModeration.state}`);
  if (scanStatus !== "clean" && scanStatus !== "not-run") reasons.push(`scan:${scanStatus}`);
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

  if (isSecurityScanStatusBlockedFromPublic(scanStatus)) {
    return {
      status: 403,
      message:
        "Blocked: this package release has been flagged as malicious and cannot be downloaded.",
    };
  }

  return null;
}
