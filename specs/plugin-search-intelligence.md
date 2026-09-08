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
unknown markers are ignored. Package-family, Skills, CLI, crawler, URL-load,
and generic API requests remain unobserved unless a later product decision adds
an explicit source.

The observation is written after the visible response has been assembled, so
`resultCount` and `officialResultCount` describe that exact response. Official
means company- or publisher-supported provenance (`package.isOfficial`), not
popularity, ranking, or relevance.

## Privacy boundary

Raw observations contain only:

- normalized query text (lowercase; surrounding and repeated whitespace only)
- observation timestamp
- bounded source
- `artifactKind: "plugin"`
- selected category and topic/intent filters
- visible result and official-result counts

The search-intelligence path must not read, derive, pass through, or persist IP,
User-Agent, authentication identity, user, device, installation, session,
browser, operating system, geography, or OpenClaw version metadata. Existing
HTTP rate limiting remains an independent security boundary and does not feed
product analytics.

Raw observations expire after 30 days through indexed, bounded, resumable
cleanup. Longer-lived daily aggregates are owned by a later layer and must not
add identity or request metadata.
