#!/usr/bin/env bun
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import { once } from "node:events";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { dirname, join, relative, resolve } from "node:path";
import { BaseConvexClient, ConvexHttpClient } from "convex/browser";
import { makeFunctionReference, type UserIdentityAttributes } from "convex/server";
import type { Value } from "convex/values";
import ts from "typescript";

type ObservedRow = {
  _id: string;
  workId: string;
  maxParallelism: number;
  retry: boolean;
  runResult: { kind: string; error: string; errorData?: Value };
};

const root = process.cwd();
const capsule = join(root, ".artifacts/component-upgrade");
const home = join(capsule, "fixture-home");
const packageCache = join(root, ".artifacts/component-upgrade-cache");
const backendVersion = "precompiled-2026-10-22-1447815";
const cloud = 43220;
const site = 43221;
const url = `http://127.0.0.1:${cloud}`;
const siteUrl = `http://127.0.0.1:${site}`;
const templates = join(root, "scripts/fixtures/component-upgrade");
let owner: ChildProcess | undefined;
let ownCapsule = false;
let passed = false;
const baseEnv: NodeJS.ProcessEnv = {
  PATH: process.env.PATH,
  HOME: home,
  BUN_INSTALL_CACHE_DIR: packageCache,
  TMPDIR: "/tmp",
  LANG: "en_US.UTF-8",
  CI: "1",
  CONVEX_AGENT_MODE: "anonymous",
  VITE_CONVEX_URL: url,
  VITE_CONVEX_SITE_URL: siteUrl,
  PLAYWRIGHT_LOCAL_AUTH_BACKEND_VERSION: backendVersion,
  PLAYWRIGHT_WEB_SERVER_TIMEOUT_MS: "180000",
};
const digest = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");

