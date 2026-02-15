import { CliPublishRequestSchema, parseArk } from 'clawhub-schema'
import { internal } from '../_generated/api'
import type { Doc, Id } from '../_generated/dataModel'
import type { ActionCtx } from '../_generated/server'
import { assertAdmin } from '../lib/access'
import { requireApiTokenUser } from '../lib/apiTokenAuth'
import { corsHeaders, mergeHeaders } from '../lib/httpHeaders'

export const MAX_RAW_FILE_BYTES = 200 * 1024

export function json(value: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(value), {
    status,
    headers: mergeHeaders(
      {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
      headers,
      corsHeaders(),
    ),
  })
}

export function text(value: string, status: number, headers?: HeadersInit) {
  return new Response(value, {
    status,
    headers: mergeHeaders(
      {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      },
      headers,
      corsHeaders(),
    ),
  })
}

export async function parseJsonPayload(request: Request, headers: HeadersInit) {
  try {
    const payload = (await request.json()) as Record<string, unknown>
    return { ok: true as const, payload }
  } catch {
    return { ok: false as const, response: text('Invalid JSON', 400, headers) }
  }
}

export async function requireApiTokenUserOrResponse(
  ctx: ActionCtx,
  request: Request,
  headers: HeadersInit,
) {
  try {
    const auth = await requireApiTokenUser(ctx, request)
    return { ok: true as const, userId: auth.userId, user: auth.user as Doc<'users'> }
  } catch {
    return { ok: false as const, response: text('Unauthorized', 401, headers) }
  }
}

export function requireAdminOrResponse(user: Doc<'users'>, headers: HeadersInit) {
  try {
    assertAdmin(user)
    return { ok: true as const }
  } catch {
    return { ok: false as const, response: text('Forbidden', 403, headers) }
  }
}

export function getPathSegments(request: Request, prefix: string) {
  const pathname = new URL(request.url).pathname
  if (!pathname.startsWith(prefix)) return []
  const rest = pathname.slice(prefix.length)
  return rest
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment))
}

