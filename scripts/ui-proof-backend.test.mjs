/* @vitest-environment node */
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { assertProofEnvironment, runProofBackend } from "./ui-proof-backend.mjs";

const temporary = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of temporary.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

function fakeChild(pid) {
  const child = Object.assign(new EventEmitter(), {
    pid,
    exitCode: null,
    signalCode: null,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
  });
  child.exit = (code) => {
    child.exitCode = code;
    child.emit("exit", code);
  };
  child.close = () => {
    child.stdioClosed = true;
    child.emit("close");
  };
  return child;
}

function fakeSocket(occupied = false) {
  const socket = new EventEmitter();
  socket.destroy = () => {};
  socket.setTimeout = () => {};
  queueMicrotask(() => socket.emit(occupied ? "connect" : "error", { code: "ECONNREFUSED" }));
  return socket;
}

async function fixture(onSpawn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "clawhub-proof-test-"));
  temporary.push(root);
  const appRoot = path.join(root, "app");
  const wrapperRoot = path.join(root, "wrapper");
  await fs.mkdir(appRoot);
  const packageRoot = path.join(wrapperRoot, "node_modules/convex");
  await fs.mkdir(packageRoot, { recursive: true });
  await fs.writeFile(path.join(packageRoot, "package.json"), '{"version":"1.44.0"}');
  const options = {
    appRoot,
    wrapperRoot,
    outputDir: path.join(root, "artifacts"),
    lane: { name: "baseline", convexCloudPort: 4417, convexSitePort: 4517, port: 4317 },
    continueWith: vi.fn(),
  };
  const jobs = [];
  let instanceName;
  const io = {
    graceMs: 10,
    acquireBackend: vi.fn(async () => "/owned/backend"),
    connect: vi.fn(() => fakeSocket()),
    fetchImpl: vi.fn(async () => ({ status: 200, text: async () => instanceName })),
    spawnImpl(command, args, settings) {
      const child = fakeChild(900 + jobs.length);
      const job = { child, command, args, settings };
      jobs.push(job);
      Promise.resolve()
        .then(async () => {
          if (args[0] === "keygen") {
            instanceName = args[args.indexOf("--instance-name") + 1];
            child.stdout.emit("data", `${instanceName}|private-key\n`);
            child.stderr.emit("data", "unregistered-keygen-diagnostic");
          }
          await onSpawn?.(job);
          if (args.includes("--interface") || args.includes("preview") || command === "ffmpeg")
            return;
          if (child.exitCode === null) {
            child.exit(0);
            child.close();
          }
        })
        .catch((error) => {
          child.stderr.emit("data", `${error.message}\n`);
          child.exit(1);
          child.close();
        });
      return child;
    },
    kill: vi.fn((pid, signal) => {
      const child = jobs.find((job) => job.child.pid === -pid).child;
      if (child.stdioClosed) throw Object.assign(new Error("absent"), { code: "ESRCH" });
      if (signal !== 0) {
        child.exit(0);
        child.close();
      }
    }),
  };
  async function run(overrides = {}) {
    const firstJob = jobs.length;
    const counts = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
    const result = await runProofBackend({ ...options, ...overrides }, io).catch((error) => error);
    const completion = JSON.parse(
      await fs.readFile(path.join(options.outputDir, "bootstrap-summary.json"), "utf8"),
    );
    expect(completion.status).toBe(result instanceof Error ? "fail" : "pass");
    expect([process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")]).toEqual(counts);
    if (jobs[firstJob])
      await expect(fs.stat(path.dirname(jobs[firstJob].settings.env.HOME))).rejects.toMatchObject({
        code: "ENOENT",
      });
    if (result instanceof Error) {
      expect(completion.error).toBe(result.message);
      throw result;
    }
    return result;
  }
  return { options, io, jobs, run };
}

it("rejects connection, credential, process and private-state overrides while allowing feature flags", () => {
  for (const key of [
    "CONVEX_DEPLOYMENT",
    "CONVEX_SELF_HOSTED_ADMIN_KEY",
    "VITE_CONVEX_URL",
    "HOME",
    "XDG_CACHE_HOME",
    "PATH",
    "NODE_OPTIONS",
    "BASH_ENV",
    "LD_PRELOAD",
    "HTTPS_PROXY",
    "DEV_AUTH_ENABLED",
    "VITE_ENABLE_DEV_AUTH",
  ])
    expect(() => assertProofEnvironment({ [key]: "unsafe" })).toThrow("Reserved proof --env");
  expect(() => assertProofEnvironment({ FEATURE_FLAG: "1" })).not.toThrow();
});

it.each([".convex", ".env", ".env.local", ".env.production"])(
  "refuses remote %s by name without reading or removing it",
  async (name) => {
    const proof = await fixture();
    const file = path.join(proof.options.appRoot, name);
    await fs.symlink("/unreadable/operator-state", file);
    await expect(runProofBackend(proof.options, proof.io)).rejects.toThrow(`existing ${name}`);
    expect(proof.jobs).toHaveLength(0);
    expect(await fs.readlink(file)).toBe("/unreadable/operator-state");
  },
);

it("uses a private selection file and exact non-configuring push before the separate readiness query", async () => {
  let selection;
  const proof = await fixture(async ({ args, settings }) => {
    if (!args.includes("--push")) return;
    const file = args.at(-1);
    selection = { file, text: await fs.readFile(file, "utf8") };
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    expect((await fs.stat(path.dirname(file))).mode & 0o777).toBe(0o700);
    expect(settings.cwd).toBe(proof.options.appRoot);
    expect(settings.env).not.toHaveProperty("CONVEX_DEPLOYMENT");
    expect(settings.env).not.toHaveProperty("CONVEX_SELF_HOSTED_ADMIN_KEY");
  });
  const result = await proof.run();
  const push = proof.jobs.find((job) => job.args.includes("--push"));
  expect(push.command).toBe(process.execPath);
  expect(push.args).toEqual([
    path.join(proof.options.wrapperRoot, "node_modules/convex/bin/main.js"),
    "run",
    "--push",
    "--typecheck",
    "disable",
    "--codegen",
    "disable",
    "appMeta:getDeploymentInfo",
    "{}",
    "--env-file",
    selection.file,
  ]);
  expect(selection.text).toBe(
    `CONVEX_SELF_HOSTED_URL=http://127.0.0.1:4417\nCONVEX_SELF_HOSTED_ADMIN_KEY=${result.instanceName}|private-key\n`,
  );
  expect(proof.jobs.at(-1).args.slice(1, 5)).toEqual([
    "run",
    "--no-push",
    "appMeta:getDeploymentInfo",
    "{}",
  ]);
  expect(proof.io.fetchImpl).toHaveBeenCalledTimes(2);
  const backend = proof.jobs.find((job) => job.args.includes("--interface"));
  expect(backend.args.slice(0, 6)).toEqual([
    "--interface",
    "127.0.0.1",
    "--port",
    "4417",
    "--site-proxy-port",
    "4517",
  ]);
  expect(backend.args).toContain("--disable-beacon");
  expect(proof.io.connect.mock.calls.map(([address]) => address)).toEqual(
    [4417, 4517, 4317, 4417, 4517, 4317].map((port) => ({ host: "127.0.0.1", port })),
  );
});

it("creates fresh identity/state each run and enables backend and frontend dev auth only by opt-in", async () => {
  const identities = new Set();
  const homes = new Set();
  for (const devAuth of [false, true, false]) {
    const proof = await fixture();
    const result = await proof.run({ devAuth });
    identities.add(result.instanceName);
    const { env } = proof.options.continueWith.mock.calls[0][0];
    homes.add(env.HOME);
    expect(env).not.toHaveProperty("CONVEX_SELF_HOSTED_ADMIN_KEY");
    expect(env.VITE_ENABLE_DEV_AUTH).toBe(devAuth ? "1" : undefined);
    expect(env.CI).toBe("1");
    expect(
      proof.jobs.filter((job) => job.args[1] === "env").map((job) => job.args.slice(2, 5)),
    ).toEqual(
      devAuth
        ? [
            ["set", "DEV_AUTH_ENABLED", "1"],
            ["set", "DEV_AUTH_CONVEX_DEPLOYMENT", `local:${result.instanceName}`],
          ]
        : [],
    );
  }
  expect(identities.size).toBe(3);
  expect(homes.size).toBe(3);
});

it.each(["preparation", "push", "seed"])(
  "rejects source state created by %s before continuation",
  async (phase) => {
    const proof = await fixture(async ({ command, args, settings }) => {
      if (
        (phase === "preparation" && command === "/bin/bash") ||
        (phase === "push" && args.includes("--push")) ||
        (phase === "seed" && args[1] === "seed-fixture")
      )
        await fs.writeFile(path.join(settings.cwd, ".env.local"), "FEATURE_FLAG=untrusted");
    });
    await expect(
      proof.run({
        continueWith: phase === "preparation" ? undefined : proof.options.continueWith,
        skipInstall: true,
        seedCommand: "seed-fixture",
      }),
    ).rejects.toThrow("existing .env.local");
    expect(proof.options.continueWith).not.toHaveBeenCalled();
  },
);

it.each(["keygen", "--push", "--no-push"])(
  "stops on %s failure with private diagnostics",
  async (argument) => {
    const proof = await fixture(({ args }) => {
      if (args.includes(argument)) throw new Error("failure private-key");
    });
    await expect(proof.run()).rejects.toThrow(
      argument === "keygen" ? "private output suppressed" : "exited (1)",
    );
    expect(proof.options.continueWith).not.toHaveBeenCalled();
    expect(
      await fs.readFile(path.join(proof.options.outputDir, "convex.log"), "utf8"),
    ).not.toContain("unregistered-keygen-diagnostic");
  },
);

it.each(["occupied", "identity", "version", "archive"])(
  "rejects %s before source continuation",
  async (kind) => {
    const proof = await fixture();
    if (kind === "occupied") proof.io.connect = () => fakeSocket(true);
    if (kind === "identity")
      proof.io.fetchImpl = async () => ({ status: 200, text: async () => "other-instance" });
    if (kind === "version")
      await fs.writeFile(
        path.join(proof.options.wrapperRoot, "node_modules/convex/package.json"),
        '{"version":"1.43.0"}',
      );
    if (kind === "archive") {
      proof.options.backendArchive = path.join(proof.options.appRoot, "backend.zip");
      await fs.writeFile(proof.options.backendArchive, "unverified archive");
      delete proof.io.acquireBackend;
    }
    await expect(proof.run()).rejects.toThrow(
      {
        occupied: "occupied",
        identity: "Unexpected backend identity",
        version: "installed 1.43.0",
        archive: "SHA-256 mismatch",
      }[kind],
    );
    expect(proof.options.continueWith).not.toHaveBeenCalled();
  },
);

it.each(["exit", "deadline", "SIGINT", "SIGTERM"])(
  "cancels pending readiness on %s and tears down",
  async (cause) => {
    const proof = await fixture();
    if (cause === "deadline") proof.io.timeoutMs = 30;
    proof.io.fetchImpl = async (_url, { signal }) => {
      const pending = new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
      );
      if (cause === "exit") {
        proof.jobs.at(-1).child.exit(9);
        proof.jobs.at(-1).child.close();
      } else if (cause !== "deadline") process.emit(cause);
      return pending;
    };
    await expect(proof.run()).rejects.toThrow(
      cause === "exit" ? "Convex backend exited (9)" : cause,
    );
    expect(proof.options.continueWith).not.toHaveBeenCalled();
  },
);

