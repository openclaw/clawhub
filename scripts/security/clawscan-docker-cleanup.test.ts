/* @vitest-environment node */
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { afterEach, describe, expect, it } from "vitest";
import {
  CommandFailure,
  runWorkerCommand,
  type WorkerCommandTermination,
} from "../lib/runWorkerCommand";
import {
  ClawScanContainerCleanupError,
  hasKnownClawScanChildFinality,
  withClawScanDockerCleanup,
} from "./clawscan-docker-cleanup";

const dirs: string[] = [];
const a = "a".repeat(64);
const b = "b".repeat(64);
const c = "c".repeat(64);
const foreign = "f".repeat(64);
const normal: WorkerCommandTermination = {
  elapsedMs: 1,
  cleanupMs: 0,
  processGroup: "absent",
  exitCode: 0,
  timedOut: false,
  outputLimitExceeded: null,
};

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

type Container = {
  id: string;
  runId?: string;
  commandId?: string;
  actualId?: string;
  extra?: string;
  forceListed?: boolean;
  autoRemoveInspect?: boolean;
  autoRemoveRm?: boolean;
  rmFails?: boolean;
  retainAfterRm?: boolean;
  changeCommandAfterRm?: boolean;
};
type State = {
  runId?: string;
  containers?: Container[];
  lateAtPoll?: Record<string, Container[]>;
  mode?: string;
  listOutput?: string;
  polls?: number;
  removed?: string[];
};
type Log = { args: string[]; env: Record<string, string> };

