import {
  getCatalogTopicSlugs,
  INTERNAL_UNCATEGORIZED_CATEGORY,
  normalizeCatalogTopic,
} from "clawhub-schema/catalogMetadata";
import { matchesAllTokens, matchesExploratoryTokenPrefixes, tokenize } from "./searchText";

type CatalogTextDocument = {
  name: string;
  displayName: string;
  runtimeId?: string;
  ownerHandle?: string;
  categories?: string[];
  topics?: string[];
  summary?: string;
};

export type CatalogTextMatch = {
  rankTier: number;
  score: number;
};

const EXPLORATORY_SEARCH_MIN_TOKEN_LENGTH = 3;

export function matchCatalogText(
  digest: CatalogTextDocument,
  queryText: string,
): CatalogTextMatch | null {
  const needle = queryText.toLowerCase();
  const queryTokens = tokenize(queryText);
  if (queryTokens.length === 0) return null;
  const normalized = digest.name.toLowerCase();
  const display = digest.displayName.toLowerCase();
  const runtimeId = digest.runtimeId?.toLowerCase() ?? "";
  const ownerHandle = digest.ownerHandle?.toLowerCase() ?? "";
  const nameTokens = tokenize(normalized);
  const displayTokens = tokenize(display);
  const runtimeTokens = tokenize(runtimeId);
  const ownerHandleTokens = tokenize(ownerHandle);
  let score = 0;
  let rankTier = Number.POSITIVE_INFINITY;

  const setMatch = (tier: number, boost: number) => {
    score += boost;
    rankTier = Math.min(rankTier, tier);
  };

  if (normalized === needle) setMatch(0, 200);
  else if (normalized.startsWith(needle)) setMatch(1, 120);
  else if (normalized.includes(needle)) setMatch(1, 80);

  if (display === needle) setMatch(0, 150);
  else if (display.startsWith(needle)) setMatch(1, 70);
  else if (display.includes(needle)) setMatch(1, 40);

  if (runtimeId === needle) setMatch(0, 180);
  else if (runtimeId.startsWith(needle)) setMatch(1, 90);
  else if (runtimeId.includes(needle)) setMatch(1, 45);

  if (ownerHandle === needle || `@${ownerHandle}` === needle) setMatch(1, 60);
  else if (ownerHandle.startsWith(needle) || `@${ownerHandle}`.startsWith(needle)) setMatch(1, 35);
  else if (ownerHandle.includes(needle)) setMatch(1, 20);

  if (
    matchesAllTokens(
      queryTokens,
      [...nameTokens, ...displayTokens, ...runtimeTokens, ...ownerHandleTokens],
      (a, b) => a === b,
    )
  ) {
    setMatch(1, 65);
  } else if (
    matchesAllTokens(
      queryTokens,
      [...nameTokens, ...displayTokens, ...runtimeTokens, ...ownerHandleTokens],
      (a, b) => a.startsWith(b),
    )
  ) {
    setMatch(1, 35);
  }

  const taxonomyQuery = normalizeCatalogTopic(queryText);
  const categories = (digest.categories ?? []).filter(
    (category) => category !== INTERNAL_UNCATEGORIZED_CATEGORY,
  );
  const topicSlugs = getCatalogTopicSlugs(digest.topics);
  if (taxonomyQuery && (categories.includes(taxonomyQuery) || topicSlugs.includes(taxonomyQuery))) {
    setMatch(2, 25);
  }
  if (
    matchesExploratoryTokenPrefixes(
      queryTokens,
      [...categories, ...(digest.topics ?? [])],
      EXPLORATORY_SEARCH_MIN_TOKEN_LENGTH,
    )
  ) {
    setMatch(2, 20);
  }

  if (
    matchesExploratoryTokenPrefixes(
      queryTokens,
      [digest.summary],
      EXPLORATORY_SEARCH_MIN_TOKEN_LENGTH,
    )
  ) {
    setMatch(3, 20);
  }
  if (!Number.isFinite(rankTier)) return null;
  return { rankTier, score };
}
