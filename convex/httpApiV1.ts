import { CliPublishRequestSchema, parseArk } from 'clawhub-schema'
import { api, internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import type { ActionCtx } from './_generated/server'
import { httpAction } from './_generated/server'
import { getOptionalApiTokenUserId, requireApiTokenUser } from './lib/apiTokenAuth'
import { applyRateLimit, parseBearerToken } from './lib/httpRateLimit'
import { corsHeaders, mergeHeaders } from './lib/httpHeaders'
import { publishVersionForUser } from './skills'
import { publishSoulVersionForUser } from './souls'

const MAX_RAW_FILE_BYTES = 200 * 1024

type SearchSkillEntry = {
  score: number
  skill: {
    slug?: string
    displayName?: string
    summary?: string | null
    updatedAt?: number
  } | null
  version: { version?: string; createdAt?: number } | null
}

type ListSkillsResult = {
  items: Array<{
    skill: {
      _id: Id<'skills'>
      slug: string
      displayName: string
      summary?: string
      tags: Record<string, Id<'skillVersions'>>
      stats: unknown
      createdAt: number
      updatedAt: number
      latestVersionId?: Id<'skillVersions'>
    }
    latestVersion: { version: string; createdAt: number; changelog: string } | null
  }>
  nextCursor: string | null
}

type SkillFile = Doc<'skillVersions'>['files'][number]
type SoulFile = Doc<'soulVersions'>['files'][number]

type GetBySlugResult = {
  skill: {
    _id: Id<'skills'>
    slug: string
    displayName: string
    summary?: string
    tags: Record<string, Id<'skillVersions'>>
    stats: unknown
    createdAt: number
    updatedAt: number
  } | null
  latestVersion: Doc<'skillVersions'> | null
  owner: { _id: Id<'users'>; handle?: string; displayName?: string; image?: string } | null
  moderationInfo?: {
    isPendingScan: boolean
    isMalwareBlocked: boolean
    isSuspicious: boolean
    isHiddenByMod: boolean
    isRemoved: boolean
    reason?: string
  } | null
} | null

type ListVersionsResult = {
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

async function searchSkillsV1Handler(ctx: ActionCtx, request: Request) {
  const rate = await applyRateLimit(ctx, request, 'read')
  if (!rate.ok) return rate.response

  const url = new URL(request.url)
  const query = url.searchParams.get('q')?.trim() ?? ''
  const limit = toOptionalNumber(url.searchParams.get('limit'))
  const highlightedOnly = url.searchParams.get('highlightedOnly') === 'true'

  if (!query) return json({ results: [] }, 200, rate.headers)

  const results = (await ctx.runAction(api.search.searchSkills, {
    query,
    limit,
    highlightedOnly: highlightedOnly || undefined,
  })) as SearchSkillEntry[]

  return json(
    {
      results: results.map((result) => ({
        score: result.score,
        slug: result.skill?.slug,
        displayName: result.skill?.displayName,
        summary: result.skill?.summary ?? null,
        version: result.version?.version ?? null,
        updatedAt: result.skill?.updatedAt,
      })),
    },
    200,
    rate.headers,
  )
}

export const searchSkillsV1Http = httpAction(searchSkillsV1Handler)

async function resolveSkillVersionV1Handler(ctx: ActionCtx, request: Request) {
  const rate = await applyRateLimit(ctx, request, 'read')
  if (!rate.ok) return rate.response

  const url = new URL(request.url)
  const slug = url.searchParams.get('slug')?.trim().toLowerCase()
  const hash = url.searchParams.get('hash')?.trim().toLowerCase()
  if (!slug || !hash) return text('Missing slug or hash', 400, rate.headers)
  if (!/^[a-f0-9]{64}$/.test(hash)) return text('Invalid hash', 400, rate.headers)

  const resolved = await ctx.runQuery(api.skills.resolveVersionByHash, { slug, hash })
  if (!resolved) return text('Skill not found', 404, rate.headers)

  return json(
    { slug, match: resolved.match, latestVersion: resolved.latestVersion },
    200,
    rate.headers,
  )
}

export const resolveSkillVersionV1Http = httpAction(resolveSkillVersionV1Handler)

async function listSkillsV1Handler(ctx: ActionCtx, request: Request) {
  const rate = await applyRateLimit(ctx, request, 'read')
  if (!rate.ok) return rate.response

  const url = new URL(request.url)
  const limit = toOptionalNumber(url.searchParams.get('limit'))
  const rawCursor = url.searchParams.get('cursor')?.trim() || undefined
  const sort = parseListSort(url.searchParams.get('sort'))
  const cursor = sort === 'trending' ? undefined : rawCursor

  const result = (await ctx.runQuery(api.skills.listPublicPage, {
    limit,
    cursor,
    sort,
  })) as ListSkillsResult

  // Batch resolve all tags in a single query instead of N queries
  const resolvedTagsList = await resolveTagsBatch(
    ctx,
    result.items.map((item) => item.skill.tags),
  )

  const items = result.items.map((item, idx) => ({
    slug: item.skill.slug,
    displayName: item.skill.displayName,
    summary: item.skill.summary ?? null,
    tags: resolvedTagsList[idx],
    stats: item.skill.stats,
    createdAt: item.skill.createdAt,
    updatedAt: item.skill.updatedAt,
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

export const listSkillsV1Http = httpAction(listSkillsV1Handler)

async function skillsGetRouterV1Handler(ctx: ActionCtx, request: Request) {
  const rate = await applyRateLimit(ctx, request, 'read')
  if (!rate.ok) return rate.response

  const segments = getPathSegments(request, '/api/v1/skills/')
  if (segments.length === 0) return text('Missing slug', 400, rate.headers)
  const slug = segments[0]?.trim().toLowerCase() ?? ''
  const second = segments[1]
  const third = segments[2]

  if (segments.length === 1) {
    const result = (await ctx.runQuery(api.skills.getBySlug, { slug })) as GetBySlugResult
    if (!result?.skill) {
      const hidden = await describeOwnerVisibleSkillState(ctx, request, slug)
      if (hidden) return text(hidden.message, hidden.status, rate.headers)
      return text('Skill not found', 404, rate.headers)
    }

    const [tags] = await resolveTagsBatch(ctx, [result.skill.tags])
    return json(
      {
        skill: {
          slug: result.skill.slug,
          displayName: result.skill.displayName,
          summary: result.skill.summary ?? null,
          tags,
          stats: result.skill.stats,
          createdAt: result.skill.createdAt,
          updatedAt: result.skill.updatedAt,
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
              userId: result.owner._id,
              displayName: result.owner.displayName ?? null,
              image: result.owner.image ?? null,
            }
          : null,
        moderation: result.moderationInfo
          ? {
              isSuspicious: result.moderationInfo.isSuspicious ?? false,
              isMalwareBlocked: result.moderationInfo.isMalwareBlocked ?? false,
            }
          : null,
      },
      200,
      rate.headers,
    )
  }

  if (second === 'versions' && segments.length === 2) {
    const skill = await ctx.runQuery(internal.skills.getSkillBySlugInternal, { slug })
    if (!skill || skill.softDeletedAt) return text('Skill not found', 404, rate.headers)

    const url = new URL(request.url)
    const limit = toOptionalNumber(url.searchParams.get('limit'))
    const cursor = url.searchParams.get('cursor')?.trim() || undefined
    const result = (await ctx.runQuery(api.skills.listVersionsPage, {
      skillId: skill._id,
      limit,
      cursor,
    })) as ListVersionsResult

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
    const skill = await ctx.runQuery(internal.skills.getSkillBySlugInternal, { slug })
    if (!skill || skill.softDeletedAt) return text('Skill not found', 404, rate.headers)

    const version = await ctx.runQuery(api.skills.getVersionBySkillAndVersion, {
      skillId: skill._id,
      version: third,
    })
    if (!version) return text('Version not found', 404, rate.headers)
    if (version.softDeletedAt) return text('Version not available', 410, rate.headers)

    return json(
      {
        skill: { slug: skill.slug, displayName: skill.displayName },
        version: {
          version: version.version,
          createdAt: version.createdAt,
          changelog: version.changelog,
          changelogSource: version.changelogSource ?? null,
          files: version.files.map((file: SkillFile) => ({
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

    const skillResult = (await ctx.runQuery(api.skills.getBySlug, {
      slug,
    })) as GetBySlugResult
    if (!skillResult?.skill) return text('Skill not found', 404, rate.headers)

    let version = skillResult.latestVersion
    if (versionParam) {
      version = await ctx.runQuery(api.skills.getVersionBySkillAndVersion, {
        skillId: skillResult.skill._id,
        version: versionParam,
      })
    } else if (tagParam) {
      const versionId = skillResult.skill.tags[tagParam]
      if (versionId) {
        version = await ctx.runQuery(api.skills.getVersionById, { versionId })
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
      // For any text response that a browser might try to render, lock it down.
      // In particular, this prevents SVG <foreignObject> script execution from
      // reading localStorage tokens on this origin.
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

async function describeOwnerVisibleSkillState(
  ctx: ActionCtx,
  request: Request,
  slug: string,
): Promise<{ status: number; message: string } | null> {
  const skill = await ctx.runQuery(internal.skills.getSkillBySlugInternal, { slug })
  if (!skill) return null

  const apiTokenUserId = await getOptionalApiTokenUserId(ctx, request)
  const isOwner = Boolean(apiTokenUserId && apiTokenUserId === skill.ownerUserId)
  if (!isOwner) return null

  if (skill.softDeletedAt) {
    return {
      status: 410,
      message: `Skill is hidden/deleted. Run "clawhub undelete ${slug}" to restore it.`,
    }
  }

  if (skill.moderationStatus === 'hidden') {
    if (skill.moderationReason === 'pending.scan' || skill.moderationReason === 'scanner.vt.pending') {
      return {
        status: 423,
        message: 'Skill is hidden while security scan is pending. Try again in a few minutes.',
      }
    }
    if (skill.moderationReason === 'quality.low') {
      return {
        status: 403,
        message:
          'Skill is hidden by quality checks. Update SKILL.md content or run "clawhub undelete <slug>" after review.',
      }
    }
    return {
      status: 403,
      message: `Skill is hidden by moderation${skill.moderationReason ? ` (${skill.moderationReason})` : ''}.`,
    }
  }

  if (skill.moderationStatus === 'removed') {
    return { status: 410, message: 'Skill has been removed by moderation.' }
  }

  return null
}

export const skillsGetRouterV1Http = httpAction(skillsGetRouterV1Handler)

async function publishSkillV1Handler(ctx: ActionCtx, request: Request) {
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
      const result = await publishVersionForUser(ctx, userId, payload)
      return json({ ok: true, ...result }, 200, rate.headers)
    }

    if (contentType.includes('multipart/form-data')) {
      const payload = await parseMultipartPublish(ctx, request)
      const result = await publishVersionForUser(ctx, userId, payload)
      return json({ ok: true, ...result }, 200, rate.headers)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Publish failed'
    return text(message, 400, rate.headers)
  }

  return text('Unsupported content type', 415, rate.headers)
}

export const publishSkillV1Http = httpAction(publishSkillV1Handler)

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

async function skillsPostRouterV1Handler(ctx: ActionCtx, request: Request) {
  const rate = await applyRateLimit(ctx, request, 'write')
  if (!rate.ok) return rate.response

  const segments = getPathSegments(request, '/api/v1/skills/')
  if (segments.length !== 2 || segments[1] !== 'undelete') {
    return text('Not found', 404, rate.headers)
  }
  const slug = segments[0]?.trim().toLowerCase() ?? ''
  try {
    const { userId } = await requireApiTokenUser(ctx, request)
    await ctx.runMutation(internal.skills.setSkillSoftDeletedInternal, {
      userId,
      slug,
      deleted: false,
    })
    return json({ ok: true }, 200, rate.headers)
  } catch {
    return text('Unauthorized', 401, rate.headers)
  }
}

export const skillsPostRouterV1Http = httpAction(skillsPostRouterV1Handler)

async function skillsDeleteRouterV1Handler(ctx: ActionCtx, request: Request) {
  const rate = await applyRateLimit(ctx, request, 'write')
  if (!rate.ok) return rate.response

  const segments = getPathSegments(request, '/api/v1/skills/')
  if (segments.length !== 1) return text('Not found', 404, rate.headers)
  const slug = segments[0]?.trim().toLowerCase() ?? ''
  try {
    const { userId } = await requireApiTokenUser(ctx, request)
    await ctx.runMutation(internal.skills.setSkillSoftDeletedInternal, {
      userId,
      slug,
      deleted: true,
    })
    return json({ ok: true }, 200, rate.headers)
  } catch {
    return text('Unauthorized', 401, rate.headers)
  }
}

export const skillsDeleteRouterV1Http = httpAction(skillsDeleteRouterV1Handler)

async function whoamiV1Handler(ctx: ActionCtx, request: Request) {
  const rate = await applyRateLimit(ctx, request, 'read')
  if (!rate.ok) return rate.response

  try {
    const { user } = await requireApiTokenUser(ctx, request)
    return json(
      {
        user: {
          handle: user.handle ?? null,
          displayName: user.displayName ?? null,
          image: user.image ?? null,
        },
      },
      200,
      rate.headers,
    )
  } catch {
    return text('Unauthorized', 401, rate.headers)
  }
}

export const whoamiV1Http = httpAction(whoamiV1Handler)

async function usersPostRouterV1Handler(ctx: ActionCtx, request: Request) {
  const rate = await applyRateLimit(ctx, request, 'write')
  if (!rate.ok) return rate.response

  const segments = getPathSegments(request, '/api/v1/users/')
  if (segments.length !== 1) {
    return text('Not found', 404, rate.headers)
  }
  const action = segments[0]
  if (action !== 'ban' && action !== 'role') {
    return text('Not found', 404, rate.headers)
  }

  let payload: Record<string, unknown>
  try {
    payload = (await request.json()) as Record<string, unknown>
  } catch {
    return text('Invalid JSON', 400, rate.headers)
  }

  const handleRaw = typeof payload.handle === 'string' ? payload.handle.trim() : ''
  const userIdRaw = typeof payload.userId === 'string' ? payload.userId.trim() : ''
  const reasonRaw = typeof payload.reason === 'string' ? payload.reason.trim() : ''
  if (!handleRaw && !userIdRaw) {
    return text('Missing userId or handle', 400, rate.headers)
  }

  const roleRaw = typeof payload.role === 'string' ? payload.role.trim().toLowerCase() : ''
  if (action === 'role' && !roleRaw) {
    return text('Missing role', 400, rate.headers)
  }
  const role = roleRaw === 'user' || roleRaw === 'moderator' || roleRaw === 'admin' ? roleRaw : null
  if (action === 'role' && !role) {
    return text('Invalid role', 400, rate.headers)
  }

  let actorUserId: Id<'users'>
  try {
    const auth = await requireApiTokenUser(ctx, request)
    actorUserId = auth.userId
  } catch {
    return text('Unauthorized', 401, rate.headers)
  }

  let targetUserId: Id<'users'> | null = userIdRaw ? (userIdRaw as Id<'users'>) : null
  if (!targetUserId) {
    const handle = handleRaw.toLowerCase()
    const user = await ctx.runQuery(api.users.getByHandle, { handle })
    if (!user?._id) return text('User not found', 404, rate.headers)
    targetUserId = user._id
  }

  if (action === 'ban') {
    const reason = reasonRaw.length > 0 ? reasonRaw : undefined
    if (reason && reason.length > 500) {
      return text('Reason too long (max 500 chars)', 400, rate.headers)
    }
    try {
      const result = await ctx.runMutation(internal.users.banUserInternal, {
        actorUserId,
        targetUserId,
        reason,
      })
      return json(result, 200, rate.headers)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Ban failed'
      if (message.toLowerCase().includes('forbidden')) {
        return text('Forbidden', 403, rate.headers)
      }
      if (message.toLowerCase().includes('not found')) {
        return text(message, 404, rate.headers)
      }
      return text(message, 400, rate.headers)
    }
  }

  if (!role) {
    return text('Invalid role', 400, rate.headers)
  }

  try {
    const result = await ctx.runMutation(internal.users.setRoleInternal, {
      actorUserId,
      targetUserId,
      role,
    })
    return json({ ok: true, role: result.role ?? role }, 200, rate.headers)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Role change failed'
    if (message.toLowerCase().includes('forbidden')) {
      return text('Forbidden', 403, rate.headers)
    }
    if (message.toLowerCase().includes('not found')) {
      return text(message, 404, rate.headers)
    }
    return text(message, 400, rate.headers)
  }
}

export const usersPostRouterV1Http = httpAction(usersPostRouterV1Handler)

async function usersListV1Handler(ctx: ActionCtx, request: Request) {
  const rate = await applyRateLimit(ctx, request, 'read')
  if (!rate.ok) return rate.response

  const url = new URL(request.url)
  const limitRaw = toOptionalNumber(url.searchParams.get('limit'))
  const query = url.searchParams.get('q') ?? url.searchParams.get('query') ?? ''

  let actorUserId: Id<'users'>
  try {
    const auth = await requireApiTokenUser(ctx, request)
    actorUserId = auth.userId
  } catch {
    return text('Unauthorized', 401, rate.headers)
  }

  const limit = Math.min(Math.max(limitRaw ?? 20, 1), 200)
  try {
    const result = await ctx.runQuery(internal.users.searchInternal, {
      actorUserId,
      query,
      limit,
    })
    return json(result, 200, rate.headers)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'User search failed'
    if (message.toLowerCase().includes('forbidden')) {
      return text('Forbidden', 403, rate.headers)
    }
    if (message.toLowerCase().includes('unauthorized')) {
      return text('Unauthorized', 401, rate.headers)
    }
    return text(message, 400, rate.headers)
  }
}

export const usersListV1Http = httpAction(usersListV1Handler)

async function parseMultipartPublish(
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

function parsePublishBody(body: unknown) {
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

/**
 * Batch resolve soul version tags to version strings.
 * Collects all version IDs, fetches them in a single query, then maps back.
 * Reduces N sequential queries to 1 batch query.
 */
async function resolveSoulTagsBatch(
  ctx: ActionCtx,
  tagsList: Array<Record<string, Id<'soulVersions'>>>,
): Promise<Array<Record<string, string>>> {
  // Collect all unique version IDs
  const allVersionIds = new Set<Id<'soulVersions'>>()
  for (const tags of tagsList) {
    for (const versionId of Object.values(tags)) {
      allVersionIds.add(versionId)
    }
  }

  // Short-circuit if no tags to resolve
  if (allVersionIds.size === 0) {
    return tagsList.map(() => ({}))
  }

  // Single batch query
  const versions =
    (await ctx.runQuery(api.souls.getVersionsByIds, {
      versionIds: [...allVersionIds],
    })) ?? []

  // Build lookup map: versionId -> version string
  const versionMap = new Map<Id<'soulVersions'>, string>()
  for (const v of versions) {
    if (v && !v.softDeletedAt) {
      versionMap.set(v._id, v.version)
    }
  }

  // Resolve each tags record
  return tagsList.map((tags) => {
    const resolved: Record<string, string> = {}
    for (const [tag, versionId] of Object.entries(tags)) {
      const version = versionMap.get(versionId)
      if (version) resolved[tag] = version
    }
    return resolved
  })
}

/**
 * Batch resolve skill version tags to version strings.
 * Collects all version IDs, fetches them in a single query, then maps back.
 * Reduces N sequential queries to 1 batch query.
 */
async function resolveTagsBatch(
  ctx: ActionCtx,
  tagsList: Array<Record<string, Id<'skillVersions'>>>,
): Promise<Array<Record<string, string>>> {
  // Collect all unique version IDs
  const allVersionIds = new Set<Id<'skillVersions'>>()
  for (const tags of tagsList) {
    for (const versionId of Object.values(tags)) {
      allVersionIds.add(versionId)
    }
  }

  // Short-circuit if no tags to resolve
  if (allVersionIds.size === 0) {
    return tagsList.map(() => ({}))
  }

  // Single batch query
  const versions =
    (await ctx.runQuery(api.skills.getVersionsByIds, {
      versionIds: [...allVersionIds],
    })) ?? []

  // Build lookup map: versionId -> version string
  const versionMap = new Map<Id<'skillVersions'>, string>()
  for (const v of versions) {
    if (v && !v.softDeletedAt) {
      versionMap.set(v._id, v.version)
    }
  }

  // Resolve each tags record
  return tagsList.map((tags) => {
    const resolved: Record<string, string> = {}
    for (const [tag, versionId] of Object.entries(tags)) {
      const version = versionMap.get(versionId)
      if (version) resolved[tag] = version
    }
    return resolved
  })
}

function json(value: unknown, status = 200, headers?: HeadersInit) {
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

function text(value: string, status: number, headers?: HeadersInit) {
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

function getPathSegments(request: Request, prefix: string) {
  const pathname = new URL(request.url).pathname
  if (!pathname.startsWith(prefix)) return []
  const rest = pathname.slice(prefix.length)
  return rest
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment))
}

function toOptionalNumber(value: string | null) {
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

type SkillListSort =
  | 'updated'
  | 'downloads'
  | 'stars'
  | 'installsCurrent'
  | 'installsAllTime'
  | 'trending'

function parseListSort(value: string | null): SkillListSort {
  const normalized = value?.trim().toLowerCase()
  if (normalized === 'downloads') return 'downloads'
  if (normalized === 'stars' || normalized === 'rating') return 'stars'
  if (
    normalized === 'installs' ||
    normalized === 'install' ||
    normalized === 'installscurrent' ||
    normalized === 'installs-current'
  ) {
    return 'installsCurrent'
  }
  if (normalized === 'installsalltime' || normalized === 'installs-all-time') {
    return 'installsAllTime'
  }
  if (normalized === 'trending') return 'trending'
  return 'updated'
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

async function listSoulsV1Handler(ctx: ActionCtx, request: Request) {
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

export const listSoulsV1Http = httpAction(listSoulsV1Handler)

async function soulsGetRouterV1Handler(ctx: ActionCtx, request: Request) {
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

    const soulResult = (await ctx.runQuery(api.souls.getBySlug, {
      slug,
    })) as GetSoulBySlugResult
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
      // For any text response that a browser might try to render, lock it down.
      // In particular, this prevents SVG <foreignObject> script execution from
      // reading localStorage tokens on this origin.
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

export const soulsGetRouterV1Http = httpAction(soulsGetRouterV1Handler)

async function publishSoulV1Handler(ctx: ActionCtx, request: Request) {
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

export const publishSoulV1Http = httpAction(publishSoulV1Handler)

async function soulsPostRouterV1Handler(ctx: ActionCtx, request: Request) {
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
  } catch {
    return text('Unauthorized', 401, rate.headers)
  }
}

export const soulsPostRouterV1Http = httpAction(soulsPostRouterV1Handler)

async function soulsDeleteRouterV1Handler(ctx: ActionCtx, request: Request) {
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
  } catch {
    return text('Unauthorized', 401, rate.headers)
  }
}

export const soulsDeleteRouterV1Http = httpAction(soulsDeleteRouterV1Handler)

async function starsPostRouterV1Handler(ctx: ActionCtx, request: Request) {
  const rate = await applyRateLimit(ctx, request, 'write')
  if (!rate.ok) return rate.response

  const segments = getPathSegments(request, '/api/v1/stars/')
  if (segments.length !== 1) return text('Not found', 404, rate.headers)
  const slug = segments[0]?.trim().toLowerCase() ?? ''

  try {
    const { userId } = await requireApiTokenUser(ctx, request)
    const skill = await ctx.runQuery(internal.skills.getSkillBySlugInternal, { slug })
    if (!skill) return text('Skill not found', 404, rate.headers)

    const result = await ctx.runMutation(internal.stars.addStarInternal, {
      userId,
      skillId: skill._id,
    })
    return json(result, 200, rate.headers)
  } catch {
    return text('Unauthorized', 401, rate.headers)
  }
}

export const starsPostRouterV1Http = httpAction(starsPostRouterV1Handler)

async function starsDeleteRouterV1Handler(ctx: ActionCtx, request: Request) {
  const rate = await applyRateLimit(ctx, request, 'write')
  if (!rate.ok) return rate.response

  const segments = getPathSegments(request, '/api/v1/stars/')
  if (segments.length !== 1) return text('Not found', 404, rate.headers)
  const slug = segments[0]?.trim().toLowerCase() ?? ''

  try {
    const { userId } = await requireApiTokenUser(ctx, request)
    const skill = await ctx.runQuery(internal.skills.getSkillBySlugInternal, { slug })
    if (!skill) return text('Skill not found', 404, rate.headers)

    const result = await ctx.runMutation(internal.stars.removeStarInternal, {
      userId,
      skillId: skill._id,
    })
    return json(result, 200, rate.headers)
  } catch {
    return text('Unauthorized', 401, rate.headers)
  }
}

export const starsDeleteRouterV1Http = httpAction(starsDeleteRouterV1Handler)
export const __handlers = {
  searchSkillsV1Handler,
  resolveSkillVersionV1Handler,
  listSkillsV1Handler,
  skillsGetRouterV1Handler,
  publishSkillV1Handler,
  skillsPostRouterV1Handler,
  skillsDeleteRouterV1Handler,
  listSoulsV1Handler,
  soulsGetRouterV1Handler,
  publishSoulV1Handler,
  soulsPostRouterV1Handler,
  soulsDeleteRouterV1Handler,
  starsPostRouterV1Handler,
  starsDeleteRouterV1Handler,
  whoamiV1Handler,
  usersPostRouterV1Handler,
  usersListV1Handler,
}
