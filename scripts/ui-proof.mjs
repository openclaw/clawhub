#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertProofEnvironment } from "./ui-proof-backend.mjs";

const DEFAULT_BASELINE = "origin/main";
const DEFAULT_CANDIDATE = "worktree";
const DEFAULT_MODE = "before-after";
const DEFAULT_PROVIDER = "hetzner";
const DEFAULT_RUNNER = "crabbox";
const DEFAULT_CLASS = "standard";
const DEFAULT_IDLE_TIMEOUT = "60m";
const DEFAULT_TTL = "120m";
const DEFAULT_VIDEO_DURATION = "60";
const DEFAULT_PORTS = {
  baseline: {
    convexCloud: 4417,
    convexSite: 4517,
    frontend: 4317,
  },
  candidate: {
    convexCloud: 4418,
    convexSite: 4518,
    frontend: 4318,
  },
};
export function parseProofUiArgs(argv = []) {
  const opts = {
    baseline: DEFAULT_BASELINE,
    candidate: DEFAULT_CANDIDATE,
    devAuth: false,
    dryRun: false,
    env: {},
    idleTimeout: DEFAULT_IDLE_TIMEOUT,
    keepLease: false,
    machineClass: DEFAULT_CLASS,
    mode: DEFAULT_MODE,
    provider: DEFAULT_PROVIDER,
    runner: DEFAULT_RUNNER,
    scenario: "",
    skipInstall: false,
    ttl: DEFAULT_TTL,
    videoDuration: DEFAULT_VIDEO_DURATION,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--") {
      continue;
    }
    if (arg === "--baseline") {
      opts.baseline = requireValue(arg, next);
      index += 1;
    } else if (arg === "--baseline-url") {
      opts.baselineUrl = requireValue(arg, next);
      index += 1;
    } else if (arg === "--candidate") {
      opts.candidate = requireValue(arg, next);
      index += 1;
    } else if (arg === "--candidate-url") {
      opts.candidateUrl = requireValue(arg, next);
      index += 1;
    } else if (arg === "--class" || arg === "--machine-class") {
      opts.machineClass = requireValue(arg, next);
      index += 1;
    } else if (arg === "--crabbox-bin") {
      opts.crabboxBin = requireValue(arg, next);
      index += 1;
    } else if (arg === "--dry-run") {
      opts.dryRun = true;
    } else if (arg === "--dev-auth") {
      opts.devAuth = true;
    } else if (arg === "--env") {
      const [key, value] = parseEnvAssignment(requireValue(arg, next), arg);
      opts.env[key] = value;
      index += 1;
    } else if (arg.startsWith("--env=")) {
      const [key, value] = parseEnvAssignment(arg.slice("--env=".length), "--env");
      opts.env[key] = value;
    } else if (arg === "--idle-timeout") {
      opts.idleTimeout = requireValue(arg, next);
      index += 1;
    } else if (arg === "--keep-lease") {
      opts.keepLease = true;
    } else if (arg === "--lease-id") {
      opts.leaseId = requireValue(arg, next);
      index += 1;
    } else if (arg === "--mode") {
      opts.mode = requireValue(arg, next);
      index += 1;
    } else if (arg === "--output-dir") {
      opts.outputDir = requireValue(arg, next);
      index += 1;
    } else if (arg === "--provider") {
      opts.provider = requireValue(arg, next);
      index += 1;
    } else if (arg === "--runner") {
      opts.runner = requireValue(arg, next);
      index += 1;
    } else if (arg === "--scenario") {
      opts.scenario = requireValue(arg, next);
      index += 1;
    } else if (arg === "--seed-command") {
      opts.seedCommand = requireValue(arg, next);
      index += 1;
    } else if (arg === "--skip-install") {
      opts.skipInstall = true;
    } else if (arg === "--ttl") {
      opts.ttl = requireValue(arg, next);
      index += 1;
    } else if (arg === "--video-duration") {
      opts.videoDuration = requireValue(arg, next);
      index += 1;
    } else {
      throw new Error(`Unknown proof:ui argument: ${arg}`);
    }
  }
  if (!opts.scenario) {
    throw new Error("proof:ui requires --scenario <path-to-temporary-playwright-scenario>");
  }
  if (!["before-after", "feature"].includes(opts.mode)) {
    throw new Error(`Unknown proof:ui mode: ${opts.mode}`);
  }
  if (!["crabbox", "local"].includes(opts.runner)) {
    throw new Error(`Unknown proof:ui runner: ${opts.runner}`);
  }
  if (opts.runner === "local") {
    if (!opts.candidateUrl || (opts.mode === "before-after" && !opts.baselineUrl)) {
      throw new Error(
        opts.mode === "before-after"
          ? "local before-after proof requires --baseline-url and --candidate-url"
          : "local feature proof requires --candidate-url",
      );
    }
    if (opts.baselineUrl) assertLocalProofUrl(opts.baselineUrl, "--baseline-url");
    assertLocalProofUrl(opts.candidateUrl, "--candidate-url");
  }
  if (opts.runner === "crabbox") assertProofEnvironment(opts.env);
  return opts;
}

