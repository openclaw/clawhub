# Search Relevance Contract

ClawHub search is a retrieval surface, not a browse fallback. A package, plugin, or skill can appear as a search match only when the query has evidence against that item:

- exact, prefix, or substring match in a navigational field such as name, slug, display name, normalized package name, or runtime id;
- token-prefix match in exploratory fields such as summary or capability tags, using a minimum query-token length for every query token to avoid short-query noise.

Trust and business signals are not relevance signals. `official`, verification tier, security status, downloads, stars, installs, highlighting, and recency may break ties between already eligible matches or appear as filters/badges, but they must not make an otherwise unrelated item eligible for search.

Search ranking should be lexicographic before it is numeric:

1. exact full field match in name, slug, normalized package name, or runtime id;
2. lexical field match in name, slug, normalized package name, display name, or runtime id;
3. capability or tag match;
4. summary match;

Numeric scores, trust state, popularity, and recency may order results inside those broad tiers, but must not move a weaker tier above a stronger tier.

The same contract applies across `/search`, the header typeahead, package/plugin catalog search, and skill-as-package catalog search.

Search result counts in the web UI should describe what is known from the current request. Do not label a page-size-limited result length as a total corpus count. Prefer `N+`, "shown", or no count unless an indexed/materialized total is available.

## Recommendation Topic Suggestions

Homepage search suggestion chips are public search-intent topics, not skill results. They are backed by a materialized recommendation topic list that blends aggregated submitted searches, skill daily activity, and plugin package daily activity over the last 7 UTC days. The chips should remain distinct from the homepage trending skill cards: they suggest what to search for, not which artifact to install.

Only submitted searches may be recorded; do not record every keystroke or typeahead query. Search telemetry stores daily aggregate rows keyed by normalized query text rather than per-user or per-request raw events. Search terms can influence public suggestions only after a meaningful minimum count threshold, must count each client bucket at most once per query per day, and must reject blank/noisy/private-looking terms before aggregation.

Skill and plugin activity signals should be derived from daily stat tables, not all-time totals, so suggestions respond to recent demand without duplicating the visible trending skill section. Plugin signals use package-level daily stats for `code-plugin` and `bundle-plugin` families. The public telemetry write path must stay rate-limited. Recommendation rebuilds and public reads must use bounded, indexed queries rather than scanning full telemetry or stats tables.
