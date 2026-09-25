import { randomUUID } from "node:crypto";
import { cp, lstat, readFile, readdir, readlink, rename, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import type { EndorAnalysis } from "../../convex/lib/endorAnalysis";
import { CommandFailure, runWorkerCommand } from "../lib/runWorkerCommand";
import { redactWorkerPublicText } from "../lib/workerRedaction";

const ENDOR_ENV_KEYS = [
  "ENDOR_API",
  "ENDOR_NAMESPACE",
  "ENDOR_TOKEN",
  "ENDOR_API_CREDENTIALS_KEY",
  "ENDOR_API_CREDENTIALS_SECRET",
] as const;
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
const DEFAULT_ENDOR_TIMEOUT_MS = 20 * 60 * 1000;
const DOCKER_CLEANUP_TIMEOUT_MS = 10_000;
const DOCKER_LATE_CREATE_POLL_MS = 100;
const ENDOR_RUN_ID_LABEL = "org.openclaw.clawhub.endor-run-id";
const MAX_ENDOR_DIAGNOSTIC_CHARS = 20_000;
const MAX_SUMMARY_FINDINGS = 50;
const MAX_SUMMARY_TEXT_CHARS = 2_000;
const REACHABLE_FUNCTION_TAG = "FINDING_TAGS_REACHABLE_FUNCTION";

const unknownRecordSchema = z.record(z.string(), z.unknown());
const endorFindingSchema = z
  .object({
    meta: z
      .object({
        description: z.string().optional(),
        name: z.string().optional(),
      })
      .passthrough()
      .optional(),
    spec: z
      .object({
        extra_key: z.string().optional(),
        finding_tags: z.array(z.string()).optional(),
        level: z.string().optional(),
        summary: z.string().optional(),
        target_dependency_package_name: z.string().optional(),
        target_dependency_version: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();
const endorRawReportSchema = z
  .object({
    all_findings: z.array(endorFindingSchema),
    blocking_findings: z.array(z.record(z.string(), z.unknown())),
    warning_findings: z.array(z.record(z.string(), z.unknown())),
  })
  .passthrough();

export type EndorCommandDiagnostic = {
  args?: string[];
  artifactPath?: string;
  exitCode?: number | null;
  rawArtifact?: string;
  scannerError?: string;
  sandboxRunId?: string;
  stderr?: string;
  stdout?: string;
  timedOut?: boolean;
};

function isPathWithin(root: string, candidate: string) {
  const normalizedRoot = resolve(root);
  const normalizedCandidate = resolve(candidate);
  return (
    normalizedCandidate === normalizedRoot ||
    normalizedCandidate.startsWith(`${normalizedRoot}${sep}`)
  );
}

async function assertNoExternalSymlinks(root: string, directory = root): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      const target = resolve(dirname(path), await readlink(path));
      if (!isPathWithin(root, target)) {
        throw new Error("Package artifact contains a symlink outside its root");
      }
      continue;
    }
    if (entry.isDirectory()) await assertNoExternalSymlinks(root, path);
  }
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
    const workspaceDependencyNames = Object.entries(devDependencies.data)
      .filter(([, version]) => typeof version === "string" && version.startsWith("workspace:"))
      .map(([name]) => name)
      .sort();
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

function endorRuntimeEnv(
  workspace: string,
  source: NodeJS.ProcessEnv,
  extraKeys: readonly string[] = [],
) {
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
  // The host Docker CLI needs its selected context. Container variables are
  // explicitly selected in the create command.
  for (const key of ["HOME", "DOCKER_CONFIG"] as const) {
    const value = source[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function dockerObjectMissing(error: unknown) {
  if (!(error instanceof CommandFailure)) return false;
  const output = `${error.stdout}\n${error.stderr}`.toLowerCase();
  return output.includes("no such object") || output.includes("no such container");
}

async function cleanupEndorContainer(input: {
  env: NodeJS.ProcessEnv;
  runId: string;
  waitForLateCreate: boolean;
  workspace: string;
}) {
  const deadline = Date.now() + DOCKER_CLEANUP_TIMEOUT_MS;
  const cleanupEnv = endorRuntimeEnv(input.workspace, input.env);
  const remainingMs = () => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("Endor Docker cleanup timed out");
    return remaining;
  };
  const runDocker = async (args: string[]) =>
    await runWorkerCommand("docker", args, {
      commandLabel: "Endor Docker cleanup",
      cwd: input.workspace,
      env: cleanupEnv,
      timeoutMs: remainingMs(),
    });
  const name = `clawhub-endor-${input.runId}`;
  const removeIfOwned = async () => {
    let inspected;
    try {
      inspected = await runDocker([
        "container",
        "inspect",
        "--format",
        `{{ .Id }}\n{{ .Name }}\n{{ index .Config.Labels ${JSON.stringify(ENDOR_RUN_ID_LABEL)} }}`,
        name,
      ]);
    } catch (error) {
      if (dockerObjectMissing(error)) return false;
      throw error;
    }
    const [id, actualName, runId, ...extra] = inspected.stdout.trim().split("\n");
    if (
      !id ||
      !/^[a-f0-9]{64}$/.test(id) ||
      actualName !== `/${name}` ||
      runId !== input.runId ||
      extra.length > 0
    ) {
      throw new Error(`refusing to remove Docker container ${name}: ownership does not match`);
    }
    try {
      await runDocker(["container", "rm", "--force", "--volumes", id]);
    } catch (error) {
      if (!dockerObjectMissing(error)) throw error;
    }
    return true;
  };

  if ((await removeIfOwned()) || !input.waitForLateCreate) return;
  while (Date.now() + DOCKER_LATE_CREATE_POLL_MS < deadline) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, DOCKER_LATE_CREATE_POLL_MS));
    if (await removeIfOwned()) return;
  }
}

function redactEndorDiagnosticText(value: string, env: NodeJS.ProcessEnv) {
  let redacted = value;
  for (const key of [
    "ENDOR_TOKEN",
    "ENDOR_API_CREDENTIALS_KEY",
    "ENDOR_API_CREDENTIALS_SECRET",
  ] as const) {
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

export function isEndorPluginScanEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.CODEX_SECURITY_SCAN_ENDOR_ENABLED === "1";
}

export async function runEndorPluginScan(input: {
  env?: NodeJS.ProcessEnv;
  onDiagnostic?: (diagnostic: Partial<EndorCommandDiagnostic>) => void;
  workspace: string;
}): Promise<EndorAnalysis> {
  const env = input.env ?? process.env;
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
  await assertNoExternalSymlinks(sourceRoot);
  const scanRoot = join(input.workspace, "endor-artifact");
  await cp(sourceRoot, scanRoot, {
    recursive: true,
    errorOnExist: true,
    force: false,
    verbatimSymlinks: true,
  });
  await normalizePackageTree(scanRoot);
  const sandboxRunId = randomUUID().replaceAll("-", "");
  const containerName = `clawhub-endor-${sandboxRunId}`;
  const args = [
    "container",
    "create",
    "--name",
    containerName,
    "--label",
    `${ENDOR_RUN_ID_LABEL}=${sandboxRunId}`,
    "--tmpfs",
    "/tmp:rw,nosuid,nodev",
    "--mount",
    `type=bind,source=${scanRoot},target=/workspace,readonly`,
    ...ENDOR_ENV_KEYS.filter((key) => env[key] !== undefined).flatMap((key) => ["--env", key]),
    image,
    "clawhub-endor-scan",
    "/workspace",
  ];
  input.onDiagnostic?.({
    args: ["docker", ...args],
    sandboxRunId,
  });
  const commandEnv = endorRuntimeEnv(input.workspace, env, ENDOR_ENV_KEYS);
  const deadline = Date.now() + endorTimeoutMs(env);
  let commandError: unknown;
  let output: { stdout: string; stderr: string } | undefined;
  let createTimedOut = false;
  try {
    const created = await runWorkerCommand("docker", args, {
      commandLabel: "Endor Docker create",
      cwd: input.workspace,
      env: commandEnv,
      timeoutMs: Math.max(1, deadline - Date.now()),
    });
    const containerId = created.stdout.trim();
    if (!/^[a-f0-9]{64}$/.test(containerId)) {
      throw new Error("Endor Docker create did not return a valid container ID");
    }
    output = await runWorkerCommand("docker", ["container", "start", "--attach", containerId], {
      commandLabel: "Endor Docker start",
      cwd: input.workspace,
      env: endorRuntimeEnv(input.workspace, env),
      timeoutMs: Math.max(1, deadline - Date.now()),
    });
    const waited = await runWorkerCommand("docker", ["container", "wait", containerId], {
      commandLabel: "Endor Docker wait",
      cwd: input.workspace,
      env: endorRuntimeEnv(input.workspace, env),
      timeoutMs: Math.max(1, deadline - Date.now()),
    });
    const rawExitCode = waited.stdout.trim();
    if (!/^(0|[1-9][0-9]*)$/.test(rawExitCode)) {
      throw new Error("Endor Docker wait did not return a valid exit code");
    }
    const exitCode = Number(rawExitCode);
    if (!Number.isSafeInteger(exitCode)) {
      throw new Error("Endor Docker wait did not return a valid exit code");
    }
    if (exitCode !== 0) {
      throw new CommandFailure(
        `Endor scanner exited ${exitCode}; see redacted stdout/stderr diagnostics`,
        exitCode,
        output.stdout,
        output.stderr,
        false,
      );
    }
    input.onDiagnostic?.({
      exitCode: 0,
      stderr: redactEndorDiagnosticText(output.stderr, env),
      stdout: redactEndorDiagnosticText(output.stdout, env),
      rawArtifact: redactEndorDiagnosticText(output.stdout, env),
    });
  } catch (error) {
    commandError = error;
    if (error instanceof CommandFailure) {
      createTimedOut = error.timedOut && error.message.startsWith("Endor Docker create");
      input.onDiagnostic?.({
        exitCode: error.exitCode,
        stderr: redactEndorDiagnosticText(error.stderr, env),
        stdout: redactEndorDiagnosticText(error.stdout, env),
        ...(output?.stdout || (error.message.startsWith("Endor Docker start") && error.stdout)
          ? { rawArtifact: redactEndorDiagnosticText(output?.stdout || error.stdout, env) }
          : {}),
        ...(error.stderr
          ? { scannerError: redactEndorDiagnosticText(error.stderr, env).trim() }
          : {}),
        timedOut: error.timedOut,
      });
    }
  }

  let cleanupError: unknown;
  try {
    await cleanupEndorContainer({
      env,
      runId: sandboxRunId,
      waitForLateCreate: createTimedOut,
      workspace: input.workspace,
    });
  } catch (error) {
    cleanupError = error;
  }
  if (commandError !== undefined && cleanupError !== undefined) {
    throw new AggregateError(
      [commandError, cleanupError],
      `Endor scan failed: ${errorMessage(commandError)}; Docker cleanup failed: ${errorMessage(cleanupError)}`,
    );
  }
  if (commandError !== undefined) throw commandError;
  if (cleanupError !== undefined) {
    throw new Error(`Endor Docker cleanup failed: ${errorMessage(cleanupError)}`, {
      cause: cleanupError,
    });
  }

  if (!output) throw new Error("Endor scanner did not emit findings JSON");
  let parsedOutput: unknown;
  try {
    parsedOutput = JSON.parse(output.stdout);
  } catch {
    throw new Error("Endor scanner did not emit valid findings JSON");
  }
  const report = endorRawReportSchema.safeParse(parsedOutput);
  if (!report.success) throw new Error("Endor scanner did not emit valid findings JSON");
  const reachableFindings = report.data.all_findings.filter((finding) =>
    finding.spec.finding_tags?.includes(REACHABLE_FUNCTION_TAG),
  );
  const findings = reachableFindings.slice(0, MAX_SUMMARY_FINDINGS).map((finding) => ({
    severity: normalizeSeverity(finding.spec.level),
    summary: normalizeFindingSummary(finding),
  }));
  return {
    status: "completed",
    checkedAt: Date.now(),
    reachableFunctionCount: reachableFindings.length,
    findings,
  };
}
