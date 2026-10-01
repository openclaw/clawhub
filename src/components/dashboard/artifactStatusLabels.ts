import type { DashboardPackage, DashboardSkill } from "./types";

type StatusChip = {
  label: string;
  tone: "success" | "warning" | "destructive" | "pending" | "muted";
};

export function skillSecurityStatus(skill: DashboardSkill): StatusChip {
  const flags = skill.moderationFlags ?? [];
  const versionStatuses = new Set([skill.latestVersion?.llmStatus]);

  if (
    flags.includes("blocked.malware") ||
    skill.moderationVerdict === "malicious" ||
    versionStatuses.has("malicious")
  ) {
    return { label: "Blocked", tone: "destructive" };
  }
  if (
    skill.pendingReview ||
    (skill.moderationStatus === "hidden" &&
      (skill.moderationReason === "pending.scan" ||
        skill.moderationReason === "pending.scan.stale"))
  ) {
    return { label: "Scan pending", tone: "pending" };
  }
  if (
    skill.isSuspicious ||
    flags.includes("flagged.suspicious") ||
    skill.moderationVerdict === "suspicious" ||
    versionStatuses.has("suspicious")
  ) {
    return { label: "Needs review", tone: "warning" };
  }
  if (skill.latestVersion?.staticScanStatus === "clean" || skill.moderationVerdict === "clean") {
    return { label: "Scan passed", tone: "success" };
  }
  return { label: "Not scanned", tone: "muted" };
}

export function skillVisibilityStatus(skill: DashboardSkill): StatusChip {
  if (skill.moderationStatus === "removed") {
    return { label: "Removed", tone: "destructive" };
  }
  if (
    skill.qualityDecision === "quarantine" ||
    skill.qualityDecision === "reject" ||
    skill.moderationReason === "quality.low"
  ) {
    return { label: "Quality hold", tone: "warning" };
  }
  if (skill.pendingReview) {
    return { label: "Pending review", tone: "pending" };
  }
  if (skill.moderationStatus === "hidden") {
    return { label: "Hidden", tone: "warning" };
  }
  return { label: "Public", tone: "success" };
}

export function packageSecurityStatus(pkg: DashboardPackage): StatusChip {
  const releaseStatuses = new Set([pkg.latestRelease?.llmStatus]);

  if (pkg.scanStatus === "malicious" || releaseStatuses.has("malicious")) {
    return { label: "Blocked", tone: "destructive" };
  }
  if (pkg.scanStatus === "pending" || pkg.pendingReview) {
    return { label: "Scan pending", tone: "pending" };
  }
  if (pkg.scanStatus === "suspicious" || releaseStatuses.has("suspicious")) {
    return { label: "Needs review", tone: "warning" };
  }
  if (pkg.scanStatus === "clean") {
    return { label: "Scan passed", tone: "success" };
  }
  return { label: "Not scanned", tone: "muted" };
}

export function packageVisibilityStatus(pkg: DashboardPackage): StatusChip {
  if (pkg.pendingReview) {
    return { label: "Pending review", tone: "pending" };
  }
  return { label: "Public", tone: "success" };
}
