import { describe, expect, it } from "vitest";
import {
  detectPinnedPluginInspectorChange,
  readPinnedPluginInspectorVersion,
} from "./plugin-inspector-pin-change.mjs";

const packageJson = (version) =>
  JSON.stringify({
    dependencies: {
      "@openclaw/plugin-inspector": version,
      react: "19.2.7",
    },
  });

describe("plugin inspector pin change detection", () => {
  it("detects merged changes to the pinned plugin inspector dependency", () => {
    expect(
      detectPinnedPluginInspectorChange({
        changedFiles: ["package.json", "bun.lock"],
        basePackageJson: packageJson("0.3.12"),
        headPackageJson: packageJson("0.3.13"),
      }),
    ).toEqual({
      changed: true,
      oldVersion: "0.3.12",
      newVersion: "0.3.13",
      reason: "pinned @openclaw/plugin-inspector changed from 0.3.12 to 0.3.13",
    });
  });

  it("does not dispatch for unrelated merged changes", () => {
    expect(
      detectPinnedPluginInspectorChange({
        changedFiles: ["src/routes/index.tsx"],
        basePackageJson: packageJson("0.3.12"),
        headPackageJson: packageJson("0.3.12"),
      }),
    ).toMatchObject({
      changed: false,
      reason: "no package manager files changed",
    });
  });

  it("does not dispatch when package files changed but the inspector pin did not", () => {
    expect(
      detectPinnedPluginInspectorChange({
        changedFiles: ["package.json", "bun.lock"],
        basePackageJson: packageJson("0.3.12"),
        headPackageJson: packageJson("0.3.12"),
      }),
    ).toMatchObject({
      changed: false,
      reason: "pinned @openclaw/plugin-inspector did not change",
    });
  });

  it("reads the pinned dependency version from package.json", () => {
    expect(readPinnedPluginInspectorVersion(packageJson("0.3.12"))).toBe("0.3.12");
  });
});
