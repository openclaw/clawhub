# Homepage catalog defaults

The landing-page catalog starts with Plugins selected, with Plugins before Skills. Both the server-loaded initial listing and the client fallback when that loader fails must select Featured plugins.

Switching to Skills selects Featured, with tabs ordered Featured, Trending, Official, New. Trending remains explicitly selectable when available; its existing unavailable-feed fallback is unchanged. Dedicated browse routes and header navigation are outside this change.

Regression coverage: `src/lib/homeListingData.claw591.test.ts`, `src/__tests__/home-listing-section.test.tsx`, and `src/__tests__/home-listing-section.claw591.test.tsx`.
