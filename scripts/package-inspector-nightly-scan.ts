import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

type ClaimItem = {
  packageId: string;
  releaseId: string;
  ownerUserId?: string;
  ownerPublisherId?: string;
  packageName: string;
  version: string;
  artifactKind?: string;
  downloadUrl: string;
};

type ClaimResponse = {
  ok: true;
  leased: boolean;
  dryRun?: boolean;
  nextCursor?: string | null;
  items: ClaimItem[];
};

type NormalizedFinding = {
  id?: string;
  code: string;
  level: string;
  severity?: string;
  issueClass?: string;
  compatStatus?: string;
  deprecated?: boolean;
  message: string;
  evidence?: string[];
  fixture?: string;
  decision?: string;
  authorRemediation?: {
    summary: string;
    docsUrl?: string;
  };
};

type ImpactEntry = {
  packageName: string;
  version: string;
  ownerUserId?: string;
  ownerPublisherId?: string;
  findingCount: number;
  errorCount: number;
  warningCount: number;
  targetOpenClawVersion?: string;
  findings: NormalizedFinding[];
};

type UploadResult = {
  ok: true;
  inserted: number;
  shouldEmailOwner: boolean;
};

const siteUrl = (process.env.CLAWHUB_SITE_URL ?? "https://clawhub.ai").replace(/\/+$/, "");
const token = process.env.CLAWHUB_PLUGIN_INSPECTOR_WORKER_TOKEN;
const batchSize = process.env.PLUGIN_INSPECTOR_BATCH_SIZE ?? "25";
const dryRun = parseBoolean(process.env.PLUGIN_INSPECTOR_DRY_RUN);
const targetPackageNames = parsePackageNames(process.env.PLUGIN_INSPECTOR_PACKAGE_NAMES);
const dryRunMaxBatches = Math.max(
  1,
  Math.min(
    Number.parseInt(process.env.PLUGIN_INSPECTOR_DRY_RUN_MAX_BATCHES ?? "20", 10) || 20,
    100,
  ),
);
const artifactRoot =
  process.env.PLUGIN_INSPECTOR_ARTIFACT_DIR ?? "plugin-inspector-bulk-scan-reports";
const repoRoot = path.resolve(process.env.GITHUB_WORKSPACE ?? process.cwd());
const clawhubCliEntry = path.join(repoRoot, "packages", "clawhub", "src", "cli.ts");

export async function runPackageInspectorNightlyScan() {
  if (!token) throw new Error("CLAWHUB_PLUGIN_INSPECTOR_WORKER_TOKEN is required");

  const inspectorVersion = getInspectorVersion();
  await mkdir(artifactRoot, { recursive: true });

  let hadWorkerFailure = false;
  const impactEntries: ImpactEntry[] = [];
  let claimed = 0;
  let scanned = 0;
  let cursor: string | null = null;
  let batches = 0;
  let truncated = false;

  if (targetPackageNames.length > 0) {
    const items = await resolveTargetPackageItems(targetPackageNames);
    batches = 1;
    claimed = items.length;
    for (const item of items) {
      const result = await inspectPackageItem(item, inspectorVersion);
      if (result.failed) hadWorkerFailure = true;
      if (result.impactEntry) impactEntries.push(result.impactEntry);
      if (result.scanned) scanned += 1;
    }
  } else {
    do {
      const claim = await claimBatch(cursor);
      batches += 1;
      cursor = claim.nextCursor ?? null;
      claimed += claim.items.length;

      for (const item of claim.items) {
        const result = await inspectPackageItem(item, inspectorVersion);
        if (result.failed) hadWorkerFailure = true;
        if (result.impactEntry) impactEntries.push(result.impactEntry);
        if (result.scanned) scanned += 1;
      }

      if (!dryRun) break;
      if (cursor && batches >= dryRunMaxBatches) {
        truncated = true;
        break;
      }
    } while (dryRun && cursor);
  }

  if (dryRun) {
    const summary = summarizeImpact({
      claimed,
      scanned,
      batches,
      truncated,
      nextCursor: cursor,
      inspectorVersion,
      entries: impactEntries,
    });
    await writeFile(
      path.join(artifactRoot, "impact-summary.json"),
      `${JSON.stringify(summary, null, 2)}\n`,
    );
    await writeFile(path.join(artifactRoot, "impact-summary.md"), renderImpactMarkdown(summary));
    console.log(
      `Dry run scanned ${summary.scannedReleases} latest plugin releases: ${summary.pluginsWithErrors} with errors, ${summary.pluginsWithWarnings} with warnings, ${summary.impactedOwners} owner(s) impacted.`,
    );
  }

  if (hadWorkerFailure) {
    process.exitCode = 1;
  }
}

