import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { action, internalAction, internalMutation } from './_generated/server'
import { buildDeterministicZip } from './lib/skillZip'

/**
 * Fix skills that have version.vtAnalysis but null skill.moderationReason.
 * This syncs the moderation reason from the cached VT results.
 */
export const fixNullModerationReasons = internalAction({
  args: { batchSize: v.optional(v.number()) },
  handler: async (ctx, args): Promise<FixNullModerationReasonsResult> => {
    const batchSize = args.batchSize ?? 100
    const skills: UnscannedActiveSkill[] = await ctx.runQuery(
      internal.skills.getUnscannedActiveSkillsInternal,
      { limit: batchSize },
    )

    if (skills.length === 0) {
      console.log('[vt:fixNull] No skills with null reason found')
      return { total: 0, fixed: 0, noVtAnalysis: 0 }
    }

    console.log(`[vt:fixNull] Checking ${skills.length} skills with null moderationReason`)

    let fixed = 0
    let noVtAnalysis = 0

    for (const { versionId, slug } of skills) {
      if (!versionId) continue

      const version = await ctx.runQuery(internal.skills.getVersionByIdInternal, { versionId })
      if (!version?.vtAnalysis || !version.sha256hash) {
        noVtAnalysis++
        continue
      }

      // Version has vtAnalysis - update the skill's moderationReason
      const status = version.vtAnalysis.status
      await ctx.runMutation(internal.skills.approveSkillByHashInternal, {
        sha256hash: version.sha256hash,
        scanner: 'vt',
        status,
      })
      fixed++
      console.log(`[vt:fixNull] Fixed ${slug} -> ${status}`)
    }

    const result: FixNullModerationReasonsResult = { total: skills.length, fixed, noVtAnalysis }
    console.log('[vt:fixNull] Complete:', result)
    return result
  },
})

export const logScanResultInternal = internalMutation({
  args: {
    type: v.union(v.literal('daily_rescan'), v.literal('backfill'), v.literal('pending_poll')),
    total: v.number(),
    updated: v.number(),
    unchanged: v.number(),
    errors: v.number(),
    flaggedSkills: v.optional(
      v.array(
        v.object({
          slug: v.string(),
          status: v.string(),
        }),
      ),
    ),
    durationMs: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert('vtScanLogs', {
      type: args.type,
      total: args.total,
      updated: args.updated,
      unchanged: args.unchanged,
      errors: args.errors,
      flaggedSkills: args.flaggedSkills,
      durationMs: args.durationMs,
      createdAt: Date.now(),
    })
  },
})

const BENIGN_VERDICTS = new Set(['benign', 'clean'])
const MALICIOUS_VERDICTS = new Set(['malicious'])
const SUSPICIOUS_VERDICTS = new Set(['suspicious'])

function normalizeVerdict(value?: string) {
  return value?.trim().toLowerCase() ?? ''
}

function verdictToStatus(verdict: string) {
  if (BENIGN_VERDICTS.has(verdict)) return 'clean'
  if (MALICIOUS_VERDICTS.has(verdict)) return 'malicious'
  if (SUSPICIOUS_VERDICTS.has(verdict)) return 'suspicious'
  return 'pending'
}

type VTAIResult = {
  category: string
  verdict: string
  analysis?: string
  source?: string
}

type VTFileResponse = {
  data: {
    attributes: {
      sha256: string
      crowdsourced_ai_results?: VTAIResult[]
      last_analysis_stats?: {
        malicious: number
        suspicious: number
        undetected: number
        harmless: number
      }
    }
  }
}

type ScanQueueHealth = {
  queueSize: number
  staleCount: number
  veryStaleCount: number
  oldestAgeMinutes: number
  healthy: boolean
}

type PendingScanSkill = {
  skillId: Id<'skills'>
  versionId: Id<'skillVersions'> | null
  sha256hash: string | null
  checkCount: number
}

type PollPendingScansResult = {
  processed: number
  updated: number
  staled?: number
  healthy: boolean
  queueSize?: number
}

type BackfillPendingScansResult =
  | {
      total: number
      updated: number
      rescansRequested: number
      noHash: number
      notInVT: number
      errors: number
      remaining: number
    }
  | { error: string }

type UnscannedActiveSkill = {
  skillId: Id<'skills'>
  versionId: Id<'skillVersions'>
  slug: string
}

type LegacyPendingScanSkill = {
  skillId: Id<'skills'>
  versionId: Id<'skillVersions'>
  slug: string
  hasHash: boolean
}

type ActiveSkillsMissingVTCache = {
  skillId: Id<'skills'>
  versionId: Id<'skillVersions'>
  sha256hash: string
  slug: string
}

