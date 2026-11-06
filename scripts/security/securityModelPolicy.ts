// These are independent live model lanes. Never inherit A.I.G's generic model
// setting into SkillSpector or the final judge.
export const SECURITY_PROVIDER_ENV_KEYS = [
  "AIG_SERVICE_TIER",
  "CODEX_API_KEY",
  "DEFAULT_BASE_URL",
  "DEFAULT_MODEL",
  "LLM_API_KEY",
  "OPENAI_API_KEY",
  "REASONING_EFFORT",
  "SKILLSPECTOR_PROVIDER",
  "SKILLSPECTOR_MODEL",
  "SKILLSPECTOR_REASONING_EFFORT",
  "SKILLSPECTOR_SERVICE_TIER",
] as const;

export function securityScannerEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const settings: NodeJS.ProcessEnv = {};
  for (const key of SECURITY_PROVIDER_ENV_KEYS) {
    if (env[key] !== undefined) settings[key] = env[key];
  }
  settings.SKILLSPECTOR_PROVIDER ||= "openai";
  if (settings.SKILLSPECTOR_PROVIDER === "openai") {
    settings.SKILLSPECTOR_MODEL ||= "gpt-6.1-sol";
    if (settings.SKILLSPECTOR_MODEL === "gpt-6.1-sol") {
      settings.SKILLSPECTOR_REASONING_EFFORT ||= "medium";
    }
  }
  const base = settings.DEFAULT_BASE_URL?.replace(/\/+$/, "");
  if (base === "https://api.openai.com/v1" || (!base && !settings.LLM_API_KEY)) {
    settings.DEFAULT_MODEL ||= "gpt-6.1-sol";
    if (settings.DEFAULT_MODEL === "gpt-6.1-sol") settings.REASONING_EFFORT ||= "medium";
  }
  return settings;
}

// ClawScan's command is execution metadata; result.model is model-authored JSON,
// not provider provenance. Keep legacy artifacts without execution metadata unknown.
export function configuredClawScanJudgeModel(judge: Record<string, unknown> | undefined) {
  if (typeof judge?.configuredModel === "string" && judge.configuredModel.trim()) {
    return judge.configuredModel.trim();
  }
  if (typeof judge?.command !== "string") return undefined;
  return /(?:^|\s)--model(?:=|\s+)["']?([a-zA-Z0-9][a-zA-Z0-9._/-]*)(?:["']?)(?=\s|$)/.exec(
    judge.command,
  )?.[1];
}
