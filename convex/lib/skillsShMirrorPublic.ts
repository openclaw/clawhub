export const SKILLS_SH_UNSCANNED_LABEL = "Not scanned by ClawHub";

const GITHUB_COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const CONTENT_HASH_PATTERN = /^[a-f0-9]{64}$/;

export type SkillsShMirrorDigest = {
  externalId: string;
  sourceType: "github" | "well-known";
  owner?: string;
  repo?: string;
  sourceHost?: string;
  slug: string;
  displayName: string;
  sourceUrl: string;
  canonicalRepoUrl?: string;
  githubPath?: string;
  githubCommit?: string;
  sourceContentHash?: string;
  upstreamInstalls: number;
  upstreamScanners: {
    genAgentTrustHub: SkillsShMirrorUpstreamScanner;
    socket: SkillsShMirrorUpstreamScanner;
    snyk: SkillsShMirrorUpstreamScanner;
  };
  inferredCategories?: string[];
  inferredTopics?: string[];
  inferredCategoryConfidence?: "high" | "medium" | "low";
  inferredTopicConfidence?: "high" | "medium" | "low";
  inferredClassifierVersion?: string;
  inferredTopicClassifierVersion?: string;
  inferredInputHash?: string;
  inferredTopicInputHash?: string;
  inferredAt?: number;
  sourceFreshnessStatus: "observed-only";
  detailStatus: "available" | "missing";
  active: boolean;
  publicVisible: false;
  installable: false;
  lastObservedAt: number;
};

type SkillsShMirrorUpstreamScanner = {
  status: string;
  sourceCheckedAt?: string;
  sourceUrl?: string;
};

export type SkillsShMirrorDetail = {
  externalId: string;
  contentKind: "skill-md" | "readme";
  path: string;
  content: string;
  contentBytes: number;
  sourceBytes: number;
  sourceFileCount: number;
  truncated: boolean;
  sourceContentHash?: string;
  updatedAt: number;
};

const UPSTREAM_SCANNERS = ["Gen Agent Trust Hub", "Socket", "Snyk"] as const;

function normalizedSegment(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  if (
    !normalized ||
    normalized.includes("/") ||
    normalized.includes("\\") ||
    normalized.includes(":") ||
    normalized.includes("..")
  ) {
    return null;
  }
  return normalized;
}

export function buildSkillsShMirrorIdentity(
  digest: Pick<SkillsShMirrorDigest, "externalId" | "owner" | "repo" | "slug" | "sourceType">,
) {
  if (digest.sourceType !== "github") return null;
  const owner = normalizedSegment(digest.owner);
  const repo = normalizedSegment(digest.repo);
  const slug = normalizedSegment(digest.slug);
  if (!owner || !repo || !slug) return null;
  const externalId = `${owner}/${repo}/${slug}`;
  if (digest.externalId.trim().toLowerCase() !== externalId) return null;
  return {
    owner,
    repo,
    slug,
    externalId,
    route: `/skills-sh/${owner}/${repo}/${slug}`,
    reference: `skills-sh:${externalId}`,
  };
}

function isUnclaimedMirrorDigest(digest: SkillsShMirrorDigest) {
  return (
    digest.active &&
    digest.publicVisible === false &&
    digest.installable === false &&
    digest.sourceFreshnessStatus === "observed-only"
  );
}

function upstreamCheckStatus(status: string) {
  switch (status.trim().toLowerCase()) {
    case "pass":
    case "passed":
    case "clean":
      return "passed" as const;
    case "warn":
    case "warning":
      return "warning" as const;
    case "fail":
    case "failed":
    case "unsafe":
      return "failed" as const;
    default:
      return "unavailable" as const;
  }
}

function buildUpstreamCheck(scanner: string, result: SkillsShMirrorUpstreamScanner) {
  const checkedAt = result.sourceCheckedAt ? Date.parse(result.sourceCheckedAt) : Number.NaN;
  return {
    scanner,
    status: upstreamCheckStatus(result.status),
    sourceStatus: result.status,
    ...(Number.isNaN(checkedAt) ? {} : { checkedAt }),
    ...(result.sourceUrl ? { url: result.sourceUrl } : {}),
  };
}

export function buildSkillsShMirrorSearchResult(digest: SkillsShMirrorDigest) {
  const identity = buildSkillsShMirrorIdentity(digest);
  if (!identity || !isUnclaimedMirrorDigest(digest)) return null;
  return {
    source: "skills.sh" as const,
    externalId: identity.externalId,
    route: identity.route,
    reference: identity.reference,
    owner: identity.owner,
    repo: identity.repo,
    slug: identity.slug,
    displayName: digest.displayName,
    categories: digest.inferredCategories?.length ? digest.inferredCategories : ["other"],
    topics: digest.inferredTopics ?? [],
    upstreamInstalls: digest.upstreamInstalls,
    lastObservedAt: digest.lastObservedAt,
  };
}

