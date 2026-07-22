import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { parseLlmEvalResponse, type LlmEvalDimension } from "../../convex/lib/securityPrompt";
import { assertCodexWorkerExecutionAllowed, resolveCodexWorkerHome } from "../codex-worker-guard";
import { createWorkerLogger } from "../lib/workerLogger";
import {
  maskGitHubActionsSecret,
  maskKnownWorkerSecrets,
  redactWorkerPublicErrorMessage,
  redactWorkerPublicText,
  safeWorkerArtifactPathLabel,
} from "../lib/workerRedaction";
import {
  calculateSecurityScanWorkerHealthSummary,
  renderSecurityScanWorkerSummaryMarkdown,
  type SecurityScanJobHealth,
  type SecurityScanQueueHealth,
} from "./security-scan-worker-summary";

export type ClaimedJob = {
  job: {
    _id: string;
    leaseToken: string;
    targetKind: "skillVersion" | "packageRelease" | "skillScanRequest";
    source: string;
    hasMaliciousSignal: boolean;
    waitForVtUntil: number;
    attempts?: number;
  };
  target: Record<string, unknown> & {
    files?: Array<{
      path: string;
      url: string;
      size: number;
      sha256: string;
      contentType?: string;
    }>;
    clawpackUrl?: string | null;
  };
};

type ClaimedJobLease = ClaimedJob["job"];

export type StoredLlmAnalysis = {
  status: string;
  verdict?: string;
  confidence?: string;
  summary?: string;
  dimensions?: LlmEvalDimension[];
  guidance?: string;
  findings?: string;
  model?: string;
  checkedAt: number;
};

type SkillSpectorIssue = {
  issueId: string;
  category?: string;
  pattern?: string;
  severity: string;
  confidence?: number;
  file?: string;
  startLine?: number;
  endLine?: number;
  explanation: string;
  remediation?: string;
  finding?: string;
  codeSnippet?: string;
};

export type SkillSpectorAnalysis = {
  status: string;
  score?: number;
  severity?: string;
  recommendation?: string;
  issueCount: number;
  issues: SkillSpectorIssue[];
  scannerVersion?: string;
  summary?: string;
  error?: string;
  checkedAt: number;
};

type ClawScanCommandDiagnostic = {
  args?: string[];
  artifactPath?: string;
  exitCode?: number | null;
  rawArtifact?: string;
  stderr?: string;
  stdout?: string;
  timedOut?: boolean;
  mapping?: {
    judge?: {
      outputSchemaSha256?: string;
      promptSha256?: string;
      status?: string;
      verdict?: string;
    };
    scanners?: {
      skillspectorStatus?: string;
      staticStatus?: string;
    };
  };
};

type JobDiagnosticInput = {
  clawscan?: ClawScanCommandDiagnostic;
  completedAt: number;
  diagnosticsRoot?: string;
  error?: string;
  job: ClaimedJob;
  llmAnalysis?: unknown;
  runId?: string;
  skillSpectorAnalysis?: unknown;
  startedAt: number;
  status: "completed" | "failed";
};

type CodexScanWorkerClient = Pick<ConvexHttpClient, "action">;

type ProcessJobResult = {
  completed: boolean;
  hardFailed: boolean;
  retryableFailed: boolean;
};

const DEFAULT_BATCH_LIMIT = 4;
const DEFAULT_MAX_RUNTIME_MS = 40 * 60 * 1000;
const DEFAULT_CLAWSCAN_TIMEOUT_MS = 20 * 60 * 1000;
const REQUIRED_CLAWHUB_SCANNERS = ["clawscan-static", "skillspector"];
const MAX_DIAGNOSTIC_TEXT_CHARS = 20_000;
const MAX_STORED_SKILLSPECTOR_ISSUES = 25;
const MAX_STORED_SKILLSPECTOR_TEXT_CHARS = 2_000;
const MAX_STORED_SKILLSPECTOR_SHORT_TEXT_CHARS = 512;
const DEFAULT_LEASE_MS = 60 * 60 * 1000;
const logger = createWorkerLogger({ name: "security-scan-worker" });

const root = resolve(new URL("../..", import.meta.url).pathname);
const schemaPath = join(root, "scripts/security/codex-scan-output.schema.json");
const DEFAULT_DIAGNOSTICS_ROOT = join(
  root,
  ".artifacts/codex-security-scan",
  process.env.GITHUB_RUN_ID ?? `local-${process.pid}`,
);
const LOCAL_CODEX_HOME = join(root, ".codex/runtime/codex-workers/security-scan");

type ClawHubOutputSchemaContract = {
  allowedConfidence: Set<string>;
  allowedDimensionStatus: Set<string>;
  allowedVerdict: Set<string>;
  requiredDimensionFieldKeys: string[];
  requiredDimensionKeys: string[];
  requiredFindingKeys: string[];
  requiredResultKeys: string[];
};

function readSchemaStringArray(value: unknown, context: string) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${context} was missing`);
  }
  const values = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
  if (values.length !== value.length) {
    throw new Error(`${context} must be a string array`);
  }
  return values;
}

function loadClawHubOutputSchemaContract(path: string): ClawHubOutputSchemaContract {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Failed to parse output schema at ${path}`, { cause: error });
  }
  const schema = asRecord(parsed);
  const properties = asRecord(schema?.properties);
  const dimensions = asRecord(properties?.dimensions);
  const dimensionProperties = asRecord(dimensions?.properties);
  const requiredDimensionKeys = readSchemaStringArray(
    dimensions?.required,
    "Output schema dimensions.required",
  );
  const firstDimension = asRecord(dimensionProperties?.[requiredDimensionKeys[0] ?? ""]);
  const firstDimensionProperties = asRecord(firstDimension?.properties);
  const dimensionStatus = asRecord(firstDimensionProperties?.status);
  const findings = asRecord(properties?.scan_findings_in_context);
  const findingItems = asRecord(findings?.items);
  const verdictSchema = asRecord(properties?.verdict);
  const confidenceSchema = asRecord(properties?.confidence);

  return {
    allowedConfidence: new Set(
      readSchemaStringArray(confidenceSchema?.enum, "Output schema confidence enum"),
    ),
    allowedDimensionStatus: new Set(
      readSchemaStringArray(dimensionStatus?.enum, "Output schema dimension status enum"),
    ),
    allowedVerdict: new Set(
      readSchemaStringArray(verdictSchema?.enum, "Output schema verdict enum"),
    ),
    requiredDimensionFieldKeys: readSchemaStringArray(
      firstDimension?.required,
      "Output schema dimension required fields",
    ),
    requiredDimensionKeys,
    requiredFindingKeys: readSchemaStringArray(
      findingItems?.required,
      "Output schema finding required fields",
    ),
    requiredResultKeys: readSchemaStringArray(schema?.required, "Output schema required fields"),
  };
}

const CLAWHUB_OUTPUT_SCHEMA_CONTRACT = loadClawHubOutputSchemaContract(schemaPath);

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (name: string) => {
    const index = args.indexOf(name);
    return index === -1 ? undefined : args[index + 1];
  };
  const numberFrom = (value: string | undefined, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  const optionalNumberFrom = (value: string | undefined) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  };
  const laneValue = get("--lane") ?? process.env.CODEX_SECURITY_SCAN_LANE;
  const lane: "priority" | "shared" | "catalog" =
    laneValue === "priority" || laneValue === "catalog" ? laneValue : "shared";
  return {
    batchLimit: numberFrom(
      get("--batch-limit") ?? get("--limit") ?? process.env.CODEX_SECURITY_SCAN_LIMIT,
      DEFAULT_BATCH_LIMIT,
    ),
    maxJobs: optionalNumberFrom(get("--max-jobs") ?? process.env.CODEX_SECURITY_SCAN_MAX_JOBS),
    maxRuntimeMs:
      numberFrom(
        get("--max-runtime-minutes") ?? process.env.CODEX_SECURITY_SCAN_MAX_RUNTIME_MINUTES,
        DEFAULT_MAX_RUNTIME_MS / 60_000,
      ) * 60_000,
    leaseMs:
      numberFrom(
        get("--lease-minutes") ?? process.env.CODEX_SECURITY_SCAN_LEASE_MINUTES,
        DEFAULT_LEASE_MS / 60_000,
      ) * 60_000,
    lane,
    diagnosticsRoot:
      get("--diagnostics-dir") ??
      process.env.CODEX_SECURITY_SCAN_DIAGNOSTICS_DIR ??
      DEFAULT_DIAGNOSTICS_ROOT,
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requireEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function safeDiagnosticPathSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 160) || "job";
}

