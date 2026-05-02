import { describe, expect, it } from "vitest";
import { normalizeClawPackImport } from "./clawpackImport";

function withRelativePath(file: File, path: string) {
  Object.defineProperty(file, "webkitRelativePath", {
    value: path,
    configurable: true,
  });
  return file;
}

describe("clawpack import", () => {
  it("unwraps package files and prefill metadata from a Claw Pack archive", async () => {
    const manifest = withRelativePath(
      new File(
        [
          JSON.stringify({
            kind: "openclaw.clawpack",
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
        "CLAWPACK.json",
        { type: "application/json" },
      ),
      "demo.clawpack/CLAWPACK.json",
    );
    const packageJson = withRelativePath(
      new File(['{"name":"demo-plugin"}'], "package.json", { type: "application/json" }),
      "demo.clawpack/package/package.json",
    );
    const pluginManifest = withRelativePath(
      new File(['{"id":"demo.plugin"}'], "openclaw.plugin.json", { type: "application/json" }),
      "demo.clawpack/package/openclaw.plugin.json",
    );

    const imported = await normalizeClawPackImport([manifest, packageJson, pluginManifest]);

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

  it("rejects malformed Claw Pack manifests", async () => {
    const manifest = new File(['{"kind":"other"}'], "CLAWPACK.json", {
      type: "application/json",
    });
    const packageJson = new File(["{}"], "package/package.json", { type: "application/json" });

    await expect(normalizeClawPackImport([manifest, packageJson])).rejects.toThrow(
      /not an OpenClaw Claw Pack/i,
    );
  });
});
