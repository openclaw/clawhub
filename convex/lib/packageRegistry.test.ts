/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import {
  ensurePluginNameMatchesPackage,
  extractBundlePluginArtifacts,
  extractCodePluginArtifacts,
  summarizePackageForSearch,
  toConvexSafeJsonValue,
  tryNormalizePackageName,
} from "./packageRegistry";

describe("packageRegistry", () => {
  it("can validate package names without throwing", () => {
    expect(tryNormalizePackageName("@OpenClaw/Discord")).toBe("@openclaw/discord");
    expect(tryNormalizePackageName("openclaw/discord")).toBeNull();
    expect(tryNormalizePackageName("   ")).toBeNull();
  });

  it("extracts code plugin compatibility and capabilities", () => {
    const result = extractCodePluginArtifacts({
      packageName: "@scope/demo-plugin",
      packageJson: {
        name: "@scope/demo-plugin",
        openclaw: {
          extensions: ["./dist/index.js"],
          hostTargets: ["darwin-arm64", "linux-x64"],
          environment: {
            browser: true,
            desktop: { required: true },
            nativeDependencies: ["sharp"],
            externalServices: [{ name: "GitHub" }],
            osPermissions: ["screen-recording"],
            binaries: ["ffmpeg"],
          },
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
    expect(result.compatibility?.minGatewayVersion).toBe("2026.3.0");
    expect(result.capabilities.executesCode).toBe(true);
    expect(result.capabilities.hostTargets).toEqual(["darwin-arm64", "linux-x64"]);
    expect(result.capabilities.toolNames).toContain("demoTool");
    expect(result.capabilities.capabilityTags).toContain("host:darwin-arm64");
    expect(result.capabilities.capabilityTags).toContain("host-os:darwin");
    expect(result.capabilities.capabilityTags).toContain("host-arch:arm64");
    expect(result.capabilities.capabilityTags).toContain("host-os:linux");
    expect(result.capabilities.capabilityTags).toContain("host-arch:x64");
    expect(result.capabilities.capabilityTags).toContain("environment:declared");
    expect(result.capabilities.capabilityTags).toContain("requires:browser");
    expect(result.capabilities.capabilityTags).toContain("requires:desktop");
    expect(result.capabilities.capabilityTags).toContain("requires:native-deps");
    expect(result.capabilities.capabilityTags).toContain("native-dep:sharp");
    expect(result.capabilities.capabilityTags).toContain("requires:external-service");
    expect(result.capabilities.capabilityTags).toContain("external-service:github");
    expect(result.capabilities.capabilityTags).toContain("os-permission:screen-recording");
    expect(result.capabilities.capabilityTags).toContain("binary:ffmpeg");
    expect(result.verification.tier).toBe("source-linked");
    expect(result.verification.scanStatus).toBe("not-run");
  });

  it("allows missing host and environment metadata for code plugins", () => {
    const result = extractCodePluginArtifacts({
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

    expect(result.capabilities.hostTargets).toEqual([]);
    expect(result.capabilities.capabilityTags).not.toContain("environment:declared");
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

  it("maps legacy minHostVersion to minGatewayVersion instead of pluginApiRange", () => {
    expect(() =>
      extractCodePluginArtifacts({
        packageName: "@openclaw/matrix",
        packageJson: {
          name: "@openclaw/matrix",
          version: "2026.3.13",
          openclaw: {
            extensions: ["./index.ts"],
            install: {
              npmSpec: "@openclaw/matrix",
              localPath: "extensions/matrix",
              defaultChoice: "npm",
              minHostVersion: "2026.3.13",
            },
          },
        },
        pluginManifest: {
          id: "matrix",
          channels: ["matrix"],
          configSchema: { type: "object" },
        },
        source: {
          kind: "github",
          url: "https://github.com/openclaw/openclaw",
          repo: "openclaw/openclaw",
          ref: "refs/tags/v2026.3.13",
          commit: "abc123",
          path: "extensions/matrix",
          importedAt: Date.now(),
        },
      }),
    ).toThrow("package.json openclaw.compat.pluginApi is required");
  });

  it("extracts legacy minHostVersion as minGatewayVersion while preserving build metadata", () => {
    const result = extractBundlePluginArtifacts({
      packageName: "@openclaw/matrix-bundle",
      packageJson: {
        name: "@openclaw/matrix-bundle",
        version: "2026.3.13",
        openclaw: {
          install: {
            minHostVersion: "2026.3.13",
          },
        },
      },
      pluginManifest: { id: "matrix-bundle" },
      bundleManifest: {
        hostTargets: ["openclaw"],
      },
    });

    expect(result.compatibility?.pluginApiRange).toBeUndefined();
    expect(result.compatibility?.minGatewayVersion).toBe("2026.3.13");
    expect(result.compatibility?.builtWithOpenClawVersion).toBe("2026.3.13");
  });

  it("allows bundle plugins without host targets", () => {
    const result = extractBundlePluginArtifacts({
      packageName: "demo-bundle",
      packageJson: { name: "demo-bundle" },
      pluginManifest: { id: "demo-bundle" },
    });

    expect(result.capabilities.hostTargets).toEqual([]);
    expect(result.capabilities.capabilityTags).toContain("bundle-only");
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

  it("normalizes JSON Schema keys for Convex metadata storage", () => {
    expect(
      toConvexSafeJsonValue({
        configSchema: {
          $defs: {
            secret: {
              anyOf: [{ $ref: "#/$defs/secretRef" }],
            },
          },
        },
      }),
    ).toEqual({
      configSchema: {
        dollar_defs: {
          secret: {
            anyOf: [{ dollar_ref: "#/$defs/secretRef" }],
          },
        },
      },
    });
  });

  it("truncates deeply nested metadata before Convex storage", () => {
    expect(
      toConvexSafeJsonValue(
        {
          channelConfigs: {
            discord: {
              schema: {
                properties: {
                  auth: {
                    anyOf: [{ properties: { token: { type: "string" } } }],
                  },
                },
              },
            },
          },
        },
        { maxDepth: 5 },
      ),
    ).toEqual({
      channelConfigs: {
        discord: {
          schema: {
            properties: {
              auth: "[truncated]",
            },
          },
        },
      },
    });
  });
});
