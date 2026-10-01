#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

export const CONVEX_CLI_VERSION = "1.44.0";
const BACKEND_VERSION = "precompiled-2026-08-25-7cce8fb";
// GitHub release asset digests, verified against the downloaded Mac arm64 ZIP.
const BACKENDS = {
  "darwin-arm64": [
    "aarch64-apple-darwin",
    "98831b0f511f6eed70b0b4dfca62015df57877e08017d2b2979b39d62ae7317b",
  ],
  "darwin-x64": [
    "x86_64-apple-darwin",
    "d142472d996f08907cd9fdf61cc154c36edee3039342f45fdd925cefedabea29",
  ],
  "linux-arm64": [
    "aarch64-unknown-linux-gnu",
    "a0601ec584fe9f514c473af6d57a4c209e4d2d775e4ac1b5d1b90bafd85b7e2f",
  ],
  "linux-x64": [
    "x86_64-unknown-linux-gnu",
    "470250263fcf6c71b931219550c3705d9ab03d79c3b1e1e8364465c2b44eff9f",
  ],
};

export function assertProofEnvironment(env = {}) {
  for (const key of Object.keys(env)) {
    if (
      !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key) ||
      /^(CONVEX|DEV_AUTH|VITE_CONVEX|NODE|BUN|NPM|YARN|PNPM|XDG|LD_|DYLD_|GIT_|BASH|ZSH|PYTHON|PERL|RUBY|PLAYWRIGHT|CLAWHUB_UI_PROOF|SENTRY|SSL_|CURL_|LC_)/iu.test(
        key,
      ) ||
      /^(APP_ROOT|WRAPPER_ROOT|REMOTE_OUT|HOME|PATH|USERPROFILE|LOCALAPPDATA|APPDATA|TMP|TEMP|TMPDIR|ENV|SHELL|SHELLOPTS|IFS|CDPATH|ZDOTDIR|BROWSER|DISPLAY|XAUTHORITY|HOST|PORT|SITE_URL|VITE_SITE_URL|VITE_ENABLE_DEV_AUTH|CI|LANG|LOCPATH|GCONV_PATH|GLIBC_TUNABLES|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY)$/iu.test(
        key,
      ) ||
      /(?:^|_)(TOKEN|SECRET|PASSWORD|CREDENTIALS?|API_KEY|ADMIN_KEY)(?:_|$)/iu.test(key) ||
      /_(PATH|DIR|HOME|OPTIONS|CONFIG)$/iu.test(key)
    ) {
      throw new Error(`Reserved proof --env variable: ${key}; use --dev-auth for local dev auth.`);
    }
    if (typeof env[key] !== "string" || env[key].includes("\0")) {
      throw new Error(`Invalid proof --env value for ${key}`);
    }
  }
}

async function assertCleanProofSource(root) {
  // Inspect names only: never open, source, copy, or delete operator state.
  for (const name of await fs.readdir(root)) {
    if (
      name === ".convex" ||
      name === ".env" ||
      /^\.env\.(?!example$|sample$|template$)/u.test(name)
    ) {
      throw new Error(
        `UI proof refuses existing ${name} in ${root}; use an unhydrated disposable source checkout.`,
      );
    }
  }
}

function isolatedProofEnvironment(state, inherited = {}) {
  return {
    PATH: inherited.PATH || "/usr/local/bin:/usr/bin:/bin",
    DISPLAY: inherited.DISPLAY || ":99",
    HOME: path.join(state, "home"),
    XDG_CONFIG_HOME: path.join(state, "config"),
    XDG_CACHE_HOME: path.join(state, "cache"),
    XDG_DATA_HOME: path.join(state, "data"),
    TMPDIR: path.join(state, "tmp"),
    BUN_INSTALL: path.join(state, "bun"),
    CI: "1", // Convex 1.44.0 disables CLI Sentry in CI.
    DO_NOT_TRACK: "1",
    SENTRY_DSN: "",
  };
}

