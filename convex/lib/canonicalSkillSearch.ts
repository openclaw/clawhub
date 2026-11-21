import type { Doc } from "../_generated/dataModel";
import { isSkillHighlighted } from "./badges";
import type { PublicPublisher, PublicSkill } from "./public";
import { isCuratedSearchResult } from "./searchRanking";
import { tokenize } from "./searchText";
import { getMirrorBrowseCategories } from "./skillsShMirrorPublic";

export type CanonicalSkillSearchDocument = {
  identities: string[];
  name: string;
  slug: string;
  taxonomy: string[];
  summary: string | null;
  content?: string | null;
  semanticScore?: number;
};

function normalizeIdentity(value: string) {
  return value.trim().replace(/^@/, "").toLowerCase();
}

function allTokensMatch(
  queryTokens: string[],
  values: string[],
  predicate: (candidate: string, query: string) => boolean,
) {
  const candidateTokens = values.flatMap(tokenize);
  return queryTokens.every((queryToken) =>
    candidateTokens.some((candidateToken) => predicate(candidateToken, queryToken)),
  );
}

export function classifyCanonicalSkillSearchMatch(
  query: string,
  document: CanonicalSkillSearchDocument,
): CanonicalSkillSearchCandidate["relevance"] | null {
  const identityQuery = normalizeIdentity(query);
  if (document.identities.some((identity) => normalizeIdentity(identity) === identityQuery)) {
    return { tier: 0, lexicalScore: 120, semanticScore: 0 };
  }

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return null;
  const normalizedQuery = queryTokens.join(" ");
  const normalizedSlug = tokenize(document.slug).join(" ");
  const normalizedName = tokenize(document.name).join(" ");
  if (normalizedSlug === normalizedQuery || normalizedName === normalizedQuery) {
    return { tier: 0, lexicalScore: 110, semanticScore: 0 };
  }

  const navigationalFields = [document.slug, document.name, ...document.identities];
  if (
    allTokensMatch(queryTokens, navigationalFields, (candidate, needle) => candidate === needle)
  ) {
    return { tier: 1, lexicalScore: 95, semanticScore: 0 };
  }
  if (
    allTokensMatch(queryTokens, navigationalFields, (candidate, needle) =>
      candidate.startsWith(needle),
    )
  ) {
    return { tier: 2, lexicalScore: 80, semanticScore: 0 };
  }
  if (
    allTokensMatch(queryTokens, document.taxonomy, (candidate, needle) =>
      candidate.startsWith(needle),
    )
  ) {
    return { tier: 3, lexicalScore: 60, semanticScore: 0 };
  }
  if (
    queryTokens.every((token) => token.length >= 3) &&
    allTokensMatch(
      queryTokens,
      [document.summary ?? "", document.content ?? ""],
      (candidate, needle) => candidate.startsWith(needle),
    )
  ) {
    return { tier: 4, lexicalScore: 40, semanticScore: 0 };
  }
  if ((document.semanticScore ?? 0) >= 0.55) {
    return { tier: 5, lexicalScore: 0, semanticScore: document.semanticScore ?? 0 };
  }

  return null;
}

export type CanonicalSkillSearchCandidate = {
  id: string;
  source: "clawhub" | "skills-sh";
  relevance: {
    tier: number;
    lexicalScore: number;
    semanticScore: number;
  };
  official: boolean;
  featured: boolean;
  rolling60DayInstalls: number;
  bookmarks: number;
  updatedAt: number;
};

export function compareCanonicalSkillSearchPriority(
  left: CanonicalSkillSearchCandidate,
  right: CanonicalSkillSearchCandidate,
) {
  return (
    Number(isCuratedSearchResult({ isOfficial: right.official, featured: right.featured })) -
      Number(isCuratedSearchResult({ isOfficial: left.official, featured: left.featured })) ||
    left.relevance.tier - right.relevance.tier ||
    right.relevance.lexicalScore - left.relevance.lexicalScore ||
    right.relevance.semanticScore - left.relevance.semanticScore ||
    Number(right.official) - Number(left.official) ||
    Number(right.featured) - Number(left.featured)
  );
}