function requireValue(flag, value) {
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseEnvAssignment(raw, flag) {
  const separator = raw.indexOf("=");
  if (separator <= 0) {
    throw new Error(`${flag} requires KEY=VALUE`);
  }
  const key = raw.slice(0, separator);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) {
    throw new Error(`${flag} has invalid environment variable name: ${key}`);
  }
  return [key, raw.slice(separator + 1)];
}

function assertLocalProofUrl(raw, flag) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${flag} requires a valid URL`);
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    !["127.0.0.1", "[::1]", "localhost"].includes(parsed.hostname)
  ) {
    throw new Error(`${flag} must use localhost or a loopback address`);
  }
}

function timestamp(now) {
  return now().toISOString().replace(/[:.]/gu, "-");
}

function buildLane({ name, outputDir, ref }) {
  const ports = DEFAULT_PORTS[name];
  return {
    convexCloudPort: ports.convexCloud,
    convexSitePort: ports.convexSite,
    name,
    outputDir,
    port: ports.frontend,
    ref,
  };
}

export function buildProofUiPlan({ now = () => new Date(), opts, repoRoot }) {
  const outputDir = path.resolve(
    repoRoot,
    opts.outputDir ?? path.join(".artifacts", "clawhub-ui-proof", timestamp(now)),
  );
  const candidateLane = buildLane({
    name: "candidate",
    outputDir: path.join(outputDir, "candidate"),
    ref: opts.candidate,
  });
  candidateLane.baseURL = opts.candidateUrl;
  const lanes =
    opts.mode === "feature"
      ? [candidateLane]
      : [
          {
            ...buildLane({
              name: "baseline",
              outputDir: path.join(outputDir, "baseline"),
              ref: opts.baseline,
            }),
            baseURL: opts.baselineUrl,
          },
          candidateLane,
        ];
  return {
    baseline: opts.baseline,
    candidate: opts.candidate,
    mode: opts.mode,
    outputDir,
    provider: opts.runner === "local" ? "local" : opts.provider,
    runner: opts.runner,
    scenario: path.resolve(repoRoot, opts.scenario),
    lanes,
  };
}

async function defaultCommandRunner(command, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (options.stdio === "inherit") {
        process.stdout.write(text);
      }
    });
    child.stderr?.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (options.stdio === "inherit") {
        process.stderr.write(text);
      }
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const detail = signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`;
      const error = new Error(`${command} ${args.join(" ")} failed with ${detail}`);
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });
}

function crabboxInvocation({ opts, repoRoot }) {
  if (opts.crabboxBin) {
    return { argsPrefix: [], command: opts.crabboxBin };
  }
  return {
    argsPrefix: [path.join(repoRoot, "scripts", "crabbox-wrapper.mjs")],
    command: "node",
  };
}

function extractLeaseId(output) {
  return output.match(/\b(?:cbx_[a-f0-9]+|tbx_[A-Za-z0-9_-]+)\b/u)?.[0];
}

