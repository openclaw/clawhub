import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
/* @vitest-environment node */
import { afterEach, expect, it, vi } from "vitest";
import { requireDiagnosticRecipient } from "./clawscan-diagnostic-encryption";
import {
  materializeOriginal038,
  original038Manifest,
  validateOriginal038Packages,
} from "./clawscan-diagnostic-fixed038";
import runtime from "./fixtures/judge-original-038-runtime.json";
import { main } from "./run-clawscan-diagnostic";
import { original038DiagnosticPassed } from "./run-clawscan-original038-diagnostic";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it.each([
  { arch: "arm64", runner: "ubuntu-22.04", attempt: "1" },
  { arch: "x64", runner: "blacksmith-16vcpu-ubuntu-2404", attempt: "1" },
  { arch: "x64", runner: "ubuntu-22.04", attempt: "2" },
])("rejects another platform or a rerun before setup: %j", async ({ arch, runner, attempt }) => {
  vi.stubGlobal("process", {
    ...process,
    platform: "linux",
    arch,
    env: {
      GITHUB_ACTIONS: "true",
      RUNNER_OS: "Linux",
      RUNNER_ARCH: "X64",
      CLAWSCAN_DIAGNOSTIC_RUNNER: runner,
      RUNNER_TEMP: "/never-created",
      GITHUB_RUN_ATTEMPT: attempt,
      GITHUB_RUN_ID: "123",
      DIAGNOSTIC_AGE_RECIPIENT: "age1xmwwc06ly3ee5rytxm9mflaz2u56jjj36s0mypdrwsvlul66mv4q47ryef",
    },
  });
  await expect(
    main(["--fixture", "original-038-encrypted", "--source", "reviewed"]),
  ).rejects.toThrow("native Ubuntu22 X64 and a fresh workflow run");
});

it("recognizes only the fixed original038 Ubuntu22 route and refuses absent encryption before setup", async () => {
  vi.stubGlobal("process", {
    ...process,
    platform: "linux",
    arch: "x64",
    env: {
      GITHUB_ACTIONS: "true",
      RUNNER_OS: "Linux",
      RUNNER_ARCH: "X64",
      CLAWSCAN_DIAGNOSTIC_RUNNER: "ubuntu-22.04",
      RUNNER_TEMP: "/never-created",
    },
  });
  await expect(
    main(["--fixture", "original-038-encrypted", "--source", "reviewed"]),
  ).rejects.toThrow("Fixed original diagnostic requires an age X25519 recipient");
});

it("binds every original file and all 77/26 installed packages instead of accepting similar inputs", () => {
  expect(original038Manifest.files).toHaveLength(26);
  expect(createHash("sha256").update(JSON.stringify(original038Manifest.files)).digest("hex")).toBe(
    "ea3f5eb2634dffda246aacd1798f9d4915b0cd223feeb2cd7de35e9d3856c6c8",
  );
  for (const kind of ["skillspector", "aig"] as const) {
    const expected = runtime.expectedPackages[kind];
    expect(Object.keys(expected)).toHaveLength(kind === "skillspector" ? 77 : 26);
    expect(validateOriginal038Packages(kind, expected)).toEqual(expected);
    const changed = { ...expected, openai: "0.0.0" };
    expect(() => validateOriginal038Packages(kind, changed)).toThrow("differ");
    expect(() => validateOriginal038Packages(kind, { ...expected, surprise: "1" })).toThrow(
      "differ",
    );
    const missing = { ...expected } as Record<string, string>;
    delete missing.openai;
    expect(() => validateOriginal038Packages(kind, missing)).toThrow("differ");
  }
});

it("permits one native age recipient and rejects private identities, SSH keys, lists and shell text", () => {
  const publicTestRecipient = "age1xmwwc06ly3ee5rytxm9mflaz2u56jjj36s0mypdrwsvlul66mv4q47ryef";
  expect(requireDiagnosticRecipient(publicTestRecipient)).toBe(publicTestRecipient);
  for (const value of [
    undefined,
    "",
    "ssh-ed25519 AAAA",
    "AGE-SECRET-KEY-TEST",
    `${publicTestRecipient}\n`,
    `${publicTestRecipient},${publicTestRecipient}`,
    "$(touch /tmp/no)",
  ])
    expect(() => requireDiagnosticRecipient(value)).toThrow("age X25519 recipient");
});

it("rejects missing and changed originals before materializing any input", async () => {
  const root = await mkdtemp(join(tmpdir(), "fixed038-reject-"));
  try {
    const missing = Buffer.from(zipSync({ "SKILL.md": Buffer.from("different") }));
    await expect(materializeOriginal038(missing, join(root, "missing"))).rejects.toThrow(
      "inventory",
    );
    const changed = Object.fromEntries(
      original038Manifest.files.map((file) => [file.path, Buffer.from("different")]),
    );
    await expect(
      materializeOriginal038(Buffer.from(zipSync(changed)), join(root, "changed")),
    ).rejects.toThrow("size mismatch");
    expect(await readdir(root)).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const cleanTermination = {
  elapsedMs: 100,
  cleanupMs: 1,
  processGroup: "absent" as const,
  exitCode: 0,
  timedOut: false,
  outputLimitExceeded: null,
};
const acceptedCapture = {
  captureComplete: true,
  termination: cleanTermination,
  nativeExitCode: 0,
  consumerValidation: "validated_ephemerally_not_published",
};

it.each([0, 1])(
  "accepts a captured normal native exit %i without requiring complete scanner coverage or a benign verdict",
  (nativeExitCode) => {
    expect(original038DiagnosticPassed({ ...acceptedCapture, nativeExitCode })).toBe(true);
  },
);

it.each([2, 78, null, undefined, "0"])(
  "fails a fully captured operational native exit %j",
  (nativeExitCode) => {
    expect(original038DiagnosticPassed({ ...acceptedCapture, nativeExitCode })).toBe(false);
    expect(acceptedCapture.captureComplete).toBe(true);
  },
);

it.each([
  { consumerValidation: "rejected" },
  { consumerValidation: "unknown" },
  { captureComplete: false },
  { termination: null },
  { termination: { ...cleanTermination, exitCode: 78 } },
  { termination: { ...cleanTermination, timedOut: true } },
  { termination: { ...cleanTermination, processGroup: "unknown" as const } },
  { termination: { ...cleanTermination, outputLimitExceeded: "stdout" as const } },
])("rejects incomplete, invalid or unclean diagnostics: %j", (change) => {
  expect(original038DiagnosticPassed({ ...acceptedCapture, ...change })).toBe(false);
});
