/* @vitest-environment node */
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import {
  configurePrePublicationCodexHome,
  processPrePublicationBatch,
  processPrePublicationAttempt,
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
  it("does not clear the Codex home configured by GitHub Actions login", () => {
    const env = {
      CI: "true",
      GITHUB_ACTIONS: "true",
      GITHUB_REPOSITORY: "openclaw/clawhub",
      GITHUB_RUN_ID: "123",
    } as NodeJS.ProcessEnv;

    expect(configurePrePublicationCodexHome(env)).toBeUndefined();
    expect(env).not.toHaveProperty("CODEX_HOME");
  });

  it("requires the TruffleHog image to be pinned by digest", () => {
    expect(resolveTruffleHogImage()).toContain("@sha256:");
    expect(() => resolveTruffleHogImage("ghcr.io/trufflesecurity/trufflehog:3.95.6")).toThrow(
      "must be pinned",
    );
  });

  it("completes clean staged publishes after TruffleHog and ClawHub review pass", async () => {
    const client = {
      action: vi.fn().mockResolvedValue({ status: "finalized" }),
    };
    const runTruffleHog = vi.fn().mockResolvedValue({
      exitCode: 0,
      status: "clean",
      summary: "TruffleHog found no verified secrets.",
    });
    const runClawHubReview = vi.fn().mockResolvedValue({
      llmAnalysis: {
        checkedAt: 123,
        confidence: "high",
        status: "clean",
        summary: "ClawHub security review passed.",
        verdict: "benign",
      },
    });

    await expect(
      processPrePublicationAttempt(client, "worker-token", attempt, {
        runClawHubReview,
        runTruffleHog,
        writeWorkspace: vi.fn().mockResolvedValue(undefined),
      }),
    ).resolves.toMatchObject({ completed: true });

    expect(runTruffleHog).toHaveBeenCalledTimes(1);
    expect(runClawHubReview).toHaveBeenCalledTimes(1);
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

  it("publishes suspicious staged artifacts without treating them as malicious", async () => {
    const client = {
      action: vi.fn().mockResolvedValue({ status: "finalized" }),
    };

    await expect(
      processPrePublicationAttempt(client, "worker-token", attempt, {
        runClawHubReview: vi.fn().mockResolvedValue({
          llmAnalysis: {
            checkedAt: 123,
            confidence: "high",
            status: "suspicious",
            summary: "The artifact needs moderator review.",
            verdict: "suspicious",
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
        runClawHubReview: vi.fn().mockResolvedValue({
          llmAnalysis: {
            checkedAt: 123,
            confidence: "high",
            status: "malicious",
            summary: "The artifact contains intentional credential exfiltration.",
            verdict: "malicious",
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

  it("blocks secret-positive attempts without running ClawHub review", async () => {
    const client = {
      action: vi.fn().mockResolvedValue({ status: "blocked" }),
    };
    const runTruffleHog = vi.fn().mockResolvedValue({
      status: "blocked",
      summary: "TruffleHog found verified secret material.",
      redactedFindings: ["GitHub token in filesystem"],
    });
    const runClawHubReview = vi.fn();

    await expect(
      processPrePublicationAttempt(client, "worker-token", attempt, {
        runClawHubReview,
        runTruffleHog,
        writeWorkspace: vi.fn().mockResolvedValue(undefined),
      }),
    ).resolves.toMatchObject({ completed: true });

    expect(runClawHubReview).not.toHaveBeenCalled();
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
        runClawHubReview: vi.fn(),
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
    const runClawHubReview = vi.fn();
    const runTruffleHog = vi.fn();
    const writeWorkspace = vi.fn();

    await expect(
      processPrePublicationAttempt(
        client,
        "worker-token",
        { ...attempt, status: "ready_to_finalize", files: [] },
        {
          runClawHubReview,
          runTruffleHog,
          writeWorkspace,
        },
      ),
    ).resolves.toMatchObject({ completed: true });

    expect(writeWorkspace).not.toHaveBeenCalled();
    expect(runTruffleHog).not.toHaveBeenCalled();
    expect(runClawHubReview).not.toHaveBeenCalled();
    expect(client.action).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        attemptId: attempt.attemptId,
        trufflehog: expect.objectContaining({ status: "clean" }),
        clawscan: expect.objectContaining({ status: "clean" }),
      }),
    );
  });

  it("passes package ClawPack and manifest context into the ClawHub review job", async () => {
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
        runClawHubReview: vi.fn().mockResolvedValue({
          llmAnalysis: {
            checkedAt: 123,
            confidence: "high",
            status: "clean",
            summary: "ClawHub security review passed.",
            verdict: "benign",
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
          runClawHubReview: vi.fn(),
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
