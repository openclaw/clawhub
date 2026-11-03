import { describe, expect, it } from "vitest";
import {
  bundlePluginRuntimeId as cliRuntimeId,
  selectPluginManifest as cliSelect,
} from "../../clawhub/src/schema/pluginInput";
import {
  bundlePluginRuntimeId,
  PLUGIN_BUNDLE_MANIFESTS,
  selectPluginManifest,
} from "./pluginInput";

describe.each([
  { name: "backend/worker", select: selectPluginManifest, identity: bundlePluginRuntimeId },
  { name: "CLI", select: cliSelect, identity: cliRuntimeId },
])("$name plugin input contract", ({ select, identity }) => {
  it.each(PLUGIN_BUNDLE_MANIFESTS)("selects $format without a native envelope", (marker) => {
    expect(select({ family: "bundle-plugin", paths: [marker.path, "SKILL.md"] })).toEqual(marker);
    expect(() =>
      select({ family: "bundle-plugin", paths: [marker.path], bundleFormat: "unknown" }),
    ).toThrow("does not match");
  });

  it("requires one supported bundle marker and an explicit known family", () => {
    for (const paths of [
      [],
      ["openclaw.plugin.json"],
      ["plugin.json"],
      PLUGIN_BUNDLE_MANIFESTS.map((marker) => marker.path),
    ]) {
      expect(() => select({ family: "bundle-plugin", paths })).toThrow("exactly one supported");
    }
    expect(() => select({ family: "unknown", paths: ["openclaw.plugin.json"] })).toThrow(
      "Unsupported",
    );
    expect(() =>
      select({ family: "code-plugin", paths: ["openclaw.plugin.json"], bundleFormat: "claude" }),
    ).toThrow("requires the bundle-plugin family");
    expect(() => select({ family: "code-plugin", paths: [".claude-plugin/plugin.json"] })).toThrow(
      "required",
    );
    expect(
      select({
        family: "code-plugin",
        paths: ["openclaw.plugin.json", ...PLUGIN_BUNDLE_MANIFESTS.map((marker) => marker.path)],
      }),
    ).toEqual({ path: "openclaw.plugin.json", format: undefined });
    expect(() =>
      select({
        family: "code-plugin",
        paths: PLUGIN_BUNDLE_MANIFESTS.map((marker) => marker.path),
      }),
    ).toThrow("openclaw.plugin.json is required");
    expect(
      select({
        family: "code-plugin",
        paths: ["openclaw.plugin.json", ".claude-plugin/plugin.json", "SKILL.md"],
      }).path,
    ).toBe("openclaw.plugin.json");
  });

  it("uses canonical name normalization without an artifact-directory fallback", () => {
    expect(identity({ name: " Canonical Bundle_2 ", id: "ignored" })).toBe("canonical-bundle-2");
    expect(identity({ name: "İD" })).toBe("i-d");
    expect(identity({ name: "Kelvin" })).toBe("kelvin");
    for (const name of [
      "",
      "☃",
      "../escape",
      "bad\\path",
      "a/b",
      "bad\u0001id",
      "\nbad",
      ".",
      "..",
      3,
    ]) {
      expect(() => identity({ name })).toThrow();
    }
    expect(() => identity({ id: "not-a-bundle-name" })).toThrow("declare a name");
  });
});
