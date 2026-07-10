// Trust-aware ordering for catalog search results, shared by package and skill
// search (convex/packages.ts, convex/skills.ts). See issue #3054: pure
// text-match ranking let a fresh exact-name publish outrank adopted, verified
// packages on generic queries (name-squat vector).

/** Text-match result produced by the per-surface match functions. */
type SearchTextMatch = {
  /** 0 = exact name match, 1 = prefix/substring/token, 2 = taxonomy, 3 = summary. */
  rankTier: number;
  score: number;
};

export type SearchTrustSignals = {
  isOfficial: boolean;
  verificationTier?:
    | "structural"
    | "source-linked"
    | "provenance-verified"
    | "rebuild-verified"
    | null;
  downloads?: number | null;
  installs?: number | null;
};

export function verificationRank(tier: SearchTrustSignals["verificationTier"]): number {
  if (tier === "rebuild-verified") return 4;
  if (tier === "provenance-verified") return 3;
  if (tier === "source-linked") return 2;
  if (tier === "structural") return 1;
  return 0;
}

// Only signals that are expensive to fake count as strong trust: the official
// flag is curated and provenance/rebuild verification require a reproducible
// source chain. source-linked and structural are self-serve, so they must not
// open the exact-match squat gate.
export function hasStrongTrustSignal(signals: SearchTrustSignals): boolean {
  return signals.isOfficial || verificationRank(signals.verificationTier) >= 3;
}

const ADOPTION_BUCKET_MAX = 6;

// Log-scale adoption so ranking rewards magnitude, not vanity deltas.
// Downloads/installs are identity-deduped upstream (convex/downloadMetrics.ts),
// which keeps buckets costly to inflate compared to a one-publish name squat.
export function adoptionBucket(signals: SearchTrustSignals): number {
  const total = Math.max(0, signals.downloads ?? 0) + Math.max(0, signals.installs ?? 0);
  if (total < 10) return 0;
  return Math.min(ADOPTION_BUCKET_MAX, Math.floor(Math.log10(total)));
}

type RankedSearchKey = {
  tier: number;
  adoption: number;
  score: number;
};

// Exact-name matches are only authoritative when backed by strong trust or
// measurable adoption; otherwise a fresh publish with a popular name would
// headline generic queries. Demoted entries still rank by text score inside
// the prefix/substring tier, so new legitimate packages stay discoverable.
export function rankedSearchKey(
  match: SearchTextMatch,
  signals: SearchTrustSignals,
): RankedSearchKey {
  const adoption = adoptionBucket(signals);
  const demoteExact = match.rankTier === 0 && adoption === 0 && !hasStrongTrustSignal(signals);
  return {
    tier: demoteExact ? 1 : match.rankTier,
    adoption,
    score: match.score,
  };
}

/** Ascending sort: better entries first. Callers append surface tie-breakers. */
export function compareRankedSearchKeys(a: RankedSearchKey, b: RankedSearchKey): number {
  return a.tier - b.tier || b.adoption - a.adoption || b.score - a.score;
}
