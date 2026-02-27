const SKILL_CAPABILITIES = ['shell', 'filesystem', 'network', 'browser', 'sessions'] as const

export type SkillCapability = (typeof SKILL_CAPABILITIES)[number]

const SKILL_CAPABILITY_SET = new Set<string>(SKILL_CAPABILITIES)

export function normalizeCapabilities(input: unknown): SkillCapability[] {
  if (!Array.isArray(input)) return []
  const capabilities = input
    .map((entry) => (typeof entry === 'string' ? entry.trim().toLowerCase() : ''))
    .filter((entry): entry is SkillCapability => SKILL_CAPABILITY_SET.has(entry))
  return Array.from(new Set(capabilities))
}

