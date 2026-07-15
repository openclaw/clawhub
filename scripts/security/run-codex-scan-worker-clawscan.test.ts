/* @vitest-environment node */
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClaimedJob } from "./run-codex-scan-worker";
import { processJob } from "./run-codex-scan-worker";

const tempDirs: string[] = [];

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

async function writeFakeClawScanCommand(path: string, body: string) {
  await writeFile(path, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`);
  await chmod(path, 0o755);
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
  ])(
    "persists %s ClawScan verdicts through the existing completion shape",
    async ({ verdict, expectedStatus }) => {
      const workspace = await tempDir();
      const fakeClawScan = join(workspace, "fake-clawscan");
      const argsLog = join(workspace, "clawscan-args.log");
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
{"schemaVersion":"clawscan-run-v1","profile":"clawhub","completedAt":"2026-07-15T00:00:00Z","scanners":{"skillspector":{"status":"completed","raw":{"risk_assessment":{"score":55,"severity":"HIGH","recommendation":"DO_NOT_INSTALL"},"issues":[{"id":"SDI-1","severity":"HIGH","explanation":"test finding"}]}},"virustotal":{"status":"completed","raw":{"status":"clean"}},"clawscan-static":{"status":"completed","raw":{"status":"clean"}}},"judge":{"status":"completed","promptSha256":"prompt-sha-1","outputSchemaSha256":"schema-sha-1","result":{"verdict":"${verdict}","confidence":"high","summary":"summary","dimensions":{"purpose_capability":{"status":"ok","detail":"ok"}},"scan_findings_in_context":[],"user_guidance":"guidance","model":"gpt-5.5"}}}
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

  it("accepts a skipped VirusTotal scanner status from ClawScan", async () => {
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
{"schemaVersion":"clawscan-run-v1","profile":"clawhub","completedAt":"2026-07-15T00:00:00Z","scanners":{"skillspector":{"status":"completed","raw":{"issues":[]}},"virustotal":{"status":"skipped","raw":{"reason":"directory target"}},"clawscan-static":{"status":"completed","raw":{"status":"clean"}}},"judge":{"status":"completed","result":{"verdict":"benign","confidence":"high","summary":"summary","dimensions":{"purpose_capability":{"status":"ok","detail":"ok"}},"scan_findings_in_context":[],"user_guidance":"guidance","model":"gpt-5.5"}}}
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
        skillVersionJob("securityScanJobs:vt-skipped"),
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
        llmAnalysis: { status: "clean", verdict: "benign" },
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

  it("fails the job when a required ClawScan scanner reports failed", async () => {
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
{"schemaVersion":"clawscan-run-v1","profile":"clawhub","scanners":{"skillspector":{"status":"failed","raw":{"error":"boom"}},"virustotal":{"status":"completed","raw":{"status":"clean"}},"clawscan-static":{"status":"completed","raw":{"status":"clean"}}},"judge":{"status":"completed","result":{"verdict":"benign","confidence":"high","summary":"summary","dimensions":{"purpose_capability":{"status":"ok","detail":"ok"}},"scan_findings_in_context":[],"user_guidance":"guidance","model":"gpt-5.5"}}}
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
