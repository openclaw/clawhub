// ---------------------------------------------------------------------------
// Skill capabilities — shared spec between ClawHub and OpenClaw.
//
// KEEP IN SYNC with openclaw/src/agents/skills/types.ts SKILL_CAPABILITIES.
//
// These values are validated during skill publish (ClawHub) and at load time
// (OpenClaw runtime). Both sides must accept the same enum values.
// ---------------------------------------------------------------------------

export const SKILL_CAPABILITIES = [
  "shell", // exec, process — run shell commands
  "filesystem", // read, write, edit, apply_patch — file mutations
  "network", // web_search, web_fetch — outbound HTTP
  "browser", // browser — browser automation
  "sessions", // sessions_spawn, sessions_send — cross-session orchestration
] as const;

export type SkillCapability = (typeof SKILL_CAPABILITIES)[number];

/**
 * Validate that a list of capability strings are all recognized values.
 * Returns only the valid entries, dropping unknowns silently.
 */
export function validateCapabilities(raw: unknown): SkillCapability[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter(
    (v): v is SkillCapability =>
      typeof v === "string" && (SKILL_CAPABILITIES as readonly string[]).includes(v),
  );
}

/**
 * Capabilities that should trigger extra moderation review when declared
 * by community (unverified) publishers.
 */
export const HIGH_RISK_CAPABILITIES: readonly SkillCapability[] = [
  "shell",
  "sessions",
];
