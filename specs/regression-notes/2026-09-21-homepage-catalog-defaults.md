# Homepage catalog defaults

The landing-page catalog starts with Plugins selected, with Plugins before Skills. Both the server-loaded initial listing and the client fallback when that loader fails must select Featured plugins.

Switching to Skills selects Featured, with tabs ordered Featured, Trending, Official, New. Trending remains explicitly selectable when available; its existing unavailable-feed fallback is unchanged. Dedicated browse routes and header navigation are outside this change.

Plugins expose the same tab order. Plugin Trending reads the plugin leaderboard for the same 24 completed UTC hours as Skills Trending, preserving its order through pagination and search. Like Skills Trending, selecting it clears and hides categories, and search filters the ranked feed rather than replacing it with catalog relevance results. Plugin rows show downloads within that window. Ranking retains the plugin score of downloads plus three times net installs; category, publication, and English-language discovery checks still apply. Raw timestamped package events (retained for seven days) provide exact hourly boundaries; daily totals and lifetime downloads must not substitute for this window. The versioned `package_trending_24h` snapshot kind prevents legacy seven-day snapshots from being labeled as 24-hour activity. During upgrade, the reader keeps the legacy feed without window metrics until the first new snapshot is written; it then prefers the new snapshot even when empty. The hourly rebuild and top-200 limit remain unchanged. Skills retain their canonical ranking and availability behavior.

Regression coverage: `src/lib/homeListingData.claw591.test.ts`, `src/__tests__/home-listing-section.test.tsx`, and `src/__tests__/home-listing-section.claw591.test.tsx`.
