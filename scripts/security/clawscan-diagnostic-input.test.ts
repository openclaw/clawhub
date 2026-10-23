/* @vitest-environment node */
import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { afterEach, expect, it, vi } from "vitest";
import {
  extractDiagnosticArchive,
  incidentManifest,
  verifyDiagnosticTree,
  type DiagnosticManifest,
} from "./clawscan-diagnostic-input";

const roots: string[] = [];
const hash = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
async function temp() {
  const root = await mkdtemp(join(tmpdir(), "diagnostic-input-test-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  const unlock = async (root: string) => {
    await chmod(root, 0o700);
    for (const name of await readdir(root)) {
      const child = join(root, name);
      const info = await lstat(child);
      if (info.isDirectory() && !info.isSymbolicLink()) await unlock(child);
    }
  };
  for (const root of roots.splice(0)) {
    await unlock(root);
    await rm(root, { recursive: true, force: true });
  }
});

function fixture(entries = { "SKILL.md": Buffer.from("Harmless original\n") }) {
  const archive = Buffer.from(
    zipSync({
      ...entries,
      "_meta.json": Buffer.from("{}"),
      "skill-card.md": Buffer.from("generated"),
    }),
  );
  const files = Object.entries(entries).map(([path, bytes]) => ({
    path,
    sha256: hash(bytes),
    size: bytes.length,
  }));
  const manifest: DiagnosticManifest = {
    archiveSha256: hash(archive),
    manifestSha256: hash(JSON.stringify(files)),
    files,
  };
  return { archive, manifest };
}

it("fails archive identity before decompression/materialization/provider execution", async () => {
  const root = await temp();
  const { archive, manifest } = fixture();
  const executeProvider = vi.fn();
  const altered = Buffer.from(archive);
  altered[0] ^= 1;
  await expect(
    (async () => {
      await extractDiagnosticArchive(altered, join(root, "input"), manifest);
      executeProvider();
    })(),
  ).rejects.toThrow("archive identity");
  expect(executeProvider).not.toHaveBeenCalled();
  expect(await readdir(root)).toEqual([]);
});

it("retains exact original bytes and rejects source-hash, inventory, symlink and extra-directory drift", async () => {
  const root = await temp();
  const { archive, manifest } = fixture();
  const input = join(root, "input");
  expect(await extractDiagnosticArchive(archive, input, manifest)).toMatchObject({
    files: 1,
    bytes: 18,
  });
  expect(await readdir(input)).toEqual(["SKILL.md"]);
  expect(await readFile(join(input, "SKILL.md"), "utf8")).toBe("Harmless original\n");
  await chmod(input, 0o700);
  await mkdir(join(input, "unexpected"));
  await expect(verifyDiagnosticTree(input, manifest)).rejects.toThrow("directory");
  await rm(join(input, "unexpected"), { recursive: true });
  await symlink(join(input, "SKILL.md"), join(input, "link"));
  await expect(verifyDiagnosticTree(input, manifest)).rejects.toThrow("file type");
  await rm(join(input, "link"));
  await chmod(join(input, "SKILL.md"), 0o600);
  await writeFile(join(input, "SKILL.md"), "tampered");
  await expect(verifyDiagnosticTree(input, manifest)).rejects.toThrow("identity");
});

it("checks original hashes and special ZIP types before any input is created", async () => {
  const root = await temp();
  const { archive, manifest } = fixture();
  const corruptManifest = {
    ...manifest,
    files: manifest.files.map((file) => ({ ...file, sha256: "0".repeat(64) })),
  };
  corruptManifest.manifestSha256 = hash(JSON.stringify(corruptManifest.files));
  await expect(
    extractDiagnosticArchive(archive, join(root, "bad-hash"), corruptManifest),
  ).rejects.toThrow("identity");
  const linkArchive = Buffer.from(archive);
  const central = linkArchive.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  linkArchive.writeUInt32LE((0o120777 << 16) >>> 0, central + 38);
  await expect(
    extractDiagnosticArchive(linkArchive, join(root, "link"), {
      ...manifest,
      archiveSha256: hash(linkArchive),
    }),
  ).rejects.toThrow("entry");
  const withExtra = Buffer.from(
    zipSync({
      "SKILL.md": Buffer.from("Harmless original\n"),
      "_meta.json": Buffer.from("{}"),
      "skill-card.md": Buffer.from("generated"),
      extra: Buffer.from("PRIVATE"),
    }),
  );
  await expect(
    extractDiagnosticArchive(withExtra, join(root, "extra"), {
      ...manifest,
      archiveSha256: hash(withExtra),
    }),
  ).rejects.toThrow("inventory");
  expect(await readdir(root)).toEqual([]);
});

it("pins the full original incident inventory, not the generated ZIP or VT ZIP identity", () => {
  expect(incidentManifest.files).toHaveLength(91);
  expect(incidentManifest.files.reduce((total, file) => total + file.size, 0)).toBe(317855);
  expect(incidentManifest.manifestSha256).toBe(
    "12c0d9d193a2197d77dfe05676e6db6b9befa76f5f6da98d761df775395b2d61",
  );
  expect(hash(JSON.stringify(incidentManifest.files))).toBe(incidentManifest.manifestSha256);
  expect(incidentManifest.archiveSha256).toBe(
    "3c2655af3025ef69f05ddc78b331e2279c63ba4be0f72aa686514c92ab805ea6",
  );
  expect(
    incidentManifest.files.some((file) => ["_meta.json", "skill-card.md"].includes(file.path)),
  ).toBe(false);
});
