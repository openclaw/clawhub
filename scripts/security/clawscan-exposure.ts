import { isDeepStrictEqual } from "node:util";
import {
  type ClawHubProfile,
  decisionsJudgeAccounting,
  hasScannerExecution,
  isTypedScannerJudgeRun,
} from "./clawscan-decisions";

export type ClawScanExposure = {
  scanExecution: "started" | "not_started" | "unknown";
  eligibleScanAttempt: boolean | null;
  judgeInvocations: number | null;
  judgeOperationalFailures: number | null;
  recoveredReceiptRetries: number | null;
};

export function noClawScanExposure(eligibleScanAttempt: false | null = null): ClawScanExposure {
  return {
    scanExecution: "not_started",
    eligibleScanAttempt,
    judgeInvocations: 0,
    judgeOperationalFailures: 0,
    recoveredReceiptRetries: 0,
  };
}

export function unknownClawScanExposure(): ClawScanExposure {
  return {
    scanExecution: "unknown",
    eligibleScanAttempt: null,
    judgeInvocations: null,
    judgeOperationalFailures: null,
    recoveredReceiptRetries: null,
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function receiptFailure(error: string) {
  return (
    [
      "Judge artifact inspection required_file did not match the required artifact file.",
      "Judge artifact inspection receipt version was unsupported.",
      "Judge artifact inspection v2 fields require receipt version 2.",
      "Judge artifact inspection v2 receipt fields were invalid.",
      "Judge artifact inspection v2 additional_files_inspected was not an array.",
      "Judge artifact inspection v2 additional_files_inspected contained an invalid artifact path.",
    ].includes(error) ||
    error === "Judge did not provide the required artifact inspection receipt." ||
    /^Judge artifact inspection (status was .*; expected completed\.|challenge did not match the workspace challenge\.|file hash did not match the required artifact file\.|did not report any inspected artifact files\.|did not include required file .+\.)$/.test(
      error,
    )
  );
}

export function clawScanExposure(
  artifact?: unknown,
  expectedProfile: ClawHubProfile = "clawhub",
): ClawScanExposure {
  const unknown: ClawScanExposure = {
    ...unknownClawScanExposure(),
    scanExecution: "started",
  };
  const run = record(artifact);
  if (
    run?.schemaVersion !== "clawscan-run-v1" ||
    run.profile !== expectedProfile ||
    typeof run.completedAt !== "string" ||
    !Number.isFinite(Date.parse(run.completedAt))
  )
    return unknown;
  if (
    isTypedScannerJudgeRun(run) ||
    record(run.judge)?.command?.toString().includes("clawscan-decisions-judge")
  ) {
    const accounting = decisionsJudgeAccounting(run);
    const scanners = record(run.scanners);
    const completed =
      run.status === "completed" &&
      run.complete === true &&
      typeof run.startedAt === "string" &&
      Number.isFinite(Date.parse(run.startedAt)) &&
      Date.parse(run.completedAt as string) >= Date.parse(run.startedAt);
    return {
      scanExecution: "started",
      eligibleScanAttempt:
        completed && Boolean(scanners && Object.values(scanners).some(hasScannerExecution)),
      judgeInvocations: accounting?.judgeInvocations ?? null,
      judgeOperationalFailures: accounting?.judgeOperationalFailures ?? null,
      recoveredReceiptRetries: accounting?.recoveredReceiptRetries ?? null,
    };
  }
  const staticStatus = record(record(run.scanners)?.["clawscan-static"])?.status;
  if (staticStatus === "completed" || staticStatus === "failed") unknown.eligibleScanAttempt = true;
  const judge = record(run.judge);
  // ClawScan refuses an oversized judge prompt before starting the judge
  // command: the judge failed, never started, and has no attempts.
  if (
    judge?.status === "failed" &&
    judge.commandStarted === false &&
    typeof judge.error === "string" &&
    judge.error.startsWith("judge prompt too large:") &&
    (judge.attempts === undefined || (Array.isArray(judge.attempts) && judge.attempts.length === 0))
  ) {
    return {
      scanExecution: "started",
      eligibleScanAttempt: unknown.eligibleScanAttempt,
      judgeInvocations: 0,
      judgeOperationalFailures: 0,
      recoveredReceiptRetries: 0,
    };
  }
  if (!Array.isArray(judge?.attempts) || judge.attempts.length < 1 || judge.attempts.length > 2) {
    return unknown;
  }
  const attempts = judge.attempts.map(record);
  for (const attempt of attempts) {
    if (
      !attempt ||
      (attempt.status !== "completed" && attempt.status !== "failed") ||
      typeof attempt.error !== "string" ||
      !Object.hasOwn(attempt, "result") ||
      !Number.isSafeInteger(attempt.durationMs) ||
      (attempt.durationMs as number) < 0 ||
      typeof attempt.challenge !== "string" ||
      !/^[a-f0-9]{64}$/.test(attempt.challenge) ||
      typeof attempt.requiredFile !== "string" ||
      !attempt.requiredFile.startsWith("artifact/") ||
      typeof attempt.requiredFileSha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(attempt.requiredFileSha256) ||
      (attempt.status === "completed" && (attempt.error !== "" || !record(attempt.result))) ||
      (attempt.status === "failed" && !attempt.error.trim()) ||
      /Judge retry could not start:|Judge timeout budget exhausted before command start\./.test(
        attempt.error,
      )
    )
      return unknown;
  }
  const first = attempts[0]!;
  const last = attempts.at(-1)!;
  if (
    last.status !== judge.status ||
    last.error !== judge.error ||
    !isDeepStrictEqual(last.result, judge.result) ||
    (attempts.length === 2 &&
      (first.status !== "failed" ||
        !receiptFailure(first.error as string) ||
        first.challenge === last.challenge ||
        first.requiredFile !== last.requiredFile ||
        first.requiredFileSha256 !== last.requiredFileSha256))
  )
    return unknown;
  return {
    scanExecution: "started",
    eligibleScanAttempt: unknown.eligibleScanAttempt,
    judgeInvocations: attempts.length,
    judgeOperationalFailures: attempts.filter((attempt) => attempt?.status === "failed").length,
    recoveredReceiptRetries: attempts.length === 2 && last.status === "completed" ? 1 : 0,
  };
}

export function summarizeClawScanExposure(exposures: (ClawScanExposure | undefined)[]) {
  return exposures.reduce(
    (totals, exposure) => {
      if (!exposure || exposure.scanExecution === "unknown") totals.unknownScanExecutions += 1;
      else if (exposure.scanExecution === "started") totals.scanExecutions += 1;
      else totals.scanNotStarted += 1;
      if (!exposure || exposure.eligibleScanAttempt === null) totals.unknownScanEligibility += 1;
      else if (exposure.eligibleScanAttempt) totals.eligibleScanAttempts += 1;
      if (
        !exposure ||
        exposure.judgeInvocations === null ||
        exposure.judgeOperationalFailures === null ||
        exposure.recoveredReceiptRetries === null
      )
        totals.unknownJudgeRuns += 1;
      else {
        totals.judgeInvocations += exposure.judgeInvocations;
        totals.judgeOperationalFailures += exposure.judgeOperationalFailures;
        totals.recoveredReceiptRetries += exposure.recoveredReceiptRetries;
      }
      return totals;
    },
    {
      scanExecutions: 0,
      scanNotStarted: 0,
      unknownScanExecutions: 0,
      eligibleScanAttempts: 0,
      unknownScanEligibility: 0,
      judgeInvocations: 0,
      judgeOperationalFailures: 0,
      recoveredReceiptRetries: 0,
      unknownJudgeRuns: 0,
    },
  );
}
