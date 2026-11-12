import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  MAX_PREPUBLICATION_REPORT_BYTES,
  prepublicationReportSchema,
  type PrepublicationReport,
} from "../../convex/lib/prepublicationReports";
import {
  canAdmitSecurityScan,
  pluginScanBudget,
  securityWorkerDeadline,
} from "../../convex/lib/securityWorkerBudgets";
import { runWorkerCommand, CommandFailure } from "../lib/runWorkerCommand";
import { createWorkerLogger } from "../lib/workerLogger";
import {
  maskKnownWorkerSecrets,
  redactWorkerPublicErrorMessage,
  redactWorkerPublicText,
} from "../lib/workerRedaction";
import type { ClawHubProfile } from "./clawscan-decisions";
import { isTypedScannerJudgeRun } from "./clawscan-decisions";
import { projectSkillSpectorReport } from "./clawscan-diagnostic-skillspector";
import {
  withClawScanDockerCleanup,
  clawScanDockerEnvironment,
  ClawScanContainerCleanupError,
  hasKnownClawScanChildFinality,
} from "./clawscan-docker-cleanup";
import {
  clawScanExposure,
  type ClawScanExposure,
  noClawScanExposure,
  summarizeClawScanExposure,
} from "./clawscan-exposure";
import { assertQualifiedNativeArtifact } from "./clawscan-native-runtime";
import {
  usesWholePluginScanForTarget,
  qualifiedPluginCommand,
  QUALIFIED_PLUGIN_IMAGE,
  assertQualifiedPluginArtifact,
} from "./clawscan-plugin-runtime";
import { resolveTemplateScanForTarget } from "./clawscan-template-runtime";
import { resolvePrepublicationScannerRuntime } from "./prepublicationScannerSource";
import {
  type AigAnalysis,
  assertAigFilePathsHaveNoCompiledPython,
  type ClaimedJob,
  resolveClawScanTarget,
  type StoredLlmAnalysis,
  type SkillSpectorAnalysis,
  validateClawScanArtifactForClawHubProfile,
  writeArtifactWorkspace,
} from "./run-codex-scan-worker";
import { securityScannerEnvironment } from "./securityModelPolicy";
import { isAdjudicableSkillSpectorResult } from "./skillSpectorReportPolicy";

type ClaimedPrePublicationAttempt = {
  attemptId: Id<"publishAttempts">;
  status?: "pending_checks" | "ready_to_finalize";
  claimId: string;
  kind: "skill" | "package";
  slug: string;
  displayName: string;
  version: string;
  artifactFingerprint: string;
  files: Array<{
    path: string;
    size: number;
    sha256: string;
    url: string | null;
    contentType?: string;
  }>;
  clawpackUrl?: string | null;
  prepublicationReportUploadUrl?: string | null;
  scanContext?: {
    trustedOpenClawPlugin?: boolean;
    skill?: Record<string, unknown>;
    version?: Record<string, unknown>;
    package?: Record<string, unknown>;
    release?: Record<string, unknown>;
  };
  existingClawscanAnalysis?: StoredLlmAnalysis;
  existingAigAnalysis?: AigAnalysis;
  checkClaimExpiresAt: number;
  createdAt: number;
};

type WorkerCheckResult = {
  status: "clean" | "blocked" | "failed";
  summary?: string;
  redactedFindings?: string[];
};

type ProcessAttemptResult = {
  completed: boolean;
  result?: unknown;
  workerMustStop?: boolean;
};

type PrePublicationWorkerClient = Pick<ConvexHttpClient, "action">;

type PrePublicationClaimFilters = {
  attemptId?: Id<"publishAttempts">;
  kind?: "skill" | "package";
  slug?: string;
  version?: string;
};

type TruffleHogResult = WorkerCheckResult & {
  exitCode?: number | null;
};

type ClawScanResult = {
  check: WorkerCheckResult;
  analysis?: StoredLlmAnalysis;
  aigAnalysis?: AigAnalysis;
  skillSpectorAnalysis?: SkillSpectorAnalysis;
};

type NativeExecutionReport = PrepublicationReport["execution"];

type ProcessAttemptDeps = {
  onExposure?: (exposure: ClawScanExposure) => void;
  runClawScan?: (
    job: ClaimedJob,
    workspace: string,
    onExposure?: (exposure: ClawScanExposure) => void,
    onExecutionReport?: (report: NativeExecutionReport) => Promise<void>,
  ) => Promise<ClawScanResult>;
  runTruffleHog?: (workspace: string) => Promise<TruffleHogResult>;
  writeWorkspace?: (job: ClaimedJob, workspace: string) => Promise<void>;
};

const DEFAULT_BATCH_LIMIT = 2;
const DEFAULT_MAX_RUNTIME_MS = 8 * 60 * 1000;
const DEFAULT_TRUFFLEHOG_IMAGE =
  "ghcr.io/trufflesecurity/trufflehog:3.95.6@sha256:96f8429082cb2d4ae73b1096dcdb2f5aa139881d97042b0c5e5fa226a392e056";
const TRUFFLEHOG_SECRET_EXIT_CODE = 183;
const MAX_TRUFFLEHOG_FINDINGS = 10;
const MAX_PUBLIC_SUMMARY_CHARS = 600;
const REQUIRED_SKILL_SCANNERS = ["clawscan-static", "skillspector", "aig"];
const REQUIRED_PACKAGE_SCANNERS = ["clawscan-static", "skillspector"];
const CHILD_RUNTIME_ENV_KEYS = [
  "PATH",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "SYSTEMROOT",
  "SystemRoot",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
] as const;

const logger = createWorkerLogger({ name: "prepublication-worker" });

