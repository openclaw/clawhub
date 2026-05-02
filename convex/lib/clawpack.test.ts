import { gzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { npmTarballName, parseClawPack } from "./clawpack";

const BLOCK_SIZE = 512;

function octal(value: number, width: number) {
  return value.toString(8).padStart(width - 1, "0") + "\0";
}

function writeString(target: Uint8Array, offset: number, width: number, value: string) {
  const encoded = new TextEncoder().encode(value);
  target.set(encoded.subarray(0, width), offset);
}

function tarFile(path: string, content: string) {
  const bytes = new TextEncoder().encode(content);
  const header = new Uint8Array(BLOCK_SIZE);
  writeString(header, 0, 100, path);
  writeString(header, 100, 8, octal(0o644, 8));
  writeString(header, 108, 8, octal(0, 8));
  writeString(header, 116, 8, octal(0, 8));
  writeString(header, 124, 12, octal(bytes.byteLength, 12));
  writeString(header, 136, 12, octal(0, 12));
  header.fill(0x20, 148, 156);
  header[156] = "0".charCodeAt(0);
  writeString(header, 257, 6, "ustar");
  writeString(header, 263, 2, "00");

  let checksum = 0;
  for (const byte of header) checksum += byte;
  writeString(header, 148, 8, octal(checksum, 8));

  const paddedSize = Math.ceil(bytes.byteLength / BLOCK_SIZE) * BLOCK_SIZE;
  const body = new Uint8Array(paddedSize);
  body.set(bytes);
  return [header, body];
}

function npmPackFixture(files: Record<string, string>) {
  const parts: Uint8Array[] = [];
  for (const [path, content] of Object.entries(files)) {
    parts.push(...tarFile(path, content));
  }
  parts.push(new Uint8Array(BLOCK_SIZE), new Uint8Array(BLOCK_SIZE));
  const size = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const tar = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    tar.set(part, offset);
    offset += part.byteLength;
  }
  return gzipSync(tar);
}

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
    expect(parsed.entries.map((entry) => entry.path).sort()).toEqual([
      "README.md",
      "openclaw.plugin.json",
      "package.json",
    ]);
  });

  it("rejects archives that are not rooted under package/", async () => {
    const pack = npmPackFixture({
      "evil/package.json": JSON.stringify({ name: "demo", version: "1.0.0" }),
    });

    await expect(parseClawPack(pack)).rejects.toThrow("rooted under package");
  });

  it("uses npm-style tarball names", () => {
    expect(npmTarballName("demo", "1.0.0")).toBe("demo-1.0.0.tgz");
    expect(npmTarballName("@scope/demo", "1.0.0")).toBe("scope-demo-1.0.0.tgz");
  });
});
