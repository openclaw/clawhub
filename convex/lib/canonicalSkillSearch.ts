import { isCuratedSearchResult } from "./searchRanking";
import { tokenize } from "./searchText";

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

export function compareCanonicalSkillSearchCandidates(
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
    Number(right.featured) - Number(left.featured) ||
    right.rolling60DayInstalls - left.rolling60DayInstalls ||
    right.bookmarks - left.bookmarks ||
    right.updatedAt - left.updatedAt ||
    left.id.localeCompare(right.id)
  );
}