it.each([0, "SIGTERM"])(
  "stops signaling a denied record at %s but cleans others and preserves the primary failure",
  async (deniedSignal) => {
    const proof = await fixture(({ args }) => {
      if (args.includes("--push")) throw new Error("source failed");
    });
    const kill = proof.io.kill;
    proof.io.kill = vi.fn((pid, signal) => {
      const job = proof.jobs.find((job) => job.child.pid === -pid);
      if (job.args.includes("--push") && signal === deniedSignal)
        throw Object.assign(new Error("denied"), { code: "EPERM" });
      if (job.args.includes("--push")) return;
      return kill(pid, signal);
    });
    await expect(proof.run()).rejects.toThrow(
      /source push exited.*source failed\n+source push: process group .*EPERM/u,
    );
    const backend = proof.jobs.find((job) => job.args.includes("--interface"));
    expect(backend.child.stdioClosed).toBe(true);
    const push = proof.jobs.find((job) => job.args.includes("--push"));
    expect(
      proof.io.kill.mock.calls
        .filter(([pid]) => pid === -push.child.pid)
        .map(([, signal]) => signal),
    ).toEqual(deniedSignal === 0 ? [0] : [0, "SIGTERM"]);
  },
);

it("waits for exit-before-close and never probes an ESRCH group twice", async () => {
  const proof = await fixture(({ args, child }) => {
    if (args.includes("--push")) {
      child.exit(0);
      setImmediate(() => child.close());
    }
  });
  const kill = proof.io.kill;
  proof.io.kill = vi.fn((pid, signal) => {
    const job = proof.jobs.find((job) => job.child.pid === -pid);
    if (job.args.includes("--push")) expect(job.child.stdioClosed).toBe(true);
    return kill(pid, signal);
  });
  await proof.run();
  const push = proof.jobs.find((job) => job.args.includes("--push"));
  expect(proof.io.kill.mock.calls.filter(([pid]) => pid === -push.child.pid)).toEqual([
    [-push.child.pid, 0],
  ]);
});

