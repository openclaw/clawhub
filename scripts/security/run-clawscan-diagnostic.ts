import { appendFileSync } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  CommandFailure,
  runWorkerCommand,
  type WorkerCommandTermination,
} from "../lib/runWorkerCommand";
import {
  downloadIncidentArchive,
  extractDiagnosticArchive,
  incidentManifest,
  receiptIncidentManifest,
  smallTimeoutManifest,
  verifyDiagnosticTree,
} from "./clawscan-diagnostic-input";
import {
  type DiagnosticEventContext,
  runPairedDiagnostic,
  validDiagnosticEventContext,
} from "./clawscan-diagnostic-pair";
import { clawScanExposure } from "./clawscan-exposure";
import { createClawScanProgressCollector, type SafeClawScanProgress } from "./clawscan-progress";
import { validateClawScanArtifactForClawHubProfile } from "./run-codex-scan-worker";
import { securityScannerEnvironment } from "./securityModelPolicy";

export const INCIDENT_SOURCE_PIN = "e9d0e9e05506d9e9aa9725fe2f4da20e2870db9b";
export const DIAGNOSTIC_PROCESS_BUDGET_MS = 900_000;
const LABEL = "NONPRODUCTION_DIAGNOSTIC";
const tinyContent =
  "---\nname: harmless-diagnostic\ndescription: A harmless diagnostic fixture.\n---\n# Harmless diagnostic\nReply hello. No tools, installation, networking, or code execution are needed.\n";

function diagnosticStages(artifact?: unknown) {
  const record = (value: unknown): Record<string, unknown> | undefined =>
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  const candidate = record(artifact);
  const run =
    candidate?.schemaVersion === "clawscan-run-v1" && candidate.profile === "clawhub"
      ? candidate
      : undefined;
  const status = (value: unknown) =>
    value === "completed" || value === "failed" || value === "skipped" ? value : "unknown";
  const scanners = record(run?.scanners);
  return {
    scanners: {
      "clawscan-static": status(record(scanners?.["clawscan-static"])?.status),
      aig: status(record(scanners?.aig)?.status),
      skillspector: status(record(scanners?.skillspector)?.status),
      endor: status(record(scanners?.endor)?.status),
    },
    judge: status(record(run?.judge)?.status),
  };
}

export async function diagnosticArtifactMetadata(path: string, includeVerdict = false) {
  let securityVerdict: "benign" | "suspicious" | "malicious" | null = null;
  let artifact: unknown;
  let state: "missing" | "malformed" | "present" = "missing";
  try {
    const info = await lstat(path);
    state = "malformed";
    if (!info.isFile() || info.isSymbolicLink() || info.size > 32 * 1024 * 1024)
      throw new Error("Invalid artifact");
    artifact = JSON.parse(await readFile(path, "utf8"));
    state = "present";
  } catch {
    return {
      artifact: state,
      consumerValidation: "unknown",
      exposure: clawScanExposure(),
      ...(includeVerdict ? { securityVerdict, stages: diagnosticStages() } : {}),
    };
  }
  let consumerValidation = "rejected";
  try {
    if (!artifact || typeof artifact !== "object" || Array.isArray(artifact))
      throw new Error("Invalid artifact");
    validateClawScanArtifactForClawHubProfile(artifact as Record<string, unknown>);
    const verdict = (artifact as { judge?: { result?: { verdict?: unknown } } }).judge?.result
      ?.verdict;
    if (verdict === "benign" || verdict === "suspicious" || verdict === "malicious")
      securityVerdict = verdict;
    consumerValidation = "validated_ephemerally_not_published";
  } catch {}
  return {
    artifact: state,
    consumerValidation,
    exposure: clawScanExposure(artifact),
    ...(includeVerdict ? { securityVerdict, stages: diagnosticStages(artifact) } : {}),
  };
}

