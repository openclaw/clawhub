/* @vitest-environment node */
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import {
  claimBatchDrainedQueue,
  claimPrePublicationAttempt,
  claimPrePublicationBatch,
  parseArgs,
  processPrePublicationBatch,
  processPrePublicationAttempt,
  runNativeClawScan,
  resolveTruffleHogImage,
  runNativeTruffleHog,
} from "./run-prepublication-worker";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "clawhub-prepublication-worker-test-"));
  tempDirs.push(dir);
  return dir;
}

const attempt = {
  attemptId: "publishAttempts:test" as Id<"publishAttempts">,
  claimId: "claim-test",
  kind: "skill" as const,
  slug: "demo-skill",
  displayName: "Demo Skill",
  version: "1.2.3",
  artifactFingerprint: "f".repeat(64),
  checkClaimExpiresAt: Date.now() + 60_000,
  createdAt: Date.now(),
  files: [
    {
      path: "SKILL.md",
      size: 12,
      sha256: "a".repeat(64),
      url: "https://signed.example.invalid/skill-md?token=secret",
      contentType: "text/markdown",
    },
  ],
};

describe("pre-publication worker", () => {
  it("treats empty scheduled recovery flags as absent", () => {
    expect(
      parseArgs(
        [
          "--batch-limit",
          "2",
          "--max-jobs",
          "--max-runtime-minutes",
          "8",
          "--attempt-id",
          "--kind",
          "--slug",
          "--version",
        ],
        {},
      ),
    ).toEqual({
      batchLimit: 2,
      maxJobs: undefined,
      maxRuntimeMs: 8 * 60 * 1000,
      claimFilters: {
        attemptId: undefined,
        kind: undefined,
        slug: undefined,
        version: undefined,
      },
    });
  });

  it("parses populated targeted recovery inputs", () => {
    expect(
      parseArgs(
        [
          "--batch-limit",
          "1",
          "--max-jobs",
          "1",
          "--max-runtime-minutes",
          "12",
          "--attempt-id",
          "publishAttempts:driver",
          "--kind",
          "skill",
          "--slug",
          "driver",
          "--version",
          "0.8.3",
        ],
        {},
      ),
    ).toEqual({
      batchLimit: 1,
      maxJobs: 1,
      maxRuntimeMs: 12 * 60 * 1000,
      claimFilters: {
        attemptId: "publishAttempts:driver",
        kind: "skill",
        slug: "driver",
        version: "0.8.3",
      },
    });
  });

  it("forwards targeted recovery filters when claiming an attempt", async () => {
    const client = {
      action: vi.fn().mockResolvedValue(attempt),
    };

    await expect(
      claimPrePublicationAttempt(client, "fixture", {
        kind: "skill",
        slug: "driver",
        version: "0.8.3",
      }),
    ).resolves.toEqual(attempt);

    expect(client.action).toHaveBeenCalledWith(expect.anything(), {
      token: "fixture",
      kind: "skill",
      slug: "driver",
      version: "0.8.3",
    });
  });

  it("keeps claiming after partial transient claim failures", () => {
    expect(claimBatchDrainedQueue(0, 0, 6)).toBe(true);
    expect(claimBatchDrainedQueue(0, 5, 6)).toBe(true);
    expect(claimBatchDrainedQueue(1, 5, 6)).toBe(false);
    expect(claimBatchDrainedQueue(0, 6, 6)).toBe(false);
  });

  it("requires the TruffleHog image to be pinned by digest", () => {
    expect(resolveTruffleHogImage()).toContain("@sha256:");
    expect(() => resolveTruffleHogImage("ghcr.io/trufflesecurity/trufflehog:3.95.6")).toThrow(
      "must be pinned",
    );
  });

  it("completes clean staged publishes after TruffleHog and ClawScan pass", async () => {
    const client = {
      action: vi.fn().mockResolvedValue({ status: "finalized" }),
    };
    const runTruffleHog = vi.fn().mockResolvedValue({
      exitCode: 0,
      status: "clean",
      summary: "TruffleHog found no verified secrets.",
    });
    const runClawScan = vi.fn().mockResolvedValue({
      analysis: {
        checkedAt: 123,
        confidence: "high",
        status: "clean",
        summary: "ClawScan passed.",
        verdict: "benign",
      },
      check: {
        status: "clean",
        summary: "ClawScan passed.",
      },
    });

    await expect(
      processPrePublicationAttempt(client, "worker-token", attempt, {
        runClawScan,
        runTruffleHog,
        writeWorkspace: vi.fn().mockResolvedValue(undefined),
      }),
    ).resolves.toMatchObject({ completed: true });

    expect(runTruffleHog).toHaveBeenCalledTimes(1);
    expect(runClawScan).toHaveBeenCalledTimes(1);
    expect(client.action).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        artifactFingerprint: attempt.artifactFingerprint,
        attemptId: attempt.attemptId,
        claimId: attempt.claimId,
        token: "worker-token",
        trufflehog: { status: "clean", summary: "TruffleHog found no verified secrets." },
        clawscan: expect.objectContaining({ status: "clean" }),
      }),
    );
    expect(client.action.mock.calls[0]?.[1].trufflehog).not.toHaveProperty("exitCode");
  });

  it("reuses a completed ClawScan verdict from the exact staged artifact", async () => {
    const client = {
      action: vi.fn().mockResolvedValue({ status: "finalized" }),
    };
    const runTruffleHog = vi.fn().mockResolvedValue({
      exitCode: 0,
      status: "clean",
      summary: "TruffleHog found no verified secrets.",
    });
    const runClawScan = vi.fn();
    const existingClawscanAnalysis = {
      checkedAt: 123,
      confidence: "high",
      status: "suspicious",
      summary: "Exact-artifact ClawScan review.",
      verdict: "suspicious",
    };

    await expect(
      processPrePublicationAttempt(
        client,
        "worker-token",
        { ...attempt, existingClawscanAnalysis },
        {
          runClawScan,
          runTruffleHog,
          writeWorkspace: vi.fn().mockResolvedValue(undefined),
        },
      ),
    ).resolves.toMatchObject({ completed: true });

    expect(runTruffleHog).toHaveBeenCalledTimes(1);
    expect(runClawScan).not.toHaveBeenCalled();
    expect(client.action).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        clawscan: expect.objectContaining({ status: "clean" }),
        clawscanAnalysis: existingClawscanAnalysis,
      }),
    );
  });

  it("publishes suspicious staged artifacts without treating them as malicious", async () => {
    const client = {
      action: vi.fn().mockResolvedValue({ status: "finalized" }),
    };

    await expect(
      processPrePublicationAttempt(client, "worker-token", attempt, {
        runClawScan: vi.fn().mockResolvedValue({
          analysis: {
            checkedAt: 123,
            confidence: "high",
            status: "suspicious",
            summary: "The artifact needs moderator review.",
            verdict: "suspicious",
          },
          check: {
            status: "clean",
            summary: "The artifact needs moderator review.",
            redactedFindings: ["status=suspicious; verdict=suspicious"],
          },
        }),
        runTruffleHog: vi.fn().mockResolvedValue({
          status: "clean",
          summary: "TruffleHog found no verified secrets.",
        }),
        writeWorkspace: vi.fn().mockResolvedValue(undefined),
      }),
    ).resolves.toMatchObject({ completed: true });

    expect(client.action).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        clawscan: {
          status: "clean",
          summary: "The artifact needs moderator review.",
          redactedFindings: ["status=suspicious; verdict=suspicious"],
        },
        clawscanAnalysis: expect.objectContaining({
          status: "suspicious",
          verdict: "suspicious",
        }),
      }),
    );
  });

  it("keeps malicious staged artifacts private", async () => {
    const client = {
      action: vi.fn().mockResolvedValue({ status: "blocked" }),
    };

    await expect(
      processPrePublicationAttempt(client, "worker-token", attempt, {
        runClawScan: vi.fn().mockResolvedValue({
          analysis: {
            checkedAt: 123,
            confidence: "high",
            status: "malicious",
            summary: "The artifact contains intentional credential exfiltration.",
            verdict: "malicious",
          },
          check: {
            status: "blocked",
            summary: "The artifact contains intentional credential exfiltration.",
            redactedFindings: ["status=malicious; verdict=malicious"],
          },
        }),
        runTruffleHog: vi.fn().mockResolvedValue({
          status: "clean",
          summary: "TruffleHog found no verified secrets.",
        }),
        writeWorkspace: vi.fn().mockResolvedValue(undefined),
      }),
    ).resolves.toMatchObject({ completed: true });

    expect(client.action).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        clawscan: expect.objectContaining({
          status: "blocked",
          redactedFindings: ["status=malicious; verdict=malicious"],
        }),
        clawscanAnalysis: expect.objectContaining({
          status: "malicious",
          verdict: "malicious",
        }),
      }),
    );
  });

  it("continues later attempts when one attempt throws", async () => {
    const laterAttempt = {
      ...attempt,
      attemptId: "publishAttempts:later" as Id<"publishAttempts">,
    };
    const processAttempt = vi
      .fn()
      .mockRejectedValueOnce(new Error("finalization conflict"))
      .mockResolvedValueOnce({ completed: true });

    await expect(
      processPrePublicationBatch([attempt, laterAttempt], processAttempt),
    ).resolves.toEqual([{ completed: false, result: undefined }, { completed: true }]);
    expect(processAttempt).toHaveBeenCalledTimes(2);
  });

  it("continues with successful claims when a concurrent claim fails", async () => {
    const client = {
      action: vi
        .fn()
        .mockRejectedValueOnce(new Error("claim conflict"))
        .mockResolvedValueOnce(attempt),
    };

    await expect(claimPrePublicationBatch(client, "worker-token", 2)).resolves.toEqual({
      attempts: [attempt],
      claimFailures: 1,
    });
    expect(client.action).toHaveBeenCalledTimes(2);
  });

  it("fails the worker batch when claims fail without claiming work", async () => {
    const client = {
      action: vi
        .fn()
        .mockRejectedValueOnce(new Error("claim conflict"))
        .mockResolvedValueOnce(null),
    };

    await expect(claimPrePublicationBatch(client, "worker-token", 2)).rejects.toThrow(
      "Pre-publication claims failed without claiming work.",
    );
  });

  it("blocks secret-positive attempts without running ClawScan", async () => {
    const client = {
      action: vi.fn().mockResolvedValue({ status: "blocked" }),
    };
    const runTruffleHog = vi.fn().mockResolvedValue({
      status: "blocked",
      summary: "TruffleHog found verified secret material.",
      redactedFindings: ["GitHub token in filesystem"],
    });
    const runClawScan = vi.fn();

    await expect(
      processPrePublicationAttempt(client, "worker-token", attempt, {
        runClawScan,
        runTruffleHog,
        writeWorkspace: vi.fn().mockResolvedValue(undefined),
      }),
    ).resolves.toMatchObject({ completed: true });

    expect(runClawScan).not.toHaveBeenCalled();
    expect(client.action).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        trufflehog: expect.objectContaining({
          redactedFindings: ["GitHub token in filesystem"],
          status: "blocked",
        }),
        clawscan: expect.objectContaining({
          status: "failed",
          summary: expect.stringContaining("skipped"),
        }),
      }),
    );
  });

  it("does not downgrade TruffleHog-positive attempts when blocked cleanup completion fails", async () => {
    const client = {
      action: vi.fn().mockRejectedValue(new Error("storage unavailable")),
    };
    const runTruffleHog = vi.fn().mockResolvedValue({
      status: "blocked",
      summary: "TruffleHog found verified secret material.",
      redactedFindings: ["GitHub token in filesystem"],
    });

    await expect(
      processPrePublicationAttempt(client, "worker-token", attempt, {
        runClawScan: vi.fn(),
        runTruffleHog,
        writeWorkspace: vi.fn().mockResolvedValue(undefined),
      }),
    ).resolves.toMatchObject({ completed: false, result: undefined });

    expect(client.action).toHaveBeenCalledTimes(1);
    expect(client.action).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        trufflehog: expect.objectContaining({ status: "blocked" }),
        clawscan: expect.objectContaining({
          status: "failed",
          summary: expect.stringContaining("skipped"),
        }),
      }),
    );
  });

  it("retries ready-to-finalize attempts without rerunning scanners", async () => {
    const client = {
      action: vi.fn().mockResolvedValue({ status: "finalized" }),
    };
    const runClawScan = vi.fn();
    const runTruffleHog = vi.fn();
    const writeWorkspace = vi.fn();

    await expect(
      processPrePublicationAttempt(
        client,
        "worker-token",
        { ...attempt, status: "ready_to_finalize", files: [] },
        {
          runClawScan,
          runTruffleHog,
          writeWorkspace,
        },
      ),
    ).resolves.toMatchObject({ completed: true });

    expect(writeWorkspace).not.toHaveBeenCalled();
    expect(runTruffleHog).not.toHaveBeenCalled();
    expect(runClawScan).not.toHaveBeenCalled();
    expect(client.action).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        attemptId: attempt.attemptId,
        trufflehog: expect.objectContaining({ status: "clean" }),
        clawscan: expect.objectContaining({ status: "clean" }),
      }),
    );
  });

  it("passes package ClawPack and manifest context into the ClawScan job", async () => {
    const packageAttempt = {
      ...attempt,
      kind: "package" as const,
      slug: "demo-plugin",
      displayName: "Demo Plugin",
      artifactFingerprint: "b".repeat(64),
      clawpackUrl: "https://signed.example.invalid/package.tgz?token=secret",
      scanContext: {
        trustedOpenClawPlugin: true,
        release: {
          artifactKind: "npm-pack",
          pluginManifestSummary: {
            bundledSkills: [{ rootPath: "skills/demo" }],
          },
          staticScan: { status: "clean" },
        },
      },
    };
    const client = {
      action: vi.fn().mockResolvedValue({ status: "finalized" }),
    };
    const writeWorkspace = vi.fn().mockResolvedValue(undefined);

    await expect(
      processPrePublicationAttempt(client, "worker-token", packageAttempt, {
        runClawScan: vi.fn().mockResolvedValue({
          analysis: {
            checkedAt: 123,
            confidence: "high",
            status: "clean",
            summary: "ClawScan passed.",
            verdict: "benign",
          },
          check: {
            status: "clean",
            summary: "ClawScan passed.",
          },
        }),
        runTruffleHog: vi.fn().mockResolvedValue({
          status: "clean",
          summary: "TruffleHog found no verified secrets.",
        }),
        writeWorkspace,
      }),
    ).resolves.toMatchObject({ completed: true });

    expect(writeWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        job: expect.objectContaining({ targetKind: "packageRelease" }),
        target: expect.objectContaining({
          clawpackUrl: packageAttempt.clawpackUrl,
          trustedOpenClawPlugin: true,
          release: expect.objectContaining({
            artifactKind: "npm-pack",
            integritySha256: packageAttempt.artifactFingerprint,
            pluginManifestSummary: packageAttempt.scanContext.release.pluginManifestSummary,
          }),
        }),
      }),
      expect.any(String),
    );
  });

  it("marks attempts failed when staged artifact URLs are unavailable", async () => {
    const client = {
      action: vi.fn().mockResolvedValue({ status: "failed" }),
    };

    await expect(
      processPrePublicationAttempt(
        client,
        "worker-token",
        {
          ...attempt,
          files: [{ ...attempt.files[0], url: null }],
        },
        {
          runClawScan: vi.fn(),
          runTruffleHog: vi.fn(),
          writeWorkspace: vi.fn().mockResolvedValue(undefined),
        },
      ),
    ).resolves.toMatchObject({ completed: false });

    expect(client.action).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        trufflehog: expect.objectContaining({
          status: "failed",
          summary: expect.stringContaining("Artifact file unavailable"),
        }),
        clawscan: expect.objectContaining({
          status: "failed",
          summary: expect.stringContaining("Artifact file unavailable"),
        }),
      }),
    );
  });

  it("runs native ClawScan as the required non-shadow security gate", async () => {
    const workspace = await tempDir();
    await mkdir(join(workspace, "artifact"), { recursive: true });
    await writeFile(join(workspace, "artifact", "SKILL.md"), "# Demo\n");
    const fakeClawScan = join(workspace, "fake-clawscan");
    await writeFile(
      fakeClawScan,
      `#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$@" > "${workspace}/clawscan-args.txt"
output=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--output" ]; then
    output="$2"
    break
  fi
  shift
done
cat > "$output" <<'JSON'
{"schemaVersion":"clawscan-run-v1","profile":"clawhub","scanners":{"clawscan-static":{"status":"completed"},"skillspector":{"status":"completed"}},"judge":{"status":"completed","result":{"verdict":"benign","confidence":"high","summary":"Native ClawScan passed."}}}
JSON
`,
    );
    await chmod(fakeClawScan, 0o755);
    const previousCommand = process.env.PREPUBLICATION_CLAWSCAN_COMMAND;
    const previousSandbox = process.env.PREPUBLICATION_CLAWSCAN_SANDBOX;
    process.env.PREPUBLICATION_CLAWSCAN_COMMAND = fakeClawScan;
    delete process.env.PREPUBLICATION_CLAWSCAN_SANDBOX;

    try {
      await expect(
        runNativeClawScan(
          {
            job: {
              _id: String(attempt.attemptId),
              attempts: 1,
              hasMaliciousSignal: false,
              leaseToken: attempt.claimId,
              source: "pre-publication",
              targetKind: "skillVersion",
              waitForVtUntil: 0,
            },
            target: {},
          },
          workspace,
        ),
      ).resolves.toEqual(
        expect.objectContaining({
          analysis: expect.objectContaining({
            status: "clean",
            verdict: "benign",
          }),
          check: {
            status: "clean",
            summary: "Native ClawScan passed.",
          },
        }),
      );

      const args = await readFile(join(workspace, "clawscan-args.txt"), "utf8");
      expect(args).toContain("./artifact");
      expect(args).toContain("--profile\nclawhub");
      expect(args).toContain("--output\n");
      expect(args).not.toContain("--sandbox");
    } finally {
      if (previousCommand === undefined) delete process.env.PREPUBLICATION_CLAWSCAN_COMMAND;
      else process.env.PREPUBLICATION_CLAWSCAN_COMMAND = previousCommand;
      if (previousSandbox === undefined) delete process.env.PREPUBLICATION_CLAWSCAN_SANDBOX;
      else process.env.PREPUBLICATION_CLAWSCAN_SANDBOX = previousSandbox;
    }
  });

  it("preserves the redacted ClawScan judge failure reason", async () => {
    const workspace = await tempDir();
    await mkdir(join(workspace, "artifact"), { recursive: true });
    await writeFile(join(workspace, "artifact", "SKILL.md"), "# Demo\n");
    const fakeClawScan = join(workspace, "fake-clawscan");
    await writeFile(
      fakeClawScan,
      `#!/usr/bin/env bash
set -euo pipefail
output=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--output" ]; then
    output="$2"
    break
  fi
  shift
done
cat > "$output" <<'JSON'
{"schemaVersion":"clawscan-run-v1","profile":"clawhub","scanners":{"clawscan-static":{"status":"completed"},"skillspector":{"status":"completed"},"virustotal":{"status":"completed"}},"judge":{"status":"failed","error":"Codex request was rate limited.","result":null}}
JSON
`,
    );
    await chmod(fakeClawScan, 0o755);
    const previousCommand = process.env.PREPUBLICATION_CLAWSCAN_COMMAND;
    process.env.PREPUBLICATION_CLAWSCAN_COMMAND = fakeClawScan;

    try {
      await expect(
        runNativeClawScan(
          {
            job: {
              _id: String(attempt.attemptId),
              attempts: 1,
              hasMaliciousSignal: false,
              leaseToken: attempt.claimId,
              source: "pre-publication",
              targetKind: "skillVersion",
              waitForVtUntil: 0,
            },
            target: {},
          },
          workspace,
        ),
      ).resolves.toEqual({
        check: {
          status: "failed",
          summary: "ClawScan judge status was failed: Codex request was rate limited.",
        },
      });
    } finally {
      if (previousCommand === undefined) delete process.env.PREPUBLICATION_CLAWSCAN_COMMAND;
      else process.env.PREPUBLICATION_CLAWSCAN_COMMAND = previousCommand;
    }
  });

  it("maps TruffleHog verified-secret exit code to a blocked result", async () => {
    const workspace = await tempDir();
    await mkdir(join(workspace, "artifact"), { recursive: true });
    const fakeTruffleHog = join(workspace, "fake-trufflehog");
    await writeFile(
      fakeTruffleHog,
      `#!/usr/bin/env bash
cat <<'JSON'
{"DetectorName":"GitHub","SourceName":"Filesystem"}
JSON
exit 183
`,
    );
    await chmod(fakeTruffleHog, 0o755);
    const previousCommand = process.env.PREPUBLICATION_TRUFFLEHOG_COMMAND;
    process.env.PREPUBLICATION_TRUFFLEHOG_COMMAND = fakeTruffleHog;

    await expect(runNativeTruffleHog(workspace)).resolves.toMatchObject({
      redactedFindings: ["GitHub in Filesystem"],
      status: "blocked",
    });

    if (previousCommand === undefined) delete process.env.PREPUBLICATION_TRUFFLEHOG_COMMAND;
    else process.env.PREPUBLICATION_TRUFFLEHOG_COMMAND = previousCommand;
  });
});
