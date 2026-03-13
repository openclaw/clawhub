export type FalsePositiveCase = {
  caseId: string
  bucket:
    | 'stale_state'
    | 'api_wrapper'
    | 'docs_only'
    | 'constrained_subprocess'
    | 'security_tool_fixture'
  issueNumber: number
  sourceSlug: string
  notes: string
}

export const DEFAULT_REGISTRY_BASE_URL = 'https://clawhub.ai'
export const DEFAULT_USER_PREFIX = 'fp-'
export const DEFAULT_ADMIN_PREFIX = 'fp-admin-'

export const FALSE_POSITIVE_CORPUS: FalsePositiveCase[] = [
  {
    caseId: 'stale-ai-image-prompts',
    bucket: 'stale_state',
    issueNumber: 733,
    sourceSlug: 'ai-image-prompts',
    notes: 'Current prod moderation is stale suspicious while VT and LLM were reported clean.',
  },
  {
    caseId: 'stale-nano-banana-pro-prompts-recommend',
    bucket: 'stale_state',
    issueNumber: 733,
    sourceSlug: 'nano-banana-pro-prompts-recommend',
    notes: 'Second stale-state case from the same report to catch bucket-specific drift.',
  },
  {
    caseId: 'api-wrapper-element-nft-tracker',
    bucket: 'api_wrapper',
    issueNumber: 813,
    sourceSlug: 'element-nft-tracker',
    notes: 'Read-only API wrapper with env var auth and documented curl calls.',
  },
  {
    caseId: 'docs-only-pmctl',
    bucket: 'docs_only',
    issueNumber: 808,
    sourceSlug: 'pmctl',
    notes: 'Single-file markdown skill mentioning API keys and external URLs.',
  },
  {
    caseId: 'subprocess-song-song-taxi-skill',
    bucket: 'constrained_subprocess',
    issueNumber: 799,
    sourceSlug: 'song-song-taxi-skill',
    notes: 'Uses child_process.spawn in constrained non-shell mode for fixed MCP tooling.',
  },
  {
    caseId: 'security-tool-aliyun-clawscan',
    bucket: 'security_tool_fixture',
    issueNumber: 718,
    sourceSlug: 'aliyun-clawscan',
    notes: 'Security scanner skill containing signatures and attack-pattern fixtures.',
  },
]

export function normalizeBaseUrl(value?: string) {
  const trimmed = value?.trim()
  if (!trimmed) return DEFAULT_REGISTRY_BASE_URL
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed
}

export function normalizePrefix(value: string | undefined, fallback: string) {
  const trimmed = value?.trim().toLowerCase()
  return trimmed || fallback
}

export function buildTargetSlug(prefix: string, sourceSlug: string) {
  return `${prefix}${sourceSlug}`.toLowerCase()
}

export function resolveCorpusCases(caseIds?: string[]) {
  if (!caseIds?.length) return FALSE_POSITIVE_CORPUS
  const wanted = new Set(caseIds.map((caseId) => caseId.trim()).filter(Boolean))
  return FALSE_POSITIVE_CORPUS.filter((entry) => wanted.has(entry.caseId))
}
