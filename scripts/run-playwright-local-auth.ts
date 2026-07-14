#!/usr/bin/env bun
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveLocalAuthDeployment,
  resolveLocalAuthRunnerConfig,
} from "./playwright-local-auth-config";

const DEFAULT_DEV_AUTH_CONVEX_DEPLOYMENT = "anonymous:anonymous-agent";
const DEFAULT_PLAYWRIGHT_PORT = 4173;
const DEFAULT_E2E_WORKER_TOKEN = "local-e2e-worker-token";
const DEFAULT_START_TIMEOUT_MS = 300_000;
const DEFAULT_REACHABILITY_REQUEST_TIMEOUT_MS = 5_000;
const STOP_TIMEOUT_MS = 30_000;
const FUNCTION_READY_TIMEOUT_MS = 120_000;
const POLL_MS = 500;
const LOCAL_CONVEX_STATE_DIR = ".convex/local/default";
const LOCAL_ENV_FILE = ".env.local";
const START_TIMEOUT_MS = readPositiveIntegerEnv(
  "PLAYWRIGHT_WEB_SERVER_TIMEOUT_MS",
  DEFAULT_START_TIMEOUT_MS,
);
const REACHABILITY_REQUEST_TIMEOUT_MS = readPositiveIntegerEnv(
  "PLAYWRIGHT_WEB_SERVER_REQUEST_TIMEOUT_MS",
  DEFAULT_REACHABILITY_REQUEST_TIMEOUT_MS,
);

type LocalDeploymentConfig = {
  adminKey: string;
  deploymentName: string;
};

