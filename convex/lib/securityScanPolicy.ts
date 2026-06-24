export type SecurityScanStatus =
  | "clean"
  | "suspicious"
  | "malicious"
  | "pending"
  | "failed"
  | "not-run";

export type SourceBackedSkillScanStatus = Exclude<SecurityScanStatus, "not-run">;

const BLOCKED_PUBLIC_SECURITY_SCAN_STATUSES = new Set<SecurityScanStatus>(["failed", "malicious"]);

export function normalizeSecurityScanStatus(
  status: string | null | undefined,
): SecurityScanStatus | undefined {
  const normalized = status?.trim().toLowerCase();
  if (normalized === "benign") return "clean";
  if (
    normalized === "clean" ||
    normalized === "suspicious" ||
    normalized === "malicious" ||
    normalized === "pending" ||
    normalized === "failed" ||
    normalized === "not-run"
  ) {
    return normalized;
  }
  return undefined;
}

export function isSecurityScanStatusBlockedFromPublic(
  status: SecurityScanStatus | null | undefined,
): boolean {
  return Boolean(status && BLOCKED_PUBLIC_SECURITY_SCAN_STATUSES.has(status));
}

export function isSecurityScanStatusCompletedNonBlocked(
  status: SecurityScanStatus | null | undefined,
): status is "clean" | "suspicious" {
  return status === "clean" || status === "suspicious";
}

export function isReusableCompletedSecurityScanVerdict(
  status: SecurityScanStatus | null | undefined,
): status is "clean" | "suspicious" | "malicious" {
  return status === "clean" || status === "suspicious" || status === "malicious";
}

export function shouldPreserveSecurityScanStateForUnchangedContent(
  status: SecurityScanStatus | null | undefined,
): status is "clean" | "suspicious" | "malicious" | "failed" {
  return isReusableCompletedSecurityScanVerdict(status) || status === "failed";
}
