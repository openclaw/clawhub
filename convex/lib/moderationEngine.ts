import type { Doc, Id } from '../_generated/dataModel'
import {
  isExternallyClearableSuspiciousCode,
  legacyFlagsFromVerdict,
  MODERATION_ENGINE_VERSION,
  normalizeReasonCodes,
  type ModerationFinding,
  REASON_CODES,
  type ScannerModerationVerdict,
  summarizeReasonCodes,
  type ModerationVerdict,
  verdictFromCodes,
} from './moderationReasonCodes'

type TextFile = { path: string; content: string }

export type StaticScanInput = {
  slug: string
  displayName: string
  summary?: string
  frontmatter: Record<string, unknown>
  metadata?: unknown
  files: Array<{ path: string; size: number }>
  fileContents: TextFile[]
}

export type StaticScanResult = {
  status: ScannerModerationVerdict
  reasonCodes: string[]
  findings: ModerationFinding[]
  summary: string
  engineVersion: string
  checkedAt: number
}

export type ModerationSnapshot = {
  verdict: ScannerModerationVerdict
  reasonCodes: string[]
  evidence: ModerationFinding[]
  metadataCodes: string[]
  signals: ModerationSignals
  summary: string
  engineVersion: string
  evaluatedAt: number
  sourceVersionId?: Id<'skillVersions'>
  legacyFlags?: string[]
}

export type ModerationSignalState = 'ready' | 'pending' | 'error' | 'not_applicable'
export type ModerationSignalFamily = 'local' | 'vt' | 'llm' | 'behavioral' | 'trust' | 'manual'
export type ModerationSignalContribution =
  | 'decisive'
  | 'corroborating'
  | 'suppressed'
  | 'informational'
  | 'none'
export type ModerationSignalKey =
  | 'staticScan'
  | 'vtEngines'
  | 'vtCodeInsight'
  | 'llmScan'
  | 'behavioralScan'
  | 'publisherTrust'
  | 'manualOverride'

export type ModerationSignalSummary = {
  key: ModerationSignalKey
  family: ModerationSignalFamily
  state: ModerationSignalState
  verdict?: ModerationVerdict
  contribution: ModerationSignalContribution
  reasonCodes: string[]
  metadataCodes?: string[]
  suppressedReasonCodes?: string[]
  summary?: string
  rationale?: string
  checkedAt?: number
  details?: unknown
}

export type ModerationSignals = Partial<Record<ModerationSignalKey, ModerationSignalSummary>>

