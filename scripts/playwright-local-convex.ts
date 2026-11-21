import { spawn, type ChildProcess } from "node:child_process";
import { accessSync, constants, lstatSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export type LocalConvexBootstrapResult = { status: "ready" } | { status: "error"; message: string };

if (!process.send) throw new Error("Local Convex requires its runner's IPC channel.");
const send = process.send.bind(process);

// Retain the group leader until the runner finishes killing owned descendants.
process.on("message", () => {});
let bootstrap: ChildProcess | undefined;
let backend: ChildProcess | undefined;
let stopping = false;

function signalBootstrap(signal: NodeJS.Signals) {
  if (!bootstrap?.pid) return;
  try {
    process.kill(-bootstrap.pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

function stop() {
  if (stopping) return;
  stopping = true;
  signalBootstrap("SIGTERM");
  backend?.kill("SIGTERM");
  // The runner force-kills this group after five seconds; bootstrap has its own group.
  setTimeout(() => signalBootstrap("SIGKILL"), 4_000);
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
process.on("disconnect", () => {
  stop();
  process.kill(-process.pid, "SIGTERM");
  setTimeout(() => {
    signalBootstrap("SIGKILL");
    process.kill(-process.pid, "SIGKILL");
  }, 5_000);
});

function report(result: LocalConvexBootstrapResult) {
  if (process.connected) send(result);
}

const sleep = (ms: number) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

async function probe(url: string) {
  try {
    const response = await fetch(new URL("/instance_name", url), {
      signal: AbortSignal.timeout(1_000),
    });
    return { reachable: true, name: response.ok ? await response.text() : null };
  } catch {
    return { reachable: false, name: null };
  }
}

async function main() {
  // Give bootstrap its own group so older CLIs cannot leave an orphan backend.
  bootstrap = spawn("bunx", process.argv.slice(2), { detached: true, stdio: "inherit" });
  await new Promise<void>((resolveBootstrap, reject) => {
    bootstrap!.once("error", () => reject(new Error("Local Convex bootstrap could not start.")));
    bootstrap!.once("exit", (code, signal) => {
      if (code === 0) resolveBootstrap();
      else reject(new Error(`Local Convex bootstrap exited with ${signal ?? `code ${code}`}.`));
    });
  });
  if (stopping) return;

  const stateDir = resolve(".convex/local/default");
  const config = JSON.parse(readFileSync(join(stateDir, "config.json"), "utf8")) as {
    backendVersion?: unknown;
    deploymentName?: unknown;
    instanceSecret?: unknown;
    ports?: { cloud?: unknown; site?: unknown };
  } | null;
  const version = config?.backendVersion;
  const name = config?.deploymentName;
  const secret = config?.instanceSecret;
  const cloud = config?.ports?.cloud;
  const site = config?.ports?.site;
  const url = new URL(process.env.VITE_CONVEX_URL ?? "");
  const siteUrl = new URL(process.env.VITE_CONVEX_SITE_URL ?? "");
  const isLoopback = (value: URL) =>
    value.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(value.hostname);
  if (
    typeof version !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(version) ||
    (process.env.PLAYWRIGHT_LOCAL_AUTH_BACKEND_VERSION &&
      version !== process.env.PLAYWRIGHT_LOCAL_AUTH_BACKEND_VERSION) ||
    typeof name !== "string" ||
    !/^[a-zA-Z0-9_-]+$/.test(name) ||
    typeof secret !== "string" ||
    !/^[a-fA-F0-9]{64}$/.test(secret) ||
    typeof cloud !== "number" ||
    !Number.isInteger(cloud) ||
    cloud < 1 ||
    cloud > 65_535 ||
    typeof site !== "number" ||
    !Number.isInteger(site) ||
    site < 1 ||
    site > 65_535 ||
    cloud === site ||
    !isLoopback(url) ||
    url.port !== String(cloud) ||
    !isLoopback(siteUrl) ||
    siteUrl.port !== String(site)
  ) {
    throw new Error("Local Convex bootstrap produced an invalid or mismatched configuration.");
  }
  // Convex 1.50 cleans up after --skip-push; earlier CLIs leaked the backend.
  signalBootstrap("SIGTERM");
  const stopDeadline = Date.now() + 5_000;
  while ((await probe(url.href)).reachable && Date.now() < stopDeadline) await sleep(50);
  signalBootstrap("SIGKILL");
  if ((await probe(url.href)).reachable) {
    throw new Error("Local Convex bootstrap did not release its port.");
  }
  if (stopping) return;

  const binary = join(homedir(), ".cache/convex/binaries", version, "convex-local-backend");
  if (!lstatSync(binary).isFile()) throw new Error("Local Convex backend must be a regular file.");
  accessSync(binary, constants.X_OK);
  backend = spawn(
    binary,
    [
      "--interface",
      "127.0.0.1",
      "--disable-beacon",
      "--port",
      String(cloud),
      "--site-proxy-port",
      String(site),
      "--instance-name",
      name,
      "--instance-secret",
      secret,
      "--local-storage",
      join(stateDir, "convex_local_storage"),
      join(stateDir, "convex_local_backend.sqlite3"),
    ],
    { stdio: "inherit", env: { ...process.env, SENTRY_DSN: "" } },
  );
  let failure: Error | undefined;
  let backendReady = false;
  backend.once("error", () => {
    failure = new Error("Local Convex backend could not start.");
    if (backendReady && !stopping) report({ status: "error", message: failure.message });
  });
  backend.once("exit", (code, signal) => {
    failure = new Error(`Local Convex backend exited with ${signal ?? `code ${code}`}.`);
    if (backendReady && !stopping) report({ status: "error", message: failure.message });
  });
  const deadline = Date.now() + Number(process.env.PLAYWRIGHT_WEB_SERVER_TIMEOUT_MS ?? 300_000);
  while (!stopping && Date.now() < deadline) {
    if (failure) throw failure;
    const result = await probe(url.href);
    if (failure) throw failure;
    if (result.reachable) {
      if (result.name !== name)
        throw new Error("Unexpected local Convex instance on the selected port.");
      backendReady = true;
      report({ status: "ready" });
      return;
    }
    await sleep(50);
  }
  if (!stopping) throw new Error("Local Convex backend did not become ready before the deadline.");
}

void main().catch((error: unknown) => {
  signalBootstrap("SIGKILL");
  if (!stopping) {
    report({ status: "error", message: error instanceof Error ? error.message : String(error) });
  }
});
