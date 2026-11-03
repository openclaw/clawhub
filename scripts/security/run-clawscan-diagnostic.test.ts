/* @vitest-environment node */
import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it, vi } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  assertDisposableDiagnosticEnvironment,
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
        "Disposable diagnostic",
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
  expect(Object.keys(workflow.on.workflow_dispatch.inputs)).toEqual([
    "fixture",
    "source",
    "runner",
    "age_recipient",
    "consumer",
  ]);
  expect(workflow.on.workflow_dispatch.inputs.fixture.options).toEqual([
    "tiny",
    "incident",
    "receipt-incident",
    "small-timeout-paired",
    "original-scanner-only",
    "original-candidate-full",
    "original-candidate-290-full",
    "original-038-encrypted",
    "original-079-encrypted",
    "original-004-encrypted",
    "original-016-encrypted",
    "original-017-encrypted",
    "original-026-encrypted",
    "original-027-encrypted",
    "original-074-encrypted",
    "original-008-encrypted",
    "original-011-encrypted",
    "original-036-encrypted",
    "original-033-encrypted",
    "original-065-encrypted",
    "original-073-encrypted",
    "original-042-encrypted",
    "original-055-encrypted",
    "original-039-encrypted",
    "original-010-encrypted",
    "original-019-encrypted",
    "original-005-encrypted",
    "original-006-encrypted",
    "original-015-encrypted",
  ]);
  expect(workflow.on.workflow_dispatch.inputs.source.options).toEqual(["reviewed", "incident"]);
  const job = workflow.jobs.diagnostic;
  expect(job["timeout-minutes"]).toBe(
    "${{ inputs.fixture == 'original-scanner-only' && 120 || 80 }}",
  );
  expect(workflow.on.workflow_dispatch.inputs.runner.options).toEqual([
    "blacksmith-16vcpu-ubuntu-2404",
    "ubuntu-22.04",
  ]);
  expect(workflow.on.workflow_dispatch.inputs.runner.default).toBe("blacksmith-16vcpu-ubuntu-2404");
  expect(job["runs-on"]).toBe(
    "${{ inputs.runner == 'ubuntu-22.04' && 'ubuntu-22.04' || 'blacksmith-16vcpu-ubuntu-2404' }}",
  );
  expect(job.env.CLAWSCAN_DIAGNOSTIC_RUNNER).toBe(job["runs-on"]);
  expect(job.if).toContain("inputs.source == 'reviewed'");
  expect(job.if).toContain(
    'inputs.fixture == \'tiny\' || contains(fromJSON(\'["original-038-encrypted","original-079-encrypted","original-004-encrypted","original-016-encrypted","original-017-encrypted","original-026-encrypted","original-027-encrypted","original-074-encrypted","original-008-encrypted","original-011-encrypted","original-036-encrypted","original-033-encrypted","original-065-encrypted","original-073-encrypted","original-042-encrypted","original-055-encrypted","original-039-encrypted","original-010-encrypted","original-019-encrypted","original-005-encrypted","original-006-encrypted","original-015-encrypted"]\'), inputs.fixture)',
  );
  expect(job.if).toContain(
    '!contains(fromJSON(\'["original-038-encrypted","original-079-encrypted","original-004-encrypted","original-016-encrypted","original-017-encrypted","original-026-encrypted","original-027-encrypted","original-074-encrypted","original-008-encrypted","original-011-encrypted","original-036-encrypted","original-033-encrypted","original-065-encrypted","original-073-encrypted","original-042-encrypted","original-055-encrypted","original-039-encrypted","original-010-encrypted","original-019-encrypted","original-005-encrypted","original-006-encrypted","original-015-encrypted"]\'), inputs.fixture)',
  );
  expect(job.if).toContain("inputs.runner == 'ubuntu-22.04'");
  expect(job.if).toContain("github.run_attempt == 1");
  expect(job.environment).toBe("Production");
  expect(workflow.permissions).toEqual({ contents: "read" });
  expect(workflow.concurrency).toEqual({
    group: "nonproduction-clawscan-judge-diagnostic",
    "cancel-in-progress": false,
  });
  expect(Object.keys(workflow.jobs)).toEqual(["diagnostic"]);
  for (const name of [
    "Select bounded installer source",
    "Install matched reviewed scanner sources and Responses adapters",
  ]) {
    expect(job.steps.find((step: { name?: string }) => step.name === name).if).toBe(
      '${{ inputs.fixture != \'original-scanner-only\' && inputs.fixture != \'original-candidate-full\' && inputs.fixture != \'original-candidate-290-full\' && !contains(fromJSON(\'["original-038-encrypted","original-079-encrypted","original-004-encrypted","original-016-encrypted","original-017-encrypted","original-026-encrypted","original-027-encrypted","original-074-encrypted","original-008-encrypted","original-011-encrypted","original-036-encrypted","original-033-encrypted","original-065-encrypted","original-073-encrypted","original-042-encrypted","original-055-encrypted","original-039-encrypted","original-010-encrypted","original-019-encrypted","original-005-encrypted","original-006-encrypted","original-015-encrypted"]\'), inputs.fixture) }}',
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
  const encryptedUpload = job.steps.find(
    (step: { name?: string }) => step.name === "Upload encrypted fixed original evidence only",
  );
  expect(encryptedUpload.with.name).toBe(
    "ENCRYPTED_ORIGINAL${{ inputs.fixture == 'original-079-encrypted' && '079' || inputs.fixture == 'original-004-encrypted' && '004' || inputs.fixture == 'original-016-encrypted' && '016' || inputs.fixture == 'original-017-encrypted' && '017' || inputs.fixture == 'original-026-encrypted' && '026' || inputs.fixture == 'original-027-encrypted' && '027' || inputs.fixture == 'original-074-encrypted' && '074' || inputs.fixture == 'original-008-encrypted' && '008' || inputs.fixture == 'original-011-encrypted' && '011' || inputs.fixture == 'original-036-encrypted' && '036' || inputs.fixture == 'original-033-encrypted' && '033' || inputs.fixture == 'original-065-encrypted' && '065' || inputs.fixture == 'original-073-encrypted' && '073' || inputs.fixture == 'original-042-encrypted' && '042' || inputs.fixture == 'original-055-encrypted' && '055' || inputs.fixture == 'original-039-encrypted' && '039' || inputs.fixture == 'original-010-encrypted' && '010' || inputs.fixture == 'original-019-encrypted' && '019' || inputs.fixture == 'original-005-encrypted' && '005' || inputs.fixture == 'original-006-encrypted' && '006' || inputs.fixture == 'original-015-encrypted' && '015' || '038' }}-${{ github.run_id }}",
  );
  expect(
    encryptedUpload.with.path
      .trim()
      .split("\n")
      .map((path: string) => path.split("/").at(-1)),
  ).toEqual(["capture.tar.gz.age", "receipt.json"]);
  expect(encryptedUpload.if).toBe(
    "${{ !cancelled() && steps.probe.outputs.encrypted-output != '' }}",
  );
  expect(probe.env.DIAGNOSTIC_AGE_RECIPIENT).toBe("${{ inputs.age_recipient }}");
  expect(probe.env.DIAGNOSTIC_AGE_BINARY).toBe("${{ steps.encryption.outputs.age-binary }}");
  expect(raw).not.toMatch(
    /CONVEX|WORKER_TOKEN|repository_dispatch|codex login|auth\.json|@latest|\*\.json/,
  );
  expect(DIAGNOSTIC_PROCESS_BUDGET_MS).toBe(900000);
});