async function command(args: string[], cwd = capsule) {
  const child = spawn(args[0]!, args.slice(1), {
    cwd,
    env: baseEnv,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (chunk) => {
      output = (output + chunk).slice(-100_000);
    });
  const timer = setTimeout(() => {
    if (child.pid) process.kill(-child.pid, "SIGTERM");
  }, 180_000);
  const force = setTimeout(() => {
    if (child.pid) process.kill(-child.pid, "SIGKILL");
  }, 185_000);
  let code: number | null;
  try {
    [code] = await once(child, "exit");
  } finally {
    clearTimeout(timer);
    clearTimeout(force);
  }
  if (code !== 0)
    throw new Error(
      `Fixture command failed (${args.slice(0, 3).join(" ")}): ${output.slice(-4_000)}`,
    );
  return output;
}

function baselineManifest(text: string) {
  const manifest = JSON.parse(text);
  for (const section of ["dependencies", "devDependencies"]) {
    if (manifest[section]?.convex === "1.50.0") manifest[section].convex = "1.49.0";
    if (manifest[section]?.["@convex-dev/workpool"] === "0.4.16")
      manifest[section]["@convex-dev/workpool"] = "0.4.15";
  }
  return JSON.stringify(manifest, null, 2) + "\n";
}

function copiedSource(verify = false, deployed = false) {
  const listed = spawnSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" });
  assert.equal(listed.status, 0);
  const tracked = listed.stdout.split("\0").filter(Boolean);
  const manifests = tracked.filter((file) => /^packages\/[^/]+\/package\.json$/.test(file));
  const selected = new Set<string>([
    "package.json",
    "bun.lock",
    "tsconfig.json",
    "convex/tsconfig.json",
    ...manifests,
  ]);
  for (const file of ["convex.json", "bunfig.toml"])
    if (existsSync(join(root, file))) selected.add(file);
  const rootManifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  for (const file of Object.values(rootManifest.patchedDependencies ?? {})) {
    assert.equal(typeof file, "string");
    selected.add(file as string);
  }
  const queue = tracked.filter(
    (file) =>
      file.startsWith("convex/") &&
      /\.[cm]?[jt]s$/.test(file) &&
      !/\.test\.|\/__tests__\//.test(file),
  );
  const addRelative = (file: string, specifier: string) => {
    const base = specifier.startsWith("@/")
      ? join(root, "src", specifier.slice(2))
      : resolve(root, dirname(file), specifier);
    assert.ok(base.startsWith(root + "/"), "Source import escaped the checkout.");
    const candidates = [
      base,
      ...[".ts", ".tsx", ".js", ".json", ".d.ts", "/index.ts", "/index.tsx", "/index.js"].map(
        (suffix) => base + suffix,
      ),
    ];
    if (base.endsWith(".js"))
      candidates.push(base.slice(0, -3) + ".ts", base.slice(0, -3) + ".d.ts");
    const source = candidates.find(
      (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
    );
    assert.ok(source, `Unresolved source import: ${file} -> ${specifier}`);
    queue.push(relative(root, source));
  };
  // Preserve the generated local schema package consumed by Convex imports.
  for (const file of tracked.filter(
    (path) => path.startsWith("packages/schema/src/") && !path.includes(".test."),
  ))
    queue.push(file);
  if (existsSync(join(root, "packages/schema/dist"))) {
    const visit = (directory: string) => {
      for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
        const file = join(directory, entry.name);
        if (entry.isDirectory()) visit(file);
        else if (entry.isFile()) selected.add(file);
        else throw new Error("Schema artifact must not contain symlinks.");
      }
    };
    visit("packages/schema/dist");
  }
  while (queue.length) {
    const file = queue.pop()!;
    if (selected.has(file)) continue;
    selected.add(file);
    // Local push regenerates declaration imports; stale type-only edges are not runtime closure.
    if (file.endsWith(".d.ts")) continue;
    const code = readFileSync(join(root, file), "utf8");
    for (const imported of ts.preProcessFile(code, true, true).importedFiles) {
      if (imported.fileName.startsWith(".") || imported.fileName.startsWith("@/"))
        addRelative(file, imported.fileName);
    }
  }
  const sourceHash = createHash("sha256");
  for (const file of [...selected].sort()) {
    assert.ok(
      !file
        .split("/")
        .some((part) => part.startsWith(".env") || part === ".convex" || part === ".git"),
    );
    const bytes = readFileSync(join(root, file));
    sourceHash.update(file + "\0").update(bytes);
    if (verify) {
      // Codegen owns these five derived files once baseline functions have been pushed.
      if (deployed && /^convex\/_generated\/(api|server|dataModel)\.(js|d\.ts)$/.test(file))
        continue;
      if (file === "bun.lock") continue; // Checked semantically below against the two permitted package changes.
      if (file === "package.json" || manifests.includes(file)) {
        assert.equal(readFileSync(join(capsule, file), "utf8"), baselineManifest(bytes.toString()));
      } else {
        const stored =
          file === "convex/schema.ts" ? "convex/_dependencyUpgradeOriginalSchema.ts" : file;
        assert.ok(
          readFileSync(join(capsule, stored)).equals(bytes),
          `Changed prepared source: ${file}`,
        );
      }
    } else {
      mkdirSync(dirname(join(capsule, file)), { recursive: true });
      writeFileSync(join(capsule, file), bytes);
    }
  }
  return {
    manifests: ["package.json", ...manifests],
    sourceHash: sourceHash.digest("hex"),
    files: selected.size,
  };
}

function packageProof(directory = capsule) {
  // Use package paths directly: Bun honors the invoking checkout's tsconfig aliases.
  const convex = realpathSync(join(directory, "node_modules/convex"));
  const workpool = realpathSync(join(directory, "node_modules/@convex-dev/workpool"));
  const manifest = JSON.parse(readFileSync(join(workpool, "package.json"), "utf8"));
  assert.ok(
    convex.startsWith(directory + "/") && workpool.startsWith(directory + "/"),
    "Fixture packages must be capsule-owned.",
  );
  const hash = createHash("sha256");
  const visit = (directory: string) => {
    for (const name of readdirSync(join(workpool, directory)).sort()) {
      const file = join(directory, name);
      if (statSync(join(workpool, file)).isDirectory()) visit(file);
      else hash.update(file + "\0").update(readFileSync(join(workpool, file)));
    }
  };
  visit("src");
  return {
    convex: JSON.parse(readFileSync(join(convex, "package.json"), "utf8")).version,
    workpool: manifest.version,
    cliSha256: digest(readFileSync(join(convex, "dist/cli.bundle.cjs"))),
    workpoolSourceSha256: hash.digest("hex"),
  };
}

async function freePort(port: number) {
  const server = createServer();
  server.listen(port, "127.0.0.1");
  await once(server, "listening");
  await new Promise<void>((done) => server.close(() => done()));
}

async function startBackend() {
  owner = spawn(
    "bun",
    [
      join(root, "scripts/playwright-local-convex.ts"),
      "convex",
      "dev",
      "--skip-push",
      "--typecheck",
      "disable",
      "--codegen",
      "disable",
      "--local-cloud-port",
      String(cloud),
      "--local-site-port",
      String(site),
      "--local-backend-version",
      backendVersion,
    ],
    {
      cwd: capsule,
      env: baseEnv,
      detached: true,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  );
  let tail = "";
  for (const stream of [owner.stdout!, owner.stderr!])
    stream.on("data", (chunk) => {
      tail = (tail + chunk).slice(-4_000);
    });
  await new Promise<void>((done, fail) => {
    const finish = (error?: Error) => {
      clearTimeout(timer);
      owner!.off("message", message);
      owner!.off("error", finish);
      owner!.off("exit", exited);
      if (error) fail(error);
      else done();
    };
    const message = (value: { status: string; message?: string }) =>
      finish(value.status === "ready" ? undefined : new Error(value.message ?? tail));
    const exited = () => finish(new Error("Local backend owner exited."));
    const timer = setTimeout(() => finish(new Error("Local backend bootstrap timeout.")), 180_000);
    owner!.on("message", message);
    owner!.once("error", finish);
    owner!.once("exit", exited);
  });
}

async function stopBackend() {
  if (!owner?.pid || owner.exitCode !== null || owner.signalCode !== null) return;
  if (owner.connected) owner.disconnect();
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    once(owner, "exit"),
    new Promise((done) => {
      timer = setTimeout(done, 6_000);
    }),
  ]);
  clearTimeout(timer);
  if (owner.exitCode === null && owner.signalCode === null) {
    const exited = once(owner, "exit");
    process.kill(-owner.pid, "SIGKILL");
    await exited;
  }
}

