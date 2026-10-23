/* @vitest-environment node */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  diagnosticArtifactMetadata,
  DIAGNOSTIC_PROCESS_BUDGET_MS,
  main,
  runDiagnosticProcess,
} from "./run-clawscan-diagnostic";

const event =
  '[clawscan-progress] {"schemaVersion":"clawscan-progress-v1","event":"child_event","phase":"judge","elapsedMs":12,"pid":42,"sequence":1,"childEvent":"item.started","childItem":"command_execution","childState":"in_progress","command":"PRIVATE","stderr":"PRIVATE","key":"PRIVATE"}';

it("retains only safe live diagnostics through actual process-group kill; progress is never a verdict", async () => {
  const root = await mkdtemp(join(tmpdir(), "diagnostic-cli-test-"));
  try {
    const eventsPath = join(root, "events.jsonl");
    const artifactPath = join(root, "artifact.json");
    const pending = runDiagnosticProcess(
      process.execPath,
      [
        "-e",
        `process.stderr.write(${JSON.stringify(event + "\nPRIVATE raw stderr\n")}); process.stdout.write('PRIVATE stdout'); setInterval(()=>{},1000);`,
      ],
      {
        cwd: root,
        env: { CLAWSCAN_PROGRESS: "1", CLAWSCAN_CHILD_PROGRESS: "1" },
        eventsPath,
        artifactPath,
        timeoutMs: 1200,
      },
    );
    await expect
      .poll(async () => readFile(eventsPath, "utf8").catch(() => ""))
      .toContain("command_execution");
    const result = await pending;
    expect(result).toMatchObject({
      label: "NONPRODUCTION_DIAGNOSTIC",
      processStatus: "timed_out",
      artifact: "missing",
      consumerValidation: "unknown",
      acceptedPublication: false,
      recoveryEvidence: false,
      excludedFromSlos: true,
      exposure: {
        judgeInvocations: null,
        judgeOperationalFailures: null,
        recoveredReceiptRetries: null,
      },
      termination: { timedOut: true },
      lastProgress: {
        event: "child_event",
        phase: "judge",
        childItem: "command_execution",
        childState: "in_progress",
      },
    });
    expect(JSON.stringify(result) + (await readFile(eventsPath, "utf8"))).not.toContain("PRIVATE");
    expect(result.termination!.cleanupMs).toBeLessThan(60_000);
    expect(await readFile(eventsPath, "utf8")).toContain('"childState":"in_progress"');
    expect(await readFile(eventsPath, "utf8")).not.toContain("item.completed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("does not turn missing, malformed, partial or progress-only final metadata into zero exposure", async () => {
  const root = await mkdtemp(join(tmpdir(), "diagnostic-artifact-test-"));
  try {
    const path = join(root, "artifact.json");
    for (const raw of [
      undefined,
      "PRIVATE raw",
      event,
      JSON.stringify({
        schemaVersion: "clawscan-run-v1",
        profile: "clawhub",
        judge: { status: "completed", result: { verdict: "clean" } },
      }),
    ]) {
      if (raw !== undefined) await writeFile(path, raw);
      const result = await diagnosticArtifactMetadata(path);
      expect(result.exposure.judgeInvocations).toBeNull();
      expect(result.exposure.judgeOperationalFailures).toBeNull();
      expect(result.consumerValidation).not.toBe("validated_ephemerally_not_published");
      expect(JSON.stringify(result)).not.toContain("PRIVATE");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("keeps last progress null without events and discloses the existing retention limit", async () => {
  const root = await mkdtemp(join(tmpdir(), "diagnostic-last-progress-test-"));
  try {
    const silent = await runDiagnosticProcess(process.execPath, ["-e", ""], {
      cwd: root,
      env: {},
      timeoutMs: 1200,
      eventsPath: join(root, "silent.jsonl"),
      artifactPath: join(root, "missing.json"),
    });
    expect(silent.lastProgress).toBeNull();
    const result = await runDiagnosticProcess(
      process.execPath,
      [
        "-e",
        `
        const fs = require('node:fs');
        for (let index = 0; index < 2049; index++) {
          fs.writeSync(2, '[clawscan-progress] ' + JSON.stringify({
            schemaVersion: 'clawscan-progress-v1', event: 'phase_start',
            phase: 'scanner:skillspector', elapsedMs: index,
            path: 'PRIVATE', message: 'PRIVATE', provider: 'PRIVATE'
          }) + '\\n');
        }
        `,
      ],
      {
        cwd: root,
        env: {},
        timeoutMs: 1200,
        eventsPath: join(root, "limited.jsonl"),
        artifactPath: join(root, "missing.json"),
      },
    );
    expect(result.lastProgress).toEqual({
      schemaVersion: "clawscan-progress-v1",
      event: "phase_start",
      phase: "scanner:skillspector",
      elapsedMs: 2047,
    });
    expect(result.diagnosticRecords).toEqual({ retained: 2048, rejected: 0, limited: 1 });
    expect(result.exposure.judgeInvocations).toBeNull();
    expect(result.artifact).toBe("missing");
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("rejects the real CLI before touching any runtime or credentials on the Mac", async () => {
  if (process.platform === "darwin") {
    for (const fixture of [
      "tiny",
      "incident",
      "receipt-incident",
      "small-timeout-paired",
      "original-scanner-only",
      "original-candidate-full",
      "original-candidate-290-full",
    ]) {
      await expect(main(["--fixture", fixture, "--source", "reviewed"])).rejects.toThrow(
        "Disposable Blacksmith",
      );
    }
    const result = await promisify(execFile)(
      "bun",
      [
        "scripts/security/run-clawscan-diagnostic.ts",
        "--fixture",
        "small-timeout-paired",
        "--source",
        "reviewed",
      ],
      { env: { PATH: process.env.PATH } },
    ).catch((error) => error);
    expect(result.code).toBe(1);
    expect(result.stderr.trim()).toBe(
      "NONPRODUCTION_DIAGNOSTIC failed; raw output suppressed; recovery unproven",
    );
    expect(result.stdout).toBe("");
  }
});

it("uses only manual bounded inputs, existing CI ENV keys and explicit safe metadata upload paths", async () => {
  const raw = await readFile(".github/workflows/clawscan-judge-diagnostic.yml", "utf8");
  const workflow = parseYaml(raw);
  expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
  expect(Object.keys(workflow.on.workflow_dispatch.inputs)).toEqual(["fixture", "source"]);
  expect(workflow.on.workflow_dispatch.inputs.fixture.options).toEqual([
    "tiny",
    "incident",
    "receipt-incident",
    "small-timeout-paired",
    "original-scanner-only",
    "original-candidate-full",
    "original-candidate-290-full",
  ]);
  expect(workflow.on.workflow_dispatch.inputs.source.options).toEqual(["reviewed", "incident"]);
  const job = workflow.jobs.diagnostic;
  expect(job["timeout-minutes"]).toBe(
    "${{ inputs.fixture == 'original-scanner-only' && 120 || 80 }}",
  );
  expect(job["runs-on"]).toBe("blacksmith-16vcpu-ubuntu-2404");
  expect(job.environment).toBe("Production");
  expect(workflow.permissions).toEqual({ contents: "read" });
  for (const name of [
    "Select bounded installer source",
    "Install matched reviewed scanner sources and Responses adapters",
  ]) {
    expect(job.steps.find((step: { name?: string }) => step.name === name).if).toBe(
      "${{ inputs.fixture != 'original-scanner-only' && inputs.fixture != 'original-candidate-full' && inputs.fixture != 'original-candidate-290-full' }}",
    );
  }
  const probe = job.steps.find((step: { id?: string }) => step.id === "probe");
  expect(probe.env.OPENAI_API_KEY).toBe("${{ secrets.OPENAI_API_KEY || secrets.CODEX_API_KEY }}");
  expect(probe.env.CODEX_API_KEY).toBe("${{ secrets.CODEX_API_KEY || secrets.OPENAI_API_KEY }}");
  const upload = job.steps.find(
    (step: { uses?: string }) => step.uses === "actions/upload-artifact@v7",
  );
  expect(
    upload.with.path
      .trim()
      .split("\n")
      .map((path: string) => path.split("/").at(-1)),
  ).toEqual(["summary.json", "events.jsonl", "attestation.json"]);
  expect(raw).not.toMatch(
    /CONVEX|WORKER_TOKEN|repository_dispatch|codex login|auth\.json|@latest|\*\.json/,
  );
  expect(DIAGNOSTIC_PROCESS_BUDGET_MS).toBe(900000);
});

it("projects only fixed stage enums independently of consumer acceptance without changing legacy metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "diagnostic-stage-test-"));
  try {
    const path = join(root, "artifact.json");
    await writeFile(
      path,
      JSON.stringify({
        schemaVersion: "clawscan-run-v1",
        profile: "clawhub",
        scanners: {
          aig: { status: "PRIVATE/path/key" },
          skillspector: { status: "skipped" },
          endor: { status: "failed", error: "PRIVATE" },
          unknown: { status: "completed" },
        },
        judge: { status: "PRIVATE error" },
      }),
    );
    const legacy = await diagnosticArtifactMetadata(path);
    expect(Object.keys(legacy)).toEqual(["artifact", "consumerValidation", "exposure"]);
    const paired = await diagnosticArtifactMetadata(path, true);
    expect(paired.stages).toEqual({
      scanners: {
        "clawscan-static": "unknown",
        aig: "unknown",
        skillspector: "skipped",
        endor: "failed",
      },
      judge: "unknown",
    });
    expect(paired.securityVerdict).toBeNull();
    expect(paired.exposure.judgeInvocations).toBeNull();
    expect(JSON.stringify(paired)).not.toContain("PRIVATE");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("refuses arbitrary concurrent event labels and unbounded indices before spawning", async () => {
  const root = await mkdtemp(join(tmpdir(), "diagnostic-envelope-test-"));
  try {
    for (const processIndex of [0, 5, 1.5]) {
      await expect(
        runDiagnosticProcess("not-a-command", [], {
          cwd: root,
          env: {},
          eventsPath: join(root, "events.jsonl"),
          artifactPath: join(root, "artifact.json"),
          eventContext: { leg: "initial-four", processIndex },
        }),
      ).rejects.toThrow("Invalid paired event context");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
