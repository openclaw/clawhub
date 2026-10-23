/* @vitest-environment node */
import { lstat, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import * as original from "./clawscan-diagnostic-original";
import * as runtime from "./clawscan-diagnostic-runtime";
import * as diagnostic from "./run-clawscan-diagnostic";
import { mainOriginalDiagnostic } from "./run-clawscan-original-diagnostic";

vi.mock("./clawscan-diagnostic-original", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./clawscan-diagnostic-original")>();
  const { createHash } = await import("node:crypto");
  const { chmod, mkdir, writeFile } = await import("node:fs/promises");
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  const manifests = Object.fromEntries(
    ["175", "290"].map((fixture) => {
      const files = Array.from({ length: Number(fixture) }, (_, index) => ({
        path: `inert-${String(index).padStart(3, "0")}.md`,
        size: 5,
        sha256: hash("inert"),
      }));
      return [
        fixture,
        {
          files,
          archiveSha256: hash("inert"),
          manifestSha256: hash(JSON.stringify(files)),
          manifestCanonicalization: "path,size,sha256",
        },
      ];
    }),
  );
  return {
    ...actual,
    ORIGINAL_CANDIDATE_SOURCE: "1".repeat(40),
    originalManifests: manifests,
    downloadOriginalInput: vi.fn(async () => ({ archive: Buffer.from("inert") })),
    materializeOriginalInput: vi.fn(
      async (fixture: "175" | "290", _input: unknown, target: string) => {
        await mkdir(target, { mode: 0o700 });
        for (const file of manifests[fixture].files)
          await writeFile(join(target, file.path), "inert", { mode: 0o400 });
        await chmod(target, 0o500);
        return {
          files: Number(fixture),
          bytes: 5 * Number(fixture),
          manifestSha256: manifests[fixture].manifestSha256,
        };
      },
    ),
  };
});

vi.mock("./clawscan-diagnostic-runtime", async () => {
  const { chmod, writeFile } = await import("node:fs/promises");
  return {
    installOriginalRuntime: vi.fn(async (root: string, pin: string) => {
      const script = join(root, "fake-python");
      const driver = join(root, "inert-controller.cjs");
      await writeFile(script, `#!/bin/sh\nexec '${process.execPath}' '${driver}' "$@"\n`, {
        mode: 0o700,
      });
      await chmod(script, 0o700);
      await writeFile(
        driver,
        `const fs=require('node:fs');const args=process.argv.slice(2);if(JSON.stringify(args.slice(0,4))!==JSON.stringify(['-I','-c','from skillspector.cli import app; app()','scan']))process.exit(9);const count=fs.readdirSync(args[4]).length;fs.writeFileSync(args.at(-1),JSON.stringify({execution_successful:true,issues:[{message:'PRIVATE'}],suppressed_count:0,analysis_completeness:{is_complete:false,status:'partial',execution_successful:true,total_components:count,scanned_components:count-1,fully_inspected_files:count-1,partially_inspected_files:1,entirely_uninspected_files:0,findings_before_filtering:1,findings_after_filtering:1,ledger_exceptions:[{reason_code:'artifact_count_limit',path:'PRIVATE',message:'PRIVATE'}],limitations:['PRIVATE'],analyzer_statuses:[{analyzer_id:'mcp_tool_poisoning',status:'degraded',planned_work:2,completed:1,partial:1,skipped:0,failed:0,unaccounted:0}]}}),{mode:0o600});console.log('PRIVATE');console.error('PRIVATE');process.exit(${pin.startsWith("966") ? 3 : 0});`,
      );
      return {
        binary: join(root, "never-invoked-judge"),
        python: script,
        scannerBin: root,
        metadata: { source: pin, runtimeImage: "N/A" },
      };
    }),
  };
});

it("runs the actual controller over four inert supervised processes, retaining failures and uploading only projected metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "original-controller-test-"));
  const oldUmask = process.umask();
  const oldExitCode = process.exitCode;
  const guard = vi
    .spyOn(diagnostic, "assertDisposableDiagnosticEnvironment")
    .mockImplementation(() => root);
  vi.stubEnv("RUNNER_TEMP", root);
  vi.stubEnv("GITHUB_OUTPUT", join(root, "github-output"));
  vi.stubEnv("OPENAI_API_KEY", "unused-inert-test-key");
  vi.stubEnv("CODEX_API_KEY", "unused-inert-test-key");
  const network = vi.fn(() => {
    throw new Error("Network prohibited in inert controller proof");
  });
  vi.stubGlobal("fetch", network);
  try {
    await mainOriginalDiagnostic("original-scanner-only");
    expect(network).not.toHaveBeenCalled();
    expect(runtime.installOriginalRuntime).toHaveBeenCalledTimes(2);
    expect(original.downloadOriginalInput).toHaveBeenCalledTimes(2);
    expect(original.materializeOriginalInput).toHaveBeenCalledTimes(4);
    const safe = (await readdir(root)).find((name) => name.startsWith("clawscan-original-safe-"))!;
    expect((await readdir(join(root, safe))).sort()).toEqual([
      "attestation.json",
      "events.jsonl",
      "summary.json",
    ]);
    expect(
      (await readdir(root)).some((name) => name.startsWith("clawscan-original-private-")),
    ).toBe(false);
    const raw = await readFile(join(root, safe, "summary.json"), "utf8");
    const summary = JSON.parse(raw);
    expect(summary).toMatchObject({
      mode: "original-scanner-only",
      maximumScans: 4,
      automaticRetries: 0,
      productionRecoverySamples: 0,
      runtimeRemoval: "completed",
    });
    expect(summary.attempts.map((entry: { id: string }) => entry.id)).toEqual([
      "baseline175",
      "candidate175",
      "baseline290",
      "candidate290",
    ]);
    expect(
      summary.attempts.every(
        (entry: {
          result: {
            complete: boolean;
            treeVerification: string;
            result: {
              terminal: {
                presence: string;
                completeness: { status: string };
                reasonCounts: Record<string, number>;
                findings: { reported: number };
              };
            };
          };
        }) =>
          !entry.result.complete &&
          entry.result.treeVerification === "verified" &&
          entry.result.result.terminal.presence === "present" &&
          entry.result.result.terminal.completeness.status === "partial" &&
          entry.result.result.terminal.reasonCounts.artifact_count_limit === 1 &&
          entry.result.result.terminal.findings.reported === 1,
      ),
    ).toBe(true);
    expect(
      summary.attempts.map(
        (entry: { result: { result: { termination: { exitCode: number } } } }) =>
          entry.result.result.termination.exitCode,
      ),
    ).toEqual([3, 0, 3, 0]);
    expect(raw).not.toMatch(/PRIVATE|unused-inert-test-key/);
    expect((await lstat(join(root, safe, "summary.json"))).mode & 0o077).toBe(0);
    expect(process.exitCode).toBe(1);
  } finally {
    guard.mockRestore();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    process.umask(oldUmask);
    process.exitCode = oldExitCode;
    await rm(root, { recursive: true, force: true });
  }
});
