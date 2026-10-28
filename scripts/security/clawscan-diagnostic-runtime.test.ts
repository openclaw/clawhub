/* @vitest-environment node */
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import {
  validateOriginalProfile,
  validateOriginalScannerBounds,
} from "./clawscan-diagnostic-runtime";

const state = "DEFAULT_MAX_WORKFLOW_SECONDS = 600.0\n";
const mcp = "TP4_MAX_FILES = 128\n";
const lock = "86da392895db777270d9f1e2390c6956df2beaae31578235389d584fafe10adc";
const baseline = "9662307780b2834791e2b0be8b166b44f4144ef4";
const profile = `profiles:
  clawhub:
    scanners: [skillspector, clawscan-static, aig]
    scannerEnvDefaults:
      SKILLSPECTOR_PROVIDER: openai
      SKILLSPECTOR_MODEL: gpt-6.1-sol
      SKILLSPECTOR_REASONING_EFFORT: medium
      DEFAULT_MODEL: gpt-6.1-sol
      REASONING_EFFORT: medium
    judge:
      command: >-
        codex exec --model gpt-6.1-sol --sandbox {{ judge_sandbox }}
        --ignore-user-config -c model_reasoning_effort=high
        -c 'service_tier="default"' --ephemeral --json
`;

it("fails closed on changed production budgets, count caps, locks, models, reasoning and tier", () => {
  expect(() => validateOriginalScannerBounds(state, mcp, lock, baseline)).not.toThrow();
  for (const [nextState, nextMcp, nextLock] of [
    [state.replace("600", "900"), mcp, lock],
    [state, mcp.replace("128", "512"), lock],
    [state, mcp, "0".repeat(64)],
  ])
    expect(() =>
      validateOriginalScannerBounds(nextState!, nextMcp!, nextLock!, baseline),
    ).toThrow();
  expect(() => validateOriginalProfile(profile)).not.toThrow();
  for (const change of [
    profile.replaceAll("gpt-6.1-sol", "PRIVATE"),
    profile.replace("effort=high", "effort=low"),
    profile.replace('tier="default"', 'tier="priority"'),
    profile.replace("[skillspector, clawscan-static, aig]", "[skillspector]"),
    profile.replace("--ignore-user-config", ""),
    "{}",
  ])
    expect(() => validateOriginalProfile(change)).toThrow();
});

it("binds dependency locks to exact sources while retaining both incident diagnostic runtimes", () => {
  const modernSource = "ff67692a1b58882a398449a1a5cdba620c88ad57";
  const modernLock = "b8d19c16020091af248ec1566d6666de4cf408e4dca193f0c9ead67072da785e";
  const originalCandidate = "fd5f18ad3365f623d4165740b124cd7f142d0556";
  for (const [source, expectedLock] of [
    [baseline, lock],
    [originalCandidate, lock],
    [modernSource, modernLock],
  ]) {
    expect(() => validateOriginalScannerBounds(state, mcp, expectedLock!, source!)).not.toThrow();
    const otherLock = expectedLock === lock ? modernLock : lock;
    expect(() => validateOriginalScannerBounds(state, mcp, otherLock, source!)).toThrow();
  }
  for (const unknownSource of ["0".repeat(40), "main", "", "toString"])
    expect(() => validateOriginalScannerBounds(state, mcp, lock, unknownSource)).toThrow();
});

it("retains reviewed host installers, exact pinned sources and locked production dependency resolution", async () => {
  const original = await readFile("scripts/security/clawscan-diagnostic-runtime.ts", "utf8");
  const installer = await readFile("scripts/security/install-clawscan-scanners.sh", "utf8");
  expect(installer).toContain("uv sync --locked --no-dev");
  expect(original).toContain('const SKILLSPECTOR_REF = "95a52d89fa16f608f0b18ccee76b0918ea4b7eef"');
  expect(original).toContain('const AIG_REF = "a5c5a72c2e5b88fc6e5b27e0c86110943c4d350b"');
  expect(original).toContain('runtimeImage: "N/A"');
  expect(original).not.toMatch(/docker run|@latest|uv sync --upgrade/);
});
