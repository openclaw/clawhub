export type ModerationVerdict = "clean" | "suspicious" | "malicious";

export type ModerationFindingSeverity = "info" | "warn" | "critical";

export type ModerationFinding = {
  code: string;
  severity: ModerationFindingSeverity;
  file: string;
  line: number;
  message: string;
  evidence: string;
};

export const MODERATION_ENGINE_VERSION = "v2.0.0";

export const REASON_CODES = {
  DANGEROUS_EXEC: "suspicious.dangerous_exec",
  DYNAMIC_CODE: "suspicious.dynamic_code_execution",
  CREDENTIAL_HARVEST: "malicious.env_harvesting",
  EXFILTRATION: "suspicious.potential_exfiltration",
  OBFUSCATED_CODE: "suspicious.obfuscated_code",
  SUSPICIOUS_NETWORK: "suspicious.nonstandard_network",
  CRYPTO_MINING: "malicious.crypto_mining",
  INJECTION_INSTRUCTIONS: "suspicious.prompt_injection_instructions",
  SUSPICIOUS_INSTALL_SOURCE: "suspicious.install_untrusted_source",
  MANIFEST_PRIVILEGED_ALWAYS: "suspicious.privileged_always",
  KNOWN_BLOCKED_SIGNATURE: "malicious.known_blocked_signature",
} as const;

const MALICIOUS_CODES = new Set<string>([
  REASON_CODES.CREDENTIAL_HARVEST,
  REASON_CODES.CRYPTO_MINING,
  REASON_CODES.KNOWN_BLOCKED_SIGNATURE,
]);

export function normalizeReasonCodes(codes: string[]) {
  return Array.from(new Set(codes.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

export function summarizeReasonCodes(codes: string[]) {
  if (codes.length === 0) return "No suspicious patterns detected.";
  const top = codes.slice(0, 3).join(", ");
  const extra = codes.length > 3 ? ` (+${codes.length - 3} more)` : "";
  return `Detected: ${top}${extra}`;
}

export function verdictFromCodes(codes: string[]): ModerationVerdict {
  const normalized = normalizeReasonCodes(codes);
  if (normalized.some((code) => MALICIOUS_CODES.has(code) || code.startsWith("malicious."))) {
    return "malicious";
  }
  if (normalized.length > 0) return "suspicious";
  return "clean";
}

export function legacyFlagsFromVerdict(verdict: ModerationVerdict) {
  if (verdict === "malicious") return ["blocked.malware"];
  if (verdict === "suspicious") return ["flagged.suspicious"];
  return undefined;
}
