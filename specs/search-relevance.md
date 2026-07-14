# Search Relevance Contract

ClawHub search is a retrieval surface, not a browse fallback. A package, plugin, or skill can appear as a search match only when the query has evidence against that item:

- exact, prefix, or substring match in a navigational field such as name, slug, display name, normalized package name, or runtime id;
- exact or token-prefix match in taxonomy fields such as categories and author topics;
- token-prefix match in exploratory fields such as summary, using a minimum query-token length for every query token to avoid short-query noise.

Trust and business signals are not relevance signals. `official`, verification tier, security status, downloads, stars, installs, highlighting, and recency may break ties between already eligible matches or appear as filters/badges, but they must not make an otherwise unrelated item eligible for search.

Generic fallback categories such as `other` are browse groupings, not search evidence.

Search ranking should be lexicographic before it is numeric:

1. exact full field match in name, slug, normalized package name, or runtime id;
2. lexical field match in name, slug, normalized package name, display name, or runtime id;
3. category or topic match;
4. summary match;

Numeric scores, trust state, popularity, and recency may order results inside those broad tiers, but must not make a weaker-evidence match eligible for a stronger tier.

## Exact-Match Squat Gate

The exact-match tier is authority, and authority must be earned (issue #3054). An exact full-field
match claims tier 1 only when the item carries at least one signal that is expensive to fake:

- the curated `official` flag,
- provenance or rebuild verification (self-serve tiers such as structural or source-linked do not
  qualify), or
- measurable adoption (identity-deduped downloads plus installs).

An exact match with none of those signals is ranked with the lexical tier instead. Without this
gate, one unverified publish whose name equals a popular generic query headlines that query above
long-adopted alternatives; display names are not even unique. Demoted items still rank by text
score inside the lexical tier, so fresh legitimate packages stay discoverable while they earn
signal.

Within a tier, a log-scale adoption bucket orders results before the raw text-match score, then the
existing tie-breakers apply (official, verification tier, stars, installs, downloads, recency).
Log-scale bucketing rewards magnitude, not vanity deltas, and identity-deduped download metering
(`specs/download-metering.md`) keeps buckets costly to inflate.

The shared implementation lives in `convex/lib/searchRanking.ts` and must stay the single ranking
seam for both package and skill-as-package catalog search.

The same contract applies across `/search`, the header typeahead, package/plugin catalog search, and skill-as-package catalog search.

Explicit browse filters such as category and topic must be applied during backend recall before
result limits. Client-side filtering may remain as a defensive display check, but it must not be the
only category or topic filter because limited global results can under-fill scoped search. Recall may
stop at an explicit safety scan budget, but the result limit applies after scoped matches are found.

Search result counts in the web UI should describe what is known from the current request. Do not label a page-size-limited result length as a total corpus count. Prefer `N+`, "shown", or no count unless an indexed/materialized total is available.

## Browse Discovery Ranking

Browse defaults are a discovery surface, not a proxy for lifetime downloads. The materialized
recommendation score combines sublinear installs, downloads, and stars with a decaying freshness
signal and a bounded boost for newly published items. Download weight is intentionally lower than
install, star, and freshness signals so a large historical footprint cannot permanently occupy the
default page. Recommendation scores are refreshed by maintenance jobs because freshness changes even
when an item receives no new events.

Trending is a separate seven-day activity leaderboard built from daily install and download
aggregates. It must not be derived from all-time totals. Skills and plugins expose the same
trending concept; suspicious or unavailable items are filtered before public display.

Publisher diversity is a product follow-up for browse ranking. The current contract guarantees
freshness and bounded novelty, while preserving stable cursor pagination and trust filters.
