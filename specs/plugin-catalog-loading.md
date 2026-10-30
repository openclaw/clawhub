# Plugin catalog loading

Public plugin browse and search use the route loader's anonymous package API read.
In production, the first unfiltered recommended 25-card page and curated category
pages use a native fetch so they reach the public CDN. Nitro's internal proxy
dispatch bypasses that cache. Other reads retain the existing internal proxy.
Keep viewer credentials out of catalog SSR; request identity and private-package
access checks remain separate.

The anonymous default first page shares a 30-second CDN snapshot, with no browser
cache or stale-while-revalidate extension. Ranking, counts and discovery metadata
can lag changes by that bound. At origin, authenticated requests, cookies, filters,
cursors, other page sizes and errors cannot populate this default snapshot. A
cookie-only CDN request may receive the same viewer-independent public snapshot;
bearer-authenticated API reads bypass it. Detail,
artifact and install checks continue to enforce current visibility and trust.
Curated categories retain their existing separate freshness policy. Cache misses
still execute the existing origin quota and access checks.

The catalog request has a bounded ten-second deadline. Production verification of
the header-forwarding repair showed valid API responses near the former
five-second deadline and catalog SSR errors at about 5.2 seconds. A six-second
healthy response must render records rather than become an unavailable catalog.
This budget is not a performance claim or permission to wait indefinitely.

Navigation cancellation still aborts immediately. Requests that exceed the full
budget still stop and render the existing API-error state; real API failures and
rate limits retain their existing behavior. Do not add retry traffic, weaken auth,
or convert failed requests into an empty successful catalog to hide latency.
