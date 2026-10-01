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

export const MODERATION_ENGINE_VERSION = "v2.4.26";

export const REASON_CODES = {
  LLM_REVIEW: "review.llm_review",
  DANGEROUS_EXEC: "suspicious.dangerous_exec",
  DYNAMIC_CODE: "suspicious.dynamic_code_execution",
  GENERATED_SOURCE_TEMPLATE: "suspicious.generated_source_template_injection",
  EXPOSED_RESOURCE_IDENTIFIER: "suspicious.exposed_resource_identifier",
  DESTRUCTIVE_DELETE_COMMAND: "suspicious.destructive_delete_command",
  EXPOSED_SECRET_LITERAL: "suspicious.exposed_secret_literal",
  CREDENTIAL_EXPOSURE_INSTRUCTIONS: "suspicious.credential_exposure_instructions",
  SECRET_ARGV_EXPOSURE: "suspicious.secret_argv_exposure",
  HOST_PLATFORM_SOURCE_PATCH: "suspicious.host_platform_source_patch",
  UNSAFE_FILE_WRITE: "suspicious.unsafe_file_write",
  INSECURE_TLS_VERIFICATION: "suspicious.insecure_tls_verification",
  AUTONOMOUS_CREDENTIAL_EGRESS: "suspicious.autonomous_credential_egress",
  HARDCODED_OPERATOR_BILLING: "suspicious.hardcoded_operator_billing",
  REMOTE_RECIPE_EXECUTION: "suspicious.remote_recipe_execution",
  CONFIRMATION_BYPASS: "suspicious.confirmation_bypass",
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
  if (codes.every((code) => code.startsWith("review."))) return `Review: ${top}${extra}`;
  return `Detected: ${top}${extra}`;
}

export function verdictFromCodes(codes: string[]): ScannerModerationVerdict {
  const normalized = normalizeReasonCodes(codes);
  if (normalized.some((code) => MALICIOUS_CODES.has(code) || code.startsWith("malicious."))) {
    return "malicious";
  }
  if (normalized.some((code) => code.startsWith("suspicious."))) return "suspicious";
  return "clean";
}

export function legacyFlagsFromVerdict(verdict: ModerationVerdict) {
  if (verdict === "malicious") return ["blocked.malware"];
  if (verdict === "suspicious") return ["flagged.suspicious"];
  return undefined;
}
