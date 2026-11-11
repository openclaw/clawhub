/// <reference types="vite/client" />
/* @vitest-environment node */

// Authority-chain proof for post-acceptance Plugin Inspector monitoring.
//
// Real (in this disposable convex-test backend): the HTTP publish route,
// prepublication check claim/completion, scheduled finalization, the scheduled
// release-scan dispatcher and its retry, eligibility queries, the protected
// artifact route and its storage reads, and the monitoring worker script.
//
// Simulated external boundary (task-only fixtures, never the network):
// GitHub's App token endpoint and repository_dispatch API, and the GitHub
// Actions runner, which is replaced by evaluating the real workflow's step
// expressions against the dispatched event. The App key is generated per run.
//
// Set CLAWHUB_PLUGIN_INSPECTOR_CHAIN_PROOF=1 to run the full monitoring worker
// (`node scripts/package-inspector-nightly-scan.ts`, real Plugin Inspector and
// its public npm OpenClaw target) against this backend over a loopback bridge.
// Without it, the worker's own lookup and artifact-download code runs in-process.
import { spawn } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { gzipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadWorkflow } from "../src/__tests__/helpers/githubWorkflowExpression";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { sha256Hex } from "./lib/clawpack";
import { PLUGIN_INSPECTOR_RELEASE_SCAN_EVENT } from "./lib/pluginInspectorReleaseScan";
import { hashToken } from "./lib/tokens";
import schema from "./schema";

vi.mock("./lib/verifiedClientIp", () => ({ getVerifiedClientIp: async () => "203.0.113.1" }));
const modules = import.meta.glob("./**/*.ts");

const SITE = "http://clawhub-chain-proof.invalid";
const WORKER_TOKEN = "chain-proof-inspector-worker";
const CHECKS_TOKEN = "chain-proof-prepublication-worker";
const API_TOKEN = "clh_chain_proof_publisher";
const FULL_WORKER = process.env.CLAWHUB_PLUGIN_INSPECTOR_CHAIN_PROOF === "1";
const WORKFLOW = loadWorkflow(
  readFileSync(path.resolve(".github/workflows/plugin-inspector-bulk-scan.yml"), "utf8"),
);
const SCAN_STEP = "Run plugin inspector bulk scan";

type ProofEvent = Record<string, unknown> & { step: string };
const proofLog: ProofEvent[] = [];
function record(step: string, detail: Record<string, unknown> = {}) {
  proofLog.push({ step, ...detail });
  console.log(`[chain-proof] ${step} ${JSON.stringify(detail)}`);
}

// ---------------------------------------------------------------- fixtures

const TAR_BLOCK = 512;
function tarFile(name: string, content: string) {
  const bytes = new TextEncoder().encode(content);
  const header = new Uint8Array(TAR_BLOCK);
  const put = (offset: number, value: string) =>
    header.set(new TextEncoder().encode(value), offset);
  const octal = (value: number, width: number) => value.toString(8).padStart(width - 1, "0") + "\0";
  put(0, name);
  put(100, octal(0o644, 8));
  put(108, octal(0, 8));
  put(116, octal(0, 8));
  put(124, octal(bytes.byteLength, 12));
  put(136, octal(0, 12));
  header.fill(0x20, 148, 156);
  header[156] = "0".charCodeAt(0);
  put(257, "ustar");
  put(263, "00");
  let checksum = 0;
  for (const byte of header) checksum += byte;
  put(148, octal(checksum, 8));
  const body = new Uint8Array(Math.ceil(bytes.byteLength / TAR_BLOCK) * TAR_BLOCK);
  body.set(bytes);
  return [header, body];
}