export function toOptionalNumber(value: string | null) {
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * Batch resolve soul version tags to version strings.
 * Collects all version IDs, fetches them in a single query, then maps back.
 * Reduces N sequential queries to 1 batch query.
 */
export async function resolveSoulTagsBatch(
  ctx: ActionCtx,
  tagsList: Array<Record<string, Id<'soulVersions'>>>,
): Promise<Array<Record<string, string>>> {
  return resolveVersionTagsBatch(ctx, tagsList, internal.souls.getVersionsByIdsInternal)
}

export async function resolveTagsBatch(
  ctx: ActionCtx,
  tagsList: Array<Record<string, Id<'skillVersions'>>>,
): Promise<Array<Record<string, string>>> {
  return resolveVersionTagsBatch(ctx, tagsList, internal.skills.getVersionsByIdsInternal)
}

/**
 * Batch resolve version tags to version strings.
 * Collects all version IDs, fetches them in a single query, then maps back.
 *
 * Notes:
 * - Uses `internal.*` queries to avoid expanding the public Convex API surface.
 * - Sorts ids for stable query args (helps caching/log diffs).
 */
export async function resolveVersionTagsBatch<TTable extends 'skillVersions' | 'soulVersions'>(
  ctx: ActionCtx,
  tagsList: Array<Record<string, Id<TTable>>>,
  getVersionsByIdsQuery: unknown,
): Promise<Array<Record<string, string>>> {
  const allVersionIds = new Set<Id<TTable>>()
  for (const tags of tagsList) {
    for (const versionId of Object.values(tags)) allVersionIds.add(versionId)
  }

  if (allVersionIds.size === 0) return tagsList.map(() => ({}))

  const versionIds = [...allVersionIds].sort() as Array<Id<TTable>>
  const versions =
    ((await ctx.runQuery(getVersionsByIdsQuery as never, { versionIds } as never)) as Array<{
      _id: Id<TTable>
      version: string
      softDeletedAt?: unknown
    }> | null) ?? []

  const versionMap = new Map<Id<TTable>, string>()
  for (const v of versions) {
    if (!v?.softDeletedAt) versionMap.set(v._id, v.version)
  }

  return tagsList.map((tags) => {
    const resolved: Record<string, string> = {}
    for (const [tag, versionId] of Object.entries(tags)) {
      const version = versionMap.get(versionId)
      if (version) resolved[tag] = version
    }
    return resolved
  })
}

async function sha256Hex(bytes: Uint8Array) {
  const data = new Uint8Array(bytes)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return toHex(new Uint8Array(digest))
}

function toHex(bytes: Uint8Array) {
  let out = ''
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0')
  return out
}

type FileLike = {
  name: string
  size: number
  type: string
  arrayBuffer: () => Promise<ArrayBuffer>
}

type FileLikeEntry = FormDataEntryValue & FileLike

function toFileLike(entry: FormDataEntryValue): FileLikeEntry | null {
  if (typeof entry === 'string') return null
  const candidate = entry as Partial<FileLike>
  if (typeof candidate.name !== 'string') return null
  if (typeof candidate.size !== 'number') return null
  if (typeof candidate.arrayBuffer !== 'function') return null
  return entry as FileLikeEntry
}

export async function parseMultipartPublish(
  ctx: ActionCtx,
  request: Request,
): Promise<{
  slug: string
  displayName: string
  version: string
  changelog: string
  tags?: string[]
  forkOf?: { slug: string; version?: string }
  files: Array<{
    path: string
    size: number
    storageId: Id<'_storage'>
    sha256: string
    contentType?: string
  }>
}> {
  const form = await request.formData()
  const payloadRaw = form.get('payload')
  if (!payloadRaw || typeof payloadRaw !== 'string') {
    throw new Error('Missing payload')
  }
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(payloadRaw) as Record<string, unknown>
  } catch {
    throw new Error('Invalid JSON payload')
  }

  const files: Array<{
    path: string
    size: number
    storageId: Id<'_storage'>
    sha256: string
    contentType?: string
  }> = []

  for (const entry of form.getAll('files')) {
    const file = toFileLike(entry)
    if (!file) continue
    const path = file.name
    const size = file.size
    const contentType = file.type || undefined
    const buffer = new Uint8Array(await file.arrayBuffer())
    const sha256 = await sha256Hex(buffer)
    const storageId = await ctx.storage.store(file as Blob)
    files.push({ path, size, storageId, sha256, contentType })
  }

  const forkOf = payload.forkOf && typeof payload.forkOf === 'object' ? payload.forkOf : undefined
  const body = {
    slug: payload.slug,
    displayName: payload.displayName,
    version: payload.version,
    changelog: typeof payload.changelog === 'string' ? payload.changelog : '',
    tags: Array.isArray(payload.tags) ? payload.tags : undefined,
    ...(payload.source ? { source: payload.source } : {}),
    files,
    ...(forkOf ? { forkOf } : {}),
  }

  return parsePublishBody(body)
}

export function parsePublishBody(body: unknown) {
  const parsed = parseArk(CliPublishRequestSchema, body, 'Publish payload')
  if (parsed.files.length === 0) throw new Error('files required')
  const tags = parsed.tags && parsed.tags.length > 0 ? parsed.tags : undefined
  return {
    slug: parsed.slug,
    displayName: parsed.displayName,
    version: parsed.version,
    changelog: parsed.changelog,
    tags,
    source: parsed.source ?? undefined,
    forkOf: parsed.forkOf
      ? {
          slug: parsed.forkOf.slug,
          version: parsed.forkOf.version ?? undefined,
        }
      : undefined,
    files: parsed.files.map((file) => ({
      ...file,
      storageId: file.storageId as Id<'_storage'>,
    })),
  }
}

export function softDeleteErrorToResponse(
  entity: 'skill' | 'soul',
  error: unknown,
  headers: HeadersInit,
) {
  const message = error instanceof Error ? error.message : `${entity} delete failed`
  const lower = message.toLowerCase()

  if (lower.includes('unauthorized')) return text('Unauthorized', 401, headers)
  if (lower.includes('forbidden')) return text('Forbidden', 403, headers)
  if (lower.includes('not found')) return text(message, 404, headers)
  if (lower.includes('slug required')) return text('Slug required', 400, headers)

  // Unknown: server-side failure. Keep body generic.
  return text('Internal Server Error', 500, headers)
}
