import { Gunzip } from "fflate";

type ClawPackEntry = {
  path: string;
  bytes: Uint8Array;
};

type ParsedClawPack = {
  artifactSha256: string;
  npmIntegrity: string;
  npmShasum: string;
  npmTarballName: string;
  packageName: string;
  packageVersion: string;
  unpackedSize: number;
  fileCount: number;
  entries: ClawPackEntry[];
  packageJson: Record<string, unknown>;
  pluginManifest?: Record<string, unknown>;
};

const TAR_BLOCK_SIZE = 512;
const MAX_UNPACKED_BYTES = 50 * 1024 * 1024;
const MAX_TAR_BYTES = 64 * 1024 * 1024;
const MAX_FILE_BYTES = MAX_UNPACKED_BYTES;
const MAX_PACKAGE_JSON_BYTES = 256 * 1024;
const MAX_FILE_COUNT = 10_000;
const GZIP_INPUT_CHUNK_BYTES = 1_024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function textFromBytes(bytes: Uint8Array) {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function readTarString(block: Uint8Array, offset: number, length: number) {
  const slice = block.subarray(offset, offset + length);
  const end = slice.indexOf(0);
  return textFromBytes(end === -1 ? slice : slice.subarray(0, end));
}

function readTarSize(block: Uint8Array) {
  const raw = readTarString(block, 124, 12).split("\0").join("").trim();
  if (!raw) return 0;
  const size = Number.parseInt(raw, 8);
  if (!Number.isFinite(size) || size < 0) throw new Error("Invalid tar entry size");
  return size;
}

function normalizeTarPath(path: string) {
  if (
    !path ||
    path !== path.trim() ||
    path.includes("\\") ||
    path.startsWith("/") ||
    path.includes("\0")
  ) {
    return null;
  }
  const segments = path.split("/");
  if (
    segments.length === 0 ||
    segments.some(
      (segment, index) =>
        segment === "." || segment === ".." || (segment === "" && index !== segments.length - 1),
    )
  ) {
    return null;
  }
  return segments.join("/");
}

function gunzipBounded(bytes: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const gunzip = new Gunzip((chunk) => {
    total += chunk.byteLength;
    if (total > MAX_TAR_BYTES) throw new Error("ClawPack unpacked archive exceeds 64MB limit");
    chunks.push(Uint8Array.from(chunk));
  });
  for (let offset = 0; offset < bytes.byteLength; offset += GZIP_INPUT_CHUNK_BYTES) {
    const end = Math.min(offset + GZIP_INPUT_CHUNK_BYTES, bytes.byteLength);
    gunzip.push(bytes.subarray(offset, end), end === bytes.byteLength);
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function tarEntryPayload(bytes: Uint8Array, offset: number, size: number) {
  return bytes.subarray(offset, offset + size);
}

function nextTarOffset(offset: number, size: number) {
  return offset + Math.ceil(size / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE;
}

function isZeroBlock(block: Uint8Array) {
  return block.every((byte) => byte === 0);
}

function parseTarEntries(bytes: Uint8Array): ClawPackEntry[] {
  const entries: ClawPackEntry[] = [];
  const paths = new Set<string>();
  let offset = 0;

  while (offset + TAR_BLOCK_SIZE <= bytes.byteLength) {
    const header = bytes.subarray(offset, offset + TAR_BLOCK_SIZE);
    if (isZeroBlock(header)) break;

    const name = readTarString(header, 0, 100);
    const prefix = readTarString(header, 345, 155);
    const path = normalizeTarPath(prefix ? `${prefix}/${name}` : name);
    if (!path) throw new Error("ClawPack contains an unsafe tar path");

    const size = readTarSize(header);
    if (size > MAX_FILE_BYTES) throw new Error("ClawPack file exceeds 50MB limit");
    const payloadOffset = offset + TAR_BLOCK_SIZE;
    const payloadEnd = payloadOffset + size;
    if (payloadEnd > bytes.byteLength) throw new Error("ClawPack tar entry is truncated");

    const typeflag = String.fromCharCode(header[156] ?? 0).replace("\0", "");
    if (typeflag === "" || typeflag === "0") {
      if (!path.startsWith("package/")) {
        throw new Error("ClawPack entries must be rooted under package/");
      }
      const relPath = path.slice("package/".length);
      if (!relPath || relPath.endsWith("/"))
        throw new Error("ClawPack contains an unsafe tar path");
      if (paths.has(relPath)) {
        throw new Error(`ClawPack contains duplicate path: ${relPath}`);
      }
      paths.add(relPath);
      if (entries.length >= MAX_FILE_COUNT) throw new Error("ClawPack exceeds 10000 file limit");
      entries.push({
        path: relPath,
        bytes: Uint8Array.from(tarEntryPayload(bytes, payloadOffset, size)),
      });
    } else if (typeflag !== "5") {
      throw new Error("ClawPack may only contain regular files and directories");
    }

    offset = nextTarOffset(payloadOffset, size);
  }

  if (entries.length === 0) throw new Error("ClawPack contains no files");
  const unpackedSize = entries.reduce((sum, entry) => sum + entry.bytes.byteLength, 0);
  if (unpackedSize > MAX_UNPACKED_BYTES) throw new Error("ClawPack package exceeds 50MB limit");
  return entries;
}

async function digestBytes(algorithm: "SHA-1" | "SHA-256" | "SHA-512", bytes: Uint8Array) {
  const input = new Uint8Array(bytes.byteLength);
  input.set(bytes);
  const digest = await crypto.subtle.digest(algorithm, input);
  return new Uint8Array(digest);
}

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function npmTarballName(packageName: string, version: string) {
  const normalizedName = packageName.replace(/^@/, "").replace("/", "-");
  return `${normalizedName}-${version}.tgz`;
}

export async function sha256Hex(bytes: Uint8Array) {
  return toHex(await digestBytes("SHA-256", bytes));
}

export async function sha256Base64(bytes: Uint8Array) {
  return toBase64(await digestBytes("SHA-256", bytes));
}

export async function parseClawPack(bytes: Uint8Array): Promise<ParsedClawPack> {
  const [sha256, sha1, sha512] = await Promise.all([
    digestBytes("SHA-256", bytes),
    digestBytes("SHA-1", bytes),
    digestBytes("SHA-512", bytes),
  ]);

  let tarBytes: Uint8Array;
  try {
    tarBytes = gunzipBounded(bytes);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("ClawPack ")) throw error;
    throw new Error("ClawPack must be a gzip-compressed npm pack tarball", { cause: error });
  }

  const entries = parseTarEntries(tarBytes);
  const packageJsonEntry = entries.find((entry) => entry.path === "package.json");
  if (!packageJsonEntry) throw new Error("ClawPack must contain package/package.json");
  if (packageJsonEntry.bytes.byteLength > MAX_PACKAGE_JSON_BYTES) {
    throw new Error("ClawPack package.json exceeds 256KB limit");
  }
  const pluginManifestEntry = entries.find((entry) => entry.path === "openclaw.plugin.json");

  let packageJson: unknown;
  try {
    packageJson = JSON.parse(textFromBytes(packageJsonEntry.bytes));
  } catch {
    throw new Error("ClawPack package.json is invalid JSON");
  }
  if (!isRecord(packageJson)) throw new Error("ClawPack package.json must be an object");

  const packageName = typeof packageJson.name === "string" ? packageJson.name.trim() : "";
  const packageVersion = typeof packageJson.version === "string" ? packageJson.version.trim() : "";
  if (!packageName) throw new Error("ClawPack package.json must declare a name");
  if (!packageVersion) throw new Error("ClawPack package.json must declare a version");

  let pluginManifest: Record<string, unknown> | undefined;
  if (pluginManifestEntry) {
    try {
      const parsed = JSON.parse(textFromBytes(pluginManifestEntry.bytes)) as unknown;
      if (!isRecord(parsed)) throw new Error();
      pluginManifest = parsed;
    } catch {
      throw new Error("ClawPack openclaw.plugin.json is invalid JSON object");
    }
  }

  return {
    artifactSha256: toHex(sha256),
    npmIntegrity: `sha512-${toBase64(sha512)}`,
    npmShasum: toHex(sha1),
    npmTarballName: npmTarballName(packageName, packageVersion),
    packageName,
    packageVersion,
    unpackedSize: entries.reduce((sum, entry) => sum + entry.bytes.byteLength, 0),
    fileCount: entries.length,
    entries,
    packageJson,
    ...(pluginManifest ? { pluginManifest } : {}),
  };
}
