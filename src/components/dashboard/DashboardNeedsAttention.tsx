import { Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { ChevronRight, EyeOff, Hammer, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { buildSkillDetailHref } from "../../lib/ownerRoute";
import { formatValidationFindingMessage } from "../../lib/pluginValidationFormat";
import { timeAgo } from "../../lib/timeAgo";
import { InstallCopyButton } from "../InstallCopyButton";
import { SkillSpectorAuditPanel } from "../SecurityAuditPage";
import type { SkillSpectorAnalysis } from "../SkillSecurityScanResults";
import type { DashboardAttentionItem } from "./types";

const ATTENTION_STRIP_LIMIT = 5;

type DashboardNeedsAttentionProps = {
  items: DashboardAttentionItem[];
};

type DashboardAttentionGroup = {
  key: string;
  title: string;
  items: DashboardAttentionItem[];
  primary: DashboardAttentionItem;
};

type SkillAuditResult = {
  skill?: {
    displayName?: string;
  } | null;
  owner?: {
    _id?: string;
    handle?: string | null;
  } | null;
  latestVersion?: {
    version?: string;
    skillSpectorAnalysis?: SkillSpectorAnalysis | null;
  } | null;
};

type PluginInspectorFinding = {
  _id?: string;
  code?: string;
  packageName?: string;
  version?: string;
  findingKind?: "error" | "warning" | string;
  issueClass?: string;
  severity?: string;
  message?: string;
  evidence?: string[];
  authorRemediation?: {
    summary?: string;
    docsUrl?: string;
  };
  targetOpenClawVersion?: string;
};

const PLUGIN_VALIDATE_CLI = "clawhub package validate <path-to-plugin>";

export function DashboardNeedsAttention({ items }: DashboardNeedsAttentionProps) {
  const [selectedGroup, setSelectedGroup] = useState<DashboardAttentionGroup | null>(null);

  useEffect(() => {
    if (!selectedGroup) return undefined;
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedGroup(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [selectedGroup]);

  if (items.length === 0) return null;

  const groups = groupAttentionItems(items);
  const visibleGroups = groups.slice(0, ATTENTION_STRIP_LIMIT);

  return (
    <>
      <section className="dashboard-attention-strip" aria-label="Needs attention">
        <header className="dashboard-section-head dashboard-attention-strip-header">
          <div className="dashboard-section-head-main">
            <h2 className="dashboard-section-title">Needs attention</h2>
          </div>
          {groups.length > ATTENTION_STRIP_LIMIT ? (
            <Link
              to="/dashboard"
              search={{ kind: "attention" }}
              className="dashboard-attention-view-all"
            >
              View all ({groups.length})
            </Link>
          ) : null}
        </header>
        <div className="results-list">
          {visibleGroups.map((group) => {
            const { primary } = group;
            const context = attentionContextLine(group);
            const secondary = [primary.version ? `v${primary.version}` : null, context]
              .filter(Boolean)
              .join(" · ");
            return (
              <button
                key={group.key}
                type="button"
                className={`skill-list-item skill-list-item-no-icon dashboard-attention-row is-${primary.severity}`}
                aria-label={attentionRowLabel(group)}
                onClick={() => setSelectedGroup(group)}
              >
                <div className="skill-list-item-body">
                  <div className="skill-list-item-main">
                    <span className="dashboard-attention-kind">
                      {primary.kind === "plugin" ? "Plugin" : "Skill"}
                    </span>
                    <span className="skill-list-item-name">{group.title}</span>
                  </div>
                  {groupVisibilityLabel(group) ? (
                    <span className="dashboard-attention-visibility">
                      <EyeOff size={12} aria-hidden="true" />
                      {groupVisibilityLabel(group)}
                    </span>
                  ) : null}
                  {secondary ? (
                    <p className="skill-list-item-summary dashboard-attention-context">
                      {secondary}
                    </p>
                  ) : null}
                </div>
                <div className="dashboard-attention-summary">
                  <span className={`dashboard-attention-state is-${primary.severity}`}>
                    {severityLabel(primary.severity)}
                  </span>
                </div>
                <div className="skill-list-item-meta">
                  <span className="dashboard-attention-cta">{primary.actionLabel}</span>
                </div>
              </button>
            );
          })}
        </div>
      </section>
      {selectedGroup ? (
        <div
          className="dashboard-review-layer"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelectedGroup(null);
          }}
        >
          <aside
            className={`dashboard-review-sheet ${
              selectedGroup.primary.kind === "plugin" ? "is-plugin-validation" : ""
            }`}
            role="dialog"
            aria-modal="true"
            aria-label={`${selectedGroup.title} review`}
          >
            <DashboardReviewSheetContent
              group={selectedGroup}
              onClose={() => setSelectedGroup(null)}
            />
          </aside>
        </div>
      ) : null}
    </>
  );
}

function DashboardReviewSheetContent({
  group,
  onClose,
}: {
  group: DashboardAttentionGroup;
  onClose: () => void;
}) {
  const isSkill = group.primary.kind === "skill";
  const skillAudit = useQuery(
    api.skills.getBySlug,
    isSkill && group.primary.slug
      ? { slug: group.primary.slug, ownerHandle: group.primary.ownerHandle }
      : "skip",
  ) as SkillAuditResult | undefined;
  const pluginFindings = useQuery(
    api.packages.listPackageInspectorWarningsForManager,
    !isSkill && group.primary.packageName ? { name: group.primary.packageName, limit: 100 } : "skip",
  ) as PluginInspectorFinding[] | undefined;

  return (
    <div className="security-report-panel security-report-panel-compact dashboard-review-report">
      <div className="dashboard-review-sheet-head security-report-panel-header">
        <div>
          <h2>{group.title}</h2>
          <div className="dashboard-review-sheet-meta">
            {reviewHeaderMeta(group).map((item) => (
              <span key={item.key} className={`is-${item.key}`}>
                {item.label}
              </span>
            ))}
          </div>
        </div>
        <button
          type="button"
          className="dashboard-review-sheet-close"
          aria-label="Close review"
          onClick={onClose}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      {isSkill ? (
        <SkillSpectorSheetReview group={group} audit={skillAudit} />
      ) : (
        <PluginValidationSheetReview group={group} findings={pluginFindings} />
      )}
    </div>
  );
}

function SkillSpectorSheetReview({
  group,
  audit,
}: {
  group: DashboardAttentionGroup;
  audit?: SkillAuditResult;
}) {
  const analysis = audit?.latestVersion?.skillSpectorAnalysis;
  const ownerSegment =
    audit?.owner?.handle ?? group.primary.ownerHandle ?? audit?.owner?._id ?? "local";
  const slug = group.primary.slug ?? group.key;

  return (
    <div className="dashboard-review-skillspector">
      <SkillSpectorAuditPanel
        entity={{
          kind: "skill",
          title: audit?.skill?.displayName ?? group.title,
          name: slug,
          version: audit?.latestVersion?.version ?? group.primary.version ?? null,
          owner: audit?.owner ?? null,
          detailPath: buildSkillDetailHref(ownerSegment, slug),
        }}
        analysis={analysis ?? null}
      />
    </div>
  );
}

function PluginValidationSheetReview({
  group,
  findings,
}: {
  group: DashboardAttentionGroup;
  findings?: PluginInspectorFinding[];
}) {
  const visibleFindings = findings?.length ? findings.filter((finding) => finding.message) : [];
  const fallbackFindings: PluginInspectorFinding[] = group.items.map((item) => ({
    _id: item.id,
    findingKind: item.severity === "destructive" ? "error" : "warning",
    message: attentionIssueSummary(item),
    issueClass: issueTypeLabel(item.issueType),
  }));
  const baseFindings = visibleFindings.length ? visibleFindings : fallbackFindings;
  const displayedFindings = withLocalValidationFixtures(baseFindings).sort(compareFindings);
  const errors = displayedFindings.filter((finding) => finding.findingKind === "error");
  const warnings = displayedFindings.filter((finding) => finding.findingKind !== "error");
  const version = displayedFindings.find((finding) => finding.version)?.version ?? null;
  const instructions = buildValidationInstructions(group.title, version, displayedFindings);

  return (
    <>
      <header className="plugin-validation-overview">
        <div className="plugin-validation-panel-title-row">
          <h3 className="plugin-validation-panel-title">Validation</h3>
          <span className="plugin-validation-panel-stats" aria-label="Validation summary">
            <span className="plugin-validation-panel-stat">
              {errors.length} {errors.length === 1 ? "error" : "errors"}
            </span>
            <span className="plugin-validation-panel-stats-sep" aria-hidden="true">·</span>
            <span className="plugin-validation-panel-stat">
              {warnings.length} {warnings.length === 1 ? "warning" : "warnings"}
            </span>
          </span>
        </div>
        <p className="plugin-validation-summary-hint">
          We found <strong>{displayedFindings.length} issues</strong>
          {version ? ` with version ${version}` : ""} of <strong>{group.title}</strong>. Review the
          findings, apply the fixes, and upload a new version.
        </p>
        <div className="plugin-validation-actions" role="toolbar" aria-label="Validation actions">
          <div className="plugin-validation-actions-row">
            <div className="plugin-validation-command-block">
              <span className="plugin-validation-toolbar-label">Validate locally before publishing</span>
              <div className="plugin-validation-toolbar">
                <div className="plugin-validation-toolbar-cli">
                  <code className="plugin-validation-command">{PLUGIN_VALIDATE_CLI}</code>
                  <InstallCopyButton
                    text={PLUGIN_VALIDATE_CLI}
                    ariaLabel="Copy validate command"
                    showLabel={false}
                    className="plugin-validation-toolbar-copy"
                  />
                </div>
              </div>
            </div>
            <div className="plugin-validation-toolbar-agent">
              <InstallCopyButton
                text={instructions}
                label="Copy instructions"
                tooltip="Paste into your coding agent to fix these findings."
                ariaLabel="Copy fix instructions"
                className="plugin-validation-panel-agent"
              />
            </div>
          </div>
        </div>
      </header>
      <section className="plugin-validation-panel dashboard-review-complete-validation">
      <section className="plugin-validation-panel-findings" aria-label="Issues to review">
        <ValidationFindingGroup label="Errors" kind="error" findings={errors} />
        <ValidationFindingGroup label="Warnings" kind="warning" findings={warnings} />
      </section>
    </section>
    </>
  );
}

function ValidationFindingGroup({
  label,
  kind,
  findings,
}: {
  label: string;
  kind: "error" | "warning";
  findings: PluginInspectorFinding[];
}) {
  if (findings.length === 0) return null;
  return (
    <div className={`plugin-validation-findings-group is-${kind}`}>
      <h4 className={`plugin-validation-group-label is-${kind}`}>
        {label} ({findings.length})
      </h4>
      <div className="plugin-warning-list">
        {findings.map((finding, index) => (
          <ValidationFindingCard
            key={finding._id ?? finding.code ?? `${finding.message}:${index}`}
            finding={finding}
          />
        ))}
      </div>
    </div>
  );
}

function ValidationFindingCard({ finding }: { finding: PluginInspectorFinding }) {
  const kind = finding.findingKind === "error" ? "error" : "warning";
  const category = formatIssueClass(finding.issueClass);
  return (
    <details className={`plugin-warning-item plugin-warning-item-details is-${kind}`}>
      <summary className="plugin-warning-item-summary">
        <div className="plugin-warning-item-lead">
          <span className={`plugin-warning-severity-dot is-${kind}`} aria-hidden="true" />
          <div className="plugin-warning-item-copy">
            <div className="plugin-warning-item-title-row">
              <p className="plugin-warning-item-message">
                {formatValidationFindingMessage(finding.message ?? "Needs validation review")}
              </p>
              {finding.severity && /^P[01]$/i.test(finding.severity) ? (
                <span className={`plugin-warning-priority-badge is-${kind}`}>{finding.severity}</span>
              ) : null}
              <ChevronRight className="plugin-warning-item-expand-chevron" size={14} aria-hidden="true" />
            </div>
            <p className="plugin-warning-item-meta">
              <span className="plugin-warning-item-meta-text">
                {category ? <span>{category}</span> : null}
                {category && finding.code ? <span aria-hidden="true"> · </span> : null}
                {finding.code ? <code className="plugin-warning-item-code">{finding.code}</code> : null}
              </span>
            </p>
          </div>
        </div>
      </summary>
      <div className="plugin-warning-item-body">
        {finding.authorRemediation?.summary ? (
          <div className="plugin-warning-fix-guide">
            <div className="plugin-warning-fix-guide-copy">
              <p className="plugin-warning-fix-guide-label">
                <Hammer size={14} aria-hidden="true" /> How to fix
              </p>
              <p className="plugin-warning-fix-copy">{finding.authorRemediation.summary}</p>
            </div>
            {finding.authorRemediation.docsUrl ? (
              <a href={finding.authorRemediation.docsUrl} target="_blank" rel="noreferrer" className="plugin-warning-fix-link">
                View fix guide ↗
              </a>
            ) : null}
          </div>
        ) : null}
        {finding.evidence?.length ? (
          <div className="plugin-warning-evidence-block">
            <p className="plugin-warning-evidence-label">Technical evidence</p>
            {finding.evidence.slice(0, 4).map((entry) => (
              <div className="plugin-warning-evidence-line" key={entry}>{entry}</div>
            ))}
          </div>
        ) : null}
      </div>
    </details>
  );
}

function formatIssueClass(issueClass?: string) {
  const known: Record<string, string> = {
    "upstream-metadata": "Metadata",
    "deprecation-warning": "Deprecated API",
    "compatibility-error": "Compatibility",
    "compatibility-warning": "Compatibility",
  };
  if (!issueClass || issueClass === "inspector-gap") return null;
  return (
    known[issueClass] ??
    issueClass
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
  );
}

function compareFindings(a: PluginInspectorFinding, b: PluginInspectorFinding) {
  const priority = (value?: string) => Number.parseInt(value?.replace(/^P/i, "") ?? "99", 10);
  return priority(a.severity) - priority(b.severity);
}

function withLocalValidationFixtures(findings: PluginInspectorFinding[]) {
  if (!import.meta.env.DEV || import.meta.env.MODE !== "development" || findings.length === 0) {
    return findings;
  }
  const template = findings[0] ?? {};
  const mocks: PluginInspectorFinding[] = [
    {
      ...template,
      code: "package-plugin-api-compat-missing",
      findingKind: "error",
      issueClass: "compatibility-error",
      severity: "P0",
      message: "openclaw.compat.pluginApi is missing from package.json.",
      authorRemediation: {
        summary: "Add openclaw.compat.pluginApi with the minimum API version your plugin supports.",
        docsUrl: "https://docs.openclaw.ai/clawhub/plugin-validation-fixes#package-plugin-api-compat-missing",
      },
      evidence: ['package.json has no "openclaw.compat.pluginApi" field'],
    },
    {
      ...template,
      code: "package-min-host-version-drift",
      findingKind: "warning",
      issueClass: "upstream-metadata",
      severity: "P2",
      message: "OpenClaw package minimum host version drifts from build target.",
      authorRemediation: {
        summary: "Set the minimum host version to the OpenClaw range the plugin was tested against.",
        docsUrl: "https://docs.openclaw.ai/clawhub/plugin-validation-fixes#package-min-host-version-drift",
      },
      evidence: ["minHostVersion: >=2026.4.25", "buildOpenClawVersion: 2026.6.9"],
    },
    {
      ...template,
      code: "missing-expected-seam",
      findingKind: "warning",
      issueClass: "compatibility-warning",
      severity: "P3",
      message: "Plugin manifest does not declare the expected registration seam.",
      authorRemediation: {
        summary: "Export activate() and register capabilities through the current plugin API.",
        docsUrl: "https://docs.openclaw.ai/clawhub/plugin-validation-fixes#missing-expected-seam",
      },
      evidence: ["manifest.extensions missing ./dist/index.js reference"],
    },
  ];
  const existingCodes = new Set(findings.map((finding) => finding.code));
  return [...findings, ...mocks.filter((finding) => !existingCodes.has(finding.code))];
}

function buildValidationInstructions(
  packageName: string,
  version: string | null,
  findings: PluginInspectorFinding[],
) {
  const lines = [
    `Fix the following OpenClaw plugin validation findings for package "${packageName}".`,
    ...(version ? [`Validated release: v${version}.`] : []),
    "",
    "Make the minimum code and manifest changes needed to resolve every issue below.",
    "After editing, run locally:",
    PLUGIN_VALIDATE_CLI,
    "",
  ];
  for (const finding of findings) {
    const kind = finding.findingKind === "error" ? "Error" : "Warning";
    lines.push(`## ${finding.code ?? kind}`);
    lines.push(`**${kind}:** ${formatValidationFindingMessage(finding.message ?? "Needs review")}`);
    if (finding.authorRemediation?.summary) {
      lines.push(`**How to fix:** ${finding.authorRemediation.summary}`);
    }
    if (finding.authorRemediation?.docsUrl) {
      lines.push(`**Docs:** ${finding.authorRemediation.docsUrl}`);
    }
    if (finding.evidence?.length) {
      lines.push("**Evidence:**", ...finding.evidence.map((entry) => `- ${entry}`));
    }
    lines.push("");
  }
  lines.push("Confirm all findings are resolved before publishing a new release.");
  return lines.join("\n").trim();
}

function groupAttentionItems(items: DashboardAttentionItem[]) {
  const groups = new Map<string, DashboardAttentionGroup>();

  for (const item of items) {
    const key = attentionGroupKey(item);
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        key,
        title: item.title,
        items: [item],
        primary: item,
      });
      continue;
    }

    existing.items.push(item);
    if (attentionPriority(item) > attentionPriority(existing.primary)) {
      existing.primary = item;
    }
  }

  return Array.from(groups.values()).sort(
    (a, b) => attentionPriority(b.primary) - attentionPriority(a.primary),
  );
}