export async function assertPortsFree(ports, connect = net.createConnection) {
  for (const port of ports) {
    await new Promise((resolve, reject) => {
      const socket = connect({ host: "127.0.0.1", port });
      socket.setTimeout(1000);
      socket.once("connect", () => {
        socket.destroy();
        reject(
          new Error(`Proof port ${port} is already occupied; refusing to adopt another service.`),
        );
      });
      socket.once("error", (error) => {
        socket.destroy();
        if (error.code === "ECONNREFUSED") resolve();
        else reject(new Error(`Cannot check proof port ${port}: ${error.code}`));
      });
      socket.once("timeout", () => {
        socket.destroy();
        reject(new Error(`Timed out checking proof port ${port}`));
      });
    });
  }
}

function backendArguments({ state, lane, instanceName, instanceSecret }) {
  return [
    "--interface",
    "127.0.0.1",
    "--port",
    String(lane.convexCloudPort),
    "--site-proxy-port",
    String(lane.convexSitePort),
    "--convex-origin",
    `http://127.0.0.1:${lane.convexCloudPort}`,
    "--convex-site",
    `http://127.0.0.1:${lane.convexSitePort}`,
    "--instance-name",
    instanceName,
    // This pinned backend supports the secret only via argv, not env/stdin/file.
    "--instance-secret",
    instanceSecret,
    "--disable-beacon",
    "--local-storage",
    path.join(state, "storage"),
    path.join(state, "db.sqlite3"),
  ];
}

function redactProofText(text, secrets, boundaries = false) {
  for (const secret of secrets) {
    if (!secret) continue;
    text = text.replaceAll(secret, "[REDACTED]");
    // A bounded tail or an interrupted writer can retain only part of a secret.
    if (boundaries) {
      for (let size = secret.length - 1; size > 0; size--) {
        if (text.startsWith(secret.slice(-size))) text = "[REDACTED]" + text.slice(size);
        if (text.endsWith(secret.slice(0, size))) text = text.slice(0, -size) + "[REDACTED]";
      }
    }
  }
  return text;
}

// Lane-owned children share one cancellation path and one diagnostic collection.
class LaneProcesses {
  children = [];
  secrets = [];
  controller = new AbortController();

  constructor(cwd, env, { spawnImpl = spawn, kill = process.kill, graceMs = 2000 } = {}) {
    Object.assign(this, { cwd, env, spawnImpl, kill, graceMs });
    this.cancelled = new Promise((_, reject) => {
      this.controller.signal.addEventListener(
        "abort",
        () => reject(this.controller.signal.reason),
        { once: true },
      );
    });
    this.cancelled.catch(() => {});
  }

