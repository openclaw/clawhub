/* @vitest-environment node */
import { describe, expect, it } from "vitest";
import { createWorkerLogger } from "./workerLogger";

describe("worker logger", () => {
  it("emits structured info and error log events", () => {
    const lines: string[] = [];
    const logger = createWorkerLogger({
      name: "worker-logger-test",
      destination: { write: (line) => lines.push(line) },
    });

    logger.info({ event: "worker_test_started", jobId: "job1" }, "started");
    logger.error({ event: "worker_test_failed", jobId: "job1" }, "failed");

    expect(lines).toHaveLength(2);
    const [info, error] = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(info).toMatchObject({
      event: "worker_test_started",
      jobId: "job1",
      level: 30,
      msg: "started",
      service: "worker-logger-test",
    });
    expect(error).toMatchObject({
      event: "worker_test_failed",
      jobId: "job1",
      level: 50,
      msg: "failed",
      service: "worker-logger-test",
    });
  });

  it("redacts configured structured fields in emitted JSON", () => {
    const lines: string[] = [];
    const logger = createWorkerLogger({
      name: "worker-logger-test",
      destination: { write: (line) => lines.push(line) },
    });

    logger.info(
      {
        artifact: {
          downloadUrl: "https://signed.example.invalid/file?token=secret",
          path: "SKILL.md",
        },
        headers: { authorization: "Bearer worker-token-secret" },
        rawResult: "raw scanner output with url=https://signed.example.invalid/raw",
        publicReason: "Download failed 403 for artifact file SKILL.md",
        reason: "raw reason with https://signed.example.invalid/reason",
        stderr: "Authorization: Basic abc123",
        stdout: "raw stdout transcript",
        target: {
          files: [
            {
              path: "package.json",
              url: "https://signed.example.invalid/package?X-Amz-Signature=abc",
            },
          ],
        },
        token: "worker-token-secret",
      },
      "structured worker event",
    );

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] ?? "") as Record<string, unknown>;
    const text = JSON.stringify(parsed);
    expect(parsed.msg).toBe("structured worker event");
    expect(text).not.toContain("signed.example.invalid");
    expect(text).not.toContain("worker-token-secret");
    expect(text).not.toContain("raw reason");
    expect(text).not.toContain("raw stdout transcript");
    expect(text).toContain("Download failed 403 for artifact file SKILL.md");
    expect(text).toContain("[redacted-secret]");
    expect(parsed.artifact).toMatchObject({ path: "SKILL.md" });
  });
});
