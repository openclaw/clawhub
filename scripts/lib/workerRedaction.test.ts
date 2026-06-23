/* @vitest-environment node */
import { describe, expect, it } from "vitest";
import {
  maskGitHubActionsSecret,
  maskKnownWorkerSecrets,
  redactWorkerErrorMessage,
  redactWorkerText,
} from "./workerRedaction";

describe("worker redaction", () => {
  it("redacts signed URLs, auth headers, and explicit secret-labeled text", () => {
    const sha256 = "a".repeat(64);
    const raw = [
      "download https://signed.example.invalid/file?token=secret&X-Amz-Signature=abc",
      "Authorization: Bearer abc.def.ghi",
      "Authorization: Basic dXNlcjpwYXNz",
      "OPENAI_API_KEY=openai-runtime-secret",
      "GITHUB_TOKEN=runtime-token-secret",
      `CONVEX_WORKER_TOKEN=${"c".repeat(72)}`,
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
    expect(redacted).not.toContain("openai-runtime-secret");
    expect(redacted).not.toContain("runtime-token-secret");
    expect(redacted).not.toContain("plugin-api-token");
    expect(redacted).not.toContain("CONVEX_WORKER_TOKEN=");
    expect(redacted).toContain(`artifact_sha256=${sha256}`);
    expect(redacted).toContain("[redacted-url]");
    expect(redacted).toContain("[redacted-secret]");
  });

  it("collapses secret-bearing error labels after text redaction", () => {
    const message = redactWorkerErrorMessage(
      "OPENAI_API_KEY=sk-short-secret token=[redacted-secret] X-Amz-Signature=abc",
    );

    expect(message).not.toContain("OPENAI_API_KEY");
    expect(message).not.toContain("token=");
    expect(message).not.toContain("X-Amz-Signature");
    expect(message).toContain("[redacted-secret]");
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
