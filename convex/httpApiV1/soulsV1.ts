import { api, internal } from '../_generated/api'
import type { Doc, Id } from '../_generated/dataModel'
import type { ActionCtx } from '../_generated/server'
import { requireApiTokenUser } from '../lib/apiTokenAuth'
import { applyRateLimit, parseBearerToken } from '../lib/httpRateLimit'
import { corsHeaders, mergeHeaders } from '../lib/httpHeaders'
import { publishSoulVersionForUser } from '../souls'
import {
  MAX_RAW_FILE_BYTES,
  getPathSegments,
  json,
  parseMultipartPublish,
  parsePublishBody,
  resolveSoulTagsBatch,
  softDeleteErrorToResponse,
  text,
  toOptionalNumber,
} from './shared'

type ListSoulsResult = {
  items: Array<{
    soul: {
      _id: Id<'souls'>
      slug: string
      displayName: string
      summary?: string
      tags: Record<string, Id<'soulVersions'>>
      stats: unknown
      createdAt: number
      updatedAt: number
      latestVersionId?: Id<'soulVersions'>
    }
    latestVersion: { version: string; createdAt: number; changelog: string } | null
  }>
  nextCursor: string | null
}

type GetSoulBySlugResult = {
  soul: {
    _id: Id<'souls'>
    slug: string
    displayName: string
    summary?: string
    tags: Record<string, Id<'soulVersions'>>
    stats: unknown
    createdAt: number
    updatedAt: number
  } | null
  latestVersion: Doc<'soulVersions'> | null
  owner: { handle?: string; displayName?: string; image?: string } | null
} | null

type ListSoulVersionsResult = {
  items: Array<{
    version: string
    createdAt: number
    changelog: string
    changelogSource?: 'auto' | 'user'
    files: Array<{
      path: string
      size: number
      storageId: Id<'_storage'>
      sha256: string
      contentType?: string
    }>
    softDeletedAt?: number
  }>
  nextCursor: string | null
}

type SoulFile = Doc<'soulVersions'>['files'][number]

export async function listSoulsV1Handler(ctx: ActionCtx, request: Request) {
  const rate = await applyRateLimit(ctx, request, 'read')
  if (!rate.ok) return rate.response

  const url = new URL(request.url)
  const limit = toOptionalNumber(url.searchParams.get('limit'))
  const cursor = url.searchParams.get('cursor')?.trim() || undefined

  const result = (await ctx.runQuery(api.souls.listPublicPage, {
    limit,
    cursor,
  })) as ListSoulsResult

  // Batch resolve all tags in a single query instead of N queries
  const resolvedTagsList = await resolveSoulTagsBatch(
    ctx,
    result.items.map((item) => item.soul.tags),
  )

  const items = result.items.map((item, idx) => ({
    slug: item.soul.slug,
    displayName: item.soul.displayName,
    summary: item.soul.summary ?? null,
    tags: resolvedTagsList[idx],
    stats: item.soul.stats,
    createdAt: item.soul.createdAt,
    updatedAt: item.soul.updatedAt,
    latestVersion: item.latestVersion
      ? {
          version: item.latestVersion.version,
          createdAt: item.latestVersion.createdAt,
          changelog: item.latestVersion.changelog,
        }
      : null,
  }))

  return json({ items, nextCursor: result.nextCursor ?? null }, 200, rate.headers)
}

