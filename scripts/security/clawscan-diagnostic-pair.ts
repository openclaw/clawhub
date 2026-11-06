import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { clawScanExposure } from "./clawscan-exposure";
import type { runDiagnosticProcess } from "./run-clawscan-diagnostic";

const legs = [
  { id: "initial-singleton", concurrency: 1 },
  { id: "initial-four", concurrency: 4 },
  { id: "confirmation-four", concurrency: 4 },
  { id: "confirmation-singleton", concurrency: 1 },
] as const;

export type DiagnosticEventContext = {
  leg: (typeof legs)[number]["id"];
  processIndex: number;
};

export function validDiagnosticEventContext(context: DiagnosticEventContext) {
  const leg = legs.find((candidate) => candidate.id === context.leg);
  return (
    leg !== undefined &&
    Number.isInteger(context.processIndex) &&
    context.processIndex >= 1 &&
    context.processIndex <= leg.concurrency
  );
}

type ProcessResult = Awaited<ReturnType<typeof runDiagnosticProcess>>;
type LegResult = {
  id: DiagnosticEventContext["leg"];
  concurrency: number;
  status: "unevaluated" | "evaluated" | "not_required";
  processes: {
    processIndex: number;
    startedAfterMs: number;
    finishedAfterMs: number;
    result: ProcessResult;
  }[];
};

function healthy(result: ProcessResult) {
  return (
    result.processStatus === "completed" &&
    result.consumerValidation === "validated_ephemerally_not_published" &&
    result.exposure.judgeOperationalFailures === 0
  );
}

function operationalFailure(result: ProcessResult) {
  return (
    result.processStatus !== "completed" ||
    result.consumerValidation !== "validated_ephemerally_not_published" ||
    (result.exposure.judgeOperationalFailures !== null &&
      result.exposure.judgeOperationalFailures > 0)
  );
}

export async function runPairedDiagnostic(options: {
  root: string;
  binary: string;
  env: NodeJS.ProcessEnv;
  eventsPath: string;
  materializeInput: (target: string) => Promise<unknown>;
  runProcess: typeof runDiagnosticProcess;
  checkpoint?: (summary: PairedDiagnosticSummary) => Promise<void>;
}) {
  const startedAt = Date.now();
  const summary: PairedDiagnosticSummary = {
    schemaVersion: "clawscan-paired-diagnostic-v1",
    label: "NONPRODUCTION_DIAGNOSTIC",
    excludedFromSlos: true,
    recoveryEvidence: false,
    acceptedPublication: false,
    maximumScans: 10,
    processBudgetMs: 900_000,
    cleanupAllowanceMs: 60_000,
    scansStarted: 0,
    confirmationTriggered: false,
    status: "running",
    legs: legs.map((leg) => ({ ...leg, status: "unevaluated", processes: [] })),
  };
  await writeFile(options.eventsPath, "", { flag: "wx", mode: 0o600 });
  await options.checkpoint?.(summary);
  try {
    for (const leg of summary.legs) {
      if (leg.id === "confirmation-four") {
        summary.confirmationTriggered =
          summary.legs[0]!.processes.every((entry) => healthy(entry.result)) &&
          summary.legs[1]!.processes.some((entry) => operationalFailure(entry.result));
        if (!summary.confirmationTriggered) {
          leg.status = "not_required";
          summary.legs[3]!.status = "not_required";
          break;
        }
      }
      const processes = await Promise.all(
        Array.from({ length: leg.concurrency }, async (_, index) => {
          const cwd = await mkdtemp(join(options.root, "scan-"));
          const target = join(cwd, "input");
          await options.materializeInput(target);
          return { cwd, target, artifactPath: join(cwd, "artifact.json"), processIndex: index + 1 };
        }),
      );
      const settled = await Promise.allSettled(
        processes.map(async (process) => {
          const startedAfterMs = Date.now() - startedAt;
          summary.scansStarted += 1;
          let result: ProcessResult;
          try {
            result = await options.runProcess(
              options.binary,
              [
                process.target,
                "--profile",
                "clawhub",
                "--sandbox",
                "off",
                "--output",
                process.artifactPath,
              ],
              {
                cwd: process.cwd,
                env: { ...options.env, TMPDIR: process.cwd, TMP: process.cwd, TEMP: process.cwd },
                artifactPath: process.artifactPath,
                eventsPath: options.eventsPath,
                eventContext: { leg: leg.id, processIndex: process.processIndex },
              },
            );
          } catch {
            result = {
              label: "NONPRODUCTION_DIAGNOSTIC",
              excludedFromSlos: true,
              recoveryEvidence: false,
              acceptedPublication: false,
              processBudgetMs: 900_000,
              cleanupAllowanceMs: 60_000,
              processStatus: "start_or_observer_failed",
              termination: null,
              diagnosticRecords: { retained: 0, rejected: 0, limited: 0 },
              lastProgress: null,
              artifact: "missing",
              consumerValidation: "unknown",
              securityVerdict: null,
              stages: {
                scanners: {
                  "clawscan-static": "unknown",
                  aig: "unknown",
                  skillspector: "unknown",
                  endor: "unknown",
                },
                judge: "unknown",
              },
              exposure: { ...clawScanExposure(), scanExecution: "unknown" },
            };
          }
          return {
            processIndex: process.processIndex,
            startedAfterMs,
            finishedAfterMs: Date.now() - startedAt,
            result,
          };
        }),
      );
      for (const result of settled)
        if (result.status === "fulfilled") leg.processes.push(result.value);
      if (settled.some((result) => result.status === "rejected")) {
        summary.status = "orchestration_failed";
        break;
      }
      leg.status = "evaluated";
      if (leg.processes.some((entry) => entry.result.termination?.processGroup !== "absent")) {
        summary.status = "cleanup_unconfirmed";
        break;
      }
      await options.checkpoint?.(summary);
    }
    if (summary.status === "running") summary.status = "completed";
  } catch {
    summary.status = "orchestration_failed";
  }
  await options.checkpoint?.(summary);
  return summary;
}

export type PairedDiagnosticSummary = {
  schemaVersion: "clawscan-paired-diagnostic-v1";
  label: "NONPRODUCTION_DIAGNOSTIC";
  excludedFromSlos: true;
  recoveryEvidence: false;
  acceptedPublication: false;
  maximumScans: 10;
  processBudgetMs: 900000;
  cleanupAllowanceMs: 60000;
  scansStarted: number;
  confirmationTriggered: boolean;
  status: "running" | "completed" | "cleanup_unconfirmed" | "orchestration_failed";
  legs: LegResult[];
};
