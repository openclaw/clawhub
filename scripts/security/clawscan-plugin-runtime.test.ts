/* @vitest-environment node */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertQualifiedPluginArtifact,
  qualifiedPluginCommand,
  QUALIFIED_PLUGIN_IMAGE,
  QUALIFIED_PLUGIN_SOURCE,
  usesWholePluginScanForTarget,
} from "./clawscan-plugin-runtime";
import { verifyInstalledClawScanSource } from "./prepublicationScannerSource";
vi.mock("./prepublicationScannerSource", () => ({
  verifyInstalledClawScanSource: vi.fn(async () => ({ command: "/qualified/clawscan" })),
}));
const dirs: string[] = [];
afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function source(profile: string) {
  const root = await mkdtemp(join(tmpdir(), "plugin-runtime-"));
  dirs.push(root);
  await mkdir(join(root, "internal/profiles/clawhub"), { recursive: true });
  await writeFile(join(root, "internal/profiles/clawhub/clawscan.yml"), profile);
  return { CLAWSCAN_SOURCE_DIR: root };
}
describe("qualified immutable plugin runtime policy", () => {
  it("keeps old source, skills and Templates out of the plugin-only override", async () => {
    const old = await source(
      "profiles:\n  clawhub:\n    scanners: [skillspector, clawscan-static, aig]\n",
    );
    expect(
      await usesWholePluginScanForTarget("packageRelease", { family: "code-plugin" }, old),
    ).toBe(false);
    const current = await source(
      "profiles:\n  clawhub:\n    pluginScanners: [aig-mcp]\n    judge:\n      command: clawscan-decisions-judge\n",
    );
    expect(
      await usesWholePluginScanForTarget("packageRelease", { family: "code-plugin" }, current),
    ).toBe(true);
    expect(
      await usesWholePluginScanForTarget("packageRelease", { family: "bundle-plugin" }, current),
    ).toBe(true);
    expect(
      await usesWholePluginScanForTarget("packageRelease", { family: "template" }, current),
    ).toBe(false);
    expect(await usesWholePluginScanForTarget("skillVersion", undefined, current)).toBe(false);
  });
  it.each(["PREPUBLICATION", "CODEX_SECURITY_SCAN"] as const)(
    "binds %s to the exact source/binary and ignores no dirty/ignored files",
    async (lane) => {
      const env = {
        CLAWSCAN_SOURCE_DIR: "/source",
        RUNNER_TEMP: "/runner",
        [lane + "_CLAWSCAN_COMMAND"]: "/qualified/clawscan",
      };
      expect(await qualifiedPluginCommand(lane, env)).toBe("/qualified/clawscan");
      expect(verifyInstalledClawScanSource).toHaveBeenCalledWith(
        env,
        QUALIFIED_PLUGIN_SOURCE,
        "/qualified/clawscan",
        true,
      );
    },
  );
  it.each(["off", "auto"])("rejects unqualified sandbox %s", async (sandbox) => {
    await expect(
      qualifiedPluginCommand("PREPUBLICATION", { PREPUBLICATION_CLAWSCAN_SANDBOX: sandbox }),
    ).rejects.toThrow("host execution");
    expect(verifyInstalledClawScanSource).not.toHaveBeenCalled();
  });
  it("rejects mutable or alternate image references before command execution", async () => {
    await expect(
      qualifiedPluginCommand("PREPUBLICATION", {
        PREPUBLICATION_CLAWSCAN_SANDBOX_IMAGE: "ghcr.io/openclaw/clawscan-runtime:latest",
      }),
    ).rejects.toThrow("immutable Docker");
    expect(() =>
      assertQualifiedPluginArtifact({ sandbox: { mode: "off", image: QUALIFIED_PLUGIN_IMAGE } }),
    ).toThrow();
    expect(() =>
      assertQualifiedPluginArtifact({ sandbox: { mode: "docker", image: QUALIFIED_PLUGIN_IMAGE } }),
    ).not.toThrow();
  });
  it("keeps shell installer qualification constants identical to the worker policy", async () => {
    const shell = await readFile("scripts/security/clawscan-install-source.sh", "utf8");
    expect(shell).toContain("qualified_source_commit=" + QUALIFIED_PLUGIN_SOURCE);
    expect(shell).toContain("qualified_runtime_image=" + QUALIFIED_PLUGIN_IMAGE);
  });
});
