/* @vitest-environment node */
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { type DiagnosticEventContext, runPairedDiagnostic } from "./clawscan-diagnostic-pair";
import { runDiagnosticProcess } from "./run-clawscan-diagnostic";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function artifact(verdict = "benign", retry = false) {
  const result = {
    verdict,
    confidence: "high",
    summary: "PRIVATE model text",
    dimensions: Object.fromEntries(
      [
        "purpose_capability",
        "instruction_scope",
        "install_mechanism",
        "environment_proportionality",
        "persistence_privilege",
      ].map((name) => [name, { status: "ok", detail: "PRIVATE model text" }]),
    ),
    scan_findings_in_context: [],
    user_guidance: "PRIVATE model text",
    artifact_inspection: {
      version: 2,
      status: "completed",
      challenge: "b".repeat(64),
      required_file: "artifact/SKILL.md",
      required_file_sha256: "c".repeat(64),
      additional_files_inspected: [],
    },
  };
  const last = {
    status: "completed",
    error: "",
    result,
    durationMs: 10,
    challenge: "b".repeat(64),
    requiredFile: "artifact/SKILL.md",
    requiredFileSha256: "c".repeat(64),
  };
  return {
    schemaVersion: "clawscan-run-v1",
    profile: "clawhub",
    completedAt: "2026-10-23T08:00:00Z",
    scanners: {
      "clawscan-static": { status: "completed" },
      skillspector: { status: "completed", raw: { issues: [] } },
      aig: {
        status: "completed",
        raw: {
          version: "2.1.0",
          runs: [{ tool: { driver: { name: "aig-skill-scan", version: "0.2.1" } }, results: [] }],
        },
      },
    },
    judge: {
      configuredModel: "gpt-6.1-sol",
      status: "completed",
      error: "",
      result,
      attempts: retry
        ? [
            {
              ...last,
              status: "failed",
              error: "Judge artifact inspection challenge did not match the workspace challenge.",
              result: null,
              challenge: "a".repeat(64),
            },
            last,
          ]
        : [last],
    },
  };
}

type Mode =
  | "benign"
  | "suspicious"
  | "malicious"
  | "retry"
  | "failed"
  | "timeout"
  | "invalid"
  | "aig_failed"
  | "judge_failed";

async function harness(mode: (context: DiagnosticEventContext) => Mode = () => "benign") {
  const root = await mkdtemp(join(tmpdir(), "paired-diagnostic-test-"));
  roots.push(root);
  const home = join(root, "home");
  const codexHome = join(root, "codex-home");
  await mkdir(home);
  await mkdir(codexHome);
  const calls: {
    leg: string;
    index: number;
    cwd: string;
    output: string;
    home: string | undefined;
    codexHome: string | undefined;
    started: number;
    ended?: number;
  }[] = [];
  const options = {
    root,
    binary: "fixed-clawscan",
    env: { HOME: home, CODEX_HOME: codexHome },
    eventsPath: join(root, "events.jsonl"),
    materializeInput: async (target: string) => {
      await mkdir(target);
      await writeFile(join(target, "SKILL.md"), "inert controlled fixture");
    },
    runProcess: async (
      ...[command, args, processOptions]: Parameters<typeof runDiagnosticProcess>
    ) => {
      expect(command).toBe("fixed-clawscan");
      expect(args).toEqual([
        join(processOptions.cwd, "input"),
        "--profile",
        "clawhub",
        "--sandbox",
        "off",
        "--output",
        processOptions.artifactPath,
      ]);
      const context = processOptions.eventContext!;
      expect(processOptions.env.TMPDIR).toBe(processOptions.cwd);
      expect(processOptions.env.TMP).toBe(processOptions.cwd);
      expect(processOptions.env.TEMP).toBe(processOptions.cwd);
      const call = {
        leg: context.leg,
        index: context.processIndex,
        cwd: processOptions.cwd,
        output: processOptions.artifactPath,
        home: processOptions.env.HOME,
        codexHome: processOptions.env.CODEX_HOME,
        started: Date.now(),
        ended: undefined as number | undefined,
      };
      calls.push(call);
      const disposition = mode(context);
      const native = artifact(
        ["suspicious", "malicious"].includes(disposition) ? disposition : "benign",
        disposition === "retry",
      );
      if (disposition === "aig_failed") native.scanners.aig.status = "failed";
      if (disposition === "judge_failed") {
        native.judge.status = "failed";
        native.judge.error = "exit status 1";
        native.judge.attempts[0]!.status = "failed";
        native.judge.attempts[0]!.error = "exit status 1";
      }
      const raw = disposition === "invalid" ? "PRIVATE malformed artifact" : JSON.stringify(native);
      const result = await runDiagnosticProcess(
        process.execPath,
        [
          "-e",
          `
        const fs = require('node:fs');
        fs.writeFileSync(process.env.HOME + '/${context.leg}-${context.processIndex}', 'started');
        const interval = setInterval(() => {
          if(fs.readdirSync(process.env.HOME).filter(name=>name.startsWith('${context.leg}-')).length !== ${context.leg.endsWith("four") ? 4 : 1}) return;
          clearInterval(interval);
          if (${JSON.stringify(disposition)} === 'timeout') { setInterval(()=>{},1000); return; }
          fs.writeFileSync(${JSON.stringify(processOptions.artifactPath)}, ${JSON.stringify(raw)});
          process.stderr.write('[clawscan-progress] {"schemaVersion":"clawscan-progress-v1","event":"phase_end","phase":"judge","elapsedMs":15,"command":"PRIVATE","key":"PRIVATE"}\\nPRIVATE raw error\\n');
          if (${JSON.stringify(disposition)} === 'failed') process.exitCode = 1;
        }, 20);
      `,
        ],
        { ...processOptions, timeoutMs: disposition === "timeout" ? 400 : 2000 },
      );
      if (disposition !== "timeout")
        expect(await readFile(processOptions.artifactPath, "utf8")).toBe(raw);
      call.ended = Date.now();
      return result;
    },
  };
  return { root, home, codexHome, calls, options };
}

