/* @vitest-environment node */

import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  buildStorePack,
  deriveStorePackEnvironment,
  deriveStorePackHostTargets,
  STOREPACK_MANIFEST_PATH,
} from "./storepack";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function makeStorePack(overrides: Partial<Parameters<typeof buildStorePack>[0]> = {}) {
  return await buildStorePack({
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

describe("storepack", () => {
  it("builds a deterministic archive with a generated STOREPACK manifest", async () => {
    const first = await makeStorePack();
    const second = await makeStorePack();
    const unzipped = unzipSync(first.bytes);
    const manifest = JSON.parse(decoder.decode(unzipped[`package/${STOREPACK_MANIFEST_PATH}`]));

    expect(Array.from(first.bytes)).toEqual(Array.from(second.bytes));
    expect(first.sha256).toBe(second.sha256);
    expect(Object.keys(unzipped).sort()).toEqual([
      "package/STOREPACK.json",
      "package/dist/index.js",
      "package/package.json",
    ]);
    expect(manifest).toMatchObject({
      specVersion: 1,
      kind: "openclaw.storepack",
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

  it("ignores publisher supplied STOREPACK.json files", async () => {
    const built = await makeStorePack({
      files: [
        {
          path: "STOREPACK.json",
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
    const manifest = JSON.parse(decoder.decode(unzipped["package/STOREPACK.json"]));

    expect(Object.keys(unzipped).sort()).toEqual(["package/STOREPACK.json", "package/package.json"]);
    expect(manifest.forged).toBeUndefined();
    expect(manifest.files).toHaveLength(1);
    expect(built.fileCount).toBe(2);
  });

  it("derives host targets and environment cues from package capabilities", () => {
    expect(
      deriveStorePackHostTargets({
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
      deriveStorePackEnvironment({
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
