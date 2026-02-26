import { TEXT_FILE_EXTENSION_SET } from 'clawhub-schema'
import { gunzipSync, unzipSync } from 'fflate'

const TEXT_TYPES = new Map([
  ['md', 'text/markdown'],
  ['markdown', 'text/markdown'],
  ['txt', 'text/plain'],
  ['json', 'application/json'],
  ['yaml', 'text/yaml'],
  ['yml', 'text/yaml'],
  ['toml', 'text/plain'],
  ['js', 'text/javascript'],
  ['ts', 'text/plain'],
  ['tsx', 'text/plain'],
  ['jsx', 'text/plain'],
  ['css', 'text/css'],
  ['html', 'text/html'],
  ['svg', 'image/svg+xml'],
])

export type ExpandFilesReport = {
  files: File[]
  ignoredMacJunkPaths: string[]
}

export async function expandFilesWithReport(selected: File[]): Promise<ExpandFilesReport> {
  const expanded: File[] = []
  const ignoredMacJunkPaths: string[] = []
  for (const file of selected) {
    const lower = file.name.toLowerCase()
    if (lower.endsWith('.zip')) {
      const entries = unzipSync(new Uint8Array(await readArrayBuffer(file)))
      pushArchiveEntries(
        expanded,
        ignoredMacJunkPaths,
        Object.entries(entries).map(([path, data]) => ({ path, data })),
      )
      continue
    }
    if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
      const unpacked = gunzipSync(new Uint8Array(await readArrayBuffer(file)))
      pushArchiveEntries(expanded, ignoredMacJunkPaths, untar(unpacked))
      continue
    }
    if (lower.endsWith('.gz')) {
      const unpacked = gunzipSync(new Uint8Array(await readArrayBuffer(file)))
      const name = file.name.replace(/\.gz$/i, '')
      const normalizedName = normalizePath(name)
      if (isMacJunkPath(normalizedName)) {
        ignoredMacJunkPaths.push(normalizedName || name)
        continue
      }
      expanded.push(new File([toArrayBuffer(unpacked)], name, { type: guessContentType(name) }))
      continue
    }
    const path = getFilePath(file)
    if (path && isMacJunkPath(path)) {
      ignoredMacJunkPaths.push(path)
      continue
    }
    expanded.push(file)
  }
  return { files: expanded, ignoredMacJunkPaths }
}

export async function expandFiles(selected: File[]) {
  const report = await expandFilesWithReport(selected)
  return report.files
}

export async function expandDroppedItems(items: DataTransferItemList | null) {
  if (!items || items.length === 0) return []
  const dropped: File[] = []
  const entries: FileSystemEntry[] = []

  for (const item of Array.from(items)) {
    const entry = (item as WebkitDataTransferItem).webkitGetAsEntry?.()
    if (entry) {
      entries.push(entry)
      continue
    }
    const file = item.getAsFile()
    if (file) dropped.push(file)
  }

  if (entries.length === 0) return dropped

  for (const entry of entries) {
    await collectEntry(entry, '', dropped)
  }

  return dropped
}

async function collectEntry(entry: FileSystemEntry, parentPath: string, files: File[]) {
  if (entry.isFile && entry.file) {
    const file = await new Promise<File>((resolve, reject) => {
      entry.file?.(resolve, reject)
    })
    const fullPath = entry.fullPath?.replace(/^\/+/, '')
    const path = fullPath || (parentPath ? `${parentPath}/${file.name}` : file.name)
    files.push(new File([file], path, { type: file.type, lastModified: file.lastModified }))
    return
  }

  if (!entry.isDirectory || !entry.createReader) return

  const basePath =
    entry.fullPath?.replace(/^\/+/, '') || (parentPath ? `${parentPath}/${entry.name}` : entry.name)
  const reader = entry.createReader()
  const children = await readAllEntries(reader)
  for (const child of children) {
    await collectEntry(child, basePath, files)
  }
}

async function readAllEntries(reader: FileSystemDirectoryReader) {
  const entries: FileSystemEntry[] = []
  while (true) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject)
    })
    if (batch.length === 0) break
    entries.push(...batch)
  }
  return entries
}

