export const CANONICAL_SKILL_SEARCH_BOUNDS = {
  resultLimit: 100,
  nativeCandidateLimit: 100,
  vectorCandidateLimit: 128,
  externalCandidateLimitPerIndex: 50,
  externalIndexedReadCount: 6,
  rollingAdoptionDays: 60,
  rollingUsageBatchSize: 20,
} as const;
