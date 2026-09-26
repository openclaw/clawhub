Real ClawHub frontends against isolated local Convex backends; no mocked browser requests.

- Baseline: `f6a1b53566`; candidate: `066dfe3e6a`.
- Route `/`: baseline `http://127.0.0.1:4310`, candidate `http://127.0.0.1:4311`.
- Fixture: three published, clean plugins and skills; Lobster featured at 100, Diffs at 101, Shopify AI Toolkit at 102. The older publication lists Diffs then Lobster and omits Shopify. Identical data and frontend settings in both lanes.
- Before: Diffs → Lobster → Shopify. After: Shopify → Diffs → Lobster.
- Browser assertions verify DOM order at desktop 1440×900 and mobile 390×844. Screenshots are unaltered top-viewport crops of full-page Chromium captures; every published screenshot was inspected.
- Live `/api/v1/plugins?featured=true` and `/api/v1/plugins/overview` responses match the displayed order. OpenClaw uses the former directly and sorts its home shelf by the latter's `featuredRank`.
- Empty/loading/error states and video are unrelated to this ordering-only change. Three entries suffice to distinguish the old publication priority from timestamp ordering; content-heavy layout does not change.
- Runtime regression tests also prove skill order/pagination, limit-before-display behavior, retention without reordering, and remove/re-feature moving an entry to the front.
