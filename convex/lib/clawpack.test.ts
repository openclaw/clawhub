/* @vitest-environment node */

import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { makeKitchenSinkClawPackInput } from "./__fixtures__/clawpackKitchenSink";
import {
  buildClawPack,
  deriveClawPackEnvironment,
  deriveClawPackHostTargets,
  CLAWPACK_MANIFEST_PATH,
} from "./clawpack";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function makeClawPack(overrides: Partial<Parameters<typeof buildClawPack>[0]> = {}) {
  return await buildClawPack({
    packageId: "pkg_123",
    releaseId: "rel_123",
    name: "@openclaw/kitchen-sink",
    owner: "openclaw",
    slug: "openclaw-kitchen-sink",
    version: "1.0.0",
    family: "code-plugin",
    channel: "official",
    publishedAt: 1_763_000_000_000,
    compatibility: {
      minGatewayVersion: ">=2026.5.0",
      pluginApiRange: "^1.0.0",
    },
    capabilities: {
      executesCode: true,
      hostTargets: ["darwin-arm64", "linux-x64-glibc", "win32-x64"],
      capabilityTags: ["browser", "desktop", "service:github"],
    },
    verification: {
      tier: "source-linked",
      scope: "artifact-only",
    },
    files: [
      {
        path: "package.json",
        size: 2,
        sha256: "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
        bytes: encoder.encode("{}"),
        contentType: "application/json",
      },
      {
        path: "dist/index.js",
        size: 17,
        sha256: "index-sha",
        bytes: encoder.encode("export default {};"),
        contentType: "text/javascript",
      },
    ],
    ...overrides,
  });
}

