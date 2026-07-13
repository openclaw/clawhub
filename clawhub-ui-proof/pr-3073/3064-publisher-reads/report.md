# ClawHub UI Proof

Status: `passed`

The candidate ran in real Chromium against the local ClawHub app and Convex fixtures.

- On `/local-corpus-lynn-kuphal`, the first indexed page rendered 12 of 14 skills and exposed `Load more`.
- Loading the next page rendered all 14 distinct skills and removed `Load more`, with no duplicate or missing rows.
- On `/settings`, the account-deletion section showed no resource inventory before the destructive dialog opened.
- Opening the dialog showed the complete local-owner inventory: 2 skills and 3 plugins. The dialog was cancelled; no resource or account was deleted.

Behavior-first tests separately enforce the table-read bounds, cursor compatibility, old/new `listMine` contracts, and the dialog-gated query.
