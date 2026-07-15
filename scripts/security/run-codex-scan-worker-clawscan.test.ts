/* @vitest-environment node */
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClaimedJob } from "./run-codex-scan-worker";
import { processJob } from "./run-codex-scan-worker";

const tempDirs: string[] = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "clawhub-codex-worker-test-"));
  tempDirs.push(dir);
  return dir;
}

function skillVersionJob(jobId: string): ClaimedJob {
  const leaseField = `lease${"Token"}`;
  const baseJob = {
    _id: jobId,
    hasMaliciousSignal: false,
    source: "publish",
    targetKind: "skillVersion" as const,
    waitForVtUntil: 0,
    [leaseField]: "lease-fixture",
  } as ClaimedJob["job"];

  return {
    job: baseJob,
    target: {
      files: [
        {
          path: "SKILL.md",
          sha256: "abc123",
          size: 42,
          url: "data:text/plain,%23%20Skill",
        },
      ],
    },
  };
}

function claimedJob(input: {
  jobId: string;
  source: string;
  target: ClaimedJob["target"];
  targetKind: ClaimedJob["job"]["targetKind"];
}): ClaimedJob {
  const leaseField = `lease${"Token"}`;
  const job = {
    _id: input.jobId,
    hasMaliciousSignal: false,
    source: input.source,
    targetKind: input.targetKind,
    waitForVtUntil: 0,
    [leaseField]: "lease-fixture",
  } as ClaimedJob["job"];
  return {
    job,
    target: input.target,
  };
}

function fileTarget(path: string, content: string): ClaimedJob["target"] {
  return {
    files: [
      {
        path,
        sha256: "artifact-sha",
        size: Buffer.byteLength(content),
        url: `data:text/plain,${encodeURIComponent(content)}`,
      },
    ],
  };
}

async function clawPackTarget(): Promise<ClaimedJob["target"]> {
  const sourceDir = await tempDir();
  const packageDir = join(sourceDir, "package");
  const archivePath = join(sourceDir, "artifact.tgz");
  await mkdir(packageDir, { recursive: true });
  await writeFile(join(packageDir, "package.json"), '{"name":"matrix-plugin","version":"1.0.0"}\n');
  await writeFile(join(packageDir, "openclaw.plugin.json"), '{"id":"matrix-plugin"}\n');
  await execFileAsync("tar", ["-czf", archivePath, "-C", sourceDir, "package"]);
  const archive = await readFile(archivePath);
  return {
    clawpackUrl: `data:application/gzip;base64,${archive.toString("base64")}`,
  };
}

