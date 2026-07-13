import { readFile, writeFile } from "node:fs/promises";

export type AuditSeverity = "error" | "warning" | "info";
export type AuditKind = "mechanical" | "judgment";

export type AuditFinding = {
  id: string;
  severity: AuditSeverity;
  kind: AuditKind;
  file: string;
  line: number;
  message: string;
  remediation: string;
  reference: string;
};

export type AuditSummary = {
  errors: number;
  warnings: number;
  info: number;
};

export type AuditReport = {
  designSystemVersion: string;
  consumerSha: string;
  auditBaseSha: string;
  generatedAt: string;
  summary: AuditSummary;
  findings: AuditFinding[];
  changedFiles: string[];
  validationCommands: string[];
  renderedRoutes: string[];
  screenshotPaths: string[];
  validationPassed: boolean;
};

const severityRank: Record<AuditSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

function findingKey(finding: AuditFinding) {
  return [finding.id, finding.file, finding.line, finding.message].join("\u0000");
}

export function isAuditFinding(value: unknown): value is AuditFinding {
  if (!value || typeof value !== "object") return false;
  const finding = value as Partial<AuditFinding>;
  return (
    typeof finding.id === "string" &&
    ["error", "warning", "info"].includes(finding.severity ?? "") &&
    ["mechanical", "judgment"].includes(finding.kind ?? "") &&
    typeof finding.file === "string" &&
    Number.isInteger(finding.line) &&
    Number(finding.line) > 0 &&
    typeof finding.message === "string" &&
    typeof finding.remediation === "string" &&
    typeof finding.reference === "string"
  );
}

export function parseFindings(value: unknown): AuditFinding[] {
  if (!value || typeof value !== "object") throw new Error("audit result must be an object");
  const findings = (value as { findings?: unknown }).findings;
  if (!Array.isArray(findings) || !findings.every(isAuditFinding)) {
    throw new Error("audit result findings do not match the report contract");
  }
  return findings;
}

export function sortAndDedupeFindings(findings: AuditFinding[]) {
  const unique = new Map<string, AuditFinding>();
  for (const finding of findings) {
    const key = findingKey(finding);
    const existing = unique.get(key);
    if (!existing || severityRank[finding.severity] < severityRank[existing.severity]) {
      unique.set(key, finding);
    }
  }
  return [...unique.values()].sort(
    (left, right) =>
      severityRank[left.severity] - severityRank[right.severity] ||
      left.id.localeCompare(right.id) ||
      left.file.localeCompare(right.file) ||
      left.line - right.line,
  );
}

export function summarizeFindings(findings: AuditFinding[]): AuditSummary {
  return findings.reduce<AuditSummary>(
    (summary, finding) => {
      if (finding.severity === "error") summary.errors += 1;
      else if (finding.severity === "warning") summary.warnings += 1;
      else summary.info += 1;
      return summary;
    },
    { errors: 0, warnings: 0, info: 0 },
  );
}

export function shouldOpenAuditPullRequest(summary: AuditSummary) {
  return summary.errors > 0 || summary.warnings > 0 || summary.info > 5;
}

export function curatedFindings(findings: AuditFinding[]) {
  const sorted = sortAndDedupeFindings(findings);
  const errors = sorted.filter((finding) => finding.severity === "error");
  const nonErrors = sorted.filter((finding) => finding.severity !== "error");
  return {
    expanded: [...errors, ...nonErrors.slice(0, 5)],
    omittedNonErrors: Math.max(0, nonErrors.length - 5),
  };
}

function findingMarkdown(finding: AuditFinding) {
  return [
    `### ${finding.severity.toUpperCase()}: \`${finding.id}\``,
    "",
    `- Evidence: [${finding.file}](../../${finding.file}#L${finding.line})`,
    `- Kind: ${finding.kind}`,
    `- Finding: ${finding.message}`,
    `- Remediation: ${finding.remediation}`,
    `- Contract: \`${finding.reference}\``,
  ].join("\n");
}

export function renderAuditMarkdown(report: AuditReport) {
  const { expanded, omittedNonErrors } = curatedFindings(report.findings);
  const lines = [
    "# ClawHub design audit",
    "",
    `- Design system: \`${report.designSystemVersion}\``,
    `- ClawHub commit: \`${report.consumerSha}\``,
    `- Comparison base: \`${report.auditBaseSha}\``,
    `- Generated: ${report.generatedAt}`,
    `- Validation: ${report.validationPassed ? "passed" : "failed"}`,
    "",
    "## Summary",
    "",
    `- Errors: ${report.summary.errors}`,
    `- Warnings: ${report.summary.warnings}`,
    `- Informational: ${report.summary.info}`,
    `- Safe source fixes: ${report.changedFiles.length}`,
    "",
    "## Validation",
    "",
    ...report.validationCommands.map((command) => `- \`${command}\``),
    "",
    "## Rendered routes",
    "",
    ...report.renderedRoutes.map((route) => `- \`${route}\``),
    "",
    "## Findings",
    "",
  ];

  if (expanded.length === 0) {
    lines.push("No significant design-system drift was found.");
  } else {
    lines.push(...expanded.flatMap((finding) => [findingMarkdown(finding), ""]));
  }

  if (omittedNonErrors > 0) {
    lines.push(`${omittedNonErrors} additional non-error findings are retained in JSON.`);
  }

  return `${lines.join("\n").trim()}\n`;
}

export function renderPullRequestBody(report: AuditReport, runUrl: string) {
  const { expanded, omittedNonErrors } = curatedFindings(report.findings);
  const lines = [
    "## Audit",
    "",
    `- Design system: \`${report.designSystemVersion}\``,
    `- Audited ClawHub SHA: \`${report.consumerSha}\``,
    `- Comparison base: \`${report.auditBaseSha}\``,
    `- Findings: ${report.summary.errors} errors, ${report.summary.warnings} warnings, ${report.summary.info} informational`,
    `- Safe fixes included: ${report.changedFiles.length > 0 ? report.changedFiles.join(", ") : "none"}`,
    `- Workflow run: ${runUrl}`,
    "",
    "## Validation",
    "",
    ...report.validationCommands.map((command) => `- \`${command}\``),
    "",
    "## Curated findings",
    "",
  ];

  if (expanded.length === 0) {
    lines.push("No significant design-system drift was found.");
  } else {
    lines.push(
      ...expanded.map(
        (finding) =>
          `- **${finding.severity}** \`${finding.id}\` at \`${finding.file}:${finding.line}\`: ${finding.message}`,
      ),
    );
  }
  if (omittedNonErrors > 0) {
    lines.push(`- ${omittedNonErrors} additional non-error findings are in the JSON report.`);
  }

  lines.push(
    "",
    "## Artifacts",
    "",
    "- `design-audits/latest/design-audit.json`",
    "- `design-audits/latest/design-audit.md`",
    "- screenshots and full logs are attached to the workflow run",
    "",
    "This pull request is intentionally draft. The workflow never merges, deploys, publishes, or mutates backend data.",
  );
  return `${lines.join("\n")}\n`;
}

export async function readFindings(path: string) {
  return parseFindings(JSON.parse(await readFile(path, "utf8")));
}

export async function writeReport(path: string, report: AuditReport) {
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
}
