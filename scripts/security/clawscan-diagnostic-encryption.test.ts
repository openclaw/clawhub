import { execFileSync } from "node:child_process";
/* @vitest-environment node */
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { runWorkerCommand } from "../lib/runWorkerCommand";
import {
  diagnosticEvidenceContainsCredential,
  encryptDiagnosticEvidence,
} from "./clawscan-diagnostic-encryption";

vi.mock("../lib/runWorkerCommand", () => ({ runWorkerCommand: vi.fn() }));
afterEach(() => vi.clearAllMocks());

it("preserves real subprocess evidence, findings and exit status while excluding a fake provider key", () => {
  expect(() =>
    execFileSync(
      "python3",
      ["-B", "scripts/security/diagnostic-capture/test_capture_contract.py"],
      { env: { PATH: process.env.PATH }, timeout: 15_000, stdio: "pipe" },
    ),
  ).not.toThrow();
});

it("rejects an injected key in plaintext reports or metadata, including an unresolved suffix", () => {
  const canary = "CANARY_PROVIDER_CREDENTIAL_FOR_LOCAL_TEST_ONLY";
  expect(diagnosticEvidenceContainsCredential(Buffer.from(`Bearer ${canary}\n`), [canary])).toBe(
    true,
  );
  expect(
    diagnosticEvidenceContainsCredential(Buffer.from(`failure: ${canary.slice(0, 17)}`), [canary]),
  ).toBe(true);
  expect(
    diagnosticEvidenceContainsCredential(
      Buffer.from('{"finding":"preserved","credential":"[REDACTED_INJECTED_CREDENTIAL]"}\n'),
      [canary],
    ),
  ).toBe(false);
});

it("never exposes an artifact destination when encryption fails, and never passes provider credentials", async () => {
  const root = await mkdtemp(join(tmpdir(), "encrypt-diagnostic-failure-"));
  const output = `${root}-output`;
  try {
    await mkdir(join(root, "evidence"));
    await writeFile(join(root, "evidence", "private-report.json"), "PRIVATE_CAPTURE");
    vi.mocked(runWorkerCommand).mockImplementation(async (_command, args, options) => {
      expect(Object.keys(options.env).sort()).toEqual(["LANG", "PATH"]);
      if (args.includes("--encrypt")) {
        await writeFile(args[args.indexOf("--output") + 1]!, "partial ciphertext");
        throw new Error("Encryption failed");
      }
      await writeFile(join(root, "capture.tar.gz"), "private archive");
      return { stdout: "", stderr: "" };
    });
    await expect(
      encryptDiagnosticEvidence({
        privateRoot: root,
        output,
        recipient: "age1xmwwc06ly3ee5rytxm9mflaz2u56jjj36s0mypdrwsvlul66mv4q47ryef",
        ageBinary: "/pinned-age",
        runId: "123",
        source: "b".repeat(40),
        manifestSha256: "c".repeat(64),
      }),
    ).rejects.toThrow("no artifact may be uploaded");
    expect(await readdir(root)).toEqual(["evidence"]);
    await expect(readFile(join(output, "capture.tar.gz.age"))).rejects.toThrow();
    expect(runWorkerCommand).toHaveBeenCalledTimes(2);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(output, { recursive: true, force: true });
  }
});
