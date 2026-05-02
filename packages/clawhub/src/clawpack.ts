import { gunzipSync } from "fflate";

type ClawPackEntry = {
  path: string;
  bytes: Uint8Array;
};

type ParsedClawPack = {
  packageName: string;
  packageVersion: string;
  entries: ClawPackEntry[];
  packageJson: Record<string, unknown>;
};

const TAR_BLOCK_SIZE = 512;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function textFromBytes(bytes: Uint8Array) {
  return new TextDecoder().decode(bytes);
}

function readTarString(block: Uint8Array, offset: number, length: number) {
  const slice = block.subarray(offset, offset + length);
  const end = slice.indexOf(0);
  return textFromBytes(end === -1 ? slice : slice.subarray(0, end)).trim();
}

function readTarSize(block: Uint8Array) {
  const raw = readTarString(block, 124, 12).split("\0").join("").trim();
  if (!raw) return 0;
  const size = Number.parseInt(raw, 8);
  if (!Number.isFinite(size) || size < 0) throw new Error("Invalid tar entry size");
  return size;
}

function normalizeTarPath(path: string) {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\/+/, "");
  if (!normalized || normalized.startsWith("/") || normalized.includes("\0")) return null;
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0 || segments.some((segment) => segment === "." || segment === "..")) {
    return null;
  }
  return segments.join("/");
}

function isZeroBlock(block: Uint8Array) {
  return block.every((byte) => byte === 0);
}

function nextTarOffset(offset: number, size: number) {
  return offset + Math.ceil(size / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE;
}

function parseTarEntries(bytes: Uint8Array): ClawPackEntry[] {
  const entries: ClawPackEntry[] = [];
  let offset = 0;

  while (offset + TAR_BLOCK_SIZE <= bytes.byteLength) {
    const header = bytes.subarray(offset, offset + TAR_BLOCK_SIZE);
    if (isZeroBlock(header)) break;

    const name = readTarString(header, 0, 100);
    const prefix = readTarString(header, 345, 155);
    const path = normalizeTarPath(prefix ? `${prefix}/${name}` : name);
    if (!path) throw new Error("ClawPack contains an unsafe tar path");

    const size = readTarSize(header);
    const payloadOffset = offset + TAR_BLOCK_SIZE;
    const payloadEnd = payloadOffset + size;
    if (payloadEnd > bytes.byteLength) throw new Error("ClawPack tar entry is truncated");

    const typeflag = String.fromCharCode(header[156] ?? 0).replace("\0", "");
    if (typeflag === "" || typeflag === "0") {
      if (!path.startsWith("package/")) {
        throw new Error("ClawPack entries must be rooted under package/");
      }
      const relPath = path.slice("package/".length);
      if (relPath) {
        entries.push({
          path: relPath,
          bytes: Uint8Array.from(bytes.subarray(payloadOffset, payloadEnd)),
        });
      }
    } else if (typeflag !== "5") {
      throw new Error("ClawPack may only contain regular files and directories");
    }

    offset = nextTarOffset(payloadOffset, size);
  }

  if (entries.length === 0) throw new Error("ClawPack contains no files");
  return entries;
}

export function parseClawPack(bytes: Uint8Array): ParsedClawPack {
  let tarBytes: Uint8Array;
  try {
    tarBytes = gunzipSync(bytes);
  } catch {
    throw new Error("ClawPack must be a gzip-compressed npm pack tarball");
  }

  const entries = parseTarEntries(tarBytes);
  const packageJsonEntry = entries.find((entry) => entry.path === "package.json");
  if (!packageJsonEntry) throw new Error("ClawPack must contain package/package.json");

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

  return {
    packageName,
    packageVersion,
    entries,
    packageJson,
  };
}
