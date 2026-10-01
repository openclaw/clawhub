export type ArtifactDisplayStatus = {
  key?: string;
  label: string;
  description: string;
  variant: "default" | "pending" | "warning" | "destructive" | "success";
};

type ArtifactScanSignalStatus = "clean" | "suspicious" | "malicious" | null;

type SkillArtifactStatusInput = {
  moderationStatus?: string;
  moderationReason?: string;
  moderationVerdict?: "clean" | "suspicious" | "malicious";
  moderationFlags?: string[];
  isSuspicious?: boolean;
  pendingReview?: boolean;
  qualityDecision?: "pass" | "quarantine" | "reject";
  latestVersion?: {
    vtStatus: string | null;
    llmStatus: string | null;
    staticScanStatus: ArtifactScanSignalStatus;
  } | null;
};

type PackageArtifactStatusInput = {
  scanStatus?: "clean" | "suspicious" | "malicious" | "pending" | "not-run";
  pendingReview?: boolean;
  latestRelease?: {
    vtStatus: string | null;
    llmStatus: string | null;
    staticScanStatus: ArtifactScanSignalStatus;
  } | null;
};

export function artifactStatusToScanStatus(status: Pick<ArtifactDisplayStatus, "key" | "label">) {
  if (status.key === "blocked" || status.label === "Blocked") return "malicious";
  if (status.key === "suspicious" || status.label === "Review") return "review";
  if (status.key === "visible" || status.label === "Visible") return "clean";
  if (status.key === "pending" || status.label === "Pending checks") return "pending";
  return "unknown";
}

export function skillArtifactStatus(skill: SkillArtifactStatusInput): ArtifactDisplayStatus & {
  key: "visible" | "pending" | "suspicious" | "blocked" | "hidden" | "removed" | "quality";
} {
  const flags = skill.moderationFlags ?? [];
  const reason = skill.moderationReason ?? "";
  const versionStatuses = new Set([skill.latestVersion?.llmStatus]);

  if (skill.moderationStatus === "removed") {
    return {
      key: "removed",
      label: "Removed",
      description: "Removed from public inventory by moderation.",
      variant: "destructive",
    };
  }
  if (
    flags.includes("blocked.malware") ||
    skill.moderationVerdict === "malicious" ||
    versionStatuses.has("malicious")
  ) {
    return {
      key: "blocked",
      label: "Blocked",
      description:
        "Unavailable publicly because automated security checks found malicious content.",
      variant: "destructive",
    };
  }
  if (
    skill.pendingReview ||
    (skill.moderationStatus === "hidden" &&
      (reason === "pending.scan" || reason === "pending.scan.stale"))
  ) {
    return {
      key: "pending",
      label: "Pending checks",
      description: "Hidden until security verification checks finish.",
      variant: "pending",
    };
  }
  if (
    skill.qualityDecision === "quarantine" ||
    skill.qualityDecision === "reject" ||
    reason === "quality.low"
  ) {
    return {
      key: "quality",
      label: "Quality held",
      description: "Unavailable while quality review is holding this release.",
      variant: "warning",
    };
  }
  if (
    skill.isSuspicious ||
    flags.includes("flagged.suspicious") ||
    skill.moderationVerdict === "suspicious" ||
    versionStatuses.has("suspicious")
  ) {
    return {
      key: "suspicious",
      label: "Review",
      description:
        "Visible in ClawHub, but users are asked to inspect this skill carefully before installing.",
      variant: "warning",
    };
  }
  if (skill.moderationStatus === "hidden") {
    return {
      key: "hidden",
      label: "Hidden",
      description: "Hidden from public catalog surfaces.",
      variant: "warning",
    };
  }
  return {
    key: "visible",
    label: "Visible",
    description: "Available on public catalog surfaces.",
    variant: "success",
  };
}

export function packageArtifactStatus(pkg: PackageArtifactStatusInput): ArtifactDisplayStatus {
  const releaseStatuses = new Set([pkg.latestRelease?.llmStatus]);

  if (pkg.scanStatus === "malicious" || releaseStatuses.has("malicious")) {
    return {
      label: "Blocked",
      description: "Security checks found malicious content.",
      variant: "destructive",
    };
  }
  if (pkg.scanStatus === "suspicious" || releaseStatuses.has("suspicious")) {
    return {
      label: "Review",
      description:
        "Visible in ClawHub, but users are asked to inspect this plugin carefully before installing.",
      variant: "warning",
    };
  }
  if (pkg.scanStatus === "pending" || pkg.pendingReview) {
    return {
      label: "Pending checks",
      description: "Security verification is still running.",
      variant: "pending",
    };
  }
  if (pkg.scanStatus === "clean") {
    return {
      label: "Visible",
      description: "Available on public catalog surfaces.",
      variant: "success",
    };
  }
  return {
    label: "Unknown",
    description: "Open the plugin for the latest release and security details.",
    variant: "default",
  };
}
