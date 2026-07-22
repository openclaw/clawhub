import {
  resolveAdoptedActiveSource,
  shouldPromoteAdoptedCandidate,
} from "./skillsShRefreshLifecycle";

export type SkillsShCatalogPublicationControl = {
  mode: "off" | "fixture" | "staging-live";
  paused: boolean;
  publicVisibilityEnabled: boolean;
  realScanAllowlist: string[];
};

export type SkillsShCatalogIdentity = {
  externalId: string;
  githubOwnerId: number;
  owner: string;
  repo: string;
  slug: string;
  githubPath?: string;
  githubCommit?: string;
  githubContentHash?: string;
  sourceContentHash: string;
};

export type SkillsShCatalogVerdict = "clean" | "suspicious" | "malicious" | "failed";

export type SkillsShCatalogPublicationAttempt = SkillsShCatalogIdentity & {
  dispatchKind: "deterministic" | "real";
  source: "skills-sh-catalog-fixture" | "skills-sh-catalog-test";
};

export function isExactSkillsShCatalogAttempt(
  entry: SkillsShCatalogIdentity,
  attempt: SkillsShCatalogIdentity,
) {
  return (
    attempt.externalId === entry.externalId &&
    attempt.githubOwnerId === entry.githubOwnerId &&
    attempt.owner === entry.owner &&
    attempt.repo === entry.repo &&
    attempt.slug === entry.slug &&
    attempt.githubPath === entry.githubPath &&
    attempt.githubCommit === entry.githubCommit &&
    attempt.githubContentHash === entry.githubContentHash &&
    attempt.sourceContentHash === entry.sourceContentHash
  );
}

export function shouldPublishSkillsShCatalogEntry(args: {
  control: SkillsShCatalogPublicationControl | null;
  entry: SkillsShCatalogIdentity;
  attempt: SkillsShCatalogPublicationAttempt;
  verdict: SkillsShCatalogVerdict;
}) {
  return (
    args.control?.mode === "staging-live" &&
    !args.control.paused &&
    args.control.publicVisibilityEnabled &&
    args.control.realScanAllowlist.includes(args.attempt.externalId) &&
    args.attempt.dispatchKind === "real" &&
    args.attempt.source === "skills-sh-catalog-test" &&
    shouldPromoteAdoptedCandidate({
      current: args.entry,
      candidate: args.attempt,
      verdict: args.verdict,
    })
  );
}

export function shouldServePublishedSkillsShCatalogEntry(args: {
  control: SkillsShCatalogPublicationControl | null;
  entry: SkillsShCatalogIdentity;
  attempt: SkillsShCatalogPublicationAttempt;
  verdict: SkillsShCatalogVerdict;
}) {
  return (
    args.control?.mode === "staging-live" &&
    !args.control.paused &&
    args.control.publicVisibilityEnabled &&
    args.control.realScanAllowlist.includes(args.attempt.externalId) &&
    args.attempt.dispatchKind === "real" &&
    args.attempt.source === "skills-sh-catalog-test" &&
    (args.verdict === "clean" || args.verdict === "suspicious") &&
    args.entry.externalId === args.attempt.externalId &&
    args.entry.githubOwnerId === args.attempt.githubOwnerId &&
    args.entry.owner === args.attempt.owner &&
    args.entry.repo === args.attempt.repo &&
    args.entry.slug === args.attempt.slug
  );
}

export function resolveSkillsShCatalogActiveSource(args: {
  entry: SkillsShCatalogIdentity;
  attempt: SkillsShCatalogIdentity;
}) {
  return resolveAdoptedActiveSource({
    current: args.entry,
    active: args.attempt,
  }) === args.entry
    ? args.entry
    : args.attempt;
}

export function buildSkillsShCatalogInstallResolution(entry: SkillsShCatalogIdentity) {
  if (!entry.githubPath || !entry.githubCommit || !entry.githubContentHash) return null;
  const repo = `${entry.owner}/${entry.repo}`;
  return {
    ok: true as const,
    slug: `skills-sh/${entry.externalId}`,
    installKind: "github" as const,
    github: {
      repo,
      path: entry.githubPath,
      commit: entry.githubCommit,
      contentHash: entry.githubContentHash,
      sourceUrl: `https://github.com/${repo}/tree/${entry.githubCommit}/${entry.githubPath}`,
    },
  };
}
