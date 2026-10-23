/* @vitest-environment node */
import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { diagnosticAnalyzerIds } from "./clawscan-diagnostic-report-enums";
import {
  fullProfileSkillSpectorMetadata,
  projectSkillSpectorReport,
  skillSpectorTerminalMetadata,
} from "./clawscan-diagnostic-skillspector";
import { completeScannerDiagnostic } from "./run-clawscan-original-diagnostic";

function inertReport() {
  return {
    execution_successful: true,
    issues: [{ severity: "HIGH", message: "PRIVATE", command: "PRIVATE" }],
    suppressed_count: 0,
    analysis_completeness: {
      execution_successful: true,
      coverage_percent: 100,
      is_complete: true,
      status: "complete",
      total_components: 175,
      scanned_components: 175,
      fully_inspected_files: 175,
      partially_inspected_files: 0,
      entirely_uninspected_files: 0,
      findings_before_filtering: 1,
      findings_after_filtering: 1,
      ledger_exceptions: [],
      limitations: [],
      analyzer_statuses: diagnosticAnalyzerIds
        .filter((id) => id !== "structured_skill_roles")
        .map((id) => ({
          analyzer_id: id,
          status: "completed",
          planned_work: 1,
          completed: 1,
          partial: 0,
          skipped: 0,
          failed: 0,
          unaccounted: 0,
        })),
    },
    raw: "PRIVATE",
    prompts: "PRIVATE",
    headers: "PRIVATE",
  };
}

it("retains only terminal allowlisted metadata and the count-limit failure, not messages or paths", () => {
  const report = inertReport();
  Object.assign(report.analysis_completeness, {
    is_complete: false,
    status: "partial",
    partially_inspected_files: 1,
    ledger_exceptions: [
      { reason_code: "artifact_count_limit", message: "PRIVATE", path: "PRIVATE" },
      { reason_code: "PRIVATE" },
    ],
    limitations: ["PRIVATE"],
  });
  const result = projectSkillSpectorReport(report);
  expect(result).toMatchObject({
    executionSuccessful: true,
    completeness: {
      isComplete: false,
      status: "partial",
      ledgerExceptionCount: 2,
      limitationCount: 1,
    },
    reasonCounts: { artifact_count_limit: 1 },
    unknownReasons: 1,
    findings: { reported: 1 },
  });
  expect(JSON.stringify(result)).not.toContain("PRIVATE");
  expect(Object.keys(result.reasonCounts)).toEqual(["artifact_count_limit"]);
});

it("does not infer root execution, completeness or missing/invalid counts from nested success", () => {
  for (const invalid of [
    undefined,
    null,
    [],
    1,
    "PRIVATE",
    {},
    { analysis_completeness: inertReport().analysis_completeness },
    { execution_successful: "true", issues: [] },
  ]) {
    const result = projectSkillSpectorReport(invalid);
    expect(result.executionSuccessful).toBeNull();
    expect(result.analyzerMetadataValid).toBe(
      invalid !== null && typeof invalid === "object" && "analysis_completeness" in invalid,
    );
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
  }
  const result = projectSkillSpectorReport({
    execution_successful: false,
    analysis_completeness: {
      is_complete: "true",
      status: "PRIVATE",
      total_components: -1,
      ledger_exceptions: "PRIVATE",
      analyzer_statuses: "PRIVATE",
    },
    issues: [null],
  });
  expect(result).toMatchObject({
    executionSuccessful: false,
    completeness: { isComplete: null, status: "unknown", counts: { total_components: null } },
    unknownReasons: null,
    findings: { reported: null },
    analyzerMetadataValid: false,
  });
});

