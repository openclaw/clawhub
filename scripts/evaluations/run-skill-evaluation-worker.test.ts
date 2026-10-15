/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import {
  commandEnvironment,
  commandFailure,
  evaluationEnvironment,
} from "./run-skill-evaluation-worker";

describe("SkillEvaluator failure diagnostics", () => {
  const progress = "still running: agent:codex\n".repeat(300);

  it("preserves the stdout failure when stderr contains only progress", () => {
    const message = commandFailure("Evaluation failed", {
      stdout: "table row\n".repeat(300) + "Missing scored attempts for case positive",
      stderr: progress,
    });
    expect(message).toContain("Missing scored attempts for case positive");
    expect(message).toContain("still running: agent:codex");
    expect(message.length).toBeLessThan(2_000);
  });

  it("uses native execution errors before rendered output and redacts credentials", () => {
    const message = commandFailure(
      "Evaluation failed",
      { stdout: "rendered report", stderr: progress },
      JSON.stringify({
        execution_errors: ["Provider rejected OPENAI_API_KEY=sk-secret0123456789abcdef0123456789"],
      }),
    );
    expect(message).toContain("Provider rejected");
    expect(message).not.toContain("sk-secret0123456789abcdef0123456789");
    expect(message).not.toContain("still running");
  });

  it("keeps command diagnostics when the report is malformed", () => {
    expect(
      commandFailure("Evaluation failed", { stdout: "Report failed", stderr: progress }, "{"),
    ).toContain("Report failed");
  });

  it("redacts a credential before trimming away its identifying field name", () => {
    const secret = "private-value".repeat(100);
    const message = commandFailure("Evaluation failed", {
      stdout: `API_KEY=${secret}\nReport finalization failed`,
      stderr: progress,
    });
    expect(message).not.toContain("private-value");
    expect(message).toContain("Report finalization failed");
  });
});

describe("SkillEvaluator worker credential boundary", () => {
  const source = {
    CONVEX_DEPLOY_KEY: "convex-control-plane",
    GITHUB_TOKEN: "github-control-plane",
    HOME: "/tmp/worker-home",
    OPENAI_API_KEY: "long-lived-provider-key",
    PATH: "/usr/bin",
    SECURITY_SCAN_WORKER_TOKEN: "worker-control-plane",
  };

  it("runs validation and setup commands without credentials", () => {
    expect(commandEnvironment(source)).toEqual({
      HOME: "/tmp/worker-home",
      NO_COLOR: "1",
      PATH: "/usr/bin",
    });
  });

  it("gives evaluation only the short-lived broker capability", () => {
    const environment = evaluationEnvironment(
      { judgeModel: "gpt-judge", judgeProvider: "openai-compatible" },
      { baseUrl: "http://docker-gateway:1234/v1", token: "short-lived-capability" },
      source,
    );

    expect(environment).toMatchObject({
      HOME: "/tmp/worker-home",
      OPENAI_API_KEY: "short-lived-capability",
      OPENAI_BASE_URL: "http://docker-gateway:1234/v1",
      PATH: "/usr/bin",
      SKILL_EVAL_JUDGE_MODEL: "gpt-judge",
      SKILL_EVAL_LLM_MODEL: "gpt-judge",
      SKILL_EVAL_LLM_PROVIDER: "openai-compatible",
      SKILL_EVAL_LLM_API_KEY: "short-lived-capability",
      SKILL_EVAL_LLM_BASE_URL: "http://docker-gateway:1234/v1",
    });
    expect(Object.values(environment)).not.toContain("long-lived-provider-key");
    expect(Object.values(environment)).not.toContain("worker-control-plane");
  });
});
