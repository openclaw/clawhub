import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { diagnosticAnalyzerIds, diagnosticReasonCodes } from "./clawscan-diagnostic-report-enums";

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const count = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 10_000_000
    ? value
    : null;
const boolean = (value: unknown) => (typeof value === "boolean" ? value : null);
const counts = [
  "planned_work",
  "completed",
  "partial",
  "skipped",
  "failed",
  "unaccounted",
] as const;
const states = ["completed", "not_applicable", "degraded", "failed", "skipped", "unavailable"];

export function projectSkillSpectorReport(value: unknown) {
  const root = record(value);
  const completeness = record(root?.analysis_completeness);
  const rawAnalyzers = completeness?.analyzer_statuses;
  const analyzers = Array.isArray(rawAnalyzers) && rawAnalyzers.length <= 64 ? rawAnalyzers : null;
  const projectedAnalyzers = diagnosticAnalyzerIds.map((id) => {
    const matches = analyzers?.filter((entry) => record(entry)?.analyzer_id === id);
    const entry = matches?.length === 1 ? record(matches[0]) : undefined;
    return {
      id,
      status:
        typeof entry?.status === "string" && states.includes(entry.status)
          ? entry.status
          : "unknown",
      ...Object.fromEntries(counts.map((key) => [key, count(entry?.[key])])),
    };
  });
  const unknownAnalyzers =
    analyzers === null
      ? null
      : analyzers.filter(
          (entry) => !diagnosticAnalyzerIds.some((id) => record(entry)?.analyzer_id === id),
        ).length;
  const analyzerMetadataValid =
    analyzers !== null &&
    analyzers.length > 0 &&
    unknownAnalyzers === 0 &&
    diagnosticAnalyzerIds
      .filter((id) => id !== "structured_skill_roles")
      .every((id) => analyzers.some((entry) => record(entry)?.analyzer_id === id)) &&
    new Set(analyzers.map((entry) => record(entry)?.analyzer_id)).size === analyzers.length &&
    analyzers.every((entry) => {
      const item = record(entry);
      return (
        typeof item?.status === "string" &&
        states.includes(item.status) &&
        counts.every((key) => count(item[key]) !== null) &&
        Number(item.planned_work) ===
          Number(item.completed) +
            Number(item.partial) +
            Number(item.skipped) +
            Number(item.failed) +
            Number(item.unaccounted)
      );
    });
  const analyzerOutcomesComplete =
    analyzerMetadataValid &&
    analyzers!.every((entry) => {
      const item = record(entry)!;
      return (
        (item.status === "completed" || item.status === "not_applicable") &&
        item.partial === 0 &&
        item.skipped === 0 &&
        item.failed === 0 &&
        item.unaccounted === 0
      );
    });
  const exceptions =
    Array.isArray(completeness?.ledger_exceptions) &&
    completeness.ledger_exceptions.length <= 100_000
      ? completeness.ledger_exceptions
      : null;
  const reasonCounts: Record<string, number> = {};
  let unknownReasons: number | null = exceptions === null || analyzers === null ? null : 0;
  for (const entry of [...(exceptions ?? []), ...(analyzers ?? [])]) {
    const reason = record(entry)?.reason_code;
    if (reason === undefined && analyzers?.includes(entry)) continue;
    if (typeof reason === "string" && diagnosticReasonCodes.some((allowed) => allowed === reason))
      reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
    else if (unknownReasons !== null) unknownReasons += 1;
  }
  const issues =
    Array.isArray(root?.issues) && root.issues.length <= 100_000 && root.issues.every(record)
      ? root.issues
      : null;
  const fields = [
    "total_components",
    "scanned_components",
    "fully_inspected_files",
    "partially_inspected_files",
    "entirely_uninspected_files",
    "findings_before_filtering",
    "findings_after_filtering",
  ] as const;
  const completenessCounts = Object.fromEntries(
    fields.map((key) => [key, count(completeness?.[key])]),
  );
  const executionSuccessful = boolean(root?.execution_successful);
  const isComplete = boolean(completeness?.is_complete);
  const status =
    typeof completeness?.status === "string" &&
    ["complete", "partial", "failed"].includes(completeness.status)
      ? completeness.status
      : "unknown";
  return {
    executionSuccessful,
    completeness: {
      isComplete,
      status,
      executionSuccessful: boolean(completeness?.execution_successful),
      coveragePercent:
        typeof completeness?.coverage_percent === "number" &&
        Number.isFinite(completeness.coverage_percent) &&
        completeness.coverage_percent >= 0 &&
        completeness.coverage_percent <= 100
          ? completeness.coverage_percent
          : null,
      counts: completenessCounts,
      ledgerExceptionCount: exceptions?.length ?? null,
      limitationCount:
        Array.isArray(completeness?.limitations) &&
        completeness.limitations.every((entry) => typeof entry === "string")
          ? count(completeness.limitations.length)
          : null,
    },
    analyzers: projectedAnalyzers,
    analyzerMetadataValid,
    analyzerOutcomesComplete,
    unknownAnalyzers,
    reasonCounts,
    unknownReasons,
    findings: {
      reported: issues?.length ?? null,
      beforeFiltering: count(completeness?.findings_before_filtering),
      afterFiltering: count(completeness?.findings_after_filtering),
      suppressed: count(root?.suppressed_count),
    },
  };
}

async function readRestrictedDiagnosticJson(path: string) {
  let presence: "missing" | "invalid" | "present" = "missing";
  let sha256: string | null = null;
  let value: unknown;
  try {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      presence = "invalid";
      const info = await file.stat();
      if (!info.isFile() || info.size > 32 * 1024 * 1024 || (info.mode & 0o077) !== 0)
        throw new Error("Invalid terminal file");
      const bytes = await file.readFile();
      if (bytes.length !== info.size || bytes.length > 32 * 1024 * 1024)
        throw new Error("Invalid terminal size");
      sha256 = createHash("sha256").update(bytes).digest("hex");
      value = JSON.parse(bytes.toString("utf8"));
      if (!record(value)) throw new Error("Invalid terminal object");
      presence = "present";
    } finally {
      await file.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") presence = "invalid";
  }
  return { presence, sha256, value };
}

export async function skillSpectorTerminalMetadata(path: string) {
  const { presence, sha256, value } = await readRestrictedDiagnosticJson(path);
  return {
    presence,
    sha256,
    container: "skillspector-terminal-file",
    ...projectSkillSpectorReport(value),
  };
}

export async function fullProfileSkillSpectorMetadata(path: string) {
  const { presence, sha256, value } = await readRestrictedDiagnosticJson(path);
  const root = record(value);
  const raw =
    root?.schemaVersion === "clawscan-run-v1" && root.profile === "clawhub"
      ? record(record(root.scanners)?.skillspector)?.raw
      : undefined;
  return {
    presence,
    sha256,
    container: "clawscan-final-artifact",
    ...projectSkillSpectorReport(raw),
  };
}
