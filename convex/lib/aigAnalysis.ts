import type { Doc } from "../_generated/dataModel";

type StoredAigAnalysis = NonNullable<Doc<"skillVersions">["aigAnalysis"]>;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function reusableAigAnalysis(value: unknown): StoredAigAnalysis | undefined {
  const analysis = asRecord(value);
  const status = typeof analysis.status === "string" ? analysis.status : "";
  if (!new Set(["clean", "suspicious", "malicious"]).has(status)) return undefined;
  if (
    typeof analysis.checkedAt !== "number" ||
    !Number.isFinite(analysis.checkedAt) ||
    typeof analysis.issueCount !== "number" ||
    !Number.isInteger(analysis.issueCount) ||
    analysis.issueCount < 0
  ) {
    return undefined;
  }
  if (!Array.isArray(analysis.findings)) return undefined;
  const findings: StoredAigAnalysis["findings"] = [];
  for (const findingValue of analysis.findings) {
    const finding = asRecord(findingValue);
    if (
      typeof finding.ruleId !== "string" ||
      typeof finding.level !== "string" ||
      typeof finding.message !== "string" ||
      !["title", "description", "file", "remediation"].every(
        (key) => finding[key] === undefined || typeof finding[key] === "string",
      ) ||
      !["startLine", "endLine"].every(
        (key) =>
          finding[key] === undefined ||
          (typeof finding[key] === "number" && Number.isFinite(finding[key])),
      )
    ) {
      return undefined;
    }
    findings.push({
      ruleId: finding.ruleId,
      level: finding.level,
      message: finding.message,
      ...(typeof finding.title === "string" ? { title: finding.title } : {}),
      ...(typeof finding.description === "string" ? { description: finding.description } : {}),
      ...(typeof finding.file === "string" ? { file: finding.file } : {}),
      ...(typeof finding.startLine === "number" ? { startLine: finding.startLine } : {}),
      ...(typeof finding.endLine === "number" ? { endLine: finding.endLine } : {}),
      ...(typeof finding.remediation === "string" ? { remediation: finding.remediation } : {}),
    });
  }
  const expectedStoredFindingCount = Math.min(analysis.issueCount, 25);
  if (
    findings.length !== expectedStoredFindingCount ||
    (status === "clean" && analysis.issueCount !== 0)
  ) {
    return undefined;
  }
  if (
    !["scannerVersion", "summary", "error"].every(
      (key) => analysis[key] === undefined || typeof analysis[key] === "string",
    )
  ) {
    return undefined;
  }
  return {
    status,
    issueCount: analysis.issueCount,
    findings,
    ...(typeof analysis.scannerVersion === "string"
      ? { scannerVersion: analysis.scannerVersion }
      : {}),
    ...(typeof analysis.summary === "string" ? { summary: analysis.summary } : {}),
    ...(typeof analysis.error === "string" ? { error: analysis.error } : {}),
    checkedAt: analysis.checkedAt,
  };
}
