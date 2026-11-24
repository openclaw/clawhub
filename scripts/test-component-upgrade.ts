#!/usr/bin/env bun
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import {
  buildLocalAuthBackendEnv,
  buildLocalAuthBackendVersionArgs,
  resolveLocalAuthDeployment,
} from "./playwright-local-auth-config";
import type { LocalConvexBootstrapResult } from "./playwright-local-convex";

// The last pre-uplift application and frozen dependency graph, not a generated mock.
const BASELINE = "252a3f86d05331ea5944ad7749165fafb282097e";
const repository = resolve(import.meta.dirname, "..");
const helper = join(repository, "scripts/playwright-local-convex.ts");
const sleep = (ms: number) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

function git(args: string[]) {
  const result = spawnSync("git", args, { cwd: repository, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr}`);
  return result.stdout;
}

function replaceOnce(source: string, from: string, to: string) {
  assert.equal(source.split(from).length, 2, `Fixture source contract changed: ${from}`);
  return source.replace(from, to);
}

function pausedReports(source: string, legacy: boolean) {
  source = replaceOnce(source, "maxParallelism: 1,", "maxParallelism: 0,");
  source = `import { makeFunctionReference } from "convex/server";\n${source}`;
  source = replaceOnce(
    source,
    '    let phase = "report_read_failed";',
    '    await ctx.runMutation(makeFunctionReference<"mutation">("componentUpgradeProbe:recordGeneration"), { reportId });\n    let phase = "report_read_failed";',
  );
  return legacy
    ? replaceOnce(source, 'from "@convex-dev/workpool";', 'from "workpool-previous";')
    : source;
}

const probeSource = `import { Workpool, type WorkId } from "@convex-dev/workpool";
import { v } from "convex/values";
import { components } from "./_generated/api";
import { internalMutation, internalQuery } from "./functions";
const args = { reportId: v.id("searchReportRuns") };
const pool = new Workpool(components.searchReports, { maxParallelism: 0 });
export const recordGeneration = internalMutation({
  args,
  handler: (ctx, { reportId }) => ctx.db.insert("componentUpgradeExecutions", { reportId }),
});
export const snapshot = internalQuery({
  args,
  handler: async (ctx, { reportId }) => {
    const row = await ctx.db.get(reportId);
    if (!row?.workId) throw new Error("Missing retained report/work ID");
    const executions = await ctx.db.query("componentUpgradeExecutions")
      .withIndex("by_reportId", q => q.eq("reportId", reportId)).take(2);
    return { row, work: await pool.status(ctx, row.workId as WorkId), executions: executions.length };
  },
});
`;

function fixtureSources(read: (path: string) => string, legacy: boolean) {
  let config = read("convex/convex.config.ts");
  if (legacy) {
    config = replaceOnce(
      config,
      '"@convex-dev/workpool/convex.config.js"',
      '"workpool-previous/convex.config.js"',
    );
    config = replaceOnce(
      config,
      '"@convex-dev/rate-limiter/convex.config.js"',
      '"rate-limiter-previous/convex.config.js"',
    );
  }
  return {
    "convex/convex.config.ts": config,
    "convex/searchReports.ts": pausedReports(read("convex/searchReports.ts"), legacy),
    "convex/schema.ts": replaceOnce(
      read("convex/schema.ts"),
      "export default defineSchema({",
      'export default defineSchema({\n  componentUpgradeExecutions: defineTable({ reportId: v.id("searchReportRuns") }).index("by_reportId", ["reportId"]),',
    ),
    "convex/componentUpgradeProbe.ts": legacy
      ? probeSource.replace('"@convex-dev/workpool"', '"workpool-previous"')
      : probeSource,
  };
}

async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  await new Promise<void>((resolveClose, reject) =>
    server.close((error) => (error ? reject(error) : resolveClose())),
  );
  return address.port;
}

type Snapshot = {
  row: { _id: string; workId: string; state: string; previousAttempts?: number };
  work: { state: string };
  executions: number;
};

async function main() {
  const baselineRead = (path: string) => git(["show", `${BASELINE}:${path}`]);
  const candidateRead = (path: string) => readFileSync(join(repository, path), "utf8");
  const baselineManifest = JSON.parse(baselineRead("package.json"));
  assert.equal(baselineManifest.dependencies.convex, "1.49.0");
  assert.equal(baselineManifest.dependencies["@convex-dev/workpool"], "0.4.15");
  const legacySources = fixtureSources(baselineRead, true);
  const bridgeSources = fixtureSources(baselineRead, false);
  const candidateSources = fixtureSources(candidateRead, false);
  if (process.argv.includes("--check")) {
    console.log("Component upgrade source contracts: PASS (no runtime started)");
    return;
  }
  const bunPin = candidateRead(".github/actions/setup-bun/action.yml").match(
    /bun-version: (\S+)/,
  )?.[1];
  assert.equal(process.versions.bun, bunPin, "Run with the repository's pinned Bun version");
  assert.equal(process.platform === "win32", false, "This fixture requires POSIX process groups");
  // /tmp preserves short Unix-socket paths on macOS; this is one disposable source capsule.
  const root = mkdtempSync(
    join(process.platform === "darwin" ? "/tmp" : tmpdir(), "clawhub-upgrade-"),
  );
  const project = join(root, "project");
  const selector = join(root, "selector.env");
  const children = new Set<ChildProcess>();
  mkdirSync(project);
  mkdirSync(join(root, "tmp"));
  mkdirSync(join(root, "bin"));
  symlinkSync(process.execPath, join(root, "bin/bun"));
  symlinkSync(process.execPath, join(root, "bin/bunx"));
  const cloudPort = await freePort();
  let sitePort = await freePort();
  while (sitePort === cloudPort) sitePort = await freePort();
  const url = `http://127.0.0.1:${cloudPort}`;
  const env = {
    ...process.env,
    ...buildLocalAuthBackendEnv(),
    PATH: `${join(root, "bin")}:${process.env.PATH}`,
    TMPDIR: join(root, "tmp"),
    CONVEX_AGENT_MODE: "anonymous",
    CONVEX_SITE_URL: `http://127.0.0.1:${sitePort}`,
    VITE_CONVEX_URL: url,
  };
  writeFileSync(selector, "CONVEX_DEPLOYMENT=anonymous:anonymous-agent\n", { mode: 0o600 });
  function track(child: ChildProcess) {
    children.add(child);
    child.once("exit", () => children.delete(child));
    return child;
  }
  function launch(command: string, args: string[], ipc = false) {
    return track(
      spawn(command, args, {
        cwd: project,
        env,
        detached: true,
        stdio: ipc ? ["ignore", "inherit", "inherit", "ipc"] : ["ignore", "pipe", "pipe"],
      }),
    );
  }
  async function stop(child: ChildProcess) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, "exit");
    process.kill(-child.pid!, "SIGTERM");
    await Promise.race([exited, sleep(5_000)]);
    if (child.exitCode === null && child.signalCode === null) process.kill(-child.pid!, "SIGKILL");
    await exited;
  }
  async function command(args: string[], quiet = false) {
    const child = launch(process.execPath, args);
    let output = "";
    let errors = "";
    child.stdout!.on("data", (chunk) => {
      output += chunk;
      if (!quiet) process.stdout.write(chunk);
    });
    child.stderr!.on("data", (chunk) => {
      errors = (errors + chunk).slice(-2_000);
      if (!quiet) process.stderr.write(chunk);
    });
    const [code] = await once(child, "close");
    const detail = args.includes("--from-file") ? "" : `\n${errors}`;
    assert.equal(code, 0, `Fixture command failed: ${args.slice(0, 3).join(" ")}${detail}`);
    return output;
  }
  const cli = (args: string[], quiet = false) =>
    command(["x", "--no-install", "convex", ...args, "--env-file", selector], quiet);
  const run = async <T>(name: string, args: unknown): Promise<T> =>
    JSON.parse(await cli(["run", name, JSON.stringify(args)], true)) as T;
  const writeSources = (sources: Record<string, string>) => {
    for (const [path, source] of Object.entries(sources))
      writeFileSync(join(project, path), source);
  };
  async function archive(ref: string) {
    const producer = track(
      spawn("git", ["archive", ref], {
        cwd: repository,
        detached: true,
        stdio: ["ignore", "pipe", "inherit"],
      }),
    );
    const consumer = track(
      spawn("tar", ["-x", "-C", project], {
        detached: true,
        stdio: ["pipe", "inherit", "inherit"],
      }),
    );
    const [[produced], [consumed]] = await Promise.all([
      once(producer, "exit"),
      once(consumer, "exit"),
      pipeline(producer.stdout!, consumer.stdin!),
    ]);
    assert.equal(produced, 0);
    assert.equal(consumed, 0);
  }
  async function start(provision = false) {
    const child = launch(
      process.execPath,
      [
        helper,
        ...(provision ? [] : ["--serve"]),
        "convex",
        "dev",
        "--env-file",
        selector,
        "--typecheck",
        "enable",
        "--codegen",
        "enable",
        "--local-cloud-port",
        String(cloudPort),
        "--local-site-port",
        String(sitePort),
        ...buildLocalAuthBackendVersionArgs(),
        ...(provision ? ["--skip-push"] : []),
      ],
      true,
    );
    await new Promise<void>((resolveReady, reject) => {
      const timer = setTimeout(() => reject(new Error("Local fixture startup timed out")), 300_000);
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("exit", () => {
        clearTimeout(timer);
        reject(new Error("Local fixture owner exited"));
      });
      child.once("message", (result: LocalConvexBootstrapResult) => {
        clearTimeout(timer);
        if (result.status === "ready") resolveReady();
        else reject(new Error(result.message));
      });
    });
    return child;
  }
  let cleanup: Promise<void> | undefined;
  const clean = () =>
    (cleanup ??= (async () => {
      await Promise.all([...children].map(stop));
      rmSync(root, { recursive: true, force: true });
    })());
  const interrupt = () => {
    void clean().then(() => process.exit(130));
  };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    await archive(BASELINE);
    await command(["install", "--frozen-lockfile"]);
    writeSources(legacySources);
    await stop(await start(true));
    const config = JSON.parse(
      readFileSync(join(project, ".convex/local/default/config.json"), "utf8"),
    ) as { deploymentName?: unknown };
    assert.equal(
      typeof config.deploymentName,
      "string",
      "Provisioning did not record a local deployment",
    );
    const name = config.deploymentName as string;
    const deployment = resolveLocalAuthDeployment(
      `${name.startsWith("anonymous-") ? "anonymous" : "local"}:${name}`,
      "anonymous:anonymous-agent",
    );
    writeFileSync(selector, `CONVEX_DEPLOYMENT=${deployment}\n`, { mode: 0o600 });
    const value = join(root, "value");
    writeFileSync(value, "1", { mode: 0o600 });
    for (const name of ["CLAWHUB_DISABLE_CRONS", "CLAWHUB_PREVIEW"]) {
      await cli(["env", "set", name, "--from-file", value], true);
    }
    rmSync(value);
    let owner = await start();
    const period = 24 * 60 * 60 * 1000;
    const quota = {
      name: "component-upgrade",
      key: "retained-quota",
      config: { kind: "fixed window", rate: 1, period, start: Date.now() },
    };
    assert.deepEqual(await run("rateLimits:consumeHttpRateLimitKeyInternal", quota), { ok: true });
    const request = { view: "recommendations", artifactKind: "plugin" };
    const queued = await run<{ reportId: string; status: string }>(
      "searchReports:startInternal",
      request,
    );
    assert.equal(queued.status, "pending");
    const snapshot = () =>
      run<Snapshot>("componentUpgradeProbe:snapshot", { reportId: queued.reportId });
    const before = await snapshot();
    assert.equal(before.executions, 0);
    assert.equal(before.work.state, "pending");
    async function retained() {
      const current = await snapshot();
      assert.deepEqual(current, before, "Report, work identity, or queue changed while paused");
      const denied = await run<{ ok: boolean; retryAfter: number }>(
        "rateLimits:consumeHttpRateLimitKeyInternal",
        quota,
      );
      assert.equal(denied.ok, false);
      assert(denied.retryAfter > 0 && denied.retryAfter <= period);
    }
    await retained();
    await stop(owner);
    writeSources(bridgeSources);
    owner = await start();
    // This fixture has one pending job (less than the migration's 64-row batch).
    // Supplying `before` runs that batch synchronously instead of just scheduling it.
    await cli([
      "run",
      "--component",
      "searchReports",
      "migrations:backfillPendingStartIds",
      JSON.stringify({ before: Date.now() }),
    ]);
    const workRows = JSON.parse(
      await cli(
        ["data", "work", "--component", "searchReports", "--limit", "2", "--format", "json"],
        true,
      ),
    ) as Array<{ _id: string; pendingStartId?: string }>;
    assert.equal(workRows.length, 1);
    assert.equal(workRows[0]._id, before.row.workId);
    assert(workRows[0].pendingStartId, "Pending-start backfill did not complete");
    await retained();
    await stop(owner);
    // Overlay application files only. The single .convex directory and its database stay in place.
    const deleted = git([
      "diff",
      "--name-only",
      "-z",
      "--no-renames",
      "--diff-filter=D",
      BASELINE,
      "HEAD",
    ]);
    for (const path of deleted.split("\0").filter(Boolean)) {
      assert(
        !path.startsWith(".convex/") && !path.startsWith(".env"),
        "Local state cannot be a tracked source deletion",
      );
      rmSync(join(project, path), { force: true });
    }
    await archive("HEAD");
    for (const path of ["package.json", "bun.lock", "convex.json"])
      cpSync(join(repository, path), join(project, path));
    await command(["install", "--frozen-lockfile"]);
    writeSources(candidateSources);
    owner = await start();
    await retained();
    await cli(["run", "--component", "searchReports", "config:update", '{"maxParallelism":1}']);
    const deadline = Date.now() + 120_000;
    let finished = await snapshot();
    while (finished.work.state !== "finished" && Date.now() < deadline) {
      await sleep(500);
      finished = await snapshot();
    }
    assert.equal(finished.work.state, "finished");
    assert.equal(finished.row._id, before.row._id);
    assert.equal(finished.row.workId, before.row.workId);
    assert.equal(finished.row.state, "ready");
    assert.equal(finished.row.previousAttempts ?? 0, 0);
    assert.equal(finished.executions, 1, "Queued generation must execute exactly once");
    const ready = await run<{ status: string }>("searchReports:getInternal", {
      reportId: queued.reportId,
    });
    assert.equal(ready.status, "ready");
    const reused = await run<{ reportId: string; status: string }>(
      "searchReports:startInternal",
      request,
    );
    assert.equal(reused.reportId, queued.reportId);
    assert.equal(reused.status, "ready");
    assert.equal((await snapshot()).executions, 1);
    await stop(owner);
    console.log(
      "Component upgrade: PASS (legacy → backfilled 0.4.15 → candidate, one database, retained quota/IDs, one generation)",
    );
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
    await clean();
  }
}

await main();