const managedChildren = new Set<ChildProcess>();
const tempDir = mkdtempSync(join(tmpdir(), "clawhub-pw-local-auth-"));
const envFile = join(tempDir, ".env.local");
const emailCaptureFile = join(tempDir, "emails.jsonl");
const localConvexStateBackupDir = join(tempDir, "convex-local-default.backup");
const localEnvBackupFile = join(tempDir, ".env.local.backup");
let backedUpLocalConvexState = false;
let backedUpLocalEnvFile = false;
let isolatedLocalState = false;
let activeConvexUrl: string | null = null;
let activePreviewUrl: string | null = null;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readPositiveIntegerEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer number of milliseconds.`);
  }
  return value;
}

async function checkReachable(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REACHABILITY_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
    });
    return {
      detail: `HTTP ${response.status}`,
      reachable: response.status < 500,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        detail: `request timed out after ${REACHABILITY_REQUEST_TIMEOUT_MS}ms`,
        reachable: false,
      };
    }
    return {
      detail: error instanceof Error ? error.message : String(error),
      reachable: false,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function isReachable(url: string) {
  return (await checkReachable(url)).reachable;
}

async function waitUntilReachable(url: string, label: string, child?: ChildProcess) {
  const startedAt = Date.now();
  let lastDetail = "not checked";
  while (Date.now() - startedAt < START_TIMEOUT_MS) {
    const result = await checkReachable(url);
    lastDetail = result.detail;
    if (result.reachable) return;
    if (child && (child.exitCode !== null || child.signalCode !== null)) {
      throw new Error(
        `${label} exited before it became reachable at ${url} (exit=${child.exitCode ?? "null"}, signal=${child.signalCode ?? "null"}, last=${lastDetail}).`,
      );
    }
    await sleep(POLL_MS);
  }
  throw new Error(`${label} did not become reachable at ${url} (last=${lastDetail}).`);
}

async function waitUntilUnreachable(url: string, label: string) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < STOP_TIMEOUT_MS) {
    if (!(await isReachable(url))) return;
    await sleep(POLL_MS);
  }
  throw new Error(`${label} did not stop serving at ${url}.`);
}

function canListen(port: number) {
  return new Promise<boolean>((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

async function resolveAppPort() {
  const requested = Number(process.env.PLAYWRIGHT_PORT ?? DEFAULT_PLAYWRIGHT_PORT);
  if (!Number.isInteger(requested) || requested <= 0) {
    throw new Error(`Invalid PLAYWRIGHT_PORT: ${process.env.PLAYWRIGHT_PORT}`);
  }

  if (process.env.PLAYWRIGHT_PORT) {
    if (!(await canListen(requested))) {
      throw new Error(`PLAYWRIGHT_PORT ${requested} is already in use.`);
    }
    return requested;
  }

  for (let port = requested; port < requested + 50; port += 1) {
    if (await canListen(port)) return port;
  }
  throw new Error(`No available preview port found starting at ${requested}.`);
}

function buildAuthKeys() {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" });
  const publicJwk = publicKey.export({ format: "jwk" });
  return {
    JWT_PRIVATE_KEY: privatePem.trimEnd().replace(/\n/g, " "),
    JWKS: JSON.stringify({ keys: [{ use: "sig", ...publicJwk }] }),
  };
}

function readLocalDeploymentConfig(): LocalDeploymentConfig | null {
  try {
    const raw = readFileSync(".convex/local/default/config.json", "utf8");
    const parsed = JSON.parse(raw) as { adminKey?: unknown; deploymentName?: unknown };
    return typeof parsed.adminKey === "string" &&
      parsed.adminKey &&
      typeof parsed.deploymentName === "string" &&
      parsed.deploymentName
      ? { adminKey: parsed.adminKey, deploymentName: parsed.deploymentName }
      : null;
  } catch {
    return null;
  }
}

function readLocalDeployment() {
  const config = readLocalDeploymentConfig();
  if (!config) return null;
  return config.deploymentName.startsWith("anonymous-")
    ? `anonymous:${config.deploymentName}`
    : `local:${config.deploymentName}`;
}

function devAuthDeploymentMarker(deployment: string) {
  return deployment.startsWith("anonymous-") ? `anonymous:${deployment}` : deployment;
}

function getLocalUrlPort(url: string, label: string) {
  const parsed = new URL(url);
  const isLocalhost =
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "localhost" ||
    parsed.hostname === "::1" ||
    parsed.hostname === "[::1]";
  if (!isLocalhost) {
    throw new Error(`${label} must be a localhost URL for the local-auth runner: ${url}`);
  }

  const port = Number(parsed.port);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`${label} must include an explicit port: ${url}`);
  }
  return port;
}

function spawnManaged(command: string, args: string[], env: NodeJS.ProcessEnv) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    detached: process.platform !== "win32",
    env,
    stdio: "inherit",
  });
  managedChildren.add(child);
  child.once("exit", () => managedChildren.delete(child));
  return child;
}

function signalManagedChild(child: ChildProcess, signal: NodeJS.Signals) {
  if (child.exitCode !== null || child.signalCode !== null) return;

  try {
    if (process.platform !== "win32" && child.pid) {
      process.kill(-child.pid, signal);
      return;
    }
    child.kill(signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      throw error;
    }
  }
}

function waitForChildExit(child: ChildProcess, timeoutMs = 5_000) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();

  return new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function stopManagedChildren() {
  const children = Array.from(managedChildren);
  for (const child of children) signalManagedChild(child, "SIGTERM");
  await Promise.all(children.map((child) => waitForChildExit(child)));
  for (const child of children) signalManagedChild(child, "SIGKILL");
  await Promise.all(children.map((child) => waitForChildExit(child)));
}

async function stopManagedChild(child: ChildProcess) {
  signalManagedChild(child, "SIGTERM");
  await waitForChildExit(child);
  signalManagedChild(child, "SIGKILL");
  await waitForChildExit(child);
}

function isolateLocalState() {
  isolatedLocalState = true;

  if (existsSync(LOCAL_CONVEX_STATE_DIR)) {
    renameSync(LOCAL_CONVEX_STATE_DIR, localConvexStateBackupDir);
    backedUpLocalConvexState = true;
  }

  if (existsSync(LOCAL_ENV_FILE)) {
    renameSync(LOCAL_ENV_FILE, localEnvBackupFile);
    backedUpLocalEnvFile = true;
  }
}

function restoreLocalState() {
  if (!isolatedLocalState) return;

  rmSync(LOCAL_CONVEX_STATE_DIR, { force: true, recursive: true });
  if (backedUpLocalConvexState) {
    mkdirSync(".convex/local", { recursive: true });
    renameSync(localConvexStateBackupDir, LOCAL_CONVEX_STATE_DIR);
  }

  rmSync(LOCAL_ENV_FILE, { force: true });
  if (backedUpLocalEnvFile) {
    renameSync(localEnvBackupFile, LOCAL_ENV_FILE);
  }
}

async function cleanup() {
  try {
    await stopManagedChildren();
    await Promise.all([
      activePreviewUrl
        ? waitUntilUnreachable(activePreviewUrl, "Preview server")
        : Promise.resolve(),
      activeConvexUrl ? waitUntilUnreachable(activeConvexUrl, "Local Convex") : Promise.resolve(),
    ]);
  } finally {
    restoreLocalState();
    rmSync(tempDir, { force: true, recursive: true });
  }
}

function runRequired(command: string, args: string[], env: NodeJS.ProcessEnv) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? 1}.`);
  }
}

