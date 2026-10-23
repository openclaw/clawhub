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

it("rejects the real CLI before touching any runtime or credentials on the Mac", async () => {
  if (process.platform === "darwin") {
    await expect(main(["--fixture", "incident", "--source", "reviewed"])).rejects.toThrow(
      "Disposable Blacksmith",
    );
    const result = await promisify(execFile)(
      "bun",
      [
        "scripts/security/run-clawscan-diagnostic.ts",
        "--fixture",
        "incident",
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
  ]);
  expect(workflow.on.workflow_dispatch.inputs.source.options).toEqual(["reviewed", "incident"]);
  const job = workflow.jobs.diagnostic;
  expect(job["runs-on"]).toBe("blacksmith-16vcpu-ubuntu-2404");
  expect(job.environment).toBe("Production");
  expect(workflow.permissions).toEqual({ contents: "read" });
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
