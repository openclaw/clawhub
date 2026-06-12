# AGENTS.md

Scope: docs shell generator, hidden visual fixtures, local smoke checks, and R2 artifact preparation.

- Do not edit generated `dist/docs-site/**`; rebuild it.
- Keep authored docs under `docs/**` out of this subtree. Use virtual fixtures or generator code here when testing shell UI.
- The hidden component fixture is generated at `/__elements`; keep it `noindex` and out of `sitemap.xml` and `llms.txt`.
- Run `make docs-check` after renderer, shell CSS, visual fixture, asset, or smoke changes.
- Use `make docs-elements` to build and smoke the hidden fixture, then `make docs-serve` plus `make docs-elements-open` for visual review.
- Add smoke coverage in `scripts/docs-site/smoke.mjs` for any new visual contract that would be annoying to catch by eye later.
- Keep R2 uploads diff-friendly: no generated timestamp churn, randomized output, or broad rewrites unless the source docs changed.
