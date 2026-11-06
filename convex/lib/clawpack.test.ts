/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import { npmPackFixture, npmPackFixtureEntries } from "../../packages/clawhub/test/npmPack";
import { npmTarballName, parseClawPack } from "./clawpack";

describe("clawpack", () => {
  it("parses npm pack tarballs and computes npm integrity fields", async () => {
    const pack = npmPackFixture({
      "package/package.json": JSON.stringify({ name: "@openclaw/demo", version: "1.2.3" }),
      "package/openclaw.plugin.json": JSON.stringify({ id: "demo" }),
      "package/README.md": "# Demo\n",
    });

    const parsed = await parseClawPack(pack);

    expect(parsed.packageName).toBe("@openclaw/demo");
    expect(parsed.packageVersion).toBe("1.2.3");
    expect(parsed.npmTarballName).toBe("openclaw-demo-1.2.3.tgz");
    expect(parsed.npmIntegrity).toMatch(/^sha512-/);
    expect(parsed.npmShasum).toMatch(/^[a-f0-9]{40}$/);
    expect(parsed.artifactSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(parsed.pluginManifest).toEqual({ id: "demo" });
    expect(parsed.entries.map((entry) => entry.path).sort()).toEqual([
      "README.md",
      "openclaw.plugin.json",
      "package.json",
    ]);
  });

  it("accepts Template tarballs without a plugin manifest", async () => {
    const pack = npmPackFixture({
      "package/package.json": JSON.stringify({
        name: "demo",
        version: "1.0.0",
        openclaw: { template: "CLAW.md" },
      }),
      "package/CLAW.md": "---\nschemaVersion: 1\nagent: { id: demo }\n---\n",
    });

    const parsed = await parseClawPack(pack);
    expect(parsed.pluginManifest).toBeUndefined();
    expect(parsed.entries.map((entry) => entry.path)).toContain("CLAW.md");
  });

  it("preserves and rejects padded tar path identity", async () => {
    const pack = npmPackFixture({
      "package/package.json": JSON.stringify({ name: "demo", version: "1.0.0" }),
      "package/CLAW.md ": "padded",
    });

    await expect(parseClawPack(pack)).rejects.toThrow("unsafe tar path");
  });

  it("rejects empty tar path segments", async () => {
    const pack = npmPackFixture({
      "package/package.json": JSON.stringify({ name: "demo", version: "1.0.0" }),
      "package/workspace//SOUL.md": "unsafe",
    });

    await expect(parseClawPack(pack)).rejects.toThrow("unsafe tar path");
  });

  it.each(["\u007f", "\u0085"])("rejects control character U+%s in tar paths", async (control) => {
    const pack = npmPackFixture({
      "package/package.json": JSON.stringify({ name: "demo", version: "1.0.0" }),
      [`package/workspace/a${control}.md`]: "unsafe",
    });

    await expect(parseClawPack(pack)).rejects.toThrow("unsafe tar path");
  });

  it("rejects oversized package metadata before JSON parsing", async () => {
    const pack = npmPackFixture({
      "package/package.json": new Uint8Array(256 * 1024 + 1).fill(0x20),
    });

    await expect(parseClawPack(pack)).rejects.toThrow("package.json exceeds 256KB limit");
  });

  it("rejects invalid UTF-8 package metadata", async () => {
    const pack = npmPackFixture({
      "package/package.json": new Uint8Array([0xc3, 0x28]),
    });

    await expect(parseClawPack(pack)).rejects.toThrow("package.json is invalid JSON");
  });

  it("rejects archives that are not rooted under package/", async () => {
    const pack = npmPackFixture({
      "evil/package.json": JSON.stringify({ name: "demo", version: "1.0.0" }),
    });

    await expect(parseClawPack(pack)).rejects.toThrow("rooted under package");
  });

  it("rejects duplicate normalized archive paths", async () => {
    const pack = npmPackFixtureEntries([
      ["package/package.json", JSON.stringify({ name: "demo", version: "1.0.0" })],
      ["package/openclaw.plugin.json", JSON.stringify({ id: "demo" })],
      ["package/package.json", JSON.stringify({ name: "other", version: "9.9.9" })],
    ]);

    await expect(parseClawPack(pack)).rejects.toThrow(
      "ClawPack contains duplicate path: package.json",
    );
  });

  it.each([
    [
      "ancestor first",
      [
        ["package/a", "file"],
        ["package/a/b", "child"],
      ],
    ],
    [
      "descendant first",
      [
        ["package/a/b", "child"],
        ["package/a", "file"],
      ],
    ],
  ] as const)("rejects tar file/ancestor collisions with %s", async (_label, entries) => {
    const pack = npmPackFixtureEntries([
      ["package/package.json", JSON.stringify({ name: "demo", version: "1.0.0" })],
      ...entries.map(([path, content]) => [path, content] as [string, string]),
    ]);

    await expect(parseClawPack(pack)).rejects.toThrow("file/ancestor path collision");
  });

  it("uses npm-style tarball names", () => {
    expect(npmTarballName("demo", "1.0.0")).toBe("demo-1.0.0.tgz");
    expect(npmTarballName("@scope/demo", "1.0.0")).toBe("scope-demo-1.0.0.tgz");
  });
});
