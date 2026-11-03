import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { runWorkerCommand, type WorkerCommandTermination } from "../lib/runWorkerCommand";
import {
  diagnosticEvidenceContainsCredential,
  encryptDiagnosticEvidence,
  requireDiagnosticRecipient,
} from "./clawscan-diagnostic-encryption";
import {
  downloadOriginal038,
  materializeOriginal038,
  original038Manifest,
  ORIGINAL038_SOURCE,
} from "./clawscan-diagnostic-fixed038";
import {
  downloadOriginal079,
  materializeOriginal079,
  original079Manifest,
} from "./clawscan-diagnostic-fixed079";
import { verifyDiagnosticTree } from "./clawscan-diagnostic-input";
import { installOriginalRuntime } from "./clawscan-diagnostic-runtime";
import {
  assertDisposableDiagnosticEnvironment,
  diagnosticArtifactMetadata,
  removeRuntime,
} from "./run-clawscan-diagnostic";

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const modules = [
  "capture.py",
  "workspace_capture.py",
  "validation.py",
  "proxy.py",
  "original038.py",
  "provenance.json",
];

export function original038DiagnosticPassed(input: {
  captureComplete: boolean;
  termination: WorkerCommandTermination | null;
  nativeExitCode: unknown;
  consumerValidation: string;
}) {
  return (
    input.captureComplete &&
    input.termination?.processGroup === "absent" &&
    input.termination.exitCode === 0 &&
    input.termination.timedOut === false &&
    input.termination.outputLimitExceeded === null &&
    (input.nativeExitCode === 0 || input.nativeExitCode === 1) &&
    input.consumerValidation === "validated_ephemerally_not_published"
  );
}