export async function runDiagnosticProcess(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    eventsPath: string;
    artifactPath: string;
    timeoutMs?: number;
    eventContext?: DiagnosticEventContext;
  },
) {
  const timeoutMs = options.timeoutMs ?? DIAGNOSTIC_PROCESS_BUDGET_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > DIAGNOSTIC_PROCESS_BUDGET_MS)
    throw new Error("Invalid diagnostic budget");
  if (options.eventContext && !validDiagnosticEventContext(options.eventContext))
    throw new Error("Invalid paired event context");
  if (!options.eventContext) await writeFile(options.eventsPath, "", { flag: "wx", mode: 0o600 });
  let lastProgress: SafeClawScanProgress | null = null;
  const progress = createClawScanProgressCollector((event) => {
    appendFileSync(
      options.eventsPath,
      `${JSON.stringify(options.eventContext ? { schemaVersion: "clawscan-paired-event-v1", leg: options.eventContext.leg, processIndex: options.eventContext.processIndex, progress: event } : event)}\n`,
    );
    lastProgress = event;
  });
  let termination: WorkerCommandTermination | null = null;
  let processStatus = "completed";
  try {
    await runWorkerCommand(command, args, {
      cwd: options.cwd,
      env: options.env,
      timeoutMs,
      captureOutput: false,
      cleanupProcessGroup: true,
      commandLabel: "ClawScan diagnostic",
      onStderrChunk: progress.write,
      onTermination: (value) => {
        termination = value;
      },
    });
  } catch (error) {
    processStatus =
      error instanceof CommandFailure
        ? error.timedOut
          ? "timed_out"
          : error.outputLimitExceeded
            ? "output_limited"
            : "failed"
        : "start_or_observer_failed";
  } finally {
    progress.end();
  }
  return {
    label: LABEL,
    excludedFromSlos: true,
    recoveryEvidence: false,
    acceptedPublication: false,
    processBudgetMs: timeoutMs,
    cleanupAllowanceMs: 60_000,
    processStatus,
    termination: termination as WorkerCommandTermination | null,
    diagnosticRecords: progress.counts,
    lastProgress: lastProgress as SafeClawScanProgress | null,
    ...(await diagnosticArtifactMetadata(options.artifactPath, options.eventContext !== undefined)),
  };
}

export async function attestRuntime(
  source: "reviewed" | "incident",
  fixture: "tiny" | "incident" | "receipt-incident" | "small-timeout-paired",
  root: string,
  env: NodeJS.ProcessEnv,
  installed?: { sourceDir: string; pin: string; binary: string },
) {
  if (
    process.env.DEFAULT_MODEL !== "gpt-6.1-sol" ||
    process.env.SKILLSPECTOR_MODEL !== "gpt-6.1-sol" ||
    process.env.REASONING_EFFORT !== "medium" ||
    process.env.SKILLSPECTOR_REASONING_EFFORT !== "medium"
  )
    throw new Error("Production scanner settings differ from approved diagnostic settings");
  const sourceDir = installed?.sourceDir ?? process.env.CLAWSCAN_SOURCE_DIR;
  if (!sourceDir) throw new Error("Missing installed source");
  const reviewed = (
    await readFile(new URL("./clawscan-source-commit.txt", import.meta.url), "utf8")
  ).trim();
  const pin = installed?.pin ?? (source === "incident" ? INCIDENT_SOURCE_PIN : reviewed);
  if (!/^[a-f0-9]{40}$/.test(pin)) throw new Error("Invalid reviewed source pin");
  const run = async (command: string, args: string[]) =>
    (await runWorkerCommand(command, args, { cwd: root, env, timeoutMs: 30_000 })).stdout.trim();
  const actualSource = await run("git", ["-C", sourceDir, "rev-parse", "HEAD"]);
  const sourceChanges = await run("git", [
    "-C",
    sourceDir,
    "status",
    "--porcelain",
    "--untracked-files=no",
  ]);
  const binary = installed?.binary ?? join(process.env.RUNNER_TEMP!, "clawscan-bin/clawscan");
  const build = await run("go", ["version", "-m", binary]);
  const revision = /\bvcs.revision=([a-f0-9]{40})\b/.exec(build)?.[1];
  const goVersion = /\b(go\d+\.\d+\.\d+)\b/.exec(build)?.[1];
  const codex = await run("codex", ["--version"]);
  const python = await run("python", ["--version"]);
  const node = await run("node", ["--version"]);
  const dockerfile = await readFile(join(sourceDir, "docker/clawscan-runtime/Dockerfile"), "utf8");
  const skillspector = /^ARG SKILLSPECTOR_REF=([a-f0-9]{40})$/m.exec(dockerfile)?.[1];
  const aig = /^ARG AIG_SKILL_SCAN_REF=([a-f0-9]{40})$/m.exec(dockerfile)?.[1];
  const ubuntu = /^VERSION_ID="(\d+\.\d+)"$/m.exec(await readFile("/etc/os-release", "utf8"))?.[1];
  if (
    actualSource !== pin ||
    revision !== pin ||
    sourceChanges ||
    !/\bvcs.modified=false\b/.test(build) ||
    goVersion !== "go1.27.3" ||
    codex !== "codex-cli 0.164.0" ||
    !/^Python 3\.12\.\d+$/.test(python) ||
    node !== "v24.22.1" ||
    ubuntu !== "24.04" ||
    !skillspector ||
    !aig
  )
    throw new Error("Diagnostic runtime does not match required pins");
  return {
    binary,
    metadata: {
      label: LABEL,
      source: pin,
      binaryRevision: revision,
      binaryModified: false,
      go: goVersion,
      node,
      python,
      codex,
      ubuntu,
      cpuParallelism: availableParallelism(),
      scannerSources: { skillspector, aig, responseAdaptersSource: pin },
      judge: {
        model: "gpt-6.1-sol",
        reasoning: "high",
        serviceTier: "default",
        innerSandbox: "read-only",
        outerSandbox: "off",
      },
      scannerSettings: {
        model: "gpt-6.1-sol",
        reasoning: "medium",
        provider: "openai",
        baseUrl: "https://api.openai.com/v1",
      },
      differencesFromIncident: [
        fixture === "small-timeout-paired"
          ? "manual same-runner singleton/four pair; no queue/claim/backend context"
          : "manual singleton, no shared-shard concurrency or queue/claim/backend context",
        "fresh HOME/CODEX_HOME, environment-only CI key; no Codex login/auth-cache",
        ...(fixture !== "tiny"
          ? [
              "public archive container differs from original VT ZIP; original bytes verified before execution",
            ]
          : ["harmless tiny fixture, not the incident artifact"]),
        "no worker preparation/publication; timings cover the ClawScan process separately",
        ...(source === "incident"
          ? []
          : ["reviewed source may include changes after the incident pin"]),
      ],
    },
  };
}

