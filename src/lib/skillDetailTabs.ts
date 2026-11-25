import type { ClawdisSkillMetadata } from "clawhub-schema";

const installTabLabels = {
  runtime: "Requirements",
  dependencies: "Dependencies",
  install: "Install",
  links: "Links",
} as const;

export type SkillInstallTabId = keyof typeof installTabLabels;
export type DetailTab =
  | "readme"
  | "skill-card"
  | "evaluation"
  | "files"
  | "compare"
  | "versions"
  | SkillInstallTabId;
export type SkillDetailTab = { id: DetailTab; label: string };

export function skillTabFromHash(hash: string): DetailTab | null {
  const tab = hash.replace(/^#/, "").toLowerCase();
  if (tab === "card") return "skill-card";
  if (tab === "diff") return "compare";
  switch (tab) {
    case "readme":
    case "skill-card":
    case "evaluation":
    case "files":
    case "compare":
    case "versions":
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
  hasSkillCard,
  hasEvaluation,
  showArchiveTabs,
  versionCount,
  clawdis,
  osLabels,
}: {
  hasSkillCard: boolean;
  hasEvaluation: boolean;
  showArchiveTabs: boolean;
  versionCount: number;
  clawdis: ClawdisSkillMetadata | undefined;
  osLabels: string[];
}): SkillDetailTab[] {
  const tabs: SkillDetailTab[] = [{ id: "readme", label: "SKILL.md" }];
  if (hasEvaluation) tabs.push({ id: "evaluation", label: "Evals" });
  if (hasSkillCard) tabs.push({ id: "skill-card", label: "Skill Card" });
  if (showArchiveTabs) {
    tabs.push({ id: "files", label: "Files" });
    if (versionCount > 1) tabs.push({ id: "compare", label: "Diff" });
    tabs.push({ id: "versions", label: "Versions" });
  }
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
