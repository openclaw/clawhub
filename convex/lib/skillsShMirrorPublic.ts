export const SKILLS_SH_UNSCANNED_LABEL = "Not scanned by ClawHub";
export const SKILLS_SH_UNSCANNED_STATE = "not-scanned-by-clawhub";
export const SKILLS_SH_SCANNED_LABEL = "Scanned by ClawHub";

const GITHUB_COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const CONTENT_HASH_PATTERN = /^[a-f0-9]{64}$/;

type UpstreamScanner = {
  status: string;
  sourceCheckedAt?: string;
  sourceUrl?: string;
};

export type SkillsShMirrorDigest = {
  externalId: string;
  sourceType: "github" | "well-known";
  owner?: string;
  repo?: string;
  sourceHost?: string;
  slug: string;
  displayName: string;
  searchSummary?: string;
  sourceUrl: string;
  canonicalRepoUrl?: string;
  githubPath?: string;
  githubCommit?: string;
  sourceContentHash?: string;
  upstreamInstalls: number;
  upstreamScanners: {
    genAgentTrustHub: UpstreamScanner;
    socket: UpstreamScanner;
    snyk: UpstreamScanner;
  };
  inferredCategories?: string[];
  inferredTopics?: string[];
  sourceFreshnessStatus: "observed-only" | "stale";
  detailStatus: "available" | "missing";
  active: boolean;
  publicVisible: boolean;
  installable: boolean;
  claimStatus?: "pending" | "failed" | "promoted";
  claimAttempt?: number;
  tombstonedAt?: number;
  lastObservedAt: number;
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

function normalizeSegment(value: string | undefined) {
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
  const owner = normalizeSegment(digest.owner);
  const repo = normalizeSegment(digest.repo);
  const slug = normalizeSegment(digest.slug);
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

export function buildSkillsShCanonicalGitHubRepo(
  digest: Pick<SkillsShMirrorDigest, "canonicalRepoUrl" | "owner" | "repo">,
) {
  if (!digest.canonicalRepoUrl) {
    const owner = normalizeSegment(digest.owner);
    const repo = normalizeSegment(digest.repo);
    return owner && repo ? `${owner}/${repo}` : null;
  }
  try {
    const url = new URL(digest.canonicalRepoUrl);
    if (url.protocol !== "https:" || !["github.com", "www.github.com"].includes(url.hostname)) {
      return null;
    }
    const segments = url.pathname
      .replace(/\.git$/i, "")
      .split("/")
      .filter(Boolean);
    if (segments.length !== 2) return null;
    const owner = normalizeSegment(segments[0]);
    const repo = normalizeSegment(segments[1]);
    return owner && repo ? `${owner}/${repo}` : null;
  } catch {
    return null;
  }
}

export function isPublicSkillsShMirrorDigest(digest: SkillsShMirrorDigest) {
  return (
    digest.active &&
    digest.publicVisible &&
    digest.installable &&
    digest.sourceFreshnessStatus === "observed-only" &&
    digest.tombstonedAt === undefined
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

function buildUpstreamCheck(scanner: string, result: UpstreamScanner) {
  const checkedAt = result.sourceCheckedAt ? Date.parse(result.sourceCheckedAt) : Number.NaN;
  return {
    scanner,
    status: upstreamCheckStatus(result.status),
    sourceStatus: result.status,
    ...(Number.isNaN(checkedAt) ? {} : { checkedAt }),
    ...(result.sourceUrl ? { url: result.sourceUrl } : {}),
  };
}

export function buildSkillsShMirrorCatalogDetail(args: {
  digest: SkillsShMirrorDigest;
  detail: SkillsShMirrorDetail | null;
}) {
  const identity = buildSkillsShMirrorIdentity(args.digest);
  const canonicalGitHubRepo = buildSkillsShCanonicalGitHubRepo(args.digest);
  if (!identity || !canonicalGitHubRepo || !isPublicSkillsShMirrorDigest(args.digest)) return null;
  const digestHash = args.digest.sourceContentHash?.trim().toLowerCase();
  const detailHash = args.detail?.sourceContentHash?.trim().toLowerCase();
  const content =
    args.detail?.externalId.trim().toLowerCase() === identity.externalId &&
    Boolean(digestHash) &&
    detailHash === digestHash
      ? {
          kind: args.detail.contentKind,
          path: args.detail.path,
          markdown: args.detail.content,
          bytes: args.detail.contentBytes,
          truncated: args.detail.truncated,
        }
      : null;
  return {
    source: "skills.sh" as const,
    ...identity,
    displayName: args.digest.displayName,
    summary: args.digest.searchSummary,
    categories: args.digest.inferredCategories?.length ? args.digest.inferredCategories : ["other"],
    topics: args.digest.inferredTopics ?? [],
    upstreamInstalls: args.digest.upstreamInstalls,
    lastObservedAt: args.digest.lastObservedAt,
    sourceUrl: args.digest.sourceUrl,
    canonicalRepoUrl: args.digest.canonicalRepoUrl,
    canonicalGitHubRepo,
    githubPath: args.digest.githubPath,
    githubCommit: args.digest.githubCommit,
    // The permanent mirror stores the exact GitHub folder hash under this source field.
    githubContentHash: args.digest.sourceContentHash,
    sourceContentHash: args.digest.sourceContentHash,
    upstreamChecks: [
      buildUpstreamCheck(UPSTREAM_SCANNERS[0], args.digest.upstreamScanners.genAgentTrustHub),
      buildUpstreamCheck(UPSTREAM_SCANNERS[1], args.digest.upstreamScanners.socket),
      buildUpstreamCheck(UPSTREAM_SCANNERS[2], args.digest.upstreamScanners.snyk),
    ],
    content,
  };
}

function normalizeGitHubPath(value: string | undefined) {
  const path = value?.trim().replace(/^\/+|\/+$/g, "");
  if (!path) return null;
  if (
    Array.from(path).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f || "\\?#".includes(character);
    })
  ) {
    return null;
  }
  const segments = path.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return null;
  return path;
}

export function buildGitHubTreeUrl(repo: string, commit: string, path: string) {
  const encodedRepo = repo.split("/").map(encodeURIComponent).join("/");
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return `https://github.com/${encodedRepo}/tree/${commit}/${encodedPath}`;
}

export function buildUnclaimedSkillsShInstallResolution(digest: SkillsShMirrorDigest) {
  const identity = buildSkillsShMirrorIdentity(digest);
  const repo = buildSkillsShCanonicalGitHubRepo(digest);
  const path = normalizeGitHubPath(digest.githubPath);
  const commit = digest.githubCommit?.trim().toLowerCase();
  const contentHash = digest.sourceContentHash?.trim().toLowerCase();
  if (
    !identity ||
    !repo ||
    !isPublicSkillsShMirrorDigest(digest) ||
    !path ||
    !commit ||
    !contentHash ||
    !GITHUB_COMMIT_PATTERN.test(commit) ||
    !CONTENT_HASH_PATTERN.test(contentHash)
  ) {
    return null;
  }
  return {
    ok: true as const,
    slug: identity.reference,
    installKind: "github" as const,
    github: {
      repo,
      path,
      commit,
      contentHash,
      sourceUrl: buildGitHubTreeUrl(repo, commit, path),
    },
    provenance: {
      source: "skills.sh" as const,
      reference: identity.reference,
    },
    trust: {
      state: SKILLS_SH_UNSCANNED_STATE,
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
    provenance: { source: "skills.sh" as const, reference: identity.reference },
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
    signature: { status: "unsigned" as const },
  };
}
