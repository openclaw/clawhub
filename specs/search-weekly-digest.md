# Weekly plugin-search digest

ClawHub owns the completed-week facts, classification, scheduling, and frozen
delivery ledger. Hermit owns Discord credentials and the `maintainer-clawhub`
message. Neither side changes official provenance, Featured curation, or Trending.

## Schedule and scope

`searchWeeklyDigest.tickInternal` runs at the top of each UTC hour. Its Pacific
calendar gate releases the completed UTC week on Monday at 09:00 America/Los_Angeles,
including DST. Repeated Monday ticks are harmless; an atomic week claim prevents
overlapping deliveries. Later ticks recover existing due failures, not historical
weeks that were never collected. Preview/disabled-cron deployments register no job.

The producer starts one bounded aggregation batch and retries if continuation is
needed. It reads the canonical aggregate API for top demand, official gaps, and
absolute week-over-week movers. The three reports must have the same ingestion
revision. Source totals cover all rows before shortlist limits. Current catalog
metadata is public and separate from historical result counts.
Featured candidates and their metadata-availability status come exclusively from
the demand cohort. A failed lookup for the separate gap/classifier cohort cannot
erase successful Featured metadata or mislabel the Featured section.

Digest query rows require at least three searches. Official-gap/company rows
require three official-gap searches; dropped-to-zero movers may qualify from the
previous week's volume. Each section has at most five rows. The query cohort is
capped at 100 per ranking and marked truncated; it is not a complete catalog scan.
Unrepresentable canonical query/package identities are omitted, never truncated or
rewritten. Display-only descriptors are sanitized. A 30,000-byte UTF-8 payload budget
drops whole lowest-ranked rows from the longest section in a fixed tie order; this
preserves each section's leaders and all global totals, and marks the digest truncated.

## Advisory classifier

Only the top 100 threshold-qualified aggregate official-gap queries enter the
structured classifier. The egress allowlist is normalized query, aggregate search
and official-gap counts, and at most three bounded public result names/summaries.
No raw observation, identity, request context, URL, or provenance flag enters it.

The versioned low-cost model is `gpt-5.4-nano-2026-03-17` with strict structured
output, `store: false`, a 45-second timeout, and a fixed output budget. Its only
outputs are company/product, generic capability, or ambiguous intent, optional
canonical name, and confidence. Only company/product confidence >= 0.8 qualifies.
Invalid, incomplete, refused, or unavailable output makes enrichment unavailable;
the deterministic digest still ships. Capped successful cohorts are partial.

The shared classification rows/run status and the frozen digest are committed in
one claim-fenced transaction. Dashboard, CLI, and digest therefore use the same
derived result. Retries never rerun the classifier or recalculate an already
frozen payload.

## Delivery and operations

Reuse `HERMIT_CONTENT_RIGHTS_BASE_URL` (default `https://forms.openclaw.ai`) and
`CLAWHUB_HERMIT_TOKEN`, falling back to the existing `CLAWHUB_BAN_APPEALS_TOKEN`.
The existing `SITE_URL` owns dashboard/search/package links. ClawHub never accepts
or stores a Discord credential. Secret values must be provisioned through the
deployment's supported protected credential flow, never committed or logged.

POST `/api/clawhub-search-intelligence/weekly` uses the shared Bearer token and a
strict bounded payload. Redirects are rejected; HTTPS is required except loopback.
Only an explicit delivered receipt for the same week marks the claim sent.
Network/HTTP/receipt failures persist query-free codes and retry with bounded
exponential backoff, at most eight attempts. Crashed claims expire after five
minutes. Exhausted claims move out of the due queue so later weeks cannot starve.
`searchWeeklyDigest.getStatusInternal({weekEnd})` exposes status/attempts/timing and
failure code, never the payload or query text. Sent weeks cannot be reclaimed.

Hermit's companion receiver validates the whole payload, sends Carbon Components
V2 with mentions disabled, and durably deduplicates by site/week using its existing
D1 key-value store. Uncertain sends reconcile against bounded Discord history;
they are never blindly resent. Local-origin proof is visibly labeled LOCAL PREVIEW.

The indexed retention job deletes weekly payloads and delivery history after 13
calendar months, matching derived search-data retention. No retention extension
is created by an outage or a stuck delivery.

## Verification

Boundary tests exercise real Convex claims, canonical reports, shared classification
persistence, frozen retries, sent deduplication, exhausted recovery, schedule/DST,
strict payload exclusion, retention, and controlled provider/Hermit HTTP failures.
Live proof additionally pairs real UI searches with stored counts, verifies API/CLI
and dashboard parity, live-tests the bounded model once, and reads the real Discord
message plus duplicate receipt from Hermit's persistent receiver ledger. Local
synthetic data is labeled as a fixture, not historical production demand.