function pluginClawPack(name: string, version: string) {
  const files: Record<string, string> = {
    "package/package.json": JSON.stringify({
      name,
      version,
      type: "module",
      repository: "https://github.com/openclaw/chain-proof-plugin.git",
      openclaw: {
        extensions: ["./dist/index.js"],
        compat: { pluginApi: ">=2026.3.24-beta.2" },
        build: { openclawVersion: "2026.3.24-beta.2" },
      },
    }),
    "package/openclaw.plugin.json": JSON.stringify({
      id: name,
      name: `Chain proof ${name}`,
      configSchema: { type: "object", additionalProperties: false },
    }),
    "package/dist/index.js": "export default function register() {}\n",
    "package/README.md": `# ${name}\n\nDisposable chain-proof fixture.\n`,
  };
  const parts = Object.entries(files).flatMap(([file, content]) => tarFile(file, content));
  parts.push(new Uint8Array(TAR_BLOCK), new Uint8Array(TAR_BLOCK));
  const tar = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    tar.set(part, offset);
    offset += part.byteLength;
  }
  return gzipSync(tar);
}

// --------------------------------------------- simulated external boundary

type GitHubCall = {
  kind: "app-token" | "repository-dispatch";
  userAgent: string;
  eventType?: string;
  payload?: unknown;
};
// The release-scan dispatcher identifies itself; other ClawHub features (for
// example security-scan dispatch) share the App and are attributed separately.
const INSPECTOR_DISPATCH_USER_AGENT = "clawhub/plugin-inspector-release-scan-dispatch";

