/* @vitest-environment node */
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import {
  originalDiagnosticCases,
  originalManifests,
  ORIGINAL_BASELINE_SOURCE,
  ORIGINAL_CANDIDATE_SOURCE,
  materializeOriginalInput,
} from "./clawscan-diagnostic-original";
import * as scannerRuntime from "./clawscan-diagnostic-runtime";
import * as diagnosticRuntime from "./run-clawscan-diagnostic";
import {
  mainOriginalDiagnostic,
  runOriginalDiagnosticCases,
  runSkillSpectorDiagnosticProcess,
} from "./run-clawscan-original-diagnostic";

const sourceApproval = vi.hoisted(() => ({ override: undefined as string | null | undefined }));
vi.mock("./clawscan-diagnostic-original", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./clawscan-diagnostic-original")>();
  return {
    ...actual,
    get ORIGINAL_CANDIDATE_SOURCE() {
      return sourceApproval.override === undefined
        ? actual.ORIGINAL_CANDIDATE_SOURCE
        : sourceApproval.override;
    },
  };
});

it("fixes the four serial no-retry scanner controls, while full profile is separately selected", async () => {
  expect(originalDiagnosticCases("original-scanner-only").map((entry) => entry.id)).toEqual([
    "baseline175",
    "candidate175",
    "baseline290",
    "candidate290",
  ]);
  expect(originalDiagnosticCases("original-candidate-full").map((entry) => entry.id)).toEqual([
    "candidate175",
    "candidate290",
  ]);
  expect(() => originalDiagnosticCases("PRIVATE" as "original-scanner-only")).toThrow();
  let active = 0;
  let peak = 0;
  const order: string[] = [];
  const checkpoint = vi.fn();
  const result = await runOriginalDiagnosticCases({
    mode: "original-scanner-only",
    checkpoint,
    cleanupConfirmed: () => true,
    attempt: async (entry) => {
      active += 1;
      peak = Math.max(peak, active);
      order.push(entry.id);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return { status: "failed", executionSuccessful: false };
    },
  });
  expect(peak).toBe(1);
  expect(order).toEqual(["baseline175", "candidate175", "baseline290", "candidate290"]);
  expect(checkpoint).toHaveBeenCalledTimes(5);
  expect(result).toHaveLength(4);
  expect(result[1]).toMatchObject({
    id: "candidate175",
    status: "finished",
    result: { status: "failed" },
  });
  expect(JSON.stringify(result)).not.toContain("PRIVATE");
});

it("does not overlap later controls after unknown process cleanup or controller failure", async () => {
  for (const failsSetup of [false, true]) {
    const attempt = vi.fn(async () => {
      if (failsSetup) throw new Error("PRIVATE");
      return { cleanup: "unknown" };
    });
    const result = await runOriginalDiagnosticCases({
      mode: "original-scanner-only",
      attempt,
      cleanupConfirmed: () => false,
      checkpoint: async () => {},
    });
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(result[0]?.status).toBe(failsSetup ? "setup_or_controller_failed" : "finished");
    expect(result.slice(1).map((entry) => entry.status)).toEqual(
      Array(3).fill("not_started_after_failure"),
    );
  }
});

it("selects exactly candidate290 once without retries in the dedicated full-profile mode", async () => {
  const mode = "original-candidate-290-full";
  expect(originalDiagnosticCases(mode)).toEqual([
    { id: "candidate290", source: "candidate", fixture: "290" },
  ]);
  for (const failsSetup of [false, true]) {
    const attempt = vi.fn(async () => {
      if (failsSetup) throw new Error("inert setup failure");
      return { cleanup: "unknown" };
    });
    const checkpoint = vi.fn();
    const result = await runOriginalDiagnosticCases({
      mode,
      attempt,
      cleanupConfirmed: () => false,
      checkpoint,
    });
    expect(attempt).toHaveBeenCalledExactlyOnceWith({
      id: "candidate290",
      source: "candidate",
      fixture: "290",
    });
    expect(checkpoint).toHaveBeenCalledTimes(2);
    expect(result).toEqual([
      {
        id: "candidate290",
        status: failsSetup ? "setup_or_controller_failed" : "finished",
        result: failsSetup ? null : { cleanup: "unknown" },
      },
    ]);
  }
});