async function inspectPackageItem(item: ClaimItem, inspectorVersion: string) {
  const workRoot = path.join(
    tmpdir(),
    `clawhub-plugin-inspector-bulk-scan-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  const pluginRoot = path.join(workRoot, "plugin");
  const reportDir = path.resolve(
    artifactRoot,
    safeArtifactName(`${item.packageName}-${item.version}`),
  );
  await mkdir(pluginRoot, { recursive: true });
  await mkdir(reportDir, { recursive: true });
  try {
    const artifact = await fetch(item.downloadUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!artifact.ok) {
      throw new Error(`download failed ${artifact.status}: ${await artifact.text()}`);
    }
    const artifactKind = resolveArtifactKind(item.artifactKind, artifact.headers);
    const artifactPath = path.join(
      workRoot,
      artifactKind === "npm-pack" ? "plugin.tgz" : "plugin.zip",
    );
    await writeFile(artifactPath, Buffer.from(await artifact.arrayBuffer()));
    if (artifactKind === "npm-pack") {
      run("tar", ["-xzf", artifactPath, "-C", pluginRoot, "--strip-components=1"]);
    } else {
      run("unzip", ["-q", artifactPath, "-d", pluginRoot]);
    }
    const scanRoot =
      artifactKind === "legacy-zip" && existsSync(path.join(pluginRoot, "package"))
        ? path.join(pluginRoot, "package")
        : pluginRoot;
    await writeSyntheticConfigIfNeeded(scanRoot, item.packageName);
    const scan = spawnSync(
      "bun",
      [clawhubCliEntry, "package", "validate", scanRoot, "--out", reportDir, "--json"],
      { cwd: repoRoot, encoding: "utf8" },
    );
    await writeFile(path.join(reportDir, "stdout.txt"), scan.stdout ?? "");
    await writeFile(path.join(reportDir, "stderr.txt"), scan.stderr ?? "");
    const reportPath = path.join(reportDir, "plugin-inspector-report.json");
    if (!existsSync(reportPath)) {
      throw new Error(
        scan.stderr || scan.stdout || `clawhub package validate exited ${scan.status}`,
      );
    }
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    const findings = normalizeFindings(report);
    const targetOpenClawVersion = extractTargetOpenClawVersion(report.targetOpenClaw);
    if (!dryRun) {
      const uploadResult = await postJson<UploadResult>(
        `${siteUrl}/api/v1/package-inspector/results`,
        {
          packageId: item.packageId,
          releaseId: item.releaseId,
          inspectorVersion,
          targetOpenClawVersion,
          findings,
        },
      );
      await writeFile(
        path.join(reportDir, "upload-result.json"),
        `${JSON.stringify({ findingCount: findings.length, ...uploadResult }, null, 2)}\n`,
      );
      console.log(
        `Uploaded ${item.packageName}@${item.version}: findings=${findings.length}, inserted=${uploadResult.inserted}, shouldEmailOwner=${uploadResult.shouldEmailOwner}`,
      );
    }
    return {
      failed: false,
      scanned: true,
      impactEntry: dryRun ? toImpactEntry(item, findings, targetOpenClawVersion) : undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeFile(path.join(reportDir, "error.txt"), message);
    console.error(`Plugin Inspector bulk scan failed for ${item.packageName}@${item.version}`);
    console.error(message);
    return { failed: true, scanned: false, impactEntry: undefined };
  } finally {
    await rm(workRoot, { recursive: true, force: true });
  }
}

export function resolveArtifactKind(value: string | undefined, headers: Headers) {
  if (value === "npm-pack" || value === "legacy-zip") return value;
  const header = headers.get("X-ClawHub-Artifact-Type")?.trim();
  if (header === "npm-pack-tarball") return "npm-pack";
  if (header === "legacy-plugin-zip") return "legacy-zip";
  return "legacy-zip";
}

if (import.meta.main) {
  await runPackageInspectorNightlyScan();
}

async function claimBatch(cursor: string | null) {
  const url = new URL(`${siteUrl}/api/v1/package-inspector/claim`);
  url.searchParams.set("batchSize", batchSize);
  url.searchParams.set("dryRun", dryRun ? "true" : "false");
  if (dryRun && cursor) url.searchParams.set("cursor", cursor);
  return await postJson<ClaimResponse>(url.toString(), {});
}

async function resolveTargetPackageItems(packageNames: string[]): Promise<ClaimItem[]> {
  const items: ClaimItem[] = [];
  for (const packageName of packageNames) {
    const detail = await fetch(`${siteUrl}/api/v1/packages/${encodeURIComponent(packageName)}`);
    if (!detail.ok) {
      throw new Error(
        `package lookup failed for ${packageName} ${detail.status}: ${await detail.text()}`,
      );
    }
    const payload = (await detail.json()) as { package?: unknown };
    const pkg = payload.package;
    if (!isPlainObject(pkg))
      throw new Error(`package lookup returned no package for ${packageName}`);
    const packageRecord = pkg as Record<string, unknown>;
    const packageId = stringValue(packageRecord._id);
    const releaseId = stringValue(packageRecord.latestReleaseId);
    const version = stringValue(packageRecord.latestVersion);
    const family = stringValue(packageRecord.family);
    const channel = stringValue(packageRecord.channel);
    if (!packageId || !releaseId || !version) {
      throw new Error(
        `package lookup returned incomplete latest release metadata for ${packageName}`,
      );
    }
    if (family !== "code-plugin" && family !== "bundle-plugin") {
      throw new Error(`${packageName} is not a plugin package`);
    }
    if (channel === "private") {
      throw new Error(`${packageName} is private and cannot be scanned by this workflow`);
    }
    items.push({
      packageId,
      releaseId,
      packageName: stringValue(packageRecord.name) ?? packageName,
      version,
      downloadUrl: `${siteUrl}/api/v1/package-inspector/artifact?releaseId=${encodeURIComponent(releaseId)}`,
    });
  }
  return items;
}

async function postJson<T = unknown>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`POST ${url} failed ${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as T;
}

async function writeSyntheticConfigIfNeeded(root: string, packageName: string) {
  if (
    existsSync(path.join(root, "plugin-inspector.config.json")) ||
    existsSync(path.join(root, ".plugin-inspector.json"))
  ) {
    return;
  }
  const packageJson = await readJsonIfExists(path.join(root, "package.json"));
  if (hasInspectorConfig(packageJson)) {
    return;
  }
  await writeFile(
    path.join(root, ".plugin-inspector.json"),
    `${JSON.stringify({ version: 1, plugin: { id: safeArtifactName(packageName) } }, null, 2)}\n`,
  );
}

async function readJsonIfExists(filePath: string) {
  if (!existsSync(filePath)) return null;
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

function hasInspectorConfig(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return isPlainObject(record.pluginInspector) || isPlainObject(record["plugin-inspector"]);
}

function isPlainObject(value: unknown) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function normalizeFindings(report: Record<string, unknown>): NormalizedFinding[] {
  const issues = Array.isArray(report.issues)
    ? report.issues
        .map((issue) => normalizeFinding(issue, "warning"))
        .filter(isFinding)
        .filter(isAuthorFacingFinding)
    : [];
  if (issues.length > 0) return issues;
  return [
    ...normalizeFindingArray(report.breakages, "breakage"),
    ...normalizeFindingArray(report.warnings, "warning"),
    ...normalizeFindingArray(report.suggestions, "warning"),
  ].filter(isAuthorFacingFinding);
}

function normalizeFindingArray(value: unknown, fallbackLevel: string) {
  return Array.isArray(value)
    ? value.map((finding) => normalizeFinding(finding, fallbackLevel)).filter(isFinding)
    : [];
}

function normalizeFinding(value: unknown, fallbackLevel: string): NormalizedFinding | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const message = stringValue(record.message) ?? stringValue(record.title);
  const code = stringValue(record.code) ?? "plugin-inspector-finding";
  if (!message) return null;
  const level =
    stringValue(record.level) ??
    (record.status === "blocking" || fallbackLevel === "breakage" ? "breakage" : "warning");
  return {
    id: stringValue(record.id),
    code,
    level,
    severity: stringValue(record.severity),
    issueClass: stringValue(record.issueClass),
    compatStatus: stringValue(record.compatStatus),
    deprecated: typeof record.deprecated === "boolean" ? record.deprecated : undefined,
    message,
    evidence: Array.isArray(record.evidence) ? record.evidence.map(String).slice(0, 12) : undefined,
    fixture: stringValue(record.fixture),
    decision: stringValue(record.decision),
    authorRemediation: normalizeAuthorRemediation(record.authorRemediation),
  };
}

function normalizeAuthorRemediation(value: unknown) {
  if (!isPlainObject(value)) return undefined;
  const record = value as Record<string, unknown>;
  const summary = stringValue(record.summary);
  if (!summary) return undefined;
  const docsUrl = stringValue(record.docsUrl);
  return docsUrl ? { summary, docsUrl } : { summary };
}

function isFinding(value: NormalizedFinding | null): value is NormalizedFinding {
  return value !== null;
}

function isAuthorFacingFinding(value: NormalizedFinding) {
  return value.issueClass !== "inspector-gap";
}

function toImpactEntry(
  item: ClaimItem,
  findings: NormalizedFinding[],
  targetOpenClawVersion: string | undefined,
): ImpactEntry {
  let errorCount = 0;
  let warningCount = 0;
  for (const finding of findings) {
    if (isErrorFinding(finding)) errorCount += 1;
    else warningCount += 1;
  }
  return {
    packageName: item.packageName,
    version: item.version,
    ownerUserId: item.ownerUserId,
    ownerPublisherId: item.ownerPublisherId,
    findingCount: findings.length,
    errorCount,
    warningCount,
    targetOpenClawVersion,
    findings,
  };
}

function isErrorFinding(finding: Pick<NormalizedFinding, "level" | "severity">) {
  return finding.level === "breakage" || finding.level === "error" || finding.severity === "P0";
}

function summarizeImpact(args: {
  claimed: number;
  scanned: number;
  batches: number;
  truncated: boolean;
  nextCursor: string | null;
  inspectorVersion: string;
  entries: ImpactEntry[];
}) {
  const impactedOwners = new Set<string>();
  const frequency = new Map<
    string,
    { code: string; count: number; errorCount: number; warningCount: number }
  >();
  let pluginsWithErrors = 0;
  let pluginsWithWarnings = 0;
  let totalErrors = 0;
  let totalWarnings = 0;
  for (const entry of args.entries) {
    if (entry.findingCount > 0 && entry.ownerUserId) impactedOwners.add(entry.ownerUserId);
    if (entry.errorCount > 0) pluginsWithErrors += 1;
    if (entry.warningCount > 0) pluginsWithWarnings += 1;
    totalErrors += entry.errorCount;
    totalWarnings += entry.warningCount;
    for (const finding of entry.findings) {
      const current = frequency.get(finding.code) ?? {
        code: finding.code,
        count: 0,
        errorCount: 0,
        warningCount: 0,
      };
      current.count += 1;
      if (isErrorFinding(finding)) current.errorCount += 1;
      else current.warningCount += 1;
      frequency.set(finding.code, current);
    }
  }
  return {
    dryRun,
    generatedAt: new Date().toISOString(),
    siteUrl,
    inspectorVersion: args.inspectorVersion,
    batchSize: Number.parseInt(batchSize, 10) || batchSize,
    batches: args.batches,
    truncated: args.truncated,
    nextCursor: args.nextCursor,
    claimedReleases: args.claimed,
    scannedReleases: args.scanned,
    pluginsWithFindings: args.entries.filter((entry) => entry.findingCount > 0).length,
    pluginsWithErrors,
    pluginsWithWarnings,
    impactedOwners: impactedOwners.size,
    totalErrors,
    totalWarnings,
    findingFrequency: [...frequency.values()].sort((a, b) => b.count - a.count),
    packages: args.entries.filter((entry) => entry.findingCount > 0),
  };
}

function getInspectorVersion() {
  return process.env.PLUGIN_INSPECTOR_VERSION ?? resolveBundledPluginInspectorVersion();
}

function renderImpactMarkdown(summary: ReturnType<typeof summarizeImpact>) {
  const lines = [
    "# Plugin Inspector Bulk Scan Dry Run",
    "",
    `- Generated: ${summary.generatedAt}`,
    `- Site: ${summary.siteUrl}`,
    `- Inspector: ${summary.inspectorVersion}`,
    `- Scanned latest releases: ${summary.scannedReleases}`,
    `- Plugins with errors: ${summary.pluginsWithErrors}`,
    `- Plugins with warnings: ${summary.pluginsWithWarnings}`,
    `- Impacted owners: ${summary.impactedOwners}`,
    `- Truncated: ${summary.truncated ? "yes" : "no"}`,
    "",
    "## Finding Frequency",
    "",
  ];
  if (summary.findingFrequency.length === 0) {
    lines.push("No findings.");
  } else {
    lines.push("| Code | Count | Errors | Warnings |", "| --- | ---: | ---: | ---: |");
    for (const finding of summary.findingFrequency) {
      lines.push(
        `| ${finding.code} | ${finding.count} | ${finding.errorCount} | ${finding.warningCount} |`,
      );
    }
  }
  lines.push("", "## Impacted Plugins", "");
  if (summary.packages.length === 0) {
    lines.push("No impacted plugins.");
  } else {
    lines.push(
      "| Plugin | Version | Errors | Warnings | Target OpenClaw |",
      "| --- | --- | ---: | ---: | --- |",
    );
    for (const entry of summary.packages) {
      lines.push(
        `| ${entry.packageName} | ${entry.version} | ${entry.errorCount} | ${entry.warningCount} | ${entry.targetOpenClawVersion ?? ""} |`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

function extractTargetOpenClawVersion(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  return (
    stringValue(record.version) ??
    stringValue(record.openclawVersion) ??
    stringValue(record.label) ??
    stringValue(record.status)
  );
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function safeArtifactName(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "plugin"
  );
}

function parseBoolean(value: string | undefined) {
  return ["1", "true", "yes", "on"].includes((value ?? "").trim().toLowerCase());
}

export function parsePackageNames(value: string | undefined) {
  return [
    ...new Set(
      (value ?? "")
        .split(/[\s,]+/)
        .map((name) => name.trim())
        .filter(Boolean),
    ),
  ];
}

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { stdio: "pipe", encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
}

function resolveBundledPluginInspectorVersion() {
  const require = createRequire(import.meta.url);
  const entry = require.resolve("@openclaw/plugin-inspector");
  const packageJsonPath = path.resolve(path.dirname(entry), "..", "package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    version?: unknown;
  };
  if (typeof packageJson.version !== "string" || !packageJson.version.trim()) {
    throw new Error("Unable to resolve bundled @openclaw/plugin-inspector version");
  }
  return packageJson.version.trim();
}
