# ClawHub UI Proof
Status: pass
Mode: `feature`
Scenario: `/Users/patrickerichsen/Git/openclaw/clawhub-plugin-trending/.artifacts/proof-scenarios/plugin-trending-24h.mjs`
Baseline: not run for feature proof.
Candidate: `worktree`
Runner: `local`
Provider: `local`
## Artifacts
### candidate

- Output: `/Users/patrickerichsen/Git/openclaw/clawhub-plugin-trending/.artifacts/plugin-trending-24h-proof/candidate`
- pass: 24-hour API and displayed totals exclude the former weekly leader - `candidate/screenshots/24-hour-api-and-displayed-totals-exclude-the-former-weekly-leader.png`
- pass: Load more preserves ranking and excludes old activity - `candidate/screenshots/load-more-preserves-ranking-and-excludes-old-activity.png`
- pass: Search filters 24-hour ranking and closing restores it - `candidate/screenshots/search-filters-24-hour-ranking-and-closing-restores-it.png`
- pass: Responsive mobile - `candidate/screenshots/responsive-mobile.png`
- pass: Responsive tablet - `candidate/screenshots/responsive-tablet.png`
- pass: Responsive laptop - `candidate/screenshots/responsive-laptop.png`
- pass: Responsive desktop - `candidate/screenshots/responsive-desktop.png`


Local URL: http://127.0.0.1:4319. Isolated Convex cloud/site ports: 4419/4519. Fixture: `devSeedPackageTrending:seedInternal`, 25 recent plugins and one former weekly leader whose 40 downloads precede the window. All seven browser steps passed. The bootstrap initially reported a Node compile-cache cleanup race after successful proof; cleanup was retried, the temporary state was removed, and all three ports were verified closed.
