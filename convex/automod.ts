import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { internalAction, internalMutation, internalQuery } from './_generated/server'

const CURSOR_KEY = 'skills'
const DEFAULT_BATCH_SIZE = 25
const MAX_BATCH_SIZE = 100
const DEFAULT_MAX_BATCHES = 4
const MAX_MAX_BATCHES = 10
const OPENAI_AUTOMOD_MODEL = process.env.OPENAI_AUTOMOD_MODEL ?? 'gpt-4.1-mini'

const SUSPICIOUS_EXTENSIONS = ['.exe', '.dll', '.bat', '.cmd', '.ps1', '.scr', '.com', '.msi']
const SUSPICIOUS_PHRASES: Array<{ label: string; pattern: RegExp }> = [
  { label: 'free-nitro', pattern: /free\s+nitro/i },
  { label: 'steam-gift', pattern: /steam\s+gift|free\s+steam\s+wallet/i },
  { label: 'token-grabber', pattern: /token\s+grabber|token\s+stealer/i },
  { label: 'wallet-seed', pattern: /seed\s+phrase|wallet\s+drainer|crypto\s+airdrop/i },
  { label: 'credential-harvest', pattern: /passwords?\s+stealer|credential\s+harvest/i },
  { label: 'piracy', pattern: /crack(ed)?\s+version|license\s+key\s+generator/i },
]

function clampInt(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function extractResponseText(payload: unknown) {
  if (!payload || typeof payload !== 'object') return null
  const output = (payload as { output?: unknown }).output
  if (!Array.isArray(output)) return null
  const chunks: string[] = []
  for (const item of output) {
    if (!item || typeof item !== 'object') continue
    const content = (item as { content?: unknown }).content
    if (!Array.isArray(content)) continue
    for (const part of content) {
      if (!part || typeof part !== 'object') continue
      if ((part as { type?: unknown }).type !== 'output_text') continue
      const text = (part as { text?: unknown }).text
      if (typeof text === 'string' && text.trim()) chunks.push(text)
    }
  }
  const joined = chunks.join('\n').trim()
  return joined || null
}

function buildSkillText(skill: Doc<'skills'>, version: Doc<'skillVersions'> | null) {
  const metadata = version?.parsed?.metadata ? JSON.stringify(version.parsed.metadata) : ''
  const frontmatter = version?.parsed?.frontmatter ? JSON.stringify(version.parsed.frontmatter) : ''
  const filePaths = version?.files?.map((file) => file.path).join('\n') ?? ''
  return [skill.slug, skill.displayName, skill.summary ?? '', metadata, frontmatter, filePaths]
    .filter(Boolean)
    .join('\n')
}

function scanSkillLocally(skill: Doc<'skills'>, version: Doc<'skillVersions'> | null) {
  const findings: string[] = []
  const filePaths = version?.files?.map((file) => file.path.toLowerCase()) ?? []
  const matchedExtensions = new Set<string>()

  for (const filePath of filePaths) {
    for (const extension of SUSPICIOUS_EXTENSIONS) {
      if (filePath.endsWith(extension)) {
        matchedExtensions.add(extension)
      }
    }
  }

  if (matchedExtensions.size > 0) {
    findings.push(`bundled executables (${Array.from(matchedExtensions).join(', ')})`)
  }

  const text = buildSkillText(skill, version)
  for (const rule of SUSPICIOUS_PHRASES) {
    if (rule.pattern.test(text)) {
      findings.push(`phrase:${rule.label}`)
    }
  }

  return findings
}

async function classifyWithOpenAI(args: {
  skill: Doc<'skills'>
  version: Doc<'skillVersions'> | null
}) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null

  const input = [
    `Skill: ${args.skill.slug}`,
    `Display name: ${args.skill.displayName}`,
    args.skill.summary ? `Summary: ${args.skill.summary}` : null,
    `Latest version: ${args.version?.version ?? 'unknown'}`,
    args.version?.files?.length
      ? `Files: ${args.version.files
          .map((file) => file.path)
          .slice(0, 80)
          .join(', ')}`
      : 'Files: none',
  ]
    .filter(Boolean)
    .join('\n')

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_AUTOMOD_MODEL,
      instructions:
        'You are helping a marketplace moderator detect malware/scams in skill bundles. ' +
        'Return a JSON object with {"flag": boolean, "reason": string}. ' +
        'Flag true only if the input strongly suggests malware/scams (executables, credential theft, scams). ' +
        'Keep reason short and factual. Return only JSON.',
      input,
      max_output_tokens: 120,
    }),
  })

  if (!response.ok) return null
  const payload = (await response.json()) as unknown
  const text = extractResponseText(payload)
  if (!text) return null
  try {
    const parsed = JSON.parse(text) as { flag?: boolean; reason?: string }
    if (typeof parsed.flag !== 'boolean') return null
    return parsed
  } catch {
    return null
  }
}

