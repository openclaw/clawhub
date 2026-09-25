# ClawHub UI Proof
Status: pass
Mode: `before-after`
Scenario: `/Users/patrickerichsen/Git/openclaw/clawhub-inline-audit/.artifacts/proof-scenarios/skillspector-full-range.pw.ts`
Baseline: `cb9c3ea5eefb`
Candidate: `bc8b06f641d95d29b3f91cc827fffb1bdb73c62e`
Runner: `local`
Provider: `local`
## Artifacts
### baseline

- Output: `/Users/patrickerichsen/Git/openclaw/clawhub-inline-audit/.artifacts/skillspector-full-range/proof/baseline`
- pass: Source start 1440px - `baseline/screenshots/source-start-1440px.png`
- pass: Source end 1440px - `baseline/screenshots/source-end-1440px.png`
- pass: Source start 390px - `baseline/screenshots/source-start-390px.png`
- pass: Source end 390px - `baseline/screenshots/source-end-390px.png`

### candidate

- Output: `/Users/patrickerichsen/Git/openclaw/clawhub-inline-audit/.artifacts/skillspector-full-range/proof/candidate`
- pass: Source start 1440px - `candidate/screenshots/source-start-1440px.png`
- pass: Source end 1440px - `candidate/screenshots/source-end-1440px.png`
- pass: Source start 390px - `candidate/screenshots/source-start-390px.png`
- pass: Source end 390px - `candidate/screenshots/source-end-390px.png`



Evidence: real running ClawHub instances at http://127.0.0.1:3041 and http://127.0.0.1:3042 using public release-validation 0.1.7, without mocks. The candidate working tree was unchanged between capture and commit bc8b06f641d95d29b3f91cc827fffb1bdb73c62e. All 8 desktop/mobile screenshots were visually inspected. Browser assertions compare the rendered highlighted text to the actual fetched file, confirm all 112 lines from 254–365, and check no page overflow at 390, 768, 1366, and 1440 pixels.
