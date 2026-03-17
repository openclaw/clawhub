export type MaliciousCorpusCase = {
  caseId: string
  bucket:
    | 'vt_malicious'
    | 'llm_malicious'
    | 'static_malicious'
    | 'mixed_malicious'
  sourceSlug: string
  assertLiveMalicious: boolean
  notes: string
}

export const DEFAULT_MALICIOUS_USER_PREFIX = 'mal-'
export const DEFAULT_MALICIOUS_ADMIN_PREFIX = 'mal-admin-'

export const MALICIOUS_CORPUS: MaliciousCorpusCase[] = [
  {
    caseId: 'vt-malicious-doubao-claw',
    bucket: 'vt_malicious',
    sourceSlug: 'doubao-claw',
    assertLiveMalicious: false,
    notes: 'VT malicious with suspicious static credential access and suspicious LLM analysis.',
  },
  {
    caseId: 'vt-malicious-antigravity-claw',
    bucket: 'vt_malicious',
    sourceSlug: 'antigravity-claw',
    assertLiveMalicious: false,
    notes: 'VT malicious case with otherwise clean static scan to prove a single malicious family still blocks.',
  },
  {
    caseId: 'llm-malicious-amazon-product-research',
    bucket: 'llm_malicious',
    sourceSlug: 'amazon-product-research',
    assertLiveMalicious: false,
    notes: 'LLM malicious with only VT suspicious; this was the Phase 2 regression we fixed.',
  },
  {
    caseId: 'vt-and-llm-malicious-priority-override',
    bucket: 'mixed_malicious',
    sourceSlug: 'priority-override',
    assertLiveMalicious: false,
    notes: 'Both VT and LLM malicious to keep a high-confidence malicious overlap sample.',
  },
  {
    caseId: 'static-malicious-kalshi-trades',
    bucket: 'static_malicious',
    sourceSlug: 'kalshi-trades',
    assertLiveMalicious: false,
    notes:
      'Historical static-malicious case; current static engine reclassifies it lower, so keep it as a live drift monitor rather than a hard gate.',
  },
  {
    caseId: 'static-malicious-clawhub-push-skill',
    bucket: 'static_malicious',
    sourceSlug: 'clawhub-push-skill',
    assertLiveMalicious: false,
    notes:
      'Historical static-malicious case; current static engine reclassifies it lower, so keep it as a live drift monitor rather than a hard gate.',
  },
  {
    caseId: 'mixed-malicious-skillboss-4',
    bucket: 'mixed_malicious',
    sourceSlug: 'skillboss-4',
    assertLiveMalicious: false,
    notes:
      'Historical mixed-malicious case; current static engine now lands suspicious, so use it as a live-provider drift monitor.',
  },
  {
    caseId: 'static-malicious-clawscan-v2',
    bucket: 'static_malicious',
    sourceSlug: 'clawscan-v2',
    assertLiveMalicious: true,
    notes: 'Static malicious crypto-mining signature with supporting suspicious LLM analysis.',
  },
]

export function normalizeMaliciousPrefix(value: string | undefined, fallback: string) {
  const trimmed = value?.trim().toLowerCase()
  return trimmed || fallback
}

export function buildMaliciousTargetSlug(prefix: string, sourceSlug: string) {
  return `${prefix}${sourceSlug}`.toLowerCase()
}

export function resolveMaliciousCorpusCases(caseIds?: string[]) {
  if (!caseIds?.length) return MALICIOUS_CORPUS
  const wanted = new Set(caseIds.map((caseId) => caseId.trim()).filter(Boolean))
  return MALICIOUS_CORPUS.filter((entry) => wanted.has(entry.caseId))
}
