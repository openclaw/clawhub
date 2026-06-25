import type { FunctionReturnType } from "convex/server";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { getUserFacingConvexError } from "../../lib/convexError";

export const SKILL_AUDIT_LOG_LIMIT = 10;
export const USER_BAN_REASON_MAX_LENGTH = 500;

export type ManagementUserListResult = FunctionReturnType<typeof api.users.list>;
export type SkillBySlugResult = FunctionReturnType<typeof api.skills.getBySlugForStaff>;
export type PluginByNameResult = FunctionReturnType<typeof api.packages.getByNameForStaff>;
export type RecentVersionEntry = FunctionReturnType<typeof api.skills.listRecentVersions>[number];
export type ReportedSkillEntry = FunctionReturnType<typeof api.skills.listReportedSkills>[number];
export type DuplicateCandidateEntry = FunctionReturnType<
  typeof api.skills.listDuplicateCandidates
>[number];
export type ManagementUserSummary = NonNullable<NonNullable<SkillBySlugResult>["overrideReviewer"]>;

export type PublisherAbuseReviewDashboard = FunctionReturnType<
  typeof api.publisherAbuse.listReviewDashboard
>;
export type PublisherAbuseReviewDetail = FunctionReturnType<
  typeof api.publisherAbuse.getReviewNominationDetail
>;
export type PublisherAbuseReviewItem = PublisherAbuseReviewDashboard["pendingItems"][number];
export type PublisherAbuseReviewScore = NonNullable<PublisherAbuseReviewItem["latestScore"]>;
export type PublisherAbuseTab = "potential_ban_candidate" | "review" | "all_pending" | "resolved";

export type ManagementView =
  | "overview"
  | "abuse"
  | "reports"
  | "users"
  | "publishers"
  | "skills"
  | "plugins"
  | "duplicates"
  | "recent"
  | "audit"
  | "system"
  | "settings";

export type ManagementOwnerOption = {
  userId: Id<"users">;
  label: string;
};

export function resolveOwnerParam(
  handle: string | null | undefined,
  ownerId?: Id<"users"> | Id<"publishers">,
) {
  return handle?.trim().toLowerCase() || (ownerId ? String(ownerId) : "unknown");
}

export function formatTimestamp(value: number) {
  return new Date(value).toLocaleString();
}

export function formatShortTimestamp(value: number) {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatWholeNumber(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat().format(Math.round(value));
}

export function formatRatio(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: value < 1 ? 2 : 1,
    minimumFractionDigits: value < 1 ? 2 : 0,
  }).format(value);
}

export function formatScore(value: number) {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(value);
}

export function formatMutationError(error: unknown) {
  return getUserFacingConvexError(error, "Request failed.");
}

export function formatManualOverrideState(
  override:
    | {
        verdict: string;
        note: string;
        reviewerUserId: string;
        updatedAt: number;
      }
    | null
    | undefined,
  reviewer?: ManagementUserSummary | null,
) {
  if (!override) return "No override.";
  return `${formatVerdictLabel(override.verdict)} · reviewer ${formatManagementUserLabel(reviewer, override.reviewerUserId)} · updated ${formatTimestamp(
    override.updatedAt,
  )} · ${override.note}`;
}

export function formatManagementUserLabel(
  user: ManagementUserSummary | null | undefined,
  fallbackId?: string | null,
) {
  if (user?.handle?.trim()) return `@${user.handle.trim()}`;
  if (user?.displayName?.trim()) return user.displayName.trim();
  if (user?.name?.trim()) return user.name.trim();
  if (fallbackId?.trim()) return fallbackId.trim();
  return "unknown user";
}

export function formatAuditActionLabel(action: string, metadata?: unknown) {
  const record = asAuditMetadataRecord(metadata);
  if (action === "skill.manual_override.set") {
    const verdict = typeof record?.verdict === "string" ? record.verdict : "unknown";
    return `Override set to ${formatVerdictLabel(verdict)}`;
  }
  if (action === "skill.manual_override.clear") {
    return "Override cleared";
  }
  if (action === "skill.owner.change") {
    return "Owner changed";
  }
  if (action === "skill.duplicate.set") {
    return "Duplicate target set";
  }
  if (action === "skill.duplicate.clear") {
    return "Duplicate target cleared";
  }
  if (action === "skill.auto_hide") {
    return "Skill auto-hidden";
  }
  if (action === "skill.hard_delete") {
    return "Skill hard-deleted";
  }
  if (action.startsWith("skill.transfer.")) {
    return `Transfer ${action.slice("skill.transfer.".length).replaceAll("_", " ")}`;
  }
  if (action.startsWith("skill.")) {
    return action.slice("skill.".length).replaceAll(".", " ").replaceAll("_", " ");
  }
  return action.replaceAll(".", " ").replaceAll("_", " ");
}

export function formatAuditMetadataSummary(action: string, metadata?: unknown) {
  const record = asAuditMetadataRecord(metadata);
  if (!record) return null;

  if (action === "skill.manual_override.set") {
    const note = typeof record.note === "string" ? record.note.trim() : "";
    if (note) return note;
    const previousVerdict =
      typeof record.previousVerdict === "string" ? record.previousVerdict : null;
    return previousVerdict ? `Previous verdict: ${formatVerdictLabel(previousVerdict)}` : null;
  }

  if (action === "skill.manual_override.clear") {
    const note = typeof record.note === "string" ? record.note.trim() : "";
    if (note) return note;
    const previousVerdict =
      typeof record.previousVerdict === "string" ? record.previousVerdict : null;
    return previousVerdict
      ? `Previous override verdict: ${formatVerdictLabel(previousVerdict)}`
      : null;
  }

  if (action === "skill.owner.change") {
    const from = typeof record.from === "string" ? record.from : null;
    const to = typeof record.to === "string" ? record.to : null;
    if (from || to) return `from ${from ?? "unknown"} to ${to ?? "unknown"}`;
  }

  if (action === "skill.duplicate.set") {
    return typeof record.canonicalSlug === "string"
      ? `Canonical skill: ${record.canonicalSlug}`
      : null;
  }

  if (action === "skill.duplicate.clear") {
    return "Canonical skill cleared.";
  }

  if (action === "skill.auto_hide") {
    return typeof record.reportCount === "number" ? `${record.reportCount} active reports` : null;
  }

  if (action === "skill.hard_delete") {
    return typeof record.slug === "string" ? `Deleted slug: ${record.slug}` : null;
  }

  if (typeof record.note === "string" && record.note.trim()) {
    return record.note.trim();
  }
  if (typeof record.reason === "string" && record.reason.trim()) {
    return record.reason.trim();
  }
  return null;
}

function asAuditMetadataRecord(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  return metadata as Record<string, unknown>;
}

function formatVerdictLabel(verdict: string) {
  return verdict === "clean" ? "okay" : verdict;
}
