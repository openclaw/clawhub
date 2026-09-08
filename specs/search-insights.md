# Staff search intelligence

ClawHub owns anonymous plugin search observations, daily aggregates, and the canonical
staff report used by Management, HTTP, the admin CLI, and the weekly digest.

## Trust and meaning

- An official gap counts a completed visible response with `officialResultCount === 0`.
  Capture computes that field only from returned authoritative `isOfficial === true`.
- Daily facts retain normalized query, UTC date, source, artifact kind, category/topic
  dimensions, search count, zero-result count, and official-gap count. No identity,
  device, session, request, result snapshot, IP, or User-Agent data enters them.
- A query can have some official-gap searches and some official-result searches. The
  Official gaps filter includes it when its selected window has at least one gap.
- Weekly company intent is advisory, not provenance. Company opportunities require
  company_product confidence >= 0.8 and at least three official-gap searches.
- Current catalog enrichment uses at most three bounded public visible
  results per returned query. `metadataCheckedAt` labels its freshness. These are
  not the historical results underlying official-gap counts. Suspicious, unpublished, and already Featured
  results remain classifier context but cannot be Featured candidates. Featured
  candidates alone require clean/installable gates. Candidate
  order follows demand, never public Trending. Nothing is automatically featured.

## Aggregation and retention

`searchInsights.aggregateInternal` runs hourly. The bounded 200-row ingestion batch
uses the existing convex-helpers index-key paginator. Bucket deltas and the last
index key commit together. Native pagination's terminal cursor must not be stored
as an ingestion cursor: it would miss subsequent arrivals after an empty stream.

Raw observations always expire after 30 days. A missed aggregation window older
than that becomes an explicit query-free coverage gap, not extended raw retention.
The singleton aggregation state stores only database position, revision, and
coverage bounds. Daily facts and weekly derived classifications expire after 13
calendar months (clamped at month-end), via indexed 500-row-per-table prune batches.
There is no historical-log backfill.

## Canonical boundary

`searchInsights.get` authenticates an active admin/moderator. The internal equivalent
is for trusted HTTP/digest callers only. `GET /api/v1/search-insights` authenticates
an API token and verifies the same staff role, returning private/no-store responses.
No client-supplied user ID is accepted. Management uses an explicit-refresh action,
not a subscription to raw or high-churn data.

Report bounds are complete UTC days ending at exclusive `endDay` (default today's
UTC midnight): [endDay-7d,endDay), [endDay-14d,endDay-7d), and [endDay-30d,endDay).
The data-through and coverage bounds are separate from requested window bounds.
Seven days means seven complete UTC days, not a partial-day real-time window.

Sources can be combined or selected. Output order is selected-window searches then
query code-point order. Internal digest callers can select absolute seven-day change
or official-gap count ordering. Counts/source totals cover all filtered rows before
the 1–100 output limit; `truncated` explicitly marks a shortlist. The paginated action
reads at most 100,000 daily rows and fails explicitly rather than silently truncating
facts. An aggregation revision change during the read requires a refresh.

Weekly classification storage is an atomic <=100-query replacement per week.
A query-free run record persists success/failure, expected/classified counts,
model/version, processing time, and capped-scope flag, including failed and empty runs.
A capped cohort is partial even when every query in that cohort was classified. The newest run
ending no later than the report window and within seven days owns classification;
failed or stale runs never fall back to older successful advice. The report still
serves deterministic counts when classification or current catalog enrichment fails.

## Verification and local fixtures

`convex/searchInsights.test.ts` exercises staff/public denial, HTTP parity, daily
idempotency/new arrivals, calendar-month expiry, outage coverage, classification
failure and high-confidence filtering, and public-visible metadata with separate Featured eligibility through
real Convex function boundaries. The admin CLI test launches the actual parser
against a local HTTP fixture in human and JSON modes.

`searchInsightsFixtures.seed` is internal and refuses non-loopback Convex origins.
It seeds empty, typical, or dense synthetic datasets, a local staff persona, and an
optional hashed API-token fixture for real local browser/API/CLI proof. It never
runs from production crons. These fixtures are not historical demand.