it("runs one to terminal then four together with distinct workspaces and one shared home", async () => {
  const probe = await harness();
  const result = await runPairedDiagnostic(probe.options);
  expect(result.status).toBe("completed");
  expect(result.confirmationTriggered).toBe(false);
  expect(result.scansStarted).toBe(5);
  expect(result.legs.map((leg) => [leg.id, leg.status, leg.processes.length])).toEqual([
    ["initial-singleton", "evaluated", 1],
    ["initial-four", "evaluated", 4],
    ["confirmation-four", "not_required", 0],
    ["confirmation-singleton", "not_required", 0],
  ]);
  expect(probe.calls.slice(1).every((call) => call.started >= probe.calls[0].ended!)).toBe(true);
  expect(Math.max(...probe.calls.slice(1).map((call) => call.started))).toBeLessThan(
    Math.min(...probe.calls.slice(1).map((call) => call.ended!)),
  );
  expect(new Set(probe.calls.map((call) => call.cwd)).size).toBe(5);
  expect(new Set(probe.calls.map((call) => call.output)).size).toBe(5);
  expect(new Set(probe.calls.map((call) => call.home))).toEqual(new Set([probe.home]));
  expect(new Set(probe.calls.map((call) => call.codexHome))).toEqual(new Set([probe.codexHome]));
  const events = (await readFile(probe.options.eventsPath, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const compare = (left: unknown, right: unknown) => String(left).localeCompare(String(right));
  expect(events.map((event) => [event.leg, event.processIndex]).sort(compare)).toEqual(
    [
      ["initial-singleton", 1],
      ["initial-four", 1],
      ["initial-four", 2],
      ["initial-four", 3],
      ["initial-four", 4],
    ].sort(compare),
  );
  expect(
    events.every(
      (event) =>
        event.schemaVersion === "clawscan-paired-event-v1" && event.progress.phase === "judge",
    ),
  ).toBe(true);
  expect(
    result.legs
      .slice(0, 2)
      .flatMap((leg) => leg.processes)
      .every(
        (entry) =>
          entry.result.termination?.processGroup === "absent" &&
          entry.result.diagnosticRecords.rejected === 1,
      ),
  ).toBe(true);
  expect(JSON.stringify(result) + JSON.stringify(events)).not.toMatch(
    /PRIVATE|artifact\/|codex-home|command|key/,
  );
  expect(await readdir(probe.home)).toHaveLength(5);
});

it("retains a rejected process runner as an unknown-cleanup failure and does not start later legs", async () => {
  const probe = await harness();
  const result = await runPairedDiagnostic({
    ...probe.options,
    runProcess: async () => {
      throw new Error("PRIVATE runner failure");
    },
  });
  expect(result.status).toBe("cleanup_unconfirmed");
  expect(result.scansStarted).toBe(1);
  expect(result.legs[0]!.processes).toHaveLength(1);
  expect(result.legs[0]!.processes[0]!.result).toMatchObject({
    processStatus: "start_or_observer_failed",
    termination: null,
    exposure: { judgeInvocations: null },
  });
  expect(
    result.legs.slice(1).every((leg) => leg.status === "unevaluated" && leg.processes.length === 0),
  ).toBe(true);
  expect(JSON.stringify(result)).not.toContain("PRIVATE");
});

it("retains every failure, timeout, receipt retry and native unknown through the bounded reversed-order confirmation", async () => {
  const probe = await harness((context) =>
    context.leg === "initial-four"
      ? (["timeout", "failed", "retry", "invalid"][context.processIndex - 1] as Mode)
      : context.leg === "confirmation-singleton"
        ? "malicious"
        : "benign",
  );
  const result = await runPairedDiagnostic(probe.options);
  expect(result.status).toBe("completed");
  expect(result.confirmationTriggered).toBe(true);
  expect(result.maximumScans).toBe(10);
  expect(result.scansStarted).toBe(10);
  expect(result.legs.map((leg) => [leg.id, leg.processes.length])).toEqual([
    ["initial-singleton", 1],
    ["initial-four", 4],
    ["confirmation-four", 4],
    ["confirmation-singleton", 1],
  ]);
  const initialFour = result.legs[1]!.processes.map((entry) => entry.result);
  expect(initialFour.map((entry) => entry.processStatus)).toEqual([
    "timed_out",
    "failed",
    "completed",
    "completed",
  ]);
  expect(
    initialFour.map((entry) => [
      entry.exposure.judgeInvocations,
      entry.exposure.judgeOperationalFailures,
      entry.exposure.recoveredReceiptRetries,
    ]),
  ).toEqual([
    [null, null, null],
    [1, 0, 0],
    [2, 1, 1],
    [null, null, null],
  ]);
  expect(initialFour.map((entry) => entry.consumerValidation)).toEqual([
    "unknown",
    "validated_ephemerally_not_published",
    "validated_ephemerally_not_published",
    "unknown",
  ]);
  expect(result.legs[3]!.processes[0]!.result).toMatchObject({
    securityVerdict: "malicious",
    consumerValidation: "validated_ephemerally_not_published",
  });
  for (let index = 1; index < result.legs.length; index += 1) {
    const previous = probe.calls.filter((call) => call.leg === result.legs[index - 1]!.id);
    const current = probe.calls.filter((call) => call.leg === result.legs[index]!.id);
    expect(Math.min(...current.map((call) => call.started))).toBeGreaterThanOrEqual(
      Math.max(...previous.map((call) => call.ended!)),
    );
  }
  expect(JSON.stringify(result) + (await readFile(probe.options.eventsPath, "utf8"))).not.toContain(
    "PRIVATE",
  );
});

it.each(["timeout", "retry"] as const)(
  "does not trigger a reverse pair when the singleton has a %s",
  async (mode) => {
    const probe = await harness((context) =>
      context.leg === "initial-singleton" ? mode : "suspicious",
    );
    const result = await runPairedDiagnostic(probe.options);
    expect(result.confirmationTriggered).toBe(false);
    expect(result.scansStarted).toBe(5);
    expect(
      result.legs[1]!.processes.every((entry) => entry.result.securityVerdict === "suspicious"),
    ).toBe(true);
  },
);

it("triggers confirmation for a recovered concurrent native failure without hiding it", async () => {
  const probe = await harness((context) =>
    context.leg.endsWith("four") && context.processIndex === 2 ? "retry" : "benign",
  );
  const result = await runPairedDiagnostic(probe.options);
  expect(result.scansStarted).toBe(10);
  expect(
    result.legs
      .flatMap((leg) => leg.processes)
      .map((entry) => entry.result.exposure.judgeOperationalFailures),
  ).toEqual([0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
});

it.each(["initial-singleton", "initial-four", "confirmation-four"] as const)(
  "stops all subsequent legs when %s cleanup is unknown",
  async (leg) => {
    const probe = await harness((context) =>
      context.leg === "initial-four" && context.processIndex === 1 ? "retry" : "benign",
    );
    const result = await runPairedDiagnostic({
      ...probe.options,
      runProcess: async (...args) => {
        const terminal = await probe.options.runProcess(...args);
        return args[2].eventContext!.leg === leg
          ? {
              ...terminal,
              termination: { ...terminal.termination!, processGroup: "unknown" as const },
            }
          : terminal;
      },
    });
    expect(result.status).toBe("cleanup_unconfirmed");
    const stopped = result.legs.findIndex((entry) => entry.id === leg);
    expect(
      result.legs
        .slice(stopped + 1)
        .every((entry) => entry.status === "unevaluated" && entry.processes.length === 0),
    ).toBe(true);
    expect(result.scansStarted).toBe([1, 5, 9][stopped]);
  },
);

it("preserves prior terminal results when preparing another leg fails closed", async () => {
  const probe = await harness();
  let prepared = 0;
  const result = await runPairedDiagnostic({
    ...probe.options,
    materializeInput: async (target) => {
      prepared += 1;
      if (prepared > 1) throw new Error("PRIVATE setup failure");
      return probe.options.materializeInput(target);
    },
  });
  expect(result.status).toBe("orchestration_failed");
  expect(result.scansStarted).toBe(1);
  expect(result.legs[0]!.processes[0]!.result.processStatus).toBe("completed");
  expect(result.legs.slice(1).every((entry) => entry.status === "unevaluated")).toBe(true);
  expect(JSON.stringify(result)).not.toContain("PRIVATE");
});

it("envelopes only bounded safe events and preserves per-process event drops and limits", async () => {
  const probe = await harness();
  const result = await runPairedDiagnostic({
    ...probe.options,
    runProcess: async (_command, _args, options) => {
      const event =
        '[clawscan-progress] {"schemaVersion":"clawscan-progress-v1","event":"phase_start","phase":"judge","elapsedMs":1,"command":"PRIVATE"}';
      return runDiagnosticProcess(
        process.execPath,
        [
          "-e",
          `process.stderr.write(${JSON.stringify(event + "\n")}.repeat(2050) + 'PRIVATE'.repeat(1300) + '\\n');`,
        ],
        options,
      );
    },
  });
  expect(result.scansStarted).toBe(5);
  expect(
    result.legs
      .slice(0, 2)
      .flatMap((leg) => leg.processes)
      .every(
        (entry) =>
          entry.result.diagnosticRecords.retained === 2048 &&
          entry.result.diagnosticRecords.limited === 2 &&
          entry.result.diagnosticRecords.rejected === 1 &&
          entry.result.exposure.judgeInvocations === null,
      ),
  ).toBe(true);
  const lines = (await readFile(probe.options.eventsPath, "utf8")).trim().split("\n");
  expect(lines).toHaveLength(5 * 2048);
  expect(lines.join("\n")).not.toContain("PRIVATE");
  expect(Object.keys(JSON.parse(lines[0]!))).toEqual([
    "schemaVersion",
    "leg",
    "processIndex",
    "progress",
  ]);
});

it("distinguishes scanner failure with a completed native judge from native judge failure", async () => {
  const probe = await harness((context) =>
    context.leg === "initial-four"
      ? (["aig_failed", "judge_failed", "benign", "benign"][context.processIndex - 1] as Mode)
      : "benign",
  );
  const result = await runPairedDiagnostic(probe.options);
  const processes = result.legs[1]!.processes.map((entry) => entry.result);
  expect(processes[0]).toMatchObject({
    consumerValidation: "rejected",
    stages: {
      scanners: {
        aig: "failed",
        skillspector: "completed",
        "clawscan-static": "completed",
        endor: "unknown",
      },
      judge: "completed",
    },
    exposure: { judgeInvocations: 1, judgeOperationalFailures: 0 },
  });
  expect(processes[1]).toMatchObject({
    consumerValidation: "rejected",
    stages: { scanners: { aig: "completed" }, judge: "failed" },
    exposure: { judgeInvocations: 1, judgeOperationalFailures: 1 },
  });
  expect(result.scansStarted).toBe(10);
});

it("keeps concurrent output-limit failures while awaiting every peer before the reverse pair", async () => {
  const probe = await harness();
  const result = await runPairedDiagnostic({
    ...probe.options,
    runProcess: async (...args) => {
      if (
        args[2].eventContext!.leg === "initial-four" &&
        args[2].eventContext!.processIndex === 4
      ) {
        const terminal = await runDiagnosticProcess(
          process.execPath,
          ["-e", "process.stderr.write('X'.repeat(1024*1024+1));setInterval(()=>{},1000)"],
          { ...args[2], timeoutMs: 2000 },
        );
        await writeFile(join(probe.home, "initial-four-4"), "finished output-limited child");
        return terminal;
      }
      return probe.options.runProcess(...args);
    },
  });
  expect(result.scansStarted).toBe(10);
  expect(result.legs[1]!.processes[3]!.result).toMatchObject({
    processStatus: "output_limited",
    termination: { outputLimitExceeded: "stderr", processGroup: "absent" },
    exposure: { judgeInvocations: null },
  });
});
