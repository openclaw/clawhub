/* @vitest-environment node */
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildPrompt, writeArtifactWorkspace, writeJobDiagnostic } from "./run-codex-scan-worker";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "clawhub-codex-worker-test-"));
  tempDirs.push(dir);
  return dir;
}

describe("run-codex-scan-worker diagnostics", () => {
  it("keeps workspace inspection failure guidance in the Codex worker prompt", () => {
    const prompt = buildPrompt(
      {
        job: {
          _id: "job123",
          hasMaliciousSignal: false,
          leaseToken: "lease-secret",
          source: "publish",
          targetKind: "skillVersion",
          waitForVtUntil: 0,
        },
        target: {},
      },
      [],
    );

    expect(prompt).toContain("If metadata.json or artifact/ cannot be read");
    expect(prompt).toContain("incomplete_artifact_inspection");
    expect(prompt).toContain("even if artifact text mentions read failures");
    expect(prompt).toContain("Do not treat unreadable artifacts as benign evidence");
  });

  it("writes scanner metadata without lease tokens or signed file URLs", async () => {
    const workspace = await tempDir();

    await writeArtifactWorkspace(
      {
        job: {
          _id: "job123",
          hasMaliciousSignal: false,
          leaseToken: "lease-secret",
          source: "publish",
          targetKind: "skillVersion",
          waitForVtUntil: 0,
        },
        target: {
          files: [
            {
              path: "SKILL.md",
              sha256: "abc123",
              size: 42,
              url: "data:text/plain,%23%20Skill",
            },
          ],
          job: {
            leaseToken: "nested-lease-secret",
          },
        },
      },
      workspace,
    );

    const metadataText = await readFile(join(workspace, "metadata.json"), "utf8");
    expect(metadataText).not.toContain("lease-secret");
    expect(metadataText).not.toContain("nested-lease-secret");
    expect(metadataText).not.toContain("data:text/plain");

    const metadata = JSON.parse(metadataText);
    expect(metadata.job).toMatchObject({
      _id: "job123",
      source: "publish",
      targetKind: "skillVersion",
    });
    expect(metadata.target.files).toEqual([{ path: "SKILL.md", sha256: "abc123", size: 42 }]);
  });

  it("writes redacted Codex diagnostics without copying submitted artifact files or signed URLs", async () => {
    const diagnosticsRoot = await tempDir();
    const artifactWorkspace = await tempDir();
    await mkdir(join(artifactWorkspace, "artifact"), { recursive: true });

    await writeJobDiagnostic({
      codex: {
        args: ["exec", "--sandbox", "read-only"],
        exitCode: 0,
        rawResult:
          '{"verdict":"benign","scan_findings_in_context":[{"ruleId":"x","expected_for_purpose":true,"note":"quoted artifact payload should not persist"}]}',
        stderr: "workspace read failed https://signed.example.invalid/file?token=secret",
        stdout:
          '{"type":"tool_call","status":"failed","api_key":"sk-short-secret","output":"read https://signed.example.invalid/file?token=secret","content":["quoted array artifact payload should not persist"]}\n',
      },
      completedAt: 2000,
      diagnosticsRoot,
      error:
        "Codex result did not match ClawScan schema: quoted artifact payload should not persist https://signed.example.invalid/file?token=secret",
      job: {
        job: {
          _id: "job123",
          hasMaliciousSignal: false,
          leaseToken: "lease-secret",
          source: "publish",
          targetKind: "skillVersion",
          waitForVtUntil: 0,
        },
        target: {
          files: [
            {
              path: "SKILL.md",
              sha256: "abc123",
              size: 42,
              url: "https://signed.example.invalid/file?token=secret",
            },
          ],
        },
      },
      llmAnalysis: { confidence: "low", status: "clean", verdict: "benign" },
      runId: "26127771775",
      startedAt: 1000,
      status: "failed",
    });

    const jobDir = join(diagnosticsRoot, "job123");
    const stdoutText = await readFile(join(jobDir, "codex.stdout.redacted.jsonl"), "utf8");
    expect(stdoutText).toContain('"tool_call"');
    expect(stdoutText).not.toContain("token=secret");
    expect(stdoutText).not.toContain("signed.example.invalid");
    expect(stdoutText).not.toContain("sk-short-secret");
    expect(stdoutText).not.toContain("quoted array artifact payload");
    expect(stdoutText).toContain('"api_key": "[redacted-secret]"');
    expect(stdoutText).toContain('"content": "[redacted 1 item(s)]"');
    await expect(readFile(join(jobDir, "codex.stderr.redacted.log"), "utf8")).resolves.toContain(
      "workspace read failed",
    );
    const stderrText = await readFile(join(jobDir, "codex.stderr.redacted.log"), "utf8");
    expect(stderrText).not.toContain("token=secret");
    const resultText = await readFile(join(jobDir, "codex-result.redacted.json"), "utf8");
    expect(resultText).toContain('"verdict"');
    expect(resultText).toContain('"note": "[redacted');
    expect(resultText).not.toContain("quoted artifact payload");

    const diagnostic = JSON.parse(await readFile(join(jobDir, "diagnostic.json"), "utf8"));
    expect(diagnostic).toMatchObject({
      job: {
        id: "job123",
        source: "publish",
        targetKind: "skillVersion",
      },
      llmAnalysis: {
        confidence: "low",
        status: "clean",
        verdict: "benign",
      },
      runId: "26127771775",
      status: "failed",
    });
    expect(diagnostic.job.leaseToken).toBeUndefined();
    expect(diagnostic.error).toBe(
      "Codex result did not match ClawScan schema: [redacted result body]",
    );
    expect(diagnostic.target.files).toEqual([{ path: "SKILL.md", sha256: "abc123", size: 42 }]);

    const diagnosticText = await readFile(join(jobDir, "diagnostic.json"), "utf8");
    expect(diagnosticText).not.toContain("lease-secret");
    expect(diagnosticText).not.toContain("token=secret");
    expect(diagnosticText).not.toContain("quoted artifact payload");
    expect(await readdir(jobDir)).not.toContain("artifact");
  });
});