it("fails invalid analyzer statuses, duplicate IDs, unknown analyzers and unsafe numeric fields closed", () => {
  for (const change of [
    { status: "PRIVATE" },
    { planned_work: 2 },
    { completed: -1 },
    { unaccounted: "0" },
    { analyzer_id: "PRIVATE" },
  ]) {
    const report = inertReport();
    Object.assign(report.analysis_completeness.analyzer_statuses[0]!, change);
    const projected = projectSkillSpectorReport(report);
    expect(projected.analyzerMetadataValid).toBe(false);
    expect(JSON.stringify(projected)).not.toContain("PRIVATE");
  }
  const report = inertReport();
  report.analysis_completeness.analyzer_statuses.push(
    report.analysis_completeness.analyzer_statuses[0]!,
  );
  expect(projectSkillSpectorReport(report).analyzerMetadataValid).toBe(false);
  for (const missing of [[], inertReport().analysis_completeness.analyzer_statuses.slice(1)])
    expect(
      projectSkillSpectorReport({
        ...report,
        analysis_completeness: { ...report.analysis_completeness, analyzer_statuses: missing },
      }).analyzerMetadataValid,
    ).toBe(false);
});

it("hashes restricted terminal files, retains findings, and never accepts absent, malformed or loose files", async () => {
  const root = await mkdtemp(join(tmpdir(), "skillspector-metadata-test-"));
  const path = join(root, "report.json");
  try {
    expect(await skillSpectorTerminalMetadata(path)).toMatchObject({
      presence: "missing",
      sha256: null,
      executionSuccessful: null,
      unknownReasons: null,
    });
    await writeFile(path, JSON.stringify(inertReport()), { mode: 0o600 });
    const terminal = await skillSpectorTerminalMetadata(path);
    expect(terminal).toMatchObject({
      presence: "present",
      executionSuccessful: true,
      findings: { reported: 1 },
      analyzerMetadataValid: true,
    });
    expect(terminal.sha256).toMatch(/^[a-f0-9]{64}$/);
    const result = {
      processStatus: "completed",
      startedMonotonicMs: 1,
      finishedMonotonicMs: 2,
      durationMs: 1,
      processBudgetMs: 900000,
      cleanupAllowanceMs: 60000,
      termination: {
        elapsedMs: 1,
        cleanupMs: 0,
        processGroup: "absent" as const,
        exitCode: 0,
        timedOut: false,
        outputLimitExceeded: null,
      },
      judge: "disabled",
      consumerValidation: "not_run_scanner_only",
      terminal,
    };
    expect(completeScannerDiagnostic(result)).toBe(true);
    expect(completeScannerDiagnostic({ ...result, processStatus: "failed" })).toBe(false);
    expect(
      completeScannerDiagnostic({
        ...result,
        processStatus: "failed",
        termination: { ...result.termination, exitCode: 1 },
      }),
    ).toBe(true);
    expect(
      completeScannerDiagnostic({
        ...result,
        terminal: {
          ...terminal,
          completeness: { ...terminal.completeness, coveragePercent: null },
        },
      }),
    ).toBe(false);
    expect(
      completeScannerDiagnostic({
        ...result,
        terminal: { ...terminal, executionSuccessful: false },
      }),
    ).toBe(false);
    expect(
      completeScannerDiagnostic({
        ...result,
        terminal: { ...terminal, executionSuccessful: null },
      }),
    ).toBe(false);
    expect(
      completeScannerDiagnostic({
        ...result,
        terminal: { ...terminal, analyzerMetadataValid: false },
      }),
    ).toBe(false);
    await chmod(path, 0o644);
    expect(await skillSpectorTerminalMetadata(path)).toMatchObject({
      presence: "invalid",
      executionSuccessful: null,
    });
    await chmod(path, 0o600);
    await writeFile(
      path,
      JSON.stringify({
        schemaVersion: "clawscan-run-v1",
        profile: "clawhub",
        scanners: { skillspector: { status: "completed", raw: inertReport() } },
      }),
    );
    expect(await fullProfileSkillSpectorMetadata(path)).toMatchObject({
      presence: "present",
      container: "clawscan-final-artifact",
      executionSuccessful: true,
      findings: { reported: 1 },
    });
    await writeFile(path, "PRIVATE malformed");
    expect(await skillSpectorTerminalMetadata(path)).toMatchObject({
      presence: "invalid",
      executionSuccessful: null,
    });
    await symlink(path, join(root, "link.json"));
    expect(await skillSpectorTerminalMetadata(join(root, "link.json"))).toMatchObject({
      presence: "invalid",
      sha256: null,
    });
    expect(await readFile(path, "utf8")).toBe("PRIVATE malformed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
