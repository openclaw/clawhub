# Plugin icon presentation

The bundled OpenClaw lobster artwork should have breathing room inside its dark tile wherever `MarketplaceIcon` renders a plugin (catalog cards and rows, home listings, publisher listings, and search results). Keep the outer icon and surrounding layout dimensions unchanged.

Apply the 10% internal inset to the exact content-addressed artwork, not to all official plugins or all images: many OpenClaw plugins have distinct logos with their own spacing. The original bundled `assets/icon.png` has SHA-256 `79e24bf179e94e005912591a67ecdf30f04df50204ff5fa5fed06a8e8eb88532`; its solid background is `#0b0d12`. Padding belongs on the image so muted container backgrounds cannot produce a mismatched border around the artwork.

Do not rewrite immutable hosted assets or historical package metadata for a presentation adjustment. A replacement artwork with a new digest does not inherit this correction automatically, preventing double-padding if the replacement already includes margins. Publisher avatars, skill icons, unrelated plugin logos, and error fallback glyphs retain their existing treatment.