async function fixture(initial: State = {}) {
  const workspace = await mkdtemp(join(tmpdir(), "clawscan-cleanup-test-"));
  dirs.push(workspace);
  const bin = join(workspace, "bin");
  await mkdir(bin);
  const path = join(workspace, "state.json");
  await writeFile(path, JSON.stringify({ containers: [], polls: 0, removed: [], ...initial }));
  const docker = join(bin, "docker");
  await writeFile(
    docker,
    String.raw`#!/usr/bin/env node
const fs = require('node:fs');
const path = 'state.json';
const state = JSON.parse(fs.readFileSync(path, 'utf8'));
const args = process.argv.slice(2);
fs.appendFileSync('docker.jsonl', JSON.stringify({args, env: process.env}) + '\n');
const save = () => fs.writeFileSync(path, JSON.stringify(state));
const fail = message => {save(); console.error(message); process.exit(1);};
const missing = id => fail('Error: No such object: ' + id);
if (args[0] !== 'container') fail('unexpected Docker command');
const action = args[1];
if (state.mode === action + '-error') fail('Cannot connect to the Docker daemon');
if (state.mode === 'hang-' + action) {setTimeout(() => {}, 10000); return;}
if (action === 'ls') {
  state.polls++;
  const expected = 'label=org.openclaw.clawscan.run-id=' + state.runId;
  if (args.join('|') !== ['container','ls','--all','--quiet','--no-trunc','--filter',expected].join('|')) fail('incorrect ownership filter');
  state.containers.push(...(state.lateAtPoll?.[state.polls] || []));
  save();
  if (state.mode === 'ls-flood') {console.log('a'.repeat(150000)); return;}
  console.log(state.listOutput ?? state.containers.filter(item => item.forceListed || (item.runId ?? state.runId) === state.runId).map(item => item.id).join('\n'));
  return;
}
const id = args.at(-1);
const item = state.containers.find(item => item.id === id);
if (action === 'inspect') {
  const format = '{{ .Id }}\n{{ index .Config.Labels "org.openclaw.clawscan.run-id" }}\n{{ index .Config.Labels "org.openclaw.clawscan.command-id" }}';
  if (args[2] !== '--format' || args[3] !== format) fail('unsafe or incorrect inspect format');
  if (state.mode === 'inspect-mixed-error') fail('Error: No such object: ' + id + '\nCannot connect to the Docker daemon');
  if (state.mode === 'missing-other-id') missing('f'.repeat(64));
  if (!item) missing(id);
  if (item.autoRemoveInspect) {
    state.containers = state.containers.filter(other => other.id !== id);
    missing(id);
  }
  console.log([item.actualId ?? id, item.runId ?? state.runId, item.commandId ?? 'A'.repeat(26), ...(item.extra ? [item.extra] : [])].join('\n'));
  return;
}
if (action === 'rm') {
  if (args.join('|') !== ['container','rm','--force','--volumes',id].join('|') || !/^[a-f0-9]{64}$/.test(id)) fail('unsafe removal target');
  if (!item) missing(id);
  if (item.rmFails) fail('removal failed');
  if (item.autoRemoveRm) {
    state.containers = state.containers.filter(other => other.id !== id);
    missing(id);
  }
  state.removed.push(id);
  if (item.changeCommandAfterRm) item.commandId = 'B'.repeat(26);
  if (!item.retainAfterRm) state.containers = state.containers.filter(other => other.id !== id);
  save();
  console.log(id);
  return;
}
fail('unexpected Docker action');
`,
  );
  await chmod(docker, 0o755);
  const env: NodeJS.ProcessEnv = {
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    HOME: workspace,
    DOCKER_CONFIG: join(workspace, "docker-context"),
    DOCKER_HOST: "unix:///fake-docker.sock",
    DOCKER_CONTEXT: "fixture-context",
    OPENAI_API_KEY: "must-not-reach-docker-cleanup",
    SECURITY_SCAN_WORKER_TOKEN: "must-not-reach-docker-cleanup",
    CLAWSCAN_SANDBOX_RUN_ID: "stale-inherited-run",
  };
  const state = async () => JSON.parse(await readFile(path, "utf8")) as State;
  const logs = async () =>
    (await readFile(join(workspace, "docker.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Log);
  const setupRun = async (childEnv: NodeJS.ProcessEnv) => {
    const next = await state();
    next.runId = childEnv.CLAWSCAN_SANDBOX_RUN_ID;
    await writeFile(path, JSON.stringify(next));
  };
  const run = async (
    childEnv: NodeJS.ProcessEnv,
    onTermination: (event: WorkerCommandTermination) => void,
  ) => {
    await setupRun(childEnv);
    onTermination(normal);
    return "scan-result";
  };
  return { workspace, env, state, logs, setupRun, run, confirmChildFinality: async () => true };
}

async function cleanupError(promise: Promise<unknown>) {
  try {
    await promise;
    throw new Error("cleanup unexpectedly succeeded");
  } catch (error) {
    expect(error).toBeInstanceOf(ClawScanContainerCleanupError);
    const cleanup = error as ClawScanContainerCleanupError;
    expect(cleanup.preserveWorkspace).toBe(true);
    expect(cleanup.workerMustStop).toBe(true);
    expect(cleanup.message).toContain("preserve workspace and stop worker");
    return cleanup;
  }
}

describe("ClawScan supervising-worker Docker cleanup", () => {
  it("does not infer child finality from an omitted callback", async () => {
    const f = await fixture();
    await cleanupError(
      withClawScanDockerCleanup({ ...f, confirmChildFinality: undefined, cleanupTimeoutMs: 1200 }),
    );
  });

  it("does not certify host-zero completion when an optional overview cancelled a child", async () => {
    const f = await fixture({ lateAtPoll: { "3": [{ id: a }] } });
    const artifact = {
      schemaVersion: "clawscan-run-v1",
      status: "completed",
      complete: true,
      judge: { result: { verdict: "benign" } },
      overview: { status: "failed", commandStarted: true, error: "Overview timed out after 5m" },
    };
    expect(hasKnownClawScanChildFinality(artifact)).toBe(false);
    await cleanupError(
      withClawScanDockerCleanup({
        ...f,
        cleanupTimeoutMs: 2500,
        pollIntervalMs: 10,
        confirmChildFinality: async () => hasKnownClawScanChildFinality(artifact),
      }),
    );
    expect((await f.state()).removed).toEqual([a]);
    expect((await f.state()).polls).toBeGreaterThan(3);
    expect(artifact.judge.result.verdict).toBe("benign");
  });
  it.each([
    undefined,
    { schemaVersion: "clawscan-run-v1", status: "completed", complete: true, overview: {} },
  ])(
    "fails closed when child-command finality evidence is missing or malformed: %j",
    async (artifact) => {
      const f = await fixture();
      await cleanupError(
        withClawScanDockerCleanup({
          ...f,
          cleanupTimeoutMs: 1200,
          confirmChildFinality: async () => hasKnownClawScanChildFinality(artifact),
        }),
      );
    },
  );
  it("distinguishes absent/non-started overview from a cancelled started overview", () => {
    const run = { schemaVersion: "clawscan-run-v1", status: "completed", complete: true };
    expect(hasKnownClawScanChildFinality(run)).toBe(true);
    // The native Docker runner omits positive shell-start metadata even after
    // successful overview output; completed/error-empty is authoritative.
    expect(
      hasKnownClawScanChildFinality({ ...run, overview: { status: "completed", error: "" } }),
    ).toBe(true);
    expect(
      hasKnownClawScanChildFinality({
        ...run,
        overview: { status: "failed", error: "Overview timed out" },
      }),
    ).toBe(false);
    expect(
      hasKnownClawScanChildFinality({
        ...run,
        overview: { status: "failed", commandStarted: false },
      }),
    ).toBe(true);
    expect(
      hasKnownClawScanChildFinality({
        ...run,
        overview: { status: "completed", commandStarted: true, error: "" },
      }),
    ).toBe(true);
  });

  it("removes scanner, judge and overview by independently verified immutable IDs", async () => {
    const f = await fixture({
      containers: [
        { id: a },
        { id: b, commandId: "B".repeat(26) },
        { id: c, commandId: "C".repeat(26) },
        { id: foreign, runId: "another-run" },
      ],
    });
    expect(await withClawScanDockerCleanup({ ...f })).toBe("scan-result");
    const state = await f.state();
    expect(state.removed).toEqual([a, b, c]);
    expect(state.containers).toEqual([{ id: foreign, runId: "another-run" }]);
    const logs = await f.logs();
    expect(logs.filter((log) => log.args[1] === "inspect")).toHaveLength(6);
    expect(logs.at(-1)?.args[1]).toBe("ls");
    expect(state.polls).toBe(2);
    for (const log of logs) {
      expect(log.env.OPENAI_API_KEY).toBeUndefined();
      expect(log.env.SECURITY_SCAN_WORKER_TOKEN).toBeUndefined();
      expect(log.env.DOCKER_HOST).toBe(f.env.DOCKER_HOST);
      expect(log.env.DOCKER_CONFIG).toBe(f.env.DOCKER_CONFIG);
      expect(log.env.DOCKER_CONTEXT).toBe(f.env.DOCKER_CONTEXT);
    }
  });

  it("accepts normal --rm completion and verifies the empty label set again", async () => {
    const f = await fixture();
    expect(await withClawScanDockerCleanup({ ...f })).toBe("scan-result");
    expect((await f.logs()).map((log) => log.args[1])).toEqual(["ls", "ls"]);
  });

  it("uses fresh per-invocation IDs without mutating the source environment", async () => {
    const f = await fixture();
    await withClawScanDockerCleanup({ ...f });
    const first = (await f.state()).runId;
    await withClawScanDockerCleanup({ ...f });
    const second = (await f.state()).runId;
    expect(first).toMatch(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/);
    expect(first).not.toBe(second);
    expect(f.env.CLAWSCAN_SANDBOX_RUN_ID).toBe("stale-inherited-run");
  });

  it("works with the real shared host process termination callback", async () => {
    const f = await fixture();
    const result = await withClawScanDockerCleanup({
      ...f,
      run: async (env, onTermination) => {
        await f.setupRun(env);
        return await runWorkerCommand(
          process.execPath,
          ["-e", "process.stdout.write('native-host-result')"],
          {
            cwd: f.workspace,
            env,
            onTermination,
            cleanupProcessGroup: true,
            timeoutMs: 1000,
          },
        );
      },
    });
    expect(result.stdout).toBe("native-host-result");
  });

  it.each(["autoRemoveInspect", "autoRemoveRm"] as const)(
    "allows an auto-removal race at %s but verifies final absence",
    async (property) => {
      const f = await fixture({ containers: [{ id: a, [property]: true }] });
      await withClawScanDockerCleanup({ ...f });
      expect((await f.state()).containers).toEqual([]);
    },
  );

  it.each([
    { runId: "wrong-run", forceListed: true },
    { actualId: b },
    { commandId: "" },
    { commandId: "not-random" },
    { extra: "unexpected-field" },
  ])("refuses ownership mismatch %j without deleting that container", async (mismatch) => {
    const f = await fixture({ containers: [{ id: a, ...mismatch }, { id: b }] });
    await cleanupError(withClawScanDockerCleanup({ ...f }));
    expect((await f.state()).removed).toEqual([b]);
    expect(
      (await f.logs()).filter((log) => log.args[1] === "rm").map((log) => log.args.at(-1)),
    ).toEqual([b]);
  });

  it.each(["abc123", "--all", "a".repeat(65)])(
    "refuses non-immutable list ID %s",
    async (listOutput) => {
      const f = await fixture({ listOutput });
      await cleanupError(withClawScanDockerCleanup({ ...f }));
      expect((await f.logs()).some((log) => log.args[1] === "rm")).toBe(false);
    },
  );

  it("deduplicates IDs returned by Docker", async () => {
    const f = await fixture({ containers: [{ id: a }] });
    // A second listing with the same now-absent ID is harmless and still checked.
    await writeFile(
      join(f.workspace, "state.json"),
      JSON.stringify({ containers: [{ id: a }, { id: a }], polls: 0, removed: [] }),
    );
    await withClawScanDockerCleanup({ ...f });
    expect((await f.state()).removed).toEqual([a]);
  });

  it("removes later normal-completion residue found by the final verification", async () => {
    const f = await fixture({ lateAtPoll: { "2": [{ id: a }, { id: b }, { id: c }] } });
    await withClawScanDockerCleanup({ ...f, pollIntervalMs: 1 });
    expect((await f.state()).removed).toEqual([a, b, c]);
    expect((await f.state()).polls).toBe(4);
  });

  it("cleans multiple delayed creates after cancellation, but never claims daemon finality", async () => {
    const f = await fixture({ lateAtPoll: { "2": [{ id: a }], "4": [{ id: b }, { id: c }] } });
    const commandError = new CommandFailure("host timed out", null, "", "", true);
    const started = performance.now();
    const error = await cleanupError(
      withClawScanDockerCleanup({
        ...f,
        cleanupTimeoutMs: 2500,
        pollIntervalMs: 10,
        run: async (env, onTermination) => {
          await f.setupRun(env);
          onTermination({ ...normal, timedOut: true, exitCode: null });
          throw commandError;
        },
      }),
    );
    expect(performance.now() - started).toBeGreaterThanOrEqual(2300);
    expect(performance.now() - started).toBeLessThan(3500);
    expect((await f.state()).removed).toEqual([a, b, c]);
    expect((await f.state()).containers).toEqual([]);
    expect((error.cause as AggregateError).errors[0]).toBe(commandError);
  });

  it("does not trust failed host completion even if no container becomes visible", async () => {
    const f = await fixture();
    const commandError = new Error("host failed before finality was known");
    await cleanupError(
      withClawScanDockerCleanup({
        ...f,
        cleanupTimeoutMs: 2000,
        pollIntervalMs: 10,
        run: async (env) => {
          await f.setupRun(env);
          throw commandError;
        },
      }),
    );
    expect((await f.state()).polls).toBeGreaterThan(1);
  });

  it.each([
    undefined,
    { ...normal, processGroup: "unknown" as const },
    { ...normal, timedOut: true },
    { ...normal, outputLimitExceeded: "stdout" as const },
    { ...normal, exitCode: 1 },
  ])("fails closed on missing or unsafe host termination %j", async (termination) => {
    const f = await fixture();
    await cleanupError(
      withClawScanDockerCleanup({
        ...f,
        cleanupTimeoutMs: 160,
        pollIntervalMs: 10,
        run: async (env, notify) => {
          await f.setupRun(env);
          if (termination) notify(termination);
          return "result";
        },
      }),
    );
  });

  it("does not stop polling after removing one cancelled container", async () => {
    const f = await fixture({ containers: [{ id: a }], lateAtPoll: { "3": [{ id: b }] } });
    await cleanupError(
      withClawScanDockerCleanup({
        ...f,
        cleanupTimeoutMs: 1500,
        pollIntervalMs: 10,
        run: async (env, notify) => {
          await f.setupRun(env);
          notify({ ...normal, timedOut: true });
          throw new Error("cancelled");
        },
      }),
    );
    expect((await f.state()).removed).toEqual([a, b]);
    expect((await f.state()).polls).toBeGreaterThan(3);
  });

  it("continues safe sibling cleanup after rm failure and requires preservation", async () => {
    const f = await fixture({ containers: [{ id: a, rmFails: true }, { id: b }] });
    await cleanupError(withClawScanDockerCleanup({ ...f }));
    expect((await f.state()).removed).toEqual([b]);
    expect((await f.state()).containers).toEqual([{ id: a, rmFails: true }]);
  });

  it.each([false, true])(
    "rejects successful rm without disappearance (changed command label: %s)",
    async (changeCommandAfterRm) => {
      const f = await fixture({
        containers: [{ id: a, retainAfterRm: true, changeCommandAfterRm }],
      });
      await cleanupError(withClawScanDockerCleanup({ ...f }));
      expect((await f.state()).removed).toEqual([a]);
      expect((await f.state()).containers).toHaveLength(1);
    },
  );

  it.each([
    "ls-error",
    "inspect-error",
    "rm-error",
    "inspect-mixed-error",
    "missing-other-id",
    "ls-flood",
  ])("does not mistake Docker error %s for absence", async (mode) => {
    const f = await fixture({ mode, containers: [{ id: a }] });
    await cleanupError(withClawScanDockerCleanup({ ...f }));
    expect((await f.state()).containers).toHaveLength(1);
  });

  it("enforces an overall cleanup deadline on an unresponsive Docker CLI", async () => {
    const f = await fixture({ mode: "hang-ls" });
    const started = performance.now();
    await cleanupError(withClawScanDockerCleanup({ ...f, cleanupTimeoutMs: 120 }));
    expect(performance.now() - started).toBeLessThan(700);
  });

  it.each([0, -1, NaN, Infinity, 10001])(
    "rejects unbounded cleanup timeout %s before invoking the host",
    async (cleanupTimeoutMs) => {
      const f = await fixture();
      await expect(withClawScanDockerCleanup({ ...f, cleanupTimeoutMs })).rejects.toBeInstanceOf(
        RangeError,
      );
      expect((await f.state()).runId).toBeUndefined();
    },
  );

  it.each([0, -1, Infinity, 1001])(
    "rejects invalid polling interval %s before invoking the host",
    async (pollIntervalMs) => {
      const f = await fixture();
      await expect(withClawScanDockerCleanup({ ...f, pollIntervalMs })).rejects.toBeInstanceOf(
        RangeError,
      );
      expect((await f.state()).runId).toBeUndefined();
    },
  );
});
