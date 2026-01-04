import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { type Lockfile, LockfileSchema, parseArk, TEXT_FILE_EXTENSION_SET } from 'clawdhub-schema'
import { unzipSync } from 'fflate'
import ignore from 'ignore'
import mime from 'mime'

export async function extractZipToDir(zipBytes: Uint8Array, targetDir: string) {
  const entries = unzipSync(zipBytes)
  await mkdir(targetDir, { recursive: true })
  for (const [rawPath, data] of Object.entries(entries)) {
    const safePath = sanitizeRelPath(rawPath)
    if (!safePath) continue
    const outPath = join(targetDir, safePath)
    await mkdir(dirname(outPath), { recursive: true })
    await writeFile(outPath, data)
  }
}

export async function listTextFiles(root: string) {
  const files: Array<{ relPath: string; bytes: Uint8Array; contentType?: string }> = []
  const absRoot = resolve(root)
  const ig = ignore()
  ig.add(['.git/', 'node_modules/', '.clawdhub/'])
  await addIgnoreFile(ig, join(absRoot, '.gitignore'))
  await addIgnoreFile(ig, join(absRoot, '.clawdhubignore'))

  await walk(absRoot, async (absPath) => {
    const relPath = normalizePath(relative(absRoot, absPath))
    if (!relPath) return
    if (ig.ignores(relPath)) return
    const ext = relPath.split('.').at(-1)?.toLowerCase() ?? ''
    if (!ext || !TEXT_FILE_EXTENSION_SET.has(ext)) return
    const buffer = await readFile(absPath)
    const contentType = mime.getType(relPath) ?? 'text/plain'
    files.push({ relPath, bytes: new Uint8Array(buffer), contentType })
  })
  return files
}

export type SkillFileHash = { path: string; sha256: string; size: number }

export function sha256Hex(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex')
}

export function buildSkillFingerprint(files: Array<{ path: string; sha256: string }>) {
  const normalized = files
    .filter((file) => Boolean(file.path) && Boolean(file.sha256))
    .map((file) => ({ path: file.path, sha256: file.sha256 }))
    .sort((a, b) => a.path.localeCompare(b.path))
  const payload = normalized.map((file) => `${file.path}:${file.sha256}`).join('\n')
  return createHash('sha256').update(payload).digest('hex')
}

export function hashSkillFiles(files: Array<{ relPath: string; bytes: Uint8Array }>) {
  const hashed = files.map((file) => ({
    path: file.relPath,
    sha256: sha256Hex(file.bytes),
    size: file.bytes.byteLength,
  }))
  return { files: hashed, fingerprint: buildSkillFingerprint(hashed) }
}

export function hashSkillZip(zipBytes: Uint8Array) {
  const entries = unzipSync(zipBytes)
  const hashed = Object.entries(entries)
    .map(([rawPath, bytes]) => {
      const safePath = sanitizeZipPath(rawPath)
      if (!safePath) return null
      const ext = safePath.split('.').at(-1)?.toLowerCase() ?? ''
      if (!ext || !TEXT_FILE_EXTENSION_SET.has(ext)) return null
      return { path: safePath, sha256: sha256Hex(bytes), size: bytes.byteLength }
    })
    .filter(Boolean) as SkillFileHash[]

  return { files: hashed, fingerprint: buildSkillFingerprint(hashed) }
}

export async function readLockfile(workdir: string): Promise<Lockfile> {
  const path = join(workdir, '.clawdhub', 'lock.json')
  try {
    const raw = await readFile(path, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    return parseArk(LockfileSchema, parsed, 'Lockfile')
  } catch {
    return { version: 1, skills: {} }
  }
}

export async function writeLockfile(workdir: string, lock: Lockfile) {
  const path = join(workdir, '.clawdhub', 'lock.json')
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(lock, null, 2)}\n`, 'utf8')
}

function normalizePath(path: string) {
  return path
    .split(sep)
    .join('/')
    .replace(/^\.\/+/, '')
}

function sanitizeRelPath(path: string) {
  const normalized = path.replace(/^\.\/+/, '').replace(/^\/+/, '')
  if (!normalized || normalized.endsWith('/')) return null
  if (normalized.includes('..') || normalized.includes('\\')) return null
  return normalized
}

function sanitizeZipPath(path: string) {
  return sanitizeRelPath(path)
}

async function walk(dir: string, onFile: (path: string) => Promise<void>) {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    if (entry.name === 'node_modules') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(full, onFile)
      continue
    }
    if (!entry.isFile()) continue
    await onFile(full)
  }
}

async function addIgnoreFile(ig: ReturnType<typeof ignore>, path: string) {
  try {
    const raw = await readFile(path, 'utf8')
    ig.add(raw.split(/\r?\n/))
  } catch {
    // optional
  }
}
