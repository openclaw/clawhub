import { randomUUID } from "node:crypto";
import { cp, lstat, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { z } from "zod";
import type { EndorAnalysis } from "../../convex/lib/endorAnalysis";
import { CommandFailure, runWorkerCommand } from "../lib/runWorkerCommand";
import { redactWorkerPublicText } from "../lib/workerRedaction";

const ENDOR_SECRET_ENV_KEYS = [
  "ENDOR_TOKEN",
  "ENDOR_API_CREDENTIALS_KEY",
  "ENDOR_API_CREDENTIALS_SECRET",
] as const;
const ENDOR_ENV_KEYS = ["ENDOR_API", "ENDOR_NAMESPACE", ...ENDOR_SECRET_ENV_KEYS] as const;
const CHILD_RUNTIME_ENV_KEYS = [
  "PATH",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  // The host Docker CLI needs its selected context. Container variables are
  // explicitly selected with --env.
  "HOME",
  "DOCKER_CONFIG",
] as const;
const DEFAULT_ENDOR_TIMEOUT_MS = 20 * 60 * 1000;
const DOCKER_REMOVE_TIMEOUT_MS = 10_000;
const MAX_ENDOR_REPORT_BYTES = 8 * 1024 * 1024;
const MAX_ENDOR_COMMAND_DIAGNOSTIC_BYTES = 128 * 1024;
const MAX_ENDOR_DIAGNOSTIC_CHARS = 20_000;
const MAX_SUMMARY_FINDINGS = 50;
const MAX_SUMMARY_TEXT_CHARS = 2_000;
const REACHABLE_FUNCTION_TAG = "FINDING_TAGS_REACHABLE_FUNCTION";

const unknownRecordSchema = z.record(z.string(), z.unknown());
const packageReleaseSchema = z.object({
  package: z.object({ name: z.string().min(1) }),
  release: z.object({ version: z.string().min(1) }),
});
const endorFindingSchema = z.object({
  meta: z
    .object({
      description: z.string().optional(),
      name: z.string().optional(),
    })
    .optional(),
  spec: z.object({
    extra_key: z.string().optional(),
    finding_tags: z.array(z.string()).optional(),
    level: z.string().optional(),
    summary: z.string().optional(),
    target_dependency_package_name: z.string().optional(),
    target_dependency_version: z.string().optional(),
  }),
});
const endorRawReportSchema = z.object({ all_findings: z.array(endorFindingSchema) });

export type EndorCommandDiagnostic = {
  args?: string[];
  // The worker records the thrown failure message; the runner never sets it.
  error?: string;
  exitCode?: number | null;
  stderr?: string;
  stdout?: string;
  timedOut?: boolean;
};

export function isEndorPluginScanEnabled(family: string | undefined): boolean {
  // Endor resolves npm dependencies, so only code plugins are eligible.
  return process.env.CODEX_SECURITY_SCAN_ENDOR_ENABLED === "1" && family === "code-plugin";
}

async function isRegularFile(path: string) {
  return (await lstat(path).catch(() => null))?.isFile() === true;
}

async function normalizePackageRoot(scanRoot: string, manifestDirectory: string) {
  const packageRoot = relative(scanRoot, manifestDirectory).replaceAll("\\", "/") || ".";
  const manifestPath = join(manifestDirectory, "package.json");
  let parsedManifest: unknown;
  try {
    parsedManifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`Endor scan package.json is invalid at ${packageRoot}`, { cause: error });
  }
  const manifest = unknownRecordSchema.parse(parsedManifest);
  const devDependenciesValue = manifest.devDependencies;
  if (devDependenciesValue !== undefined) {
    const devDependencies = unknownRecordSchema.safeParse(devDependenciesValue);
    if (!devDependencies.success) {
      throw new Error(`Endor scan devDependencies is invalid at ${packageRoot}`);
    }
    // Published packages keep monorepo dev links that npm cannot resolve.
    const workspaceDependencyNames = Object.entries(devDependencies.data)
      .filter(([, version]) => typeof version === "string" && version.startsWith("workspace:"))
      .map(([name]) => name);
    if (workspaceDependencyNames.length > 0) {
      for (const name of workspaceDependencyNames) delete devDependencies.data[name];
      manifest.devDependencies = devDependencies.data;
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    }
  }

  const shrinkwrapPath = join(manifestDirectory, "npm-shrinkwrap.json");
  const packageLockPath = join(manifestDirectory, "package-lock.json");
  if ((await isRegularFile(shrinkwrapPath)) && !(await isRegularFile(packageLockPath))) {
    await rename(shrinkwrapPath, packageLockPath);
  }
}

