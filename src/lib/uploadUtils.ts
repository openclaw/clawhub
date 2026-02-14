import { isTextContentType, TEXT_FILE_EXTENSION_SET } from 'clawhub-schema'

export async function uploadFile(uploadUrl: string, file: File) {
  const response = await fetch(uploadUrl, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  })
  if (!response.ok) {
    throw new Error(`Upload failed: ${await response.text()}`)
  }
  const payload = (await response.json()) as { storageId: string }
  return payload.storageId
}

export async function hashFile(file: File) {
  const buffer =
    typeof file.arrayBuffer === 'function'
      ? await file.arrayBuffer()
      : await new Response(file).arrayBuffer()
  const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(buffer))
  const bytes = new Uint8Array(hash)
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes)) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let size = bytes
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${size.toFixed(size < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`
}

export function formatPublishError(error: unknown) {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = (error as { data?: unknown }).data
    if (typeof data === 'string' && data.trim()) return data.trim()
    if (
      data &&
      typeof data === 'object' &&
      'message' in data &&
      typeof (data as { message?: unknown }).message === 'string'
    ) {
      const message = (data as { message?: string }).message?.trim()
      if (message) return message
    }
  }
  if (error instanceof Error) {
    const cleaned = error.message
      .replace(/\[CONVEX[^\]]*\]\s*/g, '')
      .replace(/\[Request ID:[^\]]*\]\s*/g, '')
      .replace(/^ConvexError:\s*/i, '')
      .replace(/^Server Error Called by client\s*/i, '')
      .trim()
    if (cleaned && cleaned !== 'Server Error') return cleaned
  }
  return 'Publish failed. Please try again.'
}

export function isTextFile(file: File) {
  const path = (file.webkitRelativePath || file.name).trim().toLowerCase()
  if (!path) return false
  const parts = path.split('.')
  const extension = parts.length > 1 ? (parts.at(-1) ?? '') : ''
  if (file.type && isTextContentType(file.type)) return true
  if (extension && TEXT_FILE_EXTENSION_SET.has(extension)) return true
  return false
}

export async function readText(blob: Blob) {
  if (typeof (blob as Blob & { text?: unknown }).text === 'function') {
    return (blob as Blob & { text: () => Promise<string> }).text()
  }
  if (typeof (blob as Blob & { arrayBuffer?: unknown }).arrayBuffer === 'function') {
    const buffer = await (blob as Blob & { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer()
    return new TextDecoder().decode(new Uint8Array(buffer))
  }
  if (typeof FileReader !== 'undefined' && blob instanceof Blob) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.addEventListener('error', () => {
        reject(reader.error ?? new Error('Could not read blob.'))
      })
      reader.addEventListener('load', () => {
        resolve(typeof reader.result === 'string' ? reader.result : '')
      })
      reader.readAsText(blob)
    })
  }
  return new Response(blob as BodyInit).text()
}
