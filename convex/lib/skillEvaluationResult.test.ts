import { describe, expect, it } from "vitest";
import { parseSkillEvaluatorResultJson } from "./skillEvaluationResult";

function resultJson(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    run_id: "20260818_120000",
    execution_status: "succeeded",
    metrics: ["accuracy"],
    agents: {
      codex: {
        execution_status: "succeeded",
        lift: {
          overall: { with_skill: 0.9, without_skill: 0.6, delta: 0.3 },
        },
        pass_at_k: {
          with_skill: { passed_cases: 4, total_cases: 4, attempts_used: 8 },
          without_skill: { passed_cases: 2, total_cases: 4, attempts_used: 8 },
        },
        dimensions_with_skill: {
          security: { score: 1 },
          correctness: { score: 0.85 },
          discoverability: { score: 0.95 },
          effectiveness: { score: 0.88 },
          efficiency: { score: 0.94 },
        },
        dimensions_without_skill: {
          security: { score: 1 },
          correctness: { score: 0.45 },
          discoverability: { score: 0.63 },
          effectiveness: { score: 0.58 },
          efficiency: { score: 0.28 },
        },
      },
    },
    ...overrides,
  });
}

describe("parseSkillEvaluatorResultJson", () => {
  it("extracts the native Tier 3 summary", () => {
    expect(parseSkillEvaluatorResultJson(resultJson(), "codex")).toEqual({
      runId: "20260818_120000",
      metrics: {
        sampleCount: 8,
        overall: { withSkill: 0.9, withoutSkill: 0.6, delta: 0.3 },
        cases: {
          withSkillPassed: 4,
          withSkillTotal: 4,
          withoutSkillPassed: 2,
          withoutSkillTotal: 4,
        },
        dimensions: [
          { id: "security", withSkill: 1, withoutSkill: 1, delta: 0 },
          { id: "correctness", withSkill: 0.85, withoutSkill: 0.45, delta: 0.4 },
          { id: "discoverability", withSkill: 0.95, withoutSkill: 0.63, delta: 0.32 },
          { id: "effectiveness", withSkill: 0.88, withoutSkill: 0.58, delta: 0.3 },
          { id: "efficiency", withSkill: 0.94, withoutSkill: 0.28, delta: 0.66 },
        ],
      },
    });
  });

  it("rejects incomplete evaluator runs instead of publishing partial scores", () => {
    expect(() =>
      parseSkillEvaluatorResultJson(resultJson({ execution_status: "failed" }), "codex"),
    ).toThrow("does not contain a successful evaluation");
  });

  it("rejects malformed native output", () => {
    expect(() => parseSkillEvaluatorResultJson("not json", "codex")).toThrow("not valid JSON");
    expect(() => parseSkillEvaluatorResultJson(JSON.stringify({ metrics: [] }), "codex")).toThrow(
      "missing its metric summary",
    );
  });
});
