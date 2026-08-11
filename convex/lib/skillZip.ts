import { findClawPackagePathHierarchyCollision, isSafeClawPackagePath } from "clawhub-schema";
import { zipSync } from "fflate";

type ZipEntry = {
  path: string;
  bytes: Uint8Array;
};

export type AsyncZipEntry = {
  path: string;
  loadBytes: () => Promise<Uint8Array>;
};

export type SkillZipMeta = {
  ownerId: string;
  slug: string;
  version: string;
  publishedAt: number;
};

type ZipInput = Record<string, Uint8Array | [Uint8Array, { mtime?: Date }]>;

const FIXED_ZIP_DATE = new Date(1980, 0, 1, 0, 0, 0);

// ==================== Zip Slip Protection ====================

const SAFE_SLUG_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

/** Validate slug against Zip Slip (path traversal via crafted archive entries). */
export function validateSlug(slug: string): boolean {
  if (!slug || slug.length > 200) return false;
  if (slug.includes("..")) return false;
  return SAFE_SLUG_REGEX.test(slug);
}

/** Validate file path against Zip Slip — rejects absolute paths, `..`, backslashes, and empty segments. */
export function validateFilePath(filePath: string): boolean {
  if (!filePath || filePath.length > 500) return false;
  if (filePath.startsWith("/")) return false;
  if (filePath.includes("\\")) return false;
  const segments = filePath.split("/");
  for (const seg of segments) {
    if (seg === "..") return false;
    if (seg === "") return false;
  }
  return true;
}

// ===========================================================

export function buildSkillMeta(meta: SkillZipMeta) {
  return {
    ownerId: meta.ownerId,
    slug: meta.slug,
    version: meta.version,
    publishedAt: meta.publishedAt,
  };
}

export function buildDeterministicZip(entries: ZipEntry[], meta?: SkillZipMeta) {
  const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path));
  const zipData: ZipInput = {};

  for (const entry of sorted) {
    zipData[entry.path] = [entry.bytes, { mtime: FIXED_ZIP_DATE }];
  }

  if (meta) {
    const metaContent = new TextEncoder().encode(JSON.stringify(buildSkillMeta(meta), null, 2));
    zipData["_meta.json"] = [metaContent, { mtime: FIXED_ZIP_DATE }];
  }

  return Uint8Array.from(zipSync(zipData, { level: 6 }));
}

export function buildDeterministicZipStream(entries: AsyncZipEntry[], meta?: SkillZipMeta) {
  const orderedEntries = orderZipEntries(entries, meta);
  const centralDirectory: Uint8Array[] = [];
  let entryIndex = 0;
  let centralIndex = 0;
  let localBytes = 0;
  let centralBytes = 0;

  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          if (entryIndex < orderedEntries.length) {
            const entry = orderedEntries[entryIndex++];
            const bytes = await entry.loadBytes();
            const singleEntryZip = zipSync(
              { [entry.path]: [bytes, { mtime: FIXED_ZIP_DATE }] },
              { level: 6 },
            );
            const parts = splitSingleEntryZip(singleEntryZip, localBytes);
            centralDirectory.push(parts.centralDirectory);
            localBytes += parts.localFile.length;
            centralBytes += parts.centralDirectory.length;
            controller.enqueue(parts.localFile);
            return;
          }

          if (centralIndex < centralDirectory.length) {
            controller.enqueue(centralDirectory[centralIndex++]);
            return;
          }

          controller.enqueue(buildZipFooter(orderedEntries.length, centralBytes, localBytes));
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    },
    { highWaterMark: 0 },
  );
}

function orderZipEntries(entries: AsyncZipEntry[], meta?: SkillZipMeta) {
  const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path));
  const byPath = new Map(sorted.map((entry) => [entry.path, entry]));
  const zipDataOrder: Record<string, true> = {};
  for (const entry of sorted) zipDataOrder[entry.path] = true;

  if (meta) {
    const metaBytes = new TextEncoder().encode(JSON.stringify(buildSkillMeta(meta), null, 2));
    byPath.set("_meta.json", {
      path: "_meta.json",
      loadBytes: async () => metaBytes,
    });
    zipDataOrder["_meta.json"] = true;
  }

  return Object.keys(zipDataOrder).map((path) => byPath.get(path)!);
}

