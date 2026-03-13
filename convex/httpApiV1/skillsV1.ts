import { api, internal } from '../_generated/api'
import type { Doc, Id } from '../_generated/dataModel'
import type { ActionCtx } from '../_generated/server'
import { getOptionalApiTokenUserId, requireApiTokenUser } from '../lib/apiTokenAuth'
import { applyRateLimit, parseBearerToken } from '../lib/httpRateLimit'
import { publishVersionForUser } from '../skills'
import {
  MAX_RAW_FILE_BYTES,
  getPathSegments,
  json,
  parseJsonPayload,
  parseMultipartPublish,
  parsePublishBody,
  requireApiTokenUserOrResponse,
  resolveTagsBatch,
  safeTextFileResponse,
  softDeleteErrorToResponse,
  text,
  toOptionalNumber,
} from './shared'

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
    latestVersion: {
      version: string
      createdAt: number
      changelog: string
      parsed?: {
        license?: 'MIT-0'
        clawdis?: { os?: string[]; nix?: { plugin?: boolean; systems?: string[] } }
      }
    } | null
  }>
  nextCursor: string | null
}

type SkillFile = Doc<'skillVersions'>['files'][number]

type ModerationEvidence = {
  code: string
  severity: 'info' | 'warn' | 'critical'
  file: string
  line: number
  message: string
  evidence: string
}

type SkillModerationShape = {
  moderationFlags?: string[]
  moderationVerdict?: 'clean' | 'suspicious' | 'malicious'
  moderationReasonCodes?: string[]
  moderationSummary?: string
  moderationEngineVersion?: string
  moderationEvaluatedAt?: number
  moderationReason?: string
  moderationEvidence?: ModerationEvidence[]
  updatedAt?: number
}

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
    verdict?: 'clean' | 'suspicious' | 'malicious'
    reasonCodes?: string[]
    summary?: string
    engineVersion?: string
    updatedAt?: number
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

function sanitizeEvidence(
  evidence: ModerationEvidence[],
  allowSensitiveEvidence: boolean,
): ModerationEvidence[] {
  if (allowSensitiveEvidence) return evidence
  return evidence.map((entry) => ({
    code: entry.code,
    severity: entry.severity,
    file: entry.file,
    line: entry.line,
    message: entry.message,
    evidence: '',
  }))
}

function normalizeModerationFromSkill(skill: SkillModerationShape) {
  const flags = Array.isArray(skill.moderationFlags) ? skill.moderationFlags : []
  const verdict =
    skill.moderationVerdict ??
    (flags.includes('blocked.malware')
      ? 'malicious'
      : flags.includes('flagged.suspicious')
        ? 'suspicious'
        : 'clean')
  const isMalwareBlocked = verdict === 'malicious' || flags.includes('blocked.malware')
  const isSuspicious =
    !isMalwareBlocked && (verdict === 'suspicious' || flags.includes('flagged.suspicious'))

  return {
    isMalwareBlocked,
    isSuspicious,
    verdict,
    reasonCodes: Array.isArray(skill.moderationReasonCodes) ? skill.moderationReasonCodes : [],
    summary: skill.moderationSummary ?? null,
    engineVersion: skill.moderationEngineVersion ?? null,
    updatedAt: skill.moderationEvaluatedAt ?? skill.updatedAt ?? null,
    reason: skill.moderationReason ?? null,
    evidence: Array.isArray(skill.moderationEvidence) ? skill.moderationEvidence : [],
  }
}

export async function searchSkillsV1Handler(ctx: ActionCtx, request: Request) {
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

export async function resolveSkillVersionV1Handler(ctx: ActionCtx, request: Request) {
  const rate = await applyRateLimit(ctx, request, 'read')
  if (!rate.ok) return rate.response

  const url = new URL(request.url)
  const slug = url.searchParams.get('slug')?.trim().toLowerCase()
  const hash = url.searchParams.get('hash')?.trim().toLowerCase()
  if (!slug || !hash) return text('Missing slug or hash', 400, rate.headers)
  if (!/^[a-f0-9]{64}$/.test(hash)) return text('Invalid hash', 400, rate.headers)

  const resolved = await ctx.runQuery(api.skills.resolveVersionByHash, { slug, hash })
  if (!resolved) return text('Skill not found', 404, rate.headers)

  return json({ slug, match: resolved.match, latestVersion: resolved.latestVersion }, 200, rate.headers)
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

export async function listSkillsV1Handler(ctx: ActionCtx, request: Request) {
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
          license: item.latestVersion.parsed?.license ?? null,
        }
      : null,
    metadata: item.latestVersion?.parsed?.clawdis
      ? {
          os: item.latestVersion.parsed.clawdis.os ?? null,
          systems: item.latestVersion.parsed.clawdis.nix?.systems ?? null,
        }
      : null,
  }))

  return json({ items, nextCursor: result.nextCursor ?? null }, 200, rate.headers)
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
      message: `Skill is hidden by moderation${
        skill.moderationReason ? ` (${skill.moderationReason})` : ''
      }.`,
    }
  }

  if (skill.moderationStatus === 'removed') {
    return { status: 410, message: 'Skill has been removed by moderation.' }
  }

  return null
}

