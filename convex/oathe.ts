import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { internalAction } from './_generated/server'

// ---------------------------------------------------------------------------
// Dimension label mapping
// ---------------------------------------------------------------------------

const DIMENSION_LABELS: Record<string, string> = {
  prompt_injection: 'Prompt Injection',
  data_exfiltration: 'Data Exfiltration',
  code_execution: 'Code Execution',
  clone_behavior: 'Clone Behavior',
  canary_integrity: 'Canary Integrity',
  behavioral_reasoning: 'Behavioral Reasoning',
}

// ---------------------------------------------------------------------------
// Score → rating mapping (matches LLM eval's getDimensionIcon thresholds)
// ---------------------------------------------------------------------------

function scoreToRating(score: number): string {
  if (score >= 80) return 'ok'
  if (score >= 50) return 'note'
  if (score >= 20) return 'concern'
  return 'danger'
}

// ---------------------------------------------------------------------------
// Verdict → status mapping
// ---------------------------------------------------------------------------

function verdictToStatus(verdict: string): string {
  switch (verdict.toUpperCase()) {
    case 'SAFE':
      return 'safe'
    case 'CAUTION':
      return 'caution'
    case 'DANGEROUS':
      return 'dangerous'
    case 'MALICIOUS':
      return 'malicious'
    default:
      return 'pending'
  }
}

// ---------------------------------------------------------------------------
// API response types
// ---------------------------------------------------------------------------

type OatheSubmitResponse = {
  audit_id: string
  queue_position?: number
  deduplicated?: boolean
}

type OatheCategoryScore = {
  score: number
  weight: number
  findings: string[]
}

type OatheFinding = {
  pattern_id: string
  dimension: string
  severity: string
  title: string
  description: string
  evidence_snippet: string
  score_impact: number
  sources: string[]
  agreement: string
}

type OatheReport = {
  audit_id: string
  skill_url: string
  skill_slug: string
  summary: string
  recommendation: string
  trust_score: number
  verdict: string
  category_scores: Record<string, OatheCategoryScore>
  findings: OatheFinding[]
}