export async function soulsGetRouterV1Handler(ctx: ActionCtx, request: Request) {
  const rate = await applyRateLimit(ctx, request, 'read')
  if (!rate.ok) return rate.response

  const segments = getPathSegments(request, '/api/v1/souls/')
  if (segments.length === 0) return text('Missing slug', 400, rate.headers)
  const slug = segments[0]?.trim().toLowerCase() ?? ''
  const second = segments[1]
  const third = segments[2]

  if (segments.length === 1) {
    const result = (await ctx.runQuery(api.souls.getBySlug, { slug })) as GetSoulBySlugResult
    if (!result?.soul) return text('Soul not found', 404, rate.headers)

    const [tags] = await resolveSoulTagsBatch(ctx, [result.soul.tags])
    return json(
      {
        soul: {
          slug: result.soul.slug,
          displayName: result.soul.displayName,
          summary: result.soul.summary ?? null,
          tags,
          stats: result.soul.stats,
          createdAt: result.soul.createdAt,
          updatedAt: result.soul.updatedAt,
        },
        latestVersion: result.latestVersion
          ? {
              version: result.latestVersion.version,
              createdAt: result.latestVersion.createdAt,
              changelog: result.latestVersion.changelog,
            }
          : null,
        owner: result.owner
          ? {
              handle: result.owner.handle ?? null,
              displayName: result.owner.displayName ?? null,
              image: result.owner.image ?? null,
            }
          : null,
      },
      200,
      rate.headers,
    )
  }

  if (second === 'versions' && segments.length === 2) {
    const soul = await ctx.runQuery(internal.souls.getSoulBySlugInternal, { slug })
    if (!soul || soul.softDeletedAt) return text('Soul not found', 404, rate.headers)

    const url = new URL(request.url)
    const limit = toOptionalNumber(url.searchParams.get('limit'))
    const cursor = url.searchParams.get('cursor')?.trim() || undefined
    const result = (await ctx.runQuery(api.souls.listVersionsPage, {
      soulId: soul._id,
      limit,
      cursor,
    })) as ListSoulVersionsResult

    const items = result.items
      .filter((version) => !version.softDeletedAt)
      .map((version) => ({
        version: version.version,
        createdAt: version.createdAt,
        changelog: version.changelog,
        changelogSource: version.changelogSource ?? null,
      }))

    return json({ items, nextCursor: result.nextCursor ?? null }, 200, rate.headers)
  }

  if (second === 'versions' && third && segments.length === 3) {
    const soul = await ctx.runQuery(internal.souls.getSoulBySlugInternal, { slug })
    if (!soul || soul.softDeletedAt) return text('Soul not found', 404, rate.headers)

    const version = await ctx.runQuery(api.souls.getVersionBySoulAndVersion, {
      soulId: soul._id,
      version: third,
    })
    if (!version) return text('Version not found', 404, rate.headers)
    if (version.softDeletedAt) return text('Version not available', 410, rate.headers)

    return json(
      {
        soul: { slug: soul.slug, displayName: soul.displayName },
        version: {
          version: version.version,
          createdAt: version.createdAt,
          changelog: version.changelog,
          changelogSource: version.changelogSource ?? null,
          files: version.files.map((file: SoulFile) => ({
            path: file.path,
            size: file.size,
            sha256: file.sha256,
            contentType: file.contentType ?? null,
          })),
        },
      },
      200,
      rate.headers,
    )
  }

  if (second === 'file' && segments.length === 2) {
    const url = new URL(request.url)
    const path = url.searchParams.get('path')?.trim()
    if (!path) return text('Missing path', 400, rate.headers)
    const versionParam = url.searchParams.get('version')?.trim()
    const tagParam = url.searchParams.get('tag')?.trim()

    const soulResult = (await ctx.runQuery(api.souls.getBySlug, { slug })) as GetSoulBySlugResult
    if (!soulResult?.soul) return text('Soul not found', 404, rate.headers)

    let version = soulResult.latestVersion
    if (versionParam) {
      version = await ctx.runQuery(api.souls.getVersionBySoulAndVersion, {
        soulId: soulResult.soul._id,
        version: versionParam,
      })
    } else if (tagParam) {
      const versionId = soulResult.soul.tags[tagParam]
      if (versionId) {
        version = await ctx.runQuery(api.souls.getVersionById, { versionId })
      }
    }

    if (!version) return text('Version not found', 404, rate.headers)
    if (version.softDeletedAt) return text('Version not available', 410, rate.headers)

    const normalized = path.trim()
    const normalizedLower = normalized.toLowerCase()
    const file =
      version.files.find((entry) => entry.path === normalized) ??
      version.files.find((entry) => entry.path.toLowerCase() === normalizedLower)
    if (!file) return text('File not found', 404, rate.headers)
    if (file.size > MAX_RAW_FILE_BYTES) return text('File exceeds 200KB limit', 413, rate.headers)

    const blob = await ctx.storage.get(file.storageId)
    if (!blob) return text('File missing in storage', 410, rate.headers)
    const textContent = await blob.text()

    void ctx.runMutation(api.soulDownloads.increment, { soulId: soulResult.soul._id })

    const isSvg =
      file.contentType?.toLowerCase().includes('svg') || file.path.toLowerCase().endsWith('.svg')

    const headers = mergeHeaders(
      rate.headers,
      {
        'Content-Type': file.contentType
          ? `${file.contentType}; charset=utf-8`
          : 'text/plain; charset=utf-8',
        'Cache-Control': 'private, max-age=60',
        ETag: file.sha256,
        'X-Content-SHA256': file.sha256,
        'X-Content-Size': String(file.size),
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Content-Security-Policy':
          "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        ...(isSvg ? { 'Content-Disposition': 'attachment' } : {}),
      },
      corsHeaders(),
    )
    return new Response(textContent, { status: 200, headers })
  }

  return text('Not found', 404, rate.headers)
}

