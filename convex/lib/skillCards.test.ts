import { describe, expect, it } from "vitest";
import {
  hasSettledSkillCardInputs,
  isSkillCardPath,
  normalizeSkillCardSecurityStatus,
  sourceSkillVersionFiles,
} from "./skillCards";

describe("skill card file helpers", () => {
  it("detects reserved Skill Card paths after upload-style dot prefixes", () => {
    expect(isSkillCardPath("skill-card.md")).toBe(true);
    expect(isSkillCardPath("./skill-card.md")).toBe(true);
    expect(isSkillCardPath(".//skill-card.md")).toBe(true);
    expect(isSkillCardPath("references/skill-card.md")).toBe(false);
  });

  it("keeps legacy publisher-authored Skill Cards in source file inputs", () => {
    const files = [
      { path: "SKILL.md", sha256: "a" },
      { path: "references/guide.md", sha256: "b" },
      { path: "skill-card.md", sha256: "publisher-authored" },
    ];

    expect(sourceSkillVersionFiles(files)).toEqual(files);
  });

  it("keeps generated Skill Cards out of source file inputs after server provenance exists", () => {
    const files = [
      { path: "SKILL.md", sha256: "a" },
      { path: "references/guide.md", sha256: "b" },
      { path: " skill-card.md ", sha256: "generated" },
    ];

    expect(
      sourceSkillVersionFiles(files, { generatedBundleFingerprints: ["generated-bundle"] }),
    ).toEqual([
      { path: "SKILL.md", sha256: "a" },
      { path: "references/guide.md", sha256: "b" },
    ]);
  });

  it("normalizes legacy scanner statuses into canonical ClawScan buckets", () => {
    expect(normalizeSkillCardSecurityStatus("benign")).toBe("clean");
    expect(normalizeSkillCardSecurityStatus("suspicious")).toBe("review");
    expect(normalizeSkillCardSecurityStatus("warning")).toBe("warn");
    expect(normalizeSkillCardSecurityStatus("malicious")).toBe("malicious");
  });

  it("treats review and warn ClawScan verdicts as settled card inputs", () => {
    expect(
      hasSettledSkillCardInputs({
        staticScan: { status: "clean" },
        clawScanVerdict: "review",
        llmAnalysis: { status: "clean", verdict: "clean" },
      }),
    ).toBe(true);
    expect(
      hasSettledSkillCardInputs({
        staticScan: { status: "clean" },
        clawScanVerdict: "warn",
      }),
    ).toBe(true);
    expect(
      hasSettledSkillCardInputs({
        staticScan: { status: "clean" },
        llmAnalysis: { status: "suspicious", verdict: "suspicious" },
      }),
    ).toBe(true);
  });
});
