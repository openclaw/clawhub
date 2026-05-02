import type { ClawPackFile, ClawPackInput } from "../clawpack";
import { sha256Hex } from "../clawpack";

const encoder = new TextEncoder();

async function fixtureFile(
  path: string,
  source: string,
  contentType?: string,
): Promise<ClawPackFile> {
  const bytes = encoder.encode(source);
  return {
    path,
    size: bytes.byteLength,
    sha256: await sha256Hex(bytes),
    bytes,
    ...(contentType ? { contentType } : {}),
  };
}

export async function makeKitchenSinkClawPackInput(): Promise<ClawPackInput> {
  return {
    packageId: "pkg_kitchen_sink",
    releaseId: "rel_kitchen_sink",
    name: "@openclaw/kitchen-sink-plugin",
    owner: "openclaw",
    slug: "openclaw-kitchen-sink-plugin",
    version: "9.9.9",
    family: "code-plugin",
    channel: "community",
    publishedAt: 1_767_225_600_000,
    source: {
      kind: "github",
      repository: "openclaw/kitchen-sink-plugin",
      commit: "abc123fixture",
    },
    compatibility: {
      builtWithOpenClawVersion: "2026.5.0",
      pluginApiRange: "^1.0.0",
      minGatewayVersion: ">=2026.5.0",
    },
    capabilities: {
      executesCode: true,
      runtimeId: "openclaw.kitchen-sink",
      pluginKind: "runtime",
      hooks: ["chat:before", "chat:after", "app:startup"],
      providers: ["openai", "openrouter"],
      toolNames: ["browser.open", "desktop.capture", "github.search"],
      serviceNames: ["playwright", "github"],
      bundledSkills: ["prompt-reviewer", "workflow-runner"],
      setupEntry: true,
      configSchema: true,
      configUiHints: true,
      materializesDependencies: true,
      hostTargets: ["darwin-arm64", "darwin-x64", "linux-x64-glibc", "win32-x64"],
      capabilityTags: [
        "browser",
        "desktop",
        "audio",
        "service:github",
        "service:openai",
        "permission:screen-recording",
      ],
    },
    verification: {
      tier: "source-linked",
      scope: "dependency-graph-aware",
      sourceRepo: "openclaw/kitchen-sink-plugin",
      sourceCommit: "abc123fixture",
      scanStatus: "clean",
    },
    files: [
      await fixtureFile(
        "package.json",
        JSON.stringify(
          {
            name: "@openclaw/kitchen-sink-plugin",
            version: "9.9.9",
            type: "module",
            openclaw: {
              plugin: "./openclaw.plugin.json",
              extensions: ["./dist/index.js"],
            },
            dependencies: {
              "@playwright/test": "^1.52.0",
              ws: "^8.18.0",
            },
          },
          null,
          2,
        ),
        "application/json",
      ),
      await fixtureFile(
        "openclaw.plugin.json",
        JSON.stringify(
          {
            id: "openclaw.kitchen-sink",
            entry: "./dist/index.js",
            setup: "./dist/setup.js",
            hostTargets: ["darwin-arm64", "darwin-x64", "linux-x64-glibc", "win32-x64"],
            permissions: ["network", "screen-recording", "audio-input"],
          },
          null,
          2,
        ),
        "application/json",
      ),
      await fixtureFile(
        "dist/index.js",
        "export const plugin = { activate() { return 'kitchen-sink'; } };\n",
        "text/javascript",
      ),
      await fixtureFile(
        "dist/setup.js",
        "export function setup() { return { schema: true, uiHints: true }; }\n",
        "text/javascript",
      ),
      await fixtureFile(
        "browser/playwright-smoke.ts",
        "export async function smoke(page) { await page.goto('https://example.com'); }\n",
        "text/typescript",
      ),
    ],
  };
}
