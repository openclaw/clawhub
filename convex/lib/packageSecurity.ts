import type { Doc } from "../_generated/dataModel";
import { normalizeClawScanVerdict } from "./clawScanVerdict";

export type PackageScanStatus = Doc<"packages">["scanStatus"];

type PackageReleaseSecurityLike = Pick<
  Doc<"packageReleases">,
  | "sha256hash"
  | "vtAnalysis"
  | "llmAnalysis"
  | "verification"
  | "staticScan"
  | "manualModeration"
  | "clawScanVerdict"
  | "clawScanState"
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

  const clawScanVerdict = normalizeClawScanVerdict(
    release.clawScanVerdict ?? release.llmAnalysis?.verdict ?? release.llmAnalysis?.status,
  );
  if (clawScanVerdict === "malicious") return "malicious";
  if (release.clawScanState === "pending" || release.clawScanState === "running") return "pending";
  if (clawScanVerdict) return "clean";

  const verificationStatus = normalizePackageScanStatus(release.verification?.scanStatus);
  if (verificationStatus === "clean") return "clean";
  if (verificationStatus === "pending") return "pending";
  if (release.sha256hash) return "pending";

  return "not-run";
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