  start(
    label,
    command,
    args,
    { artifact = "convex.log", privateOutput = false, stopSignal = "SIGTERM", ...options } = {},
  ) {
    this.controller.signal.throwIfAborted();
    const child = this.spawnImpl(command, args, {
      cwd: this.cwd,
      env: this.env,
      ...options,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const record = { child, label, artifact, privateOutput, stopSignal, stdout: "", stderr: "" };
    for (const stream of ["stdout", "stderr"])
      child[stream]?.on("data", (chunk) => {
        if (!privateOutput || stream === "stdout")
          record[stream] = (record[stream] + chunk.toString()).slice(-128 * 1024);
      });
    record.done = new Promise((resolve) => {
      child.once("exit", resolve);
      child.once("error", (error) => {
        record.spawnError = error.code || "spawn error";
        resolve();
      });
    });
    record.closed = new Promise((resolve) =>
      child.once("close", () => {
        record.stdioClosed = true;
        resolve();
      }),
    );
    this.children.push(record);
    return record;
  }

  output(record) {
    return record.privateOutput
      ? ""
      : [record.stderr, record.stdout]
          .map((text) => redactProofText(text, this.secrets, true))
          .join("");
  }

  failure(record) {
    const code = record.spawnError || record.child.signalCode || record.child.exitCode;
    return new Error(
      `${record.label} exited (${code}); ${record.privateOutput ? "private output suppressed" : this.output(record)}`,
    );
  }

  monitor(record) {
    record.done.then(() => this.controller.abort(this.failure(record)));
  }

  async run(...args) {
    const record = this.start(...args);
    try {
      await Promise.race([record.done, this.cancelled]);
      if (record.child.exitCode !== 0) throw this.failure(record);
      return record.stdout;
    } finally {
      // Preserve a command failure. Memoized release errors are collected at lane shutdown.
      await this.release(record).catch((error) => this.controller.abort(error));
    }
  }

  signal(record, value) {
    if (!record.child.pid || record.groupGone) return false;
    try {
      this.kill(-record.child.pid, value);
      return true;
    } catch (error) {
      if (error.code !== "ESRCH")
        throw new Error(
          `${record.label}: process group ${record.child.pid} ${value} failed (${error.code})`,
        );
      // Once absent, the numeric group ID may be reused. Never signal it again.
      record.groupGone = true;
      return false;
    }
  }

  release(record) {
    return (record.cleanup ??= (async () => {
      const waitForClose = () =>
        Promise.race([record.closed, delay(this.graceMs, undefined, { ref: false })]);
      // macOS may report EPERM between exit and close. Reap first, but bound inherited pipes.
      if (record.spawnError || record.child.exitCode !== null || record.child.signalCode !== null)
        await waitForClose();
      if (this.signal(record, 0)) this.signal(record, record.stopSignal);
      await waitForClose();
      if (this.signal(record, 0)) this.signal(record, "SIGKILL");
      await waitForClose();
      if (!record.stdioClosed)
        throw new Error(`${record.label}: cleanup timed out waiting for child closure`);
    })());
  }

  async stop() {
    this.controller.abort(new Error("UI proof finished"));
    const results = await Promise.allSettled(this.children.map((record) => this.release(record)));
    return results.filter((result) => result.status === "rejected").map((result) => result.reason);
  }

  async writeLogs(outputDir, errors) {
    const logs = new Map([
      ["convex.log", []],
      ["seed.log", []],
    ]);
    for (const record of this.children) {
      if (record.privateOutput) continue;
      if (!logs.has(record.artifact)) logs.set(record.artifact, []);
      logs.get(record.artifact).push(`[${record.label}]\n${this.output(record)}`);
    }
    logs.get("convex.log").push(...errors.map((error) => error.message));
    for (const [name, entries] of logs)
      await fs.writeFile(
        path.join(outputDir, name),
        redactProofText(entries.join("\n"), this.secrets),
      );
  }
}

async function waitForProofEndpoint({
  url,
  instanceName,
  signal,
  fetchImpl = fetch,
  timeoutMs = 30000,
}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    let response;
    try {
      const res = await fetchImpl(instanceName ? `${url}/instance_name` : url, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(1000)]),
        redirect: "error",
      });
      response = { status: res.status, name: instanceName ? await res.text() : undefined };
    } catch {
      signal.throwIfAborted();
    }
    if (response) {
      if (instanceName && (response.status !== 200 || response.name !== instanceName))
        throw new Error(
          `Unexpected backend identity at ${url}; refusing to adopt another service.`,
        );
      if (instanceName || response.status < 500) return;
    }
    await delay(100, undefined, { signal });
  }
  throw new Error(
    `Timed out waiting for ${instanceName ? "backend identity" : "preview"} at ${url} within ${timeoutMs}ms`,
  );
}