const MANIFEST_EXTENSION = /\.(json|yaml|yml|toml)$/i
const MARKDOWN_EXTENSION = /\.(md|markdown|mdx)$/i
const CODE_EXTENSION = /\.(js|ts|mjs|cjs|mts|cts|jsx|tsx|py|sh|bash|zsh|rb|go)$/i
const STANDARD_PORTS = new Set([80, 443, 8080, 8443, 3000])
const HTTP_URL_PATTERN = /https?:\/\/([a-z0-9.-]+\.[a-z]{2,})(?::\d+)?/gi
const SECRET_ENV_PATTERN =
  /process\.env\.([A-Z0-9_]+)|os\.getenv\(\s*["']([A-Z0-9_]+)["']\s*\)|os\.environ(?:\.get)?\(\s*["']([A-Z0-9_]+)["']\s*\)/g
const GENERIC_HOST_TOKENS = new Set([
  'api',
  'app',
  'cdn',
  'com',
  'co',
  'dev',
  'io',
  'net',
  'openapi',
  'org',
  'stage',
  'staging',
  'test',
  'v1',
  'v2',
  'v3',
  'www',
])
const SECRET_ENV_SUFFIXES = [
  '_API_KEY',
  '_ACCESS_TOKEN',
  '_AUTH_TOKEN',
  '_TOKEN',
  '_SECRET',
  '_PASSWORD',
  '_PASS',
  '_CREDENTIALS',
]
const NON_SECRET_ENV_NAMES = new Set([
  'HOME',
  'PATH',
  'PWD',
  'SHELL',
  'BASE_URL',
  'API_BASE',
  'API_BASE_URL',
  'HOST',
  'PORT',
  'NODE_ENV',
])
const GENERIC_BRAND_TOKENS = new Set([
  'api',
  'access',
  'auth',
  'bearer',
  'client',
  'key',
  'password',
  'secret',
  'service',
  'session',
  'token',
])

type SecretEnvHit = {
  envName: string
  brandToken: string
}

type HostHit = {
  file: string
  line: number
  host: string
  evidence: string
  hasCredentialSendContext: boolean
}

const CREDENTIAL_SEND_CONTEXT_PATTERN =
  /\b(authorization|bearer|x-api-key|api[_-]?key|access[_-]?token|auth[_-]?token|password|secret)\b/i

function truncateEvidence(evidence: string, maxLen = 160) {
  if (evidence.length <= maxLen) return evidence
  return `${evidence.slice(0, maxLen)}...`
}

function addFinding(
  findings: ModerationFinding[],
  finding: Omit<ModerationFinding, 'evidence'> & { evidence: string },
) {
  findings.push({ ...finding, evidence: truncateEvidence(finding.evidence.trim()) })
}

function findFirstLine(content: string, pattern: RegExp) {
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    if (pattern.test(lines[i])) {
      return { line: i + 1, text: lines[i] }
    }
  }
  return { line: 1, text: lines[0] ?? '' }
}

function scanCodeFile(path: string, content: string, findings: ModerationFinding[]) {
  if (!CODE_EXTENSION.test(path)) return

  const hasChildProcess = /child_process/.test(content)
  const execPattern = /\b(exec|execSync|spawn|spawnSync|execFile|execFileSync)\s*\(/
  if (hasChildProcess && execPattern.test(content)) {
    const match = findFirstLine(content, execPattern)
    addFinding(findings, {
      code: REASON_CODES.DANGEROUS_EXEC,
      severity: 'critical',
      file: path,
      line: match.line,
      message: 'Shell command execution detected (child_process).',
      evidence: match.text,
    })
  }

  if (/\beval\s*\(|new\s+Function\s*\(/.test(content)) {
    const match = findFirstLine(content, /\beval\s*\(|new\s+Function\s*\(/)
    addFinding(findings, {
      code: REASON_CODES.DYNAMIC_CODE,
      severity: 'critical',
      file: path,
      line: match.line,
      message: 'Dynamic code execution detected.',
      evidence: match.text,
    })
  }

  if (/stratum\+tcp|stratum\+ssl|coinhive|cryptonight|xmrig/i.test(content)) {
    const match = findFirstLine(content, /stratum\+tcp|stratum\+ssl|coinhive|cryptonight|xmrig/i)
    addFinding(findings, {
      code: REASON_CODES.CRYPTO_MINING,
      severity: 'critical',
      file: path,
      line: match.line,
      message: 'Possible crypto mining behavior detected.',
      evidence: match.text,
    })
  }

  const wsMatch = content.match(/new\s+WebSocket\s*\(\s*["']wss?:\/\/[^"']*:(\d+)/)
  if (wsMatch) {
    const port = Number.parseInt(wsMatch[1] ?? '', 10)
    if (Number.isFinite(port) && !STANDARD_PORTS.has(port)) {
      const match = findFirstLine(content, /new\s+WebSocket\s*\(/)
      addFinding(findings, {
        code: REASON_CODES.SUSPICIOUS_NETWORK,
        severity: 'warn',
        file: path,
        line: match.line,
        message: 'WebSocket connection to non-standard port detected.',
        evidence: match.text,
      })
    }
  }

  const hasFileRead = /readFileSync|readFile/.test(content)
  const hasNetworkSend = /\bfetch\b|http\.request|\baxios\b/.test(content)
  if (hasFileRead && hasNetworkSend) {
    const match = findFirstLine(content, /readFileSync|readFile/)
    addFinding(findings, {
      code: REASON_CODES.EXFILTRATION,
      severity: 'warn',
      file: path,
      line: match.line,
      message: 'File read combined with network send (possible exfiltration).',
      evidence: match.text,
    })
  }

  const hasProcessEnv = /process\.env/.test(content)
  if (hasProcessEnv && hasNetworkSend) {
    const match = findFirstLine(content, /process\.env/)
    addFinding(findings, {
      code: REASON_CODES.CREDENTIAL_HARVEST,
      severity: 'critical',
      file: path,
      line: match.line,
      message: 'Environment variable access combined with network send.',
      evidence: match.text,
    })
  }

  if (
    /(\\x[0-9a-fA-F]{2}){6,}/.test(content) ||
    /(?:atob|Buffer\.from)\s*\(\s*["'][A-Za-z0-9+/=]{200,}["']/.test(content)
  ) {
    const match = findFirstLine(content, /(\\x[0-9a-fA-F]{2}){6,}|(?:atob|Buffer\.from)\s*\(/)
    addFinding(findings, {
      code: REASON_CODES.OBFUSCATED_CODE,
      severity: 'warn',
      file: path,
      line: match.line,
      message: 'Potential obfuscated payload detected.',
      evidence: match.text,
    })
  }
}

function scanMarkdownFile(path: string, content: string, findings: ModerationFinding[]) {
  if (!MARKDOWN_EXTENSION.test(path)) return

  if (
    /ignore\s+(all\s+)?previous\s+instructions/i.test(content) ||
    /system\s*prompt\s*[:=]/i.test(content)
  ) {
    const match = findFirstLine(
      content,
      /ignore\s+(all\s+)?previous\s+instructions|system\s*prompt\s*[:=]/i,
    )
    addFinding(findings, {
      code: REASON_CODES.INJECTION_INSTRUCTIONS,
      severity: 'warn',
      file: path,
      line: match.line,
      message: 'Prompt-injection style instruction pattern detected.',
      evidence: match.text,
    })
  }
}

function scanManifestFile(path: string, content: string, findings: ModerationFinding[]) {
  if (!MANIFEST_EXTENSION.test(path)) return

  if (
    /https?:\/\/(bit\.ly|tinyurl\.com|t\.co|goo\.gl|is\.gd)\//i.test(content) ||
    /https?:\/\/\d{1,3}(?:\.\d{1,3}){3}/i.test(content)
  ) {
    const match = findFirstLine(
      content,
      /https?:\/\/(bit\.ly|tinyurl\.com|t\.co|goo\.gl|is\.gd)\/|https?:\/\/\d{1,3}(?:\.\d{1,3}){3}/i,
    )
    addFinding(findings, {
      code: REASON_CODES.SUSPICIOUS_INSTALL_SOURCE,
      severity: 'warn',
      file: path,
      line: match.line,
      message: 'Install source points to URL shortener or raw IP.',
      evidence: match.text,
    })
  }
}

function normalizeBrandToken(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function tokenizeHost(host: string) {
  return host
    .toLowerCase()
    .split('.')
    .flatMap((segment) => segment.split(/[^a-z0-9]+/))
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !GENERIC_HOST_TOKENS.has(token))
}

function extractHosts(path: string, content: string): HostHit[] {
  const hits: HostHit[] = []
  const lines = content.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    let match: RegExpExecArray | null
    HTTP_URL_PATTERN.lastIndex = 0
    while ((match = HTTP_URL_PATTERN.exec(line)) !== null) {
      hits.push({
        file: path,
        line: index + 1,
        host: match[1].toLowerCase(),
        evidence: line,
        hasCredentialSendContext: hasCredentialSendContext(lines, index),
      })
    }
  }
  return hits
}

function hasCredentialSendContext(lines: string[], lineIndex: number) {
  const sameLine = lines[lineIndex] ?? ''
  if (CREDENTIAL_SEND_CONTEXT_PATTERN.test(sameLine)) return true

  const nextLine = lines[lineIndex + 1] ?? ''
  if (CREDENTIAL_SEND_CONTEXT_PATTERN.test(nextLine)) return true

  return false
}

function extractSecretEnvHits(content: string): SecretEnvHit[] {
  const hits: SecretEnvHit[] = []
  let match: RegExpExecArray | null
  SECRET_ENV_PATTERN.lastIndex = 0
  while ((match = SECRET_ENV_PATTERN.exec(content)) !== null) {
    const envName = (match[1] ?? match[2] ?? match[3] ?? '').trim()
    if (!envName || NON_SECRET_ENV_NAMES.has(envName)) continue
    const suffix = SECRET_ENV_SUFFIXES.find((value) => envName.endsWith(value))
    if (!suffix) continue
    const brandToken = normalizeBrandToken(envName.slice(0, -suffix.length))
    if (!brandToken) continue
    if (GENERIC_BRAND_TOKENS.has(brandToken)) continue
    hits.push({ envName, brandToken })
  }
  return hits
}

function hostMatchesBrand(host: string, brandToken: string) {
  if (!brandToken) return false
  return tokenizeHost(host).some((token) => token.includes(brandToken) || brandToken.includes(token))
}

function findCredentialEndpointMismatch(input: StaticScanInput): HostHit | null {
  const codeHosts: HostHit[] = []
  const advertisedHosts = new Set<string>()
  const secretEnvHits: SecretEnvHit[] = []
  const codeHostCountsByFile = new Map<string, Set<string>>()

  for (const file of input.fileContents) {
    if (CODE_EXTENSION.test(file.path)) {
      const fileHosts = extractHosts(file.path, file.content)
      codeHosts.push(...fileHosts)
      codeHostCountsByFile.set(
        file.path,
        new Set(fileHosts.map((hit) => hit.host)),
      )
      secretEnvHits.push(...extractSecretEnvHits(file.content))
      continue
    }

    for (const hit of extractHosts(file.path, file.content)) {
      advertisedHosts.add(hit.host)
    }
  }

  const homepage = typeof input.frontmatter.homepage === 'string' ? input.frontmatter.homepage : undefined
  if (homepage) {
    for (const hit of extractHosts('frontmatter', homepage)) {
      advertisedHosts.add(hit.host)
    }
  }

  if (secretEnvHits.length === 0 || codeHosts.length === 0) return null

  for (const endpoint of codeHosts) {
    const fileHostCount = codeHostCountsByFile.get(endpoint.file)?.size ?? 0
    if (!endpoint.hasCredentialSendContext || fileHostCount > 1) continue

    for (const secretEnv of secretEnvHits) {
      if (hostMatchesBrand(endpoint.host, secretEnv.brandToken)) continue

      const hasAdvertisedMatch =
        Array.from(advertisedHosts).some((host) => hostMatchesBrand(host, secretEnv.brandToken)) ||
        normalizeBrandToken(input.slug).includes(secretEnv.brandToken) ||
        normalizeBrandToken(input.displayName).includes(secretEnv.brandToken)

      if (!hasAdvertisedMatch) continue

      const endpointMatchesAdvertised = Array.from(advertisedHosts).some(
        (host) => host === endpoint.host || tokenizeHost(host).some((token) => endpoint.host.includes(token)),
      )

      if (endpointMatchesAdvertised) continue
      return endpoint
    }
  }

  return null
}

function dedupeEvidence(evidence: ModerationFinding[]) {
  const seen = new Set<string>()
  const out: ModerationFinding[] = []
  for (const item of evidence) {
    const key = `${item.code}:${item.file}:${item.line}:${item.message}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out.slice(0, 40)
}

function buildScannerStatusReason(scanner: 'vt' | 'llm', status?: string) {
  const normalized = status?.trim().toLowerCase()
  if (normalized === 'malicious') {
    return `malicious.${scanner}_malicious`
  }
  if (normalized === 'suspicious') {
    return `suspicious.${scanner}_suspicious`
  }
  return null
}

export function runStaticModerationScan(input: StaticScanInput): StaticScanResult {
  const findings: ModerationFinding[] = []
  const files = [...input.fileContents].sort((a, b) => a.path.localeCompare(b.path))

  for (const file of files) {
    scanCodeFile(file.path, file.content, findings)
    scanMarkdownFile(file.path, file.content, findings)
    scanManifestFile(file.path, file.content, findings)
  }

  const installJson = JSON.stringify(input.metadata ?? {})
  if (/https?:\/\/(bit\.ly|tinyurl\.com|t\.co|goo\.gl|is\.gd)\//i.test(installJson)) {
    addFinding(findings, {
      code: REASON_CODES.SUSPICIOUS_INSTALL_SOURCE,
      severity: 'warn',
      file: 'metadata',
      line: 1,
      message: 'Install metadata references shortener URL.',
      evidence: installJson,
    })
  }

  const credentialEndpointMismatch = findCredentialEndpointMismatch(input)
  if (credentialEndpointMismatch) {
    addFinding(findings, {
      code: REASON_CODES.CREDENTIAL_ENDPOINT_MISMATCH,
      severity: 'critical',
      file: credentialEndpointMismatch.file,
      line: credentialEndpointMismatch.line,
      message: 'Credential for one provider is sent to an unrelated host.',
      evidence: credentialEndpointMismatch.evidence,
    })
  }

  const alwaysValue = input.frontmatter.always
  if (alwaysValue === true || alwaysValue === 'true') {
    addFinding(findings, {
      code: REASON_CODES.MANIFEST_PRIVILEGED_ALWAYS,
      severity: 'warn',
      file: 'SKILL.md',
      line: 1,
      message: 'Skill is configured with always=true (persistent invocation).',
      evidence: 'always: true',
    })
  }

  const identityText = `${input.slug}\n${input.displayName}\n${input.summary ?? ''}`
  if (/keepcold131\/ClawdAuthenticatorTool|ClawdAuthenticatorTool/i.test(identityText)) {
    addFinding(findings, {
      code: REASON_CODES.KNOWN_BLOCKED_SIGNATURE,
      severity: 'critical',
      file: 'metadata',
      line: 1,
      message: 'Matched a known blocked malware signature.',
      evidence: identityText,
    })
  }

  findings.sort((a, b) =>
    `${a.code}:${a.file}:${a.line}:${a.message}`.localeCompare(
      `${b.code}:${b.file}:${b.line}:${b.message}`,
    ),
  )

  const reasonCodes = normalizeReasonCodes(findings.map((finding) => finding.code))
  const status = verdictFromCodes(reasonCodes)
  return {
    status,
    reasonCodes,
    findings,
    summary: summarizeReasonCodes(reasonCodes),
    engineVersion: MODERATION_ENGINE_VERSION,
    checkedAt: Date.now(),
  }
}

function normalizeSignalVerdict(status?: string | null): ModerationVerdict | null {
  const normalized = status?.trim().toLowerCase()
  if (normalized === 'clean' || normalized === 'benign') return 'clean'
  if (normalized === 'suspicious') return 'suspicious'
  if (normalized === 'malicious') return 'malicious'
  return null
}

function normalizeSignalState(status?: string | null): ModerationSignalState {
  const normalized = status?.trim().toLowerCase()
  if (normalized === 'clean' || normalized === 'benign') return 'ready'
  if (normalized === 'suspicious' || normalized === 'malicious') return 'ready'
  if (normalized === 'error' || normalized === 'failed' || normalized === 'completed') {
    return 'error'
  }
  if (
    normalized === 'pending' ||
    normalized === 'loading' ||
    normalized === 'not_found' ||
    normalized === 'not-found' ||
    normalized === 'stale'
  ) {
    return 'pending'
  }
  return 'not_applicable'
}

function isExternalScannerClean(status: string | undefined): boolean {
  const normalized = status?.trim().toLowerCase()
  return normalized === 'clean' || normalized === 'benign'
}

function buildStaticSignal(params: {
  staticScan?: StaticScanResult
  vtStatus?: string
  llmStatus?: string
}): ModerationSignalSummary | undefined {
  if (!params.staticScan) return undefined

  const vtClean = isExternalScannerClean(params.vtStatus)
  const llmClean = isExternalScannerClean(params.llmStatus)
  const originalCodes = [...params.staticScan.reasonCodes]
  let securityCodes = [...originalCodes]
  let suppressedReasonCodes: string[] = []

  if (vtClean && llmClean && securityCodes.length > 0) {
    suppressedReasonCodes = securityCodes.filter((code) =>
      isExternallyClearableSuspiciousCode(code),
    )
    securityCodes = securityCodes.filter(
      (code) => !isExternallyClearableSuspiciousCode(code),
    )
  }

  const verdict = verdictFromCodes(securityCodes)
  const contribution =
    securityCodes.length === 0
      ? suppressedReasonCodes.length > 0
        ? 'suppressed'
        : 'informational'
      : verdict === 'malicious'
        ? 'decisive'
        : 'corroborating'

  return {
    key: 'staticScan',
    family: 'local',
    state: 'ready',
    verdict,
    contribution,
    reasonCodes: securityCodes,
    suppressedReasonCodes: suppressedReasonCodes.length ? suppressedReasonCodes : undefined,
    summary: summarizeReasonCodes(securityCodes),
    checkedAt: params.staticScan.checkedAt,
  }
}

function buildVtSignals(
  vtAnalysis?: Doc<'skillVersions'>['vtAnalysis'],
): Pick<ModerationSignals, 'vtEngines' | 'vtCodeInsight'> {
  if (!vtAnalysis) return {}

  const isCodeInsight =
    vtAnalysis.source === 'code_insight' ||
    (!vtAnalysis.source && Boolean(vtAnalysis.analysis || vtAnalysis.verdict))
  const key = isCodeInsight ? 'vtCodeInsight' : 'vtEngines'
  const verdict = normalizeSignalVerdict(vtAnalysis.verdict ?? vtAnalysis.status)
  const state = normalizeSignalState(vtAnalysis.verdict ?? vtAnalysis.status)
  const reasonCode = buildScannerStatusReason('vt', verdict ?? undefined)

  const signal: ModerationSignalSummary = {
    key,
    family: 'vt',
    state,
    verdict: verdict ?? undefined,
    contribution:
      state !== 'ready'
        ? 'none'
        : verdict === 'malicious'
          ? 'decisive'
          : verdict === 'suspicious'
            ? 'corroborating'
            : 'informational',
    reasonCodes: reasonCode ? [reasonCode] : [],
    summary:
      verdict === 'clean'
        ? 'VirusTotal reported clean.'
        : verdict === 'suspicious'
          ? 'VirusTotal reported suspicious behavior.'
          : verdict === 'malicious'
            ? 'VirusTotal reported malicious behavior.'
            : undefined,
    checkedAt: vtAnalysis.checkedAt,
    details: {
      source: vtAnalysis.source,
      analysis: vtAnalysis.analysis,
      status: vtAnalysis.status,
      verdict: vtAnalysis.verdict,
    },
  }

  return key === 'vtCodeInsight' ? { vtCodeInsight: signal } : { vtEngines: signal }
}

function buildLlmSignal(llmAnalysis?: Doc<'skillVersions'>['llmAnalysis']): ModerationSignalSummary | undefined {
  if (!llmAnalysis) return undefined

  const verdict = normalizeSignalVerdict(llmAnalysis.verdict ?? llmAnalysis.status)
  const state = normalizeSignalState(llmAnalysis.verdict ?? llmAnalysis.status)
  const reasonCode = buildScannerStatusReason('llm', verdict ?? undefined)
  const normalizedConfidence = llmAnalysis.confidence?.trim().toLowerCase()

  let contribution: ModerationSignalContribution = 'none'
  if (state === 'ready') {
    if (verdict === 'malicious') {
      contribution = 'decisive'
    } else if (verdict === 'suspicious') {
      contribution =
        normalizedConfidence === 'low'
          ? 'informational'
          : 'corroborating'
    } else if (verdict === 'clean') {
      contribution = 'informational'
    }
  }

  return {
    key: 'llmScan',
    family: 'llm',
    state,
    verdict: verdict ?? undefined,
    contribution,
    reasonCodes: reasonCode ? [reasonCode] : [],
    summary: llmAnalysis.summary ?? undefined,
    checkedAt: llmAnalysis.checkedAt,
    details: {
      confidence: llmAnalysis.confidence,
      dimensions: llmAnalysis.dimensions,
      guidance: llmAnalysis.guidance,
      findings: llmAnalysis.findings,
      model: llmAnalysis.model,
      status: llmAnalysis.status,
      verdict: llmAnalysis.verdict,
    },
  }
}

function collectContributingSignals(signals: ModerationSignals) {
  return Object.values(signals).filter(
    (signal): signal is ModerationSignalSummary =>
      Boolean(signal) &&
      signal.state === 'ready' &&
      (signal.contribution === 'decisive' || signal.contribution === 'corroborating') &&
      (signal.verdict === 'suspicious' || signal.verdict === 'malicious'),
  )
}

export function buildModerationSnapshot(params: {
  staticScan?: StaticScanResult
  vtAnalysis?: Doc<'skillVersions'>['vtAnalysis']
  llmAnalysis?: Doc<'skillVersions'>['llmAnalysis']
  sourceVersionId?: Id<'skillVersions'>
}): ModerationSnapshot {
  const evidence = [...(params.staticScan?.findings ?? [])]
  const signals: ModerationSignals = {
    staticScan: buildStaticSignal({
      staticScan: params.staticScan,
      vtStatus: params.vtAnalysis?.status,
      llmStatus: params.llmAnalysis?.status,
    }),
    ...buildVtSignals(params.vtAnalysis),
    llmScan: buildLlmSignal(params.llmAnalysis),
  }

  const contributingSignals = collectContributingSignals(signals)
  const contributorFamilies = new Set(contributingSignals.map((signal) => signal.family))
  const hasDecisiveMaliciousSignal = contributingSignals.some(
    (signal) => signal.verdict === 'malicious' && signal.contribution === 'decisive',
  )
  const contributingReasonCodes = normalizeReasonCodes(
    contributingSignals.flatMap((signal) => signal.reasonCodes),
  )
  const metadataCodes = normalizeReasonCodes(
    Object.values(signals).flatMap((signal) => signal?.metadataCodes ?? []),
  )
  const verdict: ScannerModerationVerdict = hasDecisiveMaliciousSignal
    ? 'malicious'
    : contributorFamilies.size >= 2
      ? 'suspicious'
      : 'clean'
  const normalizedCodes = verdict === 'clean' ? [] : contributingReasonCodes

  return {
    verdict,
    reasonCodes: normalizedCodes,
    evidence: dedupeEvidence(evidence),
    metadataCodes,
    signals,
    summary: summarizeReasonCodes(normalizedCodes),
    engineVersion: MODERATION_ENGINE_VERSION,
    evaluatedAt: Date.now(),
    sourceVersionId: params.sourceVersionId,
    legacyFlags: legacyFlagsFromVerdict(verdict),
  }
}

export function resolveSkillVerdict(
  skill: Pick<
    Doc<'skills'>,
    'moderationVerdict' | 'moderationFlags' | 'moderationReason' | 'moderationReasonCodes'
  >,
): ModerationVerdict {
  if (skill.moderationVerdict) return skill.moderationVerdict
  if (skill.moderationFlags?.includes('blocked.malware')) return 'malicious'
  if (skill.moderationFlags?.includes('flagged.suspicious')) return 'suspicious'
  if (
    skill.moderationReason?.startsWith('scanner.') &&
    skill.moderationReason.endsWith('.malicious')
  ) {
    return 'malicious'
  }
  if (
    skill.moderationReason?.startsWith('scanner.') &&
    skill.moderationReason.endsWith('.suspicious')
  ) {
    return 'suspicious'
  }
  if ((skill.moderationReasonCodes ?? []).some((code) => code.startsWith('malicious.'))) {
    return 'malicious'
  }
  if ((skill.moderationReasonCodes ?? []).length > 0) return 'suspicious'
  return 'clean'
}
