import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { apiRequest, fetchBinary } from "../../http.js";
import {
  ApiRoutes,
  ApiV1SkillScanStatusResponseSchema,
  ApiV1SkillScanSubmitResponseSchema,
  type ApiV1SkillScanStatusResponse,
} from "../../schema/index.js";
import { requireAuthToken } from "../authToken.js";
import { getRegistry } from "../registry.js";
import type { GlobalOpts } from "../types.js";
import { createSpinner, fail, formatError } from "../ui.js";

const DEFAULT_POLL_INTERVAL_MS = 2_000;
const MAX_POLL_ATTEMPTS = 900;

type ScanOptions = {
  slug?: string;
  version?: string;
  update?: boolean;
  output?: string;
  json?: boolean;
};

type ScanDownloadOptions = {
  kind?: "skill" | "plugin";
  version?: string;
  output?: string;
};

type ReportRecord = Record<string, unknown>;

export async function cmdScan(opts: GlobalOpts, pathArg: string | undefined, options: ScanOptions) {
  validateScanOptions(pathArg, options);
  if (pathArg?.trim()) rejectLocalScan();

  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const spinner = createSpinner("Submitting scan");

  try {
    const submitted = await submitPublishedScan(registry, token, options);

    spinner.text = formatScanProgress("queued", submitted.scanId, submitted.queue);
    const status = await pollScan(registry, token, submitted.scanId, spinner);

    if (status.status === "failed") {
      spinner.fail(`Scan failed (${status.scanId})`);
      if (options.json) printJson(status);
      else printScanReport(status);
      throw new Error(status.lastError ?? "Scan failed");
    }

    spinner.succeed(`Scan complete (${status.scanId})`);

    if (options.json) printJson(status);
    else printScanReport(status);

    if (options.output) {
      const bytes = await fetchBinary(registry, {
        path: `${ApiRoutes.skillScans}/${encodeURIComponent(status.scanId)}/download`,
        token,
      });
      await mkdir(dirname(resolve(opts.workdir, options.output)), { recursive: true });
      await writeFile(resolve(opts.workdir, options.output), bytes);
      if (!options.json) console.log(`Report ZIP: ${resolve(opts.workdir, options.output)}`);
    }
  } catch (error) {
    spinner.fail(formatError(error));
    throw error;
  }
}

export async function cmdScanDownload(
  opts: GlobalOpts,
  nameArg: string,
  options: ScanDownloadOptions,
) {
  const name = nameArg.trim();
  if (!name) fail("Skill or plugin name required");
  const version = options.version?.trim();
  if (!version) fail("--version required");
  const kind = options.kind ?? "skill";
  if (kind !== "skill" && kind !== "plugin") fail('--kind must be "skill" or "plugin"');

  const token = await requireAuthToken();
  const registry = await getRegistry(opts, { cache: true });
  const output = resolve(
    opts.workdir,
    options.output ?? `clawhub-scan-${safeOutputName(name)}-${safeOutputName(version)}.zip`,
  );
  const query = new URLSearchParams({ version, kind });
  const bytes = await fetchBinary(registry, {
    path: `${ApiRoutes.skillScans}/download/${encodeURIComponent(name)}?${query.toString()}`,
    token,
  });
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, bytes);
  console.log(`Report ZIP: ${output}`);
}

function validateScanOptions(pathArg: string | undefined, options: ScanOptions) {
  const hasPath = Boolean(pathArg?.trim());
  const hasSlug = Boolean(options.slug?.trim());
  if (hasPath && hasSlug) fail("Choose either a local path or --slug, not both");
  if (!hasPath && !hasSlug) fail("Provide a local path or --slug");
  if (hasPath && options.update) fail("--update is only valid with --slug");
}

function rejectLocalScan(): never {
  fail(
    "Local folder scans are no longer supported. Upload a new version, then run `clawhub scan download <slug> --version <version>` to retrieve stored scan results.",
  );
}

async function submitPublishedScan(registry: string, token: string, options: ScanOptions) {
  const slug = options.slug?.trim();
  if (!slug) fail("--slug required");
  const version = options.version?.trim();
  return await apiRequest(
    registry,
    {
      method: "POST",
      path: ApiRoutes.skillScans,
      token,
      body: {
        source: {
          kind: "published",
          slug,
          ...(version ? { version } : {}),
        },
        update: options.update === true,
      },
    },
    ApiV1SkillScanSubmitResponseSchema,
  );
}

async function pollScan(
  registry: string,
  token: string,
  scanId: string,
  spinner: ReturnType<typeof createSpinner>,
) {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
    const status = await apiRequest(
      registry,
      {
        method: "GET",
        path: `${ApiRoutes.skillScans}/${encodeURIComponent(scanId)}`,
        token,
      },
      ApiV1SkillScanStatusResponseSchema,
    );
    spinner.text = formatScanProgress(status.status, scanId, status.queue);
    if (status.status === "succeeded" || status.status === "failed") return status;
    await sleep(DEFAULT_POLL_INTERVAL_MS);
  }
  throw new Error(`Timed out waiting for scan ${scanId}`);
}

function sleep(ms: number) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function formatScanProgress(
  status: ApiV1SkillScanStatusResponse["status"],
  scanId: string,
  queue: ApiV1SkillScanStatusResponse["queue"],
) {
  const queueProgress = formatQueueProgress(status, queue);
  return `Scan ${status} (${scanId})${queueProgress ? ` - ${queueProgress}` : ""}`;
}

