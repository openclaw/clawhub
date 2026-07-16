/* @vitest-environment node */
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type ClaimedJob,
  processJob,
  resolveSecurityScanMode,
  type SecurityScanMode,
} from "./run-codex-scan-worker";

const tempDirs: string[] = [];
const jobFixture = "lease-fixture";

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "clawhub-scan-mode-test-"));
  tempDirs.push(dir);
  return dir;
}

async function writeCommand(path: string, body: string) {
  await writeFile(path, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`);
  await chmod(path, 0o755);
}

function claimedJob(id: string): ClaimedJob {
  return {
    job: {
      _id: `securityScanJobs:${id}`,
      hasMaliciousSignal: false,
      leaseToken: jobFixture,
      source: "publish",
      targetKind: "skillVersion",
      waitForVtUntil: 0,
    },
    target: {
      files: [
        {
          path: "SKILL.md",
          sha256: "artifact-sha",
          size: 8,
          url: "data:text/plain,%23%20Skill",
        },
      ],
    },
  };
}

function completeClawScanArtifact(verdict: "benign" | "suspicious" | "malicious") {
  return JSON.stringify({
    schemaVersion: "clawscan-run-v1",
    profile: "clawhub",
    completedAt: "2026-07-15T00:00:00Z",
    scanners: {
      "clawscan-static": {
        status: "completed",
        raw: { status: "clean" },
      },
      skillspector: {
        status: "completed",
        raw: {
          status: "clean",
          issue_count: 0,
          issues: [],
        },
      },
      virustotal: {
        status: "completed",
        raw: { status: "clean" },
      },
    },
    judge: {
      status: "completed",
      promptSha256: "prompt-sha",
      outputSchemaSha256: "schema-sha",
      result: {
        verdict,
        confidence: "high",
        summary: "ClawScan result",
        dimensions: {
          purpose_capability: { status: "ok", detail: "ok" },
          instruction_scope: { status: "ok", detail: "ok" },
          install_mechanism: { status: "ok", detail: "ok" },
          environment_proportionality: { status: "ok", detail: "ok" },
          persistence_privilege: { status: "ok", detail: "ok" },
        },
        scan_findings_in_context: [],
        user_guidance: "guidance",
      },
    },
  });
}

async function setupCommands(options?: {
  clawscanFailure?: string;
  clawscanVerdict?: "benign" | "suspicious" | "malicious";
  legacyFailure?: string;
  legacyVerdict?: "benign" | "suspicious" | "malicious";
}) {
  const root = await tempDir();
  const binDir = join(root, "bin");
  const marker = join(root, "invocations.log");
  await mkdir(binDir, { recursive: true });

  await writeCommand(
    join(binDir, "skillspector"),
    `echo "legacy-skillspector:$PWD" >> ${JSON.stringify(marker)}
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

  await writeCommand(
    join(binDir, "codex"),
    `echo "legacy-codex:$PWD" >> ${JSON.stringify(marker)}
${options?.legacyFailure ? `echo ${JSON.stringify(options.legacyFailure)} >&2\nexit 19` : ""}
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
${JSON.stringify({
  verdict: options?.legacyVerdict ?? "suspicious",
  confidence: "medium",
  summary: "Legacy result",
  dimensions: {
    purpose_capability: { status: "ok", detail: "ok" },
  },
  scan_findings_in_context: [],
  user_guidance: "guidance",
})}
JSON`,
  );

  const clawscan = join(root, "clawscan");
  await writeCommand(
    clawscan,
    `echo "clawscan:$PWD:$1" >> ${JSON.stringify(marker)}
${options?.clawscanFailure ? `echo ${JSON.stringify(options.clawscanFailure)} >&2\nexit 17` : ""}
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
${completeClawScanArtifact(options?.clawscanVerdict ?? "malicious")}
JSON`,
  );

  return { binDir, clawscan, marker, root };
}

async function withCommands<T>(
  commands: Awaited<ReturnType<typeof setupCommands>>,
  run: () => Promise<T>,
) {
  const previousCommand = process.env.CODEX_SECURITY_SCAN_CLAWSCAN_COMMAND;
  const previousPath = process.env.PATH;
  process.env.CODEX_SECURITY_SCAN_CLAWSCAN_COMMAND = commands.clawscan;
  process.env.PATH = `${commands.binDir}:${previousPath ?? ""}`;
  try {
    return await run();
  } finally {
    if (previousCommand === undefined) delete process.env.CODEX_SECURITY_SCAN_CLAWSCAN_COMMAND;
    else process.env.CODEX_SECURITY_SCAN_CLAWSCAN_COMMAND = previousCommand;
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
  }
}

function completionPayload(client: { action: ReturnType<typeof vi.fn> }) {
  return client.action.mock.calls.find((call) => {
    const payload = call[1] as { llmAnalysis?: unknown } | undefined;
    return payload?.llmAnalysis !== undefined;
  })?.[1] as
    | {
        llmAnalysis?: { status?: string; verdict?: string };
        skillSpectorAnalysis?: { status?: string };
      }
    | undefined;
}

async function invocationLines(marker: string) {
  try {
    return (await readFile(marker, "utf8")).trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

describe("security scan rollout modes", () => {
  it.each([
    {
      mode: "legacy" as const,
      expectedClawScan: 0,
      expectedLegacyCodex: 1,
      expectedLegacySkillSpector: 1,
      expectedStatus: "suspicious",
      expectedVerdict: "suspicious",
    },
    {
      mode: "shadow" as const,
      expectedClawScan: 1,
      expectedLegacyCodex: 1,
      expectedLegacySkillSpector: 1,
      expectedStatus: "suspicious",
      expectedVerdict: "suspicious",
    },
    {
      mode: "clawscan" as const,
      expectedClawScan: 1,
      expectedLegacyCodex: 1,
      expectedLegacySkillSpector: 1,
      expectedStatus: "malicious",
      expectedVerdict: "malicious",
    },
  ])(
    "$mode invokes the expected implementations and persists only its authoritative result",
    async ({
      mode,
      expectedClawScan,
      expectedLegacyCodex,
      expectedLegacySkillSpector,
      expectedStatus,
      expectedVerdict,
    }) => {
      const commands = await setupCommands();
      const diagnosticsRoot = await tempDir();
      const client = {
        action: vi.fn(async (..._args: unknown[]) => ({})),
      };

      const result = await withCommands(commands, () =>
        processJob(client, "worker-token", claimedJob(mode), diagnosticsRoot, mode),
      );

      expect(result).toEqual({
        completed: true,
        hardFailed: false,
        retryableFailed: false,
      });
      expect(client.action).toHaveBeenCalledTimes(1);
      expect(completionPayload(client)).toMatchObject({
        llmAnalysis: {
          status: expectedStatus,
          verdict: expectedVerdict,
        },
      });

      const lines = await invocationLines(commands.marker);
      expect(lines.filter((line) => line.startsWith("clawscan:"))).toHaveLength(expectedClawScan);
      expect(lines.filter((line) => line.startsWith("legacy-codex:"))).toHaveLength(
        expectedLegacyCodex,
      );
      expect(lines.filter((line) => line.startsWith("legacy-skillspector:"))).toHaveLength(
        expectedLegacySkillSpector,
      );

      const workspaces = new Set(
        lines.map((line) => {
          const [, workspace] = line.split(":");
          return workspace;
        }),
      );
      expect([...workspaces]).toHaveLength(1);

      const comparisonPath = join(
        diagnosticsRoot,
        `securityScanJobs_${mode}`,
        "scan-comparison.json",
      );
      if (mode === "legacy") {
        await expect(readFile(comparisonPath, "utf8")).rejects.toThrow();
      } else {
        const comparison = JSON.parse(await readFile(comparisonPath, "utf8"));
        expect(comparison).toMatchObject({
          authoritative: {
            implementation: mode === "shadow" ? "legacy" : "clawscan",
            verdict: expectedVerdict,
          },
          secondary: {
            implementation: mode === "shadow" ? "clawscan" : "legacy",
          },
          status: "completed",
        });
      }
    },
  );

  it.each([
    {
      mode: "shadow" as const,
      options: { clawscanFailure: "diagnostic ClawScan failure" },
      expectedVerdict: "suspicious",
    },
    {
      mode: "clawscan" as const,
      options: { legacyFailure: "diagnostic legacy failure" },
      expectedVerdict: "malicious",
    },
  ])(
    "$mode ignores secondary failures after authoritative completion",
    async ({ mode, options, expectedVerdict }) => {
      const commands = await setupCommands(options);
      const diagnosticsRoot = await tempDir();
      const client = {
        action: vi.fn(async (..._args: unknown[]) => ({})),
      };

      const result = await withCommands(commands, () =>
        processJob(
          client,
          "worker-token",
          claimedJob(`${mode}-secondary-failed`),
          diagnosticsRoot,
          mode,
        ),
      );

      expect(result).toEqual({
        completed: true,
        hardFailed: false,
        retryableFailed: false,
      });
      expect(client.action).toHaveBeenCalledTimes(1);
      expect(completionPayload(client)?.llmAnalysis?.verdict).toBe(expectedVerdict);
      const comparison = JSON.parse(
        await readFile(
          join(
            diagnosticsRoot,
            `securityScanJobs_${mode}-secondary-failed`,
            "scan-comparison.json",
          ),
          "utf8",
        ),
      );
      expect(comparison).toMatchObject({
        status: "failed",
        error: expect.stringContaining(mode === "shadow" ? "exited 17" : "exited 19"),
      });
    },
  );

  it("fails authoritative ClawScan through the retry lifecycle without invoking legacy", async () => {
    const commands = await setupCommands({ clawscanFailure: "authoritative failure" });
    const client = {
      action: vi.fn(async (...args: unknown[]) => {
        const payload = args[1] as { error?: string } | undefined;
        return payload?.error ? { retry: true } : {};
      }),
    };

    const result = await withCommands(commands, () =>
      processJob(
        client,
        "worker-token",
        claimedJob("clawscan-authority-failed"),
        undefined,
        "clawscan",
      ),
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
    const lines = await invocationLines(commands.marker);
    expect(lines.filter((line) => line.startsWith("clawscan:"))).toHaveLength(1);
    expect(lines.some((line) => line.startsWith("legacy-"))).toBe(false);
  });

  it("rolls the whole route back by changing the mode to legacy", async () => {
    const commands = await setupCommands();
    const client = {
      action: vi.fn(async (..._args: unknown[]) => ({})),
    };

    await withCommands(commands, async () => {
      await processJob(
        client,
        "worker-token",
        claimedJob("before-rollback"),
        undefined,
        "clawscan",
      );
      await processJob(client, "worker-token", claimedJob("after-rollback"), undefined, "legacy");
    });

    const persistedVerdicts = client.action.mock.calls.map(
      (call) => (call[1] as { llmAnalysis?: { verdict?: string } }).llmAnalysis?.verdict,
    );
    expect(persistedVerdicts).toEqual(["malicious", "suspicious"]);
    const lines = await invocationLines(commands.marker);
    expect(lines.filter((line) => line.startsWith("clawscan:"))).toHaveLength(1);
    expect(lines.filter((line) => line.startsWith("legacy-codex:"))).toHaveLength(2);
  });

  it("defaults safely to legacy and accepts only the three rollout values", () => {
    expect(resolveSecurityScanMode(undefined)).toBe("legacy");
    expect(resolveSecurityScanMode("")).toBe("legacy");
    expect(["legacy", "shadow", "clawscan"].map((mode) => resolveSecurityScanMode(mode))).toEqual([
      "legacy",
      "shadow",
      "clawscan",
    ] satisfies SecurityScanMode[]);
    for (const invalid of ["codex", "ClawScan", " shadow ", "0", "true"]) {
      expect(() => resolveSecurityScanMode(invalid)).toThrow(
        `CODEX_SECURITY_SCAN_MODE must be one of legacy, shadow, or clawscan; received ${JSON.stringify(invalid)}`,
      );
    }
  });
});
