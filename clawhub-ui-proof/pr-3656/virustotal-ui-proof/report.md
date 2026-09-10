# ClawHub UI Proof
Status: pass
Mode: `before-after`
Scenario: `/Users/patrickerichsen/Git/openclaw/clawhub-remove-virustotal-ui/.artifacts/proof-scenarios/remove-virustotal.mjs`
Baseline: `origin/main`
Candidate: `worktree`
Runner: `local`
Provider: `local`
## Artifacts
### baseline

- Output: `/Users/patrickerichsen/Git/openclaw/clawhub-remove-virustotal-ui/.artifacts/virustotal-ui-proof/baseline`
- pass: directory-loading-desktop - `baseline/screenshots/directory-loading-desktop.png`
- pass: skill-audit-desktop - `baseline/screenshots/skill-audit-desktop.png`
- pass: plugin-audit-desktop - `baseline/screenshots/plugin-audit-desktop.png`
- pass: skill-directory-desktop - `baseline/screenshots/skill-directory-desktop.png`
- pass: plugin-directory-desktop - `baseline/screenshots/plugin-directory-desktop.png`
- pass: directory-loading-laptop - `baseline/screenshots/directory-loading-laptop.png`
- pass: skill-audit-laptop - `baseline/screenshots/skill-audit-laptop.png`
- pass: plugin-audit-laptop - `baseline/screenshots/plugin-audit-laptop.png`
- pass: skill-directory-laptop - `baseline/screenshots/skill-directory-laptop.png`
- pass: plugin-directory-laptop - `baseline/screenshots/plugin-directory-laptop.png`
- pass: directory-loading-tablet - `baseline/screenshots/directory-loading-tablet.png`
- pass: skill-audit-tablet - `baseline/screenshots/skill-audit-tablet.png`
- pass: plugin-audit-tablet - `baseline/screenshots/plugin-audit-tablet.png`
- pass: skill-directory-tablet - `baseline/screenshots/skill-directory-tablet.png`
- pass: plugin-directory-tablet - `baseline/screenshots/plugin-directory-tablet.png`
- pass: directory-loading-mobile - `baseline/screenshots/directory-loading-mobile.png`
- pass: skill-audit-mobile - `baseline/screenshots/skill-audit-mobile.png`
- pass: plugin-audit-mobile - `baseline/screenshots/plugin-audit-mobile.png`
- pass: skill-directory-mobile - `baseline/screenshots/skill-directory-mobile.png`
- pass: plugin-directory-mobile - `baseline/screenshots/plugin-directory-mobile.png`

### candidate

- Output: `/Users/patrickerichsen/Git/openclaw/clawhub-remove-virustotal-ui/.artifacts/virustotal-ui-proof/candidate`
- pass: directory-loading-desktop - `candidate/screenshots/directory-loading-desktop.png`
- pass: skill-audit-desktop - `candidate/screenshots/skill-audit-desktop.png`
- pass: plugin-audit-desktop - `candidate/screenshots/plugin-audit-desktop.png`
- pass: skill-directory-desktop - `candidate/screenshots/skill-directory-desktop.png`
- pass: plugin-directory-desktop - `candidate/screenshots/plugin-directory-desktop.png`
- pass: directory-loading-laptop - `candidate/screenshots/directory-loading-laptop.png`
- pass: skill-audit-laptop - `candidate/screenshots/skill-audit-laptop.png`
- pass: plugin-audit-laptop - `candidate/screenshots/plugin-audit-laptop.png`
- pass: skill-directory-laptop - `candidate/screenshots/skill-directory-laptop.png`
- pass: plugin-directory-laptop - `candidate/screenshots/plugin-directory-laptop.png`
- pass: directory-loading-tablet - `candidate/screenshots/directory-loading-tablet.png`
- pass: skill-audit-tablet - `candidate/screenshots/skill-audit-tablet.png`
- pass: plugin-audit-tablet - `candidate/screenshots/plugin-audit-tablet.png`
- pass: skill-directory-tablet - `candidate/screenshots/skill-directory-tablet.png`
- pass: plugin-directory-tablet - `candidate/screenshots/plugin-directory-tablet.png`
- pass: directory-loading-mobile - `candidate/screenshots/directory-loading-mobile.png`
- pass: skill-audit-mobile - `candidate/screenshots/skill-audit-mobile.png`
- pass: plugin-audit-mobile - `candidate/screenshots/plugin-audit-mobile.png`
- pass: skill-directory-mobile - `candidate/screenshots/skill-directory-mobile.png`
- pass: plugin-directory-mobile - `candidate/screenshots/plugin-directory-mobile.png`


## Proof context

Baseline: `feafb9ae91` at http://127.0.0.1:4329. Candidate: `45bf41acba14c45e6d8dd1bfe9fd232745b268c6` at http://127.0.0.1:4330. Both apps use the same existing local Convex backend and fixture data; no API responses or page content were mocked.

Routes: `/local/skills/local-agentic-risk-demo/security-audit`, `/plugins/local-scanned-runtime-plugin/security-audit`, `/audits`, `/audits?type=plugins`.

Fixtures: Local Agentic Risk Demo (dense A.I.G findings), Local Scanned Runtime Plugin (completed scan), and long-title directory fixtures (pending and review statuses). Viewports: 390x844, 768x1024, 1366x768, 1440x900. Loading uses delayed real listAuditPage requests, released unchanged after capture.

All 40 captures passed: the baseline displays VirusTotal, the candidate omits its section/links/column, directories have three cells per row, loading has one scanner placeholder, and candidate pages have no horizontal overflow. Original screenshots were visually inspected; contact sheets were used only for local inspection and are not published as proof.

The existing shared dataset has no empty directory fixture; no-data and pending audit behavior is covered by component tests. Authentication, errors, and publication transitions were not changed or separately staged. No interaction video is needed for this static removal. The extreme unbroken-title audit fixture has a pre-existing overflow on both versions, so the dedicated scanner fixture is used for the audit-page proof; the long-title fixture remains covered in the directory.

Validation: `bun run ci:static`; `bun run ci:unit` (6,583 passed); `bun run ci:types-build`; focused scan-component tests; final structured autoreview (clean).
