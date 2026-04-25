import type { Doc } from "../_generated/dataModel";

const FLAG_RULES: Array<{ flag: string; pattern: RegExp }> = [
  // Known-bad / known-suspicious identifiers.
  // NOTE: keep these narrowly scoped; use staff review to confirm removals.
  {
    flag: "blocked.malware",
    pattern: /(keepcold131\/ClawdAuthenticatorTool|ClawdAuthenticatorTool)/i,
  },

  // Malicious intent keywords
  { flag: "suspicious.keyword", pattern: /(malware|stealer|phish|phishing|keylogger)/i },

  // Data exfiltration patterns - webhooks are unusual in skills
  // NOTE: Only flag explicit Discord/Slack webhook URLs, not generic webhook mentions.
  // WordPress, Zapier, Make, and other legitimate integrations use webhook as a common term.
  { flag: "suspicious.webhook", pattern: /(discord\.gg\/|discord\.com\/api\/webhooks|discordapp\.com\/api\/webhooks|hooks\.slack)/i },

  // Arbitrary code execution - curl | bash is dangerous
  { flag: "suspicious.script", pattern: /(curl[^\n]+\|\s*(sh|bash))/i },

  // URL obfuscation - shorteners hide destination
  { flag: "suspicious.url_shortener", pattern: /(bit\.ly|tinyurl\.com|t\.co|goo\.gl|is\.gd)/i },

  // Note: Removed overly broad patterns for token, api key, password, crypto, etc.
  // These are common in legitimate auth/payment skills.
  // The LLM evaluator handles credential proportionality analysis.
];

export function deriveModerationFlags({
  skill,
  parsed,
  files,
}: {
  skill: Pick<Doc<"skills">, "slug" | "displayName" | "summary">;
  parsed: Doc<"skillVersions">["parsed"];
  files: Doc<"skillVersions">["files"];
}) {
  const text = [
    skill.slug,
    skill.displayName,
    skill.summary ?? "",
    JSON.stringify(parsed?.frontmatter ?? {}),
    JSON.stringify(parsed?.metadata ?? {}),
    JSON.stringify((parsed as { moltbot?: unknown } | undefined)?.moltbot ?? {}),
    ...files.map((file) => file.path),
  ]
    .filter(Boolean)
    .join("\n");

  const flags = new Set<string>();

  for (const rule of FLAG_RULES) {
    if (rule.pattern.test(text)) {
      flags.add(rule.flag);
    }
  }

  return Array.from(flags);
}