type PendingVTSkill = {
  skillId: Id<'skills'>
  versionId: Id<'skillVersions'>
  slug: string
  sha256hash: string
}

type NullModerationStatusSkill = {
  skillId: Id<'skills'>
  slug: string
  moderationReason: string | undefined
}

type StaleModerationReasonSkill = {
  skillId: Id<'skills'>
  versionId: Id<'skillVersions'>
  slug: string
  currentReason: string
  vtStatus: string | null
}

type FixNullModerationReasonsResult = {
  total: number
  fixed: number
  noVtAnalysis: number
}

type ScanUnscannedSkillsResult =
  | { total: number; scanned: number; errors: number; durationMs?: number }
  | { error: string }

type ScanLegacySkillsResult =
  | { total: number; scanned: number; errors: number; alreadyHasHash?: number; durationMs?: number }
  | { error: string }

type BackfillActiveSkillsVTCacheResult =
  | { total: number; updated: number; noResults: number; errors: number; done: boolean }
  | { error: string }

type RequestReanalysisForPendingResult =
  | { total: number; requested: number; errors?: number; done: boolean }
  | { error: string }

type FixNullModerationStatusResult = { total: number; fixed: number; done: boolean }

type SyncModerationReasonsResult = {
  total: number
  synced: number
  noVtAnalysis: number
  done: boolean
}

export const fetchResults = action({
  args: {
    sha256hash: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    if (!args.sha256hash) {
      return { status: 'not_found' }
    }

    const apiKey = process.env.VT_API_KEY
    if (!apiKey) {
      return { status: 'error', message: 'VT_API_KEY not configured' }
    }

    try {
      const response = await fetch(`https://www.virustotal.com/api/v3/files/${args.sha256hash}`, {
        method: 'GET',
        headers: {
          'x-apikey': apiKey,
        },
      })

      if (response.status === 404) {
        return { status: 'not_found' }
      }

      if (!response.ok) {
        return { status: 'error' }
      }

      const data = (await response.json()) as VTFileResponse
      const aiResult = data.data.attributes.crowdsourced_ai_results?.find(
        (r) => r.category === 'code_insight',
      )

      const stats = data.data.attributes.last_analysis_stats
      let status = 'pending'

      if (aiResult?.verdict) {
        // Prioritize AI Analysis (Code Insight)
        status = verdictToStatus(normalizeVerdict(aiResult.verdict))
      } else if (stats) {
        // Fallback to AV engines
        if (stats.malicious > 0) {
          status = 'malicious'
        } else if (stats.suspicious > 0) {
          status = 'suspicious'
        } else if (stats.harmless > 0) {
          status = 'clean'
        }
      }

      return {
        status,
        source: aiResult?.verdict ? 'code_insight' : 'engines',
        url: `https://www.virustotal.com/gui/file/${args.sha256hash}`,
        metadata: {
          aiVerdict: aiResult?.verdict,
          aiAnalysis: aiResult?.analysis,
          aiSource: aiResult?.source,
          stats: stats,
        },
      }
    } catch (error) {
      console.error('Error fetching VT results:', error)
      return { status: 'error' }
    }
  },
})

