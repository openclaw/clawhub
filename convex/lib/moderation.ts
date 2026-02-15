import type { Doc } from "../_generated/dataModel";

const KNOWN_BLOCKED_SIGNATURE = /(keepcold131\/ClawdAuthenticatorTool|ClawdAuthenticatorTool)/i;
const SUSPICIOUS_INSTALL_URL = /https?:\/\/(bit\.ly|tinyurl\.com|t\.co|goo\.gl|is\.gd)\//i;
const SUSPICIOUS_RAW_IP_URL = /https?:\/\/\d{1,3}(?:\.\d{1,3}){3}/i;
const SUSPICIOUS_SCRIPT_PIPE = /curl[^\n]+\|\s*(sh|bash)/i;

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
  if (KNOWN_BLOCKED_SIGNATURE.test(text)) {
    flags.add("blocked.malware");
  }

  // Context-aware suspicious checks only. Avoid broad keyword-only flags to reduce false positives.
  if (
    SUSPICIOUS_INSTALL_URL.test(text) ||
    SUSPICIOUS_RAW_IP_URL.test(text) ||
    SUSPICIOUS_SCRIPT_PIPE.test(text)
  ) {
    flags.add("flagged.suspicious");
  }

  const always = (parsed?.frontmatter as Record<string, unknown> | undefined)?.always;
  if (always === true || always === "true") {
    flags.add("flagged.suspicious");
  }

  return Array.from(flags);
}
