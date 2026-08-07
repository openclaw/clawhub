/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  SkillEvaluationReport,
  type SkillEvaluationMetrics,
  type SkillEvaluationRunRecord,
} from "./SkillEvaluationReport";

function record(
  state: SkillEvaluationRunRecord["state"],
  overrides: Partial<SkillEvaluationRunRecord> = {},
): SkillEvaluationRunRecord {
  return {
    schemaVersion: 1,
    state,
    smokeRun: true,
    source: {
      repository: "nvidia/skills",
      commit: "a".repeat(40),
      path: "skills/doca-dpa",
      contentHash: "content-hash",
      upstreamVersion: null,
    },
    evals: {
      directory: "skills/doca-dpa/evals",
      taskSource: "evals_json",
      dataset: "skills/doca-dpa/evals/evals.json",
      config: null,
    },
    evaluator: {
      repository: "NVIDIA/SkillEvaluator",
      commit: "b".repeat(40),
      version: "0.1.0",
      agent: "codex",
      model: "gpt-5.4-mini",
      provider: "openai",
      environment: "local",
      attempts: 1,
    },
    timing: { startedAt: "2026-08-04T00:00:00.000Z" },
    ...overrides,
  };
}

describe("SkillEvaluationReport", () => {
  it("shows an in-progress evaluation without inventing a score", () => {
    render(<SkillEvaluationReport record={record("pending")} />);

    expect(screen.getByRole("status").textContent).toContain("Evaluation in progress");
  });

  it("shows the upstream skip reason when no evals exist", () => {
    render(
      <SkillEvaluationReport
        record={record("skipped", {
          reason: { code: "no-evals", message: "No evals were found for this skill version." },
        })}
      />,
    );

    expect(screen.getByText("No evals were found for this skill version.")).toBeTruthy();
  });

  it("shows evaluation failures", () => {
    render(
      <SkillEvaluationReport
        record={record("failed", {
          reason: { code: "evaluator-failed", message: "SkillEvaluator exited with code 1." },
        })}
      />,
    );

    expect(screen.getByText("SkillEvaluator exited with code 1.")).toBeTruthy();
  });

  it("renders the native JSON summary and dimension metrics without embedding the HTML report", () => {
    const metrics: SkillEvaluationMetrics = {
      agent: "codex",
      overall: { withSkill: 0.9587, withoutSkill: 0.6058, delta: 0.3529 },
      passRate: {
        withSkill: { passed: 4, total: 4, rate: 1 },
        withoutSkill: { passed: 2, total: 4, rate: 0.5 },
      },
      metrics: [
        { name: "Security", withSkill: 1, withoutSkill: 1, delta: 0 },
        { name: "Accuracy", withSkill: 0.9, withoutSkill: 0.45, delta: 0.45 },
      ],
    };

    render(
      <SkillEvaluationReport
        record={record("completed", {
          timing: {
            startedAt: "2026-08-04T00:00:00.000Z",
            finishedAt: "2026-08-04T00:05:00.000Z",
          },
          artifacts: {
            reportUrl: "/__skill-evaluator-demo/report.html",
            resultUrl: "/__skill-evaluator-demo/result.json",
            runConfigUrl: "/__skill-evaluator-demo/run_config.json",
          },
        })}
        metrics={metrics}
      />,
    );

    expect(screen.getByText("95.9%")).toBeTruthy();
    expect(screen.getByText("+35.3 pts")).toBeTruthy();
    expect(screen.getByText("4 / 4")).toBeTruthy();
    expect(screen.getByRole("rowheader", { name: "Accuracy" })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "+45.0 pts" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "SkillEvaluator" }).getAttribute("href")).toBe(
      "https://github.com/NVIDIA/SkillEvaluator",
    );
    expect(screen.queryByTitle("SkillEvaluator report")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText("One-attempt smoke run")).toBeNull();
    expect(screen.queryByText("Run details")).toBeNull();
    expect(screen.queryByText("result.json")).toBeNull();
    expect(screen.queryByText("run_config.json")).toBeNull();
  });
});