export const scanWithVirusTotal = internalAction({
  args: {
    versionId: v.id('skillVersions'),
  },
  handler: async (ctx, args) => {
    const apiKey = process.env.VT_API_KEY
    if (!apiKey) {
      console.log('VT_API_KEY not configured, skipping scan')
      return
    }

    // Get the version details and files
    const version = await ctx.runQuery(internal.skills.getVersionByIdInternal, {
      versionId: args.versionId,
    })

    if (!version) {
      console.error(`Version ${args.versionId} not found for scanning`)
      return
    }

    // Fetch skill info for _meta.json
    const skill = await ctx.runQuery(internal.skills.getSkillByIdInternal, {
      skillId: version.skillId,
    })
    if (!skill) {
      console.error(`Skill ${version.skillId} not found for scanning`)
      return
    }

    // Build deterministic ZIP with stable meta (no version history).
    const entries: Array<{ path: string; bytes: Uint8Array }> = []
    for (const file of version.files) {
      const content = await ctx.storage.get(file.storageId)
      if (content) {
        const buffer = new Uint8Array(await content.arrayBuffer())
        entries.push({ path: file.path, bytes: buffer })
      }
    }

    if (entries.length === 0) {
      console.warn(`No files found for version ${args.versionId}, skipping scan`)
      return
    }

    const zipArray = buildDeterministicZip(entries, {
      ownerId: String(skill.ownerUserId),
      slug: skill.slug,
      version: version.version,
      publishedAt: version.createdAt,
    })

    // Calculate SHA-256 of the ZIP (this hash includes _meta.json)
    const hashBuffer = await crypto.subtle.digest('SHA-256', zipArray)
    const sha256hash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')

    // Update version with hash
    await ctx.runMutation(internal.skills.updateVersionScanResultsInternal, {
      versionId: args.versionId,
      sha256hash,
    })

    // Check if file already exists in VT and has AI analysis
    try {
      const existingFile = await checkExistingFile(apiKey, sha256hash)

      if (existingFile) {
        const aiResult = existingFile.data.attributes.crowdsourced_ai_results?.find(
          (r) => r.category === 'code_insight',
        )

        if (aiResult) {
          // File exists and has AI analysis - use the verdict
          const verdict = normalizeVerdict(aiResult.verdict)
          const status = verdictToStatus(verdict)
          console.log(
            `Version ${args.versionId} found in VT with AI analysis. Hash: ${sha256hash}. Verdict: ${verdict}`,
          )

          // Cache VT analysis in version
          await ctx.runMutation(internal.skills.updateVersionScanResultsInternal, {
            versionId: args.versionId,
            vtAnalysis: {
              status,
              verdict: aiResult.verdict,
              analysis: aiResult.analysis,
              source: aiResult.source,
              checkedAt: Date.now(),
            },
          })

          // VT finalizes moderation visibility for newly published versions.
          await ctx.runMutation(internal.skills.approveSkillByHashInternal, {
            sha256hash,
            scanner: 'vt',
            status,
          })
          return
        }

        // File exists but no AI analysis - need to upload for fresh scan
        console.log(
          `Version ${args.versionId} found in VT but no AI analysis. Hash: ${sha256hash}. Uploading...`,
        )
      } else {
        console.log(`Version ${args.versionId} not found in VT. Hash: ${sha256hash}. Uploading...`)
      }
    } catch (error) {
      console.error('Error checking existing file in VT:', error)
      // Continue to upload even if check fails
    }

    // Upload file to VirusTotal (v3 API)
    const formData = new FormData()
    const blob = new Blob([zipArray], { type: 'application/zip' })
    formData.append('file', blob, 'skill.zip')

    try {
      const response = await fetch('https://www.virustotal.com/api/v3/files', {
        method: 'POST',
        headers: {
          'x-apikey': apiKey,
        },
        body: formData,
      })

      if (!response.ok) {
        const error = await response.text()
        console.error('VirusTotal upload error:', error)
        return
      }

      const result = (await response.json()) as { data: { id: string } }
      console.log(
        `Successfully uploaded version ${args.versionId} to VT. Hash: ${sha256hash}. Analysis ID: ${result.data.id}`,
      )

      // Don't set moderation state to scanner.vt.pending here — the LLM eval
      // runs concurrently and will set the initial moderation state. VT only
      // updates moderation when it has an actual verdict (clean/suspicious/malicious).
    } catch (error) {
      console.error('Failed to upload to VirusTotal:', error)
    }
  },
})

/**
 * Poll for pending scans and update skill moderation status
 * Called by cron job to check VT results for skills awaiting scan
 */
