import type { Doc } from '../_generated/dataModel'

const FLAG_RULES: Array<{ flag: string; pattern: RegExp }> = [
  // Known-bad / known-suspicious identifiers.
  // NOTE: keep these narrowly scoped; use staff review to confirm removals.
  {
    flag: 'blocked.malware',
    pattern: /(keepcold131\/ClawdAuthenticatorTool|ClawdAuthenticatorTool)/i,
  },

  { flag: 'suspicious.keyword', pattern: /(malware|stealer|phish|phishing|keylogger)/i },
  { flag: 'suspicious.secrets', pattern: /(api[-_ ]?key|token|password|private key|secret)/i },
  { flag: 'suspicious.crypto', pattern: /(wallet|seed phrase|mnemonic|crypto)/i },
  { flag: 'suspicious.webhook', pattern: /(discord\.gg|webhook|hooks\.slack)/i },
  { flag: 'suspicious.script', pattern: /(curl[^\n]+\|\s*(sh|bash))/i },
  { flag: 'suspicious.url_shortener', pattern: /(bit\.ly|tinyurl\.com|t\.co|goo\.gl|is\.gd)/i },
]

export function deriveModerationFlags({
  skill,
  parsed,
  files,
}: {
  skill: Pick<Doc<'skills'>, 'slug' | 'displayName' | 'summary'>
  parsed: Doc<'skillVersions'>['parsed']
  files: Doc<'skillVersions'>['files']
}) {
  const text = [
    skill.slug,
    skill.displayName,
    skill.summary ?? '',
    JSON.stringify(parsed?.frontmatter ?? {}),
    JSON.stringify(parsed?.metadata ?? {}),
    JSON.stringify((parsed as { moltbot?: unknown } | undefined)?.moltbot ?? {}),
    ...files.map((file) => file.path),
  ]
    .filter(Boolean)
    .join('\n')

  const flags = new Set<string>()

  for (const rule of FLAG_RULES) {
    if (rule.pattern.test(text)) {
      flags.add(rule.flag)
    }
  }

  return Array.from(flags)
}