async function writeFakeClawScanCommand(path: string, body: string) {
  await writeFile(path, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`);
  await chmod(path, 0o755);
}

type ClawScanVerdict = "benign" | "suspicious" | "malicious";

function completeJudgeDimensions() {
  return {
    purpose_capability: {
      status: "ok",
      detail: "purpose capability is proportional",
    },
    instruction_scope: {
      status: "ok",
      detail: "instruction scope is bounded",
    },
    install_mechanism: {
      status: "ok",
      detail: "install mechanism is expected for this artifact",
    },
    environment_proportionality: {
      status: "ok",
      detail: "environment permissions are proportional",
    },
    persistence_privilege: {
      status: "ok",
      detail: "persistence/privilege behavior is expected",
    },
  };
}

function completeJudgeResult(verdict: ClawScanVerdict) {
  return {
    verdict,
    confidence: "high",
    summary: "summary",
    dimensions: completeJudgeDimensions(),
    scan_findings_in_context: [],
    user_guidance: "guidance",
  };
}

function clawScanArtifactJson(options?: {
  completedAt?: string;
  includeCompletedAt?: boolean;
  judgeResult?: Record<string, unknown>;
  scannerStatuses?: Partial<Record<"clawscan-static" | "skillspector" | "virustotal", string>>;
  verdict?: ClawScanVerdict;
}) {
  const verdict = options?.verdict ?? "benign";
  const scannerStatuses = {
    "clawscan-static": "completed",
    skillspector: "completed",
    virustotal: "completed",
    ...options?.scannerStatuses,
  };
  const artifact: Record<string, unknown> = {
    schemaVersion: "clawscan-run-v1",
    profile: "clawhub",
    scanners: {
      skillspector: {
        status: scannerStatuses.skillspector,
        raw: {
          risk_assessment: {
            score: 55,
            severity: "HIGH",
            recommendation: "DO_NOT_INSTALL",
          },
          issues: [{ id: "SDI-1", severity: "HIGH", explanation: "test finding" }],
        },
      },
      virustotal: {
        status: scannerStatuses.virustotal,
        raw: {
          status: scannerStatuses.virustotal === "skipped" ? "skipped" : "clean",
        },
      },
      "clawscan-static": {
        status: scannerStatuses["clawscan-static"],
        raw: {
          status: scannerStatuses["clawscan-static"] === "completed" ? "clean" : "failed",
        },
      },
    },
    judge: {
      status: "completed",
      promptSha256: "prompt-sha-1",
      outputSchemaSha256: "schema-sha-1",
      result: options?.judgeResult ?? completeJudgeResult(verdict),
    },
  };
  if (options?.includeCompletedAt === false) {
    return JSON.stringify(artifact);
  }
  artifact.completedAt = options?.completedAt ?? "2026-07-15T00:00:00Z";
  return JSON.stringify(artifact);
}

describe("run-codex-scan-worker clawscan authority", () => {
  it("defaults skillVersion jobs to the legacy codex path unless clawscan is explicitly selected", async () => {
    const workspace = await tempDir();
    const fakeClawScan = join(workspace, "fake-clawscan");
    const clawscanMarker = join(workspace, "clawscan-called.log");
    await writeFakeClawScanCommand(
      fakeClawScan,
      `echo "called" > ${JSON.stringify(clawscanMarker)}
exit 0`,
    );

    const binDir = await tempDir();
    const legacyMarker = join(workspace, "legacy-called.log");
    await writeFakeClawScanCommand(
      join(binDir, "skillspector"),
      `echo "skillspector" >> ${JSON.stringify(legacyMarker)}
out=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output)
      out="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done
mkdir -p "$(dirname "$out")"
cat > "$out" <<'JSON'
{"status":"clean","issue_count":0,"issues":[]}
JSON`,
    );
    await writeFakeClawScanCommand(
      join(binDir, "codex"),
      `echo "codex" >> ${JSON.stringify(legacyMarker)}
out=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output-last-message)
      out="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done
mkdir -p "$(dirname "$out")"
cat > "$out" <<'JSON'
{"verdict":"benign","confidence":"high","summary":"summary","dimensions":{"purpose_capability":{"status":"ok","detail":"ok"}},"scan_findings_in_context":[],"user_guidance":"guidance"}
JSON`,
    );

    const previousCommand = process.env.CODEX_SECURITY_SCAN_CLAWSCAN_COMMAND;
    const previousPath = process.env.PATH;
    process.env.CODEX_SECURITY_SCAN_CLAWSCAN_COMMAND = fakeClawScan;
    process.env.PATH = `${binDir}:${previousPath ?? ""}`;
    try {
      const client = {
        action: vi.fn(async (..._args: unknown[]) => ({})),
      };
      const result = await processJob(
        client,
        "worker-auth",
        skillVersionJob("securityScanJobs:default-legacy"),
        undefined,
      );

      expect(result).toEqual({
        completed: true,
        hardFailed: false,
        retryableFailed: false,
      });
      expect(await readFile(legacyMarker, "utf8")).toContain("codex");
      await expect(readFile(clawscanMarker, "utf8")).rejects.toThrow();
    } finally {
      if (previousCommand === undefined) delete process.env.CODEX_SECURITY_SCAN_CLAWSCAN_COMMAND;
      else process.env.CODEX_SECURITY_SCAN_CLAWSCAN_COMMAND = previousCommand;
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
    }
  });

  it.each([
    { verdict: "benign", expectedStatus: "clean" },
    { verdict: "suspicious", expectedStatus: "suspicious" },
    { verdict: "malicious", expectedStatus: "malicious" },
  ] satisfies Array<{ expectedStatus: string; verdict: ClawScanVerdict }>)(
    "persists %s ClawScan verdicts through the existing completion shape",
    async ({ verdict, expectedStatus }) => {
      const workspace = await tempDir();
      const fakeClawScan = join(workspace, "fake-clawscan");
      const argsLog = join(workspace, "clawscan-args.log");
      const artifactJson = clawScanArtifactJson({ verdict });
      await writeFakeClawScanCommand(
        fakeClawScan,
        `printf '%s\n' "$@" > ${JSON.stringify(argsLog)}