function attentionGroupKey(item: DashboardAttentionItem) {
  return item.id.replace(/:(blocked|pending-scan|review|quality|visibility|validation)$/, "");
}

function attentionPriority(item: DashboardAttentionItem) {
  const severity = { destructive: 30, warning: 20, pending: 10 }[item.severity];
  const issue = { security: 4, validation: 3, quality: 2, visibility: 1 }[item.issueType];
  return severity + issue;
}

function severityLabel(severity: DashboardAttentionItem["severity"]) {
  if (severity === "destructive") return "Blocked";
  if (severity === "pending") return "Scan pending";
  return "Needs review";
}

function issueTypeLabel(issueType: DashboardAttentionItem["issueType"]) {
  if (issueType === "validation") return "Validation";
  if (issueType === "quality") return "Quality";
  if (issueType === "visibility") return "Visibility";
  return "Security";
}

function reviewHeaderMeta(group: DashboardAttentionGroup) {
  const { primary } = group;
  return [
    { key: "kind", label: primary.kind === "plugin" ? "Plugin" : "Skill" },
    primary.ownerHandle ? { key: "owner", label: `@${primary.ownerHandle}` } : null,
    primary.version ? { key: "version", label: `v${primary.version}` } : null,
    primary.updatedAt
      ? { key: "updated", label: `Updated ${timeAgo(primary.updatedAt)}` }
      : null,
  ].filter((item): item is { key: string; label: string } => item !== null);
}