export function parseArgs(args = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env) {
  const get = (name: string) => {
    const index = args.indexOf(name);
    const value = index === -1 ? undefined : args[index + 1];
    return value && !value.startsWith("--") ? value : undefined;
  };
  const numberFrom = (value: string | undefined, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  const optionalNumberFrom = (value: string | undefined) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  };
  const optionalStringFrom = (value: string | undefined) => value?.trim() || undefined;
  const kind = optionalStringFrom(get("--kind") ?? env.PREPUBLICATION_CHECK_KIND);
  if (kind && kind !== "skill" && kind !== "package") {
    throw new Error("--kind must be skill or package");
  }
  return {
    batchLimit: numberFrom(
      get("--batch-limit") ?? env.PREPUBLICATION_CHECK_LIMIT,
      DEFAULT_BATCH_LIMIT,
    ),
    maxJobs: optionalNumberFrom(get("--max-jobs") ?? env.PREPUBLICATION_CHECK_MAX_JOBS),
    maxRuntimeMs:
      numberFrom(
        get("--max-runtime-minutes") ?? env.PREPUBLICATION_CHECK_MAX_RUNTIME_MINUTES,
        DEFAULT_MAX_RUNTIME_MS / 60_000,
      ) * 60_000,
    claimFilters: {
      attemptId: optionalStringFrom(get("--attempt-id") ?? env.PREPUBLICATION_CHECK_ATTEMPT_ID) as
        | Id<"publishAttempts">
        | undefined,
      kind: kind as "skill" | "package" | undefined,
      slug: optionalStringFrom(get("--slug") ?? env.PREPUBLICATION_CHECK_SLUG),
      version: optionalStringFrom(get("--version") ?? env.PREPUBLICATION_CHECK_VERSION),
    } satisfies PrePublicationClaimFilters,
  };
}

function requireEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function publicText(value: string, maxChars = MAX_PUBLIC_SUMMARY_CHARS) {
  const withoutProgress = value.replace(
    /\[clawscan-progress\][^\r\n]*/g,
    "[scanner progress omitted]",
  );
  return redactWorkerPublicErrorMessage(redactWorkerPublicText(withoutProgress, maxChars));
}

function buildSyntheticScanJob(attempt: ClaimedPrePublicationAttempt): ClaimedJob {
  const targetKind = attempt.kind === "skill" ? "skillVersion" : "packageRelease";
  if (attempt.kind === "package" && attempt.clawpackUrl === null) {
    throw new Error("ClawPack artifact unavailable");
  }
  return {
    job: {
      _id: String(attempt.attemptId),
      leaseToken: attempt.claimId,
      targetKind,
      source: "pre-publication",
      hasMaliciousSignal: false,
      attempts: 1,
    },
    target: {
      ...(attempt.scanContext?.trustedOpenClawPlugin
        ? { trustedOpenClawPlugin: attempt.scanContext.trustedOpenClawPlugin }
        : {}),
      files: attempt.files.map((file) => {
        if (!file.url) throw new Error(`Artifact file unavailable: ${file.path}`);
        return {
          path: file.path,
          size: file.size,
          sha256: file.sha256,
          contentType: file.contentType,
          url: file.url,
        };
      }),
      ...(attempt.kind === "skill"
        ? {
            skill: {
              ...attempt.scanContext?.skill,
              slug: attempt.slug,
              displayName: attempt.displayName,
            },
            version: {
              ...attempt.scanContext?.version,
              version: attempt.version,
              sha256hash: attempt.artifactFingerprint,
            },
          }
        : {
            package: {
              ...attempt.scanContext?.package,
              name: attempt.slug,
              displayName: attempt.displayName,
            },
            release: {
              ...attempt.scanContext?.release,
              version: attempt.version,
              integritySha256: attempt.artifactFingerprint,
            },
            clawpackUrl: attempt.clawpackUrl,
          }),
    },
  };
}

function truffleHogTimeoutMs() {
  const parsed = Number(process.env.PREPUBLICATION_TRUFFLEHOG_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 180_000;
}

function truffleHogCommand() {
  return process.env.PREPUBLICATION_TRUFFLEHOG_COMMAND?.trim() || "";
}

export function resolveTruffleHogImage(image = process.env.PREPUBLICATION_TRUFFLEHOG_IMAGE) {
  const resolved = image?.trim() || DEFAULT_TRUFFLEHOG_IMAGE;
  if (!resolved.includes("@sha256:")) {
    throw new Error("PREPUBLICATION_TRUFFLEHOG_IMAGE must be pinned by sha256 digest");
  }
  return resolved;
}

function parseTruffleHogFindings(stdout: string) {
  const findings: string[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const detector =
        typeof parsed.DetectorName === "string"
          ? parsed.DetectorName
          : typeof parsed.detectorName === "string"
            ? parsed.detectorName
            : "verified secret";
      const source =
        typeof parsed.SourceName === "string"
          ? parsed.SourceName
          : typeof parsed.sourceName === "string"
            ? parsed.sourceName
            : "artifact";
      findings.push(publicText(`${detector} in ${source}`, 160));
    } catch {
      // TruffleHog can write human text on some paths. Keep only a redacted, bounded summary.
      findings.push(publicText(trimmed, 160));
    }
    if (findings.length >= MAX_TRUFFLEHOG_FINDINGS) break;
  }
  return findings;
}

async function runCommand(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
    onOutput?: (output: { code: number | null; stdout: string; stderr: string }) => void;
  },
) {
  return await new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolvePromise, reject) => {
      const child = spawn(command, args, {
        cwd: options.cwd,
        detached: process.platform !== "win32",
        env: options.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let forceKillTimeout: NodeJS.Timeout | undefined;
      const killProcessTree = (signal: NodeJS.Signals) => {
        if (process.platform !== "win32" && child.pid) {
          try {
            process.kill(-child.pid, signal);
            return;
          } catch {
            // The process group may already have exited; fall back to the direct child.
          }
        }
        child.kill(signal);
      };
      const timeout = setTimeout(() => {
        timedOut = true;
        killProcessTree("SIGTERM");
        forceKillTimeout = setTimeout(() => killProcessTree("SIGKILL"), 10_000);
        forceKillTimeout.unref();
      }, options.timeoutMs);
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", (error) => {
        clearTimeout(timeout);
        if (timedOut) killProcessTree("SIGKILL");
        if (forceKillTimeout) clearTimeout(forceKillTimeout);
        options.onOutput?.({ code: null, stdout, stderr });
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timeout);
        if (timedOut) killProcessTree("SIGKILL");
        if (forceKillTimeout) clearTimeout(forceKillTimeout);
        options.onOutput?.({ code, stdout, stderr });
        if (timedOut) {
          reject(new Error(`${command} timed out`));
          return;
        }
        resolvePromise({ code, stdout, stderr });
      });
    },
  );
}

function restrictedChildEnvironment(
  workspace: string,
  passthroughKeys: readonly string[] = [],
): NodeJS.ProcessEnv {
  const childEnv: NodeJS.ProcessEnv = {
    NO_COLOR: "1",
    TEMP: workspace,
    TMP: workspace,
    TMPDIR: workspace,
  };
  for (const key of [...CHILD_RUNTIME_ENV_KEYS, ...passthroughKeys]) {
    const value = process.env[key];
    if (value !== undefined) childEnv[key] = value;
  }
  return childEnv;
}