export async function removeRuntime(root: string) {
  const unlock = async (directory: string) => {
    await chmod(directory, 0o700);
    for (const name of await readdir(directory)) {
      const child = join(directory, name);
      if ((await lstat(child)).isDirectory()) await unlock(child);
    }
  };
  await unlock(root);
  await rm(root, { recursive: true, force: true });
}

export function assertDisposableDiagnosticEnvironment() {
  if (
    process.platform !== "linux" ||
    process.env.GITHUB_ACTIONS !== "true" ||
    process.env.RUNNER_OS !== "Linux" ||
    process.env.RUNNER_ARCH !== "X64" ||
    process.env.CLAWSCAN_DIAGNOSTIC_RUNNER !== "blacksmith-16vcpu-ubuntu-2404" ||
    !process.env.RUNNER_TEMP
  )
    throw new Error("Disposable Blacksmith workflow required");
  return process.env.RUNNER_TEMP;
}

export async function main(args = process.argv.slice(2)) {
  const runnerTemp = assertDisposableDiagnosticEnvironment();
  if (
    args.length === 4 &&
    args[0] === "--fixture" &&
    ["original-scanner-only", "original-candidate-full", "original-candidate-290-full"].includes(
      args[1],
    ) &&
    args[2] === "--source" &&
    args[3] === "reviewed"
  ) {
    const { mainOriginalDiagnostic } = await import("./run-clawscan-original-diagnostic");
    return mainOriginalDiagnostic(args[1] as import("./clawscan-diagnostic-original").OriginalMode);
  }
  if (
    args.length !== 4 ||
    args[0] !== "--fixture" ||
    !["tiny", "incident", "receipt-incident", "small-timeout-paired"].includes(args[1]) ||
    args[2] !== "--source" ||
    !["reviewed", "incident"].includes(args[3]) ||
    (args[1] === "small-timeout-paired" && args[3] !== "reviewed")
  )
    throw new Error("Only bounded fixture/source choices are supported");
  const fixture = args[1] as "tiny" | "incident" | "receipt-incident" | "small-timeout-paired";
  const source = args[3] as "reviewed" | "incident";
  const runtime = await mkdtemp(join(runnerTemp, "clawscan-diagnostic-private-"));
  const output = await mkdtemp(join(runnerTemp, "clawscan-diagnostic-safe-"));
  const summaryPath = join(output, "summary.json");
  await writeFile(
    summaryPath,
    JSON.stringify({
      label: LABEL,
      excludedFromSlos: true,
      recoveryEvidence: false,
      acceptedPublication: false,
      status: "setup_incomplete",
      exposure: { ...clawScanExposure(), scanExecution: "not_started" },
    }),
  );
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `safe-output=${output}\n`);
  try {
    const home = join(runtime, "home");
    const codexHome = join(runtime, "codex-home");
    await mkdir(home, { mode: 0o700 });
    await mkdir(codexHome, { mode: 0o700 });
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: home,
      CODEX_HOME: codexHome,
      TMPDIR: runtime,
      TMP: runtime,
      TEMP: runtime,
      LANG: "C.UTF-8",
      NO_COLOR: "1",
    };
    const installed = await attestRuntime(source, fixture, runtime, env);
    await writeFile(join(output, "attestation.json"), JSON.stringify(installed.metadata, null, 2));
    const target = join(runtime, "input");
    let identity: { files: number; bytes: number; manifestSha256?: string };
    const manifest =
      fixture === "small-timeout-paired"
        ? smallTimeoutManifest
        : fixture === "receipt-incident"
          ? receiptIncidentManifest
          : incidentManifest;
    const archive = fixture !== "tiny" ? await downloadIncidentArchive(fixture) : undefined;
    if (fixture !== "tiny") identity = await extractDiagnosticArchive(archive!, target, manifest);
    else {
      await mkdir(target, { mode: 0o700 });
      await writeFile(join(target, "SKILL.md"), tinyContent, { mode: 0o400 });
      await chmod(target, 0o500);
      identity = { files: 1, bytes: Buffer.byteLength(tinyContent) };
    }
    if (fixture !== "tiny") await verifyDiagnosticTree(target, manifest);
    const apiKey = process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY;
    if (!apiKey) throw new Error("Existing CI key reference required");
    Object.assign(
      env,
      securityScannerEnvironment({
        OPENAI_API_KEY: apiKey,
        CODEX_API_KEY: process.env.CODEX_API_KEY || apiKey,
        LLM_API_KEY: apiKey,
        DEFAULT_BASE_URL: "https://api.openai.com/v1",
        DEFAULT_MODEL: "gpt-6.1-sol",
        REASONING_EFFORT: "medium",
        SKILLSPECTOR_MODEL: "gpt-6.1-sol",
        SKILLSPECTOR_REASONING_EFFORT: "medium",
        SKILLSPECTOR_PROVIDER: "openai",
      }),
      { CLAWSCAN_PROGRESS: "1", CLAWSCAN_CHILD_PROGRESS: "1" },
    );
    if (fixture === "small-timeout-paired") {
      const summary = await runPairedDiagnostic({
        root: runtime,
        binary: installed.binary,
        env,
        eventsPath: join(output, "events.jsonl"),
        materializeInput: (path) => extractDiagnosticArchive(archive!, path, smallTimeoutManifest),
        runProcess: runDiagnosticProcess,
        checkpoint: async (paired) =>
          writeFile(
            summaryPath,
            JSON.stringify(
              { ...paired, fixture, identity, source: installed.metadata.source },
              null,
              2,
            ),
          ),
      });
      if (
        summary.status !== "completed" ||
        summary.legs
          .flatMap((leg) => leg.processes)
          .some(
            (entry) =>
              entry.result.processStatus !== "completed" ||
              entry.result.consumerValidation !== "validated_ephemerally_not_published" ||
              entry.result.exposure.judgeOperationalFailures !== 0,
          )
      )
        process.exitCode = 1;
      return;
    }
    const artifactPath = join(runtime, "artifact.json");
    const summary = await runDiagnosticProcess(
      installed.binary,
      [target, "--profile", "clawhub", "--sandbox", "off", "--output", artifactPath],
      {
        cwd: runtime,
        env,
        artifactPath,
        eventsPath: join(output, "events.jsonl"),
      },
    );
    await writeFile(
      summaryPath,
      JSON.stringify({ ...summary, fixture, identity, source: installed.metadata.source }, null, 2),
    );
    if (
      summary.processStatus !== "completed" ||
      summary.consumerValidation !== "validated_ephemerally_not_published"
    )
      process.exitCode = 1;
  } finally {
    await removeRuntime(runtime);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await main();
  } catch {
    console.error("NONPRODUCTION_DIAGNOSTIC failed; raw output suppressed; recovery unproven");
    process.exitCode = 1;
  }
}