it("pins recovery consumer code separately from the main workflow before local actions or provider credentials", async () => {
  const workflow = parseYaml(
    await readFile(".github/workflows/clawscan-judge-diagnostic.yml", "utf8"),
  );
  expect(workflow.on.workflow_dispatch.inputs.consumer).toMatchObject({
    type: "choice",
    options: ["workflow", "recovery-approved"],
    default: "workflow",
  });
  const steps = workflow.jobs.diagnostic.steps;
  expect(steps[0]).toMatchObject({
    name: "Validate diagnostic consumer selection",
    id: "consumer",
    shell: "bash",
    env: { GH_TOKEN: "${{ github.token }}", CONSUMER_CHOICE: "${{ inputs.consumer }}" },
  });
  expect(steps[1]).toMatchObject({
    uses: "actions/checkout@v7.0.1",
    with: { ref: "${{ steps.consumer.outputs.consumer-sha }}", "persist-credentials": false },
  });
  expect(steps[2]).toMatchObject({
    name: "Verify diagnostic consumer checkout",
    env: { EXPECTED_CONSUMER_SHA: "${{ steps.consumer.outputs.consumer-sha }}" },
  });
  expect(steps[2].run).toContain("git rev-parse HEAD");
  expect(steps[2].run).toContain('"$EXPECTED_CONSUMER_SHA"');
  const firstLocalAction = steps.findIndex((step: { uses?: string }) =>
    step.uses?.startsWith("./"),
  );
  const firstProviderCredential = steps.findIndex((step: { env?: Record<string, string> }) =>
    Object.keys(step.env ?? {}).some((key) => /^(OPENAI|CODEX|LLM)_API_KEY$/.test(key)),
  );
  expect(firstLocalAction).toBeGreaterThan(2);
  expect(firstProviderCredential).toBeGreaterThan(firstLocalAction);
  expect(JSON.stringify(steps.slice(0, 3))).not.toContain("secrets.");
});

