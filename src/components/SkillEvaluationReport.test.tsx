/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SkillEvaluationReport, type SkillEvaluationRunRecord } from "./SkillEvaluationReport";

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

  it("shows failures with provenance", () => {
    render(
      <SkillEvaluationReport
        record={record("failed", {
          reason: { code: "evaluator-failed", message: "SkillEvaluator exited with code 1." },
        })}
      />,
    );

    expect(screen.getByText("SkillEvaluator exited with code 1.")).toBeTruthy();
    expect(screen.getByText("gpt-5.4-mini")).toBeTruthy();
  });

  it("embeds the interactive native report in an opaque-origin script sandbox", () => {
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
      />,
    );

    const frame = screen.getByTitle("SkillEvaluator report");
    expect(frame.getAttribute("src")).toBe("/__skill-evaluator-demo/report.html");
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(screen.queryByRole("link", { name: "Open report" })).toBeNull();
    expect(screen.getByText("One-attempt smoke run")).toBeTruthy();
  });
});
