/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import { buildModerationSnapshot } from "./moderationEngine";

describe("buildModerationSnapshot", () => {
  it("is clean with no reason codes before ClawScan completes", () => {
    const snapshot = buildModerationSnapshot({ llmStatus: "error" });

    expect(snapshot.verdict).toBe("clean");
    expect(snapshot.reasonCodes).toEqual([]);
    expect(snapshot.evidence).toEqual([]);
    expect(snapshot.legacyFlags).toBeUndefined();
  });

  it("treats legacy completed benign ClawScan verdicts as clean", () => {
    const snapshot = buildModerationSnapshot({
      llmAnalysis: {
        status: "completed",
        verdict: "benign",
      },
    });

    expect(snapshot.verdict).toBe("clean");
    expect(snapshot.reasonCodes).toEqual([]);
  });

  it("marks malicious ClawScan verdicts as malicious", () => {
    const snapshot = buildModerationSnapshot({ llmStatus: "malicious" });

    expect(snapshot.verdict).toBe("malicious");
    expect(snapshot.reasonCodes).toEqual(["malicious.llm_malicious"]);
    expect(snapshot.legacyFlags).toEqual(["blocked.malware"]);
  });

  it("keeps medium LLM concerns visible as review instead of hidden suspicious", () => {
    const snapshot = buildModerationSnapshot({
      llmStatus: "suspicious",
      llmAnalysis: {
        status: "suspicious",
        agenticRiskFindings: [
          {
            status: "concern",
            severity: "medium",
          },
        ],
      },
    });

    expect(snapshot.verdict).toBe("clean");
    expect(snapshot.reasonCodes).toEqual(["review.llm_review"]);
    expect(snapshot.summary).toBe("Review: review.llm_review");
    expect(snapshot.legacyFlags).toBeUndefined();
  });

  it("keeps high LLM concerns in the suspicious bucket", () => {
    const snapshot = buildModerationSnapshot({
      llmStatus: "suspicious",
      llmAnalysis: {
        status: "suspicious",
        riskSummary: {
          abnormal_behavior_control: {
            status: "concern",
            highestSeverity: "high",
          },
        },
      },
    });

    expect(snapshot.verdict).toBe("suspicious");
    expect(snapshot.reasonCodes).toEqual(["suspicious.llm_suspicious"]);
    expect(snapshot.legacyFlags).toEqual(["flagged.suspicious"]);
  });
});