out=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output)
      out="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done
mkdir -p "$(dirname "$out")"
cat > "$out" <<'JSON'
${artifactJson}
JSON`,
      );

      const previousCommand = process.env.CODEX_SECURITY_SCAN_CLAWSCAN_COMMAND;
      process.env.CODEX_SECURITY_SCAN_CLAWSCAN_COMMAND = fakeClawScan;
      try {
        const client = {
          action: vi.fn(async (..._args: unknown[]) => ({})),
        };
        const result = await processJob(
          client,
          "worker-auth",
          skillVersionJob(`securityScanJobs:${verdict}`),
          undefined,
          "clawscan",
        );

        expect(result).toEqual({
          completed: true,
          hardFailed: false,
          retryableFailed: false,
        });
        expect(client.action).toHaveBeenCalledTimes(1);
        expect(client.action.mock.calls[0]?.[1]).toMatchObject({
          llmAnalysis: {
            status: expectedStatus,
            verdict,
          },
          skillSpectorAnalysis: {
            issueCount: 1,
            status: "suspicious",
          },
        });
        const payload = client.action.mock.calls[0]?.[1] as
          | { llmAnalysis?: { model?: string } }
          | undefined;
        expect(payload?.llmAnalysis?.model).toBeUndefined();

        const invocationArgs = await readFile(argsLog, "utf8");
        expect(invocationArgs).toContain("--profile");
        expect(invocationArgs).toContain("clawhub");
        expect(invocationArgs).not.toContain("--context");
        expect(invocationArgs).not.toContain("--scanner-result");
      } finally {
        if (previousCommand === undefined) delete process.env.CODEX_SECURITY_SCAN_CLAWSCAN_COMMAND;
        else process.env.CODEX_SECURITY_SCAN_CLAWSCAN_COMMAND = previousCommand;
      }
    },
  );

  it.each([
    {
      name: "skill-version publish",
      source: "publish",
      targetKind: "skillVersion" as const,
      expectedTarget: "./artifact",
      expectedFile: "./artifact/SKILL.md",
      target: async () => fileTarget("SKILL.md", "# Published skill\n"),
    },
    {
      name: "package-release publish",
      source: "publish",
      targetKind: "packageRelease" as const,
      expectedTarget: "./artifact/package",
      expectedFile: "./artifact/package/package.json",
      target: clawPackTarget,
    },
    {
      name: "skill-scan-request manual",
      source: "manual",
      targetKind: "skillScanRequest" as const,
      expectedTarget: "./artifact",
      expectedFile: "./artifact/SKILL.md",
      target: async () => fileTarget("SKILL.md", "# Uploaded skill\n"),
    },
    {
      name: "skill-version VirusTotal update",
      source: "vt-update",
      targetKind: "skillVersion" as const,
      expectedTarget: "./artifact",
      expectedFile: "./artifact/SKILL.md",
      target: async () => fileTarget("SKILL.md", "# VT update\n"),
    },
    {
      name: "package-release backfill",
      source: "backfill",
      targetKind: "packageRelease" as const,
      expectedTarget: "./artifact",
      expectedFile: "./artifact/package.json",
      target: async () => fileTarget("package.json", '{"name":"backfill-plugin"}\n'),
    },
    {
      name: "skill-version bulk rescan",
      source: "bulk-rescan",
      targetKind: "skillVersion" as const,
      expectedTarget: "./artifact",
      expectedFile: "./artifact/SKILL.md",
      target: async () => fileTarget("SKILL.md", "# Bulk rescan\n"),
    },
  ])(
    "routes $name through the same artifact-only ClawScan persistence adapter",
    async ({ source, targetKind, expectedTarget, expectedFile, target }) => {
      const workspace = await tempDir();
      const fakeClawScan = join(workspace, "fake-clawscan");
      const argsLog = join(workspace, "clawscan-args.log");
      const filesLog = join(workspace, "clawscan-files.log");
      await writeFakeClawScanCommand(
        fakeClawScan,
        `target="$1"
