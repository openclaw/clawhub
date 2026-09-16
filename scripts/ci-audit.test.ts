import { describe, expect, it, vi } from "vitest";
import { auditArgs, isTransientAuditFailure, runAuditWithRetry } from "./ci-audit";

const CONNECTION_DROP = "bun audit v1.3.10 (30e609e0)\nConnectionClosed: audit request failed\n";
const FINDINGS =
  "bun audit v1.3.10 (30e609e0)\n\nlodash  <4.17.21\n  high  Prototype Pollution\n\n1 vulnerabilities (1 high)\n";

describe("ci-audit", () => {
  it("classifies dropped advisory connections as transient and findings as real", () => {
    expect(isTransientAuditFailure(CONNECTION_DROP)).toBe(true);
    expect(isTransientAuditFailure("error: fetch failed\n")).toBe(true);
    expect(isTransientAuditFailure("[ci-audit] ETIMEDOUT: bun audit exceeded 60s\n")).toBe(true);
    expect(isTransientAuditFailure(FINDINGS)).toBe(false);
  });

  it("passes every accepted advisory as an --ignore flag", () => {
    const args = auditArgs();
    expect(args[0]).toBe("audit");
    expect(args.filter((arg) => arg === "--ignore")).toHaveLength(13);
    expect(args).toContain("GHSA-pr7r-676h-xcf6");
  });

  it("retries transient failures until the audit succeeds", async () => {
    const attempt = vi
      .fn<() => { exitCode: number; output: string }>()
      .mockReturnValueOnce({ exitCode: 1, output: CONNECTION_DROP })
      .mockReturnValueOnce({ exitCode: 1, output: CONNECTION_DROP })
      .mockReturnValueOnce({ exitCode: 0, output: "No vulnerabilities found\n" });
    const sleep = vi.fn(async (_ms: number) => {});
    const log = vi.fn();

    await expect(runAuditWithRetry(attempt, sleep, log)).resolves.toBe(0);
    expect(attempt).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([5_000, 10_000]);
    expect(log).toHaveBeenCalledTimes(2);
  });

  it("fails immediately on real advisory findings", async () => {
    const attempt = vi.fn(() => ({ exitCode: 1, output: FINDINGS }));
    const sleep = vi.fn(async (_ms: number) => {});

    await expect(runAuditWithRetry(attempt, sleep, () => {})).resolves.toBe(1);
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("gives up after the retry budget with the last exit code", async () => {
    const attempt = vi.fn(() => ({ exitCode: 3, output: CONNECTION_DROP }));
    const sleep = vi.fn(async (_ms: number) => {});

    await expect(runAuditWithRetry(attempt, sleep, () => {})).resolves.toBe(3);
    expect(attempt).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });
});