async function downloadProofBackend({ state, env, run, archivePath, signal }) {
  const target = BACKENDS[`${process.platform}-${process.arch}`];
  if (!target)
    throw new Error(`Unsupported UI proof backend platform: ${process.platform}-${process.arch}`);
  const [triple, digest] = target;
  const url = `https://github.com/get-convex/convex-backend/releases/download/${BACKEND_VERSION}/convex-local-backend-${triple}.zip`;
  let bytes;
  if (archivePath) bytes = await fs.readFile(archivePath);
  else {
    const response = await fetch(url, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]),
    });
    if (!response.ok) throw new Error(`Backend download failed: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (createHash("sha256").update(bytes).digest("hex") !== digest)
    throw new Error("Backend ZIP SHA-256 mismatch");
  const zip = path.join(state, "backend.zip");
  await fs.writeFile(zip, bytes, { mode: 0o600 });
  await run("backend extraction", "unzip", ["-q", zip, "-d", path.join(state, "backend")], {
    cwd: state,
    env,
  });
  const binary = path.join(state, "backend", "convex-local-backend");
  await fs.chmod(binary, 0o700);
  return binary;
}

// Shell is limited to disposable-image provisioning and the user-supplied seed hook.
const PROVISION_PROOF_TOOLS = `set -euo pipefail
if ! command -v unzip >/dev/null 2>&1; then
  if ! command -v apt-get >/dev/null 2>&1 || ! command -v timeout >/dev/null 2>&1; then
    echo "UI proof requires unzip, or apt-get and timeout to provision it." >&2
    exit 127
  fi
  provision_unzip() {
    if command -v sudo >/dev/null 2>&1; then
      sudo -n env HOME="$HOME" XDG_CONFIG_HOME="$XDG_CONFIG_HOME" XDG_CACHE_HOME="$XDG_CACHE_HOME" DEBIAN_FRONTEND=noninteractive timeout --signal=TERM --kill-after=5s 120s apt-get "$@"
    else
      DEBIAN_FRONTEND=noninteractive timeout --signal=TERM --kill-after=5s 120s apt-get "$@"
    fi
  }
  provision_unzip update
  provision_unzip install -y unzip
fi
if ! command -v bun >/dev/null 2>&1; then
  curl --connect-timeout 15 --max-time 120 -fsSL https://bun.sh/install | bash
fi`;

async function prepareProofTools({ appRoot, wrapperRoot, skipInstall }, run, checkSources) {
  await run("tool provisioning", "/bin/bash", ["-c", PROVISION_PROOF_TOOLS], { cwd: wrapperRoot });
  await checkSources();
  if (!skipInstall) {
    for (const cwd of new Set([wrapperRoot, appRoot])) {
      // --no-env-file is a runtime flag, not a prefix for Bun's install subcommand.
      await run("dependency install", "bun", ["install", "--frozen-lockfile"], { cwd });
      await checkSources();
    }
  }
  // Browser binaries belong to this fresh cache, even when dependencies already exist.
  await run(
    "browser install",
    process.execPath,
    [path.join(wrapperRoot, "node_modules/playwright/cli.js"), "install", "chromium"],
    { cwd: wrapperRoot },
  );
  await checkSources();
}

async function runUiProof(options, processes, env, fetchImpl) {
  const run = processes.run.bind(processes);
  const signal = processes.controller.signal;
  const { appRoot, wrapperRoot, outputDir, lane, scenarioText, videoDuration } = options;
  if (typeof scenarioText !== "string") throw new Error("Missing UI proof scenario");
  const scenarioFile = path.join(outputDir, "scenario.mjs");
  await fs.writeFile(scenarioFile, scenarioText);
  await run("frontend build", "bun", ["--no-env-file", "run", "build"], {
    env,
    artifact: "build.log",
  });
  const preview = processes.start(
    "Preview",
    process.execPath,
    [
      path.join(appRoot, "node_modules/vite/bin/vite.js"),
      "preview",
      "--host",
      "127.0.0.1",
      "--port",
      String(lane.port),
      "--strictPort",
    ],
    { env, artifact: "preview.log" },
  );
  processes.monitor(preview);
  await waitForProofEndpoint({ url: env.SITE_URL, signal, fetchImpl });
  if (preview.child.exitCode !== null || preview.child.signalCode !== null || preview.spawnError)
    throw processes.failure(preview);
  const display = env.DISPLAY.includes(".") ? env.DISPLAY : `${env.DISPLAY}.0`;
  const video = processes.start(
    "video",
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "x11grab",
      "-framerate",
      "15",
      "-i",
      display,
      "-t",
      videoDuration || "60",
      "-pix_fmt",
      "yuv420p",
      path.join(outputDir, "full-run.mp4"),
    ],
    { env, artifact: "ffmpeg.log", stopSignal: "SIGINT" },
  );
  video.done.then(() => {
    if (video.spawnError === "ENOENT") video.stderr = "ffmpeg missing; full-run.mp4 skipped";
  });
  await fs.writeFile(
    path.join(outputDir, "lane-summary.json"),
    `${JSON.stringify({ lane: lane.name, ref: lane.ref, baseURL: env.SITE_URL }, null, 2)}\n`,
  );
  await run(
    "UI proof",
    "bun",
    [
      "--no-env-file",
      path.join(wrapperRoot, "scripts/ui-proof-runtime.mjs"),
      "run-scenario",
      "--scenario",
      scenarioFile,
      "--base-url",
      env.SITE_URL,
      "--lane",
      lane.name,
      "--output-dir",
      outputDir,
    ],
    { cwd: wrapperRoot, env },
  );
}

export async function runProofBackend(options, io = {}) {
  const { appRoot, wrapperRoot, outputDir, lane, devAuth = false, env: featureEnv = {} } = options;
  assertProofEnvironment(featureEnv);
  const ports = [lane.convexCloudPort, lane.convexSitePort, lane.port];
  if (
    !/^(baseline|candidate)$/u.test(lane.name) ||
    ports.some((port) => !Number.isInteger(port) || port < 1024 || port > 65535) ||
    new Set(ports).size !== 3
  )
    throw new Error("UI proof requires a named lane and three distinct unprivileged ports");
  const checkSources = async () => {
    for (const root of new Set([appRoot, wrapperRoot])) await assertCleanProofSource(root);
  };
  await checkSources();
  // Never use operator TMPDIR for private credentials, storage, HOME or caches.
  const state = await fs.mkdtemp("/tmp/clawhub-ui-proof-");
  const env = isolatedProofEnvironment(state, process.env);
  env.PATH = `${path.join(state, "bun", "bin")}:${env.PATH}`;
  const processes = new LaneProcesses(appRoot, env, io);
  const run = processes.run.bind(processes);
  const { signal } = processes.controller;
  const interrupt = (name) =>
    processes.controller.abort(new Error(`UI proof interrupted (${name})`));
  const onInt = () => interrupt("SIGINT");
  const onTerm = () => interrupt("SIGTERM");
  process.on("SIGINT", onInt);
  process.on("SIGTERM", onTerm);
  const timer = setTimeout(() => interrupt("deadline"), io.timeoutMs ?? 20 * 60 * 1000);
  const errors = [];
  let result;
  try {
    await fs.chmod(state, 0o700);
    await fs.mkdir(outputDir, { recursive: true });
    const actualState = await fs.realpath(state);
    for (const root of [appRoot, wrapperRoot, outputDir]) {
      const actualRoot = await fs.realpath(root);
      if (actualState === actualRoot || actualState.startsWith(`${actualRoot}/`))
        throw new Error("Private UI proof state must be outside source and artifact directories");
    }
    for (const dir of ["home", "config", "cache", "data", "tmp", "storage"])
      await fs.mkdir(path.join(state, dir), { mode: 0o700 });
    await assertPortsFree(ports, io.connect);
    if (!options.continueWith) await prepareProofTools(options, run, checkSources);
    const cliPath = options.cliPath || path.join(wrapperRoot, "node_modules/convex/bin/main.js");
    const cliPackage = JSON.parse(
      await fs.readFile(path.resolve(path.dirname(cliPath), "../package.json"), "utf8"),
    );
    if (cliPackage.version !== CONVEX_CLI_VERSION)
      throw new Error(
        `UI proof requires Convex CLI ${CONVEX_CLI_VERSION}; installed ${cliPackage.version}`,
      );
    const binary = await (io.acquireBackend || downloadProofBackend)({
      state,
      env,
      run,
      archivePath: options.backendArchive,
      signal,
    });
    const instanceName = `ui-proof-${lane.name}-${randomBytes(12).toString("hex")}`;
    const instanceSecret = randomBytes(32).toString("hex");
    processes.secrets.push(instanceSecret);
    const adminKey = (
      await run(
        "backend key generation",
        binary,
        [
          "keygen",
          "admin-key",
          "--instance-name",
          instanceName,
          "--instance-secret",
          instanceSecret,
        ],
        { cwd: state, privateOutput: true },
      )
    ).trim();
    processes.secrets.push(adminKey);
    if (!adminKey.startsWith(`${instanceName}|`) || /\s/u.test(adminKey))
      throw new Error("Backend returned an invalid admin key");
    const url = `http://127.0.0.1:${lane.convexCloudPort}`;
    const siteUrl = `http://127.0.0.1:${lane.convexSitePort}`;
    const cliEnvFile = path.join(state, "cli.env");
    await fs.writeFile(
      cliEnvFile,
      `CONVEX_SELF_HOSTED_URL=${url}\nCONVEX_SELF_HOSTED_ADMIN_KEY=${adminKey}\n`,
      { mode: 0o600, flag: "wx" },
    );
    await assertPortsFree(ports, io.connect);
    processes.monitor(
      processes.start(
        "Convex backend",
        binary,
        backendArguments({ state, lane, instanceName, instanceSecret }),
        { cwd: state },
      ),
    );
    const checkIdentity = () =>
      waitForProofEndpoint({ url, instanceName, signal, fetchImpl: io.fetchImpl });
    const cliEnv = { ...env, NODE_PATH: path.join(wrapperRoot, "node_modules") };
    const cli = (label, args) =>
      run(label, process.execPath, [cliPath, ...args, "--env-file", cliEnvFile], { env: cliEnv });
    await checkIdentity();
    const marker = `local:${instanceName}`;
    if (devAuth) {
      await cli("dev auth", ["env", "set", "DEV_AUTH_ENABLED", "1"]);
      await cli("dev auth", ["env", "set", "DEV_AUTH_CONVEX_DEPLOYMENT", marker]);
    }
    await cli("source push", [
      "run",
      "--push",
      "--typecheck",
      "disable",
      "--codegen",
      "disable",
      "appMeta:getDeploymentInfo",
      "{}",
    ]);
    await checkIdentity();
    await checkSources();
    await cli("app readiness", ["run", "--no-push", "appMeta:getDeploymentInfo", "{}"]);
    const appEnv = {
      ...env,
      ...featureEnv,
      CONVEX_DEPLOYMENT: marker,
      CONVEX_SITE_URL: siteUrl,
      VITE_CONVEX_URL: url,
      VITE_CONVEX_SITE_URL: siteUrl,
      SITE_URL: `http://127.0.0.1:${lane.port}`,
      VITE_SITE_URL: `http://127.0.0.1:${lane.port}`,
      CLAWHUB_UI_PROOF_LANE: lane.name,
      ...(devAuth
        ? { DEV_AUTH_ENABLED: "1", DEV_AUTH_CONVEX_DEPLOYMENT: marker, VITE_ENABLE_DEV_AUTH: "1" }
        : {}),
    };
    if (options.seedCommand) {
      const seedEnv = {
        ...appEnv,
        ...cliEnv,
        CONVEX_SELF_HOSTED_URL: url,
        CONVEX_SELF_HOSTED_ADMIN_KEY: adminKey,
        CLAWHUB_UI_PROOF_CLI: cliPath,
        CLAWHUB_UI_PROOF_CLI_ENV_FILE: cliEnvFile,
      };
      delete seedEnv.CONVEX_DEPLOYMENT;
      await run("seed", "/bin/bash", ["-c", options.seedCommand], {
        env: seedEnv,
        artifact: "seed.log",
      });
      await checkSources();
    }
    if (options.continueWith)
      await Promise.race([
        options.continueWith({ env: appEnv, instanceName, signal }),
        processes.cancelled,
      ]);
    else await runUiProof(options, processes, appEnv, io.fetchImpl);
    signal.throwIfAborted();
    result = { backendVersion: BACKEND_VERSION, cliVersion: CONVEX_CLI_VERSION, instanceName };
  } catch (error) {
    errors.push(error.name === "AbortError" && signal.aborted ? signal.reason : error);
  } finally {
    clearTimeout(timer);
    errors.push(...(await processes.stop()));
    process.off("SIGINT", onInt);
    process.off("SIGTERM", onTerm);
    await fs
      .mkdir(outputDir, { recursive: true })
      .then(() => processes.writeLogs(outputDir, errors))
      .catch((error) => errors.push(error));
    await fs.rm(state, { recursive: true, force: true }).catch((error) => errors.push(error));
  }
  const failure = redactProofText(
    [...new Set(errors.map((error) => error.message))].join("\n"),
    processes.secrets,
  );
  // Completion certifies cleanup as well as the browser's separate UI manifest.
  await fs
    .writeFile(
      path.join(outputDir, "bootstrap-summary.json"),
      `${JSON.stringify({ ...result, status: failure ? "fail" : "pass", error: failure || undefined }, null, 2)}\n`,
    )
    .catch((error) => {
      throw new Error(
        redactProofText([failure, error.message].filter(Boolean).join("\n"), processes.secrets),
      );
    });
  if (failure) throw new Error(failure);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [config, appRoot, wrapperRoot, outputDir] = process.argv.slice(2);
  runProofBackend({ ...JSON.parse(config), appRoot, wrapperRoot, outputDir }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