async function normalizePackageTree(scanRoot: string, directory = scanRoot): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  if (await isRegularFile(join(directory, "package.json"))) {
    await normalizePackageRoot(scanRoot, directory);
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === ".git" || entry.name === "node_modules") continue;
    await normalizePackageTree(scanRoot, join(directory, entry.name));
  }
}

function endorTimeoutMs(env: NodeJS.ProcessEnv) {
  const parsed = Number(env.CODEX_SECURITY_SCAN_ENDOR_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_ENDOR_TIMEOUT_MS;
}

function dockerEnv(workspace: string, source: NodeJS.ProcessEnv, extraKeys: readonly string[]) {
  const env: NodeJS.ProcessEnv = {
    NO_COLOR: "1",
    TEMP: workspace,
    TMP: workspace,
    TMPDIR: workspace,
  };
  for (const key of [...CHILD_RUNTIME_ENV_KEYS, ...extraKeys]) {
    const value = source[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

function redactEndorDiagnosticText(value: string, env: NodeJS.ProcessEnv) {
  let redacted = value;
  for (const key of ENDOR_SECRET_ENV_KEYS) {
    const secret = env[key];
    if (secret) redacted = redacted.replaceAll(secret, "[redacted-secret]");
  }
  return redactWorkerPublicText(redacted, MAX_ENDOR_DIAGNOSTIC_CHARS);
}

function normalizeSeverity(value: string | undefined) {
  return (
    value
      ?.replace(/^FINDING_LEVEL_/, "")
      .trim()
      .toLowerCase() || "unknown"
  ).slice(0, 64);
}

function normalizeFindingSummary(finding: z.infer<typeof endorFindingSchema>) {
  const advisory = finding.spec.extra_key?.trim();
  const dependency = finding.spec.target_dependency_package_name?.trim();
  const dependencyVersion = finding.spec.target_dependency_version?.trim();
  const dependencyLabel =
    dependency && dependencyVersion && !dependency.endsWith(`@${dependencyVersion}`)
      ? `${dependency} ${dependencyVersion}`
      : dependency || dependencyVersion;
  const reportedSummary =
    finding.spec.summary?.trim() || finding.meta?.description?.trim() || finding.meta?.name?.trim();
  return (
    reportedSummary ||
    [advisory, dependencyLabel].filter(Boolean).join(" in ") ||
    "Endor reported a reachable vulnerable function"
  ).slice(0, MAX_SUMMARY_TEXT_CHARS);
}

async function resolvePackageArtifactRoot(workspace: string) {
  for (const candidate of [join(workspace, "artifact", "package"), join(workspace, "artifact")]) {
    if (await isRegularFile(join(candidate, "package.json"))) return candidate;
  }
  return undefined;
}

export async function runEndorPluginScan(input: {
  env?: NodeJS.ProcessEnv;
  onDiagnostic?: (diagnostic: Partial<EndorCommandDiagnostic>) => void;
  packageRelease: { package?: unknown; release?: unknown };
  workspace: string;
}): Promise<EndorAnalysis> {
  const env = input.env ?? process.env;
  // Only claimed release metadata identifies the saved Endor project; artifact
  // manifests and signed download URLs are untrusted or contain credentials.
  const release = packageReleaseSchema.parse(input.packageRelease);
  const name = release.package.name;
  const version = release.release.version;
  const encodedName = name.split("/").map(encodeURIComponent).join("/");
  const sourceUrl = `https://clawhub.ai/api/v1/packages/${encodedName}/versions/${encodeURIComponent(version)}/artifact/download`;
  // Bundle versions can contain commas; escape tag delimiters without changing
  // ordinary package/version labels or colliding with a literal %.
  const tagVersion = version.replace(/[%,]/g, (character) => encodeURIComponent(character));
  const tags = `plugin:${name},version:${tagVersion}`;

  const sourceRoot = await resolvePackageArtifactRoot(input.workspace);
  if (!sourceRoot) {
    return {
      status: "skipped",
      checkedAt: Date.now(),
      reason: "Endor requires package.json at the package artifact root.",
    };
  }

  const image = env.CODEX_SECURITY_SCAN_ENDOR_IMAGE?.trim();
  if (!image) throw new Error("CODEX_SECURITY_SCAN_ENDOR_IMAGE is required when Endor is enabled");
  const scanRoot = join(input.workspace, "endor-artifact");
  await cp(sourceRoot, scanRoot, { recursive: true, errorOnExist: true, force: false });
  await normalizePackageTree(scanRoot);

  const containerName = `clawhub-endor-${randomUUID()}`;
  const args = [
    "run",
    "--rm",
    "--name",
    containerName,
    "--network",
    "bridge",
    // The egress guard blocks private host resolvers, including OrbStack's DNS.
    "--dns",
    "1.1.1.1",
    "--dns",
    "8.8.8.8",
    // NET_ADMIN installs the egress guard; the rest let the entrypoint drop to
    // the unprivileged node user before the scanner runs.
    "--cap-drop",
    "ALL",
    "--cap-add",
    "NET_ADMIN",
    "--cap-add",
    "SETUID",
    "--cap-add",
    "SETGID",
    "--cap-add",
    "SETPCAP",
    "--cap-add",
    "CHOWN",
    "--security-opt",
    "no-new-privileges:true",
    "--read-only",
    "--entrypoint",
    "/usr/local/bin/clawhub-endor-entrypoint",
    "--tmpfs",
    "/tmp:rw,nosuid,nodev,exec",
    "--mount",
    `type=bind,source=${scanRoot},target=/workspace,readonly`,
    ...ENDOR_ENV_KEYS.filter((key) => env[key] !== undefined).flatMap((key) => ["--env", key]),
    image,
    "clawhub-endor-scan",
    "/workspace",
    sourceUrl,
    tags,
  ];
  input.onDiagnostic?.({ args: ["docker", ...args] });

  let output: { stdout: string; stderr: string };
  try {
    // docker run exits with the scanner's status, so a nonzero exit is a CommandFailure.
    output = await runWorkerCommand("docker", args, {
      commandLabel: "Endor scan",
      cwd: input.workspace,
      env: dockerEnv(input.workspace, env, ENDOR_ENV_KEYS),
      maxStdoutBytes: MAX_ENDOR_REPORT_BYTES,
      maxStderrBytes: MAX_ENDOR_COMMAND_DIAGNOSTIC_BYTES,
      timeoutMs: endorTimeoutMs(env),
    });
  } catch (error) {
    if (error instanceof CommandFailure) {
      input.onDiagnostic?.({
        exitCode: error.exitCode,
        stderr: redactEndorDiagnosticText(error.stderr, env),
        stdout: redactEndorDiagnosticText(error.stdout, env),
        timedOut: error.timedOut,
      });
    }
    // Killing the Docker CLI leaves the container running. Remove it now;
    // --rm and the disposable runner cover the case where this fails.
    await runWorkerCommand("docker", ["rm", "--force", containerName], {
      commandLabel: "Endor container removal",
      cwd: input.workspace,
      env: dockerEnv(input.workspace, env, []),
      timeoutMs: DOCKER_REMOVE_TIMEOUT_MS,
    }).catch(() => undefined);
    throw error;
  }
  input.onDiagnostic?.({
    exitCode: 0,
    stderr: redactEndorDiagnosticText(output.stderr, env),
    stdout: redactEndorDiagnosticText(output.stdout, env),
  });

  let report: z.infer<typeof endorRawReportSchema>;
  try {
    report = endorRawReportSchema.parse(JSON.parse(output.stdout));
  } catch {
    throw new Error("Endor scanner did not emit valid findings JSON");
  }
  const reachableFindings = report.all_findings.filter((finding) =>
    finding.spec.finding_tags?.includes(REACHABLE_FUNCTION_TAG),
  );
  return {
    status: "completed",
    checkedAt: Date.now(),
    reachableFunctionCount: reachableFindings.length,
    findings: reachableFindings.slice(0, MAX_SUMMARY_FINDINGS).map((finding) => ({
      severity: normalizeSeverity(finding.spec.level),
      summary: normalizeFindingSummary(finding),
    })),
  };
}
