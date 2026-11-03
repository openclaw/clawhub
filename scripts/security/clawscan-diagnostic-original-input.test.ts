/* @vitest-environment node */
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { afterEach, expect, it } from "vitest";
import { extractDiagnosticArchive, type DiagnosticManifest } from "./clawscan-diagnostic-input";

const hash = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    const unlock = async (directory: string) => {
      await chmod(directory, 0o700);
      for (const entry of await readdir(directory, { withFileTypes: true }))
        if (entry.isDirectory()) await unlock(join(directory, entry.name));
    };
    await unlock(root);
    await rm(root, { recursive: true, force: true });
  }
});

it("materializes all 290 inert originals beyond the historical 10MiB bound without dropping files", async () => {
  const root = await mkdtemp(join(tmpdir(), "original-input-test-"));
  roots.push(root);
  const entries = Object.fromEntries(
    Array.from({ length: 290 }, (_, index) => [
      `file-${String(index).padStart(3, "0")}.md`,
      Buffer.alloc(40_000, 65),
    ]),
  );
  const files = Object.entries(entries).map(([path, data]) => ({
    path,
    size: data.length,
    sha256: hash(data),
  }));
  const archive = Buffer.from(zipSync({ ...entries, "_meta.json": Buffer.from("{}") }));
  const manifest: DiagnosticManifest = {
    archiveSha256: hash(archive),
    manifestSha256: hash(JSON.stringify(files)),
    manifestCanonicalization: "path,size,sha256",
    files,
  };
  expect(
    await extractDiagnosticArchive(archive, join(root, "input"), manifest, {
      maximumBytes: 16 * 1024 * 1024,
      excludedEntries: ["_meta.json"],
    }),
  ).toMatchObject({ files: 290, bytes: 11_600_000, manifestSha256: manifest.manifestSha256 });
  await expect(extractDiagnosticArchive(archive, join(root, "legacy"), manifest)).rejects.toThrow();
});

function metadataFixture() {
  const metadata = Buffer.from('{"original":"inert"}');
  const entries = { "SKILL.md": Buffer.from("Inert original"), "_meta.json": metadata };
  const files = Object.entries(entries)
    .sort(([left], [right]) => (left < right ? -1 : 1))
    .map(([path, data]) => ({ path, size: data.length, sha256: hash(data) }));
  const archive = Buffer.from(
    zipSync({ ...entries, "_meta.json": Buffer.from('{"generated":true}') }),
  );
  const manifest: DiagnosticManifest = {
    archiveSha256: hash(archive),
    manifestSha256: hash(JSON.stringify(files)),
    manifestCanonicalization: "path,size,sha256",
    files,
  };
  return { metadata, archive, manifest };
}

it("replaces only generated metadata with verified original bytes, then seals and verifies the full input", async () => {
  const root = await mkdtemp(join(tmpdir(), "original-metadata-test-"));
  roots.push(root);
  const { metadata, archive, manifest } = metadataFixture();
  await expect(
    extractDiagnosticArchive(archive, join(root, "absent"), manifest, { excludedEntries: [] }),
  ).rejects.toThrow("size mismatch");
  await expect(
    extractDiagnosticArchive(archive, join(root, "bad"), manifest, {
      excludedEntries: [],
      restoredMetadata: Buffer.from("PRIVATE"),
    }),
  ).rejects.toThrow("metadata identity");
  expect(await readdir(root)).toEqual([]);
  const input = join(root, "good");
  expect(
    await extractDiagnosticArchive(archive, input, manifest, {
      excludedEntries: [],
      restoredMetadata: metadata,
    }),
  ).toMatchObject({ files: 2 });
  expect(await readFile(join(input, "_meta.json"))).toEqual(metadata);
  expect(await readdir(input)).toEqual(["SKILL.md", "_meta.json"]);
});

it("rejects bad hashes, unsafe paths, duplicate entries, special types, oversize and missing originals", async () => {
  const root = await mkdtemp(join(tmpdir(), "original-invalid-test-"));
  roots.push(root);
  const { metadata, archive, manifest } = metadataFixture();
  await expect(
    extractDiagnosticArchive(Buffer.from("PRIVATE"), join(root, "hash"), manifest, {
      excludedEntries: [],
    }),
  ).rejects.toThrow("archive identity");
  for (const path of ["../escape", "/absolute", "a/../b", "a\\b", "a\u0000b", "a//b"]) {
    const files = [{ path, size: 1, sha256: hash("a") }];
    await expect(
      extractDiagnosticArchive(
        archive,
        join(root, "path"),
        { ...manifest, files, manifestSha256: hash(JSON.stringify(files)) },
        { excludedEntries: [] },
      ),
    ).rejects.toThrow("manifest");
  }
  const missing = Buffer.from(zipSync({ "SKILL.md": Buffer.from("Inert original") }));
  await expect(
    extractDiagnosticArchive(
      missing,
      join(root, "missing"),
      { ...manifest, archiveSha256: hash(missing) },
      { excludedEntries: [], restoredMetadata: metadata },
    ),
  ).rejects.toThrow("inventory");
  const duplicate = Buffer.from(zipSync({ aa: Buffer.from("a"), bb: Buffer.from("b") }));
  for (let offset = 0; offset < duplicate.length - 1; offset += 1)
    if (duplicate[offset] === 98 && duplicate[offset + 1] === 98) duplicate.write("aa", offset);
  const files = [
    { path: "aa", size: 1, sha256: hash("a") },
    { path: "bb", size: 1, sha256: hash("b") },
  ];
  const duplicateManifest: DiagnosticManifest = {
    archiveSha256: hash(duplicate),
    files,
    manifestSha256: hash(JSON.stringify(files)),
    manifestCanonicalization: "path,size,sha256",
  };
  await expect(
    extractDiagnosticArchive(duplicate, join(root, "duplicate"), duplicateManifest, {
      excludedEntries: [],
    }),
  ).rejects.toThrow("entry");
  const special = Buffer.from(archive);
  const central = special.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  special.writeUInt32LE((0o120777 << 16) >>> 0, central + 38);
  await expect(
    extractDiagnosticArchive(
      special,
      join(root, "special"),
      { ...manifest, archiveSha256: hash(special) },
      { excludedEntries: [], restoredMetadata: metadata },
    ),
  ).rejects.toThrow("entry");
  await expect(
    extractDiagnosticArchive(archive, join(root, "oversize"), manifest, {
      maximumBytes: 1,
      excludedEntries: [],
    }),
  ).rejects.toThrow("manifest");
  await expect(
    extractDiagnosticArchive(archive, join(root, "unbounded"), manifest, {
      maximumBytes: 32 * 1024 * 1024,
      excludedEntries: [],
    }),
  ).rejects.toThrow("manifest");
  expect(await readdir(root)).toEqual([]);
});