function formatQueueProgress(
  status: ApiV1SkillScanStatusResponse["status"],
  queue: ApiV1SkillScanStatusResponse["queue"],
) {
  if (!queue) return undefined;
  if (status === "queued") {
    const aheadCount = `${queue.queuedAhead}${queue.queuedAheadIsEstimate ? "+" : ""}`;
    const ahead =
      queue.queuedAhead === 0
        ? "no scans ahead"
        : `${aheadCount} scan${queue.queuedAhead === 1 && !queue.queuedAheadIsEstimate ? "" : "s"} ahead`;
    const position = typeof queue.position === "number" ? `position ${queue.position}` : undefined;
    const running = `${queue.running}${queue.runningIsEstimate ? "+" : ""} running`;
    return [position, ahead, running, queue.note].filter(Boolean).join("; ");
  }
  if (status === "running") return `${queue.running}${queue.runningIsEstimate ? "+" : ""} running`;
  return undefined;
}

function printJson(status: ApiV1SkillScanStatusResponse) {
  console.log(JSON.stringify(status, null, 2));
}

function printScanReport(status: ApiV1SkillScanStatusResponse) {
  const artifact = asRecord(status.artifact) ?? {};
  const report = asRecord(status.report) ?? {};
  const clawscan = asRecord(report.clawscan) ?? {};
  const skillspector = asRecord(report.skillspector) ?? {};
  const staticAnalysis = asRecord(report.staticAnalysis) ?? {};
  const virustotal = asRecord(report.virustotal);

  console.log("");
  console.log("ClawHub Scan Report");
  console.log(`Scan ID: ${status.scanId}`);
  console.log(`Status: ${status.status.toUpperCase()}`);
  console.log(`Source: ${status.sourceKind}`);
  console.log(`Update requested: ${status.update ? "yes" : "no"}`);
  console.log(`Written back: ${status.writtenBack ? "yes" : "no"}`);
  printOptional("Slug", stringValue(artifact.slug));
  printOptional("Name", stringValue(artifact.displayName));
  printOptional("Version", stringValue(artifact.version));
  printOptional("Created", dateValue(status.createdAt));
  printOptional("Completed", dateValue(status.completedAt));

  console.log("");
  console.log("ClawScan");
  printOptional("Verdict", upperValue(clawscan.verdict ?? clawscan.status));
  printOptional("Confidence", stringValue(clawscan.confidence));
  printOptional("Summary", stringValue(clawscan.summary));
  printOptional("Guidance", stringValue(clawscan.guidance));
  printFindings(clawscan.findings);
  printAgenticRisks(clawscan.agenticRiskFindings);

  console.log("");
  console.log("SkillSpector");
  printOptional("Status", upperValue(skillspector.status));
  printOptional("Score", numberValue(skillspector.score));
  printOptional("Severity", stringValue(skillspector.severity));
  printOptional("Issue count", numberValue(skillspector.issueCount));
  printIssueList(skillspector.issues);

  console.log("");
  console.log("Static Analysis");
  printOptional("Status", upperValue(staticAnalysis.status));
  printOptional("Reason codes", arrayValue(staticAnalysis.reasonCodes));
  printOptional("Summary", stringValue(staticAnalysis.summary));
  printIssueList(staticAnalysis.findings);

  console.log("");
  console.log("VirusTotal");
  if (!virustotal) {
    console.log("Status: not available");
  } else {
    printOptional("Status", stringValue(virustotal.status));
    printOptional("Malicious", numberValue(virustotal.malicious));
    printOptional("Suspicious", numberValue(virustotal.suspicious));
    printOptional("Harmless", numberValue(virustotal.harmless));
    printOptional("Undetected", numberValue(virustotal.undetected));
  }
}

function printOptional(label: string, value: string | undefined) {
  if (!value) return;
  console.log(`${label}: ${value}`);
}

function printFindings(value: unknown) {
  if (typeof value === "string" && value.trim()) {
    console.log(`Findings: ${value.trim()}`);
  }
}

function printAgenticRisks(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) return;
  console.log("Agentic risk findings:");
  for (const item of value.slice(0, 20)) {
    const finding = asRecord(item);
    if (!finding) continue;
    const label = stringValue(finding.categoryLabel) ?? stringValue(finding.categoryId) ?? "risk";
    const status = stringValue(finding.status) ?? "unknown";
    const severity = stringValue(finding.severity) ?? "unknown";
    console.log(`- ${label}: ${status} (${severity})`);
    printIndented("Impact", stringValue(finding.userImpact));
    printIndented("Recommendation", stringValue(finding.recommendation));
  }
}

function printIssueList(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) return;
  for (const item of value.slice(0, 25)) {
    const issue = asRecord(item);
    if (!issue) continue;
    const code = stringValue(issue.code ?? issue.issueId ?? issue.pattern) ?? "issue";
    const severity = stringValue(issue.severity) ?? "unknown";
    const file = stringValue(issue.file);
    const message = stringValue(issue.message ?? issue.explanation ?? issue.finding);
    console.log(`- ${code}: ${severity}${file ? ` in ${file}` : ""}`);
    printIndented("Detail", message);
    printIndented("Remediation", stringValue(issue.remediation));
  }
}

function printIndented(label: string, value: string | undefined) {
  if (!value) return;
  console.log(`  ${label}: ${value}`);
}

function asRecord(value: unknown): ReportRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as ReportRecord)
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function upperValue(value: unknown) {
  return stringValue(value)?.toUpperCase();
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : undefined;
}

function arrayValue(value: unknown) {
  return Array.isArray(value) && value.length > 0
    ? value.map((item) => String(item)).join(", ")
    : undefined;
}

function dateValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? new Date(value).toISOString()
    : undefined;
}

function safeOutputName(value: string) {
  return value
    .replace(/^@/, "")
    .replaceAll("/", "-")
    .replaceAll(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