function redactDiagnosticText(value: string, maxChars = MAX_DIAGNOSTIC_TEXT_CHARS) {
  return redactWorkerPublicText(value, maxChars);
}

function redactDiagnosticTextUncapped(value: string) {
  return redactDiagnosticText(value, Number.POSITIVE_INFINITY);
}

function redactDiagnosticError(value: string) {
  return redactDiagnosticText(value).replace(
    /(Codex result did not match ClawScan schema)(?::[\s\S]*)?/i,
    "$1: [redacted result body]",
  );
}

function sanitizeWorkerErrorMessage(value: string) {
  return redactWorkerPublicErrorMessage(redactDiagnosticError(value));
}

function redactEvidenceJsonValue(value: unknown, path: string[] = []): unknown {
  if (isDiagnosticSecretPath(path)) return "[redacted-secret]";
  if (typeof value === "string") return redactDiagnosticTextUncapped(value);
  if (Array.isArray(value)) {
    return value.map((entry) => redactEvidenceJsonValue(entry, [...path, "*"]));
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
      entryKey,
      redactEvidenceJsonValue(entryValue, [...path, entryKey]),
    ]),
  );
}

function redactEvidenceText(value: string, rootPath: string[]) {
  try {
    return JSON.stringify(redactEvidenceJsonValue(JSON.parse(value), rootPath), null, 2);
  } catch {
    return redactDiagnosticTextUncapped(value);
  }
}

const DIAGNOSTIC_CONTENT_TEXT_KEYS = new Set([
  "codesnippet",
  "content",
  "detail",
  "evidence",
  "explanation",
  "finding",
  "findings",
  "guidance",
  "match",
  "message",
  "note",
  "notes",
  "output",
  "rawresult",
  "recommendation",
  "result",
  "snippet",
  "stderr",
  "stdout",
  "summary",
  "text",
  "userimpact",
]);
const DIAGNOSTIC_PUBLIC_TEXT_PATHS = new Set([
  "clawscanartifact.profile",
  "clawscanartifact.schemaversion",
  "clawscanartifact.judge.status",
  "clawscanartifact.judge.promptpath",
  "clawscanartifact.judge.outputschemapath",
  "clawscanartifact.judge.promptsha",
  "clawscanartifact.judge.outputschemasha",
  "clawscanartifact.judge.result.verdict",
  "clawscanartifact.judge.result.confidence",
  "clawscanartifact.judge.result.summary",
  "clawscanartifact.scanners.*.status",
  "clawscanartifact.scanners.*.outputpath",
  "clawscanmapping.judge.status",
  "clawscanmapping.judge.verdict",
  "clawscanmapping.judge.promptsha256",
  "clawscanmapping.judge.outputschemasha256",
  "clawscanmapping.scanners.skillspectorstatus",
  "clawscanmapping.scanners.staticstatus",
  "llmanalysis.confidence",
  "llmanalysis.status",
  "llmanalysis.verdict",
  "skillspectoranalysis.issues.*.issueid",
  "skillspectoranalysis.issues.*.severity",
  "skillspectoranalysis.recommendation",
  "skillspectoranalysis.scannerversion",
  "skillspectoranalysis.severity",
  "skillspectoranalysis.status",
]);
const DIAGNOSTIC_PUBLIC_TEXT_VALUE_PATTERN = /^[A-Za-z0-9_.:@/-]{1,160}$/;

function normalizeDiagnosticKey(key: string) {
  return key.replace(/[_-]/g, "").toLowerCase();
}

function diagnosticPathKey(path: string[]) {
  return path.map((part) => (part === "*" ? part : normalizeDiagnosticKey(part))).join(".");
}

function isDiagnosticContentTextPath(path: string[]) {
  const key = path.at(-1) ?? "";
  return DIAGNOSTIC_CONTENT_TEXT_KEYS.has(normalizeDiagnosticKey(key));
}

function isDiagnosticSecretPath(path: string[]) {
  const key = normalizeDiagnosticKey(path.at(-1) ?? "");
  return /(apikey|authorization|credential|password|secret|token|webhook)/i.test(key);
}

function shouldPreserveDiagnosticText(path: string[], original: string, redacted: string) {
  const key = diagnosticPathKey(path);
  return (
    original === redacted &&
    (DIAGNOSTIC_PUBLIC_TEXT_PATHS.has(key) || key.startsWith("clawscanartifact.env.")) &&
    DIAGNOSTIC_PUBLIC_TEXT_VALUE_PATTERN.test(redacted)
  );
}

function redactDiagnosticValue(value: unknown, path: string[] = []): unknown {
  if (isDiagnosticSecretPath(path)) return "[redacted-secret]";
  if (typeof value === "string") {
    const redacted = redactDiagnosticText(value, 2_000);
    if (shouldPreserveDiagnosticText(path, value, redacted)) return redacted;
    return `[redacted ${redacted.length} chars]`;
  }
  if (Array.isArray(value)) {
    if (isDiagnosticContentTextPath(path)) return `[redacted ${value.length} item(s)]`;
    return value.map((item) => redactDiagnosticValue(item, [...path, "*"]));
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
      entryKey,
      redactDiagnosticValue(entryValue, [...path, entryKey]),
    ]),
  );
}

function redactCompleteDiagnosticText(value: string, rootKey: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    return JSON.stringify(redactDiagnosticValue(JSON.parse(trimmed), [rootKey]), null, 2);
  } catch {
    // Codex --json writes JSONL. Preserve every line while applying the same secret redaction.
    const lines = value.split("\n");
    if (lines.some((line) => line.trim().startsWith("{"))) {
      return lines
        .map((line) => {
          if (!line.trim()) return line;
          try {
            return JSON.stringify(redactDiagnosticValue(JSON.parse(line), [rootKey]));
          } catch {
            return redactDiagnosticTextUncapped(line);
          }
        })
        .join("\n");
    }
    return redactDiagnosticTextUncapped(value);
  }
}

function normalizedScannerOutputPath(value: string) {
  const normalized = value
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+$/, "");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized.split("/").some((segment) => segment === "..") ||
    !/^[A-Za-z0-9._/-]+$/.test(normalized)
  ) {
    return undefined;
  }
  return normalized;
}

type ClawScanScannerOutputReference = {
  scanner: string;
  outputPath: string;
};

function clawScanScannerOutputReferences(rawArtifact: string): ClawScanScannerOutputReference[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawArtifact);
  } catch {
    return [];
  }
  const artifact = asRecord(parsed);
  const scanners = asRecord(artifact?.scanners);
  if (!scanners) return [];
  const references: ClawScanScannerOutputReference[] = [];
  for (const [scanner, value] of Object.entries(scanners)) {
    const scannerRecord = asRecord(value);
    const outputPath =
      readString(scannerRecord ?? {}, ["outputPath", "output_path", "outputpath"]) ?? undefined;
    if (outputPath) {
      references.push({ scanner, outputPath });
    }
  }
  return references;
}

function safeScannerOutputSourcePath(artifactPath: string, relativeOutputPath: string) {
  const artifactDir = resolve(dirname(artifactPath));
  const source = resolve(artifactDir, relativeOutputPath);
  if (!source.startsWith(`${artifactDir}/`) && source !== artifactDir) {
    throw new Error(
      `Unsafe scanner output path: ${safeWorkerArtifactPathLabel(relativeOutputPath)}`,
    );
  }
  return source;
}

type CopiedScannerOutputDiagnostic = {
  scanner: string;
  outputPath: string;
  diagnosticPath?: string;
  status: "copied" | "missing" | "skipped";
};