function pushArchiveEntries(
  target: File[],
  ignoredMacJunkPaths: string[],
  entries: Array<{ path: string; data: Uint8Array }>,
) {
  const normalized: Array<{ path: string; data: Uint8Array }> = []

  for (const entry of entries) {
    const path = normalizePath(entry.path)
    if (!path || path.endsWith('/')) continue
    if (isMacJunkPath(path)) {
      ignoredMacJunkPaths.push(path)
      continue
    }
    if (!isTextPath(path)) continue
    normalized.push({ path, data: entry.data })
  }

  const unwrapped = unwrapSingleTopLevelFolder(normalized)

  for (const entry of unwrapped) {
    target.push(
      new File([toArrayBuffer(entry.data)], entry.path, {
        type: guessContentType(entry.path),
      }),
    )
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = bytes.buffer
  if (buffer instanceof ArrayBuffer) {
    return buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  }
  return Uint8Array.from(bytes).buffer
}

async function readArrayBuffer(file: Blob) {
  if (typeof file.arrayBuffer === 'function') {
    return file.arrayBuffer()
  }
  if (typeof FileReader !== 'undefined') {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader()
      reader.addEventListener('error', () => {
        reject(reader.error ?? new Error('Could not read file.'))
      })
      reader.addEventListener('load', () => {
        resolve(reader.result as ArrayBuffer)
      })
      reader.readAsArrayBuffer(file)
    })
  }
  return new Response(file as BodyInit).arrayBuffer()
}

function guessContentType(path: string) {
  const ext = path.split('.').pop()?.toLowerCase()
  if (!ext) return 'application/octet-stream'
  const known = TEXT_TYPES.get(ext)
  if (known) return known
  if (TEXT_FILE_EXTENSION_SET.has(ext)) return 'text/plain'
  return 'application/octet-stream'
}

function normalizePath(path: string) {
  return path
    .replaceAll('\u0000', '')
    .replaceAll('\\', '/')
    .trim()
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '')
}

function getFilePath(file: File) {
  const rawPath = file.webkitRelativePath?.trim() ? file.webkitRelativePath : file.name
  return normalizePath(rawPath)
}

function untar(bytes: Uint8Array) {
  const entries: Array<{ path: string; data: Uint8Array }> = []
  let offset = 0
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break
    const name = readString(header.subarray(0, 100))
    const size = readOctal(header.subarray(124, 136))
    const typeflag = header[156]
    offset += 512
    const data = bytes.subarray(offset, offset + size)
    offset += Math.ceil(size / 512) * 512
    if (!name || typeflag === 53) continue
    entries.push({ path: name, data })
  }
  return entries
}

function readString(bytes: Uint8Array) {
  const end = bytes.indexOf(0)
  const slice = end === -1 ? bytes : bytes.subarray(0, end)
  return new TextDecoder().decode(slice).trim()
}

function readOctal(bytes: Uint8Array) {
  const raw = readString(bytes)
  return raw ? Number.parseInt(raw, 8) : 0
}

function unwrapSingleTopLevelFolder<T extends { path: string }>(entries: T[]) {
  if (entries.length === 0) return entries

  const segments = entries.map((entry) => entry.path.split('/').filter(Boolean))
  if (segments.some((parts) => parts.length < 2)) return entries

  const first = segments[0]?.[0]
  if (!first) return entries
  if (!segments.every((parts) => parts[0] === first)) return entries

  return entries.map((entry) => ({
    ...entry,
    path: entry.path.split('/').slice(1).join('/'),
  }))
}

function isMacJunkPath(path: string) {
  const normalized = normalizePath(path).toLowerCase()
  if (!normalized) return false
  const segments = normalized.split('/').filter(Boolean)
  if (segments.includes('__macosx')) return true
  const basename = segments.at(-1) ?? ''
  if (basename === '.ds_store') return true
  if (basename.startsWith('._')) return true
  return false
}

function isTextPath(path: string) {
  const normalized = path.trim().toLowerCase()
  const parts = normalized.split('.')
  const extension = parts.length > 1 ? (parts.at(-1) ?? '') : ''
  if (!extension) return false
  return TEXT_FILE_EXTENSION_SET.has(extension)
}

type WebkitDataTransferItem = DataTransferItem & {
  webkitGetAsEntry?: () => FileSystemEntry | null
}

type FileSystemEntry = {
  isFile: boolean
  isDirectory: boolean
  name: string
  fullPath?: string
  file?: (callback: (file: File) => void, errorCallback?: (error: DOMException) => void) => void
  createReader?: () => FileSystemDirectoryReader
}

type FileSystemDirectoryReader = {
  readEntries: (
    callback: (entries: FileSystemEntry[]) => void,
    errorCallback?: (error: DOMException) => void,
  ) => void
}
