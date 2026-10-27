/* @vitest-environment node */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { attestRuntime } from "./run-clawscan-diagnostic";

const fixture = vi.hoisted(() => ({
  pin: "1".repeat(40),
  ubuntu: "22.04",
  go: "go1.27.3",
}));

vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs/promises")>()),
  readFile: vi.fn(async (path: unknown) => {
    const name = String(path);
    if (name.endsWith("clawscan-source-commit.txt")) return fixture.pin;
    if (name === "/etc/os-release") return `VERSION_ID="${fixture.ubuntu}"\n`;
    if (name.endsWith("Dockerfile"))
      return `ARG SKILLSPECTOR_REF=${"2".repeat(40)}\nARG AIG_SKILL_SCAN_REF=${"3".repeat(40)}\n`;
    throw new Error("Unexpected attestation read");
  }),
}));

vi.mock("../lib/runWorkerCommand", () => ({
  runWorkerCommand: vi.fn(async (command: string, args: string[]) => {
    let stdout: string;
    if (command === "git") stdout = args.includes("rev-parse") ? fixture.pin : "";
    else if (command === "go")
      stdout = `${fixture.go}\n build vcs.revision=${fixture.pin}\n build vcs.modified=false\n`;
    else if (command === "codex") stdout = "codex-cli 0.164.0";
    else if (command === "python") stdout = "Python 3.12.16";
    else if (command === "node") stdout = "v24.22.1";
    else throw new Error("Unexpected attestation command");
    return { stdout, stderr: "", exitCode: 0 };
  }),
}));

beforeEach(() => {
  fixture.ubuntu = "22.04";
  fixture.go = "go1.27.3";
  for (const key of ["DEFAULT_MODEL", "SKILLSPECTOR_MODEL"]) vi.stubEnv(key, "gpt-6.1-sol");
  for (const key of ["REASONING_EFFORT", "SKILLSPECTOR_REASONING_EFFORT"])
    vi.stubEnv(key, "medium");
  vi.stubEnv("CLAWSCAN_SOURCE_DIR", "/inert/source");
  vi.stubEnv("RUNNER_TEMP", "/inert/runtime");
  vi.stubEnv("CLAWSCAN_DIAGNOSTIC_RUNNER", "ubuntu-22.04");
});

afterEach(() => vi.unstubAllEnvs());

it("attests Ubuntu22.04 only for explicitly selected hosted tiny controls", async () => {
  await expect(attestRuntime("reviewed", "tiny", "/inert/runtime", {})).rejects.toThrow();
  const result = await attestRuntime("reviewed", "tiny", "/inert/runtime", {}, undefined, true);
  expect(result.metadata.ubuntu).toBe("22.04");
  expect(result.metadata.source).toBe(fixture.pin);
});

it("keeps the default Blacksmith Ubuntu24.04 attestation", async () => {
  fixture.ubuntu = "24.04";
  vi.stubEnv("CLAWSCAN_DIAGNOSTIC_RUNNER", "blacksmith-16vcpu-ubuntu-2404");
  expect((await attestRuntime("reviewed", "tiny", "/inert/runtime", {})).metadata.ubuntu).toBe(
    "24.04",
  );
  fixture.ubuntu = "22.04";
  await expect(attestRuntime("reviewed", "tiny", "/inert/runtime", {})).rejects.toThrow();
});

it("retains the selected image and all other immutable runtime pins", async () => {
  fixture.ubuntu = "24.04";
  await expect(
    attestRuntime("reviewed", "tiny", "/inert/runtime", {}, undefined, true),
  ).rejects.toThrow();
  fixture.ubuntu = "22.04";
  fixture.go = "go1.27.2";
  await expect(
    attestRuntime("reviewed", "tiny", "/inert/runtime", {}, undefined, true),
  ).rejects.toThrow();
});
