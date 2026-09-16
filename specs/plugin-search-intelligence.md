# Plugin and skill search intelligence

ClawHub owns the canonical product-data stream for manually initiated plugin and skill
searches. Generic request logs, Axiom, and Vercel page analytics are not sources
of catalog-demand truth.

## Capture boundary

Completed combined plugin searches and canonical skill searches may produce a
raw observation. Their response owner must receive one recognized analytics-attribution marker:

- `clawhub-web`
- `openclaw-control-ui`

The marker is not authorization and grants no access or behavior. Missing or
unknown HTTP markers are ignored. The web marks manual Header, full Search,
Plugins, native Skills, and homepage searches. Homepage skill collection covers
the native Featured, Official, and New shelves; Trending only filters its existing
feed locally and remains unobserved. OpenClaw Control UI collection covers plugins,
not skills. Generic package API, CLI, crawler, URL-load, and unmarked API requests
remain unobserved.

The observation is written after the visible response has been assembled, so
`resultCount` and `officialResultCount` describe that exact response. Official
means the returned catalog's authoritative metadata: plugin `package.isOfficial === true`;
native skills' official badge or registry-backed official publisher, as used by the
canonical search response. External skill mirrors have no native official status.
Names, popularity, ranking, relevance, or model judgment never establish provenance.
The server derives `scope: catalog` for an unfiltered catalog response and `scope: shelf`
for a filtered response. The native homepage action requires Featured, Official, or
New filters before recording; its source marker alone cannot establish shelf scope.
An HTTP request visibly aborted before persistence is excluded. Native Convex actions
have no Request abort signal, so a completed dispatched search can count after browser
navigation. Neither transport retracts an observation after server completion; no
receipt or request tracking is introduced.

## Privacy boundary

Raw observations contain only:

- normalized query text (lowercase; surrounding and repeated whitespace only), at most256 characters
- observation timestamp
- bounded source
- `artifactKind: "plugin" | "skill"`
- server-derived `scope: "catalog" | "shelf"`
- selected category and topic/intent filters, at most120 characters each
- visible result and official-result counts

The search-intelligence path must not read, derive, pass through, or persist IP,
User-Agent, authentication identity, user, device, installation, session,
browser, operating system, geography, or OpenClaw version metadata. Existing
HTTP rate limiting remains an independent security boundary and does not feed
product analytics.

Oversized observations are skipped, never truncated into another query. Counts
are integers between0 and100 with official count no greater than total. Ordinary
search authorization/private visibility is preserved but never copied into
the observation.

Raw observations expire after 30 days through indexed, bounded, resumable
cleanup. The existing observation table and aggregation cursor serve both catalogs;
there is no second collection pipeline or historical-log backfill. Existing rows
without scope remain explicitly legacy/unknown, and missing historical artifact kind
means plugin. Skill coverage starts with its first recorded observation, never with
the earlier plugin collection date. Longer-lived daily aggregates must not add
identity or request metadata.
