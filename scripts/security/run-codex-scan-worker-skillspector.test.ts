/* @vitest-environment node */
import { existsSync, readFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import * as workerCommand from "../lib/runWorkerCommand";
import { type ClaimedJob, runBundledSkillSpector, runClawScan } from "./run-codex-scan-worker";

const workspaces: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(workspaces.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function command(path: string, body: string) {
  await writeFile(path, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`);
  await chmod(path, 0o755);
}

async function fixture(scannerBody: string, roots = ["skills/example"]) {
  const workspace = await mkdtemp(join(tmpdir(), "clawhub-bundled-skillspector-"));
  workspaces.push(workspace);
  for (const root of roots) {
    await mkdir(join(workspace, "artifact", root), { recursive: true });
    await writeFile(join(workspace, "artifact", root, "SKILL.md"), "# Example");
  }
  await writeFile(join(workspace, "artifact/openclaw.plugin.json"), '{"id":"example"}');
  await command(join(workspace, "skillspector"), scannerBody);
  // Stop at the real judge handoff: this fixture copies the supplied aggregate,
  // then deliberately fails rather than simulating a successful security judge.
  const handoff = join(workspace, "accepted-report.json");
  const clawscan = join(workspace, "clawscan");
  await command(
    clawscan,
    `while [[ $# -gt 0 ]]; do
  if [[ "$1" == "--scanner-result" ]]; then
    cp "\${2#skillspector=}" ${JSON.stringify(handoff)}
    break
  fi
  shift
done
exit 23`,
  );
  vi.stubEnv("PATH", `${workspace}:${process.env.PATH}`);
  vi.stubEnv("CODEX_SECURITY_SCAN_CLAWSCAN_COMMAND", clawscan);
  vi.stubEnv("CODEX_SECURITY_SCAN_CLAWSCAN_TIMEOUT_MS", "5000");
  const job: ClaimedJob = {
    job: {
      _id: "securityScanJobs:bundled-skillspector",
      leaseToken: "fixture",
      targetKind: "packageRelease",
      source: "publish",
      hasMaliciousSignal: false,
      waitForVtUntil: 0,
    },
    target: {
      package: { family: "code-plugin" },
      release: {
        pluginManifestSummary: { bundledSkills: roots.map((rootPath) => ({ rootPath })) },
      },
    },
  };
  return { workspace, handoff, run: () => runClawScan(job, workspace, vi.fn()) };
}

const findings = {
  status: "suspicious",
  issue_count: 1,
  issues: [
    { id: "review", severity: "MEDIUM", file: "SKILL.md", explanation: "Review this finding" },
  ],
};

function writeReport(report: unknown) {
  return `while [[ "$1" != "--output" ]]; do shift; done
printf '%s' '${JSON.stringify(report)}' > "$2"`;
}

it("runs two bundled roots together without multiplying the model-call ceiling", async () => {
  const roots = ["skills/first", "skills/second"];
  const { run, handoff, workspace } = await fixture(
    `root="$2"
if [[ "$root" == *first ]]; then
  while [[ ! -e second-completed ]]; do sleep 0.02; done
fi
printf '%s\\n' "\${SKILLSPECTOR_MAX_LLM_CONCURRENCY:-unset}" >> limits
${writeReport(findings)}
if [[ "$root" == *second ]]; then touch second-completed; fi`,
    roots,
  );
  vi.stubEnv("CODEX_SECURITY_SCAN_CLAWSCAN_TIMEOUT_MS", "1500");
  await expect(run()).rejects.toThrow("exited 23");
  expect((await readFile(join(workspace, "limits"), "utf8")).trim().split("\n")).toEqual([
    "5",
    "5",
  ]);
  expect(JSON.parse(await readFile(handoff, "utf8"))).toMatchObject({
    status: "suspicious",
    issue_count: 2,
    filtered_findings: roots.map((root) => ({ file: `${root}/SKILL.md` })),
  });
});

it("retains serial execution and provider concurrency defaults outside OpenAI", async () => {
  const { run, workspace } = await fixture(
    `mkdir serial-lock
trap 'rmdir serial-lock' EXIT
printf '%s\\n' "\${SKILLSPECTOR_MAX_LLM_CONCURRENCY:-unset}" >> limits
${writeReport(findings)}`,
    ["skills/first", "skills/second"],
  );
  vi.stubEnv("SKILLSPECTOR_PROVIDER", "anthropic");
  await expect(run()).rejects.toThrow("exited 23");
  expect((await readFile(join(workspace, "limits"), "utf8")).trim().split("\n")).toEqual([
    "unset",
    "unset",
  ]);
});

it("cancels and joins a sibling after a failed root before admitting another root", async () => {
  const originalRun = workerCommand.runWorkerCommand;
  let siblingTermination:
    | { cancelled: boolean; timedOut: boolean; processGroup: string }
    | undefined;
  vi.spyOn(workerCommand, "runWorkerCommand").mockImplementation((command, args, options) =>
    originalRun(command, args, {
      ...options,
      onTermination: (termination) => {
        if (command === "skillspector" && args[1]?.endsWith("second")) {
          siblingTermination = {
            cancelled: options.signal?.aborted === true,
            timedOut: termination.timedOut,
            processGroup: termination.processGroup,
          };
        }
        options.onTermination?.(termination);
      },
    }),
  );
  const { run, handoff, workspace } = await fixture(
    `if [[ "$2" == *first ]]; then
  while [[ ! -e second-started ]]; do sleep 0.02; done
  exit 7
fi
sleep 30 &
printf '%s' "$!" > sibling-pid
touch second-started
wait`,
    ["skills/first", "skills/second", "skills/third"],
  );
  vi.stubEnv("CODEX_SECURITY_SCAN_CLAWSCAN_TIMEOUT_MS", "2000");
  await expect(run()).rejects.toThrow("skillspector exited 7");
  expect(siblingTermination).toEqual({ cancelled: true, timedOut: false, processGroup: "absent" });
  await expect(readFile(handoff)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(readFile(join(workspace, "skillspector-report-2.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("counts accepted reports independently of the failed root's sorted index", async () => {
  const roots = ["skills/first", "skills/second", "skills/third", "skills/fourth"];
  const { workspace } = await fixture("", roots);
  let releaseFirst!: () => void;
  const firstFailure = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const calls: string[] = [];
  vi.spyOn(workerCommand, "runWorkerCommand").mockImplementation(
    async (_command, args, options) => {
      const root = args[1]!;
      calls.push(root);
      if (root.endsWith("first")) {
        await firstFailure;
        throw new workerCommand.CommandFailure("fixture root failed", 2, "", "", false);
      }
      if (root.endsWith("second")) {
        await writeFile(args[args.indexOf("--output") + 1]!, JSON.stringify(findings));
        return { stdout: "", stderr: "" };
      }
      if (root.endsWith("third")) {
        // Admission of this next root proves the second report was accepted while
        // the first root remained in flight. Then fail first and cancel third.
        releaseFirst();
        return await new Promise<never>((_resolve, reject) => {
          const cancel = () =>
            reject(new workerCommand.CommandFailure("fixture cancellation", null, "", "", false));
          if (options.signal?.aborted) cancel();
          else options.signal?.addEventListener("abort", cancel, { once: true });
        });
      }
      throw new Error("Unexpected root admitted after failure");
    },
  );
  const onDiagnostic = vi.fn();
  await expect(
    runBundledSkillSpector(
      workspace,
      roots.map((rootPath) => ({ rootPath, scanPath: join(workspace, "artifact", rootPath) })),
      onDiagnostic,
    ),
  ).rejects.toThrow("fixture root failed");
  expect(calls.map((path) => path.split("/").at(-1)).sort()).toEqual(["first", "second", "third"]);
  expect(onDiagnostic).toHaveBeenCalledExactlyOnceWith({
    bundledSkillSpector: expect.objectContaining({
      failed: true,
      exitCode: 2,
      context: expect.objectContaining({ rootIndex: 0, rootCount: 4, completedRoots: 1 }),
    }),
  });
});

it.each([0, 1])(
  "accepts the structured report despite 2 MiB stderr (exit %s)",
  async (exitCode) => {
    const { run, handoff } = await fixture(`${writeReport(findings)}
printf '%2097152s' x >&2
exit ${exitCode}`);
    // Reaching the judge proves the bundled scanner accepted its output file.
    await expect(run()).rejects.toThrow("exited 23");
    expect(JSON.parse(await readFile(handoff, "utf8"))).toMatchObject({
      applicable: true,
      status: "suspicious",
      issue_count: 1,
      filtered_findings: [{ file: "skills/example/SKILL.md", explanation: "Review this finding" }],
    });
  },
);

it.each(["cleanup", "output_limit", "observer"] as const)(
  "does not accept a findings exit when the command failed for %s",
  async (failureKind) => {
    const message = `Fixture ${failureKind} failure`;
    vi.spyOn(workerCommand, "runWorkerCommand").mockImplementationOnce(
      async (_command, args, options) => {
        await writeFile(args[args.indexOf("--output") + 1]!, JSON.stringify(findings));
        options.onTermination?.({
          elapsedMs: 1,
          cleanupMs: 1,
          processGroup: failureKind === "cleanup" ? "unknown" : "absent",
          exitCode: 1,
          timedOut: false,
          outputLimitExceeded: failureKind === "output_limit" ? "stdout" : null,
        });
        throw new workerCommand.CommandFailure(
          message,
          1,
          "",
          "",
          false,
          failureKind === "output_limit" ? "stdout" : undefined,
          failureKind,
        );
      },
    );
    const { run, handoff } = await fixture(writeReport(findings));
    await expect(run()).rejects.toThrow(message);
    await expect(readFile(handoff)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it.each([1, 7])(
  "rejects exit %s without a findings report despite noisy stderr",
  async (exitCode) => {
    const { run, handoff } = await fixture(`printf '%2097152s' x >&2\nexit ${exitCode}`);
    await expect(run()).rejects.toThrow(`skillspector exited ${exitCode}`);
    await expect(readFile(handoff)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it.each([false, true])(
  "still rejects a noisy scanner timeout with a report (exit 1 trap: %s)",
  async (trapExit) => {
    const { run, workspace, handoff } = await fixture(`${writeReport(findings)}
printf '%2097152s' x >&2
${trapExit ? "trap 'exit 1' TERM; while true; do sleep 30; done" : "exec sleep 30"}`);
    vi.stubEnv("CODEX_SECURITY_SCAN_CLAWSCAN_TIMEOUT_MS", "1000");
    await expect(run()).rejects.toThrow("skillspector timed out");
    expect(
      JSON.parse(await readFile(join(workspace, "skillspector-report-0.json"), "utf8")),
    ).toEqual(findings);
    await expect(readFile(handoff)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it("gives successive bundled roots their own timeout within the preparation budget", async () => {
  const roots = ["skills/first", "skills/second", "skills/third"];
  const { run, handoff } = await fixture(
    `sleep 0.9
${writeReport(findings)}`,
    roots,
  );
  vi.stubEnv("CODEX_SECURITY_SCAN_CLAWSCAN_TIMEOUT_MS", "1500");
  // Two waves need >= 1.8s together, but each child fits its 1.5s budget.
  // A shared 1.5s deadline would still kill the third root.
  await expect(run()).rejects.toThrow("exited 23");
  expect(JSON.parse(await readFile(handoff, "utf8"))).toMatchObject({
    applicable: true,
    status: "suspicious",
    issue_count: 3,
    filtered_findings: roots.map((root) => ({
      file: `${root}/SKILL.md`,
      explanation: "Review this finding",
    })),
  });
});

it.each([
  { remainingMs: -1, error: "bundled-skill scan deadline exceeded" },
  { remainingMs: 300, error: "skillspector timed out" },
])(
  "enforces the total preparation ceiling with $remainingMs ms left",
  async ({ remainingMs, error }) => {
    const { run, workspace, handoff } = await fixture(
      `if [[ "$2" == *third ]]; then sleep 1; fi
${writeReport(findings)}`,
      ["skills/first", "skills/second", "skills/third"],
    );
    const firstReport = join(workspace, "skillspector-report-0.json");
    const startedAt = Date.now();
    // Advance only the budget clock after the first real subprocess writes its
    // report. Timers and the next-wave subprocess remain real; no 20-minute sleep.
    vi.spyOn(Date, "now").mockImplementation(
      () =>
        startedAt +
        (existsSync(firstReport) && readFileSync(firstReport, "utf8").length > 0
          ? 20 * 60_000 - remainingMs
          : 0),
    );
    await expect(run()).rejects.toThrow(error);
    expect(JSON.parse(await readFile(firstReport, "utf8"))).toEqual(findings);
    const nextReport = join(workspace, "skillspector-report-2.json");
    if (remainingMs > 0) {
      // A started child has a private output slot, never a completed report.
      expect(await readFile(nextReport, "utf8")).toBe("");
      expect((await stat(nextReport)).mode & 0o777).toBe(0o600);
    } else {
      await expect(readFile(nextReport)).rejects.toMatchObject({ code: "ENOENT" });
    }
    await expect(readFile(handoff)).rejects.toMatchObject({ code: "ENOENT" });
  },
);
