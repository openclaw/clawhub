import { describe, expect, it } from "vitest";
import {
  contextualizeReasonCode,
  isValidSkillCategory,
  REASON_CODES,
  SKILL_CATEGORIES,
  verdictFromCodes,
} from "./moderationReasonCodes";

describe("contextualizeReasonCode", () => {
  it("re-prefixes suspicious codes to info.security_context for security category", () => {
    expect(contextualizeReasonCode(REASON_CODES.DANGEROUS_EXEC, "security")).toBe(
      "info.security_context.dangerous_exec",
    );
    expect(contextualizeReasonCode(REASON_CODES.DYNAMIC_CODE, "security")).toBe(
      "info.security_context.dynamic_code_execution",
    );
    expect(contextualizeReasonCode(REASON_CODES.CREDENTIAL_HARVEST, "security")).toBe(
      "info.security_context.env_credential_access",
    );
    expect(contextualizeReasonCode(REASON_CODES.EXFILTRATION, "security")).toBe(
      "info.security_context.potential_exfiltration",
    );
    expect(contextualizeReasonCode(REASON_CODES.OBFUSCATED_CODE, "security")).toBe(
      "info.security_context.obfuscated_code",
    );
    expect(contextualizeReasonCode(REASON_CODES.SUSPICIOUS_NETWORK, "security")).toBe(
      "info.security_context.nonstandard_network",
    );
  });

  it("never re-prefixes malicious codes regardless of category", () => {
    expect(contextualizeReasonCode(REASON_CODES.CRYPTO_MINING, "security")).toBe(
      REASON_CODES.CRYPTO_MINING,
    );
    expect(contextualizeReasonCode(REASON_CODES.MALICIOUS_INSTALL_PROMPT, "security")).toBe(
      REASON_CODES.MALICIOUS_INSTALL_PROMPT,
    );
    expect(contextualizeReasonCode(REASON_CODES.KNOWN_BLOCKED_SIGNATURE, "security")).toBe(
      REASON_CODES.KNOWN_BLOCKED_SIGNATURE,
    );
  });

  it("does not re-prefix prompt injection instructions for security category", () => {
    expect(contextualizeReasonCode(REASON_CODES.INJECTION_INSTRUCTIONS, "security")).toBe(
      REASON_CODES.INJECTION_INSTRUCTIONS,
    );
  });

  it("returns code unchanged for undefined category", () => {
    expect(contextualizeReasonCode(REASON_CODES.DANGEROUS_EXEC, undefined)).toBe(
      REASON_CODES.DANGEROUS_EXEC,
    );
  });

  it("returns code unchanged for unrecognised category", () => {
    expect(contextualizeReasonCode(REASON_CODES.DANGEROUS_EXEC, "cooking")).toBe(
      REASON_CODES.DANGEROUS_EXEC,
    );
  });
});

describe("isValidSkillCategory", () => {
  it("accepts recognised categories", () => {
    expect(isValidSkillCategory("security")).toBe(true);
  });

  it("rejects unrecognised strings", () => {
    expect(isValidSkillCategory("cooking")).toBe(false);
    expect(isValidSkillCategory("")).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(isValidSkillCategory(42)).toBe(false);
    expect(isValidSkillCategory(null)).toBe(false);
    expect(isValidSkillCategory(undefined)).toBe(false);
    expect(isValidSkillCategory(true)).toBe(false);
  });
});

describe("verdictFromCodes", () => {
  it("returns clean for empty codes", () => {
    expect(verdictFromCodes([])).toBe("clean");
  });

  it("returns clean when only info.* codes are present", () => {
    expect(
      verdictFromCodes(["info.security_context.dangerous_exec", "info.security_context.obfuscated_code"]),
    ).toBe("clean");
  });

  it("returns suspicious for suspicious.* codes", () => {
    expect(verdictFromCodes(["suspicious.dangerous_exec"])).toBe("suspicious");
  });

  it("returns suspicious for unknown-prefix codes (fail closed)", () => {
    expect(verdictFromCodes(["scanner.custom_check"])).toBe("suspicious");
  });

  it("returns malicious for malicious.* codes", () => {
    expect(verdictFromCodes(["malicious.crypto_mining"])).toBe("malicious");
  });

  it("returns malicious when both suspicious and malicious codes present", () => {
    expect(
      verdictFromCodes(["suspicious.dangerous_exec", "malicious.crypto_mining"]),
    ).toBe("malicious");
  });
});

describe("SKILL_CATEGORIES", () => {
  it("has security as a recognised category", () => {
    expect(SKILL_CATEGORIES.SECURITY).toBe("security");
  });
});
