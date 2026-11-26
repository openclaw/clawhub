import type { ClawdisSkillMetadata } from "clawhub-schema";

const installTabLabels = {
  runtime: "Requirements",
  dependencies: "Dependencies",
  install: "Install",
  links: "Links",
} as const;

export type SkillInstallTabId = keyof typeof installTabLabels;
export type DetailTab = "readme" | "evaluation" | SkillInstallTabId;
export type SkillDetailTab = { id: DetailTab; label: string };

export function skillTabFromHash(hash: string): DetailTab | null {
  const tab = hash.replace(/^#/, "").toLowerCase();
  switch (tab) {
    case "readme":
    case "evaluation":
    case "runtime":
    case "dependencies":
    case "install":
    case "links":
      return tab;
    default:
      return null;
  }
}

export function isSkillInstallTab(id: DetailTab): id is SkillInstallTabId {
  return id in installTabLabels;
}

export function buildSkillDetailTabs({
  hasEvaluation,
  clawdis,
  osLabels,
}: {
  hasEvaluation: boolean;
  clawdis: ClawdisSkillMetadata | undefined;
  osLabels: string[];
}): SkillDetailTab[] {
  const tabs: SkillDetailTab[] = [{ id: "readme", label: "SKILL.md" }];
  if (hasEvaluation) tabs.push({ id: "evaluation", label: "Evals" });
  const requirements = clawdis?.requires;
  const links = clawdis?.links;
  if (
    osLabels.length ||
    requirements?.bins?.length ||
    requirements?.anyBins?.length ||
    requirements?.env?.length ||
    requirements?.config?.length ||
    clawdis?.primaryEnv ||
    clawdis?.envVars?.length
  ) {
    tabs.push({ id: "runtime", label: installTabLabels.runtime });
  }
  if (clawdis?.dependencies?.length)
    tabs.push({ id: "dependencies", label: installTabLabels.dependencies });
  if (clawdis?.install?.length) tabs.push({ id: "install", label: installTabLabels.install });
  if (links?.homepage || links?.repository || links?.documentation || links?.changelog) {
    tabs.push({ id: "links", label: installTabLabels.links });
  }
  return tabs;
}
