export const TRENT_SKILL_VERDICTS = ["benign", "vulnerable", "malicious", "unknown"] as const;

export type TrentSkillVerdict = (typeof TRENT_SKILL_VERDICTS)[number];

export type TrentSkillVerdictPayload = {
  skill_sha256: string;
  verdict: TrentSkillVerdict;
};

const TRENT_VERDICT_SET = new Set<string>(TRENT_SKILL_VERDICTS);

export function isTrentSkillVerdict(value: unknown): value is TrentSkillVerdict {
  return typeof value === "string" && TRENT_VERDICT_SET.has(value);
}

export function parseTrentSkillVerdictPayload(
  payload: unknown,
  expectedSha256: string,
): TrentSkillVerdictPayload {
  if (!payload || typeof payload !== "object") {
    throw new Error("TrentClaw verdict response must be an object");
  }

  const record = payload as Record<string, unknown>;
  const skillSha256 = record.skill_sha256;
  const verdict = record.verdict;
  if (typeof skillSha256 !== "string" || skillSha256.toLowerCase() !== expectedSha256) {
    throw new Error("TrentClaw verdict response hash does not match the requested skill");
  }
  if (!isTrentSkillVerdict(verdict)) {
    throw new Error("TrentClaw verdict response has an unknown verdict");
  }

  return { skill_sha256: skillSha256.toLowerCase(), verdict };
}

export function normalizeTrentSkillVerdictForSecurity(
  verdict: TrentSkillVerdict,
): "clean" | "suspicious" | "malicious" | "pending" {
  switch (verdict) {
    case "benign":
      return "clean" as const;
    case "vulnerable":
      return "suspicious" as const;
    case "malicious":
      return "malicious" as const;
    case "unknown":
      return "pending" as const;
    default: {
      const exhaustive: never = verdict;
      return exhaustive;
    }
  }
}
