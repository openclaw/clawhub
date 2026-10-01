/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import { commandEnvironment, evaluationEnvironment } from "./run-skill-evaluation-worker";

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
      { judgeModel: "gpt-judge", judgeProvider: "openai" },
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
      SKILL_EVAL_LLM_PROVIDER: "openai",
    });
    expect(Object.values(environment)).not.toContain("long-lived-provider-key");
    expect(Object.values(environment)).not.toContain("worker-control-plane");
  });
});