export function compareCanonicalSkillSearchCandidates(
  left: CanonicalSkillSearchCandidate,
  right: CanonicalSkillSearchCandidate,
) {
  return (
    compareCanonicalSkillSearchPriority(left, right) ||
    right.rolling60DayInstalls - left.rolling60DayInstalls ||
    right.bookmarks - left.bookmarks ||
    right.updatedAt - left.updatedAt ||
    left.id.localeCompare(right.id)
  );
}

type NativeCanonicalSearchEntry = {
  skill: PublicSkill;
  version: Doc<"skillVersions"> | null;
  ownerHandle: string | null;
  owner: PublicPublisher | null;
  semanticScore: number;
};

export type CanonicalSkillSearchResult = {
  id: string;
  source: "clawhub" | "skills-sh";
  slug: string;
  displayName: string;
  summary: string | null;
  icon: string | null;
  categories?: string[];
  score: number;
  canonicalUrl: string;
  links: {
    canonical: string;
    source: string | null;
  };
  publisher: {
    kind: "user" | "org";
    handle: string | null;
    displayName: string | null;
    image: string | null;
    official: boolean;
  } | null;
  official: boolean;
  featured: boolean;
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
  trust: {
    visibility: "public";
    installability: "installable";
    clawHubVerdict: string | null;
    upstreamScanners: Doc<"skillsShMirrorDigests">["upstreamScanners"] | null;
    sourceFreshness: "native" | "observed-only";
  };
  metrics: {
    rolling60DayInstalls: number | null;
    bookmarks: number | null;
    updatedAt: number;
  };
  // Native rendering payload. External rows intentionally omit this; CLAW-583
  // owns their detail/install presentation rather than this ranking contract.
  native: {
    skill: NativeCanonicalSearchEntry["skill"];
    version: NativeCanonicalSearchEntry["version"];
    owner: NativeCanonicalSearchEntry["owner"];
    ownerHandle: NativeCanonicalSearchEntry["ownerHandle"];
  } | null;
  // Compatibility fields retained for existing CLI/OpenClaw parsers.
  ownerHandle: string | null;
  version: string | null;
  downloads: number;
  updatedAt: number;
};

function canonicalScore(relevance: CanonicalSkillSearchCandidate["relevance"]) {
  return (6 - relevance.tier) * 1_000 + relevance.lexicalScore + relevance.semanticScore;
}

function omitPublisherBio(owner: PublicPublisher | null) {
  if (!owner) return null;
  const { bio: _bio, ...ownerWithoutBio } = owner;
  return ownerWithoutBio;
}

export function buildNativeCanonicalResult(
  entry: NativeCanonicalSearchEntry,
  query: string,
): (CanonicalSkillSearchResult & CanonicalSkillSearchCandidate) | null {
  const ownerHandle = entry.ownerHandle ?? entry.owner?.handle ?? null;
  const identity = ownerHandle ? `${ownerHandle}/${entry.skill.slug}` : entry.skill.slug;
  const relevance = classifyCanonicalSkillSearchMatch(query, {
    identities: [identity, entry.skill.slug],
    name: entry.skill.displayName,
    slug: entry.skill.slug,
    taxonomy: [...(entry.skill.categories ?? []), ...(entry.skill.topics ?? [])],
    summary: entry.skill.summary ?? null,
    semanticScore: entry.semanticScore,
  });
  if (!relevance) return null;
  const official = Boolean(entry.owner?.official || entry.skill.badges?.official);
  const featured = isSkillHighlighted(entry.skill);
  const canonicalUrl = `/${encodeURIComponent(ownerHandle ?? String(entry.skill.ownerPublisherId ?? entry.skill.ownerUserId))}/skills/${encodeURIComponent(entry.skill.slug)}`;
  const publisher = entry.owner
    ? {
        kind: entry.owner.kind,
        handle: entry.owner.handle ?? null,
        displayName: entry.owner.displayName ?? null,
        image: entry.owner.image ?? null,
        official,
      }
    : null;
  return {
    id: `clawhub:${String(entry.skill._id)}`,
    source: "clawhub",
    relevance,
    official,
    featured,
    rolling60DayInstalls: 0,
    bookmarks: 0,
    updatedAt: entry.skill.updatedAt,
    slug: entry.skill.slug,
    displayName: entry.skill.displayName,
    summary: entry.skill.summary ?? null,
    icon: entry.skill.icon ?? null,
    categories: entry.skill.categories,
    score: canonicalScore(relevance),
    canonicalUrl,
    links: { canonical: canonicalUrl, source: null },
    publisher,
    install: {
      kind: entry.skill.installKind === "github" ? "github" : "clawhub",
      reference: identity,
      sourceUrl: null,
    },
    sourceIdentity: {
      id: String(entry.skill._id),
      owner: ownerHandle,
      repo: null,
      host: null,
      lifetimeInstalls: null,
    },
    trust: {
      visibility: "public",
      installability: "installable",
      clawHubVerdict: entry.skill.githubScanStatus ?? null,
      upstreamScanners: null,
      sourceFreshness: "native",
    },
    metrics: {
      rolling60DayInstalls: 0,
      bookmarks: 0,
      updatedAt: entry.skill.updatedAt,
    },
    native: {
      skill: entry.skill,
      version: entry.version,
      owner: omitPublisherBio(entry.owner),
      ownerHandle,
    },
    ownerHandle,
    version: entry.version?.version ?? null,
    downloads: entry.skill.stats.downloads,
  };
}

