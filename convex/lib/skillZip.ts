import { findClawPackagePathHierarchyCollision, isSafeClawPackagePath } from "clawhub-schema";
import { Zip, ZipDeflate, zipSync } from "fflate";

type ZipEntry = {
  path: string;
  bytes: Uint8Array;
};

export type AsyncZipEntry = {
  path: string;
  openStream: () => Promise<ReadableStream<Uint8Array> | null>;
};

export type SkillZipMeta = {
  ownerId: string;
  slug: string;
  version: string;
  publishedAt: number;
};

type ZipInput = Record<string, Uint8Array | [Uint8Array, { mtime?: Date }]>;

const FIXED_ZIP_DATE = new Date(1980, 0, 1, 0, 0, 0);
// Storage response chunk boundaries vary with transport backpressure; normalize
// them so identical files still produce byte-for-byte identical archives.
const ZIP_INPUT_CHUNK_BYTES = 64 * 1024;
const MAX_EXPORT_ARCHIVE_PATH_JSON_BYTES = 900;

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
  return validateZipPath(filePath, 500);
}

/** Validate a namespaced bulk-export path (publisher + slug + stored file path). */
export function validateExportArchivePath(filePath: string): boolean {
  if (!validateZipPath(filePath, 900)) return false;
  // The path is repeated in the signed JSON handoff. Bound its encoded form,
  // not UTF-16 code units, so multibyte and escaped names cannot overflow the
  // manifest budget while still passing the character-count guard.
  const encodedJsonBytes = new TextEncoder().encode(JSON.stringify(filePath)).byteLength - 2;
  return encodedJsonBytes <= MAX_EXPORT_ARCHIVE_PATH_JSON_BYTES;
}

function validateZipPath(filePath: string, maxLength: number): boolean {
  if (!filePath || filePath.length > maxLength) return false;
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
  return buildOrderedZipStream(orderZipEntries(entries, meta));
}

export function buildMergedExportZipStream(
  entries: AsyncZipEntry[],
  manifest: MergedExportManifestEntry[],
) {
  const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path));
  const seenPaths = new Set<string>();
  for (const entry of sorted) {
    if (seenPaths.has(entry.path)) {
      throw new Error(`Duplicate ZIP path detected: "${entry.path}"`);
    }
    seenPaths.add(entry.path);
  }
  const manifestPath = "_manifest.json";
  if (seenPaths.has(manifestPath)) {
    throw new Error(`Duplicate ZIP path detected: "${manifestPath}" (conflicts with manifest)`);
  }
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
  return buildOrderedZipStream([
    ...sorted,
    {
      path: manifestPath,
      openStream: async () => bytesToStream(manifestBytes),
    },
  ]);
}

function buildOrderedZipStream(orderedEntries: AsyncZipEntry[]) {
  const output: Uint8Array[] = [];
  let entryIndex = 0;
  let current:
    | {
        reader: ReadableStreamDefaultReader<Uint8Array>;
        zipEntry: ZipDeflate;
        inputBuffer: Uint8Array;
        inputBufferLength: number;
        sourceChunk?: Uint8Array;
        sourceOffset: number;
        sourceDone: boolean;
      }
    | undefined;
  let archiveEnded = false;
  let archiveDone = false;
  let archiveError: unknown;

  const archive = new Zip((error, chunk, final) => {
    if (error) archiveError = error;
    if (chunk?.length) output.push(chunk);
    if (final) archiveDone = true;
  });

  const advance = async () => {
    if (archiveError) throw archiveError;

    if (current) {
      while (current.inputBufferLength < ZIP_INPUT_CHUNK_BYTES && !current.sourceDone) {
        if (!current.sourceChunk || current.sourceOffset === current.sourceChunk.byteLength) {
          const next = await current.reader.read();
          if (next.done) {
            current.sourceDone = true;
            break;
          }
          current.sourceChunk = next.value;
          current.sourceOffset = 0;
          if (next.value.byteLength === 0) continue;
        }

        const sourceBytesRemaining = current.sourceChunk.byteLength - current.sourceOffset;
        const outputBytesRemaining = ZIP_INPUT_CHUNK_BYTES - current.inputBufferLength;
        const bytesToCopy = Math.min(sourceBytesRemaining, outputBytesRemaining);
        current.inputBuffer.set(
          current.sourceChunk.subarray(current.sourceOffset, current.sourceOffset + bytesToCopy),
          current.inputBufferLength,
        );
        current.sourceOffset += bytesToCopy;
        current.inputBufferLength += bytesToCopy;
      }

      if (current.inputBufferLength > 0) {
        current.zipEntry.push(
          current.inputBuffer.subarray(0, current.inputBufferLength),
          current.sourceDone,
        );
        current.inputBuffer = new Uint8Array(ZIP_INPUT_CHUNK_BYTES);
        current.inputBufferLength = 0;
      } else if (current.sourceDone) {
        current.zipEntry.push(new Uint8Array(0), true);
      }
      if (current.sourceDone) {
        current.reader.releaseLock();
        current = undefined;
      }
      if (archiveError) throw archiveError;
      return;
    }

    while (entryIndex < orderedEntries.length) {
      const entry = orderedEntries[entryIndex++];
      const stream = await entry.openStream();
      // A storage reference can become stale after the version document was read.
      // Do not commit a ZIP header until the Blob is known to still exist.
      if (!stream) continue;

      const zipEntry = new ZipDeflate(entry.path, { level: 6 });
      zipEntry.mtime = FIXED_ZIP_DATE;
      archive.add(zipEntry);
      current = {
        reader: stream.getReader(),
        zipEntry,
        inputBuffer: new Uint8Array(ZIP_INPUT_CHUNK_BYTES),
        inputBufferLength: 0,
        sourceOffset: 0,
        sourceDone: false,
      };
      return;
    }

    if (!archiveEnded) {
      archiveEnded = true;
      archive.end();
      if (archiveError) throw archiveError;
    }
  };

  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          for (;;) {
            if (output.length > 0 || archiveDone) break;
            await advance();
          }
          const chunk = output.shift();
          if (chunk) controller.enqueue(chunk);
          else controller.close();
        } catch (error) {
          archive.terminate();
          await current?.reader.cancel(error);
          controller.error(error);
        }
      },
      async cancel(reason) {
        archive.terminate();
        await current?.reader.cancel(reason);
      },
    },
    { highWaterMark: 0 },
  );
}

function bytesToStream(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
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
      openStream: async () => bytesToStream(metaBytes),
    });
    zipDataOrder["_meta.json"] = true;
  }

  return Object.keys(zipDataOrder).map((path) => byPath.get(path)!);
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
