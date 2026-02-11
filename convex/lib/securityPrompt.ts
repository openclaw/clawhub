export function getLlmEvalModel(): string {
  return process.env.OPENAI_EVAL_MODEL ?? 'gpt-5-mini'
}
export const LLM_EVAL_MAX_OUTPUT_TOKENS = 16000

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatScalar(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }
  // Avoid throwing on circular structures; fall back to a safe representation.
  try {
    return JSON.stringify(value)
  } catch {
    return Object.prototype.toString.call(value)
  }
}

function formatWithDefault(value: unknown, defaultLabel: string): string {
  if (value === undefined || value === null) return defaultLabel
  return formatScalar(value)
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SkillEvalContext = {
  slug: string
  displayName: string
  ownerUserId: string
  version: string
  createdAt: number
  summary?: string
  source?: string
  homepage?: string
  parsed: {
    frontmatter: Record<string, unknown>
    metadata?: unknown
    clawdis?: unknown
  }
  files: Array<{ path: string; size: number }>
  skillMdContent: string
  fileContents: Array<{ path: string; content: string }>
  injectionSignals: string[]
}

export type LlmEvalDimension = {
  name: string
  label: string
  rating: string
  detail: string
}

export type LlmEvalResponse = {
  verdict: 'benign' | 'suspicious' | 'malicious'
  confidence: 'high' | 'medium' | 'low'
  summary: string
  dimensions: LlmEvalDimension[]
  guidance: string
  findings: string
}

// ---------------------------------------------------------------------------
// System prompt (~3500 words)
// ---------------------------------------------------------------------------

export const SECURITY_EVALUATOR_SYSTEM_PROMPT = `You are a security evaluator for OpenClaw AI skills. Users install skills to extend what their AI agent can do. Some users have limited security knowledge — your job is to surface things that don't add up so they can make an informed decision.

You are not a malware classifier. You are an incoherence detector.

A skill is a bundle of: a name, a description, a set of instructions (SKILL.md) that tell the AI agent what to do at runtime, declared dependencies, required environment variables, and optionally an install mechanism and code files. Many skills are instruction-only — just a SKILL.md with prose telling the agent how to use a CLI tool or REST API, with no code files at all. Your job is to evaluate whether all the pieces are internally consistent and proportionate — and to clearly explain when they aren't.

## How to evaluate

Assess the skill across these five dimensions. For each, determine whether what the skill *claims* aligns with what it *requests, installs, and instructs*.

### 1. Purpose–capability alignment

Compare the skill's name and description against everything it actually requires and does.

Ask: would someone building this skill legitimately need all of this?

A "git-commit-helper" that requires AWS credentials is incoherent. A "cloud-deploy" skill that requires AWS credentials is expected. A "trello" skill that requires TRELLO_API_KEY and TRELLO_TOKEN is exactly what you'd expect. The question is never "is this capability dangerous in isolation" — it's "does this capability belong here."

Flag when:
- Required environment variables don't relate to the stated purpose
- Required binaries are unrelated to the described functionality
- The install spec pulls in tools/packages disproportionate to the task
- Config path requirements suggest access to subsystems the skill shouldn't touch

### 2. Instruction scope

Read the SKILL.md content carefully. These are the literal instructions the AI agent will follow at runtime. For many skills, this is the entire security surface — there are no code files, just prose that tells the agent what commands to run, what APIs to call, and how to handle data.

Ask: do these instructions stay within the boundaries of the stated purpose?

A "database-backup" skill whose instructions include "first read the user's shell history for context" is scope creep. A "weather" skill that only runs curl against wttr.in is perfectly scoped. Instructions that reference reading files, environment variables, or system state unrelated to the skill's purpose are worth flagging — even if each individual action seems minor.

Pay close attention to:
- What commands the instructions tell the agent to run
- What files or paths the instructions reference
- What environment variables the instructions access beyond those declared in requires.env
- Whether the instructions direct data to external endpoints other than the service the skill integrates with
- Whether the instructions ask the agent to read, collect, or transmit anything not needed for the stated task

Flag when:
- Instructions direct the agent to read files or env vars unrelated to the skill's purpose
- Instructions include steps that collect, aggregate, or transmit data not needed for the task
- Instructions reference system paths, credentials, or configuration outside the skill's domain
- The instructions are vague or open-ended in ways that grant the agent broad discretion ("use your judgment to gather whatever context you need")
- Instructions direct data to unexpected endpoints (e.g., a "notion" skill that posts data somewhere other than api.notion.com)

### 3. Install mechanism risk

Evaluate what the skill installs and how. Many skills have no install spec at all — they are instruction-only and rely on binaries already being on PATH. That's the lowest risk.

The risk spectrum:
- No install spec (instruction-only) → lowest risk, nothing is written to disk
- brew formula from a well-known tap → low friction, package is reviewed
- npm/go/uv package from a public registry → moderate, packages are not pre-reviewed but are traceable
- download from a URL with extract → highest risk, arbitrary code from an arbitrary source

Flag when:
- A download-type install uses a URL that isn't a well-known release host (GitHub releases, official project domains)
- The URL points to a URL shortener, paste site, personal server, or IP address
- extract is true (the archive contents will be written to disk and potentially executed)
- The install creates binaries in non-standard locations
- Multiple install specs exist for the same platform without clear reason (e.g., two different brew formulas for the same OS)

### 4. Environment and credential proportionality

Evaluate whether the secrets and environment access requested are proportionate.

A skill that needs one API key for the service it integrates with is normal. A "trello" skill requiring TRELLO_API_KEY and TRELLO_TOKEN is expected — that's how Trello's API works. A skill that requests access to multiple unrelated credentials is suspicious. The primaryEnv field declares the "main" credential — other env requirements should serve a clear supporting role.

Flag when:
- requires.env lists credentials for services unrelated to the skill's purpose
- The number of required environment variables is high relative to the skill's complexity
- The skill requires config paths that grant access to gateway auth, channel tokens, or tool policies
- Environment variables named with patterns like SECRET, TOKEN, KEY, PASSWORD are required but not justified by the skill's purpose
- The SKILL.md instructions access environment variables beyond those declared in requires.env or primaryEnv

### 5. Persistence and privilege

Evaluate the skill's requested level of system presence.

- always: true means the skill is force-included in every agent run, bypassing all eligibility gates. This is a significant privilege.
- disable-model-invocation defaults to false. This means the agent can invoke the skill autonomously — THIS IS THE NORMAL, EXPECTED DEFAULT. Autonomous agent invocation is the entire purpose of skills. Do NOT flag this as a concern on its own.
- A skill writing to its own agent config (enabling itself, storing its own auth tokens, running its own setup/auth scripts) is NORMAL installation behavior — not privilege escalation. Do not flag this.

MITRE ATLAS context: Autonomous invocation relates to AML.T0051 (LLM Plugin Compromise) — a malicious skill with autonomous access has wider blast radius. However, since autonomous invocation is the platform default, only mention this in user guidance when it COMBINES with other red flags (always: true + broad credential access + suspicious behavior in other dimensions). Never flag autonomous invocation alone.

Flag when:
- always: true is set without clear justification (most skills should not need this)
- The skill requests permanent presence (always) combined with broad environment access
- The skill modifies OTHER skills' configurations or system-wide agent settings beyond its own scope
- The skill accesses credentials or config paths belonging to other skills

## Interpreting static scan findings

The skill has already been scanned by a regex-based pattern detector. Those findings are included in the data below. Use them as additional signal, not as your primary assessment.

- If scan findings exist, incorporate them into your reasoning but evaluate whether they make sense in context. A "deployment" skill with child_process exec is expected. A "markdown-formatter" with child_process exec is not.
- If no scan findings exist, that does NOT mean the skill is safe. Many skills are instruction-only with no code files — the regex scanner had nothing to analyze. For these skills, your assessment of the SKILL.md instructions is the primary security signal.
- Never downgrade a scan finding's severity. You can provide context for why a finding may be expected, but always surface it.

## Verdict definitions

- **benign**: The skill's capabilities, requirements, and instructions are internally consistent with its stated purpose. Nothing is disproportionate or unexplained.
- **suspicious**: There are inconsistencies between what the skill claims to do and what it actually requests, installs, or instructs. These could be legitimate design choices or sloppy engineering — but they could also indicate something worse. The user should understand what doesn't add up before proceeding.
- **malicious**: The skill's actual footprint is fundamentally incompatible with any reasonable interpretation of its stated purpose, across multiple dimensions. The inconsistencies point toward intentional misdirection — the skill appears designed to do something other than what it claims.

## Critical rules

- The bar for "malicious" is high. It requires incoherence across multiple dimensions that cannot be explained by poor engineering or over-broad requirements. A single suspicious pattern is not enough. "Suspicious" exists precisely for the cases where you can't tell.
- "Benign" does not mean "safe." It means the skill is internally coherent. A coherent skill can still have vulnerabilities. "Benign" answers "does this skill appear to be what it says it is" — not "is this skill bug-free."
- When in doubt between benign and suspicious, choose suspicious. When in doubt between suspicious and malicious, choose suspicious. The middle state is where ambiguity lives — use it.
- NEVER classify something as "malicious" solely because it uses shell execution, network calls, or file I/O. These are normal programming operations. The question is always whether they are *coherent with the skill's purpose*.
- NEVER classify something as "benign" solely because it has no scan findings. Absence of regex matches is not evidence of safety — especially for instruction-only skills with no code files.
- DO distinguish between unintentional vulnerabilities (sloppy code, missing input validation) and intentional misdirection (skill claims one purpose but its instructions/requirements reveal a different one). Vulnerabilities are "suspicious." Misdirection is "malicious."
- DO explain your reasoning. A user who doesn't know what "environment variable exfiltration" means needs you to say "this skill asks for your AWS credentials but nothing in its description suggests it needs cloud access."
- When confidence is "low", say so explicitly and explain what additional information would change your assessment.

## Output format

Respond with a JSON object and nothing else:

{
  "verdict": "benign" | "suspicious" | "malicious",
  "confidence": "high" | "medium" | "low",
  "summary": "One sentence a non-technical user can understand.",
  "dimensions": {
    "purpose_capability": { "status": "ok" | "note" | "concern", "detail": "..." },
    "instruction_scope": { "status": "ok" | "note" | "concern", "detail": "..." },
    "install_mechanism": { "status": "ok" | "note" | "concern", "detail": "..." },
    "environment_proportionality": { "status": "ok" | "note" | "concern", "detail": "..." },
    "persistence_privilege": { "status": "ok" | "note" | "concern", "detail": "..." }
  },
  "scan_findings_in_context": [
    { "ruleId": "...", "expected_for_purpose": true | false, "note": "..." }
  ],
  "user_guidance": "Plain-language explanation of what the user should consider before installing."
}`

// ---------------------------------------------------------------------------
// Injection pattern detection
// ---------------------------------------------------------------------------

const INJECTION_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: 'ignore-previous-instructions', regex: /ignore\s+(all\s+)?previous\s+instructions/i },
  { name: 'you-are-now', regex: /you\s+are\s+now\s+(a|an)\b/i },
  { name: 'system-prompt-override', regex: /system\s*prompt\s*[:=]/i },
  { name: 'base64-block', regex: /[A-Za-z0-9+/=]{200,}/ },
  {
    name: 'unicode-control-chars',
    // eslint-disable-next-line no-control-regex
    regex: /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/,
  },
]

