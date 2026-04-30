import { describe, expect, it } from "vitest";
import {
  normalizeTrentSkillVerdictForSecurity,
  parseTrentSkillVerdictPayload,
} from "./trent";

const hash = "a".repeat(64);

describe("TrentClaw helpers", () => {
  it("parses a valid verdict payload", () => {
    expect(
      parseTrentSkillVerdictPayload(
        {
          skill_sha256: hash.toUpperCase(),
          verdict: "vulnerable",
        },
        hash,
      ),
    ).toEqual({
      skill_sha256: hash,
      verdict: "vulnerable",
    });
  });

  it("rejects mismatched hashes and unknown verdicts", () => {
    expect(() =>
      parseTrentSkillVerdictPayload({ skill_sha256: "b".repeat(64), verdict: "benign" }, hash),
    ).toThrow(/hash/i);
    expect(() =>
      parseTrentSkillVerdictPayload({ skill_sha256: hash, verdict: "risky" }, hash),
    ).toThrow(/unknown verdict/i);
  });

  it("normalizes TrentClaw verdicts for aggregate security status", () => {
    expect(normalizeTrentSkillVerdictForSecurity("benign")).toBe("clean");
    expect(normalizeTrentSkillVerdictForSecurity("vulnerable")).toBe("suspicious");
    expect(normalizeTrentSkillVerdictForSecurity("malicious")).toBe("malicious");
    expect(normalizeTrentSkillVerdictForSecurity("unknown")).toBe("pending");
  });
});
