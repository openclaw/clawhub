export const SKILLS_SH_TRUST_LABEL = "Not scanned by ClawHub";

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
  upstreamInstalls: number;
  lastObservedAt: number;
};

export type SkillsShUpstreamCheck = {
  scanner: string;
  status: "passed" | "warning" | "failed" | "unavailable";
  sourceStatus: string;
  checkedAt?: number;
  url?: string;
};

export type SkillsShCatalogDetail = SkillsShSearchResult & {
  categories: string[];
  topics: string[];
  sourceUrl: string;
  canonicalRepoUrl?: string;
  canonicalGitHubRepo: string;
  githubPath?: string;
  githubCommit?: string;
  githubContentHash?: string;
  sourceContentHash?: string;
  upstreamChecks: SkillsShUpstreamCheck[];
  content: {
    kind: "skill-md" | "readme";
    path: string;
    markdown: string;
    bytes: number;
    truncated: boolean;
  } | null;
};

export type CanonicalSkillSearchResult = {
  id: string;
  source: "clawhub" | "skills-sh";
  slug: string;
  displayName: string;
  summary: string | null;
  score: number;
  canonicalUrl: string;
  install: {
    kind: "clawhub" | "github" | "skills-sh";
    reference: string;
    sourceUrl: string | null;
  };
  sourceIdentity: {
    id: string;
    owner: string | null;
    repo: string | null;
    host: string | null;
    lifetimeInstalls: number | null;
  };
  metrics: { updatedAt: number };
  native: unknown;
};

export function toSkillsShSearchResult(
  result: CanonicalSkillSearchResult,
): SkillsShSearchResult | null {
  if (
    result.source !== "skills-sh" ||
    result.install.kind !== "skills-sh" ||
    !result.install.reference.startsWith("skills-sh:")
  ) {
    return null;
  }
  return {
    source: "skills.sh",
    externalId: result.sourceIdentity.id,
    route: result.canonicalUrl,
    reference: result.install.reference,
    owner: result.sourceIdentity.owner ?? undefined,
    repo: result.sourceIdentity.repo ?? undefined,
    sourceHost: result.sourceIdentity.host ?? undefined,
    slug: result.slug,
    displayName: result.displayName,
    summary: result.summary ?? undefined,
    upstreamInstalls: result.sourceIdentity.lifetimeInstalls ?? 0,
    lastObservedAt: result.metrics.updatedAt,
  };
}

export function skillsShRepositoryLabel(result: SkillsShSearchResult) {
  if (result.owner && result.repo) return `${result.owner}/${result.repo}`;
  return result.sourceHost ?? "skills.sh";
}

export function buildSkillsShInstallCommands(reference: string) {
  return [
    { client: "OpenClaw", command: `openclaw skills install ${reference}` },
    { client: "ClawHub", command: `clawhub install ${reference}` },
  ] as const;
}

export function isSkillsShCatalogInstallable(
  detail: Pick<SkillsShCatalogDetail, "githubCommit" | "githubContentHash" | "githubPath">,
) {
  return Boolean(
    detail.githubPath?.trim() &&
    /^[a-f0-9]{40}$/.test(detail.githubCommit?.trim().toLowerCase() ?? "") &&
    /^[a-f0-9]{64}$/.test(detail.githubContentHash?.trim().toLowerCase() ?? ""),
  );
}
