/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SkillEvaluationReport, type SkillEvaluationResult } from "./SkillEvaluationReport";

const result: SkillEvaluationResult = {
  source: {
    repository: "nvidia/skills",
    commit: "a".repeat(40),
    path: "skills/doca-dpa",
    contentHash: "content-hash",
  },
  evaluator: {
    repository: "NVIDIA/SkillEvaluator",
    release: "v0.1.0",
    commit: "b".repeat(40),
    agent: "codex",
    agentModel: "gpt-5.4-mini",
    judgeModel: "gpt-5.4",
    judgeProvider: "openai",
    environment: "docker",
    attempts: 2,
  },
  metrics: {
    sampleCount: 8,
    overall: { withSkill: 0.9587, withoutSkill: 0.6058, delta: 0.3529 },
    cases: {
      withSkillPassed: 4,
      withSkillTotal: 4,
      withoutSkillPassed: 2,
      withoutSkillTotal: 4,
    },
    dimensions: [
      { id: "security", withSkill: 1, withoutSkill: 1, delta: 0 },
      { id: "correctness", withSkill: 0.9, withoutSkill: 0.6, delta: 0.3 },
      { id: "discoverability", withSkill: 0.92, withoutSkill: 0.67, delta: 0.25 },
      { id: "effectiveness", withSkill: 0.79, withoutSkill: 0.7, delta: 0.09 },
      { id: "efficiency", withSkill: 0.75, withoutSkill: 0.69, delta: 0.06 },
    ],
  },
  completedAt: Date.parse("2026-08-18T19:05:00.000Z"),
};

describe("SkillEvaluationReport", () => {
  it("renders the completed current-version summary without overstating precision", () => {
    render(<SkillEvaluationReport result={result} />);

    expect(screen.getByText("96%")).toBeTruthy();
    expect(screen.getByText("+35 pts")).toBeTruthy();
    expect(screen.getByText("Overview")).toBeTruthy();
    expect(screen.getByText("Results")).toBeTruthy();
    expect(screen.getByText("Num attempts")).toBeTruthy();
    expect(screen.getByText("2 per case")).toBeTruthy();
    expect(screen.getByText("Codex (gpt-5.4-mini)")).toBeTruthy();
    expect(screen.getByText("OpenAI (gpt-5.4)")).toBeTruthy();
    expect(screen.queryByText("SkillEvaluator v0.1.0")).toBeNull();
    expect(screen.queryByText("Aug 18, 2026")).toBeNull();
    expect(screen.getByText("Security")).toBeTruthy();
    expect(screen.getByText("Correctness")).toBeTruthy();
    expect(screen.getByText("Discoverability")).toBeTruthy();
    expect(screen.getByText("Effectiveness")).toBeTruthy();
    expect(screen.getByText("Efficiency")).toBeTruthy();
    expect(screen.getAllByText("8")).toHaveLength(6);
    expect(screen.getByRole("link", { name: "nvidia/skills@aaaaaaa" }).getAttribute("href")).toBe(
      `https://github.com/nvidia/skills/commit/${"a".repeat(40)}`,
    );
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText("result.json")).toBeNull();
    expect(screen.queryByText("run_config.json")).toBeNull();
  });

  it("shows a one-attempt result in the overview", () => {
    render(
      <SkillEvaluationReport
        result={{ ...result, evaluator: { ...result.evaluator, attempts: 1 } }}
      />,
    );

    expect(screen.getByText("1 per case")).toBeTruthy();
  });
});
