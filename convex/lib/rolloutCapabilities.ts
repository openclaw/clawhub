import { getClawHubRolloutCapabilities, type ClawHubRolloutEnvironment } from "clawhub-schema";
import { ConvexError } from "convex/values";

export const LEGACY_NVIDIA_SKILL_SOURCE = "nvidia/skills";

export function getRuntimeRolloutCapabilities(env: ClawHubRolloutEnvironment = process.env) {
  return getClawHubRolloutCapabilities(env);
}

export function assertSkillsShRuntimeEnabled(env: ClawHubRolloutEnvironment = process.env) {
  const capabilities = getRuntimeRolloutCapabilities(env);
  if (!capabilities.skillsSh.runtimeEnabled) {
    throw new ConvexError("skills.sh catalog rollout is disabled");
  }
  return capabilities;
}

export function assertGitHubSkillSyncRuntimeEnabled(env: ClawHubRolloutEnvironment = process.env) {
  const capabilities = getRuntimeRolloutCapabilities(env);
  if (!capabilities.githubSkillSync.runtimeEnabled) {
    throw new ConvexError("GitHub Skill Sync rollout is disabled");
  }
  return capabilities;
}

export function isLegacyNvidiaSkillSource(repo: string) {
  return repo.trim().toLowerCase() === LEGACY_NVIDIA_SKILL_SOURCE;
}

export function assertGenericGitHubSkillSyncEnabled(
  repo: string,
  env: ClawHubRolloutEnvironment = process.env,
) {
  if (isLegacyNvidiaSkillSource(repo)) return getRuntimeRolloutCapabilities(env);
  return assertGitHubSkillSyncRuntimeEnabled(env);
}
