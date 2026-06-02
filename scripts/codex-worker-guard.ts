export const LOCAL_CODEX_WORKER_OPT_IN = "CLAWHUB_ALLOW_LOCAL_CODEX_SCAN";

export function isGitHubActionsRunner(env: NodeJS.ProcessEnv) {
  return (
    env.GITHUB_ACTIONS === "true" &&
    env.CI === "true" &&
    Boolean(env.GITHUB_RUN_ID?.trim()) &&
    Boolean(env.GITHUB_REPOSITORY?.trim())
  );
}

export function isCodexWorkerExecutionAllowed(env: NodeJS.ProcessEnv) {
  return env[LOCAL_CODEX_WORKER_OPT_IN] === "1" || isGitHubActionsRunner(env);
}

export function localCodexWorkerOptInReason() {
  return `set ${LOCAL_CODEX_WORKER_OPT_IN}=1 to run Codex workers locally`;
}

export function assertCodexWorkerExecutionAllowed(env: NodeJS.ProcessEnv) {
  if (isCodexWorkerExecutionAllowed(env)) return;
  throw new Error(`Refusing to run local Codex workers without ${LOCAL_CODEX_WORKER_OPT_IN}=1`);
}

export function resolveCodexWorkerHome(env: NodeJS.ProcessEnv, fallbackLocalHome: string) {
  const explicitHome = env.CODEX_HOME?.trim();
  if (explicitHome) return explicitHome;
  if (isGitHubActionsRunner(env)) return undefined;
  if (env[LOCAL_CODEX_WORKER_OPT_IN] === "1") return fallbackLocalHome;
  return undefined;
}
