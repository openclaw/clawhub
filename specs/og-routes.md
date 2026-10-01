# Public OG routes

`/og/skill`, `/og/plugin`, and `/og/profile` may fetch live metadata when the
query string does not already include display fields.

Those metadata fetches abort after 1.5s, matching trusted OG image fetches in
`fetchImageDataUrl`. The deadline covers transport and JSON decode, not only
response headers. A hung public API or Convex query must not stall the card.
