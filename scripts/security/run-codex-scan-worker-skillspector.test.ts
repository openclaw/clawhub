/* @vitest-environment node */
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { type ClaimedJob, runClawScan } from "./run-codex-scan-worker";

const workspaces: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(workspaces.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function command(path: string, body: string) {
  await writeFile(path, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`);
  await chmod(path, 0o755);
}

async function fixture(scannerBody: string) {
  const workspace = await mkdtemp(join(tmpdir(), "clawhub-bundled-stderr-"));
  workspaces.push(workspace);
  await mkdir(join(workspace, "artifact/skills/example"), { recursive: true });
  await writeFile(join(workspace, "artifact/openclaw.plugin.json"), '{"id":"example"}');
  await writeFile(join(workspace, "artifact/skills/example/SKILL.md"), "# Example");
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
      _id: "securityScanJobs:bundled-stderr",
      leaseToken: "fixture",
      targetKind: "packageRelease",
      source: "publish",
      hasMaliciousSignal: false,
      waitForVtUntil: 0,
    },
    target: {
      package: { family: "code-plugin" },
      release: { pluginManifestSummary: { bundledSkills: [{ rootPath: "skills/example" }] } },
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

it("still rejects a noisy scanner timeout even after writing a report", async () => {
  const { run, workspace, handoff } = await fixture(`${writeReport(findings)}
printf '%2097152s' x >&2
exec sleep 30`);
  vi.stubEnv("CODEX_SECURITY_SCAN_CLAWSCAN_TIMEOUT_MS", "1000");
  await expect(run()).rejects.toThrow("skillspector timed out");
  expect(JSON.parse(await readFile(join(workspace, "skillspector-report-0.json"), "utf8"))).toEqual(
    findings,
  );
  await expect(readFile(handoff)).rejects.toMatchObject({ code: "ENOENT" });
});
