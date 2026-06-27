import { buildSkillSecurityAuditHref } from "../../lib/ownerRoute";
import { buildPluginSecurityAuditHref, buildPluginValidationHref } from "../../lib/pluginRoutes";
import { formatValidationFindingMessage } from "../../lib/pluginValidationFormat";
import { buildSkillHref } from "../skillDetailUtils";
import {
  packageSecurityStatus,
  skillSecurityStatus,
  skillVisibilityStatus,
} from "./artifactStatusLabels";
import type { DashboardAttentionItem, DashboardPackage, DashboardSkill } from "./types";

const ATTENTION_PREVIEW_LIMIT = 140;
const VALIDATION_FIX_LIMIT = 72;

function truncatePreview(text: string, maxLength = ATTENTION_PREVIEW_LIMIT) {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1).trimEnd()}…`;
}

function skillDetailHref(skill: DashboardSkill, ownerHandle: string) {
  return (
    skill.detailHref ??
    buildSkillHref(ownerHandle, skill.ownerPublisherId ?? skill.ownerUserId ?? null, skill.slug)
  );
}

function skillSecurityAuditHref(skill: DashboardSkill, ownerHandle: string) {
  return buildSkillSecurityAuditHref(ownerHandle, skill.slug);
}

function skillAuditPreview(skill: DashboardSkill) {
  const summary = skill.moderationSummary?.trim();
  if (!summary) return undefined;

  const internalRuleSummary = summary.match(
    /^(malicious|suspicious):\s+[a-z0-9-]+(?:[._][a-z0-9_-]+)+$/i,
  );
  if (internalRuleSummary) {
    const finding = internalRuleSummary[1]?.toLowerCase();
    return finding === "malicious"
      ? "Security scan classified this version as malicious."
      : "Security scan requires manual review.";
  }

  return truncatePreview(summary);
}

function pluginValidationPreview(pkg: DashboardPackage) {
  const finding = pkg.topInspectorFinding;
  if (!finding) return undefined;
  const message = conciseValidationMessage(formatValidationFindingMessage(finding.message));
  const remediation = finding.remediation ? conciseValidationRemediation(finding.remediation) : "";
  if (remediation) {
    const fix = truncatePreview(remediation, VALIDATION_FIX_LIMIT);
    const messageBudget = ATTENTION_PREVIEW_LIMIT - fix.length - " Fix: ".length;
    return `${truncatePreview(message, messageBudget)} Fix: ${fix}`;
  }
  return truncatePreview(message);
}

function conciseValidationMessage(message: string) {
  if (/before_agent_start hook is deprecated/i.test(message)) {
    return "Deprecated before_agent_start hook.";
  }
  return message;
}

function conciseValidationRemediation(remediation: string) {
  const trimmed = remediation.trim();
  if (/replace the legacy before_agent_start hook with current prompt hooks/i.test(trimmed)) {
    return "Replace with current prompt hooks.";
  }
  return trimmed;
}

function pushSkillAttention(
  items: DashboardAttentionItem[],
  skill: DashboardSkill,
  ownerHandle: string,
) {
  const detailHref = skillDetailHref(skill, ownerHandle);
  const auditHref = skillSecurityAuditHref(skill, ownerHandle);
  const security = skillSecurityStatus(skill);
  const visibility = skillVisibilityStatus(skill);
  const auditPreview = skillAuditPreview(skill);

  if (security.tone === "destructive") {
    items.push({
      id: `skill:${skill._id}:blocked`,
      kind: "skill",
      slug: skill.slug,
      ownerHandle,
      version: skill.latestVersion?.version,
      issueType: "security",
      title: skill.displayName,
      reason: "Blocked by security checks",
      preview: auditPreview,
      severity: "destructive",
      href: auditHref,
      actionLabel: "Review security →",
    });
  }
  if (visibility.label === "Hidden" || visibility.label === "Removed") {
    items.push({
      id: `skill:${skill._id}:visibility`,
      kind: "skill",
      slug: skill.slug,
      ownerHandle,
      version: skill.latestVersion?.version,
      issueType: "visibility",
      title: skill.displayName,
      reason: visibility.label,
      severity: visibility.tone === "destructive" ? "destructive" : "warning",
      href: detailHref,
      actionLabel: "Open details →",
    });
  }
}

function pushPackageAttention(
  items: DashboardAttentionItem[],
  pkg: DashboardPackage,
  ownerHandle: string,
) {
  const auditHref = buildPluginSecurityAuditHref(pkg.name, { ownerHandle });
  const warningCount = pkg.inspectorWarningCount ?? 0;
  const security = packageSecurityStatus(pkg);
  const validationPreview = pluginValidationPreview(pkg);

  if (warningCount > 0) {
    items.push({
      id: `plugin:${pkg._id}:validation`,
      kind: "plugin",
      packageName: pkg.name,
      version: pkg.latestVersion ?? pkg.latestRelease?.version ?? undefined,
      issueType: "validation",
      title: pkg.displayName,
      reason: `${warningCount} validation warning${warningCount === 1 ? "" : "s"}`,
      preview: validationPreview,
      severity: "warning",
      href: buildPluginValidationHref(pkg.name),
      actionLabel: "View validation →",
    });
  }
  if (security.tone === "destructive") {
    items.push({
      id: `plugin:${pkg._id}:blocked`,
      kind: "plugin",
      packageName: pkg.name,
      version: pkg.latestVersion ?? pkg.latestRelease?.version ?? undefined,
      issueType: "security",
      title: pkg.displayName,
      reason: "Blocked by security checks",
      severity: "destructive",
      href: auditHref,
      actionLabel: "Review security →",
    });
    return;
  }
  if (security.tone === "pending") {
    items.push({
      id: `plugin:${pkg._id}:pending-scan`,
      kind: "plugin",
      packageName: pkg.name,
      version: pkg.latestVersion ?? pkg.latestRelease?.version ?? undefined,
      issueType: "security",
      title: pkg.displayName,
      reason: "Waiting for security checks",
      severity: "pending",
      href: auditHref,
      actionLabel: "View progress →",
    });
  } else if (security.tone === "warning") {
    items.push({
      id: `plugin:${pkg._id}:review`,
      kind: "plugin",
      packageName: pkg.name,
      version: pkg.latestVersion ?? pkg.latestRelease?.version ?? undefined,
      issueType: "security",
      title: pkg.displayName,
      reason: "Needs security review",
      severity: "warning",
      href: auditHref,
      actionLabel: "Review security →",
    });
  }
}

export function collectAttentionItems(
  skills: DashboardSkill[],
  packages: DashboardPackage[],
  ownerHandle: string,
): DashboardAttentionItem[] {
  const items: DashboardAttentionItem[] = [];
  for (const skill of skills) pushSkillAttention(items, skill, ownerHandle);
  for (const pkg of packages) pushPackageAttention(items, pkg, ownerHandle);
  return items;
}
