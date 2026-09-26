# ClawHub UI Proof
Status: pass
Mode: `before-after`
Scenario: `/Users/patrickerichsen/Git/openclaw/clawhub-featured-row-parity/.artifacts/proof-scenarios/featured-row-parity.pw.ts`
Baseline: `337e7b4c5c1bae715b5d4922fc356dc3d696ba23`
Candidate: `eaa8ac51532fa23d15dd4a12e601167090f98ea3`
Runner: `local`
Provider: `local`
## Artifacts
### baseline

- Output: `/Users/patrickerichsen/Git/openclaw/clawhub-featured-row-parity/.artifacts/featured-rows/proof-final-reviewed/baseline`
- pass: desktop Featured skills - `baseline/screenshots/desktop-featured-skills.png`
- pass: desktop Homepage loading - `baseline/screenshots/desktop-homepage-loading.png`
- pass: desktop Homepage Featured skills - `baseline/screenshots/desktop-homepage-featured-skills.png`
- pass: desktop Featured empty - `baseline/screenshots/desktop-featured-empty.png`
- pass: desktop Featured plugins - `baseline/screenshots/desktop-featured-plugins.png`
- pass: mobile Featured skills - `baseline/screenshots/mobile-featured-skills.png`
- pass: mobile Homepage loading - `baseline/screenshots/mobile-homepage-loading.png`
- pass: mobile Homepage Featured skills - `baseline/screenshots/mobile-homepage-featured-skills.png`
- pass: mobile Featured empty - `baseline/screenshots/mobile-featured-empty.png`
- pass: mobile Featured plugins - `baseline/screenshots/mobile-featured-plugins.png`
- pass: tablet Featured skills - `baseline/screenshots/tablet-featured-skills.png`
- pass: laptop Featured skills - `baseline/screenshots/laptop-featured-skills.png`

### candidate

- Output: `/Users/patrickerichsen/Git/openclaw/clawhub-featured-row-parity/.artifacts/featured-rows/proof-final-reviewed/candidate`
- pass: desktop Featured skills - `candidate/screenshots/desktop-featured-skills.png`
- pass: desktop Homepage loading - `candidate/screenshots/desktop-homepage-loading.png`
- pass: desktop Homepage Featured skills - `candidate/screenshots/desktop-homepage-featured-skills.png`
- pass: desktop Featured empty - `candidate/screenshots/desktop-featured-empty.png`
- pass: desktop Featured plugins - `candidate/screenshots/desktop-featured-plugins.png`
- pass: mobile Featured skills - `candidate/screenshots/mobile-featured-skills.png`
- pass: mobile Homepage loading - `candidate/screenshots/mobile-homepage-loading.png`
- pass: mobile Homepage Featured skills - `candidate/screenshots/mobile-homepage-featured-skills.png`
- pass: mobile Featured empty - `candidate/screenshots/mobile-featured-empty.png`
- pass: mobile Featured plugins - `candidate/screenshots/mobile-featured-plugins.png`
- pass: tablet Featured skills - `candidate/screenshots/tablet-featured-skills.png`
- pass: laptop Featured skills - `candidate/screenshots/laptop-featured-skills.png`


## Capture conditions

Anonymous, dark theme, real local ClawHub frontends reading the same public production catalog; no database writes or mocked responses. Baseline is 337e7b4. Mobile 390×844, desktop 1440×900, tablet 768×1024, laptop 1366×768. Native and skills.sh Featured records (including show-me, Ponytail, and long skill names) cover typical and content-heavy states. A delayed real query exposes the loading state; the query is then released. The empty state uses an unmatched Featured search. Error styling is unchanged; focused tests cover timeout and navigation cancellation.

All 24 captures inspected. Separate real-browser checks compare the first five plugin results on all four homepage/dedicated tabs and verify New pagination, global search transitions, and the show-me canonical detail link.