export function buildSkillsShMirrorCatalogDetail(args: {
  digest: SkillsShMirrorDigest;
  detail: SkillsShMirrorDetail | null;
}) {
  const searchResult = buildSkillsShMirrorSearchResult(args.digest);
  if (!searchResult) return null;
  const detail =
    args.detail?.externalId.trim().toLowerCase() === searchResult.externalId
      ? {
          kind: args.detail.contentKind,
          path: args.detail.path,
          markdown: args.detail.content,
          bytes: args.detail.contentBytes,
          truncated: args.detail.truncated,
        }
      : null;
  return {
    ...searchResult,
    sourceUrl: args.digest.sourceUrl,
    canonicalRepoUrl: args.digest.canonicalRepoUrl,
    githubPath: args.digest.githubPath,
    githubCommit: args.digest.githubCommit,
    sourceContentHash: args.digest.sourceContentHash,
    upstreamChecks: [
      buildUpstreamCheck(UPSTREAM_SCANNERS[0], args.digest.upstreamScanners.genAgentTrustHub),
      buildUpstreamCheck(UPSTREAM_SCANNERS[1], args.digest.upstreamScanners.socket),
      buildUpstreamCheck(UPSTREAM_SCANNERS[2], args.digest.upstreamScanners.snyk),
    ],
    content: detail,
  };
}

export function buildSkillsShMirrorGitHubSourceUrl(args: {
  owner: string;
  repo: string;
  commit: string;
  path: string;
}) {
  return `https://github.com/${args.owner}/${args.repo}/tree/${args.commit}/${args.path}`;
}

export function buildUnclaimedSkillsShInstallResolution(digest: SkillsShMirrorDigest) {
  const identity = buildSkillsShMirrorIdentity(digest);
  const path = digest.githubPath?.trim().replace(/^\/+|\/+$/g, "");
  const commit = digest.githubCommit?.trim().toLowerCase();
  const contentHash = digest.sourceContentHash?.trim().toLowerCase();
  if (
    !identity ||
    !isUnclaimedMirrorDigest(digest) ||
    !path ||
    !commit ||
    !contentHash ||
    !GITHUB_COMMIT_PATTERN.test(commit) ||
    !CONTENT_HASH_PATTERN.test(contentHash)
  ) {
    return null;
  }
  const sourceUrl = buildSkillsShMirrorGitHubSourceUrl({
    owner: identity.owner,
    repo: identity.repo,
    commit,
    path,
  });
  return {
    ok: true as const,
    slug: identity.reference,
    installKind: "github" as const,
    github: {
      repo: `${identity.owner}/${identity.repo}`,
      path,
      commit,
      contentHash,
      sourceUrl,
    },
    provenance: {
      source: "skills.sh" as const,
      reference: identity.reference,
    },
    trust: {
      clawhubScan: "unscanned" as const,
      label: SKILLS_SH_UNSCANNED_LABEL,
    },
    canonicalRef: null,
  };
}

export function buildUnclaimedSkillsShVerifyResponse(args: {
  digest: SkillsShMirrorDigest;
  origin: string;
}) {
  const install = buildUnclaimedSkillsShInstallResolution(args.digest);
  const identity = buildSkillsShMirrorIdentity(args.digest);
  if (!install || !identity) return null;
  return {
    schema: "clawhub.skill.verify.v1" as const,
    ok: false as const,
    decision: "fail" as const,
    reasons: [SKILLS_SH_UNSCANNED_LABEL],
    slug: identity.reference,
    displayName: args.digest.displayName,
    pageUrl: `${args.origin.replace(/\/+$/g, "")}${identity.route}`,
    publisherHandle: null,
    publisherDisplayName: null,
    publisherProfileUrl: null,
    version: install.github.commit,
    resolvedFrom: "latest" as const,
    tag: null,
    createdAt: args.digest.lastObservedAt,
    card: {
      available: false as const,
      path: "skill-card.md",
      url: null,
      sha256: null,
      size: null,
      contentType: null,
    },
    artifact: {
      sourceFingerprint: install.github.contentHash,
      bundleFingerprints: [install.github.contentHash],
      files: [],
    },
    provenance: {
      source: "skills.sh" as const,
      reference: identity.reference,
    },
    security: {
      status: "unscanned" as const,
      passed: false as const,
      rawStatus: "unscanned" as const,
      verdict: "unscanned" as const,
      source: "skills.sh" as const,
      checkedAt: args.digest.lastObservedAt,
      clawhubScan: "unscanned" as const,
      label: SKILLS_SH_UNSCANNED_LABEL,
    },
    signature: {
      status: "unsigned" as const,
    },
  };
}
