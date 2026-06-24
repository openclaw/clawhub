import { zipSync } from "fflate";

type ZipEntry = {
  path: string;
  bytes: Uint8Array;
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

export function buildDeterministicPackageZip(entries: ZipEntry[]) {
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
