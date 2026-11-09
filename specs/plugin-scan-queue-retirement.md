# Retired plugin scan queue progress

Legacy automatic code-plugin and bundle-plugin ClawScan jobs have no adjudication authority. Manual/admin bulk rescans, automatic Endor-only reports, skills, and Template scans retain their existing routing. The retirement predicate is shared by claiming, recovery, target hydration, and dispatch.

## Active queue heads

Expired-lease recovery marks retired running jobs failed and clears their leases rather than leaving them in the bounded running-index window. It preserves job identity, source, attempts, run ID, original diagnostic, and any prior completion time; it does not edit the package, release, or scan evidence. A full batch containing retired rows schedules another bounded recovery mutation so eligible rows beyond the first window progress. No retired job is requeued.

Event dispatch keeps its normal single indexed queue-head read and existing coalescing fast path. When the head is retired, it terminalizes at most 64 queued rows per inspection. A full retired batch schedules another queue-inspection mutation, **not** an external worker. Both dispatch requests and dispatch begin perform this check. Only-retired queues therefore finish cleanup without launching workers; mixed queues eventually dispatch their eligible work. Cleanup continuations preserve dispatch retry not-before/backoff timing.

## Failed recovery pagination

Failed recovery retains retired failures without changing them. Its indexed time-window page is bounded by the requested limit (maximum 1000) and a native maximumRowsRead budget of 1001, including post-index catalog exclusions. It returns eligible-only matched/source/target/sample counts. A short or all-retired page can have matched=0 and hasMore=true: callers must pass nextCursor as cursor while hasMore is true, keeping the same failedAfter/failedBefore window. Restart without a cursor to begin a separate recovery pass. This also makes dry-run traversal resumable without changing historical rows. No unbounded scan is needed to find the next eligible row.

## Regression coverage

securityScan.retiredQueue.runtime.test.ts uses convex-test with schema validators, real indexes/pagination, transaction limits, and scheduled mutations/actions. It covers retired heads beyond expired/failed/dispatch page bounds, unchanged release evidence, dry-run and write recovery traversal, manual/admin bulk/skill/Template/Endor eligibility, stale lease rejection, only-retired versus mixed dispatch, and retry timing. Only the final GitHub transport/authentication is stubbed; tests never contact GitHub or execute production data changes.