it("pins original logical manifests separately from public and reconstructed compressed archives", async () => {
  expect(ORIGINAL_BASELINE_SOURCE).toBe("9662307780b2834791e2b0be8b166b44f4144ef4");
  expect(ORIGINAL_CANDIDATE_SOURCE).toBe("fd5f18ad3365f623d4165740b124cd7f142d0556");
  for (const [fixture, count, bytes, manifestSha256] of [
    ["175", 175, 2530728, "a306ba4c3f30e8c42cc247070245661ab6fb5032cba6e4b3ae0b62239d7c223f"],
    ["290", 290, 14953416, "1b070ff79edb1ae7faf33aeb00fb4deeaa18fd385a64951fa3e0868d22c424c5"],
  ] as const) {
    const manifest = originalManifests[fixture];
    expect(manifest.files).toHaveLength(count);
    expect(manifest.files.reduce((sum, file) => sum + file.size, 0)).toBe(bytes);
    expect(manifest.manifestSha256).toBe(manifestSha256);
    expect(manifest.manifestCanonicalization).toBe("path,size,sha256");
  }
  expect(originalManifests["175"].archiveSha256).toBe(
    "b514483b18c66cd5301ca776cf1b12af222efa3c2a19afa178beb10f8f3fa0b5",
  );
  expect(originalManifests["290"].archiveSha256).toBe(
    "21ac58f03aa07566ca6194f5e563806eb152cb92e88056f376ebcb64487282f8",
  );
  expect(originalManifests["175"].files.find((file) => file.path === "_meta.json")).toEqual({
    path: "_meta.json",
    size: 83,
    sha256: "88b6667216ab5adf277d3479a841d1973fb0d2a8db00acf0ad74f8a6152e5d76",
  });
  expect(originalManifests["290"].files.find((file) => file.path === "_meta.json")).toBeUndefined();
  await expect(
    materializeOriginalInput("175", { archive: Buffer.from("PRIVATE") }, "/never-created"),
  ).rejects.toThrow("Missing original metadata");
});

it("requires actual locked SDK versions and strips unrecognized inventory fields", () => {
  const inventory = {
    openai: "2.44.0",
    "langchain-openai": "1.3.3",
    "langchain-core": "1.4.8",
    langgraph: "1.2.6",
    httpx: "0.28.1",
  };
  expect(
    scannerRuntime.validateOriginalSdkInventory({ ...inventory, arbitrary: "PRIVATE" }),
  ).toEqual(inventory);
  for (const invalid of [
    null,
    [],
    {},
    { ...inventory, openai: "3.37.0" },
    { ...inventory, "langchain-openai": "1.7.2" },
  ])
    expect(() => scannerRuntime.validateOriginalSdkInventory(invalid)).toThrow();
});

it.each([null, "not-a-source", ORIGINAL_BASELINE_SOURCE])(
  "refuses an unapproved candidate %s before installation, downloading, or provider calls",
  async (source) => {
    sourceApproval.override = source;
    const root = await mkdtemp(join(tmpdir(), "original-unapproved-test-"));
    const originalUmask = process.umask();
    vi.stubEnv("RUNNER_TEMP", root);
    vi.stubEnv("GITHUB_OUTPUT", join(root, "github-output"));
    const guard = vi
      .spyOn(diagnosticRuntime, "assertDisposableDiagnosticEnvironment")
      .mockImplementation(() => root);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const install = vi
      .spyOn(scannerRuntime, "installOriginalRuntime")
      .mockRejectedValue(new Error("Unapproved runtime install attempted"));
    try {
      await expect(mainOriginalDiagnostic("original-scanner-only")).rejects.toThrow(
        "Exact candidate source approval",
      );
      expect(fetchMock).not.toHaveBeenCalled();
      expect(install).not.toHaveBeenCalled();
      const { readdir } = await import("node:fs/promises");
      const [directory] = await readdir(root);
      expect(
        JSON.parse(await readFile(join(root, directory!, "summary.json"), "utf8")),
      ).toMatchObject({
        status: "candidate_source_not_approved",
        productionRecoverySamples: 0,
        attempts: [],
      });
    } finally {
      guard.mockRestore();
      install.mockRestore();
      sourceApproval.override = undefined;
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
      process.umask(originalUmask);
      await rm(root, { recursive: true, force: true });
    }
  },
);

