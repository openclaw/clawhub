import { z } from "zod";

const text = z.string().nullish();
const count = z.number().int().nullish();
const analyzer = z
  .object({
    analyzer_id: text,
    status: text,
    planned_work: count,
    completed: count,
    partial: count,
    skipped: count,
    failed: count,
    unaccounted: count,
    reason_code: text,
    message: text,
  })
  .passthrough();
const exception = z
  .object({
    outcome: text,
    phase: text,
    reason_code: text,
    message: text,
    path: text,
    start_line: count,
    end_line: count,
    fatal: z.boolean().nullish(),
    analyzers: z.array(z.string()).nullish(),
    error_class: text,
    scope: text,
  })
  .passthrough();
const accountingSchema = z
  .object({
    total_components: count,
    scanned_components: count,
    fully_inspected_files: count,
    partially_inspected_files: count,
    entirely_uninspected_files: count,
    findings_before_filtering: count,
    findings_after_filtering: count,
    coverage_percent: z.number().nullish(),
    is_complete: z.boolean().nullish(),
    execution_successful: z.boolean().nullish(),
    status: text,
    ledger_exceptions: z.array(exception).nullish(),
    analyzer_statuses: z.array(analyzer).nullish(),
    limitations: z.array(z.string()).nullish(),
    exclude_patterns: z.array(z.string()).nullish(),
    excluded_file_count: count,
    scope_exclusions: z.array(z.unknown()).nullish(),
    references: z
      .array(
        z
          .object({
            source_path: text,
            line: count,
            column: count,
            evidence: text,
            status: text,
            disposition: text,
            reference_kind: text,
          })
          .passthrough(),
      )
      .nullish(),
  })
  .passthrough();

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function canonicalControlFields(value: Record<string, unknown>, allowAliases = false) {
  const controls = [
    "execution_successful",
    "is_complete",
    "analysis_completeness",
    "status",
    "error",
  ];
  const aliases = ["executionSuccessful", "isComplete", "analysisCompleteness"];
  return Object.keys(value).every((key) => {
    const names = allowAliases ? [...controls, ...aliases] : controls;
    return (
      !names.some((name) => key !== name && key.toLowerCase() === name.toLowerCase()) &&
      (allowAliases || !aliases.includes(key))
    );
  });
}

function componentPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !value.includes("\0") &&
    !value.split("/").some((part) => !part || part === "." || part === "..")
  );
}

function hasBundle(value: Record<string, unknown>) {
  return Object.keys(value).some(
    (key) => key.replaceAll("_", "").toLowerCase() === "bundledreports",
  );
}

function validExceptions(accounting: Record<string, unknown>) {
  return (
    accounting.ledger_exceptions === undefined ||
    accounting.ledger_exceptions === null ||
    (Array.isArray(accounting.ledger_exceptions) &&
      accounting.ledger_exceptions.every((value) => {
        const row = record(value);
        return (
          row?.fatal === false &&
          !Object.keys(row).some((key) => key !== "fatal" && key.toLowerCase() === "fatal")
        );
      }))
  );
}

export function parseSkillSpectorReport(raw: string): unknown {
  const parsed: unknown = JSON.parse(raw);
  // JSON.parse discards duplicate keys. Reject them before serializing original
  // reports into a bundle so an unsuccessful report cannot become successful.
  const scopes: Array<Set<string> | null> = [];
  let previous = "";
  for (const [token] of raw.matchAll(/"(?:[^"\\]|\\.)*"|[{}[\]:,]|[^\s{}[\]:,]+/g)) {
    if (token === "{") scopes.push(new Set());
    else if (token === "[") scopes.push(null);
    else if (token === "}" || token === "]") scopes.pop();
    else if (token === ":") {
      const keys = scopes.at(-1);
      const key = JSON.parse(previous) as string;
      if (keys?.has(key)) throw new Error("SkillSpector report contained duplicate JSON keys");
      keys?.add(key);
    }
    previous = token;
  }
  return parsed;
}