type OatheSkillLatestResponse = {
  audit_id: string
  skill_url: string
  status: string
  report?: OatheReport
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapReportToAnalysis(
  report: OatheReport,
  slug: string,
): {
  status: string
  score: number
  verdict: string
  summary: string
  dimensions: Array<{ name: string; label: string; rating: string; detail: string }>
  reportUrl: string
  checkedAt: number
} {
  const dimensions = Object.entries(report.category_scores).map(([dimension, cat]) => ({
    name: dimension,
    label: DIMENSION_LABELS[dimension] ?? dimension,
    rating: scoreToRating(cat.score),
    detail:
      cat.findings.length > 0
        ? cat.findings[0]
        : `No issues detected. Score: ${cat.score}/100`,
  }))

  return {
    status: verdictToStatus(report.verdict),
    score: report.trust_score,
    verdict: report.verdict,
    summary: report.summary,
    dimensions,
    reportUrl: `https://oathe.ai/report/${slug}`,
    checkedAt: Date.now(),
  }
}

// ---------------------------------------------------------------------------
// Publish-time fire-and-forget submit
// ---------------------------------------------------------------------------

export const notifyOathe = internalAction({
  args: {
    versionId: v.id('skillVersions'),
  },
  handler: async (ctx, args) => {
    const apiUrl = process.env.OATHE_API_URL
    if (!apiUrl) {
      console.log('[oathe] OATHE_API_URL not configured, skipping scan')
      return
    }

    const version = (await ctx.runQuery(internal.skills.getVersionByIdInternal, {
      versionId: args.versionId,
    })) as Doc<'skillVersions'> | null

    if (!version) {
      console.error(`[oathe] Version ${args.versionId} not found`)
      return
    }

    const skill = (await ctx.runQuery(internal.skills.getSkillByIdInternal, {
      skillId: version.skillId,
    })) as Doc<'skills'> | null

    if (!skill) {
      console.error(`[oathe] Skill ${version.skillId} not found`)
      return
    }

    const skillUrl = `https://clawhub.ai/${skill.slug}`

    try {
      const response = await fetch(`${apiUrl}/api/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skill_url: skillUrl }),
      })

      if (response.ok || response.status === 429) {
        if (response.ok) {
          const result = (await response.json()) as OatheSubmitResponse
          console.log(
            `[oathe] Submitted ${skill.slug}: audit_id=${result.audit_id}${result.deduplicated ? ' (deduplicated)' : ''}`,
          )
        } else {
          console.warn(`[oathe] Rate-limited submitting ${skill.slug}, setting pending for cron`)
        }

        await ctx.runMutation(internal.skills.updateVersionOatheAnalysisInternal, {
          versionId: args.versionId,
          oatheAnalysis: {
            status: 'pending',
            checkedAt: Date.now(),
          },
        })
        return
      }

      const errorText = await response.text()
      console.error(`[oathe] Submit failed (${response.status}): ${errorText.slice(0, 200)}`)
      await ctx.runMutation(internal.skills.updateVersionOatheAnalysisInternal, {
        versionId: args.versionId,
        oatheAnalysis: {
          status: 'error',
          summary: `Submission failed: ${response.status}`,
          checkedAt: Date.now(),
        },
      })
    } catch (error) {
      console.error(`[oathe] Submit error for ${skill.slug}:`, error)
      await ctx.runMutation(internal.skills.updateVersionOatheAnalysisInternal, {
        versionId: args.versionId,
        oatheAnalysis: {
          status: 'error',
          summary: `Submission error: ${error instanceof Error ? error.message : String(error)}`,
          checkedAt: Date.now(),
        },
      })
    }
  },
})

// ---------------------------------------------------------------------------
// Cron action: batch-check pending Oathe results
// ---------------------------------------------------------------------------

const ONE_HOUR_MS = 60 * 60 * 1000
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000

export const fetchPendingOatheResults = internalAction({
  args: {
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const apiUrl = process.env.OATHE_API_URL
    if (!apiUrl) {
      console.log('[oathe:cron] OATHE_API_URL not configured, skipping')
      return { processed: 0, resolved: 0, resubmitted: 0, errors: 0 }
    }

    const batchSize = args.batchSize ?? 50

    const pendingSkills = (await ctx.runQuery(
      internal.skills.getSkillsPendingOatheInternal,
      { limit: batchSize, skipRecentMinutes: 8 },
    )) as Array<{
      skillId: Id<'skills'>
      versionId: Id<'skillVersions'>
      slug: string
      pendingSince: number
    }>

    if (pendingSkills.length === 0) {
      return { processed: 0, resolved: 0, resubmitted: 0, errors: 0 }
    }

    console.log(`[oathe:cron] Checking ${pendingSkills.length} pending skills`)

    let resolved = 0
    let resubmitted = 0
    let errors = 0

    for (const { versionId, slug, pendingSince } of pendingSkills) {
      const pendingAge = Date.now() - pendingSince

      try {
        const response = await fetch(`${apiUrl}/api/skill/${slug}/latest`)

        if (response.ok) {
          const data = (await response.json()) as OatheSkillLatestResponse

          if (data.status === 'complete' && data.report) {
            const analysis = mapReportToAnalysis(data.report, slug)
            await ctx.runMutation(internal.skills.updateVersionOatheAnalysisInternal, {
              versionId,
              oatheAnalysis: analysis,
            })
            console.log(
              `[oathe:cron] Resolved ${slug}: score=${analysis.score}, verdict=${analysis.verdict}`,
            )
            resolved++
            continue
          }
        }

        // 404 or non-complete response — escalate by age
        if (pendingAge > TWENTY_FOUR_HOURS_MS) {
          // > 24h: give up
          await ctx.runMutation(internal.skills.updateVersionOatheAnalysisInternal, {
            versionId,
            oatheAnalysis: {
              status: 'error',
              summary: 'Audit timed out after 24 hours',
              checkedAt: Date.now(),
            },
          })
          console.warn(`[oathe:cron] Timed out ${slug} after 24h`)
          errors++
        } else if (pendingAge > ONE_HOUR_MS) {
          // 1–24h: re-submit with force_rescan to bypass dedup
          try {
            const resubmitResponse = await fetch(`${apiUrl}/api/submit`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                skill_url: `https://clawhub.ai/${slug}`,
                force_rescan: true,
              }),
            })
            if (resubmitResponse.ok) {
              console.log(`[oathe:cron] Re-submitted ${slug} with force_rescan`)
            } else {
              console.warn(
                `[oathe:cron] Re-submit failed for ${slug}: ${resubmitResponse.status}`,
              )
            }
          } catch (resubmitError) {
            console.error(`[oathe:cron] Re-submit error for ${slug}:`, resubmitError)
          }

          // Reset checkedAt so we don't re-submit every cycle
          await ctx.runMutation(internal.skills.updateVersionOatheAnalysisInternal, {
            versionId,
            oatheAnalysis: {
              status: 'pending',
              checkedAt: Date.now(),
            },
          })
          resubmitted++
        } else {
          // < 1h: just update checkedAt, wait for next cycle
          await ctx.runMutation(internal.skills.updateVersionOatheAnalysisInternal, {
            versionId,
            oatheAnalysis: {
              status: 'pending',
              checkedAt: Date.now(),
            },
          })
        }
      } catch (error) {
        console.error(`[oathe:cron] Error checking ${slug}:`, error)
        errors++
      }
    }

    console.log(
      `[oathe:cron] Processed ${pendingSkills.length}: resolved=${resolved}, resubmitted=${resubmitted}, errors=${errors}`,
    )
    return { processed: pendingSkills.length, resolved, resubmitted, errors }
  },
})
