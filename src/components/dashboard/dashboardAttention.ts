import { buildSkillSecurityAuditHref } from "../../lib/ownerRoute";
import { formatValidationFindingMessage } from "../../lib/pluginValidationFormat";
import {
  buildPluginDetailHref,
  buildPluginSecurityAuditHref,
  buildPluginValidationHref,
} from "../../lib/pluginRoutes";
import { buildSkillHref } from "../skillDetailUtils";
import type { DashboardAttentionItem, DashboardPackage, DashboardSkill } from "./types";
import { packageSecurityStatus, skillSecurityStatus, skillVisibilityStatus } from "./artifactStatusLabels";

function truncatePreview(text: string, maxLength = 140) {
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
  if (summary) return truncatePreview(summary);
  return undefined;
}

function pluginValidationPreview(pkg: DashboardPackage) {
  const finding = pkg.topInspectorFinding;
  if (!finding) return undefined;
  const message = formatValidationFindingMessage(finding.message);
  if (finding.remediation) {
    return truncatePreview(`${message} Fix: ${finding.remediation}`);
  }
  return truncatePreview(message);
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
      title: skill.displayName,
      reason: "Blocked by security checks",
      preview: auditPreview,
      severity: "destructive",
      href: auditHref,
      actionLabel: "Review →",
    });
    return;
  }
  if (security.tone === "pending") {
    items.push({
      id: `skill:${skill._id}:pending-scan`,
      kind: "skill",
      title: skill.displayName,
      reason: "Waiting for security checks",
      preview: auditPreview,
      severity: "pending",
      href: auditHref,
      actionLabel: "Review →",
    });
  } else if (security.tone === "warning") {
    items.push({
      id: `skill:${skill._id}:review`,
      kind: "skill",
      title: skill.displayName,
      reason: "Needs security review",
      preview: auditPreview,
      severity: "warning",
      href: auditHref,
      actionLabel: "Review →",
    });
  }
  if (visibility.label === "Quality hold") {
    items.push({
      id: `skill:${skill._id}:quality`,
      kind: "skill",
      title: skill.displayName,
      reason: "Held for quality review",
      severity: "warning",
      href: detailHref,
      actionLabel: "Open",
    });
  } else if (visibility.label === "Hidden" || visibility.label === "Removed") {
    items.push({
      id: `skill:${skill._id}:visibility`,
      kind: "skill",
      title: skill.displayName,
      reason: visibility.label,
      severity: visibility.tone === "destructive" ? "destructive" : "warning",
      href: detailHref,
      actionLabel: "Open",
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
      title: pkg.displayName,
      reason: `${warningCount} validation warning${warningCount === 1 ? "" : "s"}`,
      preview: validationPreview,
      severity: "warning",
      href: buildPluginValidationHref(pkg.name),
      actionLabel: "Review →",
    });
  }
  if (security.tone === "destructive") {
    items.push({
      id: `plugin:${pkg._id}:blocked`,
      kind: "plugin",
      title: pkg.displayName,
      reason: "Blocked by security checks",
      severity: "destructive",
      href: auditHref,
      actionLabel: "Review →",
    });
    return;
  }
  if (security.tone === "pending") {
    items.push({
      id: `plugin:${pkg._id}:pending-scan`,
      kind: "plugin",
      title: pkg.displayName,
      reason: "Waiting for security checks",
      severity: "pending",
      href: auditHref,
      actionLabel: "Review →",
    });
  } else if (security.tone === "warning") {
    items.push({
      id: `plugin:${pkg._id}:review`,
      kind: "plugin",
      title: pkg.displayName,
      reason: "Needs security review",
      severity: "warning",
      href: auditHref,
      actionLabel: "Review →",
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
