// Keep the original recipe immutable so historical runs remain reproducible.
const LEGACY_NVIDIA_SKILL_EVALUATION_CONFIG = {
  sourceRepo: "nvidia/skills",
  evaluatorRepository: "NVIDIA/SkillEvaluator",
  evaluatorRelease: "v0.5.0",
  evaluatorCommit: "7304d76cde371287b67ea99653409d014b6b9c85",
  agent: "codex",
  agentModel: "gpt-5.4-mini",
  judgeProvider: "openai-compatible",
  judgeModel: "gpt-5.4",
  environment: "docker",
  attemptsPerCase: 2,
} as const;

export const NVIDIA_SKILL_EVALUATION_CONFIG = {
  ...LEGACY_NVIDIA_SKILL_EVALUATION_CONFIG,
  agentModel: "gpt-6.1-sol",
  agentReasoningEffort: "medium",
  judgeModel: "gpt-6.1-sol",
  judgeReasoningEffort: "high",
  serviceTier: "default",
  recipeVersion: "model-policy-v2",
} as const;

type StoredConfiguration = {
  [
    K in keyof typeof LEGACY_NVIDIA_SKILL_EVALUATION_CONFIG
  ]: (typeof LEGACY_NVIDIA_SKILL_EVALUATION_CONFIG)[K] extends number ? number : string;
};

function configurationKey(config: StoredConfiguration) {
  return [
    config.evaluatorRelease,
    config.evaluatorCommit,
    config.agent,
    config.agentModel,
    config.judgeProvider,
    config.judgeModel,
    config.environment,
    config.attemptsPerCase,
  ].join(":");
}

export const NVIDIA_SKILL_EVALUATION_CONFIG_KEY = [
  configurationKey(NVIDIA_SKILL_EVALUATION_CONFIG),
  NVIDIA_SKILL_EVALUATION_CONFIG.recipeVersion,
  NVIDIA_SKILL_EVALUATION_CONFIG.agentReasoningEffort,
  NVIDIA_SKILL_EVALUATION_CONFIG.judgeReasoningEffort,
  NVIDIA_SKILL_EVALUATION_CONFIG.serviceTier,
].join(":");

export function resolveSkillEvaluationRecipe(run: StoredConfiguration & { configKey: string }) {
  const legacy = LEGACY_NVIDIA_SKILL_EVALUATION_CONFIG;
  const config =
    run.configKey === NVIDIA_SKILL_EVALUATION_CONFIG_KEY
      ? NVIDIA_SKILL_EVALUATION_CONFIG
      : run.configKey === configurationKey(legacy)
        ? legacy
        : undefined;
  if (
    !config ||
    !Object.entries(legacy).every(
      ([key]) => run[key as keyof StoredConfiguration] === config[key as keyof StoredConfiguration],
    )
  ) {
    return undefined;
  }
  return config;
}
