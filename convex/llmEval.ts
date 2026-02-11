import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { internalAction } from './_generated/server'
import type { SkillEvalContext } from './lib/securityPrompt'
import {
  assembleEvalUserMessage,
  detectInjectionPatterns,
  getLlmEvalModel,
  LLM_EVAL_MAX_OUTPUT_TOKENS,
  parseLlmEvalResponse,
  SECURITY_EVALUATOR_SYSTEM_PROMPT,
} from './lib/securityPrompt'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractResponseText(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const output = (payload as { output?: unknown }).output
  if (!Array.isArray(output)) return null
  const chunks: string[] = []
  for (const item of output) {
    if (!item || typeof item !== 'object') continue
    if ((item as { type?: unknown }).type !== 'message') continue
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

function verdictToStatus(verdict: string): string {
  switch (verdict) {
    case 'benign':
      return 'clean'
    case 'malicious':
      return 'malicious'
    case 'suspicious':
      return 'suspicious'
    default:
      return 'pending'
  }
}

// ---------------------------------------------------------------------------
// Publish-time evaluation action
// ---------------------------------------------------------------------------

export const evaluateWithLlm = internalAction({
  args: {
    versionId: v.id('skillVersions'),
  },
  handler: async (ctx, args) => {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      console.log('[llmEval] OPENAI_API_KEY not configured, skipping evaluation')
      return
    }

    const model = getLlmEvalModel()

    // Store error helper
    const storeError = async (message: string) => {
      console.error(`[llmEval] ${message}`)
      await ctx.runMutation(internal.skills.updateVersionLlmAnalysisInternal, {
        versionId: args.versionId,
        llmAnalysis: {
          status: 'error',
          summary: message,
          model,
          checkedAt: Date.now(),
        },
      })
    }

    // 1. Fetch version
    const version = (await ctx.runQuery(internal.skills.getVersionByIdInternal, {
      versionId: args.versionId,
    })) as Doc<'skillVersions'> | null

    if (!version) {
      await storeError(`Version ${args.versionId} not found`)
      return
    }

    // 2. Fetch skill
    const skill = (await ctx.runQuery(internal.skills.getSkillByIdInternal, {
      skillId: version.skillId,
    })) as Doc<'skills'> | null

    if (!skill) {
      await storeError(`Skill ${version.skillId} not found`)
      return
    }

    // 3. Read SKILL.md content
    const skillMdFile = version.files.find((f) => {
      const lower = f.path.toLowerCase()
      return lower === 'skill.md' || lower === 'skills.md'
    })

    let skillMdContent = ''
    if (skillMdFile) {
      const blob = await ctx.storage.get(skillMdFile.storageId as Id<'_storage'>)
      if (blob) {
        skillMdContent = await blob.text()
      }
    }

    if (!skillMdContent) {
      await storeError('No SKILL.md content found')
      return
    }

    // 4. Read all file contents
    const fileContents: Array<{ path: string; content: string }> = []
    for (const f of version.files) {
      const lower = f.path.toLowerCase()
      if (lower === 'skill.md' || lower === 'skills.md') continue
      try {
        const blob = await ctx.storage.get(f.storageId as Id<'_storage'>)
        if (blob) {
          fileContents.push({ path: f.path, content: await blob.text() })
        }
      } catch {
        // Skip files that can't be read
      }
    }

    // 5. Detect injection patterns across ALL content
    const allContent = [skillMdContent, ...fileContents.map((f) => f.content)].join('\n')
    const injectionSignals = detectInjectionPatterns(allContent)

    // 6. Build eval context
    const parsed = version.parsed as SkillEvalContext['parsed']
    const fm = parsed.frontmatter ?? {}

    const evalCtx: SkillEvalContext = {
      slug: skill.slug,
      displayName: skill.displayName,
      ownerUserId: String(skill.ownerUserId),
      version: version.version,
      createdAt: version.createdAt,
      summary: (skill.summary as string | undefined) ?? undefined,
      source: (fm.source as string | undefined) ?? undefined,
      homepage: (fm.homepage as string | undefined) ?? undefined,
      parsed,
      files: version.files.map((f) => ({ path: f.path, size: f.size })),
      skillMdContent,
      fileContents,
      injectionSignals,
    }

    // 6. Assemble user message
    const userMessage = assembleEvalUserMessage(evalCtx)

    // 7. Call OpenAI Responses API (with retry for rate limits)
    const MAX_RETRIES = 3
    let raw: string | null = null
    try {
      const body = JSON.stringify({
        model,
        instructions: SECURITY_EVALUATOR_SYSTEM_PROMPT,
        input: userMessage,
        max_output_tokens: LLM_EVAL_MAX_OUTPUT_TOKENS,
        text: {
          format: {
            type: 'json_object',
          },
        },
      })

      let response: Response | null = null
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        response = await fetch('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body,
        })

        if (response.status === 429 || response.status >= 500) {
          if (attempt < MAX_RETRIES) {
            const delay = 2 ** attempt * 2000 + Math.random() * 1000
            console.log(
              `[llmEval] Rate limited (${response.status}), retrying in ${Math.round(delay)}ms (attempt ${attempt + 1}/${MAX_RETRIES})`,
            )
            await new Promise((r) => setTimeout(r, delay))
            continue
          }
        }
        break
      }

      if (!response || !response.ok) {
        const errorText = response ? await response.text() : 'No response'
        await storeError(`OpenAI API error (${response?.status}): ${errorText.slice(0, 200)}`)
        return
      }

      const payload = (await response.json()) as unknown
      raw = extractResponseText(payload)
    } catch (error) {
      await storeError(
        `OpenAI API call failed: ${error instanceof Error ? error.message : String(error)}`,
      )
      return
    }

    if (!raw) {
      await storeError('Empty response from OpenAI')
      return
    }

    // 8. Parse response
    const result = parseLlmEvalResponse(raw)

    if (!result) {
      console.error(`[llmEval] Raw response (first 500 chars): ${raw.slice(0, 500)}`)
      await storeError('Failed to parse LLM evaluation response')
      return
    }

    // 9. Store result
    await ctx.runMutation(internal.skills.updateVersionLlmAnalysisInternal, {
      versionId: args.versionId,
      llmAnalysis: {
        status: verdictToStatus(result.verdict),
        verdict: result.verdict,
        confidence: result.confidence,
        summary: result.summary,
        dimensions: result.dimensions,
        guidance: result.guidance,
        findings: result.findings || undefined,
        model,
        checkedAt: Date.now(),
      },
    })

    console.log(
      `[llmEval] Evaluated ${skill.slug}@${version.version}: ${result.verdict} (${result.confidence} confidence)`,
    )

    // 10. Update moderation flags if version has a sha256hash
    if (version.sha256hash) {
      const status = verdictToStatus(result.verdict)
      if (status === 'malicious' || status === 'suspicious' || status === 'clean') {
        await ctx.runMutation(internal.skills.approveSkillByHashInternal, {
          sha256hash: version.sha256hash,
          scanner: 'llm',
          status,
        })
      }
    }
  },
})

