# Homepage catalog view in the URL

The landing-page catalog mirrors its selected content type and tab in the URL as `kind` (`plugins`, `skills`) and `tab` (`featured`, `trending`, `official`, `new`). Defaults (Plugins, Featured) are omitted, so the plain homepage stays `/`. Unknown values fall back to the defaults.

Switching kind or tab replaces the current history entry without scrolling. It does not rerun the route loader: the listing section keeps owning per-view fetching and caching. The loader reads the URL only so a direct link such as `/?kind=skills&tab=trending` renders that view on first load. A cached loader listing for another view is not shown; the section fetches the requested view instead.

When requested Skills Trending is unavailable, the existing Featured fallback also updates the URL. Navigation from outside the section, such as the header logo link, resets the section to the URL's view.

Category and search remain local state and are not part of the URL.

Regression coverage: `src/__tests__/home-route.test.tsx`, `src/__tests__/home-listing-section.test.tsx`, and `src/lib/homeListingData.claw591.test.ts`.
