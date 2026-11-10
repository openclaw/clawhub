# Template discovery overview

The OpenClaw Templates landing page shows up to eight featured entries and up to eight entries per category. It must not wait for fourteen independent catalog reads (and additional category continuation pages) before rendering.

GET /api/v1/templates/overview?limit=8 returns a single consistent public snapshot:

- complete: true, featured: PackageListItem[], sections: [{ category, items: PackageListItem[] }]. Empty categories are omitted; category order follows the shared taxonomy, followed by other.
- Featured order follows highlighted badge recency, with the same exclusion and English-listing rules as the legacy featured list.
- Categories rank by current installs descending, then package name ascending. They use current package stats, not stale digest stats.
- Public visibility excludes private, deleted, unpublished and blocked packages. Templates also require an available publisher whose current handle matches the package scope.
- Publisher identity and official status are resolved live. Promise caches are query-local only; the next read observes deactivation or badge revocation.
- The request uses the ordinary read rate limit. There is no new response cache and no privileged viewer expansion.
- The snapshot reads at most 1,001 active Template digest rows and 1,001 highlighted badges. If either collection exceeds 1,000, it returns complete: false with empty lists. Publisher and projection reads run in batches of sixteen to remain below the concurrent-I/O limit. A specifically identified native transaction read-byte limit is converted at the HTTP boundary into the same complete: false envelope; unrelated errors still propagate. Consumers must then use the existing paginated path, not rank a truncated catalog.
- limit defaults to eight and accepts integers from one through eight. Existing package/category/search routes remain compatible.

The OpenClaw consumer must use one gateway request for an unfiltered overview and keep the legacy route for search/category navigation and older registries. Only an absent endpoint (404) or complete: false authorizes legacy fallback; transport, authorization and rate-limit failures must not be hidden by fan-out retries.

## HTTP startup boundary

The overview must not initialize unrelated publishing, scanning, archive, or package-management HTTP implementations before serving its read. Register the complete route table eagerly, but resolve unrelated implementations only after their matching route passes the existing ingress and quota middleware. Preserve every method/path/prefix and pass the original request and action context through so request-scoped authentication and rate-limit deduplication remain intact. Module-load and handler failures must propagate; do not cache rejected loader promises or turn them into empty successful catalogs.

Keep the overview query in a read-only module separate from package publication and moderation initialization. Its bounded selection, current publisher/official state, live statistics, transaction-budget fallback, and anonymous response contract remain unchanged. This startup optimization introduces no response cache, visibility delay, quota bypass, or install authority.

## Measurement, 2026-11-04

All runs originate on the same Mac Studio with anonymous requests, no client data cache, the same explicit no-cache request header and no artificial delay. Time begins before catalog requests and ends after the complete JSON payload is available. These measure catalog data readiness, not process startup or browser navigation/paint. No cache-busting query is used: server query caching is part of real behavior.

Production baseline reproduces the actual OpenClaw overview: fourteen concurrent featured/category reads, following every continuation cursor and then selecting eight per section. It requires fifteen HTTP responses because other has 129 entries. Fresh runs: 3082.142, 2076.383, 1498.663, 2178.957, 1567.515 ms. Average: 2080.732 ms. Required production target: at most 1040.366 ms.

Local verification uses an isolated real Convex installation at 127.0.0.1:3410/3411 with 152 published public-corpus fixtures, two publishers, eight highlighted templates, research=12, productivity=11 and other=129. The unchanged implementation and candidate use the exact same database. A preliminary unpublished fixture was rejected and its timing discarded.

Unchanged local average: 1044.988 ms (five runs). Initial candidate average: 228.742 ms. Final bounded-concurrency candidate: 448.711, 205.216, 195.451, 197.439, 189.070 ms; average 247.177 ms, a 76.3% reduction. Exact selected-name parity was checked for all fourteen featured/category selections, including empty categories. Runtime tests additionally cover hidden/private/spoofed/unpublished records, publisher deactivation, live stats and badge changes, HTTP validation, a genuinely visible 1,000-row catalog and bounded-catalog fallback.

A native local stress check expanded each of the 152 package changelogs to 120,000 bytes. The direct query reached the actual 16 MiB read limit; the HTTP action returned 200 with complete: false and empty lists. All original fixture content was restored and the temporary helper removed from source and generated API before final measurement. The unit HTTP error-boundary test simulates the same platform error and separately asserts unrelated failures propagate.

Production release remains subject to exact-head review, CI and successful Test deployment, followed by the same five-run production comparison and live route verification. Backend availability alone does not activate the new path in older OpenClaw clients.
