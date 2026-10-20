/* @vitest-environment node */
import { describe, expect, it } from "vitest";
import { configuredClawScanJudgeModel, securityScannerEnvironment } from "./securityModelPolicy";

describe("security consumer model policy", () => {
  it("defaults A.I.G and SkillSpector independently to Sol medium", () => {
    expect(securityScannerEnvironment({})).toEqual({
      DEFAULT_MODEL: "gpt-6.1-sol",
      REASONING_EFFORT: "medium",
      SKILLSPECTOR_PROVIDER: "openai",
      SKILLSPECTOR_MODEL: "gpt-6.1-sol",
      SKILLSPECTOR_REASONING_EFFORT: "medium",
    });
  });

  it("preserves explicit overrides without coupling model lanes or forwarding worker secrets", () => {
    expect(
      securityScannerEnvironment({
        DEFAULT_MODEL: "aig-model",
        REASONING_EFFORT: "low",
        AIG_SERVICE_TIER: "flex",
        SKILLSPECTOR_SERVICE_TIER: "priority",
        OPENAI_EVAL_SERVICE_TIER: "auto",
        OPENAI_EVAL_MODEL: "judge-model",
        SECURITY_SCAN_WORKER_TOKEN: "worker-secret",
        OPENAI_BASE_URL: "https://unapproved.invalid",
      }),
    ).toEqual({
      DEFAULT_MODEL: "aig-model",
      REASONING_EFFORT: "low",
      AIG_SERVICE_TIER: "flex",
      SKILLSPECTOR_SERVICE_TIER: "priority",
      SKILLSPECTOR_PROVIDER: "openai",
      SKILLSPECTOR_MODEL: "gpt-6.1-sol",
      SKILLSPECTOR_REASONING_EFFORT: "medium",
    });
  });

  it("retains non-OpenAI provider defaults and explicit model controls", () => {
    expect(
      securityScannerEnvironment({
        SKILLSPECTOR_PROVIDER: "anthropic",
        DEFAULT_BASE_URL: "https://custom.invalid/v1",
      }),
    ).toEqual({
      SKILLSPECTOR_PROVIDER: "anthropic",
      DEFAULT_BASE_URL: "https://custom.invalid/v1",
    });
    expect(
      securityScannerEnvironment({
        DEFAULT_MODEL: "custom-model",
        SKILLSPECTOR_MODEL: "custom-spector",
      }),
    ).toEqual({
      DEFAULT_MODEL: "custom-model",
      SKILLSPECTOR_PROVIDER: "openai",
      SKILLSPECTOR_MODEL: "custom-spector",
    });
  });

  it.each([
    ["codex exec --model gpt-6.1-sol -c service_tier=default", "gpt-6.1-sol"],
    ["codex exec --model='custom/judge' --json", "custom/judge"],
    ['codex exec --model "custom-judge" --json', "custom-judge"],
    ["codex exec --model $MODEL --json", undefined],
    ['codex exec --model "gpt-6.1-sol;echo"', undefined],
  ])("captures configured literal model from execution command %s", (command, expected) => {
    expect(configuredClawScanJudgeModel({ command })).toBe(expected);
  });

  it("never invents provenance from defaults or model-authored result fields", () => {
    expect(configuredClawScanJudgeModel(undefined)).toBeUndefined();
    expect(configuredClawScanJudgeModel({ result: { model: "pretend-provider" } })).toBeUndefined();
    expect(
      configuredClawScanJudgeModel({
        configuredModel: "actual-configured",
        command: "codex exec --model other",
      }),
    ).toBe("actual-configured");
  });
});