function runBuffered(command: string, args: string[], env: NodeJS.ProcessEnv) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env,
    maxBuffer: 10 * 1024 * 1024,
  });
  return {
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    status: result.status ?? 1,
  };
}

async function startLocalConvex(args: string[], env: NodeJS.ProcessEnv, convexUrl: string) {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const child = spawnManaged("bunx", args, env);
    try {
      await waitUntilReachable(convexUrl, "Local Convex", child);
      return;
    } catch (error) {
      await stopManagedChild(child);
      rmSync(LOCAL_CONVEX_STATE_DIR, { force: true, recursive: true });
      if (attempt >= maxAttempts) throw error;
      console.log(
        `Local Convex did not start cleanly on attempt ${attempt}; retrying with fresh isolated state...`,
      );
      await sleep(2_000 * attempt);
    }
  }
}

function isFunctionUnavailableOutput(output: string) {
  return (
    output.includes("Could not find function for") &&
    output.includes("Did you forget to run `npx convex dev`")
  );
}

function isLocalConvexModuleStillPreparingOutput(output: string) {
  return (
    output.includes("InvalidModules") &&
    ((output.includes("ENOENT: no such file or directory") && output.includes("/modules/")) ||
      (output.includes("Cannot find module") && output.includes("/modules/_deps/node/")))
  );
}

function isFunctionReadinessRetryableOutput(output: string) {
  return (
    isFunctionUnavailableOutput(output) ||
    isLocalConvexModuleStillPreparingOutput(output) ||
    output.includes("Function execution timed out (maximum duration: 1s)")
  );
}

