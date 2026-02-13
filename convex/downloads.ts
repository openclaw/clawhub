import { v } from 'convex/values'
import { api, internal } from './_generated/api'
import { httpAction, internalMutation, mutation } from './_generated/server'
import { applyRateLimit, getClientIp } from './lib/httpRateLimit'
import { buildDeterministicZip } from './lib/skillZip'
import { hashToken } from './lib/tokens'
import { insertStatEvent } from './skillStatEvents'

const DAY_MS = 86_400_000
const DEDUPE_RETENTION_DAYS = 14
const PRUNE_BATCH_SIZE = 200
const PRUNE_MAX_BATCHES = 50

export const downloadZip = httpAction(async (ctx, request) => {
  const url = new URL(request.url)
  const slug = url.searchParams.get('slug')?.trim().toLowerCase()
  const versionParam = url.searchParams.get('version')?.trim()
  const tagParam = url.searchParams.get('tag')?.trim()

  if (!slug) {
    return new Response('Missing slug', { status: 400 })
  }

  const rate = await applyRateLimit(ctx, request, 'download')
  if (!rate.ok) return rate.response

  const skillResult = await ctx.runQuery(api.skills.getBySlug, { slug })
  if (!skillResult?.skill) {
    return new Response('Skill not found', { status: 404 })
  }

  // Block downloads based on moderation status.
  const mod = skillResult.moderationInfo
  if (mod?.isMalwareBlocked) {
    return new Response(
      'Blocked: this skill has been flagged as malicious by VirusTotal and cannot be downloaded.',
      { status: 403 },
    )
  }
  if (mod?.isPendingScan) {
    return new Response(
      'This skill is pending a security scan by VirusTotal. Please try again in a few minutes.',
      { status: 423 },
    )
  }
  if (mod?.isRemoved) {
    return new Response('This skill has been removed by a moderator.', { status: 410 })
  }
  if (mod?.isHiddenByMod) {
    return new Response('This skill is currently unavailable.', { status: 403 })
  }

  const skill = skillResult.skill
  let version = skillResult.latestVersion

  if (versionParam) {
    version = await ctx.runQuery(api.skills.getVersionBySkillAndVersion, {
      skillId: skill._id,
      version: versionParam,
    })
  } else if (tagParam) {
    const versionId = skill.tags[tagParam]
    if (versionId) {
      version = await ctx.runQuery(api.skills.getVersionById, { versionId })
    }
  }

  if (!version) {
    return new Response('Version not found', { status: 404 })
  }
  if (version.softDeletedAt) {
    return new Response('Version not available', { status: 410 })
  }

  const entries: Array<{ path: string; bytes: Uint8Array }> = []
  for (const file of version.files) {
    const blob = await ctx.storage.get(file.storageId)
    if (!blob) continue
    const buffer = new Uint8Array(await blob.arrayBuffer())
    entries.push({ path: file.path, bytes: buffer })
  }
  const zipArray = buildDeterministicZip(entries, {
    ownerId: String(skill.ownerUserId),
    slug: skill.slug,
    version: version.version,
    publishedAt: version.createdAt,
  })
  const zipBlob = new Blob([zipArray], { type: 'application/zip' })

  const ip = getClientIp(request) ?? 'unknown'
  const ipHash = await hashToken(ip)
  const dayStart = getDayStart(Date.now())
  try {
    await ctx.runMutation(internal.downloads.recordDownloadInternal, {
      skillId: skill._id,
      ipHash,
      dayStart,
    })
  } catch {
    // Best-effort metric path; do not fail downloads.
  }

  return new Response(zipBlob, {
    status: 200,
    headers: mergeHeaders(rate.headers, {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${slug}-${version.version}.zip"`,
      'Cache-Control': 'private, max-age=60',
    }),
  })
})

export const increment = mutation({
  args: { skillId: v.id('skills') },
  handler: async (ctx, args) => {
    // Skip db.get to avoid adding the skill doc to the read set.
    // The calling HTTP action already validated the skill exists,
    // and the stat processor handles deleted skills gracefully.
    await insertStatEvent(ctx, {
      skillId: args.skillId,
      kind: 'download',
    })
  },
})

export const recordDownloadInternal = internalMutation({
  args: {
    skillId: v.id('skills'),
    ipHash: v.string(),
    dayStart: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('downloadDedupes')
      .withIndex('by_skill_ip_day', (q) =>
        q.eq('skillId', args.skillId).eq('ipHash', args.ipHash).eq('dayStart', args.dayStart),
      )
      .unique()
    if (existing) return

    await ctx.db.insert('downloadDedupes', {
      skillId: args.skillId,
      ipHash: args.ipHash,
      dayStart: args.dayStart,
      createdAt: Date.now(),
    })

    await insertStatEvent(ctx, {
      skillId: args.skillId,
      kind: 'download',
    })
  },
})

export const pruneDownloadDedupesInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - DEDUPE_RETENTION_DAYS * DAY_MS

    for (let batches = 0; batches < PRUNE_MAX_BATCHES; batches += 1) {
      const stale = await ctx.db
        .query('downloadDedupes')
        .withIndex('by_day', (q) => q.lt('dayStart', cutoff))
        .take(PRUNE_BATCH_SIZE)

      if (stale.length === 0) break

      for (const entry of stale) {
        await ctx.db.delete(entry._id)
      }

      if (stale.length < PRUNE_BATCH_SIZE) break
    }
  },
})

export function getDayStart(timestamp: number) {
  return Math.floor(timestamp / DAY_MS) * DAY_MS
}

export const __test = {
  getDayStart,
}

function mergeHeaders(base: HeadersInit, extra: HeadersInit) {
  return { ...(base as Record<string, string>), ...(extra as Record<string, string>) }
}
