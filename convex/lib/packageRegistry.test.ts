/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import {
  ensurePluginNameMatchesPackage,
  extractBundlePluginArtifacts,
  extractCodePluginArtifacts,
  summarizePackageForSearch,
} from "./packageRegistry";

describe("packageRegistry", () => {
  it("extracts code plugin compatibility and capabilities", () => {
    const result = extractCodePluginArtifacts({
      packageName: "@scope/demo-plugin",
      packageJson: {
        name: "@scope/demo-plugin",
        openclaw: {
          extensions: ["./dist/index.js"],
          compat: {
            pluginApi: "^1.2.0",
            minGatewayVersion: "2026.3.0",
          },
          build: {
            openclawVersion: "2026.3.14",
            pluginSdkVersion: "2026.3.14",
          },
          configSchema: { type: "object" },
        },
      },
      pluginManifest: {
        id: "demo.plugin",
        kind: "context-engine",
        channels: ["chat"],
        tools: [{ name: "demoTool" }],
      },
      source: {
        kind: "github",
        url: "https://github.com/openclaw/demo-plugin",
        repo: "openclaw/demo-plugin",
        ref: "refs/tags/v1.0.0",
        commit: "abc123",
        path: ".",
        importedAt: Date.now(),
      },
    });

    expect(result.runtimeId).toBe("demo.plugin");
    expect(result.compatibility?.pluginApiRange).toBe("^1.2.0");
    expect(result.capabilities.executesCode).toBe(true);
    expect(result.capabilities.toolNames).toContain("demoTool");
    expect(result.verification.tier).toBe("source-linked");
  });

  it("requires source metadata for code plugins", () => {
    expect(() =>
      extractCodePluginArtifacts({
        packageName: "demo-plugin",
        packageJson: {
          name: "demo-plugin",
          openclaw: {
            extensions: ["./dist/index.js"],
            compat: { pluginApi: "^1.0.0" },
            build: { openclawVersion: "2026.3.14" },
            configSchema: { type: "object" },
          },
        },
        pluginManifest: { id: "demo.plugin" },
      }),
    ).toThrow("source repo and commit");
  });

  it("requires host targets for bundle plugins", () => {
    expect(() =>
      extractBundlePluginArtifacts({
        packageName: "demo-bundle",
        packageJson: { name: "demo-bundle" },
      }),
    ).toThrow("host target");
  });

  it("validates package name consistency and summary extraction", () => {
    ensurePluginNameMatchesPackage("demo-plugin", { name: "demo-plugin" });
    expect(() => ensurePluginNameMatchesPackage("demo-plugin", { name: "other-plugin" })).toThrow(
      "must match published package name",
    );

    expect(
      summarizePackageForSearch({
        packageName: "demo-plugin",
        packageJson: { description: "Short summary" },
      }),
    ).toBe("Short summary");

    expect(
      summarizePackageForSearch({
        packageName: "demo-plugin",
        readmeText: "# Demo Plugin\n\nA longer package summary for search.\n",
      }),
    ).toBe("A longer package summary for search.");
  });
});
