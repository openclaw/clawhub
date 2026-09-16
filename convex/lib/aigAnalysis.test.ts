import { describe, expect, it } from "vitest";
import { reusableAigAnalysis } from "./aigAnalysis";

const finding = {
  ruleId: "T04",
  level: "error",
  message: "Embedded payload",
};

describe("reusableAigAnalysis", () => {
  it.each([
    { status: "clean", issueCount: 1, findings: [finding] },
    { status: "suspicious", issueCount: 1, findings: [] },
    {
      status: "malicious",
      issueCount: 26,
      findings: Array.from({ length: 24 }, () => finding),
    },
  ])("rejects inconsistent cached evidence %#", (analysis) => {
    expect(reusableAigAnalysis({ ...analysis, checkedAt: 123 })).toBeUndefined();
  });

  it("accepts a complete capped finding set", () => {
    expect(
      reusableAigAnalysis({
        status: "suspicious",
        issueCount: 26,
        findings: Array.from({ length: 25 }, () => finding),
        checkedAt: 123,
      }),
    ).toMatchObject({ issueCount: 26, findings: expect.arrayContaining([finding]) });
  });
});
