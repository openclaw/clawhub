import { zipSync } from 'fflate'

type ZipEntry = {
  path: string
  bytes: Uint8Array
}

export type SkillZipMeta = {
  ownerId: string
  slug: string
  version: string
  publishedAt: number
}

type ZipInput = Record<string, Uint8Array | [Uint8Array, { mtime?: Date }]>

const FIXED_ZIP_DATE = new Date(1980, 0, 1, 0, 0, 0)

export function buildSkillMeta(meta: SkillZipMeta) {
  return {
    ownerId: meta.ownerId,
    slug: meta.slug,
    version: meta.version,
    publishedAt: meta.publishedAt,
  }
}

export function buildDeterministicZip(entries: ZipEntry[], meta?: SkillZipMeta) {
  const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path))
  const zipData: ZipInput = {}

  for (const entry of sorted) {
    zipData[entry.path] = [entry.bytes, { mtime: FIXED_ZIP_DATE }]
  }

  if (meta) {
    const metaContent = new TextEncoder().encode(JSON.stringify(buildSkillMeta(meta), null, 2))
    zipData['_meta.json'] = [metaContent, { mtime: FIXED_ZIP_DATE }]
  }

  return Uint8Array.from(zipSync(zipData, { level: 6 }))
}
