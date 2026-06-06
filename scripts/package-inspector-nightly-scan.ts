import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

type ClaimItem = {
  packageId: string;
  releaseId: string;
  packageName: string;
  version: string;
  artifactKind: string;
  downloadUrl: string;
};

type ClaimResponse = {
  ok: true;
  leased: boolean;
  items: ClaimItem[];
};

const siteUrl = (process.env.CLAWHUB_SITE_URL ?? "https://clawhub.ai").replace(/\/+$/, "");
const token = process.env.CLAWHUB_PLUGIN_INSPECTOR_WORKER_TOKEN;
const batchSize = process.env.PLUGIN_INSPECTOR_BATCH_SIZE ?? "25";
const inspectorVersion = process.env.PLUGIN_INSPECTOR_VERSION;
const artifactRoot =
  process.env.PLUGIN_INSPECTOR_ARTIFACT_DIR ?? "plugin-inspector-nightly-reports";

if (!token) throw new Error("CLAWHUB_PLUGIN_INSPECTOR_WORKER_TOKEN is required");

const claim = await postJson<ClaimResponse>(
  `${siteUrl}/api/v1/package-inspector/claim?batchSize=${encodeURIComponent(batchSize)}`,
  {},
);

await mkdir(artifactRoot, { recursive: true });

let hadWorkerFailure = false;

for (const item of claim.items) {
  const workRoot = path.join(
    tmpdir(),
    `clawhub-plugin-inspector-nightly-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  const pluginRoot = path.join(workRoot, "plugin");
  const reportDir = path.resolve(
    artifactRoot,
    safeArtifactName(`${item.packageName}-${item.version}`),
  );
  await mkdir(pluginRoot, { recursive: true });
  await mkdir(reportDir, { recursive: true });
  try {
    const artifactPath = path.join(
      workRoot,
      item.artifactKind === "npm-pack" ? "plugin.tgz" : "plugin.zip",
    );
    const artifact = await fetch(item.downloadUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!artifact.ok) {
      throw new Error(`download failed ${artifact.status}: ${await artifact.text()}`);
    }
    await writeFile(artifactPath, Buffer.from(await artifact.arrayBuffer()));
    if (item.artifactKind === "npm-pack") {
      run("tar", ["-xzf", artifactPath, "-C", pluginRoot, "--strip-components=1"]);
    } else {
      run("unzip", ["-q", artifactPath, "-d", pluginRoot]);
    }
    const scanRoot =
      item.artifactKind === "legacy-zip" && existsSync(path.join(pluginRoot, "package"))
        ? path.join(pluginRoot, "package")
        : pluginRoot;
    await writeSyntheticConfigIfNeeded(scanRoot, item.packageName);
    const scan = spawnSync(
      "bunx",
      [
        "@openclaw/plugin-inspector@latest",
        "ci",
        "--no-openclaw",
        "--plugin-root",
        scanRoot,
        "--out",
        reportDir,
        "--json",
      ],
      { encoding: "utf8" },
    );
    await writeFile(path.join(reportDir, "stdout.txt"), scan.stdout ?? "");
    await writeFile(path.join(reportDir, "stderr.txt"), scan.stderr ?? "");
    const reportPath = path.join(reportDir, "plugin-inspector-report.json");
    if (!existsSync(reportPath)) {
      throw new Error(scan.stderr || scan.stdout || `plugin-inspector exited ${scan.status}`);
    }
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    await postJson(`${siteUrl}/api/v1/package-inspector/results`, {
      packageId: item.packageId,
      releaseId: item.releaseId,
      inspectorVersion,
      targetOpenClawVersion: extractTargetOpenClawVersion(report.targetOpenClaw),
      findings: normalizeFindings(report),
    });
  } catch (error) {
    hadWorkerFailure = true;
    const message = error instanceof Error ? error.message : String(error);
    await writeFile(path.join(reportDir, "error.txt"), message);
    console.error(`Nightly Plugin Inspector worker failed for ${item.packageName}@${item.version}`);
    console.error(message);
  } finally {
    await rm(workRoot, { recursive: true, force: true });
  }
}

if (hadWorkerFailure) {
  process.exitCode = 1;
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

function normalizeFindings(report: Record<string, unknown>) {
  const issues = Array.isArray(report.issues)
    ? report.issues.map((issue) => normalizeFinding(issue, "warning")).filter(Boolean)
    : [];
  if (issues.length > 0) return issues;
  return [
    ...normalizeFindingArray(report.breakages, "breakage"),
    ...normalizeFindingArray(report.warnings, "warning"),
    ...normalizeFindingArray(report.suggestions, "warning"),
  ];
}

function normalizeFindingArray(value: unknown, fallbackLevel: string) {
  return Array.isArray(value)
    ? value.map((finding) => normalizeFinding(finding, fallbackLevel)).filter(Boolean)
    : [];
}

function normalizeFinding(value: unknown, fallbackLevel: string) {
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
  };
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

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { stdio: "pipe", encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
}
