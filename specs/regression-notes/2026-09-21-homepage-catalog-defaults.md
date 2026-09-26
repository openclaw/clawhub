# Homepage catalog defaults

The landing-page catalog starts with Plugins selected, with Plugins before Skills. Both the server-loaded initial listing and the client fallback when that loader fails must select Featured plugins.

Switching to Skills selects Featured, with tabs ordered Featured, Trending, Official, New. Trending remains explicitly selectable when available; its existing unavailable-feed fallback is unchanged. Dedicated browse routes and header navigation are outside this change.

Plugins expose the same tab order. Plugin Trending reads the existing seven-day plugin leaderboard, preserving its order through pagination and search. Like Skills Trending, selecting it clears and hides categories, and search filters the ranked feed rather than replacing it with catalog relevance results. The Skills feed retains its separate canonical 24-hour ranking and availability behavior.

Regression coverage: `src/lib/homeListingData.claw591.test.ts`, `src/__tests__/home-listing-section.test.tsx`, and `src/__tests__/home-listing-section.claw591.test.tsx`.