export const pollPendingScans = internalAction({
  args: {
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<PollPendingScansResult> => {
    const apiKey = process.env.VT_API_KEY
    if (!apiKey) {
      console.log('[vt:pollPendingScans] VT_API_KEY not configured, skipping')
      return { processed: 0, updated: 0, healthy: false }
    }

    const batchSize = args.batchSize ?? 10

    // Check queue health
    // TODO: Setup webhook/notification (Slack, Discord, email) when queue is unhealthy
    const health: ScanQueueHealth = await ctx.runQuery(
      internal.skills.getScanQueueHealthInternal,
      {},
    )
    if (!health.healthy) {
      console.warn(
        `[vt:pollPendingScans] QUEUE UNHEALTHY: ${health.queueSize} pending, ${health.veryStaleCount} stale >24h, oldest ${health.oldestAgeMinutes}m`,
      )
    }

    // Get skills pending scan (randomized selection)
    const pendingSkills: PendingScanSkill[] = await ctx.runQuery(
      internal.skills.getPendingScanSkillsInternal,
      {
        limit: batchSize,
      },
    )

    if (pendingSkills.length === 0) {
      return { processed: 0, updated: 0, healthy: health.healthy, queueSize: health.queueSize }
    }

    console.log(
      `[vt:pollPendingScans] Checking ${pendingSkills.length} pending skills (queue: ${health.queueSize})`,
    )

    const MAX_CHECK_COUNT = 10 // After this many checks, mark as stale

    let updated = 0
    let staled = 0
    for (const { skillId, versionId, sha256hash, checkCount } of pendingSkills) {
      if (!versionId) {
        console.log(`[vt:pollPendingScans] Skill ${skillId} missing versionId, skipping`)
        continue
      }
      if (!sha256hash) {
        console.log(
          `[vt:pollPendingScans] Skill ${skillId} version ${versionId} has no hash, skipping`,
        )
        continue
      }

      // Track this check attempt
      await ctx.runMutation(internal.skills.updateScanCheckInternal, { skillId })

      try {
        const vtResult = await checkExistingFile(apiKey, sha256hash)
        if (!vtResult) {
          console.log(`[vt:pollPendingScans] Hash ${sha256hash} not found in VT yet`)
          // Check if we've exceeded max attempts — write stale vtAnalysis so it
          // drops out of the poll query without overwriting LLM moderationReason
          if (checkCount + 1 >= MAX_CHECK_COUNT) {
            console.warn(
              `[vt:pollPendingScans] Skill ${skillId} exceeded max checks, marking stale`,
            )
            await ctx.runMutation(internal.skills.updateVersionScanResultsInternal, {
              versionId,
              vtAnalysis: { status: 'stale', checkedAt: Date.now() },
            })
            staled++
          }
          continue
        }

        const aiResult = vtResult.data.attributes.crowdsourced_ai_results?.find(
          (r) => r.category === 'code_insight',
        )

        if (!aiResult) {
          // No Code Insight - trigger a rescan to get it
          console.log(
            `[vt:pollPendingScans] Hash ${sha256hash} has no Code Insight, requesting rescan`,
          )
          await requestRescan(apiKey, sha256hash)
          // Check if we've exceeded max attempts — write stale vtAnalysis so it
          // drops out of the poll query without overwriting LLM moderationReason
          if (checkCount + 1 >= MAX_CHECK_COUNT) {
            console.warn(
              `[vt:pollPendingScans] Skill ${skillId} exceeded max checks, marking stale`,
            )
            await ctx.runMutation(internal.skills.updateVersionScanResultsInternal, {
              versionId,
              vtAnalysis: { status: 'stale', checkedAt: Date.now() },
            })
            staled++
          }
          continue
        }

        // We have a verdict - update the skill
        const verdict = normalizeVerdict(aiResult.verdict)
        const status = verdictToStatus(verdict)

        console.log(
          `[vt:pollPendingScans] Hash ${sha256hash} verdict: ${verdict} -> status: ${status}`,
        )

        // Cache VT analysis in version
        await ctx.runMutation(internal.skills.updateVersionScanResultsInternal, {
          versionId,
          vtAnalysis: {
            status,
            verdict: aiResult.verdict,
            analysis: aiResult.analysis,
            source: aiResult.source,
            checkedAt: Date.now(),
          },
        })

        // VT finalizes moderation visibility for newly published versions.
        await ctx.runMutation(internal.skills.approveSkillByHashInternal, {
          sha256hash,
          scanner: 'vt',
          status,
        })
        updated++
      } catch (error) {
        console.error(`[vt:pollPendingScans] Error checking hash ${sha256hash}:`, error)
      }
    }

    console.log(
      `[vt:pollPendingScans] Processed ${pendingSkills.length}, updated ${updated}, staled ${staled}`,
    )
    return {
      processed: pendingSkills.length,
      updated,
      staled,
      healthy: health.healthy,
      queueSize: health.queueSize,
    }
  },
})

/**
 * Check if a file already exists in VirusTotal by hash
 */
async function checkExistingFile(
  apiKey: string,
  sha256hash: string,
): Promise<VTFileResponse | null> {
  const response = await fetch(`https://www.virustotal.com/api/v3/files/${sha256hash}`, {
    method: 'GET',
    headers: {
      'x-apikey': apiKey,
    },
  })

  if (response.status === 404) {
    // File not found in VT
    return null
  }

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`VT API error: ${response.status} - ${error}`)
  }

  return (await response.json()) as VTFileResponse
}

/**
 * Request a rescan of a file to trigger Code Insight analysis
 */
async function requestRescan(apiKey: string, sha256hash: string): Promise<boolean> {
  try {
    const response = await fetch(`https://www.virustotal.com/api/v3/files/${sha256hash}/analyse`, {
      method: 'POST',
      headers: {
        'x-apikey': apiKey,
      },
    })

    if (!response.ok) {
      console.error(`[vt:requestRescan] Failed for ${sha256hash}: ${response.status}`)
      return false
    }

    return true
  } catch (error) {
    console.error(`[vt:requestRescan] Error for ${sha256hash}:`, error)
    return false
  }
}

/**
 * Backfill function to process ALL pending skills at once
 * Run manually to clear backlog
 */