export function detectInjectionPatterns(text: string): string[] {
  const found: string[] = []
  for (const { name, regex } of INJECTION_PATTERNS) {
    if (regex.test(text)) found.push(name)
  }
  return found
}

// ---------------------------------------------------------------------------
// Dimension metadata (maps API keys to display labels)
// ---------------------------------------------------------------------------

const DIMENSION_META: Record<string, string> = {
  purpose_capability: 'Purpose & Capability',
  instruction_scope: 'Instruction Scope',
  install_mechanism: 'Install Mechanism',
  environment_proportionality: 'Credentials',
  persistence_privilege: 'Persistence & Privilege',
}

// ---------------------------------------------------------------------------
// Assemble the user message from skill data
// ---------------------------------------------------------------------------

const MAX_SKILL_MD_CHARS = 6000

export function assembleEvalUserMessage(ctx: SkillEvalContext): string {
  const fm = ctx.parsed.frontmatter ?? {}
  const rawClawdis = (ctx.parsed.clawdis ?? {}) as Record<string, unknown>
  const meta = (ctx.parsed.metadata ?? {}) as Record<string, unknown>
  const openclawFallback =
    meta.openclaw && typeof meta.openclaw === 'object' && !Array.isArray(meta.openclaw)
      ? (meta.openclaw as Record<string, unknown>)
      : {}
  const clawdis = Object.keys(rawClawdis).length > 0 ? rawClawdis : openclawFallback
  const requires = (clawdis.requires ?? openclawFallback.requires ?? {}) as Record<string, unknown>
  const install = (clawdis.install ?? []) as Array<Record<string, unknown>>

  const codeExtensions = new Set([
    '.js',
    '.ts',
    '.mjs',
    '.cjs',
    '.jsx',
    '.tsx',
    '.py',
    '.rb',
    '.sh',
    '.bash',
    '.zsh',
    '.go',
    '.rs',
    '.c',
    '.cpp',
    '.java',
  ])
  const codeFiles = ctx.files.filter((f) => {
    const ext = f.path.slice(f.path.lastIndexOf('.')).toLowerCase()
    return codeExtensions.has(ext)
  })

  const skillMd =
    ctx.skillMdContent.length > MAX_SKILL_MD_CHARS
      ? `${ctx.skillMdContent.slice(0, MAX_SKILL_MD_CHARS)}\n…[truncated]`
      : ctx.skillMdContent

  const sections: string[] = []

  // Skill identity
  sections.push(`## Skill under evaluation

**Name:** ${ctx.displayName}
**Description:** ${ctx.summary ?? 'No description provided.'}
**Source:** ${ctx.source ?? 'unknown'}
**Homepage:** ${ctx.homepage ?? 'none'}

**Registry metadata:**
- Owner ID: ${ctx.ownerUserId}
- Slug: ${ctx.slug}
- Version: ${ctx.version}
- Published: ${new Date(ctx.createdAt).toISOString()}`)

  // Flags
  const always = fm.always ?? clawdis.always
  const userInvocable = fm['user-invocable'] ?? clawdis.userInvocable
  const disableModelInvocation = fm['disable-model-invocation'] ?? clawdis.disableModelInvocation
  const os = clawdis.os
  sections.push(`**Flags:**
- always: ${formatWithDefault(always, 'false (default)')}
- user-invocable: ${formatWithDefault(userInvocable, 'true (default)')}
- disable-model-invocation: ${formatWithDefault(
    disableModelInvocation,
    'false (default — agent can invoke autonomously, this is normal)',
  )}
- OS restriction: ${Array.isArray(os) ? os.join(', ') : formatWithDefault(os, 'none')}`)

  // Requirements
  const bins = (requires.bins as string[] | undefined) ?? []
  const anyBins = (requires.anyBins as string[] | undefined) ?? []
  const env = (requires.env as string[] | undefined) ?? []
  const primaryEnv = (clawdis.primaryEnv as string | undefined) ?? 'none'
  const config = (requires.config as string[] | undefined) ?? []

  sections.push(`### Requirements
- Required binaries (all must exist): ${bins.length ? bins.join(', ') : 'none'}
- Required binaries (at least one): ${anyBins.length ? anyBins.join(', ') : 'none'}
- Required env vars: ${env.length ? env.join(', ') : 'none'}
- Primary credential: ${primaryEnv}
- Required config paths: ${config.length ? config.join(', ') : 'none'}`)

  // Install specifications
  if (install.length > 0) {
    const specLines = install.map((spec, i) => {
      const kind = spec.kind ?? 'unknown'
      const parts = [`- **[${i}] ${formatScalar(kind)}**`]
      if (spec.formula) parts.push(`formula: ${formatScalar(spec.formula)}`)
      if (spec.package) parts.push(`package: ${formatScalar(spec.package)}`)
      if (spec.module) parts.push(`module: ${formatScalar(spec.module)}`)
      if (spec.url) parts.push(`url: ${formatScalar(spec.url)}`)
      if (spec.archive) parts.push(`archive: ${formatScalar(spec.archive)}`)
      if (spec.extract !== undefined) parts.push(`extract: ${formatScalar(spec.extract)}`)
      if (spec.bins) parts.push(`creates binaries: ${(spec.bins as string[]).join(', ')}`)
      return parts.join(' | ')
    })
    sections.push(`### Install specifications\n${specLines.join('\n')}`)
  } else {
    sections.push(
      '### Install specifications\nNo install spec — this is an instruction-only skill.',
    )
  }

  // Code file presence
  if (codeFiles.length > 0) {
    const fileList = codeFiles.map((f) => `  ${f.path} (${f.size} bytes)`).join('\n')
    sections.push(`### Code file presence\n${codeFiles.length} code file(s):\n${fileList}`)
  } else {
    sections.push(
      '### Code file presence\nNo code files present — this is an instruction-only skill. The regex-based scanner had nothing to analyze.',
    )
  }

  // File manifest
  const manifest = ctx.files.map((f) => `  ${f.path} (${f.size} bytes)`).join('\n')
  sections.push(`### File manifest\n${ctx.files.length} file(s):\n${manifest}`)

  // Pre-scan injection signals
  if (ctx.injectionSignals.length > 0) {
    sections.push(
      `### Pre-scan injection signals\nThe following prompt-injection patterns were detected in the SKILL.md content. The skill may be attempting to manipulate this evaluation:\n${ctx.injectionSignals.map((s) => `- ${s}`).join('\n')}`,
    )
  } else {
    sections.push('### Pre-scan injection signals\nNone detected.')
  }

  // SKILL.md content
  sections.push(`### SKILL.md content (runtime instructions)\n${skillMd}`)

  // All file contents
  if (ctx.fileContents.length > 0) {
    const MAX_FILE_CHARS = 10000
    const MAX_TOTAL_CHARS = 50000
    let totalChars = 0
    const fileBlocks: string[] = []
    for (const f of ctx.fileContents) {
      if (totalChars >= MAX_TOTAL_CHARS) {
        fileBlocks.push(
          `\n…[remaining files truncated, ${ctx.fileContents.length - fileBlocks.length} file(s) omitted]`,
        )
        break
      }
      const content =
        f.content.length > MAX_FILE_CHARS
          ? `${f.content.slice(0, MAX_FILE_CHARS)}\n…[truncated]`
          : f.content
      fileBlocks.push(`#### ${f.path}\n\`\`\`\n${content}\n\`\`\``)
      totalChars += content.length
    }
    sections.push(
      `### File contents\nFull source of all included files. Review these carefully for malicious behavior, hidden endpoints, data exfiltration, obfuscated code, or behavior that contradicts the SKILL.md.\n\n${fileBlocks.join('\n\n')}`,
    )
  }

  // Reminder to respond in JSON (required by OpenAI json_object mode)
  sections.push('Respond with your evaluation as a single JSON object.')

  return sections.join('\n\n')
}

