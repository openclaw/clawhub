# Plugin search intelligence

ClawHub owns the canonical product-data stream for manually initiated plugin
searches. Generic request logs, Axiom, and Vercel page analytics are not sources
of plugin-demand truth.

## Capture boundary

Only completed requests to the combined plugin search boundary may produce a
raw observation. The request must carry one recognized analytics-attribution
marker:

- `clawhub-web`
- `openclaw-control-ui`

The marker is not authorization and grants no access or behavior. Missing or
unknown markers are ignored. Generic package API, Skills, CLI, crawler, URL-load,
and generic API requests remain unobserved unless a later product decision adds
an explicit source.

The observation is written after the visible response has been assembled, so
`resultCount` and `officialResultCount` describe that exact response. Official
means returned authoritative `package.isOfficial === true`, never truthiness,
names, publisher guesses, popularity, ranking, relevance, or model judgment.
Explicit plugin-family filtering can count; Skills and Claw families cannot.
A request visibly aborted before persistence is excluded. A cancellation after
server completion cannot retract an observation; no receipt or request tracking
is introduced.

## Privacy boundary

Raw observations contain only:

- normalized query text (lowercase; surrounding and repeated whitespace only), at most256 characters
- observation timestamp
- bounded source
- `artifactKind: "plugin"`
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
cleanup. Longer-lived daily aggregates are owned by a later layer and must not
add identity or request metadata.