export const backfillPendingScans = internalAction({
  args: {
    triggerRescans: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<BackfillPendingScansResult> => {
    const apiKey = process.env.VT_API_KEY
    if (!apiKey) {
      console.log('[vt:backfill] VT_API_KEY not configured')
      return { error: 'VT_API_KEY not configured' }
    }

    const triggerRescans = args.triggerRescans ?? true

    // Get ALL pending skills (no limit)
    const pendingSkills: PendingScanSkill[] = await ctx.runQuery(
      internal.skills.getPendingScanSkillsInternal,
      {
        limit: 10000,
      },
    )

    console.log(`[vt:backfill] Found ${pendingSkills.length} pending skills`)

    let updated = 0
    let rescansRequested = 0
    let noHash = 0
    let notInVT = 0
    let errors = 0

    for (const { sha256hash } of pendingSkills) {
      if (!sha256hash) {
        noHash++
        continue
      }

      try {
        const vtResult = await checkExistingFile(apiKey, sha256hash)

        if (!vtResult) {
          notInVT++
          continue
        }

        const aiResult = vtResult.data.attributes.crowdsourced_ai_results?.find(
          (r) => r.category === 'code_insight',
        )

        if (!aiResult) {
          if (triggerRescans) {
            await requestRescan(apiKey, sha256hash)
            rescansRequested++
          }
          continue
        }

        // We have a verdict - update the skill
        const verdict = normalizeVerdict(aiResult.verdict)
        const status = verdictToStatus(verdict)

        await ctx.runMutation(internal.skills.approveSkillByHashInternal, {
          sha256hash,
          scanner: 'vt',
          status,
        })
        updated++
      } catch (error) {
        console.error(`[vt:backfill] Error for ${sha256hash}:`, error)
        errors++
      }
    }

    const result: BackfillPendingScansResult = {
      total: pendingSkills.length,
      updated,
      rescansRequested,
      noHash,
      notInVT,
      errors,
      remaining: pendingSkills.length - updated,
    }

    console.log('[vt:backfill] Complete:', result)
    return result
  },
})

/**
 * Daily re-scan of ALL active skills to detect verdict changes.
 * Cursor-based: processes one batch per invocation and self-schedules the next.
 * Cron calls with {} to start from the beginning; subsequent batches pass accumulated totals.
 * API budget: 25k hourly / 100k daily calls.
 */
export const rescanActiveSkills = internalAction({
  args: {
    cursor: v.optional(v.number()),
    batchSize: v.optional(v.number()),
    accTotal: v.optional(v.number()),
    accUpdated: v.optional(v.number()),
    accUnchanged: v.optional(v.number()),
    accErrors: v.optional(v.number()),
    accFlaggedSkills: v.optional(v.array(v.object({ slug: v.string(), status: v.string() }))),
    startTime: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const startTime = args.startTime ?? Date.now()
    const apiKey = process.env.VT_API_KEY
    if (!apiKey) {
      console.log('[vt:rescan] VT_API_KEY not configured')
      return { error: 'VT_API_KEY not configured' }
    }

    const batchSize = args.batchSize ?? 100
    const cursor = args.cursor ?? 0
    let accTotal = args.accTotal ?? 0
    let accUpdated = args.accUpdated ?? 0
    let accUnchanged = args.accUnchanged ?? 0
    let accErrors = args.accErrors ?? 0
    const accFlaggedSkills = [...(args.accFlaggedSkills ?? [])]

    const batch = await ctx.runQuery(internal.skills.getActiveSkillBatchForRescanInternal, {
      cursor,
      batchSize,
    })

    if (batch.skills.length === 0 && accTotal === 0) {
      console.log('[vt:rescan] No active skills to re-scan')
      return { total: 0, updated: 0, unchanged: 0, errors: 0 }
    }

    console.log(
      `[vt:rescan] Processing batch of ${batch.skills.length} skills (cursor=${cursor}, accumulated=${accTotal})`,
    )

    for (const { versionId, sha256hash, slug, wasFlagged } of batch.skills) {
      try {
        const vtResult = await checkExistingFile(apiKey, sha256hash)

        if (!vtResult) {
          accErrors++
          continue
        }

        const aiResult = vtResult.data.attributes.crowdsourced_ai_results?.find(
          (r) => r.category === 'code_insight',
        )

        if (!aiResult) {
          await ctx.runMutation(internal.skills.updateVersionScanResultsInternal, {
            versionId,
            vtAnalysis: {
              status: 'pending',
              checkedAt: Date.now(),
            },
          })
          accUnchanged++
          continue
        }

        const verdict = normalizeVerdict(aiResult.verdict)
        const status = verdictToStatus(verdict)

        await ctx.runMutation(internal.skills.updateVersionScanResultsInternal, {
          versionId,
          vtAnalysis: {
            status,
            verdict: aiResult.verdict,
            analysis: aiResult.analysis,
            source: aiResult.source,
            checkedAt: Date.now(),
          },
        })

        if (status === 'malicious' || status === 'suspicious') {
          console.warn(`[vt:rescan] ${slug}: verdict changed to ${status}!`)
          accFlaggedSkills.push({ slug, status })
          await ctx.runMutation(internal.skills.escalateByVtInternal, {
            sha256hash,
            status,
          })
          accUpdated++
        } else if (wasFlagged) {
          // Verdict improved from suspicious → clean: clear the stale moderation flag
          console.log(`[vt:rescan] ${slug}: verdict improved to clean, clearing suspicious flag`)
          await ctx.runMutation(internal.skills.approveSkillByHashInternal, {
            sha256hash,
            scanner: 'vt',
            status,
          })
          accUpdated++
        } else {
          accUnchanged++
        }
      } catch (error) {
        console.error(`[vt:rescan] Error for ${slug}:`, error)
        accErrors++
      }
    }

    accTotal += batch.skills.length

    if (!batch.done) {
      // Schedule next batch
      console.log(
        `[vt:rescan] Scheduling next batch (cursor=${batch.nextCursor}, total so far=${accTotal})`,
      )
      await ctx.scheduler.runAfter(0, internal.vt.rescanActiveSkills, {
        cursor: batch.nextCursor,
        batchSize,
        accTotal,
        accUpdated,
        accUnchanged,
        accErrors,
        accFlaggedSkills: accFlaggedSkills.length > 0 ? accFlaggedSkills : undefined,
        startTime,
      })
      return { status: 'continuing', totalSoFar: accTotal }
    }

    // Final batch — log results
    const durationMs = Date.now() - startTime

    await ctx.runMutation(internal.vt.logScanResultInternal, {
      type: 'daily_rescan',
      total: accTotal,
      updated: accUpdated,
      unchanged: accUnchanged,
      errors: accErrors,
      flaggedSkills: accFlaggedSkills.length > 0 ? accFlaggedSkills : undefined,
      durationMs,
    })

    const result = {
      total: accTotal,
      updated: accUpdated,
      unchanged: accUnchanged,
      errors: accErrors,
      durationMs,
    }
    console.log('[vt:rescan] Complete:', result)
    return result
  },
})

/**
 * Scan all unscanned skills (active with null moderationReason).
 * These completely bypassed VT and need immediate scanning.
 */
export const scanUnscannedSkills = internalAction({
  args: { batchSize: v.optional(v.number()) },
  handler: async (ctx, args): Promise<ScanUnscannedSkillsResult> => {
    const startTime = Date.now()
    const apiKey = process.env.VT_API_KEY
    if (!apiKey) {
      console.log('[vt:scanUnscanned] VT_API_KEY not configured')
      return { error: 'VT_API_KEY not configured' }
    }

    const batchSize = args.batchSize ?? 50
    const skills: UnscannedActiveSkill[] = await ctx.runQuery(
      internal.skills.getUnscannedActiveSkillsInternal,
      { limit: batchSize },
    )

    if (skills.length === 0) {
      console.log('[vt:scanUnscanned] No unscanned skills found')
      return { total: 0, scanned: 0, errors: 0 }
    }

    console.log(`[vt:scanUnscanned] Scanning ${skills.length} unscanned skills`)

    let scanned = 0
    let errors = 0

    for (const { versionId, slug } of skills) {
      if (!versionId) {
        errors++
        continue
      }

      try {
        await ctx.runAction(internal.vt.scanWithVirusTotal, { versionId })
        scanned++
        console.log(`[vt:scanUnscanned] Scanned ${slug} (${scanned}/${skills.length})`)
      } catch (error) {
        console.error(`[vt:scanUnscanned] Error scanning ${slug}:`, error)
        errors++
      }
    }

    const durationMs = Date.now() - startTime

    await ctx.runMutation(internal.vt.logScanResultInternal, {
      type: 'backfill',
      total: skills.length,
      updated: scanned,
      unchanged: 0,
      errors,
      durationMs,
    })

    const result: ScanUnscannedSkillsResult = { total: skills.length, scanned, errors, durationMs }
    console.log('[vt:scanUnscanned] Complete:', result)
    return result
  },
})

/**
 * Scan all legacy skills (active but still have pending.scan reason).
 * These are skills approved before VT integration that need proper scanning.
 */
export const scanLegacySkills = internalAction({
  args: { batchSize: v.optional(v.number()) },
  handler: async (ctx, args): Promise<ScanLegacySkillsResult> => {
    const startTime = Date.now()
    const apiKey = process.env.VT_API_KEY
    if (!apiKey) {
      console.log('[vt:scanLegacy] VT_API_KEY not configured')
      return { error: 'VT_API_KEY not configured' }
    }

    const batchSize = args.batchSize ?? 100
    const skills: LegacyPendingScanSkill[] = await ctx.runQuery(
      internal.skills.getLegacyPendingScanSkillsInternal,
      { limit: batchSize },
    )

    if (skills.length === 0) {
      console.log('[vt:scanLegacy] No legacy skills to scan')
      return { total: 0, scanned: 0, errors: 0 }
    }

    console.log(`[vt:scanLegacy] Scanning ${skills.length} legacy skills`)

    let scanned = 0
    let alreadyHasHash = 0
    let errors = 0

    for (const { versionId, slug, hasHash } of skills) {
      if (!versionId) {
        errors++
        continue
      }

      try {
        if (hasHash) {
          // Already has hash, just need to check VT and update reason
          alreadyHasHash++
        }

        // Trigger VT scan (will upload if needed, check for results)
        await ctx.runAction(internal.vt.scanWithVirusTotal, { versionId })
        scanned++
        console.log(`[vt:scanLegacy] Scanned ${slug} (${scanned}/${skills.length})`)
      } catch (error) {
        console.error(`[vt:scanLegacy] Error scanning ${slug}:`, error)
        errors++
      }
    }

    const durationMs = Date.now() - startTime

    await ctx.runMutation(internal.vt.logScanResultInternal, {
      type: 'backfill',
      total: skills.length,
      updated: scanned,
      unchanged: alreadyHasHash,
      errors,
      durationMs,
    })

    const result: ScanLegacySkillsResult = {
      total: skills.length,
      scanned,
      alreadyHasHash,
      errors,
      durationMs,
    }
    console.log('[vt:scanLegacy] Complete:', result)
    return result
  },
})

/**
 * Backfill vtAnalysis for active skills that have VT results but no cached data.
 * This covers highlighted skills and others approved before VT integration.
 * Processes in batches with self-scheduling to drain the backlog.
 */
export const backfillActiveSkillsVTCache = internalAction({
  args: { batchSize: v.optional(v.number()) },
  handler: async (ctx, args): Promise<BackfillActiveSkillsVTCacheResult> => {
    const apiKey = process.env.VT_API_KEY
    if (!apiKey) {
      console.log('[vt:backfillActive] VT_API_KEY not configured')
      return { error: 'VT_API_KEY not configured' }
    }

    const batchSize = args.batchSize ?? 100

    const skills: ActiveSkillsMissingVTCache[] = await ctx.runQuery(
      internal.skills.getActiveSkillsMissingVTCacheInternal,
      { limit: batchSize },
    )

    console.log(`[vt:backfillActive] Found ${skills.length} active skills missing VT cache`)

    if (skills.length === 0) {
      return { total: 0, updated: 0, noResults: 0, errors: 0, done: true }
    }

    let updated = 0
    let noResults = 0
    let errors = 0

    for (const { versionId, sha256hash, slug } of skills) {
      try {
        const vtResult = await checkExistingFile(apiKey, sha256hash)

        if (!vtResult) {
          console.log(`[vt:backfillActive] ${slug}: not in VT`)
          noResults++
          continue
        }

        const aiResult = vtResult.data.attributes.crowdsourced_ai_results?.find(
          (r) => r.category === 'code_insight',
        )

        if (!aiResult) {
          console.log(`[vt:backfillActive] ${slug}: no Code Insight yet`)
          noResults++
          continue
        }

        // Update the version with VT analysis
        const verdict = normalizeVerdict(aiResult.verdict)
        const status = verdictToStatus(verdict)

        await ctx.runMutation(internal.skills.updateVersionScanResultsInternal, {
          versionId,
          sha256hash,
          vtAnalysis: {
            status,
            verdict: aiResult.verdict,
            analysis: aiResult.analysis,
            source: aiResult.source,
            checkedAt: Date.now(),
          },
        })

        console.log(`[vt:backfillActive] ${slug}: updated with ${status}`)
        updated++
      } catch (error) {
        console.error(`[vt:backfillActive] Error for ${slug}:`, error)
        errors++
      }
    }

    const done = skills.length < batchSize
    const result: BackfillActiveSkillsVTCacheResult = {
      total: skills.length,
      updated,
      noResults,
      errors,
      done,
    }
    console.log('[vt:backfillActive] Complete:', result)

    // Self-schedule next batch if there are more skills to process
    if (!done) {
      console.log('[vt:backfillActive] Scheduling next batch...')
      await ctx.scheduler.runAfter(0, internal.vt.backfillActiveSkillsVTCache, { batchSize })
    }

    return result
  },
})

/**
 * Request VT reanalysis for skills stuck at scanner.vt.pending.
 * This pushes them to the front of VT's Code Insight queue.
 */
export const requestReanalysisForPending = internalAction({
  args: { batchSize: v.optional(v.number()) },
  handler: async (ctx, args): Promise<RequestReanalysisForPendingResult> => {
    const apiKey = process.env.VT_API_KEY
    if (!apiKey) {
      console.log('[vt:requestReanalysis] VT_API_KEY not configured')
      return { error: 'VT_API_KEY not configured' }
    }

    const batchSize = args.batchSize ?? 100

    // Get skills with scanner.vt.pending moderationReason
    const skills: PendingVTSkill[] = await ctx.runQuery(
      internal.skills.getPendingVTSkillsInternal,
      { limit: batchSize },
    )

    if (skills.length === 0) {
      console.log('[vt:requestReanalysis] No pending skills found')
      return { total: 0, requested: 0, done: true }
    }

    console.log(`[vt:requestReanalysis] Found ${skills.length} skills to request reanalysis`)

    let requested = 0
    let errors = 0

    for (const { slug, sha256hash } of skills) {
      try {
        const success = await requestRescan(apiKey, sha256hash)
        if (success) {
          console.log(`[vt:requestReanalysis] ${slug}: rescan requested`)
          requested++
        } else {
          errors++
        }
      } catch (error) {
        console.error(`[vt:requestReanalysis] ${slug}: error`, error)
        errors++
      }
    }

    const result: RequestReanalysisForPendingResult = {
      total: skills.length,
      requested,
      errors,
      done: skills.length < batchSize,
    }
    console.log('[vt:requestReanalysis] Complete:', result)
    return result
  },
})

/**
 * Fix skills with null moderationStatus by setting them to 'active'.
 */
export const fixNullModerationStatus = internalAction({
  args: { batchSize: v.optional(v.number()) },
  handler: async (ctx, args): Promise<FixNullModerationStatusResult> => {
    const batchSize = args.batchSize ?? 100

    const skills: NullModerationStatusSkill[] = await ctx.runQuery(
      internal.skills.getSkillsWithNullModerationStatusInternal,
      { limit: batchSize },
    )

    if (skills.length === 0) {
      console.log('[vt:fixNullStatus] No skills with null status found')
      return { total: 0, fixed: 0, done: true }
    }

    console.log(`[vt:fixNullStatus] Found ${skills.length} skills with null moderationStatus`)

    for (const { skillId, slug: _slug } of skills) {
      await ctx.runMutation(internal.skills.setSkillModerationStatusActiveInternal, { skillId })
    }

    console.log(`[vt:fixNullStatus] Fixed ${skills.length} skills`)
    return { total: skills.length, fixed: skills.length, done: skills.length < batchSize }
  },
})

/**
 * Sync moderationReason for skills that have vtAnalysis cached but stale moderationReason.
 * This updates skills stuck at 'scanner.vt.pending' or 'pending.scan' to match their cached vtAnalysis.
 */
export const syncModerationReasons = internalAction({
  args: { batchSize: v.optional(v.number()) },
  handler: async (ctx, args): Promise<SyncModerationReasonsResult> => {
    const batchSize = args.batchSize ?? 100

    const skills: StaleModerationReasonSkill[] = await ctx.runQuery(
      internal.skills.getSkillsWithStaleModerationReasonInternal,
      { limit: batchSize },
    )

    if (skills.length === 0) {
      console.log('[vt:syncModeration] No stale skills found')
      return { total: 0, synced: 0, noVtAnalysis: 0, done: true }
    }

    console.log(`[vt:syncModeration] Found ${skills.length} skills with stale moderationReason`)

    let synced = 0
    let noVtAnalysis = 0

    for (const { skillId, versionId: _versionId, slug, currentReason, vtStatus } of skills) {
      if (!vtStatus) {
        noVtAnalysis++
        continue
      }

      // Map vtAnalysis.status to moderationReason
      const newReason = `scanner.vt.${vtStatus}` as const

      await ctx.runMutation(internal.skills.updateSkillModerationReasonInternal, {
        skillId,
        moderationReason: newReason,
      })

      console.log(`[vt:syncModeration] ${slug}: ${currentReason} -> ${newReason}`)
      synced++
    }

    const result: SyncModerationReasonsResult = {
      total: skills.length,
      synced,
      noVtAnalysis,
      done: skills.length < batchSize,
    }
    console.log('[vt:syncModeration] Complete:', result)
    return result
  },
})
