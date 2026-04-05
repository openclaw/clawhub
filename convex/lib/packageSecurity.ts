import type { Doc } from "../_generated/dataModel";

export type PackageScanStatus = Doc<"packages">["scanStatus"];

type PackageReleaseSecurityLike = Pick<
  Doc<"packageReleases">,
  "sha256hash" | "vtAnalysis" | "verification" | "staticScan"
>;

export function normalizePackageScanStatus(status: string | null | undefined): PackageScanStatus {
  switch (status?.trim().toLowerCase()) {
    case "clean":
    case "suspicious":
    case "malicious":
    case "pending":
    case "not-run":
      return status.trim().toLowerCase() as PackageScanStatus;
    default:
      return undefined;
  }
}

export function resolvePackageReleaseScanStatus(
  release: PackageReleaseSecurityLike,
): Exclude<PackageScanStatus, undefined> {
  const staticStatus = normalizePackageScanStatus(release.staticScan?.status);
  if (staticStatus === "malicious") return "malicious";
  if (staticStatus === "suspicious") return "suspicious";

  const vtStatus = normalizePackageScanStatus(release.vtAnalysis?.status);
  if (vtStatus === "malicious") return "malicious";
  if (vtStatus === "suspicious") return "suspicious";

  const verificationStatus = normalizePackageScanStatus(release.verification?.scanStatus);
  if (verificationStatus === "malicious") return "malicious";
  if (verificationStatus === "suspicious") return "suspicious";

  if (vtStatus) return vtStatus;
  if (verificationStatus && verificationStatus !== "not-run") return verificationStatus;
  if (release.sha256hash) return "pending";

  return verificationStatus ?? "not-run";
}

export function isPackageBlockedFromPublic(scanStatus: PackageScanStatus) {
  return scanStatus === "malicious";
}

export function getPackageDownloadSecurityBlock(release: PackageReleaseSecurityLike) {
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
