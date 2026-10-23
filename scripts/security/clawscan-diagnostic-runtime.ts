import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import { parse as parseYaml } from "yaml";
import { runWorkerCommand } from "../lib/runWorkerCommand";
import { attestRuntime } from "./run-clawscan-diagnostic";

const SKILLSPECTOR_REF = "95a52d89fa16f608f0b18ccee76b0918ea4b7eef";
const AIG_REF = "a5c5a72c2e5b88fc6e5b27e0c86110943c4d350b";
const LOCK_SHA256 = "86da392895db777270d9f1e2390c6956df2beaae31578235389d584fafe10adc";
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

export function validateOriginalScannerBounds(state: string, mcp: string, lockSha256: string) {
  if (
    lockSha256 !== LOCK_SHA256 ||
    !/^DEFAULT_MAX_WORKFLOW_SECONDS = 600\.0$/m.test(state) ||
    !/^TP4_MAX_FILES = 128$/m.test(mcp)
  )
    throw new Error("Production scanner bounds or lock changed");
}

export function validateOriginalProfile(raw: string) {
  const profile = parseYaml(raw)?.profiles?.clawhub;
  const defaults = profile?.scannerEnvDefaults;
  const command = profile?.judge?.command;
  if (
    JSON.stringify(profile?.scanners) !==
      JSON.stringify(["skillspector", "clawscan-static", "aig"]) ||
    defaults?.SKILLSPECTOR_PROVIDER !== "openai" ||
    defaults?.SKILLSPECTOR_MODEL !== "gpt-6.1-sol" ||
    defaults?.DEFAULT_MODEL !== "gpt-6.1-sol" ||
    defaults?.SKILLSPECTOR_REASONING_EFFORT !== "medium" ||
    defaults?.REASONING_EFFORT !== "medium" ||
    typeof command !== "string" ||
    [
      "--model gpt-6.1-sol",
      "--sandbox {{ judge_sandbox }}",
      "--ignore-user-config",
      "model_reasoning_effort=high",
      'service_tier="default"',
      "--ephemeral",
      "--json",
    ].some((control) => !command.includes(control))
  )
    throw new Error("Production ClawHub profile differs");
}

export function validateOriginalSdkInventory(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid SDK inventory");
  const inventory = value as Record<string, unknown>;
  const expected = {
    openai: "2.44.0",
    "langchain-openai": "1.3.3",
    "langchain-core": "1.4.8",
    langgraph: "1.2.6",
    httpx: "0.28.1",
  };
  if (Object.entries(expected).some(([key, version]) => inventory[key] !== version))
    throw new Error("SDK inventory differs from locked production runtime");
  return expected;
}

async function scannerTreeHash(root: string) {
  const files: { path: string; size: number; sha256: string }[] = [];
  const walk = async (directory: string, prefix: string) => {
    for (const name of (await readdir(directory)).sort()) {
      if (name === "__pycache__") continue;
      const path = join(directory, name);
      const info = await lstat(path);
      if (info.isSymbolicLink()) throw new Error("Invalid installed scanner tree");
      if (info.isDirectory()) await walk(path, `${prefix}${name}/`);
      else if (info.isFile())
        files.push({
          path: `${prefix}${name}`,
          size: info.size,
          sha256: hash(await readFile(path)),
        });
      else throw new Error("Invalid installed scanner type");
    }
  };
  await walk(join(root, "src"), "src/");
  return hash(JSON.stringify(files));
}