async function copyClawScanScannerOutputs(input: {
  artifactPath: string;
  rawArtifact: string;
  jobDir: string;
}): Promise<CopiedScannerOutputDiagnostic[]> {
  const references = clawScanScannerOutputReferences(input.rawArtifact);
  const copied: CopiedScannerOutputDiagnostic[] = [];
  for (const reference of references) {
    const normalizedOutputPath = normalizedScannerOutputPath(reference.outputPath);
    if (!normalizedOutputPath) {
      copied.push({
        scanner: reference.scanner,
        outputPath: safeWorkerArtifactPathLabel(reference.outputPath),
        status: "skipped",
      });
      continue;
    }
    const sourcePath = safeScannerOutputSourcePath(input.artifactPath, normalizedOutputPath);
    if (!(await fileExists(sourcePath))) {
      copied.push({
        scanner: reference.scanner,
        outputPath: normalizedOutputPath,
        status: "missing",
      });
      continue;
    }
    const diagnosticPath = join("clawscan-scanner-outputs", normalizedOutputPath);
    const destinationPath = join(input.jobDir, diagnosticPath);
    await mkdir(dirname(destinationPath), { recursive: true });
    const scannerOutput = await readFile(sourcePath, "utf8");
    const redactedOutput = redactEvidenceText(scannerOutput, [
      "clawscanScannerOutput",
      reference.scanner,
    ]);
    await writeFile(
      destinationPath,
      redactedOutput.endsWith("\n") ? redactedOutput : `${redactedOutput}\n`,
    );
    copied.push({
      diagnosticPath,
      outputPath: normalizedOutputPath,
      scanner: reference.scanner,
      status: "copied",
    });
  }
  return copied;
}

function pickIdentity(record: unknown, fields: string[]) {
  if (!record || typeof record !== "object") return undefined;
  const source = record as Record<string, unknown>;
  const picked: Record<string, unknown> = {};
  for (const field of fields) {
    if (source[field] !== undefined) picked[field] = source[field];
  }
  return Object.keys(picked).length > 0 ? picked : undefined;
}

function sanitizedTargetForDiagnostic(target: ClaimedJob["target"]) {
  return {
    skill: pickIdentity(target.skill, ["_id", "slug", "displayName", "name"]),
    version: pickIdentity(target.version, ["_id", "version", "sha256hash"]),
    package: pickIdentity(target.package, ["_id", "name", "normalizedName"]),
    release: pickIdentity(target.release, ["_id", "version", "integritySha256"]),
    files: target.files?.map(({ url: _url, ...file }) => ({
      ...file,
      path: safeWorkerArtifactPathLabel(file.path),
    })),
    clawpackUrl: Boolean(target.clawpackUrl),
    trustedOpenClawPlugin: target.trustedOpenClawPlugin,
  };
}

function sanitizedJobForArtifactContext(job: ClaimedJob["job"]) {
  const { leaseToken: _leaseToken, ...safeJob } = job;
  return safeJob;
}

function sanitizedTargetForArtifactContext(target: ClaimedJob["target"]) {
  const { clawpackUrl, files, job: _job, ...safeTarget } = target;
  return {
    ...safeTarget,
    files: files?.map(({ url: _url, ...file }) => file),
    clawpackUrl: Boolean(clawpackUrl),
  };
}

async function writeDiagnosticText(
  jobDir: string,
  fileName: string,
  value: string | undefined,
  rootKey: string,
  options?: {
    maxChars?: number;
    preRedacted?: boolean;
    structured?: boolean;
  },
) {
  if (value === undefined) return undefined;
  const redacted =
    options?.preRedacted === true
      ? value
      : options?.structured === false
        ? redactDiagnosticText(value, options.maxChars)
        : redactCompleteDiagnosticText(value, rootKey);
  await writeFile(join(jobDir, fileName), redacted.endsWith("\n") ? redacted : `${redacted}\n`);
  return fileName;
}

export async function writeJobDiagnostic(input: JobDiagnosticInput) {
  if (!input.diagnosticsRoot) return;
  const jobDir = join(input.diagnosticsRoot, safeDiagnosticPathSegment(input.job.job._id));
  await mkdir(jobDir, { recursive: true });

  const clawscanStdoutPath = await writeDiagnosticText(
    jobDir,
    "clawscan.stdout.redacted.log",
    input.clawscan?.stdout,
    "clawscanStdout",
  );
  const clawscanStderrPath = await writeDiagnosticText(
    jobDir,
    "clawscan.stderr.redacted.log",
    input.clawscan?.stderr,
    "clawscanStderr",
  );
  const clawscanArtifactPath = await writeDiagnosticText(
    jobDir,
    "clawscan-artifact.redacted.json",
    input.clawscan?.rawArtifact
      ? redactEvidenceText(input.clawscan.rawArtifact, ["clawscanArtifact"])
      : undefined,
    "clawscanArtifact",
    {
      maxChars: Number.POSITIVE_INFINITY,
      preRedacted: true,
      structured: false,
    },
  );
  const clawscanScannerOutputs =
    input.clawscan?.rawArtifact && input.clawscan?.artifactPath
      ? await copyClawScanScannerOutputs({
          artifactPath: input.clawscan.artifactPath,
          jobDir,
          rawArtifact: input.clawscan.rawArtifact,
        })
      : [];

  const diagnostic = {
    completedAt: input.completedAt,
    durationMs: input.completedAt - input.startedAt,
    error: input.error ? redactDiagnosticError(input.error) : undefined,
    job: {
      attempts: input.job.job.attempts,
      hasMaliciousSignal: input.job.job.hasMaliciousSignal,
      id: input.job.job._id,
      source: input.job.job.source,
      targetKind: input.job.job.targetKind,
      waitForVtUntil: input.job.job.waitForVtUntil,
    },
    llmAnalysis: redactDiagnosticValue(input.llmAnalysis, ["llmAnalysis"]),
    runId: input.runId,
    clawscan: input.clawscan
      ? {
          ...(asRecord(redactDiagnosticValue(input.clawscan, ["clawscan"])) ?? {}),
          mapping: input.clawscan.mapping
            ? redactDiagnosticValue(input.clawscan.mapping, ["clawscanMapping"])
            : undefined,
        }
      : undefined,
    skillSpectorAnalysis: redactDiagnosticValue(input.skillSpectorAnalysis, [
      "skillSpectorAnalysis",
    ]),
    startedAt: input.startedAt,
    status: input.status,
    target: sanitizedTargetForDiagnostic(input.job.target),
    clawscanResult: {
      args: input.clawscan?.args,
      exitCode: input.clawscan?.exitCode,
      mapping: input.clawscan?.mapping
        ? redactDiagnosticValue(input.clawscan.mapping, ["clawscanMapping"])
        : undefined,
      rawArtifactPath: clawscanArtifactPath,
      scannerOutputFiles: clawscanScannerOutputs,
      stderrPath: clawscanStderrPath,
      stdoutPath: clawscanStdoutPath,
    },
  };

  await writeFile(join(jobDir, "diagnostic.json"), `${JSON.stringify(diagnostic, null, 2)}\n`);
}

function safeOutputPath(workspace: string, artifactPath: string) {
  const normalized = artifactPath.replace(/^\/+/, "");
  const out = resolve(workspace, "artifact", normalized);
  const artifactRoot = resolve(workspace, "artifact");
  if (!out.startsWith(`${artifactRoot}/`) && out !== artifactRoot) {
    throw new Error(`Unsafe artifact path: ${safeWorkerArtifactPathLabel(artifactPath)}`);
  }
  return out;
}

function artifactDownloadDescription(kind: "file" | "clawpack", artifactPath: string) {
  const safePath = safeWorkerArtifactPathLabel(artifactPath);
  return kind === "file" ? `artifact file ${safePath}` : `artifact tarball ${safePath}`;
}

