import { appendFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import {
  CommandFailure,
  runWorkerCommand,
  type WorkerCommandTermination,
} from "../lib/runWorkerCommand";
import { verifyDiagnosticTree } from "./clawscan-diagnostic-input";
import {
  downloadOriginalInput,
  materializeOriginalInput,
  originalDiagnosticCases,
  originalManifests,
  ORIGINAL_BASELINE_SOURCE,
  ORIGINAL_CANDIDATE_SOURCE,
  ORIGINAL_MAXIMUM_BYTES,
  type OriginalFixture,
  type OriginalMode,
} from "./clawscan-diagnostic-original";
import { installOriginalRuntime } from "./clawscan-diagnostic-runtime";
import {
  fullProfileSkillSpectorMetadata,
  skillSpectorTerminalMetadata,
} from "./clawscan-diagnostic-skillspector";
import {
  assertDisposableDiagnosticEnvironment,
  diagnosticArtifactMetadata,
  DIAGNOSTIC_PROCESS_BUDGET_MS,
  removeRuntime,
  runDiagnosticProcess,
} from "./run-clawscan-diagnostic";
import { securityScannerEnvironment } from "./securityModelPolicy";

export async function runSkillSpectorDiagnosticProcess(
  python: string,
  target: string,
  terminalPath: string,
  options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs?: number },
) {
  const timeoutMs = options.timeoutMs ?? DIAGNOSTIC_PROCESS_BUDGET_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > DIAGNOSTIC_PROCESS_BUDGET_MS)
    throw new Error("Invalid original diagnostic budget");
  const started = performance.now();
  let termination: WorkerCommandTermination | null = null;
  let processStatus = "completed";
  try {
    await runWorkerCommand(
      python,
      [
        "-I",
        "-c",
        "from skillspector.cli import app; app()",
        "scan",
        target,
        "--format",
        "json",
        "--output",
        terminalPath,
      ],
      {
        cwd: options.cwd,
        env: options.env,
        timeoutMs,
        cleanupProcessGroup: true,
        captureOutput: false,
        // The structured terminal file is the evidence. Production's Go adapter
        // absorbs scanner stderr internally; this direct probe must drain it.
        discardStderr: true,
        commandLabel: "Original scanner diagnostic",
        onTermination: (value) => {
          termination = value;
        },
      },
    );
  } catch (error) {
    processStatus =
      error instanceof CommandFailure
        ? error.timedOut
          ? "timed_out"
          : error.outputLimitExceeded
            ? "output_limited"
            : "failed"
        : "start_or_observer_failed";
  }
  return {
    processStatus,
    stderrPolicy: "discarded" as const,
    startedMonotonicMs: started,
    finishedMonotonicMs: performance.now(),
    durationMs: performance.now() - started,
    processBudgetMs: timeoutMs,
    cleanupAllowanceMs: 60_000,
    termination: termination as WorkerCommandTermination | null,
    judge: "disabled",
    consumerValidation: "not_run_scanner_only",
    terminal: await skillSpectorTerminalMetadata(terminalPath),
  };
}

type ScannerResult = Awaited<ReturnType<typeof runSkillSpectorDiagnosticProcess>>;
export function completeScannerDiagnostic(
  result: Pick<ScannerResult, "processStatus" | "termination" | "terminal">,
) {
  const terminal = result.terminal;
  return (
    ((result.processStatus === "completed" && result.termination?.exitCode === 0) ||
      (result.processStatus === "failed" &&
        result.termination?.exitCode === 1 &&
        terminal.findings.reported !== null &&
        terminal.findings.reported > 0)) &&
    result.termination?.timedOut === false &&
    result.termination.outputLimitExceeded === null &&
    result.termination.processGroup === "absent" &&
    terminal.presence === "present" &&
    terminal.executionSuccessful === true &&
    terminal.completeness.isComplete === true &&
    terminal.completeness.status === "complete" &&
    terminal.completeness.executionSuccessful === true &&
    terminal.completeness.coveragePercent === 100 &&
    Object.values(terminal.completeness.counts).every((count) => count !== null) &&
    terminal.completeness.ledgerExceptionCount === 0 &&
    terminal.completeness.limitationCount === 0 &&
    terminal.unknownAnalyzers === 0 &&
    terminal.unknownReasons === 0 &&
    terminal.analyzerMetadataValid &&
    terminal.analyzerOutcomesComplete &&
    terminal.completeness.counts.partially_inspected_files === 0 &&
    terminal.completeness.counts.entirely_uninspected_files === 0 &&
    terminal.completeness.counts.fully_inspected_files ===
      terminal.completeness.counts.total_components &&
    terminal.completeness.counts.scanned_components ===
      terminal.completeness.counts.total_components &&
    terminal.findings.reported !== null &&
    terminal.findings.beforeFiltering !== null &&
    terminal.findings.afterFiltering !== null &&
    terminal.findings.suppressed !== null &&
    terminal.findings.reported === terminal.findings.afterFiltering
  );
}