export async function runNativeTruffleHog(workspace: string): Promise<TruffleHogResult> {
  const artifactDir = join(workspace, "artifact");
  const explicitCommand = truffleHogCommand();
  const command = explicitCommand || "docker";
  const args = explicitCommand
    ? ["filesystem", artifactDir, "--only-verified", "--fail", "--json", "--no-update"]
    : [
        "run",
        "--rm",
        "-v",
        `${artifactDir}:/scan:ro`,
        resolveTruffleHogImage(),
        "filesystem",
        "/scan",
        "--only-verified",
        "--fail",
        "--json",
        "--no-update",
      ];

  const output = await runCommand(command, args, {
    cwd: workspace,
    env: restrictedChildEnvironment(workspace),
    timeoutMs: truffleHogTimeoutMs(),
  });
  if (output.code === 0) {
    return {
      status: "clean",
      summary: "TruffleHog found no verified secrets in the staged publish artifact.",
      exitCode: output.code,
    };
  }
  if (output.code === TRUFFLEHOG_SECRET_EXIT_CODE) {
    const findings = parseTruffleHogFindings(output.stdout);
    return {
      status: "blocked",
      summary:
        findings.length > 0
          ? `TruffleHog found verified secret material: ${findings.join("; ")}.`
          : "TruffleHog found verified secret material in the staged publish artifact.",
      redactedFindings: findings.length > 0 ? findings : undefined,
      exitCode: output.code,
    };
  }
  return {
    status: "failed",
    summary: publicText(`TruffleHog failed before returning a verdict: ${output.stderr}`),
    exitCode: output.code,
  };
}

export const DEFAULT_PREPUBLICATION_CLAWSCAN_TIMEOUT_MS = 15 * 60 * 1000;

