import { describe, expect, it } from "vitest";
import {
  NVIDIA_SKILL_EVALUATION_CONFIG as config,
  NVIDIA_SKILL_EVALUATION_CONFIG_KEY as configKey,
  resolveSkillEvaluationRecipe,
} from "./skillEvaluationConfig";

describe("versioned evaluation recipes", () => {
  it("pins agent medium, judge high and Standard separately from historical results", () => {
    expect(config).toMatchObject({
      agentModel: "gpt-6.1-sol",
      agentReasoningEffort: "medium",
      judgeModel: "gpt-6.1-sol",
      judgeReasoningEffort: "high",
      serviceTier: "default",
    });
    expect(configKey).toContain(":model-policy-v2:medium:high:default");
    expect(resolveSkillEvaluationRecipe({ ...config, configKey })).toEqual(config);
  });
  it("retains the original recipe and refuses a changed identity under either key", () => {
    const legacy = {
      ...config,
      agentModel: "gpt-5.4-mini",
      judgeModel: "gpt-5.4",
      configKey:
        "v0.5.0:7304d76cde371287b67ea99653409d014b6b9c85:codex:gpt-5.4-mini:openai-compatible:gpt-5.4:docker:2",
    };
    const recipe = resolveSkillEvaluationRecipe(legacy);
    expect(recipe).toMatchObject({ agentModel: "gpt-5.4-mini", judgeModel: "gpt-5.4" });
    expect(recipe).not.toHaveProperty("agentReasoningEffort");
    for (const run of [
      { ...legacy, agentModel: "other" },
      { ...config, configKey: "unknown" },
      { ...config, configKey, evaluatorCommit: "other" },
    ])
      expect(resolveSkillEvaluationRecipe(run)).toBeUndefined();
  });
});
