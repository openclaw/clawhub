import {
  ApiCliSkillDeleteResponseSchema,
  ApiCliTelemetrySyncResponseSchema,
  CliPublishRequestSchema,
  CliSkillDeleteRequestSchema,
  CliTelemetrySyncRequestSchema,
  parseArk,
} from 'clawhub-schema'
import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import type { ActionCtx } from './_generated/server'
import { httpAction } from './_generated/server'
import { requireApiTokenUser } from './lib/apiTokenAuth'
import { publishVersionForUser } from './skills'

type SearchSkillEntry = {
  score: number
  skill: {
    slug?: string
    displayName?: string
    summary?: string | null
    updatedAt?: number
  } | null
  version: { version?: string } | null
}

type GetBySlugResult = {
  skill: {
    _id: Id<'skills'>
    slug: string
    displayName: string
    summary?: string
    tags: Record<string, string>
    stats: unknown
    createdAt: number
    updatedAt: number
  } | null
  latestVersion: { version: string; createdAt: number; changelog: string } | null
  owner: { handle?: string; displayName?: string; image?: string } | null
} | null

async function searchSkillsHandler(ctx: ActionCtx, request: Request) {
  const url = new URL(request.url)
  const query = url.searchParams.get('q')?.trim() ?? ''
  const limit = toOptionalNumber(url.searchParams.get('limit'))
  const approvedOnly = url.searchParams.get('approvedOnly') === 'true'
  const highlightedOnly = url.searchParams.get('highlightedOnly') === 'true' || approvedOnly

  if (!query) return json({ results: [] })

  const results = (await ctx.runAction(api.search.searchSkills, {
    query,
    limit,
    highlightedOnly: highlightedOnly || undefined,
  })) as SearchSkillEntry[]

  return json({
    results: results.map((result) => ({
      score: result.score,
      slug: result.skill?.slug,
      displayName: result.skill?.displayName,
      summary: result.skill?.summary ?? null,
      version: result.version?.version ?? null,
      updatedAt: result.skill?.updatedAt,
    })),
  })
}

export const searchSkillsHttp = httpAction(searchSkillsHandler)

async function getSkillHandler(ctx: ActionCtx, request: Request) {
  const url = new URL(request.url)
  const slug = url.searchParams.get('slug')?.trim().toLowerCase()
  if (!slug) return text('Missing slug', 400)

  const result = (await ctx.runQuery(api.skills.getBySlug, { slug })) as GetBySlugResult
  if (!result?.skill) return text('Skill not found', 404)

  return json({
    skill: {
      slug: result.skill.slug,
      displayName: result.skill.displayName,
      summary: result.skill.summary ?? null,
      tags: result.skill.tags,
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
          displayName: result.owner.displayName ?? null,
          image: result.owner.image ?? null,
        }
      : null,
  })
}

export const getSkillHttp = httpAction(getSkillHandler)

async function resolveSkillVersionHandler(ctx: ActionCtx, request: Request) {
  const url = new URL(request.url)
  const slug = url.searchParams.get('slug')?.trim().toLowerCase()
  const hash = url.searchParams.get('hash')?.trim().toLowerCase()
  if (!slug || !hash) return text('Missing slug or hash', 400)
  if (!/^[a-f0-9]{64}$/.test(hash)) return text('Invalid hash', 400)

  const resolved = await ctx.runQuery(api.skills.resolveVersionByHash, { slug, hash })
  if (!resolved) return text('Skill not found', 404)

  return json({ slug, match: resolved.match, latestVersion: resolved.latestVersion })
}

export const resolveSkillVersionHttp = httpAction(resolveSkillVersionHandler)

async function cliWhoamiHandler(ctx: ActionCtx, request: Request) {
  try {
    const { user } = await requireApiTokenUser(ctx, request)
    return json({
      user: {
        handle: user.handle ?? null,
        displayName: user.displayName ?? null,
        image: user.image ?? null,
      },
    })
  } catch {
    return text('Unauthorized', 401)
  }
}

export const cliWhoamiHttp = httpAction(cliWhoamiHandler)

async function cliUploadUrlHandler(ctx: ActionCtx, request: Request) {
  try {
    const { userId } = await requireApiTokenUser(ctx, request)
    const uploadUrl = await ctx.runMutation(internal.uploads.generateUploadUrlForUserInternal, {
      userId,
    })
    return json({ uploadUrl })
  } catch {
    return text('Unauthorized', 401)
  }
}

export const cliUploadUrlHttp = httpAction(cliUploadUrlHandler)

async function cliPublishHandler(ctx: ActionCtx, request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return text('Invalid JSON', 400)
  }

  try {
    const { userId } = await requireApiTokenUser(ctx, request)
    const args = parsePublishBody(body)
    const result = await publishVersionForUser(ctx, userId, args)
    return json({ ok: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Publish failed'
    if (message.toLowerCase().includes('unauthorized')) return text('Unauthorized', 401)
    return text(message, 400)
  }
}

export const cliPublishHttp = httpAction(cliPublishHandler)

async function cliSkillDeleteHandler(ctx: ActionCtx, request: Request, deleted: boolean) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return text('Invalid JSON', 400)
  }

  try {
    const { userId } = await requireApiTokenUser(ctx, request)
    const args = parseArk(CliSkillDeleteRequestSchema, body, 'Delete payload')
    await ctx.runMutation(internal.skills.setSkillSoftDeletedInternal, {
      userId,
      slug: args.slug,
      deleted,
    })
    const ok = parseArk(ApiCliSkillDeleteResponseSchema, { ok: true }, 'Delete response')
    return json(ok)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Delete failed'
    if (message.toLowerCase().includes('unauthorized')) return text('Unauthorized', 401)
    return text(message, 400)
  }
}

export const cliSkillDeleteHttp = httpAction((ctx, request) =>
  cliSkillDeleteHandler(ctx, request, true),
)
export const cliSkillUndeleteHttp = httpAction((ctx, request) =>
  cliSkillDeleteHandler(ctx, request, false),
)

async function cliTelemetrySyncHandler(ctx: ActionCtx, request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return text('Invalid JSON', 400)
  }

  try {
    const { userId } = await requireApiTokenUser(ctx, request)
    const args = parseArk(CliTelemetrySyncRequestSchema, body, 'Telemetry payload')
    await ctx.runMutation(internal.telemetry.reportCliSyncInternal, {
      userId,
      roots: args.roots.map((root) => ({
        rootId: root.rootId,
        label: root.label,
        skills: root.skills.map((skill) => ({
          slug: skill.slug,
          version: skill.version ?? undefined,
        })),
      })),
    })
    const ok = parseArk(ApiCliTelemetrySyncResponseSchema, { ok: true }, 'Telemetry response')
    return json(ok)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Telemetry failed'
    if (message.toLowerCase().includes('unauthorized')) return text('Unauthorized', 401)
    return text(message, 400)
  }
}

export const cliTelemetrySyncHttp = httpAction(cliTelemetrySyncHandler)

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    },
  })
}

function text(value: string, status: number) {
  return new Response(value, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    },
  })
}

function toOptionalNumber(value: string | null) {
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : undefined
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

export const __test = {
  parsePublishBody,
  toOptionalNumber,
}

export const __handlers = {
  searchSkillsHandler,
  getSkillHandler,
  resolveSkillVersionHandler,
  cliWhoamiHandler,
  cliUploadUrlHandler,
  cliPublishHandler,
  cliSkillDeleteHandler,
  cliTelemetrySyncHandler,
}