async function download(url: string, artifact: { kind: "file" | "clawpack"; path: string }) {
  maskGitHubActionsSecret(url);
  const description = artifactDownloadDescription(artifact.kind, artifact.path);
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new Error(`Download failed for ${description}: network error`, {
      cause: new Error("network error"),
    });
  }
  if (!response.ok) throw new Error(`Download failed ${response.status} for ${description}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function writeArtifactWorkspace(job: ClaimedJob, workspace: string) {
  await mkdir(join(workspace, "artifact"), { recursive: true });
  const metadata = {
    job: sanitizedJobForArtifactContext(job.job),
    target: sanitizedTargetForArtifactContext(job.target),
    policy: {
      virusTotal: "telemetry-only; never final classifier; do not hide solely from VT",
      maliciousSignalHold:
        "if non-VT malicious signals held the artifact, Codex decides whether to release or hide",
      openclawPluginTrust:
        "plugins under @openclaw owned by the OpenClaw publisher are trusted unless artifact evidence proves malicious behavior",
    },
  };
  await writeFile(join(workspace, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`);

  const files = (job.target.files ?? []).map((file) => ({
    file,
    out: safeOutputPath(workspace, file.path),
  }));
  for (const candidate of files) {
    const isDirectoryMarker =
      candidate.file.size === 0 &&
      files.some(
        (other) => other.out !== candidate.out && other.out.startsWith(`${candidate.out}${sep}`),
      );
    if (isDirectoryMarker) continue;

    const { file, out } = candidate;
    await mkdir(dirname(out), { recursive: true });
    const bytes = await download(file.url, { kind: "file", path: file.path });
    const actualSha256 = createHash("sha256").update(bytes).digest("hex");
    if (actualSha256 !== file.sha256.toLowerCase()) {
      throw new Error(
        `Downloaded artifact hash mismatch for artifact file ${safeWorkerArtifactPathLabel(file.path)}`,
      );
    }
    await writeFile(out, bytes);
  }

  if (job.target.clawpackUrl) {
    const tarballPath = join(workspace, "artifact.tgz");
    await writeFile(
      tarballPath,
      await download(job.target.clawpackUrl, { kind: "clawpack", path: "artifact.tgz" }),
    );
    const listing = await runCommand("tar", ["-tzf", tarballPath], {
      cwd: workspace,
      timeoutMs: 60_000,
    });
    for (const entry of listing.stdout.split("\n").filter(Boolean)) {
      if (entry.startsWith("/") || entry.split("/").includes("..")) {
        throw new Error(`Unsafe tarball entry: ${entry}`);
      }
    }
    const verboseListing = await runCommand("tar", ["-tvzf", tarballPath], {
      cwd: workspace,
      timeoutMs: 60_000,
    });
    if (verboseListing.stdout.split("\n").some((line) => /^[lh]/.test(line))) {
      throw new Error("Refusing to extract tarball containing links");
    }
    await runCommand("tar", ["-xzf", tarballPath, "-C", join(workspace, "artifact")], {
      cwd: workspace,
      timeoutMs: 60_000,
    });
  }
}

async function fileExists(path: string) {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

function codexEnv() {
  const env = { ...process.env };
  const codexHome = resolveCodexWorkerHome(process.env, LOCAL_CODEX_HOME);
  if (codexHome) {
    mkdirSync(codexHome, { recursive: true });
    env.CODEX_HOME = codexHome;
  }
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  delete env.CONVEX_DEPLOY_KEY;
  delete env.SECURITY_SCAN_WORKER_TOKEN;
  delete env.HOMEBREW_GITHUB_API_TOKEN;
  env.NO_COLOR = "1";
  env.SKILLSPECTOR_PROVIDER = env.SKILLSPECTOR_PROVIDER || "openai";
  return env;
}

class CommandFailure extends Error {
  exitCode: number | null;
  stderr: string;
  stdout: string;
  timedOut: boolean;

  constructor(
    message: string,
    exitCode: number | null,
    stdout: string,
    stderr: string,
    timedOut: boolean,
  ) {
    super(message);
    this.name = "CommandFailure";
    this.exitCode = exitCode;
    this.stdout = stdout;
    this.stderr = stderr;
    this.timedOut = timedOut;
  }
}

async function runCommand(
  command: string,
  args: string[],
  options: { cwd: string; input?: string; omitEnv?: string[]; timeoutMs: number },
) {
  return await new Promise<{ stdout: string; stderr: string }>((resolvePromise, reject) => {
    const env = codexEnv();
    for (const name of options.omitEnv ?? []) delete env[name];
    const child = spawn(command, args, {
      cwd: options.cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 10_000).unref();
    }, options.timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolvePromise({ stdout, stderr });
      else {
        reject(
          new CommandFailure(
            `${command} ${timedOut ? "timed out" : `exited ${code}`}; see redacted stdout/stderr diagnostics`,
            code,
            stdout,
            stderr,
            timedOut,
          ),
        );
      }
    });
    if (options.input) child.stdin.end(options.input);
    else child.stdin.end();
  });
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readField(record: Record<string, unknown>, names: string[]) {
  for (const name of names) {
    if (record[name] !== undefined && record[name] !== null) return record[name];
  }
  return undefined;
}