// Mirrors the native judge-gaps envelope. These are integrity checks, not a
// coverage threshold: even zero fully inspected components can be adjudicated.
export function isUsableSkillSpectorPartial(input: unknown): boolean {
  const report = record(input);
  const accounting = record(report?.analysis_completeness);
  if (
    report?.execution_successful !== true ||
    accounting?.execution_successful !== true ||
    accounting.is_complete !== false ||
    accounting.status !== "partial"
  )
    return false;
  for (const current of [report, accounting]) {
    if (!canonicalControlFields(current)) return false;
    if (current.error !== undefined && current.error !== null && current.error !== "") return false;
  }
  if (report.is_complete !== undefined && report.is_complete !== false) return false;
  if (hasBundle(report)) {
    if (!Array.isArray(report.bundled_reports)) return false;
    // This envelope is produced here, so unknown fields indicate a mismatched
    // cross-repository contract rather than additional upstream evidence.
    const bundle = z
      .object({
        applicable: z.literal(true).optional(),
        status: z.enum(["clean", "suspicious", "malicious", "partial"]),
        risk_assessment: z
          .object({ score: z.number().nullish(), severity: text, recommendation: text })
          .strict()
          .optional(),
        issue_count: z.number().int().nonnegative().optional(),
        filtered_findings: z.array(
          z.record(z.string(), z.unknown()).refine((row) => Object.keys(row).length > 0),
        ),
        metadata: z.object({ skillspector_version: text }).strict().optional(),
        summary: z.string().optional(),
        error: z.literal("").nullish(),
        execution_successful: z.literal(true),
        analysis_completeness: z
          .object({
            execution_successful: z.literal(true),
            is_complete: z.literal(false),
            status: z.literal("partial"),
          })
          .strict(),
        bundled_reports: z
          .array(z.object({ rootPath: z.string(), report: z.unknown() }).strict())
          .nonempty(),
      })
      .strict();
    if (!bundle.safeParse(report).success) return false;
    const roots = new Set<string>();
    let partial = false;
    if (report.bundled_reports.length === 0) return false;
    for (const value of report.bundled_reports) {
      const entry = record(value);
      const root = entry?.rootPath;
      const child = record(entry?.report);
      if (!componentPath(root) || roots.has(root) || !child || hasBundle(child)) return false;
      roots.add(root);
      if (isUsableSkillSpectorPartial(child)) partial = true;
      else if (!isUsableSkillSpectorCompleteBundleChild(child)) return false;
    }
    return partial;
  }
  if (!accountingSchema.safeParse(accounting).success || !validExceptions(accounting)) return false;
  const metadata = record(report.metadata);
  if (typeof metadata?.skillspector_version !== "string" || !metadata.skillspector_version.trim())
    return false;
  if (
    typeof accounting.coverage_percent !== "number" ||
    !Number.isFinite(accounting.coverage_percent) ||
    accounting.coverage_percent < 0 ||
    accounting.coverage_percent > 100
  )
    return false;
  if (report.status !== undefined && report.status !== "partial") return false;
  if (!Array.isArray(report.components) || report.components.length === 0) return false;
  if (
    !report.components.every((value) => {
      const component = record(value);
      return (
        componentPath(component?.path) &&
        typeof component.type === "string" &&
        component.type.length > 0
      );
    })
  )
    return false;
  if (
    !Array.isArray(report.issues) ||
    !report.issues.every((value) => {
      const issue = record(value);
      return issue && Object.keys(issue).length > 0;
    })
  )
    return false;
  const counts = [
    "total_components",
    "fully_inspected_files",
    "partially_inspected_files",
    "entirely_uninspected_files",
  ].map((key) => accounting[key]);
  if (!counts.every((value) => Number.isSafeInteger(value) && (value as number) >= 0)) return false;
  const [total, full, partial, uninspected] = counts as number[];
  if (total === 0 || full + partial + uninspected !== total) return false;
  for (const key of ["ledger_exceptions", "analyzer_statuses"]) {
    const rows = accounting[key];
    if (
      !Array.isArray(rows) ||
      !rows.every((value) => {
        const row = record(value);
        return (
          row && Object.keys(row).length > 0 && (key !== "ledger_exceptions" || row.fatal === false)
        );
      })
    )
      return false;
  }
  return true;
}

export function isAdjudicableSkillSpectorResult(value: unknown): boolean {
  const scanner = record(value);
  return (
    scanner?.status === "partial" &&
    scanner.reportPolicy === "judge-gaps" &&
    (scanner.exitCode === undefined || scanner.exitCode === 0 || scanner.exitCode === 1) &&
    (scanner.error === undefined || scanner.error === "") &&
    isUsableSkillSpectorPartial(scanner.raw)
  );
}

// Only a new partial wrapper requires explicit completion of its other roots.
// Legacy complete-only reports keep their existing admission contract below.
export function isUsableSkillSpectorCompleteBundleChild(input: unknown): boolean {
  const report = record(input);
  const accounting = record(report?.analysis_completeness);
  return (
    report?.execution_successful === true &&
    accounting?.execution_successful === true &&
    accounting.is_complete === true &&
    isUsableSkillSpectorReport(report)
  );
}

export function isUsableSkillSpectorReport(input: unknown): boolean {
  const report = record(input);
  if (!report || Object.keys(report).length === 0) return false;
  if (isUsableSkillSpectorPartial(report)) return true;
  if (hasBundle(report)) return false;
  const findings = [
    "filtered_findings",
    "filteredFindings",
    "findings",
    "issues",
    "vulnerabilities",
  ]
    .map((key) => report[key])
    .find((value) => value !== undefined);
  if (
    !Array.isArray(findings) ||
    !findings.every((value) => {
      const finding = record(value);
      return finding && Object.keys(finding).length > 0;
    })
  )
    return false;
  if (report.metadata !== undefined && !record(report.metadata)) return false;
  if (
    report.components !== undefined &&
    (!Array.isArray(report.components) ||
      !report.components.every((value) => {
        const component = record(value);
        return (
          componentPath(component?.path) &&
          typeof component?.type === "string" &&
          component.type.length > 0
        );
      }))
  )
    return false;
  for (const current of [report, report.analysis_completeness, report.analysisCompleteness]) {
    if (current === undefined) continue;
    const item = record(current);
    if (!item || !canonicalControlFields(item, true)) return false;
    if (item !== report && (!accountingSchema.safeParse(item).success || !validExceptions(item)))
      return false;
    if (item.error !== undefined && item.error !== null && item.error !== "") return false;
    if (item.status !== undefined && typeof item.status !== "string") return false;
    for (const key of [
      "execution_successful",
      "executionSuccessful",
      "is_complete",
      "isComplete",
    ]) {
      if (key in item && item[key] !== true) return false;
    }
    if (
      typeof item.status === "string" &&
      ["failed", "error", "partial", "incomplete"].includes(item.status.trim().toLowerCase())
    )
      return false;
  }
  return true;
}
