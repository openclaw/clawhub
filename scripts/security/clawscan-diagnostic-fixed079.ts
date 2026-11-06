import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseClawPack } from "../../packages/clawhub/src/clawpack";
import { verifyDiagnosticTree } from "./clawscan-diagnostic-input";
import original from "./fixtures/judge-original-079.json";

const ORIGINAL079_BYTES = 762020;
const ORIGINAL079_ARCHIVE_BYTES = 191470;
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
export const original079Manifest = original;
export const ORIGINAL079_DOWNLOAD =
  "https://clawhub.ai/api/v1/packages/%40mcphersonai%2Fmcpherson-governance-openclaw/versions/0.8.0/artifact/download";

if (
  original.files.length !== 106 ||
  original.files.reduce((sum, file) => sum + file.size, 0) !== ORIGINAL079_BYTES ||
  original.manifestSha256 !== "3c28e5bc78b2dc13fa817b7faa3b14a0f1810fd22a7faf1055d2cde7fe3a44c0" ||
  hash(JSON.stringify(original.files)) !== original.manifestSha256 ||
  original.archiveSha256 !== "8741819e883c1deebf30dbc3a2c150bee0359f4c99d1793745e72fad6064844e"
)
  throw new Error("Fixed original079 custody fixture differs from retained originals");

function verifyArchiveIdentity(archive: Buffer) {
  if (archive.length !== ORIGINAL079_ARCHIVE_BYTES || hash(archive) !== original.archiveSha256)
    throw new Error("Fixed original079 archive identity mismatch");
}

export async function materializeOriginal079(archive: Buffer, target: string) {
  // Unlike the generated skill ZIP, this is the exact retained npm archive.
  verifyArchiveIdentity(archive);
  const parsed = parseClawPack(archive);
  const files = parsed.entries
    .map(({ path, bytes }) => ({ path, sha256: hash(bytes), size: bytes.length }))
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  if (
    parsed.packageName !== "@mcphersonai/mcpherson-governance-openclaw" ||
    parsed.packageVersion !== "0.8.0" ||
    JSON.stringify(files) !== JSON.stringify(original.files)
  )
    throw new Error("Fixed original079 archive files differ from retained originals");

  // The existing parser rejects links and path collisions. Only exact verified
  // files enter a newly created private directory, with no lifecycle execution.
  await mkdir(target, { mode: 0o700 });
  for (const entry of parsed.entries) {
    const path = join(target, entry.path);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, entry.bytes, { flag: "wx", mode: 0o400 });
  }
  const identity = await verifyDiagnosticTree(target, original, ORIGINAL079_BYTES);
  return { ...identity, originalCompressedArchiveIdentityProven: true };
}

export async function downloadOriginal079() {
  const response = await fetch(ORIGINAL079_DOWNLOAD, {
    signal: AbortSignal.timeout(60_000),
    redirect: "error",
  });
  if (!response.ok || !response.body)
    throw new Error("Fixed original079 public download unavailable");
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    if (bytes > ORIGINAL079_ARCHIVE_BYTES)
      throw new Error("Fixed original079 archive exceeds retained size");
    chunks.push(Buffer.from(chunk));
  }
  const archive = Buffer.concat(chunks);
  verifyArchiveIdentity(archive);
  return archive;
}
