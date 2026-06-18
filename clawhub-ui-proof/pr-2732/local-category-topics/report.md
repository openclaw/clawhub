# ClawHub UI Proof

Status: pass
Mode: `feature`
Scenario: `.artifacts/proof-scenarios/category-topics.mjs`
Baseline: not run for feature proof.
Candidate: `worktree`
Provider: `local disposable Convex`

## Runtime Proof

- Clean lane-local Convex returned five normalized top topics for `development` skills and `runtime` plugins.
- The global Topics section remained absent.
- Clicking `#docker` updated the URL and set `aria-pressed="true"`.
- Desktop and 390px mobile chips stayed within their containers with no overlap.

## Artifacts

- pass: Skills selected category shows top topics
- pass: Skills topic chip filters and becomes active
- pass: Skills mobile selected category topics
- pass: Plugins selected category shows top topics
