import type {
  PackageSkillSpectorIssue as SkillSpectorIssue,
  PackageSkillSpectorAnalysis as SkillSpectorAnalysis,
} from "clawhub-schema";
import { MarkdownPreview } from "./MarkdownPreview";
import { getScanStatusInfo } from "./securityAuditModel";
import { Badge, type BadgeProps } from "./ui/badge";

export function ScanResultBadge({
  status,
  label,
  className,
}: {
  status: string;
  label?: string;
  className?: string;
}) {
  const statusInfo = getScanStatusInfo(status);
  const variant = statusInfo.badgeVariant;
  return (
    <Badge
      variant={variant as BadgeProps["variant"]}
      className={`min-h-0 rounded-[var(--oc-radius-control)] px-2.5 py-0.5 text-[var(--oc-font-size-xs)] leading-[1.3] ${statusInfo.className}${className ? ` ${className}` : ""}`}
    >
      {label ?? statusInfo.label}
    </Badge>
  );
}

function getFindingSeverityBadgeMeta(severity: string): {
  label: string;
  variant: BadgeProps["variant"];
} {
  switch (severity.trim().toLowerCase()) {
    case "critical":
      return { label: "Critical", variant: "destructive" };
    case "high":
      return { label: "High", variant: "destructive" };
    case "warn":
    case "warning":
      return { label: "Warn", variant: "warning" };
    case "medium":
      return { label: "Medium", variant: "warning" };
    case "low":
      return { label: "Low", variant: "review" };
    case "info":
      return { label: "Info", variant: "compact" };
    default:
      return { label: severity || "Finding", variant: "compact" };
  }
}

function FindingSeverityBadge({ severity }: { severity: string }) {
  const severityBadge = getFindingSeverityBadgeMeta(severity);
  return <Badge variant={severityBadge.variant}>{severityBadge.label}</Badge>;
}

function formatSkillSpectorConfidence(confidence?: number) {
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) return null;
  const percent = confidence <= 1 ? confidence * 100 : confidence;
  return `${Math.round(percent)}% confidence`;
}

const SKILLSPECTOR_RULE_LABELS: Record<string, string> = {
  P1: "Instruction Override",
  P2: "Hidden Instructions",
  P3: "Exfiltration Commands",
  P4: "Behavior Manipulation",
  P5: "Harmful Content",
  P6: "Direct Prompt Leakage",
  P7: "Indirect Prompt Extraction",
  P8: "Tool-Based Prompt Exfiltration",
  E1: "External Transmission",
  E2: "Environment Variable Harvesting",
  E3: "File System Enumeration",
  E4: "Context Leakage",
  PE1: "Excessive Permissions",
  PE2: "Sudo/Root Execution",
  PE3: "Credential Access",
  LP3: "Undeclared Tool Scope",
  SDI1: "Description-Behavior Mismatch",
  SDI2: "Context-Inappropriate Capability",
  SDI3: "Scope Creep",
  SDI4: "Intent-Code Divergence",
  SQP1: "Vague Triggers",
  SQP2: "Missing User Warnings",
  SQP3: "Natural-Language Policy Violations",
};

