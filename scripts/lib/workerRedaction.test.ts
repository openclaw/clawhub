/* @vitest-environment node */
import { describe, expect, it } from "vitest";
import {
  maskGitHubActionsSecret,
  maskKnownWorkerSecrets,
  redactWorkerErrorMessage,
  redactWorkerText,
  safeWorkerArtifactPathLabel,
} from "./workerRedaction";

describe("worker redaction", () => {
  it("redacts URLs and auth headers without acting as a secret detector", () => {
    const sha256 = "a".repeat(64);
    const raw = [
      "download https://signed.example.invalid/file?token=secret&X-Amz-Signature=abc",
      "Authorization: Bearer abc.def.ghi",
      "Authorization: Basic dXNlcjpwYXNz",
      "OPENAI_API_KEY=openai-runtime-secret",
      "GITHUB_TOKEN=runtime-token-secret",
      "api_key=plugin-api-token",
      `artifact_sha256=${sha256}`,
    ].join("\n");

    const redacted = redactWorkerText(raw);

    expect(redacted).not.toContain("https://");
    expect(redacted).not.toContain("signed.example.invalid");
    expect(redacted).not.toContain("token=secret");
    expect(redacted).not.toContain("X-Amz-Signature");
    expect(redacted).not.toContain("Bearer abc");
    expect(redacted).not.toContain("Basic dXN");
    expect(redacted).toContain("OPENAI_API_KEY=openai-runtime-secret");
    expect(redacted).toContain("GITHUB_TOKEN=runtime-token-secret");
    expect(redacted).toContain("api_key=plugin-api-token");
    expect(redacted).toContain(`artifact_sha256=${sha256}`);
    expect(redacted).toContain("[redacted-url]");
    expect(redacted).toContain("[redacted-secret]");
  });

  it("uses the same narrow cleanup for worker error messages", () => {
    const message = redactWorkerErrorMessage(
      "fetch failed https://signed.example.invalid/file Authorization: Bearer abc.def",
    );

    expect(message).not.toContain("https://");
    expect(message).not.toContain("Bearer abc");
    expect(message).toContain("[redacted-url]");
    expect(message).toContain("[redacted-secret]");
  });

  it("only displays artifact paths that pass a safe allowlist", () => {
    expect(safeWorkerArtifactPathLabel("SKILL.md")).toBe("SKILL.md");
    expect(safeWorkerArtifactPathLabel("nested/package.json")).toBe("nested/package.json");
    expect(safeWorkerArtifactPathLabel("../SKILL.md")).toBe("[redacted-path]");
    expect(safeWorkerArtifactPathLabel("unsafe/token=runtime-value.md")).toBe("[redacted-path]");
  });

  it("emits exact GitHub Actions masks only in GitHub Actions", () => {
    const lines: string[] = [];

    expect(
      maskGitHubActionsSecret("https://signed.example.invalid/file?token=secret", {
        env: { GITHUB_ACTIONS: "true" } as NodeJS.ProcessEnv,
        write: (line) => lines.push(line),
      }),
    ).toBe(true);
    expect(
      maskGitHubActionsSecret("local-secret", {
        env: {} as NodeJS.ProcessEnv,
        write: (line) => lines.push(line),
      }),
    ).toBe(false);

    expect(lines).toEqual(["::add-mask::https://signed.example.invalid/file?token=secret\n"]);
  });

  it("masks known worker secrets from the runtime environment", () => {
    const lines: string[] = [];

    maskKnownWorkerSecrets(
      {
        GITHUB_ACTIONS: "true",
        OPENAI_API_KEY: "sk-runtime-secret",
        SECURITY_SCAN_WORKER_TOKEN: "worker-token-secret",
      } as NodeJS.ProcessEnv,
      (line) => lines.push(line),
    );

    expect(lines).toContain("::add-mask::sk-runtime-secret\n");
    expect(lines).toContain("::add-mask::worker-token-secret\n");
  });
});
