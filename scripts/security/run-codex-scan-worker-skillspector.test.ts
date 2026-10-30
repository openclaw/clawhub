/* @vitest-environment node */
import { existsSync, readFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { type ClaimedJob, runClawScan } from "./run-codex-scan-worker";

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
    `sleep 0.7
${writeReport(findings)}`,
    roots,
  );
  vi.stubEnv("CODEX_SECURITY_SCAN_CLAWSCAN_TIMEOUT_MS", "1500");
  // Three real sequential subprocesses need >= 2.1s together, but each fits
  // its 1.5s budget. The old shared 1.5s deadline kills the third root.
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
      `if [[ "$2" == *second ]]; then sleep 1; fi
${writeReport(findings)}`,
      ["skills/first", "skills/second"],
    );
    const firstReport = join(workspace, "skillspector-report-0.json");
    const startedAt = Date.now();
    // Advance only the budget clock after the first real subprocess writes its
    // report. Timers and the second subprocess remain real; no 20-minute sleep.
    vi.spyOn(Date, "now").mockImplementation(
      () =>
        startedAt +
        (existsSync(firstReport) && readFileSync(firstReport, "utf8").length > 0
          ? 20 * 60_000 - remainingMs
          : 0),
    );
    await expect(run()).rejects.toThrow(error);
    expect(JSON.parse(await readFile(firstReport, "utf8"))).toEqual(findings);
    const secondReport = join(workspace, "skillspector-report-1.json");
    if (remainingMs > 0) {
      // A started child has a private output slot, never a completed report.
      expect(await readFile(secondReport, "utf8")).toBe("");
      expect((await stat(secondReport)).mode & 0o777).toBe(0o600);
    } else {
      await expect(readFile(secondReport)).rejects.toMatchObject({ code: "ENOENT" });
    }
    await expect(readFile(handoff)).rejects.toMatchObject({ code: "ENOENT" });
  },
);