function normalizeSkillSpectorRuleId(ruleId: string) {
  return ruleId
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function formatFallbackSkillSpectorTitle(ruleId: string) {
  return ruleId
    .trim()
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function getSkillSpectorIssueTitle(issue: SkillSpectorIssue) {
  const pattern = issue.pattern?.trim();
  if (pattern) return pattern;
  const normalized = normalizeSkillSpectorRuleId(issue.issueId);
  return SKILLSPECTOR_RULE_LABELS[normalized] ?? formatFallbackSkillSpectorTitle(issue.issueId);
}

const SOURCE_LANGUAGES: Record<string, string> = {
  js: "js",
  mjs: "js",
  cjs: "js",
  jsx: "jsx",
  ts: "ts",
  tsx: "tsx",
  py: "python",
  sh: "sh",
  bash: "bash",
  zsh: "shell",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  nix: "nix",
  rs: "rust",
  go: "go",
  html: "html",
  css: "css",
  md: "md",
  mdx: "md",
  markdown: "md",
  diff: "diff",
};

function sourceAsMarkdown(source: string, file?: string) {
  const name = file?.split("/").at(-1)?.toLowerCase() ?? "";
  const extension = name.split(".").at(-1) ?? "";
  const language = name === "dockerfile" ? "dockerfile" : (SOURCE_LANGUAGES[extension] ?? "text");
  // A source snippet can itself contain Markdown fences or HTML. Keep all of it literal.
  let fenceLength = 3;
  for (const match of source.matchAll(/`+/g))
    fenceLength = Math.max(fenceLength, match[0].length + 1);
  const fence = "`".repeat(fenceLength);
  return `${fence}${language}\n${source}\n${fence}`;
}

function SkillSpectorContent({
  issue,
  contentSnippet,
}: {
  issue: SkillSpectorIssue;
  contentSnippet?: string | null;
}) {
  const scannerSnippet = issue.codeSnippet?.trim() ? issue.codeSnippet : undefined;
  const isMarkdownFile = !issue.file || /\.(?:md|mdx|markdown)$/i.test(issue.file);
  const fileSnippet = contentSnippet?.trim() ? contentSnippet : undefined;
  // File-wide findings can use the default location SKILL.md:1. Its frontmatter
  // delimiter is not useful evidence of a missing permission declaration.
  const usableFileSnippet =
    isMarkdownFile && /^(?:---|\+\+\+|\.\.\.)$/.test(fileSnippet?.trim() ?? "")
      ? undefined
      : fileSnippet;
  const snippet = scannerSnippet || usableFileSnippet;
  if (!snippet)
    return (
      <p className="skill-spector-evidence-meta">
        No source excerpt is available for this finding.
      </p>
    );

  const lineCount = snippet.split("\n").length;
  const start = issue.startLine;
  const shownEnd = start === undefined ? undefined : start + lineCount - 1;
  const location = issue.file ?? "";
  const sourceRange =
    start === undefined ? "" : `:${start}${shownEnd === start ? "" : `–${shownEnd}`}`;
  const reportedLine = start === undefined ? "" : ` (reported line ${start})`;
  const label = scannerSnippet
    ? `Scanner excerpt${location ? ` · ${location}` : ""}${reportedLine}`
    : `${location}${sourceRange}`;
  const reportedLineCount =
    start !== undefined && issue.endLine !== undefined ? issue.endLine - start + 1 : lineCount;
  const isMarkdownSnippet =
    Boolean(scannerSnippet) && isMarkdownFile && /^\s{0,3}(?:`{3,}|~{3,})/m.test(snippet);

  return (
    <div className="skill-spector-evidence" data-analytics-public-detail="">
      <p className="skill-spector-evidence-meta">
        {label}
        {scannerSnippet ? <span>May include surrounding context.</span> : null}
      </p>
      <MarkdownPreview variant="report">
        {isMarkdownSnippet ? snippet : sourceAsMarkdown(snippet, issue.file)}
      </MarkdownPreview>
      {!scannerSnippet && reportedLineCount > lineCount ? (
        <p className="skill-spector-evidence-meta">
          Showing {lineCount} of {reportedLineCount} reported lines.
        </p>
      ) : null}
    </div>
  );
}

function SkillSpectorFindingCard({
  contentSnippet,
  issue,
}: {
  contentSnippet?: string | null;
  issue: SkillSpectorIssue;
}) {
  const confidence = formatSkillSpectorConfidence(issue.confidence);
  return (
    <article className="static-analysis-finding">
      <div className="static-analysis-finding-header">
        <h3 className="agentic-risk-finding-title">{getSkillSpectorIssueTitle(issue)}</h3>
        <div className="agentic-risk-finding-badges">
          <FindingSeverityBadge severity={issue.severity} />
        </div>
      </div>
      <dl className="static-analysis-finding-details">
        <div>
          <dt>Category</dt>
          <dd>{issue.category || "Not specified by scanner"}</dd>
        </div>
        <div>
          <dt>Confidence</dt>
          <dd>{confidence || "Not specified by scanner"}</dd>
        </div>
        <div>
          <dt>Finding</dt>
          <dd data-analytics-public-detail="">
            <MarkdownPreview variant="report" highlight={false}>
              {issue.explanation?.trim() || issue.finding || ""}
            </MarkdownPreview>
          </dd>
        </div>
        <div>
          <dt>Content</dt>
          <dd>
            <SkillSpectorContent issue={issue} contentSnippet={contentSnippet} />
          </dd>
        </div>
      </dl>
    </article>
  );
}

export function SkillSpectorFindings({
  analysis,
  contentSnippets,
}: {
  analysis: SkillSpectorAnalysis;
  contentSnippets?: Record<number, string>;
}) {
  return (
    <div className="static-analysis-findings">
      {analysis.issues.map((issue, index) => (
        <SkillSpectorFindingCard
          key={`${issue.issueId}-${index}`}
          contentSnippet={contentSnippets?.[index]}
          issue={issue}
        />
      ))}
    </div>
  );
}