describe("clawpack", () => {
  it("builds a deterministic archive with a generated CLAWPACK manifest", async () => {
    const first = await makeClawPack();
    const second = await makeClawPack();
    const unzipped = unzipSync(first.bytes);
    const manifest = JSON.parse(decoder.decode(unzipped[`package/${CLAWPACK_MANIFEST_PATH}`]));

    expect(Array.from(first.bytes)).toEqual(Array.from(second.bytes));
    expect(first.sha256).toBe(second.sha256);
    expect(Object.keys(unzipped).sort()).toEqual([
      "package/CLAWPACK.json",
      "package/dist/index.js",
      "package/package.json",
    ]);
    expect(manifest).toMatchObject({
      specVersion: 1,
      kind: "openclaw.clawpack",
      package: {
        name: "@openclaw/kitchen-sink",
        owner: "openclaw",
        slug: "openclaw-kitchen-sink",
        version: "1.0.0",
        family: "code-plugin",
        channel: "official",
      },
      artifact: {
        format: "zip",
        root: "package/",
        fileCount: 2,
      },
    });
    expect(manifest.files.map((file: { path: string }) => file.path)).toEqual([
      "dist/index.js",
      "package.json",
    ]);
  });

  it("ignores publisher supplied CLAWPACK.json files", async () => {
    const built = await makeClawPack({
      files: [
        {
          path: "CLAWPACK.json",
          size: 22,
          sha256: "attacker-sha",
          bytes: encoder.encode('{"forged": true}\n'),
        },
        {
          path: "package.json",
          size: 2,
          sha256: "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
          bytes: encoder.encode("{}"),
        },
      ],
    });
    const unzipped = unzipSync(built.bytes);
    const manifest = JSON.parse(decoder.decode(unzipped["package/CLAWPACK.json"]));

    expect(Object.keys(unzipped).sort()).toEqual(["package/CLAWPACK.json", "package/package.json"]);
    expect(manifest.forged).toBeUndefined();
    expect(manifest.files).toHaveLength(1);
    expect(built.fileCount).toBe(2);
  });

  it("normalizes archive separators before packing files", async () => {
    const built = await makeClawPack({
      files: [
        {
          path: "dist\\index.js",
          size: 17,
          sha256: "index-sha",
          bytes: encoder.encode("export default {};"),
        },
      ],
    });
    const unzipped = unzipSync(built.bytes);
    const manifest = JSON.parse(decoder.decode(unzipped[`package/${CLAWPACK_MANIFEST_PATH}`]));

    expect(Object.keys(unzipped).sort()).toEqual([
      "package/CLAWPACK.json",
      "package/dist/index.js",
    ]);
    expect(manifest.files.map((file: { path: string }) => file.path)).toEqual(["dist/index.js"]);
  });

  it("rejects archive paths that can escape the package root", async () => {
    for (const path of ["../evil.js", "dist/../../evil.js", "/tmp/evil.js", "C:\\tmp\\evil.js"]) {
      await expect(
        makeClawPack({
          files: [
            {
              path,
              size: 4,
              sha256: "evil-sha",
              bytes: encoder.encode("evil"),
            },
          ],
        }),
      ).rejects.toThrow("Invalid Claw Pack file path");
    }
  });

  it("rejects case-insensitive duplicate archive paths", async () => {
    await expect(
      makeClawPack({
        files: [
          {
            path: "dist/index.js",
            size: 17,
            sha256: "index-sha",
            bytes: encoder.encode("export default {};"),
          },
          {
            path: "dist/INDEX.js",
            size: 17,
            sha256: "index-upper-sha",
            bytes: encoder.encode("export default {};"),
          },
        ],
      }),
    ).rejects.toThrow("Duplicate Claw Pack file path");
  });

  it("packs a kitchen-sink OpenClaw plugin with cross-platform signals", async () => {
    const input = await makeKitchenSinkClawPackInput();
    const built = await buildClawPack(input);
    const unzipped = unzipSync(built.bytes);
    const manifest = JSON.parse(decoder.decode(unzipped[`package/${CLAWPACK_MANIFEST_PATH}`]));
    const packageJson = JSON.parse(decoder.decode(unzipped["package/package.json"]));

    expect(Object.keys(unzipped).sort()).toEqual([
      "package/CLAWPACK.json",
      "package/browser/playwright-smoke.ts",
      "package/dist/index.js",
      "package/dist/setup.js",
      "package/openclaw.plugin.json",
      "package/package.json",
    ]);
    expect(packageJson.openclaw.extensions).toEqual(["./dist/index.js"]);
    expect(manifest.hostTargets).toEqual([
      {
        os: "darwin",
        arch: "arm64",
        supportState: "supported",
        openclawRange: ">=2026.5.0",
        pluginApiRange: "^1.0.0",
      },
      {
        os: "darwin",
        arch: "x64",
        supportState: "supported",
        openclawRange: ">=2026.5.0",
        pluginApiRange: "^1.0.0",
      },
      {
        os: "linux",
        arch: "x64",
        libc: "glibc",
        supportState: "supported",
        openclawRange: ">=2026.5.0",
        pluginApiRange: "^1.0.0",
      },
      {
        os: "win32",
        arch: "x64",
        supportState: "supported",
        openclawRange: ">=2026.5.0",
        pluginApiRange: "^1.0.0",
      },
    ]);
    expect(manifest.environment).toEqual({
      requiresNetwork: true,
      requiresBrowser: true,
      requiresLocalDesktop: true,
      requiresAudioDevice: true,
      requiresExternalServices: ["github", "openai"],
    });
    expect(built.hostTargets.map((target) => [target.os, target.arch, target.libc])).toEqual([
      ["darwin", "arm64", undefined],
      ["darwin", "x64", undefined],
      ["linux", "x64", "glibc"],
      ["win32", "x64", undefined],
    ]);
  });

  it("derives host targets and environment cues from package capabilities", () => {
    expect(
      deriveClawPackHostTargets({
        capabilities: {
          hostTargets: ["Darwin/ARM64", "linux-x64-musl", "bad-target", "linux-x64-musl"],
        },
        compatibility: {
          minGatewayVersion: ">=2026.5.0",
          pluginApiRange: "^1.0.0",
        },
      }),
    ).toEqual([
      {
        os: "darwin",
        arch: "arm64",
        supportState: "supported",
        openclawRange: ">=2026.5.0",
        pluginApiRange: "^1.0.0",
      },
      {
        os: "linux",
        arch: "x64",
        libc: "musl",
        supportState: "supported",
        openclawRange: ">=2026.5.0",
        pluginApiRange: "^1.0.0",
      },
    ]);

    expect(
      deriveClawPackEnvironment({
        capabilities: {
          capabilityTags: ["browser", "desktop", "audio", "service:slack"],
        },
        files: [{ path: "dist/index.js" }],
      }),
    ).toEqual({
      requiresNetwork: true,
      requiresBrowser: true,
      requiresLocalDesktop: true,
      requiresAudioDevice: true,
      requiresExternalServices: ["slack"],
    });
  });
});
