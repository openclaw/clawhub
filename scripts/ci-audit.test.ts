import { describe, expect, it, vi } from "vitest";
import { auditArgs, auditExitCode, isTransientAuditFailure, runAuditWithRetry } from "./ci-audit";

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

  it("records advisories as warnings without failing the gate", () => {
    const log = vi.fn();
    const output = JSON.stringify({
      "fast-uri": [
        {
          title: "fast-uri host normalization",
          url: "https://github.com/advisories/GHSA-hrr3-gc8f-f4qj",
          severity: "moderate",
        },
      ],
    });

    expect(auditExitCode({ exitCode: 1, output }, log)).toBe(0);
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(/^::warning title=Dependency advisory::fast-uri \(moderate\)/),
    );
  });

  it("parses Bun 1.3.10 audit JSON without its stderr banner", () => {
    const log = vi.fn();
    const jsonOutput = JSON.stringify({
      dompurify: [
        {
          title: "DOMPurify event handler advisory",
          url: "https://github.com/advisories/GHSA-p98j-92pf-mc4p",
          severity: "low",
          cwe: ["CWE-79"],
        },
      ],
    });
    const stderr = "\u001b[1mbun audit \u001b[2mv1.3.10 (30e609e0)\u001b[0m\n";
    const output = `${jsonOutput}\n${stderr}`;

    expect(auditExitCode({ exitCode: 1, output, jsonOutput, stderr }, log)).toBe(0);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^::warning .*dompurify/));
  });

  it("fails closed when Bun times out after writing advisory JSON", () => {
    const log = vi.fn();
    const jsonOutput = JSON.stringify({ dompurify: [{ title: "DOMPurify advisory" }] });
    const output = `${jsonOutput}\n[ci-audit] ETIMEDOUT: bun audit exceeded 60s\n`;

    expect(auditExitCode({ exitCode: 1, output, jsonOutput, toolFailure: true }, log)).toBe(1);
    expect(log).not.toHaveBeenCalled();
  });

  it("fails closed on unexpected stderr even with advisory JSON", () => {
    const log = vi.fn();
    const jsonOutput = JSON.stringify({ dompurify: [{ title: "DOMPurify advisory" }] });

    expect(
      auditExitCode(
        {
          exitCode: 1,
          output: `${jsonOutput}\nerror: audit request failed\n`,
          jsonOutput,
          stderr: "error: audit request failed\n",
        },
        log,
      ),
    ).toBe(1);
    expect(log).not.toHaveBeenCalled();
  });

  it("still fails on known malware", () => {
    const log = vi.fn();
    const output = JSON.stringify({
      "evil-pkg": [{ title: "Malware in evil-pkg", url: "https://github.com/advisories/GHSA-x" }],
    });

    expect(auditExitCode({ exitCode: 1, output }, log)).toBe(1);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^::error title=Dependency malware::/));
  });

  it("blocks malware and compromise advisories but warns on malicious-input bugs", () => {
    const output = JSON.stringify({
      synckit: [
        {
          title: "eslint-config-prettier, synckit have embedded malicious code",
          severity: "critical",
        },
      ],
      duckdb: [{ title: "DuckDB NPM packages briefly compromised with malware" }],
      "fast-uri": [{ title: "fast-uri host normalization", severity: "moderate" }],
      undici: [{ title: "Undici: Malicious WebSocket 64-bit length overflows parser" }],
      "@babel/traverse": [
        { title: "Babel arbitrary code execution when compiling crafted malicious code" },
      ],
    });
    const log = vi.fn();

    expect(auditExitCode({ exitCode: 1, output }, log)).toBe(1);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^::error .*synckit/));
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^::error .*duckdb/));
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^::warning .*fast-uri/));
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^::warning .*undici/));
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^::warning .*@babel\/traverse/));
  });

  it("applies the reviewed ignore list that bun audit --json skips", () => {
    const output = JSON.stringify({
      reviewed: [
        {
          title: "Malware in reviewed",
          url: "https://github.com/advisories/GHSA-pr7r-676h-xcf6",
        },
      ],
    });
    const log = vi.fn();

    expect(auditExitCode({ exitCode: 1, output }, log)).toBe(0);
    expect(log).not.toHaveBeenCalled();
  });

  it("keeps unparseable audit failures blocking", () => {
    expect(auditExitCode({ exitCode: 2, output: "error: lockfile unreadable\n" }, vi.fn())).toBe(2);
  });
});