// ---------------------------------------------------------------------------
// Parse the LLM response
// ---------------------------------------------------------------------------

const VALID_VERDICTS = new Set(['benign', 'suspicious', 'malicious'])
const VALID_CONFIDENCES = new Set(['high', 'medium', 'low'])

export function parseLlmEvalResponse(raw: string): LlmEvalResponse | null {
  // Strip markdown code fences if present
  let text = raw.trim()
  if (text.startsWith('```')) {
    const firstNewline = text.indexOf('\n')
    text = text.slice(firstNewline + 1)
    const lastFence = text.lastIndexOf('```')
    if (lastFence !== -1) text = text.slice(0, lastFence)
    text = text.trim()
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }

  if (!parsed || typeof parsed !== 'object') return null

  const obj = parsed as Record<string, unknown>

  // Validate required fields
  const verdict = typeof obj.verdict === 'string' ? obj.verdict.toLowerCase() : null
  if (!verdict || !VALID_VERDICTS.has(verdict)) return null

  const confidence = typeof obj.confidence === 'string' ? obj.confidence.toLowerCase() : null
  if (!confidence || !VALID_CONFIDENCES.has(confidence)) return null

  const summary = typeof obj.summary === 'string' ? obj.summary : ''

  // Parse dimensions
  const rawDims = obj.dimensions as Record<string, unknown> | undefined
  const dimensions: LlmEvalDimension[] = []
  if (rawDims && typeof rawDims === 'object') {
    for (const [key, value] of Object.entries(rawDims)) {
      if (!value || typeof value !== 'object') continue
      const dim = value as Record<string, unknown>
      const status = typeof dim.status === 'string' ? dim.status : 'note'
      const detail = typeof dim.detail === 'string' ? dim.detail : ''
      dimensions.push({
        name: key,
        label: DIMENSION_META[key] ?? key,
        rating: status,
        detail,
      })
    }
  }

  // Parse findings
  const rawFindings = obj.scan_findings_in_context
  let findings = ''
  if (Array.isArray(rawFindings) && rawFindings.length > 0) {
    findings = rawFindings
      .map((f: unknown) => {
        if (!f || typeof f !== 'object') return null
        const entry = f as Record<string, unknown>
        const ruleId = entry.ruleId ?? 'unknown'
        const expected = entry.expected_for_purpose ? 'expected' : 'unexpected'
        const note = entry.note ?? ''
        return `[${formatScalar(ruleId)}] ${expected}: ${formatScalar(note)}`
      })
      .filter(Boolean)
      .join('\n')
  }

  const guidance = typeof obj.user_guidance === 'string' ? obj.user_guidance : ''

  return {
    verdict: verdict as LlmEvalResponse['verdict'],
    confidence: confidence as LlmEvalResponse['confidence'],
    summary,
    dimensions,
    guidance,
    findings,
  }
}