export async function publishSoulV1Handler(ctx: ActionCtx, request: Request) {
  const rate = await applyRateLimit(ctx, request, 'write')
  if (!rate.ok) return rate.response

  try {
    if (!parseBearerToken(request)) return text('Unauthorized', 401, rate.headers)
  } catch {
    return text('Unauthorized', 401, rate.headers)
  }
  const { userId } = await requireApiTokenUser(ctx, request)

  const contentType = request.headers.get('content-type') ?? ''
  try {
    if (contentType.includes('application/json')) {
      const body = await request.json()
      const payload = parsePublishBody(body)
      const result = await publishSoulVersionForUser(ctx, userId, payload)
      return json({ ok: true, ...result }, 200, rate.headers)
    }

    if (contentType.includes('multipart/form-data')) {
      const payload = await parseMultipartPublish(ctx, request)
      const result = await publishSoulVersionForUser(ctx, userId, payload)
      return json({ ok: true, ...result }, 200, rate.headers)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Publish failed'
    return text(message, 400, rate.headers)
  }

  return text('Unsupported content type', 415, rate.headers)
}

export async function soulsPostRouterV1Handler(ctx: ActionCtx, request: Request) {
  const rate = await applyRateLimit(ctx, request, 'write')
  if (!rate.ok) return rate.response

  const segments = getPathSegments(request, '/api/v1/souls/')
  if (segments.length !== 2 || segments[1] !== 'undelete') {
    return text('Not found', 404, rate.headers)
  }
  const slug = segments[0]?.trim().toLowerCase() ?? ''
  try {
    const { userId } = await requireApiTokenUser(ctx, request)
    await ctx.runMutation(internal.souls.setSoulSoftDeletedInternal, {
      userId,
      slug,
      deleted: false,
    })
    return json({ ok: true }, 200, rate.headers)
  } catch (error) {
    return softDeleteErrorToResponse('soul', error, rate.headers)
  }
}

export async function soulsDeleteRouterV1Handler(ctx: ActionCtx, request: Request) {
  const rate = await applyRateLimit(ctx, request, 'write')
  if (!rate.ok) return rate.response

  const segments = getPathSegments(request, '/api/v1/souls/')
  if (segments.length !== 1) return text('Not found', 404, rate.headers)
  const slug = segments[0]?.trim().toLowerCase() ?? ''
  try {
    const { userId } = await requireApiTokenUser(ctx, request)
    await ctx.runMutation(internal.souls.setSoulSoftDeletedInternal, {
      userId,
      slug,
      deleted: true,
    })
    return json({ ok: true }, 200, rate.headers)
  } catch (error) {
    return softDeleteErrorToResponse('soul', error, rate.headers)
  }
}