printf '%s\n' "$@" > ${JSON.stringify(argsLog)}
find "$target" -type f -print | sort > ${JSON.stringify(filesLog)}
out=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output)
      out="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done
mkdir -p "$(dirname "$out")"
cat > "$out" <<'JSON'
${clawScanArtifactJson()}
JSON`,
      );

      const previousCommand = process.env.CODEX_SECURITY_SCAN_CLAWSCAN_COMMAND;
      process.env.CODEX_SECURITY_SCAN_CLAWSCAN_COMMAND = fakeClawScan;
      try {
        const client = {
          action: vi.fn(async (..._args: unknown[]) => ({})),
        };
        const result = await processJob(
          client,
          "worker-auth",
          claimedJob({
            jobId: `securityScanJobs:${targetKind}-${source}`,
            source,
            target: await target(),
            targetKind,
          }),
          undefined,
          "clawscan",
        );

        expect(result).toEqual({
          completed: true,
          hardFailed: false,
          retryableFailed: false,
        });
        expect(client.action).toHaveBeenCalledTimes(1);
        expect(client.action.mock.calls[0]?.[1]).toMatchObject({
          llmAnalysis: {
            status: "clean",
            verdict: "benign",
          },
          skillSpectorAnalysis: {
            issueCount: 1,
            status: "suspicious",
          },
        });

        const invocationArgs = (await readFile(argsLog, "utf8")).trim().split("\n");
        expect(invocationArgs[0]).toBe(expectedTarget);
        expect(invocationArgs).toEqual(
          expect.arrayContaining(["--profile", "clawhub", "--output"]),
        );
        expect(invocationArgs).not.toContain("--context");
        expect(invocationArgs).not.toContain("--scanner-result");
        expect((await readFile(filesLog, "utf8")).trim().split("\n")).toContain(expectedFile);
      } finally {
        if (previousCommand === undefined) delete process.env.CODEX_SECURITY_SCAN_CLAWSCAN_COMMAND;
        else process.env.CODEX_SECURITY_SCAN_CLAWSCAN_COMMAND = previousCommand;
      }
    },
  );

  it.each([
    {
      source: "bulk-rescan",
      targetKind: "skillVersion" as const,
      target: async () => fileTarget("SKILL.md", "# Failed skill\n"),
    },
    {
      source: "vt-update",
      targetKind: "packageRelease" as const,
      target: async () => fileTarget("package.json", '{"name":"failed-plugin"}\n'),
    },
    {
      source: "manual",
      targetKind: "skillScanRequest" as const,
      target: async () => fileTarget("SKILL.md", "# Failed upload\n"),
    },
  ])(
    "uses the existing retry lifecycle when $targetKind/$source ClawScan execution fails",
    async ({ source, targetKind, target }) => {
      const workspace = await tempDir();
      const fakeClawScan = join(workspace, "fake-clawscan");
      await writeFakeClawScanCommand(fakeClawScan, 'echo "matrix failure" >&2\nexit 17');

      const previousCommand = process.env.CODEX_SECURITY_SCAN_CLAWSCAN_COMMAND;
      process.env.CODEX_SECURITY_SCAN_CLAWSCAN_COMMAND = fakeClawScan;
      try {
        const client = {
          action: vi.fn(async (...args: unknown[]) => {
            const payload = args[1] as { error?: string } | undefined;
            return payload?.error ? { retry: true } : {};
          }),
        };
        const result = await processJob(
          client,
          "worker-auth",
          claimedJob({
            jobId: `securityScanJobs:failed-${targetKind}-${source}`,
            source,
            target: await target(),
            targetKind,
          }),
          undefined,
          "clawscan",
        );

        expect(result).toEqual({
          completed: false,
          hardFailed: false,
          retryableFailed: true,
        });
        expect(client.action).toHaveBeenCalledTimes(1);
        expect(client.action.mock.calls[0]?.[1]).toMatchObject({
          error: expect.stringContaining("exited 17"),
        });
      } finally {
        if (previousCommand === undefined) delete process.env.CODEX_SECURITY_SCAN_CLAWSCAN_COMMAND;
        else process.env.CODEX_SECURITY_SCAN_CLAWSCAN_COMMAND = previousCommand;
      }
    },
  );

  it("fails the job when VirusTotal scanner status is skipped", async () => {
    const workspace = await tempDir();
    const fakeClawScan = join(workspace, "fake-clawscan");
    const artifactJson = clawScanArtifactJson({
      scannerStatuses: { virustotal: "skipped" },
    });
    await writeFakeClawScanCommand(
      fakeClawScan,
      `out=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output)
      out="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done