it("retains a nonzero scanner terminal independently of judge time and suppresses raw process output", async () => {
  const root = await mkdtemp(join(tmpdir(), "scanner-process-test-"));
  try {
    const script = join(root, "python");
    const driver = join(root, "driver.cjs");
    await writeFile(script, `#!/bin/sh\nexec '${process.execPath}' '${driver}' "$@"\n`, {
      mode: 0o700,
    });
    await chmod(script, 0o700);
    await writeFile(
      driver,
      `const fs=require('node:fs'); const args=process.argv.slice(2); if(JSON.stringify(args.slice(0,4))!==JSON.stringify(['-I','-c','from skillspector.cli import app; app()','scan']))process.exit(9); fs.writeFileSync(args.at(-1),JSON.stringify({execution_successful:false,analysis_completeness:{is_complete:false,status:'failed'},issues:[{message:'PRIVATE'}]}),{mode:0o600}); console.log('PRIVATE stdout');console.error('PRIVATE stderr');process.exit(3);`,
    );
    const result = await runSkillSpectorDiagnosticProcess(
      script,
      join(root, "never-imported-input"),
      join(root, "terminal.json"),
      { cwd: root, env: { PATH: process.env.PATH }, timeoutMs: 2000 },
    );
    expect(result).toMatchObject({
      processStatus: "failed",
      judge: "disabled",
      consumerValidation: "not_run_scanner_only",
      termination: { exitCode: 3 },
      terminal: {
        presence: "present",
        executionSuccessful: false,
        completeness: { isComplete: false, status: "failed" },
        findings: { reported: 1 },
      },
    });
    expect(result.finishedMonotonicMs).toBeGreaterThan(result.startedMonotonicMs);
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("enforces one process cap, terminates owned descendants, and retains a partial terminal on timeout", async () => {
  const root = await mkdtemp(join(tmpdir(), "scanner-cleanup-test-"));
  try {
    const script = join(root, "python");
    const driver = join(root, "driver.cjs");
    await writeFile(script, `#!/bin/sh\nexec '${process.execPath}' '${driver}' "$@"\n`, {
      mode: 0o700,
    });
    await chmod(script, 0o700);
    await writeFile(
      driver,
      `const fs=require('node:fs');const child=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(join(root, "child.pid"))},String(child.pid));fs.writeFileSync(process.argv.at(-1),JSON.stringify({execution_successful:true,analysis_completeness:{is_complete:false,status:'partial'}}),{mode:0o600});setInterval(()=>{},1000);`,
    );
    const result = await runSkillSpectorDiagnosticProcess(
      script,
      join(root, "inert"),
      join(root, "terminal.json"),
      { cwd: root, env: { PATH: process.env.PATH }, timeoutMs: 3000 },
    );
    expect(result).toMatchObject({
      processStatus: "timed_out",
      termination: { timedOut: true },
      terminal: { presence: "present", completeness: { isComplete: false, status: "partial" } },
    });
    expect(result.termination!.cleanupMs).toBeLessThan(60_000);
    const childPid = Number(await readFile(join(root, "child.pid"), "utf8"));
    await expect
      .poll(() => {
        try {
          process.kill(childPid, 0);
          return false;
        } catch {
          return true;
        }
      })
      .toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("retains terminal scanner evidence after more than the worker stderr limit", async () => {
  const root = await mkdtemp(join(tmpdir(), "scanner-noisy-test-"));
  try {
    const script = join(root, "python");
    const driver = join(root, "driver.cjs");
    await writeFile(script, `#!/bin/sh\nexec '${process.execPath}' '${driver}' "$@"\n`, {
      mode: 0o700,
    });
    await writeFile(
      driver,
      `const fs=require('node:fs');const bytes=Buffer.alloc(2*1024*1024,120);let offset=0;while(offset<bytes.length)offset+=fs.writeSync(2,bytes,offset);fs.writeFileSync(process.argv.at(-1),JSON.stringify({execution_successful:true,analysis_completeness:{is_complete:false,status:'partial'},issues:[{description:'inert retained finding'}]}),{mode:0o600});`,
    );
    const result = await runSkillSpectorDiagnosticProcess(
      script,
      join(root, "inert"),
      join(root, "terminal.json"),
      {
        cwd: root,
        env: { PATH: process.env.PATH },
        timeoutMs: 5000,
      },
    );
    expect(result).toMatchObject({
      processStatus: "completed",
      stderrPolicy: "discarded",
      termination: {
        exitCode: 0,
        timedOut: false,
        outputLimitExceeded: null,
        processGroup: "absent",
      },
      terminal: {
        presence: "present",
        completeness: { isComplete: false, status: "partial" },
        findings: { reported: 1 },
      },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
