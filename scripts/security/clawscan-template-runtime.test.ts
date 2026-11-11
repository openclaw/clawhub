/* @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertQualifiedNativeArtifact, qualifiedNativeCommand } from "./clawscan-native-runtime";
import { QUALIFIED_PLUGIN_IMAGE, QUALIFIED_PLUGIN_SOURCE } from "./clawscan-plugin-runtime";
import { resolveTemplateScanForTarget } from "./clawscan-template-runtime";
import { verifyInstalledClawScanSource } from "./prepublicationScannerSource";

vi.mock("./prepublicationScannerSource", () => ({
  verifyInstalledClawScanSource: vi.fn(async () => ({ command: "/reviewed/clawscan" })),
}));
beforeEach(() => {
  vi.mocked(verifyInstalledClawScanSource).mockResolvedValue({
    source: QUALIFIED_PLUGIN_SOURCE,
    command: "/reviewed/clawscan",
  });
});
afterEach(() => vi.resetAllMocks());

// Synthetic bindings exercise shared qualification, not production rollout.
const runtime = {
  source: "e".repeat(40),
  image: "ghcr.io/openclaw/clawscan-runtime@sha256:" + "f".repeat(64),
};

describe("Template runtime rollout qualification", () => {
  it.each(["claw", "template"])(
    "activates %s only through the exact qualified merged host source in both lanes",
    async (family) => {
      for (const lane of ["PREPUBLICATION", "CODEX_SECURITY_SCAN"] as const) {
        const env = {
          [lane + "_CLAWSCAN_SANDBOX"]: "off",
          [lane + "_CLAWSCAN_PLUGIN_SANDBOX"]: "off",
          [lane + "_CLAWSCAN_COMMAND"]: "/reviewed/clawscan",
          CLAWSCAN_SOURCE: "80d11a34a97a9181213c806fc3013123360f9012",
        };
        expect(await resolveTemplateScanForTarget("packageRelease", { family }, lane, env)).toEqual(
          {
            source: QUALIFIED_PLUGIN_SOURCE,
            image: QUALIFIED_PLUGIN_IMAGE,
            command: "/reviewed/clawscan",
          },
        );
        expect(verifyInstalledClawScanSource).toHaveBeenCalledWith(
          env,
          QUALIFIED_PLUGIN_SOURCE,
          "/reviewed/clawscan",
          true,
        );
        expect(env[lane + "_CLAWSCAN_SANDBOX"]).toBe("off");
      }
    },
  );

  it.each(["code-plugin", "bundle-plugin", "unknown"])(
    "never lets artifact text route %s or skill claims into the Template profile",
    async (family) => {
      for (const targetKind of ["packageRelease", "skillVersion"]) {
        expect(
          await resolveTemplateScanForTarget(
            targetKind,
            {
              family,
              openclaw: { template: "nested/CLAW.md" },
              profile: "clawhub-template",
            },
            "PREPUBLICATION",
            {},
          ),
        ).toBeUndefined();
      }
      expect(
        await resolveTemplateScanForTarget(
          "skillVersion",
          { family: "template" },
          "PREPUBLICATION",
          {},
        ),
      ).toBeUndefined();
      expect(verifyInstalledClawScanSource).not.toHaveBeenCalled();
    },
  );

  it("rejects an old, dirty, injected or mismatched source instead of falling back to legacy Template scanning", async () => {
    vi.mocked(verifyInstalledClawScanSource).mockRejectedValue(
      new Error("not the reviewed source/binary"),
    );
    for (const family of ["claw", "template"]) {
      await expect(
        resolveTemplateScanForTarget("packageRelease", { family }, "PREPUBLICATION", {
          CLAWSCAN_SOURCE: QUALIFIED_PLUGIN_SOURCE,
        }),
      ).rejects.toThrow("not the reviewed source/binary");
    }
  });

  it.each(["PREPUBLICATION", "CODEX_SECURITY_SCAN"] as const)(
    "binds %s to exact reviewed source/binary with ignored-file checks",
    async (lane) => {
      vi.mocked(verifyInstalledClawScanSource).mockResolvedValue({
        source: runtime.source,
        command: "/reviewed/clawscan",
      });
      const env = { [lane + "_CLAWSCAN_COMMAND"]: "/reviewed/clawscan" };
      expect(await qualifiedNativeCommand(lane, runtime, env)).toBe("/reviewed/clawscan");
      expect(verifyInstalledClawScanSource).toHaveBeenCalledWith(
        env,
        runtime.source,
        "/reviewed/clawscan",
        true,
      );
      vi.mocked(verifyInstalledClawScanSource).mockRejectedValue(
        new Error("dirty source, wrong binary or unknown revision"),
      );
      await expect(qualifiedNativeCommand(lane, runtime, env)).rejects.toThrow("wrong binary");
    },
  );

  it.each(["off", "auto"])(
    "rejects unqualified %s and does not borrow a plugin-only override",
    async (sandbox) => {
      await expect(
        qualifiedNativeCommand("PREPUBLICATION", runtime, {
          PREPUBLICATION_CLAWSCAN_SANDBOX: sandbox,
          PREPUBLICATION_CLAWSCAN_PLUGIN_SANDBOX: "docker",
        }),
      ).rejects.toThrow("host execution");
      expect(verifyInstalledClawScanSource).not.toHaveBeenCalled();
    },
  );

  it.each(["PREPUBLICATION", "CODEX_SECURITY_SCAN"] as const)(
    "forces the qualified Template Docker lane in %s without changing ordinary host configuration",
    async (lane) => {
      vi.mocked(verifyInstalledClawScanSource).mockResolvedValue({
        source: runtime.source,
        command: "/reviewed/clawscan",
      });
      const env = { [lane + "_CLAWSCAN_SANDBOX"]: "off" };
      expect(await qualifiedNativeCommand(lane, runtime, env, "template")).toBe(
        "/reviewed/clawscan",
      );
      expect(env[lane + "_CLAWSCAN_SANDBOX"]).toBe("off");
      expect(verifyInstalledClawScanSource).toHaveBeenCalledWith(
        env,
        runtime.source,
        undefined,
        true,
      );
    },
  );

  it("rejects mutable, alternate, and malformed runtime bindings", async () => {
    for (const invalid of [
      { ...runtime, source: "main" },
      { ...runtime, image: "ghcr.io/openclaw/clawscan-runtime:latest" },
      { ...runtime, image: "evil.invalid/runtime@sha256:" + "f".repeat(64) },
    ])
      await expect(qualifiedNativeCommand("CODEX_SECURITY_SCAN", invalid, {})).rejects.toThrow();
    await expect(
      qualifiedNativeCommand("CODEX_SECURITY_SCAN", runtime, {
        CODEX_SECURITY_SCAN_CLAWSCAN_SANDBOX_IMAGE: QUALIFIED_PLUGIN_IMAGE,
      }),
    ).rejects.toThrow("immutable Docker");
    expect(verifyInstalledClawScanSource).not.toHaveBeenCalled();
    expect(() =>
      assertQualifiedNativeArtifact({ sandbox: { mode: "docker", image: runtime.image } }, runtime),
    ).not.toThrow();
    for (const sandbox of [
      undefined,
      { mode: "off", image: runtime.image },
      { mode: "docker", image: QUALIFIED_PLUGIN_IMAGE },
    ]) {
      expect(() => assertQualifiedNativeArtifact({ sandbox }, runtime)).toThrow();
    }
  });
});