mkdir -p "$(dirname "$out")"
cat > "$out" <<'JSON'
${artifactJson}
JSON`,
    );

    const previousCommand = process.env.CODEX_SECURITY_SCAN_CLAWSCAN_COMMAND;
    process.env.CODEX_SECURITY_SCAN_CLAWSCAN_COMMAND = fakeClawScan;
    try {
      const client = {
        action: vi.fn(async (...args: unknown[]) => {
          const payload = args[1] as { error?: string } | undefined;
          return payload?.error ? { retry: false } : {};
        }),
      };
      const result = await processJob(
        client,
        "worker-auth",
        skillVersionJob("securityScanJobs:vt-skipped"),
        undefined,
        "clawscan",
      );

      expect(result).toEqual({
        completed: false,
        hardFailed: true,
        retryableFailed: false,
      });
      expect(client.action).toHaveBeenCalledTimes(1);
      expect(client.action.mock.calls[0]?.[1]).toMatchObject({
        error: "ClawScan scanner virustotal status was skipped",
      });
    } finally {
      if (previousCommand === undefined) delete process.env.CODEX_SECURITY_SCAN_CLAWSCAN_COMMAND;
      else process.env.CODEX_SECURITY_SCAN_CLAWSCAN_COMMAND = previousCommand;
    }
  });

  it("fails the job when the ClawScan artifact is malformed", async () => {
    const workspace = await tempDir();
    const fakeClawScan = join(workspace, "fake-clawscan");
    await writeFakeClawScanCommand(
      fakeClawScan,
      `out=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output)
      out="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done
mkdir -p "$(dirname "$out")"
echo "not json" > "$out"`,
    );

    const previousCommand = process.env.CODEX_SECURITY_SCAN_CLAWSCAN_COMMAND;
    process.env.CODEX_SECURITY_SCAN_CLAWSCAN_COMMAND = fakeClawScan;
    try {
      const client = {
        action: vi.fn(async (...args: unknown[]) => {
          const payload = args[1] as { error?: string } | undefined;
          return payload?.error ? { retry: false } : {};
        }),
      };

      const result = await processJob(
        client,
        "worker-auth",
        skillVersionJob("securityScanJobs:malformed"),
        undefined,
        "clawscan",
      );

      expect(result).toEqual({
        completed: false,
        hardFailed: true,
        retryableFailed: false,
      });
      expect(client.action).toHaveBeenCalledTimes(1);
      expect(client.action.mock.calls[0]?.[1]).toMatchObject({
        error: "ClawScan did not emit a valid JSON artifact",
      });
    } finally {
      if (previousCommand === undefined) delete process.env.CODEX_SECURITY_SCAN_CLAWSCAN_COMMAND;
      else process.env.CODEX_SECURITY_SCAN_CLAWSCAN_COMMAND = previousCommand;
    }
  });

  it("fails the job when the ClawScan judge result is missing required dimensions", async () => {
    const workspace = await tempDir();
    const fakeClawScan = join(workspace, "fake-clawscan");
    const artifactJson = clawScanArtifactJson({
      judgeResult: {
        verdict: "benign",
        confidence: "high",
        summary: "summary",
        dimensions: {
          purpose_capability: {
            status: "ok",
            detail: "only one dimension",
          },
        },
        scan_findings_in_context: [],
        user_guidance: "guidance",
      },
    });
    await writeFakeClawScanCommand(
      fakeClawScan,
      `out=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output)
      out="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done