async function waitFor<T>(
  read: () => Promise<T>,
  ready: (value: T) => boolean,
  label: string,
): Promise<T> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (ready(value)) return value;
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(`Timed out observing ${label}.`);
}

async function main() {
  assert.ok(process.argv.includes("--run"), "Use --run for the owned local upgrade fixture.");
  const pausedHash = process.argv.find((arg) => arg.startsWith("--resume-paused="))?.split("=")[1];
  const seededHash = process.argv.find((arg) => arg.startsWith("--resume-seeded="))?.split("=")[1];
  const resumeHash =
    pausedHash ??
    seededHash ??
    process.argv.find((arg) => arg.startsWith("--resume-pre-push="))?.split("=")[1];
  if (resumeHash) {
    assert.match(resumeHash, /^[a-f0-9]{64}$/);
    assert.equal(realpathSync(capsule), join(realpathSync(root), ".artifacts/component-upgrade"));
    assert.equal(
      readFileSync(join(capsule, ".fixture-owner"), "utf8"),
      "clawhub-local-component-upgrade\n",
    );
    assert.equal(statSync(capsule).uid, process.getuid?.());
  } else {
    assert.ok(!existsSync(capsule), "Existing fixture capsule is not disposable by inference.");
  }
  if (!existsSync(packageCache)) mkdirSync(packageCache, { recursive: true, mode: 0o700 });
  const cacheInfo = lstatSync(packageCache);
  assert.ok(cacheInfo.isDirectory() && !cacheInfo.isSymbolicLink());
  assert.equal(
    realpathSync(packageCache),
    join(realpathSync(root), ".artifacts/component-upgrade-cache"),
  );
  if (process.getuid) assert.equal(cacheInfo.uid, process.getuid());
  await freePort(cloud);
  await freePort(site);
  if (!resumeHash) mkdirSync(capsule, { recursive: true });
  ownCapsule = true;
  const inputs = copiedSource(Boolean(resumeHash), Boolean(seededHash || pausedHash));
  if (resumeHash) assert.equal(inputs.sourceHash, resumeHash);
  const cachedBinary = join(
    root,
    ".artifacts/native-home/.cache/convex/binaries",
    backendVersion,
    "convex-local-backend",
  );
  assert.equal(
    realpathSync(cachedBinary),
    join(realpathSync(root), relative(root, cachedBinary)),
    "Cached backend path must not escape through symlinks.",
  );
  const binaryInfo = lstatSync(cachedBinary);
  assert.ok(binaryInfo.isFile() && !binaryInfo.isSymbolicLink());
  if (process.getuid) assert.equal(binaryInfo.uid, process.getuid());
  const binarySha256 = digest(readFileSync(cachedBinary));
  const localBinary = join(home, ".cache/convex/binaries", backendVersion, "convex-local-backend");
  if (resumeHash) {
    assert.equal(realpathSync(home), join(realpathSync(capsule), "fixture-home"));
    assert.equal(digest(readFileSync(localBinary)), binarySha256);
  } else {
    mkdirSync(home, { mode: 0o700 });
    mkdirSync(dirname(localBinary), { recursive: true });
    copyFileSync(cachedBinary, localBinary);
    chmodSync(localBinary, 0o700);
  }
  if (!resumeHash)
    writeFileSync(join(capsule, ".fixture-owner"), "clawhub-local-component-upgrade\n", {
      mode: 0o600,
    });
  const original = new Map(
    inputs.manifests.map((file) => [file, readFileSync(join(root, file), "utf8")]),
  );
  const candidateLock = readFileSync(join(root, "bun.lock"));
  if (resumeHash) {
    assert.ok(
      readFileSync(join(capsule, "convex/schema.ts")).equals(
        readFileSync(join(templates, "schema.ts.txt")),
      ),
    );
    assert.ok(
      readFileSync(join(capsule, "convex/dependencyUpgradeFixtures.ts")).equals(
        readFileSync(join(templates, "app.ts.txt")),
      ),
    );
  } else {
    for (const [file, text] of original) writeFileSync(join(capsule, file), baselineManifest(text));
    renameSync(
      join(capsule, "convex/schema.ts"),
      join(capsule, "convex/_dependencyUpgradeOriginalSchema.ts"),
    );
    writeFileSync(
      join(capsule, "convex/schema.ts"),
      readFileSync(join(templates, "schema.ts.txt")),
    );
    writeFileSync(
      join(capsule, "convex/dependencyUpgradeFixtures.ts"),
      readFileSync(join(templates, "app.ts.txt")),
    );
    await command(["bun", "install", "--ignore-scripts"]);
  }
  const parseLock = (text: string) => ts.parseConfigFileTextToJson("bun.lock", text).config;
  const oldLock = parseLock(readFileSync(join(capsule, "bun.lock"), "utf8"));
  const nextLock = parseLock(candidateLock.toString());
  const changed = [
    ...new Set([...Object.keys(oldLock.packages), ...Object.keys(nextLock.packages)]),
  ]
    .filter(
      (key) => JSON.stringify(oldLock.packages[key]) !== JSON.stringify(nextLock.packages[key]),
    )
    .sort();
  assert.deepEqual(changed, ["@convex-dev/workpool", "convex"]);
  const baseline = packageProof();
  assert.equal(baseline.convex, "1.49.0");
  assert.equal(baseline.workpool, "0.4.15");
  assert.deepEqual(baseline, packageProof(join(root, "scripts/fixtures/dependency-baseline")));
  console.log(
    JSON.stringify({
      phase: "baseline",
      target: url,
      backendVersion,
      binarySha256,
      inputs,
      packages: baseline,
    }),
  );
  const database = join(capsule, ".convex/local/default/convex_local_backend.sqlite3");
  const databaseInode = resumeHash ? statSync(database).ino : undefined;
  await startBackend();
  if (resumeHash)
    assert.equal(statSync(database).ino, databaseInode, "Existing database was replaced.");
  const config = JSON.parse(
    readFileSync(join(capsule, ".convex/local/default/config.json"), "utf8"),
  );
  assert.equal(config.backendVersion, backendVersion);
  assert.equal(config.ports.cloud, cloud);
  assert.equal(config.ports.site, site);
  const deployment = `anonymous:${config.deploymentName}`;
  // Explicit self-hosted credentials prevent cloud deployment lookup or CLI-owned backend restart.
  const cliEnv = join(capsule, ".fixture-cli.env");
  assert.equal(typeof config.adminKey, "string");
  assert.ok(!/[\r\n]/.test(config.adminKey));
  writeFileSync(
    cliEnv,
    `CONVEX_SELF_HOSTED_URL=${url}\nCONVEX_SELF_HOSTED_ADMIN_KEY=${config.adminKey}\n`,
    { mode: 0o600 },
  );
  if (resumeHash && !seededHash && !pausedHash) {
    const tables = await command(["bunx", "convex", "data", "--env-file", cliEnv]);
    assert.equal(
      tables.trim(),
      "There are no tables in the database.",
      "Only a pre-push database can resume.",
    );
  }
  // The published runtime supports admin auth; it is intentionally absent from public SDK types.
  const client = new ConvexHttpClient(url) as ConvexHttpClient & {
    setAdminAuth: (key: string, identity?: UserIdentityAttributes) => void;
  };
  client.setAdminAuth(config.adminKey);
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const changes = {
    CLAWHUB_DISABLE_CRONS: "1",
    DEV_AUTH_ENABLED: "1",
    DEV_AUTH_CONVEX_DEPLOYMENT: deployment,
    AUTH_GITHUB_ID: "local-fixture",
    AUTH_GITHUB_SECRET: "local-fixture",
    SITE_URL: "http://127.0.0.1:43222",
    CLAWHUB_SKILLS_SH_ROLLOUT_MODE: "test",
    JWT_PRIVATE_KEY: privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString()
      .trimEnd()
      .replace(/\n/g, " "),
    JWKS: JSON.stringify({ keys: [{ use: "sig", ...publicKey.export({ format: "jwk" }) }] }),
  };
  const envResponse = await fetch(new URL("/api/update_environment_variables", url), {
    method: "POST",
    headers: { Authorization: `Convex ${config.adminKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      changes: Object.entries(changes).map(([name, value]) => ({ name, value })),
    }),
  });
  assert.ok(envResponse.ok, "Local environment setup failed.");
  const push = () =>
    command([
      "bunx",
      "convex",
      "run",
      "--push",
      "--env-file",
      cliEnv,
      "--inline-query",
      "null",
      "--typecheck",
      "disable",
    ]);
  const rows = async (table: string): Promise<ObservedRow[]> => {
    // Match the published CLI: system queries use a component-scoped WebSocket subscription.
    let receive: (value: Value) => void;
    let reject: (error: unknown) => void;
    const result = new Promise<Value>((resolveResult, rejectResult) => {
      receive = resolveResult;
      reject = rejectResult;
    });
    const system = new BaseConvexClient(
      url,
      (tokens) => {
        for (const token of tokens) {
          try {
            const value = system.localQueryResultByToken(token);
            if (value !== undefined) receive(value);
          } catch (error) {
            reject(error);
          }
        }
      },
      { webSocketConstructor: WebSocket, unsavedChangesWarning: false },
    ) as BaseConvexClient & {
      setAdminAuth: (key: string) => void;
      localQueryResultByToken: (token: string) => Value | undefined;
      subscribe: (
        name: string,
        args: Record<string, Value>,
        options: { componentPath: string },
      ) => { unsubscribe: () => void };
    };
    let subscription: { unsubscribe: () => void } | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      system.setAdminAuth(config.adminKey);
      subscription = system.subscribe(
        "_system/cli/tableData",
        {
          table,
          order: "asc",
          paginationOpts: { cursor: null, numItems: 10 },
        },
        { componentPath: "searchReports" },
      );
      timer = setTimeout(() => reject(new Error("Component observation timed out.")), 10_000);
      const page = (await result) as { page: ObservedRow[]; isDone: boolean };
      assert.ok(
        page.isDone && Array.isArray(page.page) && page.page.length <= 10,
        "Fixture observation exceeded its bounded page.",
      );
      return page.page;
    } finally {
      clearTimeout(timer);
      try {
        subscription?.unsubscribe();
      } finally {
        await system.close();
      }
    }
  };
  if (!seededHash && !pausedHash) await push();
  const mutation = (name: string, args = {}) =>
    client.mutation(makeFunctionReference<"mutation">(`dependencyUpgradeFixtures:${name}`), args);
  const query = (name: string, args = {}) =>
    client.query(makeFunctionReference<"query">(`dependencyUpgradeFixtures:${name}`), args);
  let userId: string;
  let pausedReport: { reportId: string; workId: string } | undefined;
  if (seededHash || pausedHash) {
    const snapshot = JSON.parse(
      await command([
        "bunx",
        "convex",
        "run",
        "--env-file",
        cliEnv,
        "--inline-query",
        `
      return {
        users: await ctx.db.query("users").take(2),
        gates: await ctx.db.query("dependencyUpgradeGate").take(2),
        reports: await ctx.db.query("searchReportRuns").take(2),
      };
    `,
      ]),
    );
    assert.equal(snapshot.users.length, 1);
    assert.equal(snapshot.users[0].handle, "dependency-fixture");
    assert.equal(snapshot.users[0].role, "admin");
    assert.equal(snapshot.gates.length, 1);
    assert.equal(snapshot.gates[0].started, Boolean(pausedHash));
    assert.equal(snapshot.gates[0].released, Boolean(pausedHash));
    if (pausedHash) {
      assert.equal(snapshot.reports.length, 1);
      assert.equal(snapshot.reports[0].state, "pending");
      pausedReport = { reportId: snapshot.reports[0]._id, workId: snapshot.reports[0].workId };
      const work = await rows("work");
      assert.equal(work.length, 1);
      assert.equal(work[0]!._id, pausedReport.workId);
      const starts = await rows("pendingStart");
      assert.equal(starts.length, 1);
      assert.equal(starts[0]!.workId, pausedReport.workId);
      const globals = await rows("globals");
      assert.equal(globals.length, 1);
      assert.equal(globals[0]!.maxParallelism, 0);
    } else {
      assert.equal(snapshot.reports.length, 0);
      for (const table of [
        "work",
        "pendingStart",
        "pendingCompletion",
        "pendingCancelation",
        "payload",
        "internalState",
      ])
        assert.equal((await rows(table)).length, 0, `Seeded continuation found existing ${table}.`);
    }
    userId = snapshot.users[0]._id;
  } else {
    ({ userId } = await mutation("seed"));
  }
  const issuer = "https://convex.test";
  const identity = { subject: userId, issuer, tokenIdentifier: `${issuer}|${userId}` };
  client.setAdminAuth(config.adminKey, identity);
  let failureId: string;
  let queued: { reportId: string };
  if (pausedReport) {
    const completion = await rows("pendingCompletion");
    assert.equal(completion.length, 1);
    assert.notEqual(completion[0]!.workId, pausedReport.workId);
    failureId = completion[0]!.workId;
    queued = pausedReport;
  } else {
    failureId = await mutation("startFailure");
    await waitFor(
      () => query("observeGate"),
      (gate) => gate.started,
      "old action started",
    );
    queued = await mutation("enqueueReportAndPause");
    await mutation("gate", { released: true });
  }
  const oldCompletion = await waitFor(
    () => rows("pendingCompletion"),
    (items) => items.some((item: { workId: string }) => item.workId === failureId),
    "old failed completion persisted",
  );
  const failedOld = oldCompletion.find((item: { workId: string }) => item.workId === failureId);
  assert.ok(failedOld);
  assert.equal(failedOld.runResult.kind, "failed");
  assert.equal(failedOld.retry, false);
  assert.match(failedOld.runResult.error, /retained-completion/);
  assert.ok(
    oldCompletion.every(
      (item: { runResult: object }) => !Object.hasOwn(item.runResult, "errorData"),
    ),
  );
  const before = {
    report: await query("reportRow", { reportId: queued.reportId }),
    work: await rows("work"),
    start: await rows("pendingStart"),
    completion: oldCompletion,
    globals: await rows("globals"),
  };
  assert.equal(before.report.state, "pending");
  assert.equal(before.globals[0].maxParallelism, 0);
  assert.ok(before.start.some((item: { workId: string }) => item.workId === before.report.workId));
  console.log(
    JSON.stringify({
      phase: "retained-baseline",
      queuedReport: true,
      failedCompletion: true,
      pendingStarts: before.start.length,
      completions: before.completion.length,
    }),
  );
  for (const [file, text] of original) writeFileSync(join(capsule, file), text);
  writeFileSync(join(capsule, "bun.lock"), candidateLock);
  await command(["bun", "install", "--ignore-scripts", "--frozen-lockfile"]);
  const candidate = packageProof();
  assert.equal(candidate.convex, "1.50.0");
  assert.equal(candidate.workpool, "0.4.16");
  assert.deepEqual(candidate, packageProof(root));
  await push();
  const after = {
    report: await query("reportRow", { reportId: queued.reportId }),
    work: await rows("work"),
    start: await rows("pendingStart"),
    completion: await rows("pendingCompletion"),
    globals: await rows("globals"),
  };
  assert.deepEqual(after, before, "Paused persisted state changed across upgrade.");
  console.log(
    JSON.stringify({ phase: "upgraded-paused", persistedStateUnchanged: true, candidate }),
  );
  await mutation("parallelism", { value: 1 });
  const ready = await waitFor(
    () =>
      client.action(makeFunctionReference<"action">("searchReports:get"), {
        reportId: queued.reportId,
      }),
    (value) => value.status === "ready",
    "retained report completed",
  );
  assert.equal(ready.reportId, queued.reportId);
  await waitFor(
    () => rows("pendingCompletion"),
    (items) => items.length === 0,
    "old completion drained",
  );
  await waitFor(
    () => rows("work"),
    (items) => items.length === 0,
    "retained work finished",
  );
  await mutation("gate", { started: false, released: false });
  const candidateFailureId = await mutation("startFailure");
  await waitFor(
    () => query("observeGate"),
    (gate) => gate.started,
    "new action started",
  );
  await mutation("parallelism", { value: 0 });
  await mutation("gate", { released: true });
  const newCompletion = await waitFor(
    () => rows("pendingCompletion"),
    (items) => items.some((item: { workId: string }) => item.workId === candidateFailureId),
    "new errorData persisted",
  );
  const failedNew = newCompletion.find(
    (item: { workId: string }) => item.workId === candidateFailureId,
  );
  assert.ok(failedNew);
  assert.equal(failedNew.runResult.kind, "failed");
  assert.equal(failedNew.retry, false);
  assert.deepEqual(failedNew.runResult.errorData, { fixture: "retained-completion" });
  passed = true;
  console.log(
    JSON.stringify({
      phase: "passed",
      backendVersion,
      binarySha256,
      sourceHash: inputs.sourceHash,
      baseline,
      candidate,
      retainedReportCompleted: true,
      oldCompletionPreserved: true,
      newErrorDataStored: true,
      rollbackQualified: false,
    }),
  );
}

try {
  await main();
} finally {
  await stopBackend();
  if (ownCapsule && passed) rmSync(capsule, { recursive: true, force: true });
  else if (ownCapsule)
    console.error("Retained the owned component-upgrade capsule after failure; backend stopped.");
}
