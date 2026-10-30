import { appendFileSync } from "node:fs";
import { cp, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runWorkerCommand } from "../lib/runWorkerCommand";
import { bundledSkillSpectorTerminalContext } from "./bundled-skillspector-diagnostic";
import { verifyDiagnosticTree } from "./clawscan-diagnostic-input";
import { skillSpectorRuntimeErrorMetadata } from "./clawscan-diagnostic-skillspector";
import original from "./fixtures/solaris-069-bundled.json";
import { runBundledSkillSpector, type ClawScanCommandDiagnostic } from "./run-codex-scan-worker";
import { securityScannerEnvironment } from "./securityModelPolicy";
import {
  installSkillSpectorExceptionObserver,
  readSkillSpectorExceptionEvents,
} from "./skillspector-exception-diagnostic";

const sourceCommit = "f197f4566f8a3c11755bc6688ec92a2c3347b4dd";
const sourceTree = "bcf058341b9cfa6290525a3980eab50e6b4b356f";
const scannerCommit = "e14f9960cc290d47f99fd3416b0589bbc0080f24";

export function assertSolarisDiagnosticAdmission(
  env: NodeJS.ProcessEnv & { platform?: string },
  args: string[],
) {
  if (
    args.length ||
    env.platform !== "linux" ||
    env.GITHUB_ACTIONS !== "true" ||
    env.RUNNER_OS !== "Linux" ||
    env.RUNNER_ARCH !== "X64" ||
    env.RUNNER_ENVIRONMENT !== "github-hosted" ||
    env.GITHUB_REF !== "refs/heads/main" ||
    env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
    env.CLAWSCAN_DIAGNOSTIC_RUNNER !== "ubuntu-22.04" ||
    !env.RUNNER_TEMP ||
    !isAbsolute(env.RUNNER_TEMP) ||
    !env.GITHUB_WORKSPACE ||
    !isAbsolute(env.GITHUB_WORKSPACE)
  )
    throw new Error("Fixed hosted diagnostic required");
}

export async function verifySolarisDiagnosticInput(path: string) {
  return verifyDiagnosticTree(
    path,
    {
      ...original,
      manifestCanonicalization: "path,size,sha256",
    },
    16 * 1024 * 1024,
  );
}

async function attestRuntime(workspace: string) {
  const settings = securityScannerEnvironment(process.env);
  if (
    settings.SKILLSPECTOR_PROVIDER !== "openai" ||
    settings.SKILLSPECTOR_MODEL !== "gpt-6.1-sol" ||
    settings.SKILLSPECTOR_REASONING_EFFORT !== "medium" ||
    settings.DEFAULT_MODEL !== "gpt-6.1-sol" ||
    settings.REASONING_EFFORT !== "medium" ||
    settings.DEFAULT_BASE_URL !== "https://api.openai.com/v1" ||
    !settings.OPENAI_API_KEY ||
    settings.SKILLSPECTOR_SERVICE_TIER !== undefined ||
    (await readFile(new URL("./clawscan-source-commit.txt", import.meta.url), "utf8")).trim() !==
      scannerCommit ||
    !process.env.CLAWSCAN_SOURCE_DIR
  )
    throw new Error("Production scanner policy mismatch");
  const command = async (name: string, args: string[]) =>
    (
      await runWorkerCommand(name, args, {
        cwd: workspace,
        env: { PATH: process.env.PATH },
        timeoutMs: 30_000,
      })
    ).stdout.trim();
  const actualSource = await command("git", [
    "-C",
    process.env.CLAWSCAN_SOURCE_DIR,
    "rev-parse",
    "HEAD",
  ]);
  const sourceChanges = await command("git", [
    "-C",
    process.env.CLAWSCAN_SOURCE_DIR,
    "status",
    "--porcelain",
    "--untracked-files=no",
  ]);
  const ubuntu = await readFile("/etc/os-release", "utf8");
  const python = await command("python", ["--version"]);
  if (
    actualSource !== scannerCommit ||
    sourceChanges ||
    !/^VERSION_ID="22.04"$/m.test(ubuntu) ||
    !/^Python 3\.12\.\d+$/.test(python) ||
    (await command("node", ["--version"])) !== "v24.22.1"
  )
    throw new Error("Diagnostic runtime mismatch");
  const dockerfile = await readFile(
    join(process.env.CLAWSCAN_SOURCE_DIR, "docker/clawscan-runtime/Dockerfile"),
    "utf8",
  );
  const scannerSource = /^ARG SKILLSPECTOR_REF=([a-f0-9]{40})$/m.exec(dockerfile)?.[1];
  if (!scannerSource) throw new Error("Missing scanner source identity");
  return {
    settings,
    metadata: {
      scannerCommit,
      scannerSource,
      python,
      node: "v24.22.1",
      ubuntu: "22.04",
      cpuParallelism: availableParallelism(),
      model: "gpt-6.1-sol",
      reasoning: "medium",
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
    },
  };
}

