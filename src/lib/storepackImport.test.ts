import { describe, expect, it } from "vitest";
import { normalizeStorePackImport } from "./storepackImport";

function withRelativePath(file: File, path: string) {
  Object.defineProperty(file, "webkitRelativePath", {
    value: path,
    configurable: true,
  });
  return file;
}

describe("storepack import", () => {
  it("unwraps package files and prefill metadata from a StorePack archive", async () => {
    const manifest = withRelativePath(
      new File(
        [
          JSON.stringify({
            kind: "openclaw.storepack",
            package: {
              name: "demo-plugin",
              displayName: "Demo Plugin",
              version: "1.2.3",
              family: "code-plugin",
            },
            release: {
              source: {
                repo: "openclaw/demo-plugin",
                commit: "abc123",
                ref: "refs/tags/v1.2.3",
                path: ".",
              },
            },
            hostTargets: [
              { os: "darwin", arch: "arm64" },
              { os: "linux", arch: "x64", libc: "glibc" },
            ],
          }),
        ],
        "STOREPACK.json",
        { type: "application/json" },
      ),
      "demo.storepack/STOREPACK.json",
    );
    const packageJson = withRelativePath(
      new File(['{"name":"demo-plugin"}'], "package.json", { type: "application/json" }),
      "demo.storepack/package/package.json",
    );
    const pluginManifest = withRelativePath(
      new File(['{"id":"demo.plugin"}'], "openclaw.plugin.json", { type: "application/json" }),
      "demo.storepack/package/openclaw.plugin.json",
    );

    const imported = await normalizeStorePackImport([manifest, packageJson, pluginManifest]);

    expect(imported.summary).toMatchObject({
      packageName: "demo-plugin",
      displayName: "Demo Plugin",
      version: "1.2.3",
      family: "code-plugin",
      sourceRepo: "openclaw/demo-plugin",
      sourceCommit: "abc123",
      sourceRef: "refs/tags/v1.2.3",
      sourcePath: ".",
      hostTargets: ["darwin-arm64", "linux-x64-glibc"],
      packageFileCount: 2,
    });
    expect(imported.files.map((file) => file.name)).toEqual([
      "package.json",
      "openclaw.plugin.json",
    ]);
  });

  it("rejects malformed StorePack manifests", async () => {
    const manifest = new File(['{"kind":"other"}'], "STOREPACK.json", {
      type: "application/json",
    });
    const packageJson = new File(["{}"], "package/package.json", { type: "application/json" });

    await expect(normalizeStorePackImport([manifest, packageJson])).rejects.toThrow(
      /not an OpenClaw StorePack/i,
    );
  });
});
