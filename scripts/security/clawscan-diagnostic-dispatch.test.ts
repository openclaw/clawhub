/* @vitest-environment node */
import { afterEach, expect, it, vi } from "vitest";
import { main } from "./run-clawscan-diagnostic";
import { mainOriginalDiagnostic } from "./run-clawscan-original-diagnostic";

vi.mock("./run-clawscan-original-diagnostic", () => ({ mainOriginalDiagnostic: vi.fn() }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function inertDispatchEnvironment() {
  vi.stubGlobal("process", {
    ...process,
    platform: "linux",
    env: {
      GITHUB_ACTIONS: "true",
      RUNNER_OS: "Linux",
      RUNNER_ARCH: "X64",
      CLAWSCAN_DIAGNOSTIC_RUNNER: "blacksmith-16vcpu-ubuntu-2404",
      RUNNER_TEMP: "/inert-never-created",
    },
  });
}

it.each(["original-scanner-only", "original-candidate-full", "original-candidate-290-full"])(
  "dispatches %s only to the original controller before any general runtime setup",
  async (mode) => {
    inertDispatchEnvironment();
    await main(["--fixture", mode, "--source", "reviewed"]);
    expect(mainOriginalDiagnostic).toHaveBeenCalledExactlyOnceWith(mode);
  },
);

it.each([
  ["--fixture", "original-candidate-290-full", "--source", "incident"],
  ["--fixture", "original-candidate-full", "--source", "incident"],
  ["--fixture", "original-scanner-only", "--source", "incident"],
  ["--fixture", "original-candidate-290-full", "--source", "PRIVATE"],
  ["--fixture", "original-candidate-290-full", "--source", "reviewed", "--retry"],
  [
    "--fixture",
    "original-candidate-290-full",
    "--source",
    "reviewed",
    "--url",
    "https://invalid.example",
  ],
  ["--fixture", "original-candidate-290-full", "--source", "reviewed", "--case", "candidate175"],
  [
    "--fixture",
    "original-candidate-290-full",
    "--source",
    "reviewed",
    "--fixture",
    "original-candidate-full",
  ],
  ["--source", "reviewed", "--fixture", "original-candidate-290-full"],
  ["--fixture", "original-candidate-290-full"],
  ["--fixture", "original-candidate-290-full-typo", "--source", "reviewed"],
  ["--fixture", "candidate290", "--source", "reviewed"],
  ["--fixture", "PRIVATE", "--source", "reviewed"],
])("rejects invalid original dispatch %j without fallback", async (...args) => {
  inertDispatchEnvironment();
  await expect(main(args)).rejects.toThrow("Only bounded fixture/source choices are supported");
  expect(mainOriginalDiagnostic).not.toHaveBeenCalled();
});
