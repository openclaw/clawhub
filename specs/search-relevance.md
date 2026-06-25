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

Numeric scores, trust state, popularity, and recency may order results inside those broad tiers, but must not move a weaker tier above a stronger tier.

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