function groupVisibilityLabel(group: DashboardAttentionGroup) {
  const visibility = group.items.find((item) => item.issueType === "visibility");
  if (!visibility) return null;
  return visibility.reason === "Removed" ? "Removed" : "Hidden";
}

function isReasonRedundantWithStatus(item: DashboardAttentionItem) {
  if (item.issueType !== "security") return false;

  const { reason, severity } = item;
  const normalized = reason.trim().toLowerCase();
  if (severity === "destructive") {
    return normalized === "blocked by security checks" || normalized === "blocked";
  }
  if (severity === "pending") {
    return normalized === "waiting for security checks";
  }
  return normalized === "needs security review";
}

function attentionContextLine(group: DashboardAttentionGroup) {
  return group.items
    .flatMap((item) => {
      if (item.issueType === "visibility") return [];
      const preview = item.preview?.trim();
      if (preview) return [preview];
      if (isReasonRedundantWithStatus(item)) return [];
      return [item.reason];
    })
    .join(" · ");
}

function attentionIssueSummary(item: DashboardAttentionItem) {
  const label = issueTypeLabel(item.issueType);
  const preview = item.preview?.trim();
  if (preview) return `${label}: ${preview}`;
  if (isReasonRedundantWithStatus(item)) return `${label}: ${severityLabel(item.severity)}`;
  return `${label}: ${item.reason}`;
}

function attentionRowLabel(group: DashboardAttentionGroup) {
  const { primary } = group;
  const parts = [
    group.title,
    `${group.items.length} issue${group.items.length === 1 ? "" : "s"}`,
    ...group.items.map((item) => attentionIssueSummary(item)),
    severityLabel(primary.severity),
  ];
  parts.push(primary.actionLabel.replace(" →", ""));
  return parts.join(". ");
}