mkdir -p "$(dirname "$out")"
cat > "$out" <<'JSON'
${artifactJson}
JSON`,
    );

    const previousCommand = process.env.CODEX_SECURITY_SCAN_CLAWSCAN_COMMAND;
    process.env.CODEX_SECURITY_SCAN_CLAWSCAN_COMMAND = fakeClawScan;
    try {
      const client = {
        action: vi.fn(async (...args: unknown[]) => {
          const payload = args[1] as { error?: string } | undefined;
          return payload?.error ? { retry: false } : {};
        }),
      };

      const result = await processJob(
        client,
        "worker-auth",
        skillVersionJob("securityScanJobs:judge-incomplete"),
        undefined,
        "clawscan",
      );

      expect(result).toEqual({
        completed: false,
        hardFailed: true,
        retryableFailed: false,
      });
      expect(client.action).toHaveBeenCalledTimes(1);
      const payload = client.action.mock.calls[0]?.[1] as { error?: string } | undefined;
      expect(payload?.error).toContain("ClawScan judge dimensions missing required field(s)");
    } finally {
      if (previousCommand === undefined) delete process.env.CODEX_SECURITY_SCAN_CLAWSCAN_COMMAND;
      else process.env.CODEX_SECURITY_SCAN_CLAWSCAN_COMMAND = previousCommand;
    }
  });

  it.each([
    {
      artifactJson: clawScanArtifactJson({ includeCompletedAt: false }),
      expectedError: "ClawScan artifact completedAt was missing",
      name: "missing",
    },
    {
      artifactJson: clawScanArtifactJson({ completedAt: "not-a-date" }),
      expectedError: "ClawScan artifact completedAt was not-a-date",
      name: "invalid",
    },
  ])(
    "fails the job when ClawScan artifact completedAt is $name",
    async ({ artifactJson, expectedError, name }) => {
      const workspace = await tempDir();
      const fakeClawScan = join(workspace, "fake-clawscan");
      await writeFakeClawScanCommand(
        fakeClawScan,
        `out=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output)
      out="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done
mkdir -p "$(dirname "$out")"
cat > "$out" <<'JSON'
${artifactJson}
JSON`,
      );

      const previousCommand = process.env.CODEX_SECURITY_SCAN_CLAWSCAN_COMMAND;
      process.env.CODEX_SECURITY_SCAN_CLAWSCAN_COMMAND = fakeClawScan;
      try {
        const client = {
          action: vi.fn(async (...args: unknown[]) => {
            const payload = args[1] as { error?: string } | undefined;
            return payload?.error ? { retry: false } : {};
          }),
        };

        const result = await processJob(
          client,
          "worker-auth",
          skillVersionJob(`securityScanJobs:completed-at-${name}`),
          undefined,
          "clawscan",
        );

        expect(result).toEqual({
          completed: false,
          hardFailed: true,
          retryableFailed: false,
        });
        expect(client.action).toHaveBeenCalledTimes(1);
        expect(client.action.mock.calls[0]?.[1]).toMatchObject({
          error: expectedError,
        });
      } finally {
        if (previousCommand === undefined) delete process.env.CODEX_SECURITY_SCAN_CLAWSCAN_COMMAND;
        else process.env.CODEX_SECURITY_SCAN_CLAWSCAN_COMMAND = previousCommand;
      }
    },
  );

  it("fails the job when a required ClawScan scanner reports failed", async () => {
    const workspace = await tempDir();
    const fakeClawScan = join(workspace, "fake-clawscan");
    const artifactJson = clawScanArtifactJson({
      scannerStatuses: { skillspector: "failed" },
    });
    await writeFakeClawScanCommand(
      fakeClawScan,
      `out=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output)
      out="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done
mkdir -p "$(dirname "$out")"
cat > "$out" <<'JSON'
${artifactJson}
JSON`,
    );

    const previousCommand = process.env.CODEX_SECURITY_SCAN_CLAWSCAN_COMMAND;
    process.env.CODEX_SECURITY_SCAN_CLAWSCAN_COMMAND = fakeClawScan;
    try {
      const client = {
        action: vi.fn(async (...args: unknown[]) => {
          const payload = args[1] as { error?: string } | undefined;
          return payload?.error ? { retry: false } : {};
        }),
      };

      const result = await processJob(
        client,
        "worker-auth",
        skillVersionJob("securityScanJobs:scanner-failed"),
        undefined,
        "clawscan",
      );

      expect(result).toEqual({
        completed: false,
        hardFailed: true,
        retryableFailed: false,
      });
      expect(client.action).toHaveBeenCalledTimes(1);
      expect(client.action.mock.calls[0]?.[1]).toMatchObject({
        error: "ClawScan scanner skillspector status was failed",
      });
    } finally {
      if (previousCommand === undefined) delete process.env.CODEX_SECURITY_SCAN_CLAWSCAN_COMMAND;
      else process.env.CODEX_SECURITY_SCAN_CLAWSCAN_COMMAND = previousCommand;
    }
  });

  it("uses the existing timeout/failure retry path for ClawScan timeouts", async () => {
    const workspace = await tempDir();
    const fakeClawScan = join(workspace, "fake-clawscan");
    await writeFakeClawScanCommand(
      fakeClawScan,
      `sleep 2