export async function runOriginalDiagnosticCases<Result>(options: {
  mode: OriginalMode;
  attempt: (entry: ReturnType<typeof originalDiagnosticCases>[number]) => Promise<Result>;
  cleanupConfirmed: (result: Result) => boolean;
  checkpoint: (
    entries: {
      id: string;
      status: "finished" | "setup_or_controller_failed" | "not_started_after_failure";
      result: Result | null;
    }[],
  ) => Promise<void>;
}) {
  const entries: {
    id: string;
    status: "finished" | "setup_or_controller_failed" | "not_started_after_failure";
    result: Result | null;
  }[] = [];
  let stopped = false;
  await options.checkpoint(entries);
  for (const entry of originalDiagnosticCases(options.mode)) {
    if (stopped) {
      entries.push({ id: entry.id, status: "not_started_after_failure", result: null });
      await options.checkpoint(entries);
      continue;
    }
    try {
      const result = await options.attempt(entry);
      entries.push({ id: entry.id, status: "finished", result });
      if (!options.cleanupConfirmed(result)) stopped = true;
    } catch {
      entries.push({ id: entry.id, status: "setup_or_controller_failed", result: null });
      stopped = true;
    }
    await options.checkpoint(entries);
  }
  return entries;
}

export async function mainOriginalDiagnostic(mode: OriginalMode) {
  assertDisposableDiagnosticEnvironment();
  process.umask(0o077);
  const output = await mkdtemp(join(process.env.RUNNER_TEMP!, "clawscan-original-safe-"));
  const summaryPath = join(output, "summary.json");
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `safe-output=${output}\n`);
  const base = {
    schemaVersion: "clawscan-original-diagnostic-v1",
    label: "NONPRODUCTION_DIAGNOSTIC",
    excludedFromSlos: true,
    recoveryEvidence: false,
    acceptedPublication: false,
    productionRecoverySamples: 0,
    mode,
    processBudgetMs: 900_000,
    cleanupAllowanceMs: 60_000,
    automaticRetries: 0,
    maximumScans: originalDiagnosticCases(mode).length,
  };
  const save = (value: object) =>
    writeFile(summaryPath, JSON.stringify({ ...base, ...value }, null, 2), { mode: 0o600 });
  await save({ status: "setup_incomplete", attempts: [] });
  await writeFile(join(output, "events.jsonl"), "", { flag: "wx", mode: 0o600 });
  await writeFile(
    join(output, "attestation.json"),
    JSON.stringify({ baseline: null, candidate: null }),
    { mode: 0o600 },
  );
  if (
    !ORIGINAL_CANDIDATE_SOURCE ||
    !/^[a-f0-9]{40}$/.test(ORIGINAL_CANDIDATE_SOURCE) ||
    ORIGINAL_CANDIDATE_SOURCE === ORIGINAL_BASELINE_SOURCE
  ) {
    await save({ status: "candidate_source_not_approved", attempts: [] });
    throw new Error("Exact candidate source approval required");
  }
  const root = await mkdtemp(join(process.env.RUNNER_TEMP!, "clawscan-original-private-"));
  try {
    const home = join(root, "home");
    const codexHome = join(root, "codex-home");
    await mkdir(home, { mode: 0o700 });
    await mkdir(codexHome, { mode: 0o700 });
    const setupEnv: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: home,
      CODEX_HOME: codexHome,
      TMPDIR: root,
      TMP: root,
      TEMP: root,
      LANG: "C.UTF-8",
      NO_COLOR: "1",
      PYTHONNOUSERSITE: "1",
      PYTHONDONTWRITEBYTECODE: "1",
    };
    const fullProfile =
      mode === "original-candidate-full" || mode === "original-candidate-290-full";
    const installs = new Map<string, Promise<Awaited<ReturnType<typeof installOriginalRuntime>>>>();
    const inputs = new Map<OriginalFixture, ReturnType<typeof downloadOriginalInput>>();
    const attestations: Record<string, unknown> = { baseline: null, candidate: null };
    const apiKey = process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY;
    if (!apiKey) throw new Error("Existing CI key reference required");
    const results = await runOriginalDiagnosticCases<{
      complete: boolean;
      cleanupConfirmed: boolean;
    }>({
      mode,
      cleanupConfirmed: (result) => result.cleanupConfirmed,
      checkpoint: async (attempts) =>
        save({ status: attempts.length === base.maximumScans ? "finished" : "running", attempts }),
      attempt: async (entry) => {
        if (!installs.has(entry.source)) {
          const runtimeRoot = await mkdtemp(join(root, `${entry.source}-`));
          installs.set(
            entry.source,
            installOriginalRuntime(
              runtimeRoot,
              entry.source === "baseline" ? ORIGINAL_BASELINE_SOURCE : ORIGINAL_CANDIDATE_SOURCE!,
              fullProfile,
              setupEnv,
            ),
          );
        }
        const installed = await installs.get(entry.source)!;
        attestations[entry.source] = installed.metadata;
        await writeFile(join(output, "attestation.json"), JSON.stringify(attestations, null, 2), {
          mode: 0o600,
        });
        if (!inputs.has(entry.fixture))
          inputs.set(entry.fixture, downloadOriginalInput(entry.fixture));
        const input = await inputs.get(entry.fixture)!;
        const cwd = await mkdtemp(join(root, `${entry.id}-`));
        const target = join(cwd, "input");
        const identity = await materializeOriginalInput(entry.fixture, input, target);
        const attemptHome = join(cwd, "home");
        const attemptCodexHome = join(cwd, "codex-home");
        await mkdir(attemptHome, { mode: 0o700 });
        await mkdir(attemptCodexHome, { mode: 0o700 });
        const env: NodeJS.ProcessEnv = {
          ...setupEnv,
          HOME: attemptHome,
          CODEX_HOME: attemptCodexHome,
          PATH: `${installed.scannerBin}:${setupEnv.PATH}`,
          TMPDIR: cwd,
          TMP: cwd,
          TEMP: cwd,
          ...securityScannerEnvironment({
            OPENAI_API_KEY: apiKey,
            CODEX_API_KEY: process.env.CODEX_API_KEY || apiKey,
            LLM_API_KEY: apiKey,
            DEFAULT_BASE_URL: "https://api.openai.com/v1",
            DEFAULT_MODEL: "gpt-6.1-sol",
            REASONING_EFFORT: "medium",
            SKILLSPECTOR_PROVIDER: "openai",
            SKILLSPECTOR_MODEL: "gpt-6.1-sol",
            SKILLSPECTOR_REASONING_EFFORT: "medium",
          }),
          CLAWSCAN_PROGRESS: "1",
          CLAWSCAN_CHILD_PROGRESS: "1",
        };
        const started = performance.now();
        const artifactPath = join(cwd, "artifact.json");
        const terminalPath = join(cwd, "skillspector-terminal.json");
        const result = fullProfile
          ? {
              ...(await runDiagnosticProcess(
                installed.binary,
                [target, "--profile", "clawhub", "--sandbox", "off", "--output", artifactPath],
                { cwd, env, artifactPath, eventsPath: join(cwd, "events.jsonl") },
              )),
              ...(await diagnosticArtifactMetadata(artifactPath, true)),
              terminal: await fullProfileSkillSpectorMetadata(artifactPath),
            }
          : await runSkillSpectorDiagnosticProcess(installed.python, target, terminalPath, {
              cwd,
              env,
            });
        let treeVerification: "verified" | "failed" = "failed";
        try {
          await verifyDiagnosticTree(
            target,
            originalManifests[entry.fixture],
            ORIGINAL_MAXIMUM_BYTES,
          );
          treeVerification = "verified";
        } catch {}
        const complete =
          treeVerification === "verified" &&
          result.terminal.completeness.counts.total_components === identity.files &&
          (fullProfile
            ? completeScannerDiagnostic(result) &&
              result.consumerValidation === "validated_ephemerally_not_published"
            : completeScannerDiagnostic(result));
        const safe = {
          source: installed.metadata.source,
          fixture: entry.fixture,
          identity: {
            ...identity,
            manifestCanonicalization: "path,size,sha256",
            originalCompressedArchiveIdentityProven: false,
          },
          treeVerification,
          durationMs: performance.now() - started,
          complete,
          cleanupConfirmed: result.termination?.processGroup === "absent",
          result,
        };
        appendFileSync(
          join(output, "events.jsonl"),
          `${JSON.stringify({ id: entry.id, processStatus: result.processStatus, durationMs: safe.durationMs, complete })}\n`,
        );
        return safe;
      },
    });
    if (results.some((entry) => !entry.result?.complete)) process.exitCode = 1;
  } finally {
    try {
      await removeRuntime(root);
      await writeFile(
        summaryPath,
        JSON.stringify(
          { ...JSON.parse(await readFile(summaryPath, "utf8")), runtimeRemoval: "completed" },
          null,
          2,
        ),
        { mode: 0o600 },
      );
    } catch {
      process.exitCode = 1;
      throw new Error("Private diagnostic runtime cleanup failed");
    }
  }
}
