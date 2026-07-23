export const SKILLS_SH_TRUST_LABEL = "Not scanned by ClawHub";

type SkillsShUpstreamCheckStatus = "passed" | "warning" | "failed" | "unavailable";

export type SkillsShUpstreamCheck = {
  scanner: string;
  status: SkillsShUpstreamCheckStatus;
  sourceStatus: string;
  checkedAt?: number;
  url?: string;
};

export type SkillsShSearchResult = {
  source: "skills.sh";
  externalId: string;
  route: string;
  reference: string;
  owner?: string;
  repo?: string;
  sourceHost?: string;
  slug: string;
  displayName: string;
  summary?: string;
  categories: string[];
  topics: string[];
  upstreamInstalls: number;
  lastObservedAt: number;
};

export type SkillsShSearchEntry = SkillsShSearchResult & {
  score: number;
};

type SkillsShCatalogContent = {
  kind: "skill-md" | "readme";
  path: string;
  markdown: string;
  bytes: number;
  truncated: boolean;
};

export type SkillsShCatalogDetail = SkillsShSearchResult & {
  sourceUrl: string;
  canonicalRepoUrl?: string;
  githubPath?: string;
  githubCommit?: string;
  sourceContentHash?: string;
  upstreamChecks: SkillsShUpstreamCheck[];
  content: SkillsShCatalogContent | null;
};

export function skillsShRepositoryLabel(result: SkillsShSearchResult) {
  if (result.owner && result.repo) return `${result.owner}/${result.repo}`;
  return result.sourceHost ?? "skills.sh";
}

export function buildSkillsShInstallCommands(reference: string) {
  return [
    {
      client: "OpenClaw",
      command: `openclaw skills install ${reference}`,
    },
    {
      client: "ClawHub",
      command: `clawhub install ${reference}`,
    },
  ] as const;
}

export function isSkillsShCatalogInstallable(
  detail: Pick<SkillsShCatalogDetail, "githubCommit" | "githubPath" | "sourceContentHash">,
) {
  const path = detail.githubPath?.trim().replace(/^\/+|\/+$/g, "");
  const commit = detail.githubCommit?.trim().toLowerCase();
  const contentHash = detail.sourceContentHash?.trim().toLowerCase();
  return Boolean(
    path &&
    commit &&
    contentHash &&
    /^[a-f0-9]{40}$/.test(commit) &&
    /^[a-f0-9]{64}$/.test(contentHash),
  );
}

export function isSkillsShSearchResult(value: unknown): value is SkillsShSearchEntry {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as { source?: unknown }).source === "skills.sh"
  );
}