export type ExternalSkillSearchDigest = Pick<
  Doc<"skillsShMirrorDigests">,
  | "externalId"
  | "displayName"
  | "slug"
  | "inferredCategories"
  | "inferredTopics"
  | "searchSummary"
  | "owner"
  | "sourceHost"
  | "lastObservedAt"
  | "sourceUrl"
  | "repo"
  | "upstreamInstalls"
  | "upstreamScanners"
> & { featured?: boolean };

export function buildExternalCanonicalResult(
  digest: ExternalSkillSearchDigest,
  query: string,
): (CanonicalSkillSearchResult & CanonicalSkillSearchCandidate) | null {
  const relevance = classifyCanonicalSkillSearchMatch(query, {
    identities: [
      digest.externalId,
      `skills-sh:${digest.externalId}`,
      `skills-sh/${digest.externalId}`,
    ],
    name: digest.displayName,
    slug: digest.slug,
    taxonomy: [...(digest.inferredCategories ?? []), ...(digest.inferredTopics ?? [])],
    summary: digest.searchSummary ?? null,
  });
  if (!relevance) return null;
  const sourceOwner = digest.owner ?? digest.sourceHost ?? null;
  const canonicalUrl = `/skills-sh/${digest.externalId
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
  return {
    id: `skills-sh:${digest.externalId}`,
    source: "skills-sh",
    categories: getMirrorBrowseCategories(digest),
    relevance,
    official: false,
    featured: digest.featured ?? false,
    rolling60DayInstalls: 0,
    bookmarks: 0,
    updatedAt: digest.lastObservedAt,
    slug: digest.slug,
    displayName: digest.displayName,
    summary: digest.searchSummary ?? null,
    icon: null,
    score: canonicalScore(relevance),
    canonicalUrl,
    links: { canonical: canonicalUrl, source: digest.sourceUrl },
    publisher: null,
    install: {
      kind: "skills-sh",
      reference: `skills-sh:${digest.externalId}`,
      sourceUrl: digest.sourceUrl,
    },
    sourceIdentity: {
      id: digest.externalId,
      owner: digest.owner ?? null,
      repo: digest.repo ?? null,
      host: digest.sourceHost ?? null,
      lifetimeInstalls: digest.upstreamInstalls,
    },
    trust: {
      visibility: "public",
      installability: "installable",
      clawHubVerdict: null,
      upstreamScanners: digest.upstreamScanners,
      sourceFreshness: "observed-only",
    },
    metrics: {
      rolling60DayInstalls: null,
      bookmarks: null,
      updatedAt: digest.lastObservedAt,
    },
    native: null,
    ownerHandle: sourceOwner,
    version: null,
    downloads: digest.upstreamInstalls,
  };
}
