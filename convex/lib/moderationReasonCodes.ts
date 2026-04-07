export type ModerationVerdict = "clean" | "suspicious" | "malicious";
export type ScannerModerationVerdict = ModerationVerdict;

export type ModerationFindingSeverity = "info" | "warn" | "critical";

export type ModerationFinding = {
  code: string;
  severity: ModerationFindingSeverity;
  file: string;
  line: number;
  message: string;
  evidence: string;
};

export const MODERATION_ENGINE_VERSION = "v2.3.0";

export const REASON_CODES = {
  DANGEROUS_EXEC: "suspicious.dangerous_exec",
  DYNAMIC_CODE: "suspicious.dynamic_code_execution",
  CREDENTIAL_HARVEST: "suspicious.env_credential_access",
  EXFILTRATION: "suspicious.potential_exfiltration",
  OBFUSCATED_CODE: "suspicious.obfuscated_code",
  SUSPICIOUS_NETWORK: "suspicious.nonstandard_network",
  CRYPTO_MINING: "malicious.crypto_mining",
  INJECTION_INSTRUCTIONS: "suspicious.prompt_injection_instructions",
  SUSPICIOUS_INSTALL_SOURCE: "suspicious.install_untrusted_source",
  MANIFEST_PRIVILEGED_ALWAYS: "suspicious.privileged_always",
  MALICIOUS_INSTALL_PROMPT: "malicious.install_terminal_payload",
  KNOWN_BLOCKED_SIGNATURE: "malicious.known_blocked_signature",
} as const;

const MALICIOUS_CODES = new Set<string>([
  REASON_CODES.CRYPTO_MINING,
  REASON_CODES.MALICIOUS_INSTALL_PROMPT,
  REASON_CODES.KNOWN_BLOCKED_SIGNATURE,
]);

const EXTERNALLY_CLEARABLE_SUSPICIOUS_CODES = new Set<string>([REASON_CODES.CREDENTIAL_HARVEST]);

// ---------------------------------------------------------------------------
// Skill categories
// ---------------------------------------------------------------------------

/**
 * Recognized skill categories. Publishers declare a category in frontmatter
 * metadata to give the moderation pipeline context about their skill's purpose.
 *
 * Security tools legitimately contain patterns (IOC databases, shell audit
 * commands, credential scanners) that would be suspicious in other contexts.
 * The category declaration is NOT a free pass -- malicious codes (crypto
 * mining, obfuscated install payloads, known blocked signatures) are never
 * suppressed regardless of category.
 */
export const SKILL_CATEGORIES = {
  SECURITY: "security",
} as const;

export type SkillCategory = (typeof SKILL_CATEGORIES)[keyof typeof SKILL_CATEGORIES];

/**
 * Static scan codes that are contextually expected for security tools.
 * When a skill declares `category: security`, these codes are re-prefixed
 * from `suspicious.*` to `info.security_context.*` so they no longer
 * contribute to the suspicious/malicious verdict.
 *
 * Malicious codes are NEVER contextualised -- they always trigger regardless
 * of declared category.
 */
const SECURITY_CONTEXTUAL_CODES = new Set<string>([
  REASON_CODES.DANGEROUS_EXEC,
  REASON_CODES.DYNAMIC_CODE,
  REASON_CODES.CREDENTIAL_HARVEST,
  REASON_CODES.EXFILTRATION,
  REASON_CODES.OBFUSCATED_CODE,
  REASON_CODES.SUSPICIOUS_NETWORK,
]);

/**
 * Re-prefix a reason code when the skill's declared category provides
 * legitimate context for the pattern. Returns the original code unchanged
 * when no contextualisation applies.
 */
export function contextualizeReasonCode(
  code: string,
  category: string | undefined,
): string {
  if (category === SKILL_CATEGORIES.SECURITY && SECURITY_CONTEXTUAL_CODES.has(code)) {
    return code.replace(/^suspicious\./, "info.security_context.");
  }
  return code;
}

/**
 * Check whether a category string is a recognised skill category.
 */
export function isValidSkillCategory(value: unknown): value is SkillCategory {
  if (typeof value !== "string") return false;
  return Object.values(SKILL_CATEGORIES).includes(value as SkillCategory);
}

export function isExternallyClearableSuspiciousCode(code: string) {
  return EXTERNALLY_CLEARABLE_SUSPICIOUS_CODES.has(code);
}

export function normalizeReasonCodes(codes: string[]) {
  return Array.from(new Set(codes.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

export function summarizeReasonCodes(codes: string[]) {
  if (codes.length === 0) return "No suspicious patterns detected.";
  const top = codes.slice(0, 3).join(", ");
  const extra = codes.length > 3 ? ` (+${codes.length - 3} more)` : "";
  return `Detected: ${top}${extra}`;
}

export function verdictFromCodes(codes: string[]): ScannerModerationVerdict {
  const normalized = normalizeReasonCodes(codes);
  if (normalized.some((code) => MALICIOUS_CODES.has(code) || code.startsWith("malicious."))) {
    return "malicious";
  }
  // Contextualised info.* codes are recorded for transparency but do not
  // escalate the verdict. All other non-empty codes (including unknown
  // prefixes) conservatively trigger "suspicious" to fail closed.
  const actionableCodes = normalized.filter((code) => !code.startsWith("info."));
  if (actionableCodes.length > 0) return "suspicious";
  return "clean";
}

export function legacyFlagsFromVerdict(verdict: ModerationVerdict) {
  if (verdict === "malicious") return ["blocked.malware"];
  if (verdict === "suspicious") return ["flagged.suspicious"];
  return undefined;
}
