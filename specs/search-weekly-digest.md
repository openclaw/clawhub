# Weekly plugin and skill search digest

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
needed. It reads the shared recommendation owner and canonical aggregate API
independently for plugins and skills. The reads must have the same ingestion revision.
Source totals cover all rows before shortlist limits. Current catalog metadata and
existing Trending/adoption snapshots remain separate from historical result counts,
with their own periods, provenance, freshness and availability. A failed classifier
lookup cannot erase successful recommendation metadata.

New weeks freeze `search_intelligence_weekly_v3` with separate `plugins` and `skills`
catalogs. Query rows and recommendation query evidence retain `catalog`, `shelf`,
or `legacy` scope through producer validation, Hermit validation, and rendering.
The same text in different scopes remains distinguishable; only catalog rows can
be company opportunities. Recommendations reuse the canonical shared ordering and
explain search-only, adoption-only, combined, or current-only support without a second
scoring model. Each catalog includes the complete advisory eight-item lineup,
membership baseline, keeps/additions/removals, and any eligibility shortfall.
Current-only members explicitly have no observed evidence in the inspected cohorts.
Existing frozen `plugin_search_weekly` and `search_intelligence_weekly_v2` payloads
replay unchanged, including their original receipt identity. Deploy and verify the
compatible Hermit v3 receiver before deploying the v3 producer. Receiver support for
all three schemas must remain available while retained frozen payloads can retry.

Digest query rows require at least three searches. Official-gap/company rows
require three official-gap searches; dropped-to-zero movers may qualify from the
previous week's volume. Auxiliary query sections have at most five rows. The query
cohort is capped at 100 per ranking and marked truncated; it is not a complete catalog
scan. A candidate can carry lower-volume adoption or aggregate search evidence while
query text below the three-search threshold is suppressed. Display-only descriptors
are sanitized. Unrepresentable auxiliary query identities are omitted, never rewritten.

The 30,000-byte UTF-8 budget compacts only auxiliary rows and details, preserving all
selected members, baseline/removal identities, global totals, and explicit truncation.
An unrepresentable selected identity or full lineup that still exceeds the budget
fails explicitly; it never silently drops a Featured candidate. Hermit's component
budget likewise preserves all sixteen possible selected members. Links exceeding
Discord's button URL limit visibly open the dashboard; a v3-only full-payload
fingerprint preserves exact uncertain-send reconciliation. No digest generation or
delivery changes Featured membership, and the first production dry run sends nothing.

## Advisory classifier

Only the top 100 threshold-qualified catalog official-gap queries per artifact kind enter the
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
frozen payload. Historical replay preserves the original shape and deterministic
receipt identity; it does not convert unknown-scope observations into catalog facts.

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