function splitSingleEntryZip(zip: Uint8Array, localOffset: number) {
  // A one-entry zip preserves fflate's exact compression bytes. Only its central-directory
  // offset changes when the local record is appended to the full streamed archive.
  const endOfCentralDirectory = zip.length - 22;
  if (readUint32(zip, endOfCentralDirectory) !== 0x06054b50) {
    throw new Error("Invalid single-entry ZIP footer");
  }
  const centralSize = readUint32(zip, endOfCentralDirectory + 12);
  const centralOffset = readUint32(zip, endOfCentralDirectory + 16);
  if (centralOffset + centralSize !== endOfCentralDirectory) {
    throw new Error("Invalid single-entry ZIP directory");
  }

  const centralDirectory = zip.slice(centralOffset, endOfCentralDirectory);
  writeUint32(centralDirectory, 42, localOffset);
  return {
    localFile: zip.subarray(0, centralOffset),
    centralDirectory,
  };
}

function buildZipFooter(entryCount: number, centralSize: number, centralOffset: number) {
  const footer = new Uint8Array(22);
  writeUint32(footer, 0, 0x06054b50);
  writeUint16(footer, 8, entryCount);
  writeUint16(footer, 10, entryCount);
  writeUint32(footer, 12, centralSize);
  writeUint32(footer, 16, centralOffset);
  return footer;
}

function readUint32(bytes: Uint8Array, offset: number) {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

function writeUint16(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = value;
  bytes[offset + 1] = value >>> 8;
}

function writeUint32(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = value;
  bytes[offset + 1] = value >>> 8;
  bytes[offset + 2] = value >>> 16;
  bytes[offset + 3] = value >>> 24;
}

export function buildDeterministicPackageZip(entries: ZipEntry[]) {
  const unsafeEntry = entries.find((entry) => !isSafeClawPackagePath(entry.path));
  if (unsafeEntry) {
    throw new Error(`Package contains unsafe package path: ${unsafeEntry.path}`);
  }
  const hierarchyCollision = findClawPackagePathHierarchyCollision(
    entries.map((entry) => entry.path),
  );
  if (hierarchyCollision) {
    throw new Error(
      `Package contains file/ancestor path collision: ${hierarchyCollision.ancestor} and ${hierarchyCollision.descendant}`,
    );
  }
  return buildPackageZip(entries);
}

/**
 * Reconstruct a historical package only for the protected Linux scan worker.
 * Legacy rows can predate portable filename validation, so this keeps their
 * names while retaining the archive traversal and hierarchy protections.
 */
export function buildLegacyPackageScanZip(entries: ZipEntry[]) {
  const unsafeEntry = entries.find((entry) => !isSafeLegacyScanPath(entry.path));
  if (unsafeEntry) {
    throw new Error(`Package contains unsafe legacy scan path: ${unsafeEntry.path}`);
  }
  const hierarchyCollision = findClawPackagePathHierarchyCollision(
    entries.map((entry) => entry.path),
  );
  if (hierarchyCollision) {
    throw new Error(
      `Package contains file/ancestor path collision: ${hierarchyCollision.ancestor} and ${hierarchyCollision.descendant}`,
    );
  }
  return buildPackageZip(entries);
}

function isSafeLegacyScanPath(value: string) {
  if (!value || value.length > 500 || value !== value.trim() || value.startsWith("/")) {
    return false;
  }
  if (value.includes("\\") || value.includes("\0")) return false;
  return value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function buildPackageZip(entries: ZipEntry[]) {
  const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path));
  const zipData: ZipInput = {};

  for (const entry of sorted) {
    zipData[`package/${entry.path}`] = [entry.bytes, { mtime: FIXED_ZIP_DATE }];
  }

  return Uint8Array.from(zipSync(zipData, { level: 6 }));
}

export interface MergedExportManifestEntry {
  publisher: string;
  slug: string;
  sourceRef?: "public-clawhub" | "public-github";
  version: string | null;
  displayName: string;
  createdAt: number;
  updatedAt: number;
  stats: Record<string, unknown> | null;
  fileCount: number;
}

/** Merge multiple skills into a single ZIP. Throws on duplicate paths to prevent silent overwrites. */
export function buildMergedExportZip(
  entries: ZipEntry[],
  manifest: MergedExportManifestEntry[],
): Uint8Array {
  const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path));
  const zipData: ZipInput = {};
  const seenPaths = new Set<string>();

  for (const entry of sorted) {
    if (seenPaths.has(entry.path)) {
      throw new Error(`Duplicate ZIP path detected: "${entry.path}"`);
    }
    seenPaths.add(entry.path);
    zipData[entry.path] = [entry.bytes, { mtime: FIXED_ZIP_DATE }];
  }

  const manifestPath = "_manifest.json";
  if (seenPaths.has(manifestPath)) {
    throw new Error(`Duplicate ZIP path detected: "${manifestPath}" (conflicts with manifest)`);
  }

  const manifestJson = JSON.stringify(manifest, null, 2);
  zipData[manifestPath] = [new TextEncoder().encode(manifestJson), { mtime: FIXED_ZIP_DATE }];

  return Uint8Array.from(zipSync(zipData, { level: 6 }));
}