export async function installOriginalRuntime(
  root: string,
  pin: string,
  fullProfile: boolean,
  env: NodeJS.ProcessEnv,
) {
  const installer = join(root, "installer");
  await mkdir(installer, { mode: 0o700 });
  for (const file of [
    "install-clawscan.sh",
    "install-clawscan-scanners.sh",
    "aig-worker-requirements.txt",
  ])
    await copyFile(new URL(file, import.meta.url), join(installer, file));
  await writeFile(join(installer, "clawscan-source-commit.txt"), `${pin}\n`, { mode: 0o600 });
  const installEnv = {
    ...env,
    RUNNER_TEMP: root,
    GITHUB_ENV: join(root, "install.env"),
    GITHUB_PATH: join(root, "install.path"),
    GOTOOLCHAIN: "go1.27.3",
  };
  const run = async (command: string, args: string[], captureOutput = true) =>
    (
      await runWorkerCommand(command, args, {
        cwd: root,
        env: installEnv,
        timeoutMs: 900_000,
        cleanupProcessGroup: true,
        captureOutput,
        commandLabel: "Diagnostic runtime setup",
      })
    ).stdout.trim();
  await run("sh", [join(installer, "install-clawscan.sh")], false);
  const sourceSetting = await readFile(installEnv.GITHUB_ENV, "utf8");
  const sourceDir = /^CLAWSCAN_SOURCE_DIR=([^\r\n]+)\n$/.exec(sourceSetting)?.[1];
  if (!sourceDir || !(await realpath(sourceDir)).startsWith(`${await realpath(root)}${sep}`))
    throw new Error("Invalid private scanner installation");
  Object.assign(installEnv, { CLAWSCAN_SOURCE_DIR: sourceDir });
  await run("sh", [join(installer, "install-clawscan-scanners.sh"), "skillspector"], false);
  if (fullProfile) await run("sh", [join(installer, "install-clawscan-scanners.sh"), "aig"], false);
  const binary = join(root, "clawscan-bin/clawscan");
  const attestation = await attestRuntime("reviewed", "tiny", root, env, {
    sourceDir,
    pin,
    binary,
  });
  if (
    attestation.metadata.scannerSources.skillspector !== SKILLSPECTOR_REF ||
    attestation.metadata.scannerSources.aig !== AIG_REF
  )
    throw new Error("Unexpected upstream scanner refs");
  const entrypoint = await realpath(join(root, "clawscan-scanner-bin/skillspector"));
  if (!entrypoint.startsWith(`${await realpath(root)}${sep}`))
    throw new Error("Unexpected scanner entrypoint");
  const scannerDir = dirname(dirname(dirname(entrypoint)));
  const python = join(dirname(entrypoint), "python");
  const uvLockSha256 = hash(await readFile(join(scannerDir, "uv.lock")));
  const state = await readFile(join(scannerDir, "src/skillspector/state.py"), "utf8");
  const mcp = await readFile(
    join(scannerDir, "src/skillspector/nodes/analyzers/mcp_tool_poisoning.py"),
    "utf8",
  );
  validateOriginalScannerBounds(state, mcp, uvLockSha256);
  const profile = await readFile(join(sourceDir, "internal/profiles/clawhub/clawscan.yml"), "utf8");
  validateOriginalProfile(profile);
  const sdkInventory = validateOriginalSdkInventory(
    JSON.parse(
      await run(python, [
        "-I",
        "-c",
        "import importlib.metadata,json; print(json.dumps({name:importlib.metadata.version(name) for name in ['openai','langchain-openai','langchain-core','langgraph','httpx']}))",
      ]),
    ),
  );
  const venvPython = await run(python, ["--version"]);
  if (!/^Python 3\.12\.\d+$/.test(venvPython)) throw new Error("Invalid scanner Python");
  const skillspectorVersion = await run(python, [
    "-I",
    "-c",
    "import importlib.metadata; print(importlib.metadata.version('skillspector'))",
  ]);
  if (!/^\d+\.\d+\.\d+(?:[a-z0-9.+-]*)$/.test(skillspectorVersion))
    throw new Error("Invalid scanner version");
  const consumerRevision = await run("git", ["-C", process.cwd(), "rev-parse", "HEAD"]);
  if (!/^[a-f0-9]{40}$/.test(consumerRevision)) throw new Error("Invalid consumer source");
  const metadata = {
    ...attestation.metadata,
    judge: fullProfile ? attestation.metadata.judge : { enabled: false },
    differencesFromIncident: [
      "manual serial controls; no backend, claim, publication or production recovery samples",
      "verified original logical files; original compressed archive identity not claimed",
      "fresh private HOME/CODEX_HOME; host scanners; no Docker image used",
    ],
    runtimeImage: "N/A",
    runtimeMode: "reviewed-host-scanners-sandbox-off",
    venvPython,
    skillspectorVersion,
    consumerRevision,
    profileSha256: hash(profile),
    sdkInventory,
    uvLockSha256,
    scannerTreeSha256: await scannerTreeHash(scannerDir),
    binarySha256: hash(await readFile(binary)),
    entrypointSha256: hash(await readFile(entrypoint)),
    adapters: {
      source: pin,
      skillspectorSha256: hash(
        await readFile(
          join(sourceDir, "docker/clawscan-runtime/patches/skillspector-responses.patch"),
        ),
      ),
      aigSha256: hash(
        await readFile(join(sourceDir, "docker/clawscan-runtime/patches/aig-responses.patch")),
      ),
    },
    installerSha256: hash(await readFile(join(installer, "install-clawscan-scanners.sh"))),
    aigRequirementsSha256: hash(await readFile(join(installer, "aig-worker-requirements.txt"))),
    aggregateScannerBudgetSeconds: 600,
    mcpArtifactCountLimit: 128,
    aigInstalled: fullProfile,
  };
  return { binary, python, metadata, scannerBin: join(root, "clawscan-scanner-bin") };
}