export async function main(
  args = process.argv.slice(2),
  diagnosticCase: "all" | "fleet-error" | "all-error" = "all",
) {
  assertSolarisDiagnosticAdmission({ ...process.env, platform: process.platform }, args);
  if (!["all", "fleet-error", "all-error"].includes(diagnosticCase))
    throw new Error("Invalid fixed diagnostic case");
  if (
    diagnosticCase !== "all" &&
    (process.env.GITHUB_WORKFLOW_REF !==
      "openclaw/clawhub/.github/workflows/solaris-exception-diagnostic.yml@refs/heads/main" ||
      process.env.GITHUB_JOB !== (diagnosticCase === "fleet-error" ? "fleet-root" : "all-roots") ||
      original.bundledRoots.length !== 62)
  )
    throw new Error("Fixed exception diagnostic workflow required");
  const rootIndices =
    diagnosticCase === "fleet-error" ? [28] : original.bundledRoots.map((_, index) => index);
  const runnerTemp = process.env.RUNNER_TEMP!;
  const checkout = join(process.env.GITHUB_WORKSPACE!, "solaris-source");
  const source = join(checkout, "harnesses/openclaw");
  const outputFile = process.env.GITHUB_OUTPUT;
  const scratch = await mkdtemp(join(runnerTemp, "solaris-bundled-private-"));
  const safeOutput = await mkdtemp(join(runnerTemp, "solaris-bundled-safe-"));
  const savedEnv = { ...process.env };
  const summary: Record<string, unknown> = {
    label: "NONPRODUCTION_DIAGNOSTIC",
    acceptedPublication: false,
    recoveryEvidence: false,
    excludedFromSlos: true,
    sourceCommit,
    sourceTree,
    archiveSha256: original.archiveSha256,
    manifestSha256: original.manifestSha256,
    release: "solaris-dev-shop-openclaw@0.69.0",
    releaseId: "rd76tsvthmjkfzbqtytqwy0wb18h45ez",
    status: "setup_failed",
    diagnosticCase,
    selectedRootIndices: rootIndices,
    differencesFromProduction: [
      "manual singleton without queue, claims, judge or publication",
      "public Git container; all original file bytes and inventory verified",
      "fresh private scratch; no worker credentials",
    ],
  };
  try {
    await mkdir(join(scratch, "home"), { mode: 0o700 });
    const { settings, metadata } = await attestRuntime(scratch);
    summary.runtime = metadata;
    for (const directory of [checkout, join(checkout, "harnesses")]) {
      const info = await lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Invalid input directory");
    }
    const checkoutIdentity = await runWorkerCommand(
      "git",
      ["-C", checkout, "rev-parse", "HEAD", "HEAD:harnesses/openclaw"],
      {
        cwd: scratch,
        env: { PATH: process.env.PATH },
        timeoutMs: 30_000,
      },
    );
    if (checkoutIdentity.stdout.trim() !== `${sourceCommit}\n${sourceTree}`)
      throw new Error("Input source mismatch");
    // Verify before copying as well: neither traversal may follow a publisher symlink.
    await verifySolarisDiagnosticInput(source);
    await cp(source, join(scratch, "artifact"), {
      recursive: true,
      dereference: false,
      errorOnExist: true,
      force: false,
    });
    summary.before = await verifySolarisDiagnosticInput(join(scratch, "artifact"));
    const observer =
      diagnosticCase === "all"
        ? null
        : await installSkillSpectorExceptionObserver(scratch, runnerTemp);
    // The actual worker helper admits only this environment. No CI/backend tokens.
    process.env = {
      ...settings,
      PATH: observer?.path ?? process.env.PATH,
      LANG: "C.UTF-8",
      CODEX_HOME: join(scratch, "home"),
    };
    const startedAt = performance.now();
    let failure: ClawScanCommandDiagnostic["bundledSkillSpector"];
    try {
      await runBundledSkillSpector(
        scratch,
        rootIndices.map((rootIndex) => ({
          rootPath: original.bundledRoots[rootIndex],
          scanPath: join("artifact", original.bundledRoots[rootIndex]),
        })),
        (diagnostic) => {
          failure = diagnostic.bundledSkillSpector;
        },
      );
      summary.status = "completed";
    } catch {
      summary.status = "failed";
    }
    summary.elapsedMs = Math.floor(performance.now() - startedAt);
    summary.failure = failure ?? null;
    const roots = await Promise.all(
      rootIndices.map(async (rootIndex, localIndex) => {
        const path = join(scratch, `skillspector-report-${localIndex}.json`);
        return {
          rootIndex,
          terminal: await bundledSkillSpectorTerminalContext(path),
          runtimeErrors: await skillSpectorRuntimeErrorMetadata(path),
        };
      }),
    );
    summary.roots = roots;
    if (observer) {
      const evidence = await readSkillSpectorExceptionEvents(observer.output);
      summary.exceptionEvidence = evidence.events.some(
        (event) => event.rootIndex >= rootIndices.length,
      )
        ? { presence: "invalid", events: [] }
        : {
            ...evidence,
            events: evidence.events.map((event) => ({
              ...event,
              rootIndex: rootIndices[event.rootIndex],
            })),
          };
      const started = roots
        .filter((root) => root.terminal.presence !== "missing")
        .map((root) => root.rootIndex)
        .sort((a, b) => a - b);
      const installed = evidence.events
        .filter((event) => event.kind === "installed")
        .map((event) => rootIndices[event.rootIndex])
        .sort((a, b) => a - b);
      const finished = evidence.events.filter((event) => event.kind === "finished");
      const finishedRoots = finished
        .map((event) => rootIndices[event.rootIndex])
        .sort((a, b) => a - b);
      const complete =
        evidence.presence === "present" &&
        JSON.stringify(installed) === JSON.stringify(started) &&
        JSON.stringify(finishedRoots) === JSON.stringify(started) &&
        finished.every(
          (event) =>
            event.kind === "finished" && event.calls === event.written && event.writeFailures === 0,
        );
      summary.observerComplete = complete;
      if (!complete && summary.status === "completed") summary.status = "validation_failed";
    }
    summary.after = await verifySolarisDiagnosticInput(join(scratch, "artifact"));
  } catch {
    summary.validationFailed = true;
    summary.status = "validation_failed";
  } finally {
    process.env = savedEnv;
    await rm(scratch, { recursive: true, force: true });
    await rm(checkout, { recursive: true, force: true });
    summary.cleanup =
      (await lstat(scratch).catch(() => null)) === null &&
      (await lstat(checkout).catch(() => null)) === null;
    await writeFile(join(safeOutput, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    if (outputFile) appendFileSync(outputFile, `safe-output=${safeOutput}\n`);
  }
  if (summary.status !== "completed" || !summary.cleanup) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main().catch(() => {
    process.stderr.write("Fixed diagnostic admission or cleanup failed\n");
    process.exitCode = 1;
  });
}