export const getSkillAutomodCursorInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const cursor = await ctx.db
      .query('automodCursors')
      .withIndex('by_key', (q) => q.eq('key', CURSOR_KEY))
      .unique()
    return cursor?.cursorUpdatedAt ?? null
  },
})

export const setSkillAutomodCursorInternal = internalMutation({
  args: { cursorUpdatedAt: v.number() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('automodCursors')
      .withIndex('by_key', (q) => q.eq('key', CURSOR_KEY))
      .unique()
    if (existing) {
      await ctx.db.patch(existing._id, {
        cursorUpdatedAt: args.cursorUpdatedAt,
        updatedAt: Date.now(),
      })
      return
    }
    await ctx.db.insert('automodCursors', {
      key: CURSOR_KEY,
      cursorUpdatedAt: args.cursorUpdatedAt,
      updatedAt: Date.now(),
    })
  },
})

export const getSkillAutomodBatchInternal = internalQuery({
  args: {
    cursorUpdatedAt: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = clampInt(args.limit ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE)
    const cursor = args.cursorUpdatedAt ?? 0
    return ctx.db
      .query('skills')
      .withIndex('by_updated', (q) => (cursor ? q.gt('updatedAt', cursor) : q))
      .order('asc')
      .take(limit)
  },
})

export const runSkillAutomodInternal: ReturnType<typeof internalAction> = internalAction({
  args: {
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    | { ok: true; processed: number; reported: number; cursorUpdatedAt: number }
    | { ok: false; reason: string }
  > => {
    const automodUserId = process.env.AUTOMOD_USER_ID as Id<'users'> | undefined
    if (!automodUserId) {
      return { ok: false as const, reason: 'AUTOMOD_USER_ID not configured' }
    }

    const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE)
    const maxBatches = clampInt(args.maxBatches ?? DEFAULT_MAX_BATCHES, 1, MAX_MAX_BATCHES)
    let cursorUpdatedAt: number =
      (await ctx.runQuery(internal.automod.getSkillAutomodCursorInternal, {})) ?? 0

    let batches = 0
    let processed = 0
    let reported = 0

    while (batches < maxBatches) {
      const skills = (await ctx.runQuery(internal.automod.getSkillAutomodBatchInternal, {
        cursorUpdatedAt,
        limit: batchSize,
      })) as Doc<'skills'>[]

      if (skills.length === 0) break

      for (const skill of skills) {
        if (skill.softDeletedAt) {
          cursorUpdatedAt = Math.max(cursorUpdatedAt, skill.updatedAt)
          continue
        }

        const version = skill.latestVersionId
          ? ((await ctx.runQuery(internal.skills.getVersionByIdInternal, {
              versionId: skill.latestVersionId,
            })) as Doc<'skillVersions'> | null)
          : null

        const findings = scanSkillLocally(skill, version)
        let reason: string | null = null

        if (findings.length > 0) {
          reason = `Automod heuristic flagged: ${findings.join(', ')}`
        } else {
          const aiResult = await classifyWithOpenAI({ skill, version })
          if (aiResult?.flag) {
            reason = `Automod AI flagged: ${aiResult.reason ?? 'suspicious content'}`
          }
        }

        if (reason) {
          const result = (await ctx.runMutation(internal.skills.reportInternal, {
            skillId: skill._id,
            userId: automodUserId,
            reason,
          })) as { reported: boolean }
          if (result.reported) reported += 1
        }

        cursorUpdatedAt = Math.max(cursorUpdatedAt, skill.updatedAt)
        processed += 1
      }

      await ctx.runMutation(internal.automod.setSkillAutomodCursorInternal, { cursorUpdatedAt })
      batches += 1
      if (skills.length < batchSize) break
    }

    return { ok: true as const, processed, reported, cursorUpdatedAt }
  },
})
