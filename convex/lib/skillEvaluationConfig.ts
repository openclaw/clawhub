export const NVIDIA_SKILL_EVALUATION_CONFIG = {
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

export const NVIDIA_SKILL_EVALUATION_CONFIG_KEY = [
  NVIDIA_SKILL_EVALUATION_CONFIG.evaluatorRelease,
  NVIDIA_SKILL_EVALUATION_CONFIG.evaluatorCommit,
  NVIDIA_SKILL_EVALUATION_CONFIG.agent,
  NVIDIA_SKILL_EVALUATION_CONFIG.agentModel,
  NVIDIA_SKILL_EVALUATION_CONFIG.judgeProvider,
  NVIDIA_SKILL_EVALUATION_CONFIG.judgeModel,
  NVIDIA_SKILL_EVALUATION_CONFIG.environment,
  NVIDIA_SKILL_EVALUATION_CONFIG.attemptsPerCase,
].join(":");
