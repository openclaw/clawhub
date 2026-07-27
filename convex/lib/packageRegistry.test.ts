/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import {
  derivePluginManifestSummary,
  ensurePluginNameMatchesPackage,
  extractBundlePluginArtifacts,
  extractCodePluginArtifacts,
  normalizePluginManifestIcon,
  normalizePackageName,
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

  it("reserves unscoped package names that collide with plugin routes", () => {
    expect(() => normalizePackageName("publish")).toThrow("reserved for ClawHub routes");
    expect(normalizePackageName("@demo/publish")).toBe("@demo/publish");
  });

  it("extracts code plugin compatibility and verification metadata", () => {
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
    expect(result).not.toHaveProperty("capabilities");
    expect(result.verification.tier).toBe("source-linked");
    expect(result.verification.scanStatus).toBe("not-run");
  });

  it("derives a safe bundled plugin manifest summary from dummy plugin metadata", () => {
    const summary = derivePluginManifestSummary({
      compatibility: { pluginApiRange: "^1.2.0" },
      pluginManifest: {
        name: "example-ai-plugin",
        description: "Manifest description is diagnostic only",
        version: "9.9.9",
        family: "code-plugin",
        icon: "  https://cdn.example.test/icons/example-ai-plugin.svg  ",
        openclaw: {
          compat: {
            pluginApi: "^2.0.0",
          },
        },
        configSchema: {
          type: "object",
          required: ["EXAMPLE_PLUGIN_API_KEY"],
          properties: {
            EXAMPLE_PLUGIN_API_KEY: {
              type: "string",
              description: "API key used to connect to the example service.",
              sensitive: true,
            },
            EXAMPLE_PLUGIN_MODEL: {
              type: "string",
              description: "Optional model override.",
            },
          },
        },
        mcpServers: {
          exampleMcp: {
            command: "node",
            args: ["dist/mcp.js"],
            env: { EXAMPLE_PLUGIN_API_KEY: "${EXAMPLE_PLUGIN_API_KEY}" },
            transport: "stdio",
          },
        },
        skills: [
          "skills/research",
          { path: "skills/write-report" },
          "../outside",
          "skills/missing",
        ],
        shared_deps: ["ignored"],
        excluded_from_install: ["also-ignored"],
        contracts: [{ ignored: true }],
      },
      files: [
        {
          path: "skills/research/SKILL.md",
          size: 128,
          sha256: "a".repeat(64),
          text: "---\nname: research\n---\n# Research\n\nDeep research assistant.",
        },
        {
          path: "skills/write-report/SKILL.md",
          size: 256,
          sha256: "b".repeat(64),
          text: "---\nname: write-report\ndescription: Drafts a report.\n---\n# Write Report",
        },
        {
          path: "skills/missing/README.md",
          size: 12,
          sha256: "c".repeat(64),
          text: "not a skill",
        },
      ],
    });

    expect(summary).toEqual({
      schemaVersion: 1,
      icon: "https://cdn.example.test/icons/example-ai-plugin.svg",
      compatibility: { pluginApiRange: "^2.0.0" },
      manifestIdentity: {
        name: "example-ai-plugin",
        description: "Manifest description is diagnostic only",
        version: "9.9.9",
        family: "code-plugin",
      },
      configFields: [
        {
          name: "EXAMPLE_PLUGIN_API_KEY",
          description: "API key used to connect to the example service.",
          required: true,
          sensitive: true,
        },
        {
          name: "EXAMPLE_PLUGIN_MODEL",
          description: "Optional model override.",
          required: false,
          sensitive: false,
        },
      ],
      mcpServers: [{ name: "exampleMcp" }],
      bundledSkills: [
        {
          name: "research",
          rootPath: "skills/research",
          skillMdPath: "skills/research/SKILL.md",
          sha256: "a".repeat(64),
          size: 128,
        },
        {
          name: "write-report",
          description: "Drafts a report.",
          rootPath: "skills/write-report",
          skillMdPath: "skills/write-report/SKILL.md",
          sha256: "b".repeat(64),
          size: 256,
        },
      ],
    });
    expect(JSON.stringify(summary)).not.toContain("command");
    expect(JSON.stringify(summary)).not.toContain("transport");
    expect(JSON.stringify(summary)).not.toContain("shared_deps");
    expect(JSON.stringify(summary)).not.toContain("contracts");
  });

  it("omits invalid plugin icons from the stored manifest summary", () => {
    const summary = derivePluginManifestSummary({
      pluginManifest: {
        name: "example-ai-plugin",
        icon: "http://cdn.example.test/icons/example-ai-plugin.svg",
      },
      files: [],
    });

    expect(summary).not.toHaveProperty("icon");
  });

  it("derives bundled skills from the real bundle manifest when present", () => {
    const summary = derivePluginManifestSummary({
      pluginManifest: {
        id: "example-ai-plugin",
        openclaw: { compat: { pluginApi: "^2.0.0" } },
        configSchema: {
          type: "object",
          properties: {
            EXAMPLE_PLUGIN_API_KEY: {
              type: "string",
              sensitive: true,
            },
          },
        },
      },
      skillManifest: {
        name: "Example bundle manifest",
        skills: [{ path: "skills/answer-review" }],
      },
      files: [
        {
          path: "skills/answer-review/SKILL.md",
          size: 192,
          sha256: "d".repeat(64),
          text: "---\nname: answer-review\ndescription: Reviews generated answers.\n---\n# Answer Review",
        },
      ],
    });

    expect(summary.configFields).toEqual([
      {
        name: "EXAMPLE_PLUGIN_API_KEY",
        required: false,
        sensitive: true,
      },
    ]);
    expect(summary.bundledSkills).toEqual([
      {
        name: "answer-review",
        description: "Reviews generated answers.",
        rootPath: "skills/answer-review",
        skillMdPath: "skills/answer-review/SKILL.md",
        sha256: "d".repeat(64),
        size: 192,
      },
    ]);
  });

  it("derives config fields from direct plugin config maps", () => {
    const summary = derivePluginManifestSummary({
      pluginManifest: {
        name: "example-ai-plugin",
        configSchema: {
          EXAMPLE_DATABASE_URL: {
            type: "string",
            required: true,
            description: "Database connection URL.",
            uiHints: { sensitive: true },
          },
          EXAMPLE_MODEL: {
            type: "string",
            required: false,
            description: "Optional model override.",
          },
        },
      },
      files: [],
    });

    expect(summary.configFields).toEqual([
      {
        name: "EXAMPLE_DATABASE_URL",
        description: "Database connection URL.",
        required: true,
        sensitive: true,
      },
      {
        name: "EXAMPLE_MODEL",
        description: "Optional model override.",
        required: false,
        sensitive: false,
      },
    ]);
  });

  it("does not treat JSON Schema metadata as direct config fields", () => {
    const summary = derivePluginManifestSummary({
      pluginManifest: {
        name: "example-ai-plugin",
        configSchema: {
          type: "object",
          $defs: {
            sharedSecret: {
              type: "string",
              description: "Reusable schema, not a top-level config field.",
            },
          },
          patternProperties: {
            "^EXAMPLE_": { type: "string" },
          },
        },
      },
      files: [],
    });

    expect(summary.configFields).toEqual([]);
  });

  it("derives bundled skills from directory-style skill manifest roots", () => {
    const summary = derivePluginManifestSummary({
      pluginManifest: {
        name: "example-ai-plugin",
        openclaw: { compat: { pluginApi: "^2.0.0" } },
        configSchema: {
          type: "object",
          required: ["EXAMPLE_PLUGIN_API_KEY"],
          properties: {
            EXAMPLE_PLUGIN_API_KEY: {
              type: "string",
              description: "API key used to connect to the example service.",
              sensitive: true,
            },
          },
        },
        mcpServers: {
          exampleMcp: {
            command: "node",
            args: ["dist/mcp.js"],
          },
        },
        customMetadata: {
          ignored: true,
        },
      },
      skillManifest: {
        skills: ["./skills/"],
      },
      files: [
        {
          path: "skills/research/SKILL.md",
          size: 128,
          sha256: "a".repeat(64),
          text: "---\nname: research\ndescription: Deep research assistant.\n---\n# Research",
        },
        {
          path: "skills/write-report/SKILL.md",
          size: 256,
          sha256: "b".repeat(64),
          text: "---\nname: write-report\ndescription: Drafts a concise report.\n---\n# Write Report",
        },
        {
          path: "skills/code-audit/SKILL.md",
          size: 384,
          sha256: "c".repeat(64),
          text: "---\nname: code-audit\ndescription: Reviews code changes.\n---\n# Code Audit",
        },
        {
          path: "skills/not-a-skill/README.md",
          size: 12,
          sha256: "d".repeat(64),
          text: "ignored",
        },
      ],
    });

    expect(summary.bundledSkills).toEqual([
      {
        name: "research",
        description: "Deep research assistant.",
        rootPath: "skills/research",
        skillMdPath: "skills/research/SKILL.md",
        sha256: "a".repeat(64),
        size: 128,
      },
      {
        name: "write-report",
        description: "Drafts a concise report.",
        rootPath: "skills/write-report",
        skillMdPath: "skills/write-report/SKILL.md",
        sha256: "b".repeat(64),
        size: 256,
      },
      {
        name: "code-audit",
        description: "Reviews code changes.",
        rootPath: "skills/code-audit",
        skillMdPath: "skills/code-audit/SKILL.md",
        sha256: "c".repeat(64),
        size: 384,
      },
    ]);
    expect(summary.configFields).toHaveLength(1);
    expect(summary.mcpServers).toEqual([{ name: "exampleMcp" }]);
    expect(JSON.stringify(summary)).not.toContain("command");
    expect(JSON.stringify(summary)).not.toContain("customMetadata");
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

    expect(result.runtimeId).toBe("demo.plugin");
    expect(result.compatibility?.pluginApiRange).toBe("^1.0.0");
    expect(result).not.toHaveProperty("capabilities");
  });

  it("accepts only valid HTTPS plugin manifest icon URLs", () => {
    expect(normalizePluginManifestIcon({ icon: "https://cdn.example.test/icons/demo.svg" })).toBe(
      "https://cdn.example.test/icons/demo.svg",
    );
    expect(
      normalizePluginManifestIcon({
        icon: "  https://cdn.example.test/icons/demo.svg?color=111111  ",
      }),
    ).toBe("https://cdn.example.test/icons/demo.svg?color=111111");

    for (const icon of [
      "http://cdn.example.test/icons/demo.svg",
      "/icons/demo.svg",
      "icons/demo.svg",
      "not a url",
      "",
      "   ",
      123,
      null,
      { src: "https://cdn.example.test/icons/demo.svg" },
    ]) {
      expect(normalizePluginManifestIcon({ icon })).toBeUndefined();
    }
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

    expect(result.runtimeId).toBe("demo-bundle");
    expect(result).not.toHaveProperty("capabilities");
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
