# Plugin catalog loading

Public plugin browse and search use the route loader's anonymous package API read
through the existing internal proxy. Keep viewer credentials out of catalog SSR;
request identity and private-package access checks remain separate.

The catalog request has a bounded ten-second deadline. Production verification of
the header-forwarding repair showed valid API responses near the former
five-second deadline and catalog SSR errors at about 5.2 seconds. A six-second
healthy response must render records rather than become an unavailable catalog.
This budget is not a performance claim or permission to wait indefinitely.

Navigation cancellation still aborts immediately. Requests that exceed the full
budget still stop and render the existing API-error state; real API failures and
rate limits retain their existing behavior. Do not add retry traffic, weaken auth,
or convert failed requests into an empty successful catalog to hide latency.