async function setLocalConvexEnv(
  convexUrl: string,
  changes: Array<{ name: string; value: string }>,
) {
  const config = readLocalDeploymentConfig();
  if (!config) {
    throw new Error(
      "Local Convex config was not found at .convex/local/default/config.json after startup.",
    );
  }

  const response = await fetch(new URL("/api/update_environment_variables", convexUrl), {
    body: JSON.stringify({ changes }),
    headers: {
      Authorization: `Convex ${config.adminKey}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(
      `Failed to configure local Convex environment: ${response.status} ${await response.text()}`,
    );
  }
}

async function runConvexFunctionWhenReady(
  functionName: string,
  args: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
  options: { push?: boolean } = {},
) {
  const startedAt = Date.now();
  while (true) {
    const result = runBuffered(
      "bunx",
      [
        "convex",
        "run",
        ...(options.push ? ["--push"] : []),
        "--typecheck",
        "disable",
        "--codegen",
        "disable",
        functionName,
        JSON.stringify(args),
      ],
      env,
    );

    if (result.status === 0) {
      if (result.output) process.stdout.write(result.output);
      return;
    }

    if (
      !isFunctionReadinessRetryableOutput(result.output) ||
      Date.now() - startedAt >= FUNCTION_READY_TIMEOUT_MS
    ) {
      if (result.output) process.stdout.write(result.output);
      throw new Error(`Convex function ${functionName} failed with exit code ${result.status}.`);
    }

    console.log(`Convex function ${functionName} is not ready yet; retrying...`);
    await sleep(POLL_MS);
  }
}

async function main() {
  if (!existsSync("node_modules/.bin/vite")) {
    console.log("Installing dependencies for the Playwright local-auth e2e runner...");
    runRequired("bun", ["install", "--frozen-lockfile"], process.env);
  }

  const runnerConfig = resolveLocalAuthRunnerConfig(process.env, process.argv.slice(2));
  const appPort = await resolveAppPort();
  const appUrl = `http://127.0.0.1:${appPort}`;
  const previewReadyUrl = new URL("/robots.txt", appUrl).toString();
  const convexUrl = runnerConfig.convexUrl;
  const convexSiteUrl = runnerConfig.convexSiteUrl;
  activePreviewUrl = previewReadyUrl;
  const convexCloudPort = String(getLocalUrlPort(convexUrl, "PLAYWRIGHT_LOCAL_AUTH_CONVEX_URL"));
  const convexSitePort = String(
    getLocalUrlPort(convexSiteUrl, "PLAYWRIGHT_LOCAL_AUTH_CONVEX_SITE_URL"),
  );
  if (await isReachable(convexUrl)) {
    throw new Error(
      `Local Convex is already reachable at ${convexUrl}. Stop the running local Convex process before running this e2e so it can use isolated disposable state.`,
    );
  }

  isolateLocalState();

  const authKeys = buildAuthKeys();
  const deployment = resolveLocalAuthDeployment(
    runnerConfig.convexDeployment,
    readLocalDeployment(),
  );
  const e2eEnv: NodeJS.ProcessEnv = {
    ...process.env,
    AUTH_GITHUB_ID: process.env.AUTH_GITHUB_ID ?? "local-dev",
    AUTH_GITHUB_SECRET: process.env.AUTH_GITHUB_SECRET ?? "local-dev",
    CLAWHUB_DISABLE_CRONS: "1",
    CLAWHUB_EMAIL_CAPTURE_FILE: process.env.CLAWHUB_EMAIL_CAPTURE_FILE ?? emailCaptureFile,
    CONVEX_AGENT_MODE: process.env.CONVEX_AGENT_MODE ?? "anonymous",
    CONVEX_SITE_URL: convexSiteUrl,
    DEV_AUTH_ENABLED: "1",
    JWKS: authKeys.JWKS,
    JWT_PRIVATE_KEY: authKeys.JWT_PRIVATE_KEY,
    SECURITY_SCAN_DEFAULT_VT_WAIT_MS: "0",
    SECURITY_SCAN_WORKER_TOKEN: process.env.SECURITY_SCAN_WORKER_TOKEN ?? DEFAULT_E2E_WORKER_TOKEN,
    SITE_URL: appUrl,
    VITE_CONVEX_SITE_URL: convexSiteUrl,
    VITE_CONVEX_URL: convexUrl,
    VITE_ENABLE_DEV_AUTH: "1",
    VITE_SITE_URL: appUrl,
  };
  if (deployment) {
    e2eEnv.CONVEX_DEPLOYMENT = deployment;
    e2eEnv.DEV_AUTH_CONVEX_DEPLOYMENT = devAuthDeploymentMarker(deployment);
  }

  writeFileSync(
    envFile,
    [
      `AUTH_GITHUB_ID=${e2eEnv.AUTH_GITHUB_ID}`,
      `AUTH_GITHUB_SECRET=${e2eEnv.AUTH_GITHUB_SECRET}`,
      "CLAWHUB_DISABLE_CRONS=1",
      `CLAWHUB_EMAIL_CAPTURE_FILE=${e2eEnv.CLAWHUB_EMAIL_CAPTURE_FILE}`,
      ...(deployment ? [`CONVEX_DEPLOYMENT=${deployment}`] : []),
      `CONVEX_SITE_URL=${convexSiteUrl}`,
      ...(deployment ? [`DEV_AUTH_CONVEX_DEPLOYMENT=${devAuthDeploymentMarker(deployment)}`] : []),
      "DEV_AUTH_ENABLED=1",
      `JWKS=${authKeys.JWKS}`,
      `JWT_PRIVATE_KEY=${authKeys.JWT_PRIVATE_KEY}`,
      "SECURITY_SCAN_DEFAULT_VT_WAIT_MS=0",
      `SECURITY_SCAN_WORKER_TOKEN=${e2eEnv.SECURITY_SCAN_WORKER_TOKEN}`,
      `SITE_URL=${appUrl}`,
      `VITE_CONVEX_SITE_URL=${convexSiteUrl}`,
      `VITE_CONVEX_URL=${convexUrl}`,
      "VITE_ENABLE_DEV_AUTH=1",
      `VITE_SITE_URL=${appUrl}`,
      "",
    ].join("\n"),
  );

  console.log(`Starting local Convex at ${convexUrl} with isolated e2e state.`);
  await startLocalConvex(
    [
      "convex",
      "dev",
      "--env-file",
      envFile,
      "--typecheck",
      "disable",
      "--codegen",
      "disable",
      "--local-cloud-port",
      convexCloudPort,
      "--local-site-port",
      convexSitePort,
    ],
    e2eEnv,
    convexUrl,
  );
  activeConvexUrl = convexUrl;

  console.log("Configuring local Convex environment for local-auth Playwright e2e.");
  const localAuthDeployment =
    readLocalDeployment() ?? deployment ?? DEFAULT_DEV_AUTH_CONVEX_DEPLOYMENT;
  e2eEnv.CONVEX_DEPLOYMENT = localAuthDeployment;
  e2eEnv.DEV_AUTH_CONVEX_DEPLOYMENT = localAuthDeployment;
  await setLocalConvexEnv(convexUrl, [
    { name: "AUTH_GITHUB_ID", value: e2eEnv.AUTH_GITHUB_ID ?? "local-dev" },
    { name: "AUTH_GITHUB_SECRET", value: e2eEnv.AUTH_GITHUB_SECRET ?? "local-dev" },
    { name: "CLAWHUB_DISABLE_CRONS", value: "1" },
    { name: "CLAWHUB_EMAIL_CAPTURE_FILE", value: e2eEnv.CLAWHUB_EMAIL_CAPTURE_FILE ?? "" },
    { name: "CLAWHUB_STAGED_PREPUBLICATION_PUBLISHES", value: "1" },
    { name: "DEV_AUTH_CONVEX_DEPLOYMENT", value: localAuthDeployment },
    { name: "DEV_AUTH_ENABLED", value: "1" },
    { name: "JWKS", value: authKeys.JWKS },
    { name: "JWT_PRIVATE_KEY", value: authKeys.JWT_PRIVATE_KEY },
    { name: "SECURITY_SCAN_DEFAULT_VT_WAIT_MS", value: "0" },
    {
      name: "SECURITY_SCAN_WORKER_TOKEN",
      value: e2eEnv.SECURITY_SCAN_WORKER_TOKEN ?? DEFAULT_E2E_WORKER_TOKEN,
    },
    { name: "SITE_URL", value: appUrl },
  ]);

  console.log("Waiting for local Convex functions.");
  await runConvexFunctionWhenReady("appMeta:getDeploymentInfo", {}, e2eEnv);

  console.log("Building ClawHub for local-auth Playwright e2e.");
  runRequired("bun", ["run", "build"], e2eEnv);

  console.log(`Starting preview server at ${appUrl}.`);
  const previewProcess = spawnManaged(
    "bun",
    ["run", "preview", "--", "--host", "127.0.0.1", "--port", String(appPort)],
    e2eEnv,
  );
  await waitUntilReachable(previewReadyUrl, "Preview server", previewProcess);

  runRequired("bunx", ["playwright", "test", ...runnerConfig.playwrightArgs], {
    ...e2eEnv,
    PLAYWRIGHT_BASE_URL: appUrl,
    PLAYWRIGHT_WORKERS: "1",
  });
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void cleanup().finally(() => {
      process.exit(signal === "SIGINT" ? 130 : 143);
    });
  });
}

try {
  await main();
} finally {
  await cleanup();
}