// ---------------------------------------------------------------------------
// Convenience: evaluate a single skill by slug (for testing / manual runs)
// Usage: npx convex run llmEval:evaluateBySlug '{"slug": "transcribeexx"}'
// ---------------------------------------------------------------------------

export const evaluateBySlug = internalAction({
  args: {
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    const skill = (await ctx.runQuery(internal.skills.getSkillBySlugInternal, {
      slug: args.slug,
    })) as Doc<'skills'> | null

    if (!skill) {
      console.error(`[llmEval:bySlug] Skill "${args.slug}" not found`)
      return { error: 'Skill not found' }
    }

    if (!skill.latestVersionId) {
      console.error(`[llmEval:bySlug] Skill "${args.slug}" has no published version`)
      return { error: 'No published version' }
    }

    console.log(`[llmEval:bySlug] Evaluating ${args.slug} (versionId: ${skill.latestVersionId})`)

    await ctx.scheduler.runAfter(0, internal.llmEval.evaluateWithLlm, {
      versionId: skill.latestVersionId,
    })

    return { ok: true, slug: args.slug, versionId: skill.latestVersionId }
  },
})

// ---------------------------------------------------------------------------
// Backfill action (Phase 2)
// Schedules individual evaluateWithLlm actions for each skill in the batch,
// then self-schedules the next batch. Each eval runs as its own action
// invocation so we don't hit Convex action timeouts.
// ---------------------------------------------------------------------------

export const backfillLlmEval = internalAction({
  args: {
    cursor: v.optional(v.number()),
    batchSize: v.optional(v.number()),
    accTotal: v.optional(v.number()),
    accScheduled: v.optional(v.number()),
    accSkipped: v.optional(v.number()),
    startTime: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const startTime = args.startTime ?? Date.now()
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      console.log('[llmEval:backfill] OPENAI_API_KEY not configured')
      return { error: 'OPENAI_API_KEY not configured' }
    }

    const batchSize = args.batchSize ?? 25
    const cursor = args.cursor ?? 0
    let accTotal = args.accTotal ?? 0
    let accScheduled = args.accScheduled ?? 0
    let accSkipped = args.accSkipped ?? 0

    const batch = await ctx.runQuery(internal.skills.getActiveSkillBatchForLlmBackfillInternal, {
      cursor,
      batchSize,
    })

    if (batch.skills.length === 0 && batch.done) {
      console.log('[llmEval:backfill] No more skills to evaluate')
      return { total: accTotal, scheduled: accScheduled, skipped: accSkipped }
    }

    console.log(
      `[llmEval:backfill] Processing batch of ${batch.skills.length} skills (cursor=${cursor}, accumulated=${accTotal})`,
    )

    for (const { versionId, slug } of batch.skills) {
      // Re-evaluate all (full file content reading upgrade)
      const version = (await ctx.runQuery(internal.skills.getVersionByIdInternal, {
        versionId,
      })) as Doc<'skillVersions'> | null

      if (!version) {
        accSkipped++
        continue
      }

      // Schedule each evaluation as a separate action invocation
      await ctx.scheduler.runAfter(0, internal.llmEval.evaluateWithLlm, { versionId })
      accScheduled++
      console.log(`[llmEval:backfill] Scheduled eval for ${slug}`)
    }

    accTotal += batch.skills.length

    if (!batch.done) {
      // Delay the next batch slightly to avoid overwhelming the scheduler
      // when all evals from this batch are also running
      console.log(
        `[llmEval:backfill] Scheduling next batch (cursor=${batch.nextCursor}, total so far=${accTotal})`,
      )
      await ctx.scheduler.runAfter(5_000, internal.llmEval.backfillLlmEval, {
        cursor: batch.nextCursor,
        batchSize,
        accTotal,
        accScheduled,
        accSkipped,
        startTime,
      })
      return { status: 'continuing', totalSoFar: accTotal }
    }

    const durationMs = Date.now() - startTime
    const result = {
      total: accTotal,
      scheduled: accScheduled,
      skipped: accSkipped,
      durationMs,
    }
    console.log('[llmEval:backfill] Complete:', result)
    return result
  },
})