function readString(record: Record<string, unknown>, names: string[]) {
  const value = readField(record, names);
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function readNumber(record: Record<string, unknown>, names: string[]) {
  const value = readField(record, names);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/%$/, "").trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function readNestedRecord(record: Record<string, unknown>, names: string[]) {
  const value = readField(record, names);
  return asRecord(value);
}

function readStringFromNested(
  record: Record<string, unknown>,
  nestedNames: string[],
  fieldNames: string[],
) {
  const nested = readNestedRecord(record, nestedNames);
  return nested ? readString(nested, fieldNames) : undefined;
}

function readNumberFromNested(
  record: Record<string, unknown>,
  nestedNames: string[],
  fieldNames: string[],
) {
  const nested = readNestedRecord(record, nestedNames);
  return nested ? readNumber(nested, fieldNames) : undefined;
}

function normalizeConfidence(value: number | undefined) {
  if (value === undefined) return undefined;
  if (value > 1) return Math.max(0, Math.min(1, value / 100));
  return Math.max(0, Math.min(1, value));
}

function normalizeSkillSpectorIssue(input: unknown, index: number): SkillSpectorIssue | null {
  const record = asRecord(input);
  if (!record) return null;
  const issueId =
    readString(record, ["rule_id", "ruleId", "issue_id", "issueId", "id", "pattern_id"]) ??
    `skillspector-${index + 1}`;
  const pattern = readString(record, [
    "pattern",
    "rule_name",
    "ruleName",
    "name",
    "title",
    "message",
  ]);
  const severity = (
    readString(record, ["severity", "risk_severity", "level"]) ?? "UNKNOWN"
  ).toUpperCase();
  const explanation =
    readString(record, ["explanation", "message", "description", "reason", "details"]) ??
    pattern ??
    issueId;
  const confidence = normalizeConfidence(readNumber(record, ["confidence", "score"]));
  const file =
    readString(record, ["file", "file_path", "filePath", "path"]) ??
    readStringFromNested(record, ["location"], ["file", "path"]);
  const startLine =
    readNumber(record, ["line", "line_number", "lineNumber", "start_line", "startLine"]) ??
    readNumberFromNested(record, ["location"], ["line", "start_line", "startLine"]);
  const endLine =
    readNumber(record, ["end_line", "endLine"]) ??
    readNumberFromNested(record, ["location"], ["end_line", "endLine"]);
  return {
    issueId,
    category: readString(record, ["category", "analyzer", "type"]),
    pattern,
    severity,
    confidence,
    file,
    startLine,
    endLine,
    explanation,
    remediation: readString(record, ["remediation", "recommendation", "fix", "mitigation"]),
    finding: readString(record, ["finding", "match", "evidence"]),
    codeSnippet: readString(record, ["code_snippet", "codeSnippet", "snippet"]),
  };
}

function truncateStoredSkillSpectorText(
  value: string | undefined,
  maxChars = MAX_STORED_SKILLSPECTOR_TEXT_CHARS,
) {
  if (value === undefined) return undefined;
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n...[truncated ${value.length - maxChars} chars]`;
}

function compactSkillSpectorIssue(issue: SkillSpectorIssue): SkillSpectorIssue {
  return {
    issueId:
      truncateStoredSkillSpectorText(issue.issueId, MAX_STORED_SKILLSPECTOR_SHORT_TEXT_CHARS) ??
      "skillspector-issue",
    category: truncateStoredSkillSpectorText(
      issue.category,
      MAX_STORED_SKILLSPECTOR_SHORT_TEXT_CHARS,
    ),
    pattern: truncateStoredSkillSpectorText(
      issue.pattern,
      MAX_STORED_SKILLSPECTOR_SHORT_TEXT_CHARS,
    ),
    severity:
      truncateStoredSkillSpectorText(issue.severity, MAX_STORED_SKILLSPECTOR_SHORT_TEXT_CHARS) ??
      "UNKNOWN",
    confidence: issue.confidence,
    file: truncateStoredSkillSpectorText(issue.file, MAX_STORED_SKILLSPECTOR_SHORT_TEXT_CHARS),
    startLine: issue.startLine,
    endLine: issue.endLine,
    explanation:
      truncateStoredSkillSpectorText(issue.explanation) ??
      "SkillSpector reported this issue without additional explanation.",
    remediation: truncateStoredSkillSpectorText(issue.remediation),
    finding: truncateStoredSkillSpectorText(issue.finding),
    codeSnippet: truncateStoredSkillSpectorText(issue.codeSnippet),
  };
}

function normalizeSkillSpectorStatus(params: {
  rawStatus?: string;
  recommendation?: string;
  score?: number;
  issueCount: number;
}) {
  const rawStatus = params.rawStatus?.trim().toLowerCase();
  if (rawStatus) {
    if (rawStatus === "benign" || rawStatus === "safe") return "clean";
    if (["clean", "suspicious", "malicious", "error", "failed"].includes(rawStatus)) {
      return rawStatus;
    }
  }
  const recommendation = params.recommendation?.trim().toLowerCase() ?? "";
  if (recommendation.includes("safe")) return "clean";
  if (params.issueCount > 0) return "suspicious";
  if (typeof params.score === "number" && params.score > 20) return "suspicious";
  return "clean";
}

export function normalizeSkillSpectorAnalysis(
  raw: string,
  checkedAt = Date.now(),
): SkillSpectorAnalysis {
  const parsed = JSON.parse(raw) as unknown;
  const record = asRecord(parsed);
  if (!record) {
    return {
      status: "error",
      issueCount: 0,
      issues: [],
      error: "SkillSpector returned a non-object JSON report.",
      checkedAt,
    };
  }
  const rawIssues = readField(record, [
    "filtered_findings",
    "filteredFindings",
    "findings",
    "issues",
    "vulnerabilities",
  ]);
  const rawIssueList = Array.isArray(rawIssues) ? rawIssues : [];
  const issues = rawIssueList
    .slice(0, MAX_STORED_SKILLSPECTOR_ISSUES)
    .map((issue, index) => normalizeSkillSpectorIssue(issue, index))
    .filter((issue): issue is SkillSpectorIssue => Boolean(issue))
    .map(compactSkillSpectorIssue);
  const score =
    readNumber(record, ["risk_score", "riskScore", "score"]) ??
    readNumberFromNested(record, ["risk_assessment", "riskAssessment"], ["score"]);
  const severity =
    readString(record, ["risk_severity", "riskSeverity", "severity"]) ??
    readStringFromNested(record, ["risk_assessment", "riskAssessment"], ["severity"]);
  const recommendation =
    readString(record, ["risk_recommendation", "riskRecommendation", "recommendation"]) ??
    readStringFromNested(
      record,
      ["risk_assessment", "riskAssessment"],
      ["recommendation", "risk_recommendation", "riskRecommendation"],
    );
  const issueCount =
    readNumber(record, ["issue_count", "issueCount", "finding_count", "findingCount"]) ??
    rawIssueList.length;
  return {
    status: normalizeSkillSpectorStatus({
      rawStatus: readString(record, ["status"]),
      recommendation,
      score,
      issueCount,
    }),
    score,
    severity,
    recommendation,
    issueCount,
    issues,
    scannerVersion: truncateStoredSkillSpectorText(
      readString(record, ["scanner_version", "scannerVersion", "version"]) ??
        readStringFromNested(
          record,
          ["metadata"],
          ["skillspector_version", "skillspectorVersion", "version"],
        ),
      MAX_STORED_SKILLSPECTOR_SHORT_TEXT_CHARS,
    ),
    summary: truncateStoredSkillSpectorText(readString(record, ["summary", "analysis"])),
    checkedAt,
  };
}

function verdictToStatus(verdict: string) {
  return verdict === "benign" ? "clean" : verdict;
}

function toStoredLlmAnalysis(
  parsed: NonNullable<ReturnType<typeof parseLlmEvalResponse>>,
  checkedAt = Date.now(),
) {
  return {
    status: verdictToStatus(parsed.verdict),
    verdict: parsed.verdict,
    confidence: parsed.confidence,
    summary: parsed.summary,
    dimensions: parsed.dimensions,
    guidance: parsed.guidance,
    findings: parsed.findings || undefined,
    checkedAt,
  };
}

function clawScanTimeoutMs() {
  const parsed = Number(process.env.CODEX_SECURITY_SCAN_CLAWSCAN_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CLAWSCAN_TIMEOUT_MS;
}

const REQUIRED_CLAWHUB_RESULT_KEYS = [
  ...CLAWHUB_OUTPUT_SCHEMA_CONTRACT.requiredResultKeys,
  "artifact_inspection",
];
const REQUIRED_CLAWHUB_DIMENSION_KEYS = CLAWHUB_OUTPUT_SCHEMA_CONTRACT.requiredDimensionKeys;
const REQUIRED_CLAWHUB_DIMENSION_FIELD_KEYS =
  CLAWHUB_OUTPUT_SCHEMA_CONTRACT.requiredDimensionFieldKeys;
const REQUIRED_CLAWHUB_FINDING_KEYS = CLAWHUB_OUTPUT_SCHEMA_CONTRACT.requiredFindingKeys;
const REQUIRED_CLAWHUB_ARTIFACT_INSPECTION_KEYS = [
  "status",
  "challenge",
  "required_file_sha256",
  "files_inspected",
];
const ALLOWED_CLAWHUB_DIMENSION_STATUSES = CLAWHUB_OUTPUT_SCHEMA_CONTRACT.allowedDimensionStatus;

function assertExactObjectKeys(
  record: Record<string, unknown>,
  expectedKeys: readonly string[],
  context: string,
) {
  const unexpected = Object.keys(record).filter((key) => !expectedKeys.includes(key));
  if (unexpected.length > 0) {
    throw new Error(`${context} included unexpected field(s): ${unexpected.join(", ")}`);
  }
  const missing = expectedKeys.filter((key) => record[key] === undefined);
  if (missing.length > 0) {
    throw new Error(`${context} missing required field(s): ${missing.join(", ")}`);
  }
}

function validateClawScanJudgeResultShape(result: Record<string, unknown>) {
  assertExactObjectKeys(result, REQUIRED_CLAWHUB_RESULT_KEYS, "ClawScan judge result");

  const verdict = readString(result, ["verdict"]);
  if (!verdict || !CLAWHUB_OUTPUT_SCHEMA_CONTRACT.allowedVerdict.has(verdict)) {
    throw new Error(`ClawScan judge result verdict was ${verdict ?? "missing"}`);
  }
  const confidence = readString(result, ["confidence"]);
  if (!confidence || !CLAWHUB_OUTPUT_SCHEMA_CONTRACT.allowedConfidence.has(confidence)) {
    throw new Error(`ClawScan judge result confidence was ${confidence ?? "missing"}`);
  }
  if (typeof result.summary !== "string") {
    throw new Error("ClawScan judge result summary was missing");
  }
  if (typeof result.user_guidance !== "string") {
    throw new Error("ClawScan judge result user_guidance was missing");
  }

  const artifactInspection = asRecord(result.artifact_inspection);
  if (!artifactInspection) {
    throw new Error("ClawScan judge result artifact_inspection was missing");
  }
  assertExactObjectKeys(
    artifactInspection,
    REQUIRED_CLAWHUB_ARTIFACT_INSPECTION_KEYS,
    "ClawScan artifact inspection",
  );
  const inspectionStatus = readString(artifactInspection, ["status"]);
  if (inspectionStatus !== "completed") {
    throw new Error(`ClawScan artifact inspection status was ${inspectionStatus ?? "missing"}`);
  }
  const inspectionChallenge = readString(artifactInspection, ["challenge"]);
  if (!inspectionChallenge) {
    throw new Error("ClawScan artifact inspection challenge was missing");
  }
  const requiredFileSha256 = readString(artifactInspection, ["required_file_sha256"]);
  if (!requiredFileSha256 || !/^[a-f0-9]{64}$/.test(requiredFileSha256)) {
    throw new Error("ClawScan artifact inspection required_file_sha256 was invalid");
  }
  const inspectedFiles = artifactInspection.files_inspected;
  if (
    !Array.isArray(inspectedFiles) ||
    inspectedFiles.length === 0 ||
    inspectedFiles.some((file) => typeof file !== "string" || !file.startsWith("artifact/"))
  ) {
    throw new Error("ClawScan artifact inspection files_inspected was invalid");
  }

  const dimensions = asRecord(result.dimensions);
  if (!dimensions) {
    throw new Error("ClawScan judge result dimensions was missing");
  }
  assertExactObjectKeys(dimensions, REQUIRED_CLAWHUB_DIMENSION_KEYS, "ClawScan judge dimensions");
  for (const dimensionKey of REQUIRED_CLAWHUB_DIMENSION_KEYS) {
    const dimension = asRecord(dimensions[dimensionKey]);
    if (!dimension) {
      throw new Error(`ClawScan judge dimension ${dimensionKey} was missing`);
    }
    assertExactObjectKeys(
      dimension,
      REQUIRED_CLAWHUB_DIMENSION_FIELD_KEYS,
      `ClawScan judge dimension ${dimensionKey}`,
    );
    const status = readString(dimension, ["status"]);
    if (!status || !ALLOWED_CLAWHUB_DIMENSION_STATUSES.has(status)) {
      throw new Error(`ClawScan judge dimension ${dimensionKey} status was ${status ?? "missing"}`);
    }
    if (typeof dimension.detail !== "string") {
      throw new Error(`ClawScan judge dimension ${dimensionKey} detail was missing`);
    }
  }

  if (!Array.isArray(result.scan_findings_in_context)) {
    throw new Error("ClawScan judge result scan_findings_in_context was missing");
  }
  for (const [index, findingValue] of result.scan_findings_in_context.entries()) {
    const finding = asRecord(findingValue);
    if (!finding) {
      throw new Error(`ClawScan finding ${index + 1} was not an object`);
    }
    assertExactObjectKeys(finding, REQUIRED_CLAWHUB_FINDING_KEYS, `ClawScan finding ${index + 1}`);
    if (typeof finding.ruleId !== "string") {
      throw new Error(`ClawScan finding ${index + 1} ruleId was missing`);
    }
    if (typeof finding.expected_for_purpose !== "boolean") {
      throw new Error(`ClawScan finding ${index + 1} expected_for_purpose was missing`);
    }
    if (typeof finding.note !== "string") {
      throw new Error(`ClawScan finding ${index + 1} note was missing`);
    }
  }
}

function artifactCompletedAtMs(artifact: Record<string, unknown>) {
  const completedAt = readString(artifact, ["completedAt"]);
  const parsed = completedAt ? Date.parse(completedAt) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    throw new Error(`ClawScan artifact completedAt was ${completedAt ?? "missing"}`);
  }
  return parsed;
}

function readClawScanScannerStatuses(
  artifact: Record<string, unknown>,
  scannerSet = REQUIRED_CLAWHUB_SCANNERS,
) {
  const scanners = asRecord(artifact.scanners);
  const scannerStatuses: Record<string, string> = {};
  for (const scanner of scannerSet) {
    const scannerRecord = asRecord(scanners?.[scanner]);
    scannerStatuses[scanner] = readString(scannerRecord ?? {}, ["status"]) ?? "missing";
  }
  return scannerStatuses;
}

function clawScanDiagnosticMapping(artifact: Record<string, unknown>) {
  const judge = asRecord(artifact.judge);
  const result = asRecord(judge?.result);
  const scannerStatuses = readClawScanScannerStatuses(artifact);
  return {
    judge: {
      outputSchemaSha256: readString(judge ?? {}, ["outputSchemaSha256", "outputSchemaSHA"]),
      promptSha256: readString(judge ?? {}, ["promptSha256", "promptSHA"]),
      status: readString(judge ?? {}, ["status"]),
      verdict: readString(result ?? {}, ["verdict"]),
    },
    scanners: {
      skillspectorStatus: scannerStatuses.skillspector,
      staticStatus: scannerStatuses["clawscan-static"],
    },
  };
}

function validateClawScanArtifactForClawHubProfile(artifact: Record<string, unknown>) {
  const schemaVersion = readString(artifact, ["schemaVersion"]);
  if (schemaVersion !== "clawscan-run-v1") {
    throw new Error(`ClawScan artifact schemaVersion was ${schemaVersion ?? "missing"}`);
  }
  const profile = readString(artifact, ["profile"]);
  if (profile !== "clawhub") {
    throw new Error(`ClawScan artifact profile was ${profile ?? "missing"}`);
  }

  const scannerStatuses = readClawScanScannerStatuses(artifact);
  const allowedScannerStatuses: Record<string, Set<string>> = {
    "clawscan-static": new Set(["completed"]),
    skillspector: new Set(["completed"]),
  };
  for (const [scanner, status] of Object.entries(scannerStatuses)) {
    const allowed = allowedScannerStatuses[scanner] ?? new Set(["completed"]);
    if (!allowed.has(status)) {
      throw new Error(`ClawScan scanner ${scanner} status was ${status}`);
    }
  }

  const judge = asRecord(artifact.judge);
  if (!judge) throw new Error("ClawScan artifact judge result was missing");
  const judgeStatus = readString(judge, ["status"]);
  if (judgeStatus !== "completed") {
    throw new Error(`ClawScan judge status was ${judgeStatus ?? "missing"}`);
  }
  const result = asRecord(judge.result);
  if (!result) {
    throw new Error("ClawScan judge did not include a JSON object result");
  }
  validateClawScanJudgeResultShape(result);
  const parsed = parseLlmEvalResponse(JSON.stringify(result));
  if (!parsed) {
    throw new Error("ClawScan judge result did not match the ClawHub output schema");
  }

  const scanners = asRecord(artifact.scanners);
  const skillSpector = asRecord(scanners?.skillspector);
  if (!skillSpector || skillSpector.raw === undefined) {
    throw new Error("ClawScan skillspector scanner output was missing");
  }
  const rawSkillSpector =
    typeof skillSpector.raw === "string" ? skillSpector.raw : JSON.stringify(skillSpector.raw);

  const checkedAt = artifactCompletedAtMs(artifact);

  return {
    llmAnalysis: toStoredLlmAnalysis(parsed, checkedAt),
    mapping: clawScanDiagnosticMapping(artifact),
    skillSpectorAnalysis: normalizeSkillSpectorAnalysis(rawSkillSpector, checkedAt),
  };
}

export async function runClawScan(
  job: ClaimedJob,
  workspace: string,
  onDiagnostic: (diagnostic: Partial<ClawScanCommandDiagnostic>) => void,
) {
  const command = process.env.CODEX_SECURITY_SCAN_CLAWSCAN_COMMAND ?? "clawscan";
  const artifactPath = join(workspace, "clawscan-artifact.json");
  const target = await resolveClawScanTarget(workspace, job);
  const args = [target, "--profile", "clawhub", "--output", artifactPath];
  onDiagnostic({ args: [command, ...args], artifactPath });

  const captureArtifact = async () => {
    if (!(await fileExists(artifactPath))) return undefined;
    const rawArtifact = await readFile(artifactPath, "utf8");
    onDiagnostic({ rawArtifact });
    let parsedArtifact: unknown;
    try {
      parsedArtifact = JSON.parse(rawArtifact);
    } catch {
      return undefined;
    }
    const artifact = asRecord(parsedArtifact);
    if (artifact) onDiagnostic({ mapping: clawScanDiagnosticMapping(artifact) });
    return artifact;
  };

  try {
    const output = await runCommand(command, args, {
      cwd: workspace,
      omitEnv: ["VIRUSTOTAL_API_KEY"],
      timeoutMs: clawScanTimeoutMs(),
    });
    onDiagnostic({
      exitCode: 0,
      stderr: output.stderr,
      stdout: output.stdout,
    });
  } catch (error) {
    if (error instanceof CommandFailure) {
      onDiagnostic({
        exitCode: error.exitCode,
        stderr: error.stderr,
        stdout: error.stdout,
        timedOut: error.timedOut,
      });
    }
    await captureArtifact();
    throw error;
  }

  const artifact = await captureArtifact();
  if (!artifact) throw new Error("ClawScan did not emit a valid JSON artifact");

  const mapped = validateClawScanArtifactForClawHubProfile(artifact);
  onDiagnostic({ mapping: mapped.mapping });
  return mapped;
}

async function resolveClawScanTarget(workspace: string, job: ClaimedJob) {
  if (job.job.targetKind === "packageRelease") {
    const packageRoot = join(workspace, "artifact", "package");
    if (await fileExists(join(packageRoot, "package.json"))) return "./artifact/package";
  }
  return "./artifact";
}

export function scanHealthClassification(input: {
  clawscan: ClawScanCommandDiagnostic;
  errorMessage?: string;
  status: "completed" | "failed";
}) {
  const timedOut = Boolean(input.clawscan.timedOut);
  const scannerStatuses = Object.values(input.clawscan.mapping?.scanners ?? {}).filter(
    (status): status is string => Boolean(status),
  );
  let scannerStageFailed = scannerStatuses.some(
    (status) => status !== "completed" && status !== "missing",
  );
  const judgeStatus = input.clawscan.mapping?.judge?.status;
  let judgeStageFailed = Boolean(judgeStatus && judgeStatus !== "completed");
  scannerStageFailed ||= /ClawScan scanner/i.test(input.errorMessage ?? "");
  judgeStageFailed ||= /ClawScan (artifact )?judge|output schema/i.test(input.errorMessage ?? "");

  const failureStage =
    input.status === "failed"
      ? scannerStageFailed
        ? "scanner"
        : judgeStageFailed
          ? "judge"
          : "unclassified"
      : undefined;
  return {
    failureStage,
    judgeStageFailed,
    scannerStageFailed,
    timedOut,
  } as const;
}

export async function processJob(
  client: CodexScanWorkerClient,
  token: string,
  job: ClaimedJob,
  diagnosticsRoot: string | undefined,
  onHealth?: (health: SecurityScanJobHealth) => void,
): Promise<ProcessJobResult> {
  const workspace = await mkdtemp(join(tmpdir(), `clawhub-codex-scan-${basename(job.job._id)}-`));
  const startedAt = Date.now();
  const clawscan: ClawScanCommandDiagnostic = {};
  let errorMessage: string | undefined;
  let scanCompletedAt: number | undefined;
  let llmAnalysis: StoredLlmAnalysis | undefined;
  let skillSpectorAnalysis: SkillSpectorAnalysis | undefined;
  let status: JobDiagnosticInput["status"] = "failed";
  try {
    await writeArtifactWorkspace(job, workspace);
    const mapped = await runClawScan(job, workspace, (next) => {
      Object.assign(clawscan, next);
    });
    llmAnalysis = mapped.llmAnalysis;
    skillSpectorAnalysis = mapped.skillSpectorAnalysis;
    if (!llmAnalysis) throw new Error("Security scan did not produce llmAnalysis");
    await client.action(api.securityScan.completeCodexScanJob, {
      token,
      jobId: job.job._id as Id<"securityScanJobs">,
      leaseToken: job.job.leaseToken,
      llmAnalysis,
      skillSpectorAnalysis,
      runId: process.env.GITHUB_RUN_ID,
    });
    scanCompletedAt = Date.now();
    status = "completed";
    logger.info(
      {
        durationMs: Date.now() - startedAt,
        event: "security_scan_job_completed",
        implementation: "clawscan",
        jobId: job.job._id,
        scannerPhase: "complete",
        status: llmAnalysis.status,
        targetKind: job.job.targetKind,
      },
      "security scan job completed",
    );
    const health = scanHealthClassification({
      clawscan,
      status: "completed",
    });
    onHealth?.({
      verdict: llmAnalysis.verdict,
      completed: true,
      durationMs: (scanCompletedAt ?? Date.now()) - startedAt,
      ...health,
    });
    return { completed: true, hardFailed: false, retryableFailed: false };
  } catch (error) {
    errorMessage = sanitizeWorkerErrorMessage(
      error instanceof Error ? error.message : String(error),
    );
    const failResult = (await client.action(api.securityScan.failCodexScanJob, {
      token,
      jobId: job.job._id as Id<"securityScanJobs">,
      leaseToken: job.job.leaseToken,
      error: errorMessage,
    })) as { retry?: boolean } | undefined;
    logger.error(
      {
        durationMs: Date.now() - startedAt,
        event: "security_scan_job_failed",
        jobId: job.job._id,
        publicReason: errorMessage,
        retry: Boolean(failResult?.retry),
        scannerPhase: "process",
        targetKind: job.job.targetKind,
      },
      "security scan job failed",
    );
    const completedAt = Date.now();
    const health = scanHealthClassification({
      clawscan,
      errorMessage,
      status: "failed",
    });
    onHealth?.({
      completed: false,
      durationMs: completedAt - startedAt,
      ...health,
    });
    return {
      completed: false,
      hardFailed: !failResult?.retry,
      retryableFailed: Boolean(failResult?.retry),
    };
  } finally {
    try {
      await writeJobDiagnostic({
        completedAt: Date.now(),
        clawscan,
        diagnosticsRoot,
        error: errorMessage,
        job,
        llmAnalysis,
        runId: process.env.GITHUB_RUN_ID,
        skillSpectorAnalysis,
        startedAt,
        status,
      });
    } catch (diagnosticError) {
      const message =
        diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError);
      logger.error(
        {
          event: "security_scan_diagnostic_write_failed",
          jobId: job.job._id,
          publicReason: sanitizeWorkerErrorMessage(message),
        },
        "security scan diagnostic write failed",
      );
    }
    await rm(workspace, { recursive: true, force: true });
  }
}

export async function runContinuouslyRefilledWorkerPool<TJob>(options: {
  concurrency: number;
  maxJobs: number | undefined;
  canClaim: (totalClaimed: number) => boolean;
  claimJobs: (limit: number) => Promise<{ claimedCount: number; jobs: TJob[] }>;
  processClaimedJob: (job: TJob) => Promise<ProcessJobResult>;
  idlePollMs?: number;
  sleep?: (ms: number) => Promise<unknown>;
}) {
  const active = new Set<Promise<ProcessJobResult>>();
  const sleepImpl = options.sleep ?? sleep;
  let queueDrained = false;
  let totalClaimed = 0;
  let totalCompleted = 0;
  let totalFailed = 0;
  let totalRetryableFailed = 0;
  let totalClaimFailures = 0;

  while (active.size > 0 || (!queueDrained && options.canClaim(totalClaimed))) {
    while (active.size < options.concurrency && !queueDrained && options.canClaim(totalClaimed)) {
      const remainingJobs =
        options.maxJobs === undefined
          ? options.concurrency - active.size
          : Math.min(
              options.concurrency - active.size,
              Math.max(0, options.maxJobs - totalClaimed),
            );
      if (remainingJobs === 0) {
        queueDrained = true;
        break;
      }

      let claimedCount: number;
      let jobs: TJob[];
      try {
        ({ claimedCount, jobs } = await options.claimJobs(remainingJobs));
      } catch (error) {
        totalClaimFailures += 1;
        totalFailed += 1;
        queueDrained = true;
        const message = error instanceof Error ? error.message : String(error);
        logger.error(
          {
            event: "security_scan_claim_failed",
            publicReason: sanitizeWorkerErrorMessage(message),
            requested: remainingJobs,
            scannerPhase: "claim",
          },
          "failed to claim security scan jobs",
        );
        break;
      }

      totalClaimed += claimedCount;
      if (claimedCount < remainingJobs) {
        queueDrained = true;
      }
      for (const job of jobs) {
        const task = options.processClaimedJob(job).catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          logger.error(
            {
              event: "security_scan_unhandled_process_failure",
              publicReason: sanitizeWorkerErrorMessage(message),
              scannerPhase: "process",
            },
            "security scan job escaped worker error handling",
          );
          return {
            completed: false,
            hardFailed: true,
            retryableFailed: false,
          };
        });
        active.add(task);
      }
      if (jobs.length === 0 && queueDrained) break;
    }

    if (active.size > 0) {
      const settled = await Promise.race(
        [...active].map(async (task) => ({ result: await task, task })),
      );
      active.delete(settled.task);
      if (settled.result.completed) totalCompleted += 1;
      if (settled.result.hardFailed) totalFailed += 1;
      if (settled.result.retryableFailed) totalRetryableFailed += 1;
      if (active.size > 0 || !queueDrained) continue;
    }

    const maxJobsReached = options.maxJobs !== undefined && totalClaimed >= options.maxJobs;
    if (queueDrained && !maxJobsReached && options.idlePollMs && options.canClaim(totalClaimed)) {
      await sleepImpl(options.idlePollMs);
      queueDrained = false;
      continue;
    }
    break;
  }

  return {
    totalClaimed,
    totalClaimFailures,
    totalCompleted,
    totalFailed,
    totalRetryableFailed,
  };
}

export async function publishWorkerHealthSummary(
  diagnosticsRoot: string,
  summary: ReturnType<typeof calculateSecurityScanWorkerHealthSummary>,
) {
  await mkdir(diagnosticsRoot, { recursive: true });
  await writeFile(
    join(diagnosticsRoot, "worker-summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  const stepSummaryPath = process.env.GITHUB_STEP_SUMMARY?.trim();
  if (stepSummaryPath) {
    await appendFile(stepSummaryPath, renderSecurityScanWorkerSummaryMarkdown(summary));
  }
}

async function main() {
  const { batchLimit, maxJobs, maxRuntimeMs, leaseMs, lane, diagnosticsRoot } = parseArgs();
  assertCodexWorkerExecutionAllowed(process.env);
  maskKnownWorkerSecrets();
  const convexUrl = process.env.CONVEX_URL ?? process.env.VITE_CONVEX_URL;
  if (!convexUrl) throw new Error("CONVEX_URL or VITE_CONVEX_URL is required");
  const token = requireEnv("SECURITY_SCAN_WORKER_TOKEN");
  const client = new ConvexHttpClient(convexUrl);
  const workerId =
    process.env.CODEX_SECURITY_SCAN_WORKER_ID ??
    `github-actions:${process.env.GITHUB_RUN_ID ?? process.pid}:${
      process.env.GITHUB_RUN_ATTEMPT ?? "1"
    }:${process.env.CODEX_SECURITY_SCAN_SHARD ?? process.env.GITHUB_JOB ?? "0"}`;
  const startedAt = Date.now();
  const claimDeadline = startedAt + maxRuntimeMs;
  const outcomes: SecurityScanJobHealth[] = [];

  logger.info(
    { diagnosticsRoot, event: "security_scan_diagnostics_directory", lane, workerId },
    "security scan diagnostics directory",
  );

  const sharedShardIndex = Number(
    process.env.CODEX_SECURITY_SCAN_SHARD?.match(/shared-(\d+)/)?.[1] ?? 0,
  );
  if (lane === "shared" && sharedShardIndex > 0) {
    await sleep(sharedShardIndex * 250);
  }

  const stats = await runContinuouslyRefilledWorkerPool({
    concurrency: batchLimit,
    maxJobs,
    canClaim: () => Date.now() < claimDeadline,
    claimJobs: async (limit) => {
      const leases = (await client.action(api.securityScan.claimCodexScanJobLeases, {
        token,
        workerId,
        lane,
        limit,
        leaseMs,
      })) as ClaimedJobLease[];
      const hydrated = await Promise.all(
        leases.map(async (lease) => {
          try {
            return {
              job: (await client.action(api.securityScan.hydrateCodexScanJob, {
                token,
                workerId,
                jobId: lease._id as Id<"securityScanJobs">,
                leaseToken: lease.leaseToken,
              })) as ClaimedJob | null,
              requeued: false,
            };
          } catch (error) {
            const message = sanitizeWorkerErrorMessage(
              error instanceof Error ? error.message : String(error),
            );
            await client.action(api.securityScan.requeueCodexScanJobLease, {
              token,
              workerId,
              jobId: lease._id as Id<"securityScanJobs">,
              leaseToken: lease.leaseToken,
            });
            logger.error(
              {
                event: "security_scan_hydration_failed",
                jobId: lease._id,
                publicReason: message,
                scannerPhase: "hydrate",
              },
              "failed to hydrate security scan job",
            );
            return { job: null, requeued: true };
          }
        }),
      );
      const jobs = hydrated
        .map((outcome) => outcome.job)
        .filter((job): job is ClaimedJob => job !== null);
      const requeued = hydrated.filter((outcome) => outcome.requeued).length;
      logger.info(
        {
          claimed: leases.length,
          event: "security_scan_jobs_claimed",
          hydrated: jobs.length,
          lane,
          leaseMs,
          requeued,
          requested: limit,
          workerId,
        },
        "claimed security scan jobs",
      );
      return { claimedCount: leases.length, jobs };
    },
    processClaimedJob: async (job) => {
      const processStartedAt = Date.now();
      let reported = false;
      try {
        const result = await processJob(client, token, job, diagnosticsRoot, (health) => {
          reported = true;
          outcomes.push(health);
        });
        if (!reported) {
          outcomes.push({
            completed: result.completed,
            durationMs: Date.now() - processStartedAt,
            failureStage: result.completed ? undefined : "unclassified",
            judgeStageFailed: false,
            scannerStageFailed: false,
            timedOut: false,
          });
        }
        return result;
      } catch (error) {
        if (!reported) {
          outcomes.push({
            completed: false,
            durationMs: Date.now() - processStartedAt,
            failureStage: "unclassified",
            judgeStageFailed: false,
            scannerStageFailed: false,
            timedOut: false,
          });
        }
        throw error;
      }
    },
    idlePollMs: lane === "priority" ? 15_000 : undefined,
  });

  let queueHealth: SecurityScanQueueHealth | undefined;
  let queueHealthError: string | undefined;
  try {
    queueHealth = (await client.action(api.securityScan.getCodexScanQueueHealth, {
      token,
    })) as SecurityScanQueueHealth;
  } catch (error) {
    queueHealthError = sanitizeWorkerErrorMessage(
      error instanceof Error ? error.message : String(error),
    );
    logger.error(
      {
        event: "security_scan_queue_health_failed",
        publicReason: queueHealthError,
        workerId,
      },
      "failed to read security scan queue health",
    );
  }

  const remainingRuntimeMs = claimDeadline - Date.now();
  if (remainingRuntimeMs <= 0) {
    logger.info(
      {
        event: "security_scan_claim_window_closed",
        remainingRuntimeMs,
        workerId,
      },
      "stopping before claiming another security scan job",
    );
  }

  logger.info(
    {
      elapsedMs: Date.now() - startedAt,
      event: "security_scan_worker_summary",
      lane,
      ...stats,
      workerId,
    },
    "security scan worker summary",
  );
  const summary = calculateSecurityScanWorkerHealthSummary({
    durationMs: Date.now() - startedAt,
    outcomes,
    pool: stats,
    queueHealth,
    queueHealthError,
    workerId,
  });
  await publishWorkerHealthSummary(diagnosticsRoot, summary);
  if (stats.totalFailed > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