function githubBoundary(options: { failInspectorDispatches: number }) {
  const calls: GitHubCall[] = [];
  let inspectorFailuresLeft = options.failInspectorDispatches;
  async function handle(url: URL, init: RequestInit | undefined) {
    const userAgent = new Headers(init?.headers).get("user-agent") ?? "";
    if (
      init?.method === "POST" &&
      /^\/app\/installations\/[^/]+\/access_tokens$/.test(url.pathname)
    ) {
      calls.push({ kind: "app-token", userAgent });
      record("simulated-github: App installation token minted", { userAgent });
      return Response.json(
        {
          token: "ghs_SIMULATED_REDACTED",
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
          permissions: { contents: "write" },
        },
        { status: 201 },
      );
    }
    if (init?.method === "POST" && url.pathname === "/repos/openclaw/clawhub/dispatches") {
      const body = JSON.parse(typeof init.body === "string" ? init.body : "{}") as {
        event_type: string;
        client_payload: unknown;
      };
      calls.push({
        kind: "repository-dispatch",
        userAgent,
        eventType: body.event_type,
        payload: body.client_payload,
      });
      if (body.event_type === PLUGIN_INSPECTOR_RELEASE_SCAN_EVENT && inspectorFailuresLeft > 0) {
        inspectorFailuresLeft -= 1;
        record("simulated-github: repository_dispatch rejected (forced 503)", {
          userAgent,
          event_type: body.event_type,
          client_payload: body.client_payload,
        });
        return new Response("simulated outage", { status: 503 });
      }
      record("simulated-github: repository_dispatch accepted", {
        userAgent,
        event_type: body.event_type,
        client_payload: body.client_payload,
      });
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected GitHub call ${init?.method ?? "GET"} ${url.pathname}`);
  }
  const inspectorCalls = () =>
    calls
      .filter(
        (call) =>
          call.userAgent === INSPECTOR_DISPATCH_USER_AGENT ||
          call.eventType === PLUGIN_INSPECTOR_RELEASE_SCAN_EVENT,
      )
      .map(({ userAgent: _userAgent, ...call }) => call);
  return { calls, handle, inspectorCalls };
}

// -------------------------------------------------------------- harness

async function harness(options: { failInspectorDispatches?: number } = {}) {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  vi.stubEnv("SECURITY_SCAN_EVENT_DISPATCH_ENABLED", "1");
  vi.stubEnv("GITHUB_APP_ID", "chain-proof-app");
  vi.stubEnv("GITHUB_APP_INSTALLATION_ID", "chain-proof-installation");
  vi.stubEnv(
    "GITHUB_APP_PRIVATE_KEY",
    privateKey.export({ type: "pkcs8", format: "pem" }) as string,
  );
  vi.stubEnv("CLAWHUB_PLUGIN_INSPECTOR_WORKER_TOKEN", WORKER_TOKEN);
  vi.stubEnv("SECURITY_SCAN_WORKER_TOKEN", CHECKS_TOKEN);
  vi.stubEnv("CLAWHUB_ENV", "");
  vi.stubEnv("CLAWHUB_PREVIEW", "");
  // Keep model-backed background enrichment (changelog, classification) offline.
  vi.stubEnv("OPENAI_API_KEY", "");

  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiterV2");
  const github = githubBoundary({ failInspectorDispatches: options.failInspectorDispatches ?? 0 });
  const unexpected: string[] = [];

  // The worker and Convex actions share this process's fetch. Route only the
  // disposable site to the backend and GitHub to the simulated boundary.
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : undefined;
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    if (url.origin === SITE) {
      return await t.fetch(`${url.pathname}${url.search}`, {
        method: init?.method ?? request?.method ?? "GET",
        headers: init?.headers ?? request?.headers,
        body: init?.body ?? (request ? await request.arrayBuffer() : undefined),
      });
    }
    if (url.origin === "https://api.github.com") return await github.handle(url, init);
    unexpected.push(`${init?.method ?? "GET"} ${url.origin}${url.pathname}`);
    throw new Error(`Chain proof blocks unexpected network access: ${url.origin}`);
  });

  // Observe every blob read at the storage syscall, tagged by phase.
  const storageReads: Array<{ phase: string; storageId: string }> = [];
  let phase = "setup";
  const runtime = globalThis as typeof globalThis & {
    Convex: { jsSyscall: (op: string, args: unknown) => Promise<unknown> };
  };
  const accessors: { jsSyscall: unknown } = runtime.Convex;
  // The getter is invoked with its own receiver below.
  // oxlint-disable-next-line typescript/unbound-method
  const syscallGetter = Object.getOwnPropertyDescriptor(runtime.Convex, "jsSyscall")!.get!;
  // Resolve the active test context's syscall at call time.
  const jsSyscall = (op: string, args: unknown) =>
    (
      Reflect.apply(syscallGetter, runtime.Convex, []) as (
        op: string,
        args: unknown,
      ) => Promise<unknown>
    )(op, args);
  let pendingStore = Promise.resolve();
  vi.spyOn(accessors, "jsSyscall", "get").mockReturnValue((op: string, args: unknown) => {
    if (op === "storage/getBlob") {
      storageReads.push({ phase, storageId: (args as { storageId: string }).storageId });
    }
    // convex-test shares transaction depth across concurrent blob stores.
    if (op !== "storage/storeBlob") return jsSyscall(op, args);
    const result = pendingStore.then(() => jsSyscall(op, args));
    pendingStore = result.then(
      () => {},
      () => {},
    );
    return result;
  });

  const userId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", {
      handle: "chainproof",
      role: "user",
      githubCreatedAt: Date.now() - 365 * 24 * 60 * 60 * 1000,
    });
    await ctx.db.insert("apiTokens", {
      userId: id,
      label: "chain-proof",
      prefix: "clh_chain",
      tokenHash: await hashToken(API_TOKEN),
      createdAt: 1,
    });
    return id;
  });

  // Drains scheduled functions that are due within `ms` of fake time.
  async function advance(ms: number) {
    const step = 1_000;
    for (let elapsed = 0; elapsed <= ms; elapsed += step) {
      for (let round = 0; round < 20; round += 1) {
        vi.advanceTimersByTime(0);
        await t.finishInProgressScheduledFunctions();
      }
      if (elapsed < ms) vi.advanceTimersByTime(Math.min(step, ms - elapsed));
    }
  }

  async function publishAndAccept(name: string) {
    const archive = pluginClawPack(name, "1.0.0");
    const form = new FormData();
    form.set(
      "payload",
      JSON.stringify({
        name,
        displayName: `Chain proof ${name}`,
        family: "code-plugin",
        version: "1.0.0",
        changelog: "Chain proof release",
        expectedArtifactSha256: await sha256Hex(archive),
        source: {
          kind: "github",
          url: "https://github.com/openclaw/chain-proof-plugin",
          repo: "openclaw/chain-proof-plugin",
          ref: "refs/tags/v1.0.0",
          commit: "a".repeat(40),
          path: ".",
          importedAt: Date.now(),
        },
      }),
    );
    form.set(
      "clawpack",
      new Blob([new Uint8Array(archive)], { type: "application/gzip" }),
      "p.tgz",
    );
    phase = `publish:${name}`;
    const response = await t.fetch("/api/v1/packages", {
      method: "POST",
      headers: { Authorization: `Bearer ${API_TOKEN}` },
      body: form,
    });
    const text = await response.text();
    expect(response.status, text).toBe(200);
    const published = JSON.parse(text) as {
      attemptId: Id<"publishAttempts">;
      releaseId: Id<"packageReleases">;
    };
    record("publish accepted for checks", {
      package: name,
      publicationStatus: JSON.parse(text).publicationStatus,
    });
    await advance(0);

    phase = `checks:${name}`;
    const claim = (await t.action(api.publishAttempts.claimPrePublicationChecks, {
      token: CHECKS_TOKEN,
      attemptId: published.attemptId,
    })) as { attemptId: Id<"publishAttempts">; claimId: string; artifactFingerprint: string };
    await t.action(api.publishAttempts.completePrePublicationChecks, {
      token: CHECKS_TOKEN,
      attemptId: claim.attemptId,
      claimId: claim.claimId,
      artifactFingerprint: claim.artifactFingerprint,
      trufflehog: { status: "clean" },
      clawscan: { status: "clean" },
      clawscanAnalysis: {
        status: "completed",
        verdict: "benign",
        checkedAt: Date.now(),
        summary: "Simulated scanner completion for the real Inspector authority-chain proof.",
      },
    });
    phase = `finalize:${name}`;
    await advance(0);
    const state = await t.run(async (ctx) => {
      const attempt = await ctx.db.get(claim.attemptId);
      const release = attempt?.packageReleaseId ? await ctx.db.get(attempt.packageReleaseId) : null;
      const pkg = release ? await ctx.db.get(release.packageId) : null;
      return { attempt, release, pkg };
    });
    expect(state.attempt).toMatchObject({ status: "finalized" });
    expect(state.release).toMatchObject({ publicationStatus: "published" });
    record("accepted release finalized", {
      package: name,
      attempt: state.attempt?.status,
      release: state.release?.publicationStatus,
      channel: state.pkg?.channel,
    });
    return {
      release: state.release!,
      pkg: state.pkg!,
      clawpackStorageId: state.release!.clawpackStorageId,
    };
  }

  const scheduledDispatches = () =>
    t
      .run((ctx) => ctx.db.system.query("_scheduled_functions").collect())
      .then((jobs) =>
        jobs
          .filter((job) => job.name.includes("dispatchPluginInspectorReleaseScanInternal"))
          .map((job) => ({ args: job.args[0], state: job.state.kind })),
      );

  return {
    t,
    github,
    unexpected,
    storageReads,
    setPhase: (next: string) => {
      phase = next;
    },
    advance,
    publishAndAccept,
    scheduledDispatches,
    userId,
  };
}

type Harness = Awaited<ReturnType<typeof harness>>;

// Stands in for the GitHub Actions runner: the real workflow step's env,
// evaluated for this exact repository_dispatch event.
function workerEnvFor(clientPayload: Record<string, unknown>) {
  const context = {
    github: {
      event_name: "repository_dispatch",
      ref: "refs/heads/main",
      event: { action: PLUGIN_INSPECTOR_RELEASE_SCAN_EVENT, client_payload: clientPayload },
    },
    inputs: {},
    vars: { CLAWHUB_SITE_URL: SITE },
    secrets: { CLAWHUB_PLUGIN_INSPECTOR_WORKER_TOKEN: WORKER_TOKEN },
  };
  expect(WORKFLOW.stepRuns("scan", SCAN_STEP, context)).toBe(true);
  return WORKFLOW.stepEnv("scan", SCAN_STEP, context);
}

async function withBridge<T>(h: Harness, run: (siteUrl: string) => Promise<T>) {
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === "string" && key !== "host") headers.set(key, value);
      }
      void h.t
        .fetch(req.url ?? "/", { method: req.method, headers, body })
        .then(async (response) => {
          res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
          res.end(Buffer.from(await response.arrayBuffer()));
        })
        .catch((error: unknown) => {
          res.writeHead(500);
          res.end(String(error));
        });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function runFullWorker(h: Harness, env: Record<string, string>) {
  return await withBridge(h, async (siteUrl) => {
    const artifactDir = await mkdtemp(path.join(tmpdir(), "clawhub-chain-proof-worker-"));
    try {
      const child = spawn("node", ["scripts/package-inspector-nightly-scan.ts"], {
        cwd: process.cwd(),
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          ...Object.fromEntries(
            [
              "HTTPS_PROXY",
              "HTTP_PROXY",
              "NODE_USE_ENV_PROXY",
              "NODE_EXTRA_CA_CERTS",
              "SSL_CERT_FILE",
            ]
              .filter((key) => process.env[key])
              .map((key) => [key, process.env[key]!]),
          ),
          NO_PROXY: "127.0.0.1,localhost",
          ...env,
          // Only the backend address and artifact directory differ from the workflow's env.
          CLAWHUB_SITE_URL: siteUrl,
          PLUGIN_INSPECTOR_ARTIFACT_DIR: artifactDir,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
      child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
      const status = await new Promise<number | null>((resolve) => child.on("close", resolve));
      return { status, output, reports: await readdir(artifactDir).catch(() => []) };
    } finally {
      await rm(artifactDir, { recursive: true, force: true });
    }
  });
}

type WorkerItem = { packageName: string; version: string };
type MonitoringWorker = {
  parsePackageNames: (value: string | undefined) => string[];
  resolveTargetPackageItems: (names: string[]) => Promise<WorkerItem[]>;
  downloadPackageArtifactForScan: (
    item: WorkerItem,
    workRoot: string,
    pluginRoot: string,
  ) => Promise<string>;
  prepareExtractedPluginRoot: (
    pluginRoot: string,
    kind: string,
    packageName: string,
  ) => Promise<string>;
};

async function runWorkerArtifactPhase(env: Record<string, string>) {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  vi.resetModules();
  // Loaded by URL so the Convex typecheck does not pull in the Node worker script.
  const worker = (await import(
    /* @vite-ignore */ new URL("../scripts/package-inspector-nightly-scan.ts", import.meta.url).href
  )) as MonitoringWorker;
  const workRoot = await mkdtemp(path.join(tmpdir(), "clawhub-chain-proof-artifact-"));
  try {
    const items = await worker.resolveTargetPackageItems(
      worker.parsePackageNames(env.PLUGIN_INSPECTOR_PACKAGE_NAMES),
    );
    const pluginRoot = path.join(workRoot, "plugin");
    await mkdir(pluginRoot, { recursive: true });
    const kind = await worker.downloadPackageArtifactForScan(items[0]!, workRoot, pluginRoot);
    const scanRoot = await worker.prepareExtractedPluginRoot(
      pluginRoot,
      kind,
      items[0]!.packageName,
    );
    return { items, kind, files: await readdir(scanRoot) };
  } finally {
    await rm(workRoot, { recursive: true, force: true });
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Plugin Inspector release-scan authority chain", () => {
  it(
    "monitors an accepted public release: finalization -> queued dispatch -> worker artifact read",
    { timeout: FULL_WORKER ? 900_000 : 60_000 },
    async () => {
      proofLog.length = 0;
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      const h = await harness();
      const name = "chain-proof-public";
      const { release, clawpackStorageId } = await h.publishAndAccept(name);

      const dispatches = h.github.calls.filter(
        (call) => call.eventType === PLUGIN_INSPECTOR_RELEASE_SCAN_EVENT,
      );
      expect(h.github.inspectorCalls()).toEqual([
        { kind: "app-token" },
        {
          kind: "repository-dispatch",
          eventType: PLUGIN_INSPECTOR_RELEASE_SCAN_EVENT,
          payload: { package_name: name, version: "1.0.0", release_id: release._id },
        },
      ]);
      expect(await h.scheduledDispatches()).toEqual([
        { args: { releaseId: release._id, retryCount: 0 }, state: "success" },
      ]);
      vi.useRealTimers();

      const env = workerEnvFor(dispatches[0]!.payload as Record<string, unknown>);
      expect(env).toMatchObject({
        PLUGIN_INSPECTOR_PACKAGE_NAMES: name,
        PLUGIN_INSPECTOR_DRY_RUN: "0",
        PLUGIN_INSPECTOR_NOTIFY_OWNERS: "0",
      });
      h.setPhase("worker");
      if (FULL_WORKER) {
        const worker = await runFullWorker(h, env);
        record("monitoring worker exited", { status: worker.status, reports: worker.reports });
        for (const line of worker.output.split("\n").filter(Boolean).slice(-15)) {
          console.log(
            `[chain-proof][worker] ${line.replace(/Bearer\s+\S+/g, "Bearer <redacted>")}`,
          );
        }
        expect(worker.status, worker.output).toBe(0);
        const scan = await h.t.run((ctx) =>
          ctx.db
            .query("packageInspectorScanStates")
            .withIndex("by_release_and_completed_at", (q) => q.eq("releaseId", release._id))
            .collect(),
        );
        record("worker persisted scan state", {
          states: scan.map((state) => ({
            outcome: state.outcome,
            scanSource: state.scanSource,
            targetOpenClawVersion: state.targetOpenClawVersion,
          })),
        });
        expect(scan).toEqual([
          expect.objectContaining({
            scanSource: "nightly",
            outcome: expect.stringMatching(/clean|findings/),
          }),
        ]);
      } else {
        const artifact = await runWorkerArtifactPhase(env);
        record("monitoring worker downloaded protected artifact", {
          items: artifact.items.map((item) => ({
            packageName: item.packageName,
            version: item.version,
          })),
          kind: artifact.kind,
          files: artifact.files.sort(),
        });
        expect(artifact.files).toEqual(
          expect.arrayContaining(["package.json", "openclaw.plugin.json", "dist"]),
        );
      }
      const workerReads = h.storageReads.filter((read) => read.phase === "worker");
      record("protected artifact storage reads during worker", { reads: workerReads.length });
      expect(workerReads).toContainEqual({ phase: "worker", storageId: clawpackStorageId });
      expect(h.unexpected).toEqual([]);
    },
  );

  it(
    "rejects a release made private before its queued retry, before GitHub credentials and artifact reads",
    { timeout: FULL_WORKER ? 900_000 : 60_000 },
    async () => {
      proofLog.length = 0;
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      const h = await harness({ failInspectorDispatches: 1 });
      const name = "chain-proof-private";
      const { release, pkg } = await h.publishAndAccept(name);

      // Attempt 1 ran after acceptance and hit the forced outage.
      expect(h.github.inspectorCalls()).toEqual([
        { kind: "app-token" },
        {
          kind: "repository-dispatch",
          eventType: PLUGIN_INSPECTOR_RELEASE_SCAN_EVENT,
          payload: { package_name: name, version: "1.0.0", release_id: release._id },
        },
      ]);
      expect(await h.scheduledDispatches()).toEqual([
        { args: { releaseId: release._id, retryCount: 0 }, state: "success" },
        { args: { releaseId: release._id, retryCount: 1 }, state: "pending" },
      ]);
      record("retry queued after forced dispatch failure", { retryCount: 1, delayMs: 60_000 });

      // The release becomes private while its retry waits. No owner flow flips
      // an existing package private, so set the same `packages.channel` a
      // private-channel publish writes.
      await h.t.run((ctx) => ctx.db.patch(pkg._id, { channel: "private" }));
      record("package made private before retry", { package: name, channel: "private" });
      const inspectorCallsBeforeRetry = h.github.inspectorCalls().length;
      const callsBeforeRetry = h.github.calls.length;

      h.setPhase("retry");
      await h.advance(61_000);
      expect(await h.scheduledDispatches()).toEqual([
        { args: { releaseId: release._id, retryCount: 0 }, state: "success" },
        { args: { releaseId: release._id, retryCount: 1 }, state: "success" },
      ]);
      const retryInspectorCalls = h.github.inspectorCalls().slice(inspectorCallsBeforeRetry);
      record("queued retry ran after privatization", {
        inspectorAppTokensMinted: retryInspectorCalls.filter((call) => call.kind === "app-token")
          .length,
        inspectorRepositoryDispatches: retryInspectorCalls.filter(
          (call) => call.kind === "repository-dispatch",
        ).length,
        unrelatedGitHubCalls: h.github.calls
          .slice(callsBeforeRetry)
          .filter((call) => call.userAgent !== INSPECTOR_DISPATCH_USER_AGENT)
          .map((call) => ({
            kind: call.kind,
            userAgent: call.userAgent,
            eventType: call.eventType,
          })),
        storageReads: h.storageReads.filter((read) => read.phase === "retry").length,
      });
      expect(retryInspectorCalls).toEqual([]);
      expect(h.storageReads.filter((read) => read.phase === "retry")).toEqual([]);
      vi.useRealTimers();

      // A worker that still runs for this package (a run dispatched before the
      // change, or a manual run) is refused before any artifact storage read.
      const env = workerEnvFor({ package_name: name, version: "1.0.0", release_id: release._id });
      h.setPhase("stale-worker");
      if (FULL_WORKER) {
        const worker = await runFullWorker(h, env);
        record("stale monitoring worker exited", { status: worker.status });
        for (const line of worker.output.split("\n").filter(Boolean).slice(-6)) {
          console.log(
            `[chain-proof][worker] ${line.replace(/Bearer\s+\S+/g, "Bearer <redacted>")}`,
          );
        }
        expect(worker.status).not.toBe(0);
      } else {
        const refusal = await runWorkerArtifactPhase(env).then(
          () => null,
          (error: unknown) => (error instanceof Error ? error.message : String(error)),
        );
        record("stale monitoring worker refused", { error: refusal });
        expect(refusal).toContain(name);
      }
      const artifact = await h.t.fetch(
        `/api/v1/package-inspector/artifact?releaseId=${encodeURIComponent(release._id)}`,
        { headers: { Authorization: `Bearer ${WORKER_TOKEN}` } },
      );
      record("protected artifact route with worker token after privatization", {
        status: artifact.status,
        storageReads: h.storageReads.filter((read) => read.phase === "stale-worker").length,
      });
      expect(artifact.status).toBe(404);
      expect(h.storageReads.filter((read) => read.phase === "stale-worker")).toEqual([]);
      expect(h.github.inspectorCalls().slice(inspectorCallsBeforeRetry)).toEqual([]);
      expect(h.unexpected).toEqual([]);
      await writeFile(
        path.join(tmpdir(), "clawhub-chain-proof-last.json"),
        JSON.stringify(proofLog, null, 2),
      ).catch(() => undefined);
    },
  );
});