export function clawScanTimeoutMs(wholePlugin = false) {
  if (wholePlugin) return pluginScanBudget.subprocessMs;
  const parsed = Number(process.env.PREPUBLICATION_CLAWSCAN_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_PREPUBLICATION_CLAWSCAN_TIMEOUT_MS;
}

function clawScanCommand() {
  return process.env.PREPUBLICATION_CLAWSCAN_COMMAND?.trim() || "clawscan";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function readString(record: Record<string, unknown> | undefined, names: string[]) {
  if (!record) return undefined;
  for (const name of names) {
    const value = record[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function collectClawScanScannerFailures(
  scanners: Record<string, unknown> | undefined,
  scannerSet: readonly string[],
) {
  const failures: string[] = [];
  for (const scanner of scannerSet) {
    const value = scanners?.[scanner];
    if (value === undefined) continue;
    const scannerRecord = asRecord(value);
    const status = readString(scannerRecord, ["status"]) ?? "unknown";
    if (scanner === "skillspector" && isAdjudicableSkillSpectorResult(scannerRecord)) continue;
    if (status !== "completed") {
      const error = readString(scannerRecord, ["error"]);
      const errorTail = error ? publicText(error.slice(-450), 450) : undefined;
      failures.push(`${scanner}=${status}${errorTail ? ` (${errorTail})` : ""}`);
    }
  }
  return failures;
}

function storedAnalysisFromClawScanArtifact(
  artifact: unknown,
  targetKind: ClaimedJob["job"]["targetKind"],
  requiredScannerOverride?: string[],
  expectedProfile: ClawHubProfile = "clawhub",
): {
  analysis?: StoredLlmAnalysis;
  aigAnalysis?: AigAnalysis;
  skillSpectorAnalysis?: SkillSpectorAnalysis;
  error?: string;
} {
  const record = asRecord(artifact);
  if (
    record &&
    (isTypedScannerJudgeRun(record) ||
      requiredScannerOverride ||
      expectedProfile === "clawhub-template")
  ) {
    try {
      const mapped = validateClawScanArtifactForClawHubProfile(
        record,
        requiredScannerOverride ??
          (targetKind === "packageRelease" ? ["aig-mcp"] : ["skillspector", "aig"]),
        expectedProfile,
      );
      return {
        analysis: mapped.llmAnalysis,
        aigAnalysis: mapped.aigAnalysis,
        skillSpectorAnalysis: mapped.skillSpectorAnalysis,
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "ClawScan Decisions artifact was invalid",
      };
    }
  }
  const judge = asRecord(record?.judge);
  const judgeStatus = readString(judge, ["status"]);
  const judgeError = readString(judge, ["error"]);
  const requireAig = targetKind !== "packageRelease";
  const scanners = asRecord(record?.scanners);
  const requiredScanners = requireAig ? REQUIRED_SKILL_SCANNERS : REQUIRED_PACKAGE_SCANNERS;
  const scannerFailures = collectClawScanScannerFailures(scanners, requiredScanners);
  if (scannerFailures.length > 0) {
    return { error: `ClawScan scanner did not complete: ${scannerFailures.join(", ")}` };
  }
  if (judgeStatus !== "completed") {
    return {
      error: [
        `ClawScan judge status was ${judgeStatus ?? "missing"}`,
        ...(judgeError ? [judgeError] : []),
      ].join(": "),
    };
  }
  const missingScanners = requiredScanners.filter((scanner) => scanners?.[scanner] === undefined);
  if (missingScanners.length > 0) {
    return {
      error: `ClawScan scanner did not complete: ${missingScanners
        .map((scanner) => `${scanner}=missing`)
        .join(", ")}`,
    };
  }
  try {
    if (!record) throw new Error("ClawScan artifact was missing");
    const mapped = validateClawScanArtifactForClawHubProfile(record, requiredScanners);
    return {
      aigAnalysis: mapped.aigAnalysis,
      analysis: mapped.llmAnalysis,
      skillSpectorAnalysis: mapped.skillSpectorAnalysis,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "ClawScan artifact was invalid" };
  }
}

function clawScanCheckResult(analysis: StoredLlmAnalysis): WorkerCheckResult {
  const status = (analysis.status || analysis.verdict || "").trim().toLowerCase();
  const verdict = (analysis.verdict || "").trim().toLowerCase();
  const normalizedVerdict = verdict || status;
  const summary = publicText(
    analysis.summary ?? analysis.findings ?? `ClawScan returned ${analysis.status}.`,
  );
  if (status === "clean" || normalizedVerdict === "benign") {
    return {
      status: "clean",
      summary: summary || "ClawScan passed.",
    };
  }
  if (normalizedVerdict === "suspicious") {
    return {
      status: "clean",
      summary: summary || "ClawScan returned suspicious review findings.",
      redactedFindings: [publicText(`status=${analysis.status}; verdict=${analysis.verdict}`)],
    };
  }
  if (normalizedVerdict !== "malicious") {
    return {
      status: "failed",
      summary: summary || "ClawScan did not return a final verdict.",
      redactedFindings: [publicText(`status=${analysis.status}; verdict=${analysis.verdict}`)],
    };
  }
  return {
    status: "blocked",
    summary: summary || `ClawScan blocked the staged publish with status ${analysis.status}.`,
    redactedFindings: [publicText(`status=${analysis.status}; verdict=${analysis.verdict}`)],
  };
}

// Failure diagnostics must never publish source/provider text, even after redaction.
function diagnosticFingerprint(value: string | Buffer | null | undefined) {
  return {
    present: value != null,
    bytes: value == null ? null : Buffer.byteLength(value),
    sha256: value == null ? null : createHash("sha256").update(value).digest("hex"),
  };
}

function backendFailureDiagnostic(error: unknown) {
  let message: string | undefined;
  let safeError = "";
  try {
    const rawMessage = error instanceof Error ? error.message : error;
    message = typeof rawMessage === "string" ? rawMessage : undefined;
    safeError = message && message.length <= 4_096 ? publicText(message, 4_096) : "";
  } catch {
    // A diagnostic must not replace the original worker failure.
  }
  const errorClass = /TooManyWrites|CommitterFullError|Too many writes in a short period/i.test(
    safeError,
  )
    ? "capacity"
    : /Publish attempt (?:check claim is not active|artifact fingerprint does not match scanned input|is already finalizing)/i.test(
          safeError,
        )
      ? "claim"
      : /\bUnauthorized\b/.test(safeError)
        ? "authentication"
        : /ArgumentValidationError|ReturnValidationError|Could not serialize|Unsupported type/.test(
              safeError,
            )
          ? "validation"
          : /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up/i.test(safeError)
            ? "transport"
            : "other";
  // Only retain a canonical Convex prefix, never a request-like string in artifact text.
  const requestId =
    safeError
      .match(
        /^(?:Error:\s*)?(?:\[CONVEX [A-Z]\([A-Za-z0-9_/:.-]+\)\]\s*)?\[Request ID:\s*([a-f0-9]{16})\](?:\s|$)/i,
      )?.[1]
      ?.toLowerCase() ?? null;
  return { class: errorClass, requestId, ...diagnosticFingerprint(message) };
}

function nativeScannerDiagnostic(value: unknown) {
  const scanner = asRecord(value);
  const error = typeof scanner?.error === "string" ? scanner.error : undefined;
  // Only classify bounded redacted errors; hashes distinguish every other error.
  const safeError = error && error.length <= 4_096 ? publicText(error, 4_096) : "";
  const errorClass = !error
    ? scanner?.error == null || error === ""
      ? "none"
      : "invalid"
    : safeError.endsWith("aig-skill-scan did not write SARIF output.")
      ? "missing_sarif"
      : safeError.endsWith("aig-skill-scan returned invalid SARIF 2.1.0 JSON")
        ? "invalid_sarif"
        : "other";
  let raw = { present: scanner?.raw != null, bytes: null, sha256: null } as ReturnType<
    typeof diagnosticFingerprint
  >;
  try {
    // Raw hashes cover the parsed JSON serialization, not original SARIF bytes.
    if (raw.present) raw = diagnosticFingerprint(JSON.stringify(scanner?.raw));
  } catch {
    // Deep/unserializable untrusted JSON must not replace the scan failure.
  }
  const boundedInteger = (entry: unknown, maximum: number) =>
    typeof entry === "number" && Number.isSafeInteger(entry) && entry >= 0 && entry <= maximum
      ? entry
      : null;
  const status = scanner?.status;
  return {
    status: !scanner
      ? "missing"
      : typeof status === "string" &&
          ["pending", "running", "completed", "partial", "failed", "skipped"].includes(status)
        ? status
        : "unknown",
    exitCode: boundedInteger(scanner?.exitCode, 255),
    durationMs: boundedInteger(scanner?.durationMs, 86_400_000),
    error: { class: errorClass, ...diagnosticFingerprint(error || undefined) },
    raw,
  };
}

export async function runNativeClawScan(
  job: ClaimedJob,
  workspace: string,
  onExposure?: (exposure: ClawScanExposure) => void,
  onExecutionReport?: (report: NativeExecutionReport) => Promise<void>,
): Promise<ClawScanResult> {
  const artifactPath = join(workspace, "clawscan-result.json");
  const target = await resolveClawScanTarget(workspace, job);
  if (job.job.targetKind !== "packageRelease") {
    assertAigFilePathsHaveNoCompiledPython(job.target.files?.map((file) => file.path) ?? []);
  }
  const templateScan = await resolveTemplateScanForTarget(
    job.job.targetKind,
    job.target.package,
    "PREPUBLICATION",
  );
  const wholePlugin = await usesWholePluginScanForTarget(job.job.targetKind, job.target.package);
  const nativeMcp = Boolean(templateScan) || wholePlugin;
  const expectedProfile = templateScan ? "clawhub-template" : "clawhub";
  const command =
    templateScan?.command ??
    (wholePlugin ? await qualifiedPluginCommand("PREPUBLICATION") : clawScanCommand());
  const args = [target, "--profile", expectedProfile, "--output", artifactPath];
  if (job.job.targetKind === "packageRelease" && !templateScan) {
    // Only the backend-verified boolean enters the judge; package text and
    // existing scanner reports cannot elevate publisher trust.
    const contextPath = join(workspace, "clawscan-publisher-context.json");
    await writeFile(
      contextPath,
      JSON.stringify({ trustedOpenClawPlugin: job.target.trustedOpenClawPlugin === true }),
      { mode: 0o600 },
    );
    args.push("--context", contextPath);
  }
  const sandbox = process.env.PREPUBLICATION_CLAWSCAN_SANDBOX?.trim();
  if (nativeMcp) {
    args.push(
      "--sandbox",
      "docker",
      "--sandbox-image",
      templateScan?.image ?? QUALIFIED_PLUGIN_IMAGE,
    );
  } else if (sandbox) {
    args.push("--sandbox", sandbox);
    const sandboxImage = process.env.PREPUBLICATION_CLAWSCAN_SANDBOX_IMAGE?.trim();
    if (sandbox === "docker" && sandboxImage) args.push("--sandbox-image", sandboxImage);
  }

  onExposure?.(clawScanExposure());
  const startedAt = Date.now();
  let output: { code: number | null; stdout: string; stderr: string } | undefined;
  let artifactBytes: Buffer | undefined;
  let artifactPresence: "missing" | "unreadable" | "malformed" | "invalid_schema" | "present" =
    "missing";
  let failure: NativeExecutionReport["failure"] = null;
  try {
    output = nativeMcp
      ? await withClawScanDockerCleanup({
          workspace,
          confirmChildFinality: async () =>
            hasKnownClawScanChildFinality(JSON.parse(await readFile(artifactPath, "utf8"))),
          env: {
            ...restrictedChildEnvironment(workspace),
            ...clawScanDockerEnvironment(process.env),
            ...securityScannerEnvironment(process.env),
          },
          run: async (env, onTermination) => {
            try {
              const captured = await runWorkerCommand(command, args, {
                cwd: workspace,
                env,
                timeoutMs: clawScanTimeoutMs(true),
                cleanupProcessGroup: true,
                onTermination,
              });
              output = { code: 0, ...captured };
              return output;
            } catch (error) {
              if (error instanceof CommandFailure)
                output = { code: error.exitCode, stdout: error.stdout, stderr: error.stderr };
              throw error;
            }
          },
        })
      : await runCommand(command, args, {
          cwd: workspace,
          env: {
            ...restrictedChildEnvironment(workspace),
            ...clawScanDockerEnvironment(process.env),
            ...securityScannerEnvironment(process.env),
          },
          timeoutMs: clawScanTimeoutMs(),
          onOutput: (captured) => {
            output = captured;
          },
        });
    const durationMs = Date.now() - startedAt;
    let artifact: unknown;
    try {
      artifactBytes = await readFile(artifactPath);
      artifactPresence = "malformed";
      artifact = JSON.parse(artifactBytes.toString("utf8"));
      const root = asRecord(artifact);
      artifactPresence =
        root?.schemaVersion === "clawscan-run-v1" && root.profile === expectedProfile
          ? "present"
          : "invalid_schema";
    } catch (error) {
      if (!artifactBytes)
        artifactPresence =
          (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "unreadable";
      artifact = undefined;
    }
    onExposure?.(clawScanExposure(artifact, expectedProfile));
    const logFailureDiagnostic = () => {
      const root = artifactPresence === "present" ? asRecord(artifact) : undefined;
      const scanners = asRecord(root?.scanners);
      const scanner = asRecord(scanners?.skillspector);
      logger.info(
        {
          attemptId: String(job.job._id),
          event: "prepublication_clawscan_failure_diagnostic",
          exitCode: output?.code ?? null,
          durationMs,
          artifact: { ...diagnosticFingerprint(artifactBytes), presence: artifactPresence },
          scanners: Object.fromEntries(
            REQUIRED_SKILL_SCANNERS.map((name) => [
              name,
              nativeScannerDiagnostic(scanners?.[name]),
            ]),
          ),
          ...(root ? { skillSpector: projectSkillSpectorReport(scanner?.raw) } : {}),
        },
        "pre-publication scanner completeness diagnostic",
      );
    };
    if (output.code !== 0) {
      logFailureDiagnostic();
      return {
        check: {
          status: "failed",
          summary: publicText(
            `ClawScan failed before returning a verdict: ${output.stderr || output.stdout}`,
          ),
        },
      };
    }

    if (nativeMcp || Object.hasOwn(asRecord(asRecord(artifact)?.scanners) ?? {}, "aig-mcp")) {
      try {
        if (!nativeMcp)
          throw new Error(
            "A.I.G MCP evidence requires the qualified source and immutable Docker runtime",
          );
        if (templateScan) assertQualifiedNativeArtifact(asRecord(artifact)!, templateScan);
        else assertQualifiedPluginArtifact(asRecord(artifact)!);
      } catch (error) {
        return {
          check: {
            status: "failed",
            summary: error instanceof Error ? error.message : "Unqualified A.I.G MCP runtime",
          },
        };
      }
    }
    const parsed = storedAnalysisFromClawScanArtifact(
      artifact,
      job.job.targetKind,
      nativeMcp
        ? ["aig-mcp"]
        : job.job.targetKind === "packageRelease" && asRecord(job.target.package)?.family === "claw"
          ? REQUIRED_PACKAGE_SCANNERS
          : undefined,
      expectedProfile,
    );
    if (parsed.error || !parsed.analysis) {
      logFailureDiagnostic();
      return {
        check: {
          status: "failed",
          summary: publicText(parsed.error ?? "ClawScan did not return a usable result."),
        },
      };
    }
    return {
      analysis: parsed.analysis,
      aigAnalysis: parsed.aigAnalysis,
      skillSpectorAnalysis: parsed.skillSpectorAnalysis,
      check: clawScanCheckResult(parsed.analysis),
    };
  } catch (error) {
    failure =
      error instanceof Error
        ? { name: error.name, message: error.message }
        : { name: "UnknownError", message: String(error) };
    throw error;
  } finally {
    if (onExecutionReport) {
      try {
        // Keep failed/malformed output too; the caller stores it privately before cleanup.
        if (!artifactBytes) {
          artifactBytes = await readFile(artifactPath).catch(() => undefined);
          if (artifactBytes) {
            artifactPresence = "malformed";
            try {
              const root = asRecord(JSON.parse(artifactBytes.toString("utf8")));
              artifactPresence =
                root?.schemaVersion === "clawscan-run-v1" && root.profile === expectedProfile
                  ? "present"
                  : "invalid_schema";
            } catch {
              /* Retain malformed bytes without inventing a parsed report. */
            }
          }
        }
        await onExecutionReport({
          startedAt,
          completedAt: Date.now(),
          exitCode: output?.code ?? null,
          stdout: output?.stdout ?? "",
          stderr: output?.stderr ?? "",
          failure,
          artifact: {
            presence: artifactPresence,
            encoding: "base64",
            content: artifactBytes?.toString("base64") ?? null,
            bytes: artifactBytes?.byteLength ?? null,
            sha256: artifactBytes ? createHash("sha256").update(artifactBytes).digest("hex") : null,
          },
        });
      } catch {
        // Evidence capture must not replace the scanner outcome or expose private text.
        logger.warn(
          { event: "prepublication_report_capture_failed", attemptId: String(job.job._id) },
          "Pre-publication execution evidence could not be captured",
        );
      }
    }
  }
}

function checkResultForConvex(result: WorkerCheckResult): WorkerCheckResult {
  return {
    status: result.status,
    ...(result.summary ? { summary: result.summary } : {}),
    ...(result.redactedFindings ? { redactedFindings: result.redactedFindings } : {}),
  };
}

async function completeAttempt(
  client: PrePublicationWorkerClient,
  token: string,
  attempt: ClaimedPrePublicationAttempt,
  trufflehog: WorkerCheckResult,
  clawscan: WorkerCheckResult,
  clawscanAnalysis?: StoredLlmAnalysis,
  aigAnalysis?: AigAnalysis,
  skillSpectorAnalysis?: SkillSpectorAnalysis,
) {
  return await client.action(api.publishAttempts.completePrePublicationChecks, {
    token,
    attemptId: attempt.attemptId,
    claimId: attempt.claimId,
    artifactFingerprint: attempt.artifactFingerprint,
    trufflehog: checkResultForConvex(trufflehog),
    clawscan: checkResultForConvex(clawscan),
    ...(clawscanAnalysis ? { clawscanAnalysis } : {}),
    ...(aigAnalysis ? { aigAnalysis } : {}),
    ...(skillSpectorAnalysis ? { skillSpectorAnalysis } : {}),
  });
}

async function retainExecutionReport(
  token: string,
  attempt: ClaimedPrePublicationAttempt,
  execution: NativeExecutionReport,
  projections: ClawScanResult,
) {
  if (!attempt.prepublicationReportUploadUrl) return;
  let timeout: NodeJS.Timeout | undefined;
  try {
    const store = async () => {
      const revision = (value: string | undefined) =>
        value && /^[a-f0-9]{40}$/.test(value) ? value : null;
      const numericId = (value: string | undefined) =>
        value && /^\d+$/.test(value) ? value : null;
      const clawscanSourceCommit = await readFile(
        new URL("./clawscan-source-commit.txt", import.meta.url),
        "utf8",
      )
        .then((value) => revision(value.trim()))
        .catch(() => null);
      const report = prepublicationReportSchema.parse({
        schemaVersion: "clawhub-prepublication-execution-v1",
        attempt: {
          id: attempt.attemptId,
          claimId: attempt.claimId,
          artifactFingerprint: attempt.artifactFingerprint,
          kind: attempt.kind,
          slug: attempt.slug,
          version: attempt.version,
          files: attempt.files.map(({ path, size, sha256 }) => ({ path, size, sha256 })),
        },
        source: {
          workerId: process.env.PREPUBLICATION_WORKER_ID ?? null,
          workerRevision: revision(process.env.GITHUB_SHA),
          githubRunId: numericId(process.env.GITHUB_RUN_ID),
          githubRunAttempt: numericId(process.env.GITHUB_RUN_ATTEMPT),
          configuredClawscanSourceCommit: clawscanSourceCommit,
          nodeVersion: process.version,
          platform: process.platform,
          arch: process.arch,
        },
        execution,
        projections,
      });
      const body = JSON.stringify(report);
      if (Buffer.byteLength(body) > MAX_PREPUBLICATION_REPORT_BYTES)
        throw new Error("Private report exceeds storage limit");
      const response = await fetch(attempt.prepublicationReportUploadUrl!, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-ClawHub-Attempt-Id": attempt.attemptId,
          "X-ClawHub-Claim-Id": attempt.claimId,
          "X-ClawHub-Artifact-Fingerprint": attempt.artifactFingerprint,
          "X-ClawHub-Report-SHA256": createHash("sha256").update(body).digest("hex"),
        },
        body,
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error("Private report retention failed");
      const receipt = asRecord(await response.json());
      if (typeof receipt?.receiptId !== "string" || !receipt.receiptId)
        throw new Error("Invalid private report receipt");
      logger.info(
        {
          event: "prepublication_report_retained",
          attemptId: attempt.attemptId,
          receiptId: receipt.receiptId,
        },
        "Private pre-publication execution evidence retained",
      );
    };
    await Promise.race([
      store(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("Private report retention timed out")), 15_000);
      }),
    ]);
  } catch {
    // Never log the exception, upload URL, raw report, source or provider text.
    logger.warn(
      { event: "prepublication_report_retention_failed", attemptId: attempt.attemptId },
      "Private execution evidence was not retained; normal checks continue",
    );
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function processPrePublicationAttempt(
  client: PrePublicationWorkerClient,
  token: string,
  attempt: ClaimedPrePublicationAttempt,
  deps: ProcessAttemptDeps = {},
) {
  let exposure = noClawScanExposure();
  let scanDisposition = "not_started";
  const reportExposure = () => {
    logger.info(
      {
        attemptId: attempt.attemptId,
        event: "prepublication_attempt_exposure",
        exposure,
        scanDisposition,
        kind: attempt.kind,
      },
      "pre-publication attempt judge exposure",
    );
    deps.onExposure?.(exposure);
  };
  if (attempt.status === "ready_to_finalize") {
    exposure = noClawScanExposure(false);
    scanDisposition = "finalization_only";
    try {
      const result = await completeAttempt(
        client,
        token,
        attempt,
        {
          status: "clean",
          summary: "Pre-publication TruffleHog check already passed.",
        },
        {
          status: "clean",
          summary: "Pre-publication ClawScan already passed.",
        },
        undefined,
        attempt.existingAigAnalysis,
      );
      logger.info(
        {
          attemptId: attempt.attemptId,
          event: "prepublication_attempt_finalization_retried",
          kind: attempt.kind,
        },
        "pre-publication attempt finalization retried",
      );
      return { completed: (result as { status?: string })?.status === "finalized", result };
    } catch (error) {
      logger.warn(
        {
          attemptId: attempt.attemptId,
          completionError: backendFailureDiagnostic(error),
          event: "prepublication_attempt_finalization_retry_failed",
          kind: attempt.kind,
        },
        "pre-publication attempt finalization retry failed",
      );
      return { completed: false, result: undefined };
    } finally {
      reportExposure();
    }
  }

  const workspace = await mkdtemp(
    join(tmpdir(), `clawhub-prepublication-${basename(String(attempt.attemptId))}-`),
  );
  const startedAt = Date.now();
  const writeWorkspace = deps.writeWorkspace ?? writeArtifactWorkspace;
  const runTruffleHog = deps.runTruffleHog ?? runNativeTruffleHog;
  const runClawScan = deps.runClawScan ?? runNativeClawScan;
  let truffleHogBlocked = false;
  let completionStarted = false;
  let executionReport: NativeExecutionReport | undefined;
  let preserveWorkspace = false;
  try {
    const job = buildSyntheticScanJob(attempt);
    await writeWorkspace(job, workspace);
    if (attempt.kind === "skill") {
      assertAigFilePathsHaveNoCompiledPython(attempt.files.map((file) => file.path));
    }
    const trufflehog = await runTruffleHog(workspace);
    if (trufflehog.status === "blocked") {
      exposure = noClawScanExposure(false);
      scanDisposition = "secret_blocked";
      truffleHogBlocked = true;
      completionStarted = true;
      const result = await completeAttempt(client, token, attempt, trufflehog, {
        status: "failed",
        summary: "ClawScan skipped because TruffleHog blocked the artifact.",
      });
      logger.info(
        {
          attemptId: attempt.attemptId,
          durationMs: Date.now() - startedAt,
          event: "prepublication_attempt_blocked",
          kind: attempt.kind,
          scanner: "trufflehog",
        },
        "pre-publication attempt blocked by TruffleHog",
      );
      return { completed: true, result };
    }
    if (trufflehog.status === "failed") {
      scanDisposition = "secret_check_failed";
      completionStarted = true;
      const result = await completeAttempt(client, token, attempt, trufflehog, {
        status: "failed",
        summary: "ClawScan skipped because TruffleHog failed.",
      });
      return { completed: false, result };
    }

    let clawscan: WorkerCheckResult;
    let clawscanAnalysis: StoredLlmAnalysis | undefined;
    let aigAnalysis: AigAnalysis | undefined;
    let skillSpectorAnalysis: SkillSpectorAnalysis | undefined;
    const existingClawscanAnalysis = attempt.existingClawscanAnalysis;
    const existingAigAnalysis = attempt.existingAigAnalysis;
    if (
      existingClawscanAnalysis &&
      (attempt.kind === "package" ||
        (existingAigAnalysis &&
          existingAigAnalysis.status !== "error" &&
          existingAigAnalysis.checkedAt === existingClawscanAnalysis.checkedAt))
    ) {
      clawscanAnalysis = existingClawscanAnalysis;
      exposure = noClawScanExposure(false);
      scanDisposition = "exact_artifact_reuse";
      aigAnalysis = attempt.kind === "skill" ? existingAigAnalysis : undefined;
      clawscan = clawScanCheckResult(clawscanAnalysis);
      logger.info(
        {
          attemptId: attempt.attemptId,
          event: "prepublication_clawscan_result_reused",
          kind: attempt.kind,
        },
        "pre-publication ClawScan result reused for exact artifact",
      );
    } else {
      try {
        scanDisposition = "new_scan";
        const review = await runClawScan(
          job,
          workspace,
          (next) => {
            exposure = next;
          },
          async (report) => {
            executionReport = report;
          },
        );
        clawscanAnalysis = review.analysis;
        aigAnalysis = review.aigAnalysis;
        skillSpectorAnalysis = review.skillSpectorAnalysis;
        clawscan = review.check;
      } catch (error) {
        if (error instanceof ClawScanContainerCleanupError) throw error;
        clawscan = {
          status: "failed",
          summary: publicText(error instanceof Error ? error.message : String(error)),
        };
      }
    }

    if (executionReport) {
      await retainExecutionReport(token, attempt, executionReport, {
        check: clawscan,
        analysis: clawscanAnalysis,
        aigAnalysis,
        skillSpectorAnalysis,
      });
    }
    completionStarted = true;
    const result = await completeAttempt(
      client,
      token,
      attempt,
      trufflehog,
      clawscan,
      clawscanAnalysis,
      aigAnalysis,
      skillSpectorAnalysis,
    );
    logger.info(
      {
        attemptId: attempt.attemptId,
        clawscanSummary: clawscan.summary,
        clawscanStatus: clawscan.status,
        durationMs: Date.now() - startedAt,
        event: "prepublication_attempt_completed",
        kind: attempt.kind,
        trufflehogStatus: trufflehog.status,
      },
      "pre-publication attempt completed",
    );
    const status = (result as { status?: string })?.status;
    return { completed: status === "finalized" || status === "blocked", result };
  } catch (error) {
    if (error instanceof ClawScanContainerCleanupError) {
      preserveWorkspace = true;
      logger.error(
        { event: "prepublication_container_cleanup_unconfirmed", attemptId: attempt.attemptId },
        "ClawScan container removal unconfirmed; preserving workspace and stopping worker",
      );
      return { completed: false, result: undefined, workerMustStop: true };
    }
    if (truffleHogBlocked) {
      logger.error(
        {
          attemptId: attempt.attemptId,
          completionError: backendFailureDiagnostic(error),
          durationMs: Date.now() - startedAt,
          event: "prepublication_attempt_secret_block_completion_failed",
          kind: attempt.kind,
        },
        "pre-publication TruffleHog block completion failed; leaving attempt retryable",
      );
      return { completed: false, result: undefined };
    }
    if (completionStarted) {
      logger.warn(
        {
          attemptId: attempt.attemptId,
          completionError: backendFailureDiagnostic(error),
          durationMs: Date.now() - startedAt,
          event: "prepublication_attempt_completion_failed",
          kind: attempt.kind,
        },
        "pre-publication attempt completion failed; leaving attempt retryable",
      );
      return { completed: false, result: undefined };
    }
    const failure = {
      status: "failed" as const,
      summary: publicText(error instanceof Error ? error.message : String(error)),
    };
    let result: unknown;
    try {
      result = await completeAttempt(client, token, attempt, failure, failure);
    } catch (completionError) {
      logger.warn(
        {
          attemptId: attempt.attemptId,
          completionError: backendFailureDiagnostic(completionError),
          durationMs: Date.now() - startedAt,
          event: "prepublication_attempt_failure_record_failed",
          kind: attempt.kind,
        },
        "pre-publication attempt failure could not be recorded; leaving attempt retryable",
      );
      return { completed: false, result: undefined };
    }
    logger.warn(
      {
        attemptId: attempt.attemptId,
        durationMs: Date.now() - startedAt,
        event: "prepublication_attempt_failed",
        kind: attempt.kind,
      },
      "pre-publication attempt failed before checks completed",
    );
    return { completed: false, result };
  } finally {
    reportExposure();
    if (!preserveWorkspace) await rm(workspace, { force: true, recursive: true });
  }
}

export async function processPrePublicationBatch(
  attempts: ClaimedPrePublicationAttempt[],
  processAttempt: (attempt: ClaimedPrePublicationAttempt) => Promise<ProcessAttemptResult>,
) {
  return await Promise.all(
    attempts.map(async (attempt) => {
      try {
        return await processAttempt(attempt);
      } catch (error) {
        if (error instanceof ClawScanContainerCleanupError)
          return { completed: false, result: undefined, workerMustStop: true };
        logger.warn(
          {
            attemptId: attempt.attemptId,
            event: "prepublication_attempt_unhandled_failure",
            kind: attempt.kind,
          },
          "pre-publication attempt failed unexpectedly; continuing batch",
        );
        return { completed: false, result: undefined };
      }
    }),
  );
}

export async function claimPrePublicationAttempt(
  client: PrePublicationWorkerClient,
  token: string,
  filters: PrePublicationClaimFilters = {},
  preferRetry = false,
  scannerSource?: string,
) {
  return (await client.action(api.publishAttempts.claimPrePublicationChecks, {
    token,
    ...filters,
    ...(preferRetry ? { preferRetry: true } : {}),
    ...(scannerSource ? { scannerSource } : {}),
  })) as ClaimedPrePublicationAttempt | null;
}

export async function claimPrePublicationBatch(
  client: PrePublicationWorkerClient,
  token: string,
  limit: number,
  filters: PrePublicationClaimFilters = {},
  scannerSource?: string,
) {
  const claims = await Promise.allSettled(
    Array.from({ length: limit }, (_, index) =>
      claimPrePublicationAttempt(client, token, filters, index === 0, scannerSource),
    ),
  );
  const attempts: ClaimedPrePublicationAttempt[] = [];
  const failures: unknown[] = [];
  for (const claim of claims) {
    if (claim.status === "fulfilled") {
      if (claim.value) attempts.push(claim.value);
      continue;
    }
    failures.push(claim.reason);
    logger.warn(
      { event: "prepublication_claim_failed", claimError: backendFailureDiagnostic(claim.reason) },
      "pre-publication claim failed; continuing with successful claims",
    );
  }
  if (attempts.length === 0 && failures.length > 0) {
    throw new AggregateError(failures, "Pre-publication claims failed without claiming work.");
  }
  return { attempts, claimFailures: failures.length };
}

export function claimBatchDrainedQueue(
  claimFailures: number,
  claimedAttempts: number,
  claimLimit: number,
) {
  return claimFailures === 0 && claimedAttempts < claimLimit;
}

async function main() {
  const startedAt = Date.now();
  const { batchLimit, claimFilters, maxJobs, maxRuntimeMs } = parseArgs();
  maskKnownWorkerSecrets();
  const convexUrl = process.env.CONVEX_URL ?? process.env.VITE_CONVEX_URL;
  if (!convexUrl) throw new Error("CONVEX_URL or VITE_CONVEX_URL is required");
  const token = requireEnv("SECURITY_SCAN_WORKER_TOKEN");
  const client = new ConvexHttpClient(convexUrl);
  const scannerRuntime = await resolvePrepublicationScannerRuntime();
  if (scannerRuntime) process.env.PREPUBLICATION_CLAWSCAN_COMMAND = scannerRuntime.command;
  const claimDeadline = startedAt + maxRuntimeMs;
  const workerDeadline = securityWorkerDeadline(
    startedAt,
    pluginScanBudget.publicationWorkerMs,
    process.env.SECURITY_SCAN_WORKER_HOST_DEADLINE_MS,
  );
  let totalClaimed = 0;
  let totalCompleted = 0;
  const exposures: ClawScanExposure[] = [];

  logger.info(
    {
      event: "prepublication_worker_started",
      ...(scannerRuntime ? { scannerSource: scannerRuntime.source } : {}),
      workerId:
        process.env.PREPUBLICATION_WORKER_ID ??
        `github-actions:${process.env.GITHUB_RUN_ID ?? process.pid}`,
    },
    "pre-publication worker started",
  );

  while (
    canAdmitSecurityScan(
      Date.now(),
      claimDeadline,
      workerDeadline,
      pluginScanBudget.publicationJobMs,
    )
  ) {
    const remainingJobs = maxJobs === undefined ? batchLimit : Math.max(0, maxJobs - totalClaimed);
    if (remainingJobs === 0) break;
    const targeted = Object.values(claimFilters).some(Boolean);
    const claimLimit = Math.min(targeted ? 1 : batchLimit, remainingJobs);
    const { attempts, claimFailures } = await claimPrePublicationBatch(
      client,
      token,
      claimLimit,
      claimFilters,
      scannerRuntime?.source,
    );
    if (attempts.length === 0) break;
    totalClaimed += attempts.length;
    const results = await processPrePublicationBatch(attempts, (attempt) =>
      processPrePublicationAttempt(client, token, attempt, {
        onExposure: (exposure) => exposures.push(exposure),
      }),
    );
    totalCompleted += results.filter((result) => result.completed).length;
    if (results.some((result) => result.workerMustStop)) {
      throw new Error("ClawScan Docker cleanup could not be confirmed; refusing further claims");
    }
    if (claimBatchDrainedQueue(claimFailures, attempts.length, claimLimit)) break;
  }

  logger.info(
    {
      elapsedMs: Date.now() - startedAt,
      event: "prepublication_worker_summary",
      exposure: summarizeClawScanExposure(exposures),
      totalClaimed,
      totalCompleted,
    },
    "pre-publication worker summary",
  );

  // Claiming work and completing none is a stall, not success. The run still
  // exits zero so a known-held backlog cannot wedge the schedule red, but the
  // error level gives alerting a signal instead of a green job hiding it.
  if (totalClaimed > 0 && totalCompleted === 0) {
    logger.error(
      {
        event: "prepublication_worker_stalled",
        totalClaimed,
        totalCompleted,
      },
      "pre-publication worker claimed attempts but completed none",
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