it("bounds public tails, redacts split/truncated secrets and removes state even when log writing fails", async () => {
  let secret;
  const proof = await fixture(({ args, child }) => {
    if (args[0] === "keygen") secret = args.at(-1);
    if (args.includes("--push")) {
      child.stdout.emit("data", secret.slice(0, 20));
      child.stdout.emit("data", secret.slice(20) + "!");
      child.stdout.emit("data", "x".repeat(128 * 1024 - 8));
      child.stderr.emit("data", "\n" + secret.slice(0, 10));
    }
  });
  await proof.run();
  const log = await fs.readFile(path.join(proof.options.outputDir, "convex.log"), "utf8");
  expect(log.length).toBeLessThan(129 * 1024);
  expect(log).not.toContain(secret.slice(-7));
  expect(log).not.toContain(secret.slice(0, 10));
  const writeFile = fs.writeFile;
  vi.spyOn(fs, "writeFile").mockImplementation((file, ...args) => {
    if (file.endsWith("convex.log")) throw new Error("log write denied");
    return writeFile(file, ...args);
  });
  await expect(proof.run()).rejects.toThrow("log write denied");
});

it("keeps build/browser credential-free, uses direct lane/wrapper paths and finalizes video with INT", async () => {
  const proof = await fixture(async ({ args, settings }) => {
    if (args.includes("run-scenario")) {
      expect(settings.cwd).toBe(proof.options.wrapperRoot);
      await fs.writeFile(
        path.join(proof.options.outputDir, "proof-steps.json"),
        '{"status":"pass"}',
      );
    }
  });
  await proof.run({
    continueWith: undefined,
    scenarioText: "export default async () => {}",
    skipInstall: false,
    seedCommand: "seed-fixture",
  });
  const build = proof.jobs.find((job) => job.args.includes("build"));
  expect([build.command, build.args, build.settings.cwd]).toEqual([
    "bun",
    ["--no-env-file", "run", "build"],
    proof.options.appRoot,
  ]);
  for (const job of proof.jobs)
    expect(job.settings.env.CONVEX_SELF_HOSTED_ADMIN_KEY).toEqual(
      job.args[1] === "seed-fixture" ? expect.stringContaining("|private-key") : undefined,
    );
  const installs = proof.jobs.filter((job) => job.args.includes("--frozen-lockfile"));
  expect(installs.map((job) => job.args)).toEqual([
    ["install", "--frozen-lockfile"],
    ["install", "--frozen-lockfile"],
  ]);
  const video = proof.jobs.find((job) => job.command === "ffmpeg");
  expect(proof.io.kill.mock.calls).toContainEqual([-video.child.pid, "SIGINT"]);
});

