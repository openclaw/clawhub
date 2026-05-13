#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_BASELINE = "origin/main";
const DEFAULT_CANDIDATE = "worktree";
const DEFAULT_MODE = "before-after";
const DEFAULT_PROVIDER = "hetzner";
const DEFAULT_CLASS = "standard";
const DEFAULT_IDLE_TIMEOUT = "60m";
const DEFAULT_TTL = "120m";
const DEFAULT_VIDEO_DURATION = "60";
const DEFAULT_PORTS = {
  baseline: 4317,
  candidate: 4318,
};
const DEFAULT_PUBLIC_ENV = {
  VITE_CONVEX_SITE_URL: "https://wry-manatee-359.convex.site",
  VITE_CONVEX_URL: "https://wry-manatee-359.convex.cloud",
};

export function parseProofUiArgs(argv = []) {
  const opts = {
    baseline: DEFAULT_BASELINE,
    candidate: DEFAULT_CANDIDATE,
    dryRun: false,
    idleTimeout: DEFAULT_IDLE_TIMEOUT,
    keepLease: false,
    machineClass: DEFAULT_CLASS,
    mode: DEFAULT_MODE,
    provider: DEFAULT_PROVIDER,
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
    } else if (arg === "--candidate") {
      opts.candidate = requireValue(arg, next);
      index += 1;
    } else if (arg === "--class" || arg === "--machine-class") {
      opts.machineClass = requireValue(arg, next);
      index += 1;
    } else if (arg === "--crabbox-bin") {
      opts.crabboxBin = requireValue(arg, next);
      index += 1;
    } else if (arg === "--dry-run") {
      opts.dryRun = true;
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
    } else if (arg === "--scenario") {
      opts.scenario = requireValue(arg, next);
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
  return opts;
}

function requireValue(flag, value) {
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function timestamp(now) {
  return now().toISOString().replace(/[:.]/gu, "-");
}

export function buildProofUiPlan({ now = () => new Date(), opts, repoRoot }) {
  const outputDir = path.resolve(
    repoRoot,
    opts.outputDir ?? path.join(".artifacts", "clawhub-ui-proof", timestamp(now)),
  );
  const candidateLane = {
    name: "candidate",
    outputDir: path.join(outputDir, "candidate"),
    port: DEFAULT_PORTS.candidate,
    ref: opts.candidate,
  };
  const lanes =
    opts.mode === "feature"
      ? [candidateLane]
      : [
          {
            name: "baseline",
            outputDir: path.join(outputDir, "baseline"),
            port: DEFAULT_PORTS.baseline,
            ref: opts.baseline,
          },
          candidateLane,
        ];
  return {
    baseline: opts.baseline,
    candidate: opts.candidate,
    mode: opts.mode,
    outputDir,
    provider: opts.provider,
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
  const scenarioB64 = Buffer.from(scenarioText, "utf8").toString("base64");
  const runtimePath = path.join("scripts", "ui-proof-runtime.mjs");
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
  const envExports = Object.entries(DEFAULT_PUBLIC_ENV)
    .map(([key, value]) => `export ${key}=${shellQuote(value)}`)
    .join("\n");

  return `set -euo pipefail
export DISPLAY="\${DISPLAY:-:99}"
remote_out="$PWD/${laneRemoteDir}"
rm -rf "$remote_out"
mkdir -p "$remote_out"
echo "__CLAWHUB_UI_PROOF_REMOTE_OUTPUT__=$remote_out"
video_pid=""
cleanup_proof_processes() {
  if [ -n "$video_pid" ]; then
    kill -INT "$video_pid" >/dev/null 2>&1 || true
    wait "$video_pid" >/dev/null 2>&1 || true
    video_pid=""
  fi
  if [ -f "$remote_out/preview.pid" ]; then
    kill "$(cat "$remote_out/preview.pid")" >/dev/null 2>&1 || true
    rm -f "$remote_out/preview.pid"
  fi
  return 0
}
trap cleanup_proof_processes EXIT
scenario_file="$remote_out/scenario.mjs"
printf %s ${shellQuote(scenarioB64)} | base64 -d > "$scenario_file"
${appRootSetup}
${envExports}
export CLAWHUB_UI_PROOF_LANE=${shellQuote(lane.name)}
export BUN_INSTALL="\${BUN_INSTALL:-$HOME/.bun}"
export PATH="$BUN_INSTALL/bin:$PATH"
if ! command -v bun >/dev/null 2>&1; then
  if ! command -v unzip >/dev/null 2>&1; then
    if command -v apt-get >/dev/null 2>&1; then
      if command -v sudo >/dev/null 2>&1; then
        sudo env DEBIAN_FRONTEND=noninteractive apt-get update >/dev/null
        sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y unzip >/dev/null
      else
        DEBIAN_FRONTEND=noninteractive apt-get update >/dev/null
        DEBIAN_FRONTEND=noninteractive apt-get install -y unzip >/dev/null
      fi
    else
      echo "bun is not installed on this Crabbox image and unzip is unavailable." >&2
      exit 127
    fi
  fi
  if ! command -v curl >/dev/null 2>&1; then
    echo "bun is not installed on this Crabbox image and curl is unavailable to install it." >&2
    exit 127
  fi
  curl -fsSL https://bun.sh/install | bash
fi
export PATH="$BUN_INSTALL/bin:$PATH"
if [ ${opts.skipInstall ? "1" : "0"} -ne 1 ]; then
  bun install --frozen-lockfile
  if [ "$app_root" != "$PWD" ]; then
    (cd "$app_root" && bun install --frozen-lockfile)
  fi
  bunx playwright install chromium > "$remote_out/playwright-install.log" 2>&1
fi
(cd "$app_root" && bun run build > "$remote_out/build.log" 2>&1)
(cd "$app_root" && bun run preview -- --host 127.0.0.1 --port ${lane.port} > "$remote_out/preview.log" 2>&1 & echo $! > "$remote_out/preview.pid")
bun -e ${shellQuote(`const url = "http://127.0.0.1:${lane.port}";
const started = Date.now();
async function tick() {
  try {
    const res = await fetch(url);
    if (res.status < 500) process.exit(0);
  } catch {}
  if (Date.now() - started > 60000) {
    console.error("preview did not become ready: " + url);
    process.exit(1);
  }
  setTimeout(tick, 500);
}
tick();`)}
if command -v ffmpeg >/dev/null 2>&1; then
  display_input="$DISPLAY"
  case "$display_input" in
    *.*) ;;
    *) display_input="$display_input.0" ;;
  esac
  ffmpeg -hide_banner -loglevel error -y -f x11grab -framerate 15 -i "$display_input" -t ${shellQuote(
    opts.videoDuration,
  )} -pix_fmt yuv420p "$remote_out/full-run.mp4" > "$remote_out/ffmpeg.log" 2>&1 &
  video_pid=$!
else
  echo "ffmpeg missing; full-run.mp4 skipped" > "$remote_out/ffmpeg.log"
fi
status=0
bun ${shellQuote(runtimePath)} run-scenario \
  --scenario "$scenario_file" \
  --base-url ${shellQuote(`http://127.0.0.1:${lane.port}`)} \
  --lane ${shellQuote(lane.name)} \
  --output-dir "$remote_out" || status=$?
manifest_status=""
if [ -f "$remote_out/proof-steps.json" ]; then
  manifest_status="$(CLAWHUB_UI_PROOF_MANIFEST="$remote_out/proof-steps.json" bun -e 'const fs = require("fs"); const path = process.env.CLAWHUB_UI_PROOF_MANIFEST; process.stdout.write(JSON.parse(fs.readFileSync(path, "utf8")).status || "unknown");' 2>/dev/null || true)"
  if [ "$manifest_status" = "pass" ]; then
    status=0
  elif [ "$manifest_status" = "fail" ] && [ "$status" -eq 0 ]; then
    status=1
  fi
fi
if [ -n "$video_pid" ]; then
  kill -INT "$video_pid" >/dev/null 2>&1 || true
  wait "$video_pid" >/dev/null 2>&1 || true
  video_pid=""
fi
if [ -f "$remote_out/preview.pid" ]; then
  kill "$(cat "$remote_out/preview.pid")" >/dev/null 2>&1 || true
  rm -f "$remote_out/preview.pid"
fi
cat > "$remote_out/lane-summary.json" <<CLAWHUB_UI_PROOF_SUMMARY
{
  "lane": ${JSON.stringify(lane.name)},
  "ref": ${JSON.stringify(lane.ref)},
  "baseURL": ${JSON.stringify(`http://127.0.0.1:${lane.port}`)}
}
CLAWHUB_UI_PROOF_SUMMARY
exit "$status"
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
    `Provider: \`${summary.provider}\``,
    "",
    summary.status === "dry-run" ? "Dry run: Crabbox was not invoked." : undefined,
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

async function readLaneManifest(localOutputDir) {
  try {
    const raw = await fs.readFile(path.join(localOutputDir, "proof-steps.json"), "utf8");
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
  const status = manifest.status ?? (error ? "fail" : "pass");
  const laneError = status === "pass" ? undefined : (manifest.error ?? error);
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