export async function mainFixedOriginalDiagnostic(fixture: "038" | "079" = "038") {
  if (fixture !== "038" && fixture !== "079") throw new Error("Only fixed originals are supported");
  const selected =
    fixture === "038"
      ? {
          id: "sn-ppt-workbench-2026.10.29",
          package: "sn-ppt-workbench",
          version: "2026.10.29",
          manifest: original038Manifest,
          download: downloadOriginal038,
          materialize: materializeOriginal038,
        }
      : {
          id: "mcpherson-governance-openclaw-0.8.0",
          package: "@mcphersonai/mcpherson-governance-openclaw",
          version: "0.8.0",
          manifest: original079Manifest,
          download: downloadOriginal079,
          materialize: materializeOriginal079,
        };
  const recipient = requireDiagnosticRecipient(process.env.DIAGNOSTIC_AGE_RECIPIENT);
  assertDisposableDiagnosticEnvironment(true);
  if (
    process.arch !== "x64" ||
    process.env.CLAWSCAN_DIAGNOSTIC_RUNNER !== "ubuntu-22.04" ||
    process.env.GITHUB_RUN_ATTEMPT !== "1" ||
    !/^\d+$/.test(process.env.GITHUB_RUN_ID ?? "")
  )
    throw new Error("Fixed original requires native Ubuntu22 X64 and a fresh workflow run");
  const ageBinary = process.env.DIAGNOSTIC_AGE_BINARY;
  if (!ageBinary || !ageBinary.startsWith(`${process.env.RUNNER_TEMP}/clawscan-age.`))
    throw new Error("Pinned diagnostic age binary required");
  process.umask(0o077);
  const root = await mkdtemp(
    join(process.env.RUNNER_TEMP!, `clawscan-original${fixture}-private-`),
  );
  const evidence = join(root, "evidence");
  const output = `${root}-encrypted`;
  await mkdir(evidence, { mode: 0o700 });
  const setupHome = join(root, "setup-home");
  await mkdir(setupHome, { mode: 0o700 });
  const setupEnv: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: setupHome,
    CODEX_HOME: join(setupHome, ".codex"),
    TMPDIR: root,
    TMP: root,
    TEMP: root,
    LANG: "C.UTF-8",
    NO_COLOR: "1",
    PYTHONNOUSERSITE: "1",
    PYTHONDONTWRITEBYTECODE: "1",
  };
  const envelope = {
    schemaVersion: "clawscan-fixed-original-encrypted-v1",
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: 1,
    source: ORIGINAL038_SOURCE,
    originalManifestSha256: selected.manifest.manifestSha256,
    package: selected.package,
    version: selected.version,
    recipient,
    automaticRetries: 0,
    maximumScans: 1,
    acceptedPublication: false,
  };
  await writeFile(join(evidence, "envelope.json"), JSON.stringify(envelope, null, 2), {
    mode: 0o600,
  });
  let captureComplete = false;
  let diagnosticPassed = false;
  let cleanupConfirmed = false;
  let encrypted = false;
  let captureStarted = false;
  try {
    // Validate age's recipient checksum before installation or model work.
    const emptyCiphertext = join(root, "recipient-check.age");
    await runWorkerCommand(
      ageBinary,
      ["--encrypt", "--recipient", recipient, "--output", emptyCiphertext, "/dev/null"],
      { cwd: root, env: setupEnv, timeoutMs: 30_000, cleanupProcessGroup: true },
    );
    await rm(emptyCiphertext);
    const apiKey = process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY;
    if (!apiKey) throw new Error("Existing CI key reference required");
    const installed = await installOriginalRuntime(root, ORIGINAL038_SOURCE, true, setupEnv, true);
    await writeFile(
      join(evidence, "runtime-attestation.json"),
      JSON.stringify(installed.metadata, null, 2),
      { mode: 0o600 },
    );
    const target = join(root, "original");
    const identity = await selected.materialize(await selected.download(), target);
    await writeFile(
      join(evidence, "original-custody.json"),
      JSON.stringify(
        {
          ...identity,
          files: selected.manifest.files,
          package: envelope.package,
          version: envelope.version,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    const harness = join(root, "harness");
    await mkdir(harness, { mode: 0o700 });
    await mkdir(join(harness, "bin"), { mode: 0o700 });
    const python = (
      await runWorkerCommand("python", ["-c", "import sys; print(sys.executable)"], {
        cwd: root,
        env: setupEnv,
        timeoutMs: 30_000,
      })
    ).stdout.trim();
    const codex = (
      await runWorkerCommand("which", ["codex"], { cwd: root, env: setupEnv, timeoutMs: 30_000 })
    ).stdout.trim();
    const tools: Record<string, { path: string; sha256: string }> = {};
    for (const [name, path] of [
      ["skillspector", join(installed.scannerBin, "skillspector")],
      ["aig-skill-scan", join(installed.scannerBin, "aig-skill-scan")],
      ["codex", codex],
    ]) {
      const actual = await realpath(path);
      if (!(await lstat(actual)).isFile()) throw new Error("Invalid diagnostic tool");
      tools[name] = { path: actual, sha256: hash(await readFile(actual)) };
    }
    const moduleHashes: Record<string, string> = {};
    for (const name of modules) {
      const path = join(harness, name);
      await copyFile(new URL(`./diagnostic-capture/${name}`, import.meta.url), path);
      if (name === "proxy.py") {
        const source = await readFile(path, "utf8");
        await writeFile(path, source.replace(/^#![^\n]+/, `#!${python} -I`));
        await chmod(path, 0o500);
      } else await chmod(path, 0o400);
      moduleHashes[name] = hash(await readFile(path));
    }
    for (const name of Object.keys(tools))
      await symlink(join(harness, "proxy.py"), join(harness, "bin", name));
    await writeFile(
      join(harness, "runtime.json"),
      JSON.stringify({
        source: ORIGINAL038_SOURCE,
        native: installed.binary,
        tools,
        childPath: `${installed.scannerBin}:${setupEnv.PATH}`,
        readyForReview: true,
        cases: {
          [selected.id]: { path: target, files: selected.manifest.files },
        },
      }),
      { mode: 0o400, flag: "wx" },
    );
    await writeFile(
      join(evidence, "capture-runtime.json"),
      JSON.stringify(
        {
          moduleHashes,
          tools,
          python,
          nativeSha256: hash(await readFile(installed.binary)),
          source: ORIGINAL038_SOURCE,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    let termination: WorkerCommandTermination | null = null;
    try {
      captureStarted = true;
      await runWorkerCommand(python, ["-I", join(harness, "original038.py")], {
        cwd: root,
        env: {
          ...setupEnv,
          OPENAI_API_KEY: apiKey,
          CODEX_API_KEY: process.env.CODEX_API_KEY || apiKey,
          LLM_API_KEY: apiKey,
        },
        timeoutMs: 960_000,
        cleanupProcessGroup: true,
        commandLabel: "Fixed original retained diagnostic",
        onTermination: (value) => {
          termination = value;
        },
      });
    } catch {
      /* The encrypted terminal evidence preserves failure and missing stages. */
    }
    const terminal = termination as WorkerCommandTermination | null;
    cleanupConfirmed = terminal?.processGroup === "absent";
    await writeFile(
      join(evidence, "supervisor-termination.json"),
      JSON.stringify(terminal, null, 2),
      { mode: 0o600 },
    );
    const after = await verifyDiagnosticTree(target, selected.manifest, 16 * 1024 * 1024);
    await writeFile(join(evidence, "original-verification-after.json"), JSON.stringify(after), {
      mode: 0o600,
    });
    const inventory = JSON.parse(await readFile(join(evidence, "capture-inventory.json"), "utf8"));
    captureComplete =
      inventory.captureComplete === true &&
      cleanupConfirmed &&
      terminal?.timedOut === false &&
      terminal.outputLimitExceeded === null;
    const assessment = await diagnosticArtifactMetadata(
      join(evidence, "clawscan-result.json"),
      true,
      fixture === "079" ? "fixed-original079" : undefined,
    );
    diagnosticPassed = original038DiagnosticPassed({
      captureComplete,
      termination: terminal,
      nativeExitCode: inventory.nativeResult?.exitCode,
      consumerValidation: assessment.consumerValidation,
    });
    await writeFile(
      join(evidence, "assessment.json"),
      JSON.stringify(
        {
          ...assessment,
          captureComplete,
          diagnosticPassed,
          scannerCoverageClaimedByCapture: false,
          cleanupConfirmed,
          securityGatesChanged: false,
          publicationClaimed: false,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
  } catch (error) {
    await writeFile(
      join(evidence, "setup-or-controller-failure.json"),
      JSON.stringify({
        failureClass: error instanceof Error ? error.name : "UnknownError",
        captureComplete: false,
        automaticRetryPermitted: false,
      }),
      { mode: 0o600 },
    );
  } finally {
    if (captureStarted && !cleanupConfirmed)
      throw new Error("Diagnostic process cleanup unconfirmed; no artifact may be uploaded");
    try {
      const inventory: { path: string; bytes: number; sha256: string }[] = [];
      const credentials = [
        process.env.OPENAI_API_KEY,
        process.env.CODEX_API_KEY,
        process.env.LLM_API_KEY,
      ].filter((value): value is string => Boolean(value));
      const walk = async (directory: string, prefix = "") => {
        for (const name of (await readdir(directory)).sort()) {
          const path = join(directory, name);
          const info = await lstat(path);
          if (info.isSymbolicLink()) throw new Error("Diagnostic evidence symlink refused");
          if (info.isDirectory()) await walk(path, `${prefix}${name}/`);
          else if (info.isFile()) {
            const bytes = await readFile(path);
            if (diagnosticEvidenceContainsCredential(bytes, credentials))
              throw new Error("Injected credential found in retained evidence; encryption refused");
            inventory.push({
              path: `${prefix}${name}`,
              bytes: info.size,
              sha256: hash(bytes),
            });
          } else throw new Error("Diagnostic evidence file type refused");
        }
      };
      await walk(evidence);
      const secretExclusion = Buffer.from(
        JSON.stringify(
          {
            injectedCredentialScan: "passed",
            injectedCredentialValuesPersisted: false,
            policy:
              "existing stream redaction and snapshot withholding; final retained-file credential gate",
            hostHomeOrAuthCacheCaptured: false,
          },
          null,
          2,
        ),
      );
      await writeFile(join(evidence, "secret-exclusion.json"), secretExclusion, {
        flag: "wx",
        mode: 0o600,
      });
      inventory.push({
        path: "secret-exclusion.json",
        bytes: secretExclusion.length,
        sha256: hash(secretExclusion),
      });
      await writeFile(
        join(evidence, "evidence-manifest.json"),
        JSON.stringify(
          {
            files: inventory,
            excludesOnlySelf: true,
          },
          null,
          2,
        ),
        { mode: 0o600, flag: "wx" },
      );
      await encryptDiagnosticEvidence({
        privateRoot: root,
        output,
        recipient,
        ageBinary,
        runId: envelope.runId!,
        source: ORIGINAL038_SOURCE,
        manifestSha256: selected.manifest.manifestSha256,
      });
      encrypted = true;
    } finally {
      await removeRuntime(root);
    }
    if (encrypted) {
      const receiptPath = join(output, "receipt.json");
      const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
      await writeFile(
        receiptPath,
        JSON.stringify(
          {
            ...receipt,
            runtimeRemoval: "completed",
            captureComplete,
            diagnosticPassed,
            processGroupCleanupConfirmed: cleanupConfirmed,
            scannerCoverageClaimedByCapture: false,
          },
          null,
          2,
        ),
        { mode: 0o600 },
      );
    }
    if (encrypted && process.env.GITHUB_OUTPUT)
      appendFileSync(process.env.GITHUB_OUTPUT, `encrypted-output=${output}\n`);
  }
  if (!diagnosticPassed) process.exitCode = 1;
}