export async function skillsGetRouterV1Handler(ctx: ActionCtx, request: Request) {
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
              license: result.latestVersion.parsed?.license ?? null,
            }
          : null,
        metadata: result.latestVersion?.parsed?.clawdis
          ? {
              os: result.latestVersion.parsed.clawdis.os ?? null,
              systems: result.latestVersion.parsed.clawdis.nix?.systems ?? null,
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
              verdict: result.moderationInfo.verdict ?? 'clean',
              reasonCodes: result.moderationInfo.reasonCodes ?? [],
              summary: result.moderationInfo.summary ?? null,
              engineVersion: result.moderationInfo.engineVersion ?? null,
              updatedAt: result.moderationInfo.updatedAt ?? null,
            }
          : null,
      },
      200,
      rate.headers,
    )
  }

  if (second === 'moderation' && segments.length === 2) {
    const apiTokenUserId = await getOptionalApiTokenUserId(ctx, request)
    let isStaff = false
    if (apiTokenUserId) {
      const caller = await ctx.runQuery(internal.users.getByIdInternal, { userId: apiTokenUserId })
      if (caller?.role === 'admin' || caller?.role === 'moderator') {
        isStaff = true
      }
    }

    const hiddenSkill = await ctx.runQuery(internal.skills.getSkillBySlugInternal, { slug })
    const isOwner = Boolean(apiTokenUserId && hiddenSkill && apiTokenUserId === hiddenSkill.ownerUserId)

    const result = (await ctx.runQuery(api.skills.getBySlug, { slug })) as GetBySlugResult
    if (!result?.skill) {
      if (hiddenSkill && (isOwner || isStaff)) {
        const mod = normalizeModerationFromSkill(hiddenSkill as SkillModerationShape)
        return json(
          {
            moderation: {
              isSuspicious: mod.isSuspicious,
              isMalwareBlocked: mod.isMalwareBlocked,
              verdict: mod.verdict,
              reasonCodes: mod.reasonCodes,
              summary: mod.summary,
              engineVersion: mod.engineVersion,
              updatedAt: mod.updatedAt,
              evidence: sanitizeEvidence(mod.evidence, true),
              legacyReason: mod.reason,
            },
          },
          200,
          rate.headers,
        )
      }

      return text('Moderation details unavailable', 404, rate.headers)
    }

    const mod = hiddenSkill
      ? normalizeModerationFromSkill(hiddenSkill as SkillModerationShape)
      : result.moderationInfo
        ? {
            isSuspicious: result.moderationInfo.isSuspicious ?? false,
            isMalwareBlocked: result.moderationInfo.isMalwareBlocked ?? false,
            verdict: result.moderationInfo.verdict ?? 'clean',
            reasonCodes: result.moderationInfo.reasonCodes ?? [],
            summary: result.moderationInfo.summary ?? null,
            engineVersion: result.moderationInfo.engineVersion ?? null,
            updatedAt: result.moderationInfo.updatedAt ?? null,
            reason: result.moderationInfo.reason ?? null,
            evidence: [],
          }
        : null
    const isFlagged = Boolean(mod?.isSuspicious || mod?.isMalwareBlocked)

    if (!isOwner && !isStaff && !isFlagged) {
      return text('Moderation details unavailable', 404, rate.headers)
    }

    return json(
      {
        moderation: mod
          ? {
              isSuspicious: mod.isSuspicious,
              isMalwareBlocked: mod.isMalwareBlocked,
              verdict: mod.verdict,
              reasonCodes: mod.reasonCodes,
              summary: mod.summary,
              engineVersion: mod.engineVersion,
              updatedAt: mod.updatedAt,
              evidence: sanitizeEvidence(mod.evidence, Boolean(isOwner || isStaff)),
              legacyReason: isOwner || isStaff ? mod.reason : null,
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

    // Map llmAnalysis to security status
    let security = undefined
    if (version.llmAnalysis) {
      const analysis = version.llmAnalysis
      let status: 'clean' | 'suspicious' | 'malicious' | 'pending' | 'error'
      switch (analysis.verdict) {
        case 'benign':
          status = 'clean'
          break
        case 'suspicious':
          status = 'suspicious'
          break
        case 'malicious':
          status = 'malicious'
          break
        default:
          status = analysis.status === 'error' ? 'error' : 'pending'
      }

      const hasWarnings =
        analysis.verdict === 'suspicious' ||
        analysis.verdict === 'malicious' ||
        (Array.isArray(analysis.dimensions) &&
          analysis.dimensions.some((dimension) => {
            if (!dimension || typeof dimension !== 'object') return false
            const rating = (dimension as { rating?: unknown }).rating
            return typeof rating === 'string' && rating !== 'ok'
          }))

      security = {
        status,
        hasWarnings,
        checkedAt: analysis.checkedAt ?? null,
        model: analysis.model || null,
      }
    }

    return json(
      {
        skill: { slug: skill.slug, displayName: skill.displayName },
        version: {
          version: version.version,
          createdAt: version.createdAt,
          changelog: version.changelog,
          changelogSource: version.changelogSource ?? null,
          license: version.parsed?.license ?? null,
          files: version.files.map((file: SkillFile) => ({
            path: file.path,
            size: file.size,
            sha256: file.sha256,
            contentType: file.contentType ?? null,
          })),
          security,
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

    const skillResult = (await ctx.runQuery(api.skills.getBySlug, { slug })) as GetBySlugResult
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
    return safeTextFileResponse({
      textContent,
      path: file.path,
      contentType: file.contentType ?? undefined,
      sha256: file.sha256,
      size: file.size,
      headers: rate.headers,
    })
  }

  return text('Not found', 404, rate.headers)
}

export async function publishSkillV1Handler(ctx: ActionCtx, request: Request) {
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
      if (!hasAcceptedLegacyLicenseTerms(payload.acceptLicenseTerms)) {
        return text('MIT-0 license terms must be accepted to publish skills', 400, rate.headers)
      }
      const result = await publishVersionForUser(ctx, userId, payload)
      return json({ ok: true, ...result }, 200, rate.headers)
    }

    if (contentType.includes('multipart/form-data')) {
      const payload = await parseMultipartPublish(ctx, request)
      if (!hasAcceptedLegacyLicenseTerms(payload.acceptLicenseTerms)) {
        return text('MIT-0 license terms must be accepted to publish skills', 400, rate.headers)
      }
      const result = await publishVersionForUser(ctx, userId, payload)
      return json({ ok: true, ...result }, 200, rate.headers)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Publish failed'
    return text(message, 400, rate.headers)
  }

  return text('Unsupported content type', 415, rate.headers)
}

function hasAcceptedLegacyLicenseTerms(acceptLicenseTerms: boolean | undefined) {
  return acceptLicenseTerms !== false
}

type TransferDecisionAction = 'accept' | 'reject' | 'cancel'

function transferErrorToResponse(error: unknown, headers: HeadersInit) {
  const message = error instanceof Error ? error.message : 'Transfer failed'
  const lower = message.toLowerCase()
  if (lower.includes('unauthorized')) return text('Unauthorized', 401, headers)
  if (lower.includes('forbidden')) return text('Forbidden', 403, headers)
  if (lower.includes('not found')) return text(message, 404, headers)
  if (lower.includes('required') || lower.includes('invalid') || lower.includes('pending')) {
    return text(message, 400, headers)
  }
  return text(message, 400, headers)
}

async function resolveTransferContext(
  ctx: ActionCtx,
  request: Request,
  slug: string,
  headers: HeadersInit,
): Promise<
  | { ok: true; userId: Id<'users'>; skill: Doc<'skills'> }
  | { ok: false; response: Response }
> {
  const auth = await requireApiTokenUserOrResponse(ctx, request, headers)
  if (!auth.ok) return auth

  const skill = await ctx.runQuery(internal.skills.getSkillBySlugInternal, { slug })
  if (!skill || skill.softDeletedAt) return { ok: false, response: text('Skill not found', 404, headers) }

  return { ok: true, userId: auth.userId, skill }
}

async function handleTransferRequest(
  ctx: ActionCtx,
  request: Request,
  slug: string,
  headers: HeadersInit,
) {
  const transferContext = await resolveTransferContext(ctx, request, slug, headers)
  if (!transferContext.ok) return transferContext.response

  const parsed = await parseJsonPayload(request, headers)
  if (!parsed.ok) return parsed.response

  const toUserHandleRaw =
    typeof parsed.payload.toUserHandle === 'string' ? parsed.payload.toUserHandle.trim() : ''
  if (!toUserHandleRaw) return text('toUserHandle required', 400, headers)
  const message = typeof parsed.payload.message === 'string' ? parsed.payload.message : undefined

  try {
    const result = await ctx.runMutation(internal.skillTransfers.requestTransferInternal, {
      actorUserId: transferContext.userId,
      skillId: transferContext.skill._id,
      toUserHandle: toUserHandleRaw,
      message,
    })
    return json(result, 200, headers)
  } catch (error) {
    return transferErrorToResponse(error, headers)
  }
}

async function handleTransferDecision(
  ctx: ActionCtx,
  request: Request,
  slug: string,
  decision: TransferDecisionAction,
  headers: HeadersInit,
) {
  const transferContext = await resolveTransferContext(ctx, request, slug, headers)
  if (!transferContext.ok) return transferContext.response

  const pendingTransfer =
    decision === 'cancel'
      ? await ctx.runQuery(internal.skillTransfers.getPendingTransferBySkillAndFromUserInternal, {
          skillId: transferContext.skill._id,
          fromUserId: transferContext.userId,
        })
      : await ctx.runQuery(internal.skillTransfers.getPendingTransferBySkillAndUserInternal, {
          skillId: transferContext.skill._id,
          toUserId: transferContext.userId,
        })
  if (!pendingTransfer) return text('No pending transfer found', 404, headers)

  const mutation =
    decision === 'accept'
      ? internal.skillTransfers.acceptTransferInternal
      : decision === 'reject'
        ? internal.skillTransfers.rejectTransferInternal
        : internal.skillTransfers.cancelTransferInternal

  try {
    const result = await ctx.runMutation(mutation, {
      actorUserId: transferContext.userId,
      transferId: pendingTransfer._id,
    })
    return json(result, 200, headers)
  } catch (error) {
    return transferErrorToResponse(error, headers)
  }
}

async function handleSkillsTransferPost(
  ctx: ActionCtx,
  request: Request,
  segments: string[],
  headers: HeadersInit,
) {
  const slug = segments[0]?.trim().toLowerCase() ?? ''
  if (!slug) return text('Slug required', 400, headers)

  if (segments.length === 2) {
    return handleTransferRequest(ctx, request, slug, headers)
  }
  if (segments.length === 3) {
    const decision = segments[2]?.trim().toLowerCase()
    if (decision === 'accept' || decision === 'reject' || decision === 'cancel') {
      return handleTransferDecision(ctx, request, slug, decision, headers)
    }
  }
  return text('Not found', 404, headers)
}

export async function skillsPostRouterV1Handler(ctx: ActionCtx, request: Request) {
  const rate = await applyRateLimit(ctx, request, 'write')
  if (!rate.ok) return rate.response

  const segments = getPathSegments(request, '/api/v1/skills/')
  const action = segments[1] ?? ''

  if (segments.length === 2 && action === 'undelete') {
    const slug = segments[0]?.trim().toLowerCase() ?? ''
    try {
      const { userId } = await requireApiTokenUser(ctx, request)
      await ctx.runMutation(internal.skills.setSkillSoftDeletedInternal, {
        userId,
        slug,
        deleted: false,
      })
      return json({ ok: true }, 200, rate.headers)
    } catch (error) {
      return softDeleteErrorToResponse('skill', error, rate.headers)
    }
  }

  if (action === 'transfer') {
    return handleSkillsTransferPost(ctx, request, segments, rate.headers)
  }

  return text('Not found', 404, rate.headers)
}

export async function skillsDeleteRouterV1Handler(ctx: ActionCtx, request: Request) {
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
  } catch (error) {
    return softDeleteErrorToResponse('skill', error, rate.headers)
  }
}
