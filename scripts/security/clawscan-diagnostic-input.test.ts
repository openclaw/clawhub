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
  downloadIncidentArchive,
  incidentManifest,
  receiptIncidentManifest,
  smallTimeoutManifest,
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
  vi.unstubAllGlobals();
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

it("pins the one-file production timeout without adding uploaded source or arbitrary URLs", async () => {
  expect(smallTimeoutManifest.files).toEqual([
    {
      path: "SKILL.md",
      sha256: "140e137653e0e5dbde7b95e22f4d8377c464e4bf4f881e01a324a54ce6c42f5f",
      size: 7877,
    },
  ]);
  expect(smallTimeoutManifest.archiveSha256).toBe(
    "b1b2e3362fd727cd13988de006eb1609e76b523d85b4ff2c7092a8884faee051",
  );
  expect(smallTimeoutManifest.manifestSha256).toBe(
    "b06b8903a4afb89700cf881f8733b692fff1d35dc9373cee88d3efd8bcfa0862",
  );
  const fetchArchive = vi.fn().mockResolvedValue(new Response("controlled transport bytes"));
  vi.stubGlobal("fetch", fetchArchive);
  await downloadIncidentArchive("small-timeout-paired");
  expect(fetchArchive.mock.calls[0]?.[0]).toBe(
    "https://clawhub.ai/api/v1/download?slug=fitatu-diary&version=1.1.1",
  );
  const root = await temp();
  await expect(
    extractDiagnosticArchive(Buffer.from("changed"), join(root, "input"), smallTimeoutManifest),
  ).rejects.toThrow("archive identity");
  expect(await readdir(root)).toEqual([]);
});

it("pins the bounded two-file receipt incident without adding uploaded source", async () => {
  expect(receiptIncidentManifest.files).toEqual([
    {
      path: "SKILL.md",
      sha256: "882038546e93fda3004ce167494076b9c90a4dc4266289a552058cbf5fc75e99",
      size: 4193,
    },
    {
      path: "owd.mjs",
      sha256: "56ab1f20be945a5dc372f544c12a4d7c2b27cc0ec0c0180dd8d18235696127d1",
      size: 5816,
    },
  ]);
  expect(receiptIncidentManifest.archiveSha256).toBe(
    "2d3a046cbb228b419bf9c70830455b9298fd4cba3e8c329da28ce82c10eb11f7",
  );
  expect(hash(JSON.stringify(receiptIncidentManifest.files))).toBe(
    receiptIncidentManifest.manifestSha256,
  );
  const fetchArchive = vi.fn().mockResolvedValue(new Response("controlled transport bytes"));
  vi.stubGlobal("fetch", fetchArchive);
  expect((await downloadIncidentArchive("receipt-incident")).toString()).toBe(
    "controlled transport bytes",
  );
  expect(fetchArchive.mock.calls[0]?.[0]).toBe(
    "https://clawhub.ai/api/v1/download?slug=onlinewebdirectory&version=1.0.1",
  );
  await expect(
    extractDiagnosticArchive(
      Buffer.from("changed"),
      join(await temp(), "input"),
      receiptIncidentManifest,
    ),
  ).rejects.toThrow("archive identity");
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