echo "this should never complete"`,
    );

    const previousCommand = process.env.CODEX_SECURITY_SCAN_CLAWSCAN_COMMAND;
    const previousTimeout = process.env.CODEX_SECURITY_SCAN_CLAWSCAN_TIMEOUT_MS;
    process.env.CODEX_SECURITY_SCAN_CLAWSCAN_COMMAND = fakeClawScan;
    process.env.CODEX_SECURITY_SCAN_CLAWSCAN_TIMEOUT_MS = "25";
    try {
      const client = {
        action: vi.fn(async (...args: unknown[]) => {
          const payload = args[1] as { error?: string } | undefined;
          return payload?.error ? { retry: true } : {};
        }),
      };

      const result = await processJob(
        client,
        "worker-auth",
        skillVersionJob("securityScanJobs:timeout"),
        undefined,
        "clawscan",
      );

      expect(result).toEqual({
        completed: false,
        hardFailed: false,
        retryableFailed: true,
      });
      expect(client.action).toHaveBeenCalledTimes(1);
      const payload = client.action.mock.calls[0]?.[1] as { error?: string } | undefined;
      expect(payload?.error).toContain("timed out");
    } finally {
      if (previousCommand === undefined) delete process.env.CODEX_SECURITY_SCAN_CLAWSCAN_COMMAND;
      else process.env.CODEX_SECURITY_SCAN_CLAWSCAN_COMMAND = previousCommand;
      if (previousTimeout === undefined) delete process.env.CODEX_SECURITY_SCAN_CLAWSCAN_TIMEOUT_MS;
      else process.env.CODEX_SECURITY_SCAN_CLAWSCAN_TIMEOUT_MS = previousTimeout;
    }
  });

  it("does not fall back to legacy Codex/SkillSpector commands when ClawScan fails", async () => {
    const workspace = await tempDir();
    const fakeClawScan = join(workspace, "fake-clawscan");
    await writeFakeClawScanCommand(
      fakeClawScan,
      `echo "clawscan failed intentionally" >&2
exit 7`,
    );

    const binDir = await tempDir();
    const markerPath = join(binDir, "legacy-commands-called.log");
    await writeFakeClawScanCommand(
      join(binDir, "codex"),
      `echo codex >> ${JSON.stringify(markerPath)}
exit 0`,
    );
    await writeFakeClawScanCommand(
      join(binDir, "skillspector"),
      `echo skillspector >> ${JSON.stringify(markerPath)}
exit 0`,
    );

    const previousCommand = process.env.CODEX_SECURITY_SCAN_CLAWSCAN_COMMAND;
    const previousPath = process.env.PATH;
    process.env.CODEX_SECURITY_SCAN_CLAWSCAN_COMMAND = fakeClawScan;
    process.env.PATH = `${binDir}:${previousPath ?? ""}`;
    try {
      const client = {
        action: vi.fn(async (...args: unknown[]) => {
          const payload = args[1] as { error?: string } | undefined;
          return payload?.error ? { retry: false } : {};
        }),
      };

      const result = await processJob(
        client,
        "worker-auth",
        skillVersionJob("securityScanJobs:no-fallback"),
        undefined,
        "clawscan",
      );

      expect(result).toEqual({
        completed: false,
        hardFailed: true,
        retryableFailed: false,
      });
      await expect(readFile(markerPath, "utf8")).rejects.toThrow();
    } finally {
      if (previousCommand === undefined) delete process.env.CODEX_SECURITY_SCAN_CLAWSCAN_COMMAND;
      else process.env.CODEX_SECURITY_SCAN_CLAWSCAN_COMMAND = previousCommand;
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
    }
  });
});
