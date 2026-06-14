/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import {
  deriveOpenClawOnboardingCapabilityTags,
  ensurePluginNameMatchesPackage,
  extractBundlePluginArtifacts,
  extractCodePluginArtifacts,
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

  it("derives model-provider and default text-inference setup tags", () => {
    const result = extractCodePluginArtifacts({
      packageName: "bitrouter",
      packageJson: {
        name: "bitrouter",
        openclaw: {
          extensions: ["./dist/index.js"],
          compat: { pluginApi: "^1.0.0" },
          build: { openclawVersion: "2026.6.14" },
          configSchema: { type: "object" },
        },
      },
      pluginManifest: {
        id: "bitrouter",
        providers: ["bitrouter", "bitrouter"],
        providerAuthChoices: [
          { provider: "bitrouter", method: "api-key", choiceId: "bitrouter-api-key" },
        ],
      },
      source: {
        kind: "github",
        url: "https://github.com/example/bitrouter",
        repo: "example/bitrouter",
        ref: "refs/tags/v1.0.0",
        commit: "abc123",
        path: ".",
        importedAt: Date.now(),
      },
    });

    expect(result.capabilities.capabilityTags).toEqual([
      "executes-code",
      "provider:bitrouter",
      "capability:model-provider",
      "setup:text-inference",
    ]);
  });

  it("derives image-only capability and setup tags without text inference", () => {
    const result = extractCodePluginArtifacts({
      packageName: "image-only",
      packageJson: {
        name: "image-only",
        openclaw: {
          extensions: ["./dist/index.js"],
          compat: { pluginApi: "^1.0.0" },
          build: { openclawVersion: "2026.6.14" },
          configSchema: { type: "object" },
        },
      },
      pluginManifest: {
        id: "image-only",
        contracts: { imageGenerationProviders: ["image-only"] },
        setup: {
          providers: [{ id: "image-only", authMethods: ["api-key"] }],
        },
        providerAuthChoices: [
          {
            provider: "image-only",
            method: "api-key",
            choiceId: "image-only-api-key",
            onboardingScopes: ["image-generation"],
          },
        ],
      },
      source: {
        kind: "github",
        url: "https://github.com/example/image-only",
        repo: "example/image-only",
        ref: "refs/tags/v1.0.0",
        commit: "abc123",
        path: ".",
        importedAt: Date.now(),
      },
    });

    expect(result.capabilities.capabilityTags).toContain("capability:image-generation-provider");
    expect(result.capabilities.capabilityTags).toContain("setup:image-generation");
    expect(result.capabilities.capabilityTags).not.toContain("capability:model-provider");
    expect(result.capabilities.capabilityTags).not.toContain("setup:text-inference");
  });

  it("derives text-inference setup from declarative setup provider auth methods", () => {
    const result = extractCodePluginArtifacts({
      packageName: "declarative-provider",
      packageJson: {
        name: "declarative-provider",
        openclaw: {
          extensions: ["./dist/index.js"],
          compat: { pluginApi: "^1.0.0" },
          build: { openclawVersion: "2026.6.14" },
          configSchema: { type: "object" },
        },
      },
      pluginManifest: {
        id: "declarative-provider",
        providers: ["declarative-provider"],
        setup: {
          providers: [
            {
              id: "declarative-provider",
              authMethods: ["api-key"],
            },
          ],
        },
      },
      source: {
        kind: "github",
        url: "https://github.com/example/declarative-provider",
        repo: "example/declarative-provider",
        ref: "refs/tags/v1.0.0",
        commit: "abc123",
        path: ".",
        importedAt: Date.now(),
      },
    });

    expect(result.capabilities.capabilityTags).toContain("capability:model-provider");
    expect(result.capabilities.capabilityTags).toContain("setup:text-inference");
  });

  it("does not derive setup-provider fallback choices from runtime-required setup entries", () => {
    const result = extractCodePluginArtifacts({
      packageName: "runtime-setup-provider",
      packageJson: {
        name: "runtime-setup-provider",
        openclaw: {
          extensions: ["./dist/index.js"],
          setupEntry: "./dist/setup.js",
          compat: { pluginApi: "^1.0.0" },
          build: { openclawVersion: "2026.6.14" },
          configSchema: { type: "object" },
        },
      },
      pluginManifest: {
        id: "runtime-setup-provider",
        providers: ["runtime-setup-provider"],
        setup: {
          providers: [
            {
              id: "runtime-setup-provider",
              authMethods: ["api-key"],
            },
          ],
        },
      },
      source: {
        kind: "github",
        url: "https://github.com/example/runtime-setup-provider",
        repo: "example/runtime-setup-provider",
        ref: "refs/tags/v1.0.0",
        commit: "abc123",
        path: ".",
        importedAt: Date.now(),
      },
    });

    expect(result.capabilities.capabilityTags).toContain("capability:model-provider");
    expect(result.capabilities.capabilityTags).not.toContain("setup:text-inference");
  });

  it("does not treat runtimeSetupEntry as a canonical setup source", () => {
    const result = extractCodePluginArtifacts({
      packageName: "runtime-setup-entry-provider",
      packageJson: {
        name: "runtime-setup-entry-provider",
        openclaw: {
          extensions: ["./dist/index.js"],
          runtimeSetupEntry: "./dist/runtime-setup.js",
          compat: { pluginApi: "^1.0.0" },
          build: { openclawVersion: "2026.6.14" },
          configSchema: { type: "object" },
        },
      },
      pluginManifest: {
        id: "runtime-setup-entry-provider",
        providers: ["runtime-setup-entry-provider"],
        setup: {
          providers: [
            {
              id: "runtime-setup-entry-provider",
              authMethods: ["api-key"],
            },
          ],
        },
      },
      source: {
        kind: "github",
        url: "https://github.com/example/runtime-setup-entry-provider",
        repo: "example/runtime-setup-entry-provider",
        ref: "refs/tags/v1.0.0",
        commit: "abc123",
        path: ".",
        importedAt: Date.now(),
      },
    });

    expect(result.capabilities.setupEntry).toBe(false);
    expect(result.capabilities.capabilityTags).toContain("setup:text-inference");
  });

  it("does not treat plugin-manifest setupEntry as a canonical setup source", () => {
    const result = extractCodePluginArtifacts({
      packageName: "manifest-setup-entry-provider",
      packageJson: {
        name: "manifest-setup-entry-provider",
        openclaw: {
          extensions: ["./dist/index.js"],
          compat: { pluginApi: "^1.0.0" },
          build: { openclawVersion: "2026.6.14" },
          configSchema: { type: "object" },
        },
      },
      pluginManifest: {
        id: "manifest-setup-entry-provider",
        setupEntry: "./dist/setup.js",
        providers: ["manifest-setup-entry-provider"],
        setup: {
          providers: [
            {
              id: "manifest-setup-entry-provider",
              authMethods: ["api-key"],
            },
          ],
        },
      },
      source: {
        kind: "github",
        url: "https://github.com/example/manifest-setup-entry-provider",
        repo: "example/manifest-setup-entry-provider",
        ref: "refs/tags/v1.0.0",
        commit: "abc123",
        path: ".",
        importedAt: Date.now(),
      },
    });

    expect(result.capabilities.setupEntry).toBe(true);
    expect(result.capabilities.capabilityTags).toContain("setup");
    expect(result.capabilities.capabilityTags).toContain("setup:text-inference");
  });

  it("allows declarative setup choices when setup does not require runtime", () => {
    expect(
      deriveOpenClawOnboardingCapabilityTags(
        {
          setup: {
            requiresRuntime: false,
            providers: [{ id: "static-setup", authMethods: ["api-key"] }],
          },
        },
        { hasSetupSource: true },
      ),
    ).toEqual(["setup:text-inference"]);
  });

  it("derives speech-only capability tags without setup tags", () => {
    const result = extractCodePluginArtifacts({
      packageName: "speech-only",
      packageJson: {
        name: "speech-only",
        openclaw: {
          extensions: ["./dist/index.js"],
          compat: { pluginApi: "^1.0.0" },
          build: { openclawVersion: "2026.6.14" },
          configSchema: { type: "object" },
        },
      },
      pluginManifest: {
        id: "speech-only",
        contracts: { speechProviders: ["speech-only"] },
      },
      source: {
        kind: "github",
        url: "https://github.com/example/speech-only",
        repo: "example/speech-only",
        ref: "refs/tags/v1.0.0",
        commit: "abc123",
        path: ".",
        importedAt: Date.now(),
      },
    });

    expect(result.capabilities.capabilityTags).toContain("capability:speech-provider");
    expect(result.capabilities.capabilityTags).not.toContain("capability:model-provider");
    expect(result.capabilities.capabilityTags?.filter((tag) => tag.startsWith("setup:"))).toEqual(
      [],
    );
  });

  it("deduplicates and deterministically orders multi-capability bundle plugin tags", () => {
    const result = extractBundlePluginArtifacts({
      packageName: "multi-provider",
      packageJson: { name: "multi-provider" },
      pluginManifest: {
        id: "multi-provider",
        providers: ["multi-provider"],
        contracts: {
          speechProviders: ["multi-provider"],
          webSearchProviders: ["multi-provider"],
          imageGenerationProviders: ["multi-provider"],
          musicGenerationProviders: ["multi-provider"],
        },
        providerAuthChoices: [
          {
            provider: "multi-provider",
            method: "api-key",
            choiceId: "multi-provider-api-key",
            onboardingScopes: ["music-generation", "image-generation", "music-generation"],
          },
          {
            provider: "multi-provider",
            method: "oauth",
            choiceId: "multi-provider-oauth",
          },
        ],
      },
    });

    expect(result.capabilities.capabilityTags).toEqual([
      "bundle-only",
      "format:generic",
      "capability:model-provider",
      "capability:speech-provider",
      "capability:web-search-provider",
      "capability:image-generation-provider",
      "capability:music-generation-provider",
      "setup:text-inference",
      "setup:image-generation",
      "setup:music-generation",
    ]);
  });

  it("matches OpenClaw normalization for provider capabilities and auth choices", () => {
    expect(
      deriveOpenClawOnboardingCapabilityTags({
        providers: [{ id: "invalid" }],
        contracts: {
          speechProviders: [null],
          webSearchProviders: "search",
          imageGenerationProviders: [{}],
          musicGenerationProviders: [42],
        },
        providerAuthChoices: [{}, { provider: "demo", method: "", choiceId: "demo-key" }],
      }),
    ).toEqual([]);

    expect(
      deriveOpenClawOnboardingCapabilityTags({
        providerAuthChoices: [
          {
            provider: "demo",
            method: "api-key",
            choiceId: "demo-key",
            onboardingScopes: [],
          },
          {
            provider: "demo",
            method: "oauth",
            choiceId: "demo-oauth",
            onboardingScopes: ["unsupported"],
          },
        ],
      }),
    ).toEqual(["setup:text-inference"]);
  });

  it("ignores non-string manifest providers during full capability extraction", () => {
    const result = extractCodePluginArtifacts({
      packageName: "valid-provider",
      packageJson: {
        name: "valid-provider",
        openclaw: {
          extensions: ["./dist/index.js"],
          compat: { pluginApi: "^1.0.0" },
          build: { openclawVersion: "2026.6.14" },
          configSchema: { type: "object" },
          providers: [{ id: "invalid-package-provider" }, 42, "package-provider"],
        },
      },
      pluginManifest: {
        id: "valid-provider",
        providers: [{ id: "invalid" }, 42, "valid-provider"],
      },
      source: {
        kind: "github",
        url: "https://github.com/example/valid-provider",
        repo: "example/valid-provider",
        ref: "refs/tags/v1.0.0",
        commit: "abc123",
        path: ".",
        importedAt: Date.now(),
      },
    });

    expect(result.capabilities.providers).toEqual(["valid-provider", "package-provider"]);
    expect(result.capabilities.capabilityTags).toEqual([
      "executes-code",
      "provider:valid-provider",
      "provider:package-provider",
      "capability:model-provider",
    ]);
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