it("installs browsers in the fresh private cache when dependency installation is skipped", async () => {
  const proof = await fixture();
  await proof.run({
    continueWith: undefined,
    scenarioText: "export default async () => {}",
    skipInstall: true,
  });
  expect(proof.jobs.some((job) => job.args.includes("--frozen-lockfile"))).toBe(false);
  const browserInstall = proof.jobs.find((job) => job.args.includes("chromium"));
  expect(browserInstall.args).toEqual([
    path.join(proof.options.wrapperRoot, "node_modules/playwright/cli.js"),
    "install",
    "chromium",
  ]);
  expect(browserInstall.settings.env.XDG_CACHE_HOME).toBe(
    path.join(path.dirname(browserInstall.settings.env.HOME), "cache"),
  );
});

it("reaps a real process tree whose leader exits while a grandchild holds pipes (no listeners)", async () => {
  const proof = await fixture();
  const spawnImpl = proof.io.spawnImpl;
  const kill = proof.io.kill;
  let backend;
  proof.io.spawnImpl = (command, args, settings) => {
    if (!args.includes("--interface")) return spawnImpl(command, args, settings);
    backend = spawn(
      process.execPath,
      [
        "-e",
        `
      require('node:child_process').spawn(process.execPath, ['-e', 'process.on("SIGTERM",()=>{}); setInterval(()=>{},1000)'], {stdio:'inherit'});
      setTimeout(()=>process.exit(7),100);
    `,
      ],
      settings,
    );
    return backend;
  };
  proof.io.kill = (pid, signal) =>
    pid === -backend?.pid ? process.kill(pid, signal) : kill(pid, signal);
  proof.io.fetchImpl = (_url, { signal }) =>
    new Promise((_, reject) =>
      signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
    );
  await expect(proof.run()).rejects.toThrow("Convex backend exited (7)");
  // Cleanup resolves on stdio closure, but the SIGKILLed grandchild stays a zombie (still a
  // group member) until init reaps it, so the group can outlive run() by a few milliseconds.
  await vi.waitFor(() => expect(() => process.kill(-backend.pid, 0)).toThrow(/ESRCH/), {
    timeout: 2000,
    interval: 10,
  });
});