function extractRemoteOutputDir(output) {
  return output.match(/^__CLAWHUB_UI_PROOF_REMOTE_OUTPUT__=(.+)$/mu)?.[1]?.trim();
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

export function renderRemoteLaneScript({ lane, opts, plan, scenarioText }) {
  assertProofEnvironment(opts.env);
  const laneRemoteDir = `.artifacts/clawhub-ui-proof/remote-${path.basename(plan.outputDir)}/${lane.name}`;
  const appRootSetup =
    lane.name === "baseline"
      ? [
          `git fetch --no-tags origin "+refs/heads/main:refs/remotes/origin/main" || true`,
          `git worktree remove -f .artifacts/clawhub-ui-proof/worktrees/${lane.name} >/dev/null 2>&1 || true`,
          `rm -rf .artifacts/clawhub-ui-proof/worktrees/${lane.name}`,
          `git worktree add --detach .artifacts/clawhub-ui-proof/worktrees/${lane.name} ${shellQuote(lane.ref)}`,
          `app_root="$PWD/.artifacts/clawhub-ui-proof/worktrees/${lane.name}"`,
        ].join("\n")
      : `app_root="$PWD"`;
  const config = JSON.stringify({
    lane,
    devAuth: opts.devAuth,
    env: opts.env,
    seedCommand: opts.seedCommand,
    skipInstall: opts.skipInstall,
    videoDuration: opts.videoDuration,
    scenarioText,
  });
  return `set -euo pipefail
wrapper_root="$PWD"
remote_out="$PWD/${laneRemoteDir}"
rm -rf "$remote_out"
mkdir -p "$remote_out"
echo "__CLAWHUB_UI_PROOF_REMOTE_OUTPUT__=$remote_out"
${appRootSetup}
# Replace the wrapper: the helper owns and awaits all backend/proof process groups.
exec env -i PATH="$PATH" DISPLAY="\${DISPLAY:-:99}" node "$wrapper_root/scripts/ui-proof-backend.mjs" ${shellQuote(config)} "$app_root" "$wrapper_root" "$remote_out"
`;
}

function renderReport(summary) {
  const lines = [
    "# ClawHub UI Proof",
    "",
    `Status: ${summary.status}`,
    `Mode: \`${summary.mode}\``,
    `Scenario: \`${summary.scenario}\``,
    summary.mode === "feature"
      ? "Baseline: not run for feature proof."
      : `Baseline: \`${summary.baseline}\``,
    `Candidate: \`${summary.candidate}\``,
    `Runner: \`${summary.runner}\``,
    `Provider: \`${summary.provider}\``,
    "",
    summary.status === "dry-run" ? "Dry run: no proof runtime was invoked." : undefined,
    "## Artifacts",
    "",
  ].filter(Boolean);
  for (const lane of summary.lanes) {
    lines.push(`### ${lane.name}`, "");
    if (lane.error) {
      lines.push(`- Error: ${lane.error}`);
    }
    if (lane.localOutputDir) {
      lines.push(`- Output: \`${lane.localOutputDir}\``);
    }
    if (lane.steps?.length) {
      for (const step of lane.steps) {
        lines.push(`- ${step.status}: ${step.name} - \`${path.join(lane.name, step.screenshot)}\``);
      }
    }
    if (lane.videoPath) {
      lines.push(`- Video: \`${path.join(lane.name, path.basename(lane.videoPath))}\``);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

async function readLaneManifest(localOutputDir, name = "proof-steps.json") {
  try {
    const raw = await fs.readFile(path.join(localOutputDir, name), "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function writeSummaryAndReport({ outputDir, summary }) {
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  await fs.writeFile(path.join(outputDir, "report.md"), renderReport(summary));
}

async function inspectLease({ commandRunner, invocation, leaseId, opts, repoRoot }) {
  const result = await commandRunner(
    invocation.command,
    [...invocation.argsPrefix, "inspect", "--provider", opts.provider, "--id", leaseId, "--json"],
    { cwd: repoRoot },
  );
  return JSON.parse(result.stdout);
}

export function buildRsyncSshCommand(inspect) {
  const host = inspect.sshHost ?? inspect.host;
  const user = inspect.sshUser;
  const port = inspect.sshPort ?? "22";
  const key = inspect.sshKey;
  if (!host || !user || !key) {
    throw new Error("Crabbox inspect output is missing sshHost, sshUser, or sshKey.");
  }
  const ssh = [
    "ssh",
    "-i",
    shellQuote(key),
    "-p",
    shellQuote(port),
    "-o BatchMode=yes",
    "-o ConnectTimeout=15",
    "-o StrictHostKeyChecking=no",
    "-o UserKnownHostsFile=/dev/null",
  ].join(" ");
  return { host, ssh, user };
}

async function copyRemoteArtifacts({
  commandRunner,
  inspect,
  localOutputDir,
  remoteOutputDir,
  repoRoot,
}) {
  await fs.mkdir(localOutputDir, { recursive: true });
  const { host, ssh, user } = buildRsyncSshCommand(inspect);
  await commandRunner(
    "rsync",
    ["-az", "-e", ssh, `${user}@${host}:${remoteOutputDir}/`, `${localOutputDir}/`],
    { cwd: repoRoot, stdio: "inherit" },
  );
}

async function runCrabboxCommand({ args, commandRunner, invocation, repoRoot }) {
  return await commandRunner(invocation.command, [...invocation.argsPrefix, ...args], {
    cwd: repoRoot,
    stdio: "inherit",
  });
}

async function warmupLease({ commandRunner, invocation, opts, repoRoot }) {
  if (opts.leaseId) {
    return { created: false, leaseId: opts.leaseId };
  }
  const result = await runCrabboxCommand({
    args: [
      "warmup",
      "--provider",
      opts.provider,
      "--desktop",
      "--browser",
      "--class",
      opts.machineClass,
      "--idle-timeout",
      opts.idleTimeout,
      "--ttl",
      opts.ttl,
    ],
    commandRunner,
    invocation,
    repoRoot,
  });
  const leaseId = extractLeaseId(`${result.stdout}\n${result.stderr}`);
  if (!leaseId) {
    throw new Error("Crabbox warmup did not print a lease id.");
  }
  return { created: true, leaseId };
}

async function runLane({
  commandRunner,
  invocation,
  lane,
  leaseId,
  opts,
  plan,
  repoRoot,
  scenarioText,
}) {
  const remoteScript = renderRemoteLaneScript({ lane, opts, plan, scenarioText });
  let result;
  let error;
  try {
    result = await runCrabboxCommand({
      args: [
        "run",
        "--provider",
        opts.provider,
        "--id",
        leaseId,
        "--keep",
        "--desktop",
        "--browser",
        "--shell",
        "--",
        remoteScript,
      ],
      commandRunner,
      invocation,
      repoRoot,
    });
  } catch (caught) {
    result = { stderr: caught.stderr ?? "", stdout: caught.stdout ?? "" };
    error = caught instanceof Error ? caught.message : String(caught);
  }
  const remoteOutputDir = extractRemoteOutputDir(`${result.stdout}\n${result.stderr}`);
  if (!remoteOutputDir) {
    throw new Error(`Could not find remote output marker for ${lane.name}. ${error ?? ""}`.trim());
  }
  const inspected = await inspectLease({ commandRunner, invocation, leaseId, opts, repoRoot });
  await copyRemoteArtifacts({
    commandRunner,
    inspect: inspected,
    localOutputDir: lane.outputDir,
    remoteOutputDir,
    repoRoot,
  });
  const manifest = await readLaneManifest(lane.outputDir);
  const bootstrap = await readLaneManifest(lane.outputDir, "bootstrap-summary.json");
  const status = manifest.status === "pass" && bootstrap.status === "pass" ? "pass" : "fail";
  const bootstrapError =
    bootstrap.status === "pass"
      ? undefined
      : (bootstrap.error ?? "Backend bootstrap did not write a successful completion manifest.");
  const laneError =
    status === "pass"
      ? undefined
      : (manifest.error ??
        bootstrapError ??
        error ??
        "UI proof did not write a passing result manifest.");
  return {
    error: laneError,
    localOutputDir: lane.outputDir,
    name: lane.name,
    ref: lane.ref,
    remoteOutputDir,
    status,
    steps: manifest.steps ?? [],
    videoPath: existsSync(path.join(lane.outputDir, "full-run.mp4"))
      ? path.join(lane.outputDir, "full-run.mp4")
      : undefined,
  };
}

async function stopLease({ commandRunner, invocation, leaseId, opts, repoRoot }) {
  await runCrabboxCommand({
    args: ["stop", "--provider", opts.provider, leaseId],
    commandRunner,
    invocation,
    repoRoot,
  }).catch((error) => {
    console.error(`warning: failed to stop Crabbox lease ${leaseId}: ${error.message}`);
  });
}

async function runLocalLane({ commandRunner, lane, plan, repoRoot }) {
  let error;
  await fs.mkdir(lane.outputDir, { recursive: true });
  try {
    await commandRunner(
      "bun",
      [
        path.join(repoRoot, "scripts", "ui-proof-runtime.mjs"),
        "run-scenario",
        "--scenario",
        plan.scenario,
        "--base-url",
        lane.baseURL,
        "--lane",
        lane.name,
        "--output-dir",
        lane.outputDir,
      ],
      { cwd: repoRoot, stdio: "inherit" },
    );
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }
  const manifest = await readLaneManifest(lane.outputDir);
  const status = manifest.status ?? "fail";
  const laneError =
    status === "pass"
      ? undefined
      : (manifest.error ?? error ?? "Local Playwright proof did not write a result manifest.");
  return {
    error: laneError,
    localOutputDir: lane.outputDir,
    name: lane.name,
    ref: lane.ref,
    status,
    steps: manifest.steps ?? [],
  };
}

export async function runProofUi({
  args = process.argv.slice(2),
  commandRunner = defaultCommandRunner,
  now = () => new Date(),
  repoRoot = process.cwd(),
} = {}) {
  const opts = parseProofUiArgs(args);
  const plan = buildProofUiPlan({ now, opts, repoRoot });
  const scenarioText = await fs.readFile(plan.scenario, "utf8");
  const summary = {
    baseline: plan.baseline,
    candidate: plan.candidate,
    generatedAt: now().toISOString(),
    lanes: plan.lanes.map((lane) => ({
      localOutputDir: lane.outputDir,
      name: lane.name,
      ref: lane.ref,
      status: opts.dryRun ? "planned" : "pending",
    })),
    mode: plan.mode,
    outputDir: plan.outputDir,
    provider: plan.provider,
    runner: plan.runner,
    scenario: plan.scenario,
    status: opts.dryRun ? "dry-run" : "pending",
  };
  if (opts.dryRun) {
    await writeSummaryAndReport({ outputDir: plan.outputDir, summary });
    return {
      outputDir: plan.outputDir,
      status: "dry-run",
      summaryPath: path.join(plan.outputDir, "summary.json"),
    };
  }

  if (opts.runner === "local") {
    const lanes = [];
    for (const lane of plan.lanes) {
      lanes.push(await runLocalLane({ commandRunner, lane, plan, repoRoot }));
    }
    summary.lanes = lanes;
    summary.status = lanes.every((lane) => lane.status === "pass") ? "pass" : "fail";
    await writeSummaryAndReport({ outputDir: plan.outputDir, summary });
    return {
      outputDir: plan.outputDir,
      status: summary.status,
      summaryPath: path.join(plan.outputDir, "summary.json"),
    };
  }

  const invocation = crabboxInvocation({ opts, repoRoot });
  const { created, leaseId } = await warmupLease({ commandRunner, invocation, opts, repoRoot });
  summary.crabbox = { createdLease: created, leaseId };
  try {
    const lanes = [];
    for (const lane of plan.lanes) {
      lanes.push(
        await runLane({
          commandRunner,
          invocation,
          lane,
          leaseId,
          opts,
          plan,
          repoRoot,
          scenarioText,
        }),
      );
    }
    summary.lanes = lanes;
    summary.status = lanes.every((lane) => lane.status === "pass") ? "pass" : "fail";
  } finally {
    if (!opts.keepLease && created) {
      await stopLease({ commandRunner, invocation, leaseId, opts, repoRoot });
    }
  }
  await writeSummaryAndReport({ outputDir: plan.outputDir, summary });
  return {
    outputDir: plan.outputDir,
    status: summary.status,
    summaryPath: path.join(plan.outputDir, "summary.json"),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runProofUi()
    .then((result) => {
      console.log(`ClawHub UI proof ${result.status}: ${result.outputDir}`);
      if (result.status === "fail") {
        process.exitCode = 1;
      }
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.stack || error.message : String(error));
      process.exitCode = 1;
    });
}
