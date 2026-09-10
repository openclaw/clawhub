# Bundled plugin icon proof

The same eight official plugin records render category placeholders before the repair and their package-local artwork afterward. Captures are from actual ClawHub frontends and separate disposable local Convex backends, using Chromium without mocked API responses.

- Baseline: `694ff719e9`, `http://127.0.0.1:4377/plugins?official=true&view=list`, Convex `127.0.0.1:4477`.
- Candidate: `15f6108b7189451d9aeab5f596ffaf5c0709667d`, `http://127.0.0.1:4378/plugins?official=true&view=list`, Convex `127.0.0.1:4478`.
- Grid route: same URLs with `view=grid`.
- Fixtures: public metadata captured September 10, 2026 for WhatsApp, Matrix, Codex, Discord, Feishu/Lark, DeepSeek, Memory LanceDB, and Brave. Titles, summaries, categories, topics, stats, and pinned verification/source metadata match those records. The UI fixtures omit downloadable file payloads; no PNG is present in the corresponding production release file lists either.
- The candidate runs `maintenance:repairPluginIconsInternal` in both `code-plugin` and `bundle-plugin` families. Dry run: 8 matches, 0 writes. Apply: 8 repaired. Verification dry run: 0 remaining matches. The existing raster validation action, content-addressed storage, icon HTTP route, and catalog queries all run against real Convex.
- Browser assertions: baseline has zero plugin image elements; candidate has eight. Every visible image successfully decodes. Each published screenshot was visually inspected.

| State | Viewport | Result |
| --- | --- | --- |
| Official list, dark | 1440 × 900 | All eight icons render |
| Official list, light | 1440 × 900 | All eight icons render |
| Official list, laptop | 1366 × 768 | Icons render with existing row layout |
| Official grid, tablet | 768 × 1024 | Icons render with the existing muted card treatment |
| Official browse, mobile | 390 × 844 | Existing compact layout preserved; icons are intentionally hidden by its CSS |

Paired screenshots were cropped to the exact viewport from full-page browser screenshots. Full-page originals remain in the local proof directory. Loading, empty, and error layouts are outside this metadata-only change. No timing-dependent interaction changed, so no video was needed.

Commands: `PATH="$HOME/.bun/bin:$PATH" node .artifacts/plugin-icons/run-proof.mjs`; the harness uses `scripts/ui-proof-backend.mjs`, a temporary identical metadata seed module, the real maintenance action, and Playwright. Convex codegen ran against the isolated candidate deployment after removing the temporary seed module. Production was not changed.

Bundled-only policy: publication ignores manifest icon URLs and paths, summaries contain only resolved hosted assets, repair rejects remote URLs, and the UI falls back to category glyphs for old URL values. Six regressions failed before this correction and pass afterward.

Validation: 443 targeted tests; `bun run ci:unit` (6,610 passed, 3 skipped); `bun run ci:static`; `bun run ci:types-build`; Convex codegen; real local dry-run/apply/verify and browser screenshots.

Autoreview: `.agents/skills/autoreview/scripts/autoreview --mode local --prompt <bundled-only policy and trigger context>`. The final follow-up review exited cleanly with no accepted/actionable findings.
