export type GitHubSkillSyncPreviewClassification =
  | "new-destination"
  | "replacement"
  | "unavailable"
  | "ownership-conflict";

export type GitHubSkillSyncDiscoveredSkill = {
  slug: string;
  displayName: string;
  path: string;
  contentHash: string;
};

export type GitHubSkillSyncPreviewDestination =
  | { kind: "none" }
  | {
      kind: "owned";
      skillId: string;
      ownerPublisherId: string;
      ownerHandle: string;
      slug: string;
      displayName: string;
      installKind: "hosted" | "github";
      unavailableReason?:
        | "destination-soft-deleted"
        | "already-synced"
        | "destination-uses-another-github-source";
    }
  | {
      kind: "alias-conflict";
      skillId: string;
      ownerPublisherId: string;
      ownerHandle: string;
      slug: string;
      displayName: string;
    }
  | {
      kind: "source-conflict";
      ownerPublisherId: string;
      ownerHandle: string;
    };

export type GitHubSkillSyncPreviewItem = GitHubSkillSyncDiscoveredSkill & {
  classification: GitHubSkillSyncPreviewClassification;
  eligible: boolean;
  reason?:
    | "invalid-skill-slug"
    | "destination-soft-deleted"
    | "already-synced"
    | "destination-uses-another-github-source"
    | "destination-alias-conflict"
    | "repository-owned-by-another-publisher";
  destination: {
    skillId: string;
    ownerPublisherId: string;
    ownerHandle: string;
    slug: string;
    displayName: string;
  } | null;
};

function toDestination(
  destination: Extract<GitHubSkillSyncPreviewDestination, { kind: "owned" | "alias-conflict" }>,
) {
  return {
    skillId: destination.skillId,
    ownerPublisherId: destination.ownerPublisherId,
    ownerHandle: destination.ownerHandle,
    slug: destination.slug,
    displayName: destination.displayName,
  };
}

export function classifyGitHubSkillSyncPreviewItem({
  discovered,
  destination,
  invalidSlug = false,
}: {
  discovered: GitHubSkillSyncDiscoveredSkill;
  destination: GitHubSkillSyncPreviewDestination;
  invalidSlug?: boolean;
}): GitHubSkillSyncPreviewItem {
  if (invalidSlug) {
    return {
      ...discovered,
      classification: "unavailable",
      eligible: false,
      reason: "invalid-skill-slug",
      destination:
        destination.kind === "owned" || destination.kind === "alias-conflict"
          ? toDestination(destination)
          : null,
    };
  }
  if (destination.kind === "source-conflict") {
    return {
      ...discovered,
      classification: "ownership-conflict",
      eligible: false,
      reason: "repository-owned-by-another-publisher",
      destination: null,
    };
  }
  if (destination.kind === "none") {
    return {
      ...discovered,
      classification: "new-destination",
      eligible: true,
      destination: null,
    };
  }
  if (destination.kind === "alias-conflict") {
    return {
      ...discovered,
      classification: "ownership-conflict",
      eligible: false,
      reason: "destination-alias-conflict",
      destination: toDestination(destination),
    };
  }
  if (destination.unavailableReason) {
    return {
      ...discovered,
      classification:
        destination.unavailableReason === "destination-uses-another-github-source"
          ? "ownership-conflict"
          : "unavailable",
      eligible: false,
      reason: destination.unavailableReason,
      destination: toDestination(destination),
    };
  }
  return {
    ...discovered,
    classification: "replacement",
    eligible: true,
    destination: toDestination(destination),
  };
}