it("executes the actual inline consumer guard against trusted and hostile dispatch inputs without network or keys", async () => {
  const workflow = parseYaml(
    await readFile(".github/workflows/clawscan-judge-diagnostic.yml", "utf8"),
  );
  const guard = workflow.jobs.diagnostic.steps.find(
    (step: { id?: string }) => step.id === "consumer",
  );
  expect(guard).toBeDefined();
  const consumer = "39c955143f13aa4ddb4c47272262e7e82e3e5340";
  const workflowCommit = "1f3ab438ef4b50da24c60c48b809e40b6564ae8c";
  const root = await mkdtemp(join(tmpdir(), "diagnostic-consumer-guard-"));
  try {
    const gh = join(root, "gh");
    await writeFile(
      gh,
      '#!/bin/sh\nprintf "%s\\n" "$*" >> "$GH_CAPTURE"\nprintf "%s\\n" "$GH_RESPONSE"\nexit "${GH_EXIT_CODE:-0}"\n',
    );
    await chmod(gh, 0o700);
    let attempt = 0;
    const execute = async (overrides: Record<string, string>) => {
      const id = String(attempt++);
      const output = join(root, `output-${id}`);
      const calls = join(root, `calls-${id}`);
      const provider = join(root, `provider-${id}`);
      const result = await promisify(execFile)(
        "bash",
        ["-c", `${guard.run}\nprintf reached > "$PROVIDER_MARKER"`],
        {
          env: {
            PATH: `${root}:/usr/bin:/bin`,
            GITHUB_OUTPUT: output,
            GITHUB_REPOSITORY: "openclaw/clawhub",
            GITHUB_EVENT_NAME: "workflow_dispatch",
            GITHUB_REF: "refs/heads/main",
            GITHUB_WORKFLOW_REF:
              "openclaw/clawhub/.github/workflows/clawscan-judge-diagnostic.yml@refs/heads/main",
            GITHUB_SHA: workflowCommit,
            GITHUB_WORKFLOW_SHA: workflowCommit,
            GITHUB_ACTOR: "Patrick-Erichsen",
            GITHUB_TRIGGERING_ACTOR: "Patrick-Erichsen",
            GITHUB_RUN_ATTEMPT: "1",
            CONSUMER_CHOICE: "recovery-approved",
            FIXTURE_CHOICE: "original-073-encrypted",
            SOURCE_CHOICE: "reviewed",
            RUNNER_CHOICE: "ubuntu-22.04",
            GH_CAPTURE: calls,
            GH_RESPONSE: `${consumer}\t${consumer}\ttrue`,
            PROVIDER_MARKER: provider,
            ...overrides,
          },
        },
      ).catch((error) => ({ code: error.code, stdout: error.stdout, stderr: error.stderr }));
      return {
        result,
        output: await readFile(output, "utf8").catch(() => ""),
        calls: await readFile(calls, "utf8").catch(() => ""),
        provider: await readFile(provider, "utf8").catch(() => ""),
      };
    };
    for (const actualWorkflow of [workflowCommit, "a".repeat(40)]) {
      const result = await execute({
        GITHUB_SHA: actualWorkflow,
        GITHUB_WORKFLOW_SHA: actualWorkflow,
      });
      expect(result.output).toBe(`consumer-sha=${consumer}\nworkflow-sha=${actualWorkflow}\n`);
      expect(result.calls).toContain(
        `repos/openclaw/clawhub/compare/${consumer}...${actualWorkflow}`,
      );
      expect(result.provider).toBe("reached");
    }
    for (const fixture of workflow.on.workflow_dispatch.inputs.fixture.options.filter(
      (value: string) => value.endsWith("-encrypted"),
    )) {
      expect((await execute({ FIXTURE_CHOICE: fixture })).provider, fixture).toBe("reached");
    }
    const legacy = await execute({ CONSUMER_CHOICE: "workflow", FIXTURE_CHOICE: "tiny" });
    expect(legacy.output).toBe(`consumer-sha=${workflowCommit}\nworkflow-sha=${workflowCommit}\n`);
    expect(legacy.calls).toBe("");
    expect(legacy.provider).toBe("reached");
    for (const overrides of [
      { CONSUMER_CHOICE: consumer },
      { CONSUMER_CHOICE: "main" },
      { GITHUB_REPOSITORY: "attacker/clawhub" },
      { GITHUB_EVENT_NAME: "pull_request" },
      { GITHUB_REF: "refs/heads/recovery" },
      { GITHUB_WORKFLOW_REF: "attacker/workflow@refs/heads/main" },
      { GITHUB_SHA: "main" },
      { GITHUB_WORKFLOW_SHA: "b".repeat(40) },
      { GITHUB_ACTOR: "untrusted" },
      { GITHUB_TRIGGERING_ACTOR: "untrusted" },
      { GITHUB_RUN_ATTEMPT: "2" },
      { SOURCE_CHOICE: "incident" },
      { RUNNER_CHOICE: "blacksmith-16vcpu-ubuntu-2404" },
      { FIXTURE_CHOICE: "tiny" },
      { FIXTURE_CHOICE: "original-999-encrypted" },
      { GH_RESPONSE: `${consumer}\t${consumer}\tfalse` },
      { GH_RESPONSE: `${consumer}\t${"b".repeat(40)}\ttrue` },
      { GH_RESPONSE: `${"b".repeat(40)}\t${consumer}\ttrue` },
      { GH_RESPONSE: "" },
      { GH_EXIT_CODE: "1" },
    ]) {
      const result = await execute(overrides);
      expect(result.result, JSON.stringify(overrides)).toMatchObject({ code: 1 });
      expect(result.output, JSON.stringify(overrides)).toBe("");
      expect(result.provider, JSON.stringify(overrides)).toBe("");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("stops a mismatched consumer checkout before reaching local actions or provider credentials", async () => {
  const workflow = parseYaml(
    await readFile(".github/workflows/clawscan-judge-diagnostic.yml", "utf8"),
  );
  const verify = workflow.jobs.diagnostic.steps.find(
    (step: { name?: string }) => step.name === "Verify diagnostic consumer checkout",
  );
  expect(verify).toBeDefined();
  const consumer = "39c955143f13aa4ddb4c47272262e7e82e3e5340";
  const root = await mkdtemp(join(tmpdir(), "diagnostic-consumer-checkout-"));
  try {
    const git = join(root, "git");
    await writeFile(git, '#!/bin/sh\nprintf "%s\\n" "$GIT_HEAD"\n');
    await chmod(git, 0o700);
    for (const head of [consumer, "a".repeat(40), "main", ""]) {
      const marker = join(root, `provider-${head || "empty"}`);
      const result = await promisify(execFile)(
        "bash",
        ["-c", `${verify.run}\nprintf reached > "$PROVIDER_MARKER"`],
        {
          env: {
            PATH: `${root}:/usr/bin:/bin`,
            EXPECTED_CONSUMER_SHA: consumer,
            GIT_HEAD: head,
            PROVIDER_MARKER: marker,
          },
        },
      ).catch((error) => ({ code: error.code }));
      if (head !== consumer) expect(result).toMatchObject({ code: 1 });
      expect(await readFile(marker, "utf8").catch(() => "")).toBe(
        head === consumer ? "reached" : "",
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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

afterEach(() => {
  vi.unstubAllGlobals();
});

it("admits the hosted recovery image only through an explicit tiny-control opt-in", async () => {
  vi.stubGlobal("process", {
    ...process,
    platform: "linux",
    env: {
      GITHUB_ACTIONS: "true",
      RUNNER_OS: "Linux",
      RUNNER_ARCH: "X64",
      CLAWSCAN_DIAGNOSTIC_RUNNER: "ubuntu-22.04",
      RUNNER_TEMP: "/inert-never-created",
    },
  });
  expect(() => assertDisposableDiagnosticEnvironment()).toThrow();
  expect(assertDisposableDiagnosticEnvironment(true)).toBe("/inert-never-created");
  for (const args of [
    ["--fixture", "incident", "--source", "reviewed"],
    ["--fixture", "tiny", "--source", "incident"],
    ["--fixture", "original-scanner-only", "--source", "reviewed"],
  ]) {
    await expect(main(args)).rejects.toThrow("Disposable diagnostic workflow required");
  }
  process.env.CLAWSCAN_DIAGNOSTIC_RUNNER = "untrusted-runner";
  expect(() => assertDisposableDiagnosticEnvironment(true)).toThrow();
});

it("binds only fixed original run names to their public recipient, including when no artifact is uploaded", async () => {
  const workflow = parseYaml(
    await readFile(".github/workflows/clawscan-judge-diagnostic.yml", "utf8"),
  );
  expect(workflow["run-name"]).toBe(
    '${{ contains(fromJSON(\'["original-038-encrypted","original-079-encrypted","original-004-encrypted","original-016-encrypted","original-017-encrypted","original-026-encrypted","original-027-encrypted","original-074-encrypted","original-008-encrypted","original-011-encrypted","original-036-encrypted","original-033-encrypted","original-065-encrypted","original-073-encrypted","original-042-encrypted","original-055-encrypted","original-039-encrypted","original-010-encrypted","original-019-encrypted","original-005-encrypted","original-006-encrypted","original-015-encrypted"]\'), inputs.fixture) && format(\'{0} {1}\', inputs.fixture, inputs.age_recipient) || \'Nonproduction ClawScan judge diagnostic\' }}',
  );
});
